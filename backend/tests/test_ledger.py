"""Pure accounting engine tests (no database)."""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal as D

import pytest

from app.ledger import LedgerError, run_ledger

CCY = {1: "MYR", 2: "USD"}
_id = iter(range(1, 10_000))


@dataclass
class T:
    type: str
    trade_date: date
    account_id: int | None = 1
    instrument_id: int | None = 1
    quantity: D | None = None
    price: D | None = None
    amount: D | None = None
    fees: D = D(0)
    tax: D = D(0)
    currency: str = "MYR"
    fx_rate: D | None = None
    fx_currency: str | None = None
    split_ratio: D | None = None
    to_account_id: int | None = None
    id: int = 0

    def __post_init__(self):
        self.id = self.id or next(_id)
        for f in ("quantity", "price", "amount", "fees", "tax", "split_ratio", "fx_rate"):
            v = getattr(self, f)
            if v is not None and not isinstance(v, D):
                setattr(self, f, D(str(v)))


def d(n):
    return date(2025, 1, n)


def test_weighted_average_buy_and_partial_sell():
    r = run_ledger([
        T("BUY", d(1), quantity=100, price=10, fees=10),   # cost 1010
        T("BUY", d(2), quantity=100, price=12, fees=10),   # cost 1210 -> total 2220, avg 11.10
        T("SELL", d(3), quantity=50, price=15, fees=5),
    ], CCY)
    p = r.positions[(1, 1)]
    assert p.quantity == 150
    assert p.avg_cost == D("11.1")
    assert p.cost == D("1665")
    assert p.realized == D("750") - 5 - D("555")  # 190
    assert r.cash[(1, "MYR")] == -1010 - 1210 + 745


def test_full_disposal_clears_cost_and_keeps_realized():
    r = run_ledger([
        T("BUY", d(1), quantity=3, price=D("10.333333")),
        T("SELL", d(2), quantity=3, price=11),
    ], CCY)
    p = r.positions[(1, 1)]
    assert p.quantity == 0 and p.cost == 0
    assert p.realized == 33 - D("30.999999")


def test_oversell_rejected_and_chronology_enforced():
    with pytest.raises(LedgerError, match="exceeds holding"):
        run_ledger([T("BUY", d(5), quantity=10, price=1), T("SELL", d(4), quantity=5, price=1)], CCY)


def test_same_day_buy_then_sell_ordering():
    r = run_ledger([T("SELL", d(1), quantity=5, price=2, id=1), T("BUY", d(1), quantity=10, price=1, id=2)], CCY)
    assert r.positions[(1, 1)].quantity == 5


def test_dividend_with_withholding_tax_and_cash():
    r = run_ledger([
        T("BUY", d(1), instrument_id=2, currency="USD", quantity=10, price=100),
        T("DIVIDEND", d(2), instrument_id=2, currency="USD", amount=10, tax=3),
    ], CCY)
    p = r.positions[(1, 2)]
    assert p.dividends_gross == 10 and p.dividend_tax == 3 and p.dividends_net == 7
    assert p.cost == 1000  # dividends do not change cost basis
    assert r.cash[(1, "USD")] == -1000 + 7


def test_drip_counts_income_once_and_adds_shares():
    r = run_ledger([
        T("BUY", d(1), quantity=100, price=1),
        T("DRIP", d(2), quantity=5, price=2, amount=10, tax=0),
    ], CCY)
    p = r.positions[(1, 1)]
    assert p.quantity == 105
    assert p.cost == 110
    assert p.dividends_net == 10
    assert r.cash[(1, "MYR")] == -100  # reinvested: no cash left over


def test_split_preserves_cost_and_adjusts_avg():
    r = run_ledger([
        T("BUY", d(1), quantity=10, price=100),
        T("BUY", d(1), account_id=2, quantity=4, price=100),
        T("SPLIT", d(2), account_id=None, split_ratio=4, amount=None),
        T("SELL", d(3), quantity=40, price=30),
    ], CCY)
    assert r.positions[(2, 1)].quantity == 16
    assert r.positions[(2, 1)].avg_cost == 25
    p = r.positions[(1, 1)]
    assert p.quantity == 0 and p.realized == 1200 - 1000


def test_reverse_split():
    r = run_ledger([T("BUY", d(1), quantity=100, price=1), T("SPLIT", d(2), split_ratio=D("0.1"))], CCY)
    assert r.positions[(1, 1)].quantity == 10 and r.positions[(1, 1)].avg_cost == 10


def test_security_transfer_moves_cost_without_realizing():
    r = run_ledger([
        T("BUY", d(1), quantity=10, price=10),
        T("BUY", d(2), quantity=10, price=20),
        T("TRANSFER", d(3), quantity=5, to_account_id=2),
    ], CCY)
    src, dst = r.positions[(1, 1)], r.positions[(2, 1)]
    assert src.quantity == 15 and dst.quantity == 5
    assert dst.cost == 75 and src.cost == 225
    assert src.realized == 0 and dst.realized == 0
    assert src.cost + dst.cost == 300  # nothing created or lost


def test_cash_transfer_and_flows_are_not_returns():
    r = run_ledger([
        T("DEPOSIT", d(1), instrument_id=None, amount=1000),
        T("TRANSFER", d(2), instrument_id=None, amount=400, to_account_id=2),
        T("WITHDRAWAL", d(3), account_id=2, instrument_id=None, amount=100),
        T("FEE", d(3), instrument_id=None, amount=5),
    ], CCY)
    assert r.cash[(1, "MYR")] == 595 and r.cash[(2, "MYR")] == 300
    assert r.flows[1].deposits["MYR"] == 1000 and r.flows[1].transfers_out["MYR"] == 400
    assert r.flows[2].transfers_in["MYR"] == 400 and r.flows[2].withdrawals["MYR"] == 100
    assert r.flows[1].fees["MYR"] == 5
    assert not r.positions


def test_currency_mismatch_rejected():
    with pytest.raises(LedgerError, match="currency"):
        run_ledger([T("BUY", d(1), instrument_id=2, currency="MYR", quantity=1, price=1)], CCY)


def test_historical_fx_cost_tracking():
    rates = {date(2025, 1, 1): D("4.5"), date(2025, 1, 2): D("4.0")}

    def to_base(amount, ccy, on):
        return amount if ccy == "MYR" else amount * rates[on]

    r = run_ledger([
        T("BUY", d(1), instrument_id=2, currency="USD", quantity=10, price=10),
        T("BUY", d(2), instrument_id=2, currency="USD", quantity=10, price=10),
        T("SELL", d(2), instrument_id=2, currency="USD", quantity=10, price=10),
    ], CCY, to_base=to_base)
    p = r.positions[(1, 2)]
    assert p.cost == 100
    assert p.cost_base_hist == D("425")  # half of (450 + 400)


def test_broker_fx_rate_used_for_history():
    def to_base(amount, ccy, on):
        return amount if ccy == "MYR" else None

    r = run_ledger([T("BUY", d(1), instrument_id=2, currency="USD", quantity=1, price=100,
                      fx_rate=D("4.2"), fx_currency="MYR")], CCY, to_base=to_base)
    assert r.positions[(1, 2)].cost_base_hist == 420
