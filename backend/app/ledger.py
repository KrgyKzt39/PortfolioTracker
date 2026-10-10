"""Pure accounting engine: replays transactions into positions and cash.

Rules (weighted-average cost):
- BUY: qty += q; cost += q*price + fees; cash -= q*price + fees.
- SELL: cost_removed = avg*q; realized += q*price - fees - cost_removed; cash += q*price - fees.
- DIVIDEND: income gross=amount, tax=tax, net=amount-tax; cash += net.
- DRIP: dividend income as DIVIDEND, then net is reinvested: qty += q, cost += q*price,
  cash += net - q*price (normally zero).
- DEPOSIT / WITHDRAWAL: external cash flows (contributions), never returns.
- FEE / TAX: cash outflow; attributed to the position if an instrument is given, else to the account.
- SPLIT: qty *= ratio for every position (or one account's position); total cost unchanged.
- TRANSFER: moves securities (with their cost basis, no realized P/L) or cash between accounts.

All arithmetic uses Decimal. Nothing is rounded here.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Callable, Iterable

ZERO = Decimal(0)

# Same-day ordering: splits apply first, cash in before buys, sells and withdrawals last.
TYPE_ORDER = {
    "SPLIT": 0,
    "DEPOSIT": 1,
    "BUY": 2,
    "DRIP": 3,
    "TRANSFER": 4,
    "DIVIDEND": 5,
    "FEE": 6,
    "TAX": 6,
    "SELL": 7,
    "WITHDRAWAL": 8,
}

# (amount, from_ccy, on_date) -> converted amount in the base currency, or None if unknown.
ToBase = Callable[[Decimal, str, date], Decimal | None]


class LedgerError(ValueError):
    def __init__(self, message: str, txn_id: int | None = None):
        super().__init__(message)
        self.txn_id = txn_id


@dataclass
class Position:
    account_id: int
    instrument_id: int
    currency: str
    quantity: Decimal = ZERO
    cost: Decimal = ZERO  # remaining cost basis of open shares, instrument currency
    cost_base_hist: Decimal | None = ZERO  # same, at historical FX into base; None if FX unknown
    realized: Decimal = ZERO
    dividends_gross: Decimal = ZERO
    dividend_tax: Decimal = ZERO
    fees_other: Decimal = ZERO  # FEE/TAX transactions attributed to this position
    cost_of_sold: Decimal = ZERO
    total_bought: Decimal = ZERO
    first_date: date | None = None
    last_dividends: list[tuple[date, Decimal, Decimal]] = field(default_factory=list)  # (date, gross, qty)

    @property
    def dividends_net(self) -> Decimal:
        return self.dividends_gross - self.dividend_tax

    @property
    def avg_cost(self) -> Decimal | None:
        return self.cost / self.quantity if self.quantity else None

    @property
    def is_open(self) -> bool:
        return self.quantity != 0


@dataclass
class AccountFlows:
    deposits: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    withdrawals: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    transfers_in: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    transfers_out: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    fees: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))  # account-level fees/taxes


@dataclass
class LedgerResult:
    positions: dict[tuple[int, int], Position]
    cash: dict[tuple[int, str], Decimal]
    flows: dict[int, AccountFlows]

    def positions_for(self, account_id: int) -> list[Position]:
        return [p for (a, _), p in self.positions.items() if a == account_id]

    def cash_for(self, account_id: int) -> dict[str, Decimal]:
        return {c: v for (a, c), v in self.cash.items() if a == account_id}


def D(v) -> Decimal:
    if v is None:
        return ZERO
    return v if isinstance(v, Decimal) else Decimal(str(v))


def sort_key(t) -> tuple:
    return (t.trade_date, TYPE_ORDER.get(t.type, 9), t.id or 0)


def run_ledger(
    txns: Iterable,
    instrument_ccy: dict[int, str],
    to_base: ToBase | None = None,
    as_of: date | None = None,
) -> LedgerResult:
    """Replay transactions in chronological order. Raises LedgerError on invalid history."""
    positions: dict[tuple[int, int], Position] = {}
    cash: dict[tuple[int, str], Decimal] = defaultdict(lambda: ZERO)
    flows: dict[int, AccountFlows] = defaultdict(AccountFlows)

    def pos(acct: int, inst: int) -> Position:
        key = (acct, inst)
        if key not in positions:
            positions[key] = Position(acct, inst, instrument_ccy[inst])
        return positions[key]

    def hist(amount: Decimal, ccy: str, d: date, t) -> Decimal | None:
        if to_base is None:
            return None
        if t.fx_rate and t.fx_currency and to_base(Decimal(1), t.fx_currency, d) is not None:
            # Broker-supplied rate into fx_currency, then into base.
            return to_base(amount * D(t.fx_rate), t.fx_currency, d)
        return to_base(amount, ccy, d)

    for t in sorted(txns, key=sort_key):
        if as_of and t.trade_date > as_of:
            continue
        typ = t.type
        q = D(t.quantity)
        price = D(t.price)
        amount = D(t.amount)
        fees = D(t.fees)
        tax = D(t.tax)
        ccy = t.currency

        if typ in ("BUY", "SELL", "DRIP", "DIVIDEND") and t.instrument_id is None:
            raise LedgerError(f"{typ} requires an instrument", t.id)
        if typ in ("BUY", "SELL", "DRIP") and t.instrument_id is not None:
            if instrument_ccy[t.instrument_id] != ccy:
                raise LedgerError(
                    f"{typ} currency {ccy} must match instrument currency {instrument_ccy[t.instrument_id]}", t.id
                )

        if typ == "BUY":
            if q <= 0 or price < 0 or fees < 0:
                raise LedgerError("BUY needs positive quantity and non-negative price/fees", t.id)
            p = pos(t.account_id, t.instrument_id)
            gross = q * price + fees
            p.quantity += q
            p.cost += gross
            p.total_bought += gross
            p.first_date = p.first_date or t.trade_date
            if p.cost_base_hist is not None:
                hb = hist(gross, ccy, t.trade_date, t)
                p.cost_base_hist = None if hb is None else p.cost_base_hist + hb
            cash[(t.account_id, ccy)] -= gross

        elif typ == "SELL":
            if q <= 0 or price < 0 or fees < 0:
                raise LedgerError("SELL needs positive quantity and non-negative price/fees", t.id)
            p = pos(t.account_id, t.instrument_id)
            if q > p.quantity:
                raise LedgerError(
                    f"SELL of {q} on {t.trade_date} exceeds holding of {p.quantity}", t.id
                )
            removed = p.cost * q / p.quantity
            if p.cost_base_hist is not None:
                p.cost_base_hist -= p.cost_base_hist * q / p.quantity
            p.realized += q * price - fees - removed
            p.cost_of_sold += removed
            p.quantity -= q
            p.cost -= removed
            if p.quantity == 0:
                p.cost = ZERO
                if p.cost_base_hist is not None:
                    p.cost_base_hist = ZERO
            cash[(t.account_id, ccy)] += q * price - fees

        elif typ in ("DIVIDEND", "DRIP"):
            if amount < 0 or tax < 0 or tax > amount:
                raise LedgerError("Dividend needs gross amount >= withholding tax >= 0", t.id)
            p = pos(t.account_id, t.instrument_id)
            if ccy != p.currency and typ == "DRIP":
                raise LedgerError("DRIP currency must match instrument currency", t.id)
            p.dividends_gross += amount if ccy == p.currency else _convert_div(amount, ccy, p.currency, t)
            p.dividend_tax += tax if ccy == p.currency else _convert_div(tax, ccy, p.currency, t)
            p.last_dividends.append((t.trade_date, amount, p.quantity))
            net = amount - tax
            cash[(t.account_id, ccy)] += net
            if typ == "DRIP":
                if q <= 0 or price < 0:
                    raise LedgerError("DRIP needs reinvested quantity and price", t.id)
                reinvest = q * price
                p.quantity += q
                p.cost += reinvest
                p.total_bought += reinvest
                p.first_date = p.first_date or t.trade_date
                if p.cost_base_hist is not None:
                    hb = hist(reinvest, ccy, t.trade_date, t)
                    p.cost_base_hist = None if hb is None else p.cost_base_hist + hb
                cash[(t.account_id, ccy)] -= reinvest

        elif typ == "DEPOSIT":
            if amount <= 0:
                raise LedgerError("DEPOSIT amount must be positive", t.id)
            cash[(t.account_id, ccy)] += amount
            flows[t.account_id].deposits[ccy] += amount

        elif typ == "WITHDRAWAL":
            if amount <= 0:
                raise LedgerError("WITHDRAWAL amount must be positive", t.id)
            cash[(t.account_id, ccy)] -= amount
            flows[t.account_id].withdrawals[ccy] += amount

        elif typ in ("FEE", "TAX"):
            if amount <= 0:
                raise LedgerError(f"{typ} amount must be positive", t.id)
            cash[(t.account_id, ccy)] -= amount
            if t.instrument_id is not None and instrument_ccy[t.instrument_id] == ccy:
                pos(t.account_id, t.instrument_id).fees_other += amount
            else:
                flows[t.account_id].fees[ccy] += amount

        elif typ == "SPLIT":
            ratio = D(t.split_ratio)
            if ratio <= 0 or t.instrument_id is None:
                raise LedgerError("SPLIT needs an instrument and a positive ratio", t.id)
            for (a, i), p in positions.items():
                if i == t.instrument_id and (t.account_id is None or a == t.account_id):
                    p.quantity *= ratio

        elif typ == "TRANSFER":
            src, dst = t.account_id, t.to_account_id
            if dst is None or dst == src:
                raise LedgerError("TRANSFER needs a different destination account", t.id)
            if t.instrument_id is not None:
                if q <= 0:
                    raise LedgerError("Security TRANSFER needs a positive quantity", t.id)
                ps = pos(src, t.instrument_id)
                if q > ps.quantity:
                    raise LedgerError(
                        f"TRANSFER of {q} on {t.trade_date} exceeds holding of {ps.quantity}", t.id
                    )
                moved = ps.cost * q / ps.quantity
                moved_hist = None
                if ps.cost_base_hist is not None:
                    moved_hist = ps.cost_base_hist * q / ps.quantity
                    ps.cost_base_hist -= moved_hist
                ps.quantity -= q
                ps.cost -= moved
                if ps.quantity == 0:
                    ps.cost = ZERO
                pd = pos(dst, t.instrument_id)
                pd.quantity += q
                pd.cost += moved
                pd.first_date = pd.first_date or t.trade_date
                if pd.cost_base_hist is not None:
                    pd.cost_base_hist = None if moved_hist is None else pd.cost_base_hist + moved_hist
                if fees:
                    cash[(src, ccy)] -= fees
                    flows[src].fees[ccy] += fees
            else:
                if amount <= 0:
                    raise LedgerError("Cash TRANSFER needs a positive amount", t.id)
                cash[(src, ccy)] -= amount
                cash[(dst, ccy)] += amount
                flows[src].transfers_out[ccy] += amount
                flows[dst].transfers_in[ccy] += amount
        else:
            raise LedgerError(f"Unknown transaction type {typ}", t.id)

    return LedgerResult(positions=positions, cash=dict(cash), flows=dict(flows))


def _convert_div(amount: Decimal, ccy: str, target: str, t) -> Decimal:
    """Dividend paid in a currency other than the instrument's: use the txn's fx_rate."""
    if t.fx_currency == target and t.fx_rate:
        return amount * D(t.fx_rate)
    raise LedgerError(
        f"Dividend in {ccy} for a {target} instrument needs fx_rate into {target}", t.id
    )


def quantity_at(txns: Iterable, instrument_ccy: dict[int, str], instrument_id: int, on: date) -> dict[int, Decimal]:
    """Shares held per account at the end of `on` (used for ex-date eligibility)."""
    res = run_ledger([t for t in txns if t.instrument_id == instrument_id], instrument_ccy, as_of=on)
    return {a: p.quantity for (a, i), p in res.positions.items() if p.quantity}
