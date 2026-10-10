"""Portfolio aggregation: ledger + latest prices + FX -> account and consolidated values.

Definitions (shown in the UI as well):
- capital_gain = unrealized + realized (instrument currency)
- total_pl = capital_gain + net dividends - position fees/taxes
- pl_pct = total_pl / open cost basis (N/A if no cost basis or no price)
- Base-currency figures translate native figures at the latest FX rate. The FX effect
  (cost basis at today's FX minus cost basis at historical FX) is reported separately and
  only when every historical rate is known.
- Holdings without a price, or currencies without an FX rate, are excluded from totals and
  flagged; nothing is estimated.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .fx import FxTable
from .ledger import ZERO, Position, run_ledger
from .models import CURRENCIES, Account, DividendEvent, Instrument, PriceHistory, Transaction, utcnow
from .services import get_settings


def _pick_latest(rows: list[PriceHistory]) -> PriceHistory | None:
    if not rows:
        return None
    return max(rows, key=lambda r: (r.price_date, r.source == "manual", r.fetched_at or datetime.min))


def latest_prices(db: Session, instruments: dict[int, Instrument]) -> dict[int, PriceHistory]:
    by_inst: dict[int, list[PriceHistory]] = {}
    # Only the most recent ~10 days per instrument matter; keep it simple and load all recent rows.
    cutoff = date.today() - timedelta(days=3650)
    for r in db.scalars(select(PriceHistory).where(PriceHistory.price_date >= cutoff)):
        by_inst.setdefault(r.instrument_id, []).append(r)
    out = {}
    for iid, rows in by_inst.items():
        inst = instruments.get(iid)
        if inst is None:
            continue
        if inst.price_mode == "manual":
            rows = [r for r in rows if r.source == "manual"] or rows
        pick = _pick_latest(rows)
        if pick:
            out[iid] = pick
    return out


def price_status(row: PriceHistory | None, stale_minutes: int, now: datetime | None = None) -> str:
    """Live / Delayed / Cached / Manual / Unavailable. Never claims Live unless the provider said realtime."""
    if row is None:
        return "Unavailable"
    if row.source == "manual" or row.quality == "manual":
        return "Manual"
    now = now or utcnow()
    if row.fetched_at and now - row.fetched_at <= timedelta(minutes=stale_minutes):
        return "Live" if row.quality == "realtime" else "Delayed"
    return "Cached"


def trailing_dps(
    inst: Instrument, events: list[DividendEvent], positions: list[Position], today: date
) -> tuple[Decimal | None, str | None]:
    if inst.annual_dividend_per_share is not None:
        return Decimal(inst.annual_dividend_per_share), "forward estimate (manual)"
    start = today - timedelta(days=365)
    ev = [e for e in events if e.instrument_id == inst.id and start < e.ex_date <= today and e.currency == inst.currency]
    if ev:
        return sum((Decimal(e.amount_per_share) for e in ev), ZERO), "trailing 12m dividend events"
    # Per-share payout implied by each account's received dividends; accounts hold the same
    # company, so take the most complete account rather than summing across accounts.
    best = None
    for p in positions:
        per_share = [gross / qty for d, gross, qty in p.last_dividends if start < d <= today and qty]
        if per_share:
            s = sum(per_share, ZERO)
            best = s if best is None else max(best, s)
    if best is not None:
        return best, "trailing 12m received"
    return None, None


def _pct(num: Decimal | None, den: Decimal | None) -> Decimal | None:
    if num is None or not den:
        return None
    return num / den * 100


def build_portfolio(db: Session, base: str | None = None, today: date | None = None) -> dict:
    settings = get_settings(db)
    base = base or settings["base_currency"]
    today = today or date.today()
    stale = int(settings["stale_after_minutes"])

    accounts = list(db.scalars(select(Account).order_by(Account.sort_order, Account.id)))
    instruments = {i.id: i for i in db.scalars(select(Instrument))}
    txns = list(db.scalars(select(Transaction)))
    events = list(db.scalars(select(DividendEvent)))
    fx = FxTable.load(db)
    prices = latest_prices(db, instruments)

    def to_base_hist(amount: Decimal, ccy: str, d: date):
        return fx.convert(amount, ccy, base, d)

    ledger = run_ledger(txns, {i: x.currency for i, x in instruments.items()}, to_base=to_base_hist)
    positions_by_inst: dict[int, list[Position]] = {}
    for p in ledger.positions.values():
        positions_by_inst.setdefault(p.instrument_id, []).append(p)

    warnings: list[str] = []
    fx_now = {c: fx.quote(c, base) for c in CURRENCIES}
    for c in {i.currency for i in instruments.values()} - set(CURRENCIES):
        fx_now[c] = fx.quote(c, base)
    statuses: list[str] = []

    acct_out = []
    grand = dict(value=ZERO, cost=ZERO, pl=ZERO, unrealized=ZERO, realized=ZERO, dividends=ZERO,
                 fees=ZERO, cash=ZERO, est_div=ZERO, est_div_gross=ZERO, market_value=ZERO, fx_effect=ZERO)
    fx_effect_complete = True
    incomplete_any = False

    for acct in accounts:
        holdings, closed = [], []
        a = dict(value=ZERO, cost=ZERO, pl=ZERO, est_div=ZERO, est_div_gross=ZERO, market_value=ZERO,
                 unrealized=ZERO, realized=ZERO, dividends=ZERO, fees=ZERO, fx_effect=ZERO)
        incomplete = False
        for p in sorted(ledger.positions_for(acct.id), key=lambda p: instruments[p.instrument_id].symbol):
            inst = instruments[p.instrument_id]
            fxq = fx_now.get(inst.currency)
            fxr = fxq.rate if fxq else None
            pr = prices.get(inst.id)
            status = price_status(pr, stale)
            price = Decimal(pr.price) if pr else None
            if pr and pr.currency != inst.currency:
                price = None
                status = "Unavailable"
                warnings.append(f"{inst.symbol}: price currency {pr.currency} differs from {inst.currency}")
            mv = p.quantity * price if (price is not None and p.is_open) else (ZERO if not p.is_open else None)
            unreal = (mv - p.cost) if mv is not None else None
            cap = (unreal + p.realized) if unreal is not None else None
            total = (cap + p.dividends_net - p.fees_other) if cap is not None else None
            dps, dps_src = trailing_dps(inst, events, positions_by_inst.get(inst.id, []), today)
            wht = Decimal(inst.withholding_tax_rate or 0)
            est_gross = p.quantity * dps if (dps is not None and p.is_open) else None
            est_net = est_gross * (1 - wht) if est_gross is not None else None

            def b(x):
                return x * fxr if (x is not None and fxr is not None) else None

            fx_eff = None
            if p.is_open and fxr is not None and p.cost_base_hist is not None:
                fx_eff = p.cost * fxr - p.cost_base_hist
            row = {
                "instrument_id": inst.id,
                "symbol": inst.symbol,
                "name": inst.name,
                "kind": inst.kind,
                "currency": inst.currency,
                "quantity": p.quantity,
                "avg_cost": p.avg_cost,
                "cost": p.cost,
                "price": price,
                "price_status": status,
                "price_source": pr.source if pr else None,
                "price_date": pr.price_date if pr else None,
                "price_fetched_at": pr.fetched_at if pr else None,
                "market_value": mv,
                "unrealized": unreal,
                "realized": p.realized,
                "capital_gain": cap,
                "dividends_gross": p.dividends_gross,
                "dividend_tax": p.dividend_tax,
                "dividends_net": p.dividends_net,
                "fees": p.fees_other,
                "total_pl": total,
                "pl_pct": _pct(total, p.cost) if p.is_open else _pct(total, p.cost_of_sold),
                "dps": dps,
                "dps_source": dps_src,
                "withholding_tax_rate": wht,
                "est_annual_dividend": est_gross,
                "est_annual_dividend_net": est_net,
                "dividend_yield": _pct(dps, price) if (dps is not None and price) else None,
                "yield_on_cost": _pct(dps, p.avg_cost) if (dps is not None and p.avg_cost) else None,
                "fx_rate": fxr,
                "market_value_base": b(mv),
                "cost_base": b(p.cost),
                "total_pl_base": b(total),
                "fx_effect_base": fx_eff,
                "first_date": p.first_date,
            }
            if p.is_open:
                statuses.append(status)
                holdings.append(row)
            else:
                closed.append(row)

            if fxr is None:
                if p.is_open or total:
                    incomplete = True
                    warnings.append(f"{acct.name}/{inst.symbol}: no {inst.currency}->{base} FX rate")
                continue
            if p.is_open and mv is None:
                incomplete = True
                warnings.append(f"{acct.name}/{inst.symbol}: no price, excluded from totals")
                # Realized and dividends still count; the open position is excluded.
                part = (p.realized + p.dividends_net - p.fees_other) * fxr
                a["pl"] += part
                a["realized"] += p.realized * fxr
                a["dividends"] += p.dividends_net * fxr
                continue
            a["market_value"] += mv * fxr
            a["cost"] += p.cost * fxr
            a["pl"] += total * fxr
            a["unrealized"] += unreal * fxr
            a["realized"] += p.realized * fxr
            a["dividends"] += p.dividends_net * fxr
            a["fees"] += p.fees_other * fxr
            if est_net is not None:
                a["est_div"] += est_net * fxr
                a["est_div_gross"] += est_gross * fxr
            if p.is_open:
                if fx_eff is None:
                    fx_effect_complete = False
                else:
                    a["fx_effect"] += fx_eff

        # Account-level fees/taxes (not tied to a position) reduce P/L.
        flows = ledger.flows.get(acct.id)
        acct_fees = ZERO
        if flows:
            for ccy, amt in flows.fees.items():
                r = fx.rate(ccy, base)
                if r is None:
                    incomplete = True
                    warnings.append(f"{acct.name}: no {ccy}->{base} FX rate for fees")
                else:
                    acct_fees += amt * r
        a["pl"] -= acct_fees
        a["fees"] += acct_fees

        cash_native = {c: v for c, v in ledger.cash_for(acct.id).items() if v != 0}
        cash_base = ZERO
        for ccy, amt in cash_native.items():
            r = fx.rate(ccy, base)
            if r is None:
                if acct.track_cash:
                    incomplete = True
                    warnings.append(f"{acct.name}: no {ccy}->{base} FX rate for cash")
            else:
                cash_base += amt * r
        contributions = None
        if flows:
            contributions = ZERO
            for kind, sign in (("deposits", 1), ("withdrawals", -1), ("transfers_in", 1), ("transfers_out", -1)):
                for ccy, amt in getattr(flows, kind).items():
                    r = fx.rate(ccy, base)
                    if r is None:
                        contributions = None
                        break
                    contributions += sign * amt * r
                if contributions is None:
                    break

        a["value"] = a["market_value"] + (cash_base if acct.track_cash else ZERO)
        incomplete_any |= incomplete
        acct_out.append({
            "id": acct.id,
            "name": acct.name,
            "layout": acct.layout,
            "currency": acct.currency,
            "broker": acct.broker,
            "track_cash": acct.track_cash,
            "archived": acct.archived,
            "notes": acct.notes,
            "sort_order": acct.sort_order,
            "value": a["value"],
            "market_value": a["market_value"],
            "cost": a["cost"],
            "pl": a["pl"],
            "pl_pct": _pct(a["pl"], a["cost"]),
            "unrealized": a["unrealized"],
            "realized": a["realized"],
            "dividends_net": a["dividends"],
            "fees": a["fees"],
            "fx_effect": a["fx_effect"],
            "est_annual_dividend": a["est_div"],
            "est_annual_dividend_gross": a["est_div_gross"],
            "dividend_yield": _pct(a["est_div"], a["market_value"]),
            "cash": cash_native,
            "cash_base": cash_base,
            "net_contributions": contributions,
            "value_minus_contributions": (a["market_value"] + cash_base - contributions)
            if (contributions is not None and acct.track_cash) else None,
            "incomplete": incomplete,
            "holdings": holdings,
            "closed": closed,
        })
        for k in ("value", "cost", "pl", "unrealized", "realized", "fees", "market_value", "fx_effect"):
            grand[k] += a[k]
        grand["dividends"] += a["dividends"]
        grand["est_div"] += a["est_div"]
        grand["est_div_gross"] += a["est_div_gross"]
        if acct.track_cash:
            grand["cash"] += cash_base

    fx_list = []
    for c in CURRENCIES:
        if c == base:
            continue
        q = fx_now.get(c)
        fx_list.append({"from": c, "to": base, "rate": q.rate if q else None,
                        "date": q.rate_date if q else None, "source": q.source if q else None})

    if not statuses:
        overall = "Unavailable" if instruments else "Manual"
    elif all(s == "Unavailable" for s in statuses):
        overall = "Unavailable"
    elif all(s == "Manual" for s in statuses):
        overall = "Manual"
    elif "Unavailable" in statuses:
        overall = "Partial"
    elif "Cached" in statuses:
        overall = "Cached"
    elif all(s in ("Live", "Manual") for s in statuses) and "Live" in statuses:
        overall = "Live"
    else:
        overall = "Delayed"

    fetched = [h["price_fetched_at"] for a in acct_out for h in a["holdings"] if h["price_fetched_at"]]
    return {
        "base_currency": base,
        "generated_at": utcnow(),
        "prices_as_of": max(fetched) if fetched else None,
        "demo": config.DEMO,
        "price_status": overall,
        "price_status_counts": {s: statuses.count(s) for s in set(statuses)},
        "fx": fx_list,
        "totals": {
            "value": grand["value"],
            "market_value": grand["market_value"],
            "cash": grand["cash"],
            "cost": grand["cost"],
            "pl": grand["pl"],
            "pl_pct": _pct(grand["pl"], grand["cost"]),
            "unrealized": grand["unrealized"],
            "realized": grand["realized"],
            "dividends_net": grand["dividends"],
            "fees": grand["fees"],
            "fx_effect": grand["fx_effect"] if fx_effect_complete else None,
            "est_annual_dividend": grand["est_div"],
            "est_annual_dividend_gross": grand["est_div_gross"],
            "dividend_yield": _pct(grand["est_div"], grand["market_value"]),
            "incomplete": incomplete_any,
        },
        "accounts": acct_out,
        "warnings": sorted(set(warnings)),
    }
