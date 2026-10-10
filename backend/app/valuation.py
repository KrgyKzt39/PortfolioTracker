"""Portfolio view: holdings + latest prices + FX -> category cards and totals.

Kept deliberately simple:
- gain      = (price - average cost) x quantity          (instrument currency)
- dividends = dividends received, net of withholding tax
- P/L       = gain + dividends;  return % = P/L / cost
- Base-currency figures use the latest FX rate.
- A holding without a price (or a currency without an FX rate) shows N/A and is left out of totals.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import config
from .fx import FxTable
from .models import (Broker, Category, DividendEvent, DividendPayment, Holding, Instrument,
                     PriceHistory, utcnow)
from .services import get_settings

ZERO = Decimal(0)


def latest_prices(db: Session, instruments: dict[int, Instrument]) -> dict[int, PriceHistory]:
    by_inst: dict[int, list[PriceHistory]] = defaultdict(list)
    for r in db.scalars(select(PriceHistory).where(PriceHistory.price_date >= date.today() - timedelta(days=3650))):
        by_inst[r.instrument_id].append(r)
    out = {}
    for iid, rows in by_inst.items():
        inst = instruments.get(iid)
        if inst is None:
            continue
        if inst.price_mode == "manual":
            rows = [r for r in rows if r.source == "manual"] or rows
        out[iid] = max(rows, key=lambda r: (r.price_date, r.source == "manual", r.fetched_at or datetime.min))
    return out


def price_status(row: PriceHistory | None, stale_minutes: int, now: datetime | None = None) -> str:
    """Live / Delayed / Cached / Manual / Unavailable. Live only when the provider's quote was real-time."""
    if row is None:
        return "Unavailable"
    if row.source == "manual" or row.quality == "manual":
        return "Manual"
    now = now or utcnow()
    if row.fetched_at and now - row.fetched_at <= timedelta(minutes=stale_minutes):
        return "Live" if row.quality == "realtime" else "Delayed"
    return "Cached"


def dividend_per_share(inst: Instrument, events: list[DividendEvent], today: date) -> tuple[Decimal | None, str | None]:
    """Your forward estimate if set, otherwise the sum of the last 12 months of dividend events."""
    if inst.annual_dividend_per_share is not None:
        return Decimal(inst.annual_dividend_per_share), "your estimate"
    start = today - timedelta(days=365)
    ev = [e for e in events if e.instrument_id == inst.id and start < e.ex_date <= today and e.currency == inst.currency]
    if ev:
        return sum((Decimal(e.amount_per_share) for e in ev), ZERO), "last 12 months"
    return None, None


def _pct(num, den):
    if num is None or not den:
        return None
    return num / den * 100


def payment_net(p: DividendPayment) -> Decimal:
    return Decimal(p.gross) - Decimal(p.tax or 0)


def build_portfolio(db: Session, base: str | None = None, today: date | None = None) -> dict:
    settings = get_settings(db)
    base = base or settings["base_currency"]
    today = today or date.today()
    stale = int(settings["stale_after_minutes"])

    categories = list(db.scalars(select(Category).order_by(Category.sort_order, Category.id)))
    instruments = {i.id: i for i in db.scalars(select(Instrument))}
    brokers = {b.id: b for b in db.scalars(select(Broker))}
    holdings = list(db.scalars(select(Holding)))
    events = list(db.scalars(select(DividendEvent)))
    payments = list(db.scalars(select(DividendPayment)))
    fx = FxTable.load(db)
    prices = latest_prices(db, instruments)

    lots: dict[int, list[Holding]] = defaultdict(list)
    for h in holdings:
        lots[h.instrument_id].append(h)
    received: dict[int, Decimal] = defaultdict(lambda: ZERO)  # instrument currency, net
    received_base: dict[int, Decimal | None] = defaultdict(lambda: ZERO)
    warnings: list[str] = []
    for p in payments:
        inst = instruments[p.instrument_id]
        net = payment_net(p)
        native = net if p.currency == inst.currency else fx.convert(net, p.currency, inst.currency)
        if native is None:
            warnings.append(f"{inst.symbol}: no {p.currency}->{inst.currency} rate for a dividend")
            continue
        received[inst.id] += native

    rows = []
    statuses = []
    for iid, ls in lots.items():
        inst = instruments[iid]
        qty = sum((Decimal(h.quantity) for h in ls), ZERO)
        cost = sum((Decimal(h.quantity) * Decimal(h.avg_cost) for h in ls), ZERO)
        pr = prices.get(iid)
        status = price_status(pr, stale)
        price = Decimal(pr.price) if pr else None
        if pr and pr.currency != inst.currency:
            price, status = None, "Unavailable"
            warnings.append(f"{inst.symbol}: price currency {pr.currency} differs from {inst.currency}")
        statuses.append(status)
        mv = qty * price if price is not None else None
        gain = mv - cost if mv is not None else None
        divs = received[iid]
        pl = gain + divs if gain is not None else None
        dps, dps_src = dividend_per_share(inst, events, today)
        wht = Decimal(inst.withholding_tax_rate or 0)
        est_net = qty * dps * (1 - wht) if dps is not None else None
        fxq = fx.quote(inst.currency, base)
        r = fxq.rate if fxq else None
        if r is None:
            warnings.append(f"{inst.symbol}: no {inst.currency}->{base} exchange rate")
        elif mv is None:
            warnings.append(f"{inst.symbol}: no price yet, left out of totals")

        def b(x):
            return x * r if (x is not None and r is not None) else None

        rows.append({
            "instrument_id": iid,
            "symbol": inst.symbol,
            "name": inst.name,
            "kind": inst.kind,
            "currency": inst.currency,
            "category_id": inst.category_id,
            "sort_order": inst.sort_order,
            "quantity": qty,
            "avg_cost": cost / qty if qty else None,
            "cost": cost,
            "price": price,
            "price_status": status,
            "price_source": pr.source if pr else None,
            "price_date": pr.price_date if pr else None,
            "price_fetched_at": pr.fetched_at if pr else None,
            "market_value": mv,
            "gain": gain,
            "dividends_net": divs,
            "total_pl": pl,
            "pl_pct": _pct(pl, cost),
            "dps": dps,
            "dps_source": dps_src,
            "withholding_tax_rate": wht,
            "est_annual_dividend_net": est_net,
            "dividend_yield": _pct(dps, price) if (dps is not None and price) else None,
            "fx_rate": r,
            "market_value_base": b(mv),
            "cost_base": b(cost),
            "total_pl_base": b(pl),
            "est_annual_dividend_base": b(est_net),
            "lots": [{
                "holding_id": h.id, "broker_id": h.broker_id, "broker": brokers[h.broker_id].name,
                "quantity": Decimal(h.quantity), "avg_cost": Decimal(h.avg_cost), "updated_at": h.updated_at,
                "source": h.source,
            } for h in sorted(ls, key=lambda h: brokers[h.broker_id].name)],
        })

    cat_ids = {c.id for c in categories}
    cards = [{"id": c.id, "name": c.name, "show_dividends": c.show_dividends, "sort_order": c.sort_order}
             for c in categories]
    if any(row["category_id"] not in cat_ids for row in rows):
        cards.append({"id": None, "name": "Uncategorised", "show_dividends": False, "sort_order": 10**6})
    totals = dict(value=ZERO, cost=ZERO, pl=ZERO, est=ZERO, mv=ZERO)
    incomplete_any = False
    for card in cards:
        mine = [row for row in rows if (row["category_id"] if row["category_id"] in cat_ids else None) == card["id"]]
        mine.sort(key=lambda row: (row["sort_order"], row["symbol"]))
        t = dict(value=ZERO, cost=ZERO, pl=ZERO, est=ZERO)
        incomplete = False
        for row in mine:
            if row["market_value_base"] is None:
                incomplete = True
                continue
            t["value"] += row["market_value_base"]
            t["cost"] += row["cost_base"]
            t["pl"] += row["total_pl_base"]
            t["est"] += row["est_annual_dividend_base"] or ZERO
        card.update({
            "holdings": mine,
            "value": t["value"],
            "cost": t["cost"],
            "pl": t["pl"],
            "pl_pct": _pct(t["pl"], t["cost"]),
            "est_annual_dividend": t["est"],
            "dividend_yield": _pct(t["est"], t["value"]),
            "incomplete": incomplete,
        })
        incomplete_any |= incomplete
        for k in ("value", "cost", "pl", "est"):
            totals[k] += t[k]

    # Rates shown in the header: only the currencies you actually hold.
    fx_list = []
    for c in sorted({inst.currency for iid, inst in instruments.items() if iid in lots}):
        if c != base:
            q = fx.quote(c, base)
            fx_list.append({"from": c, "to": base, "rate": q.rate if q else None,
                            "date": q.rate_date if q else None, "source": q.source if q else None})

    if not statuses:
        overall = "Manual"
    elif all(s == "Unavailable" for s in statuses):
        overall = "Unavailable"
    elif all(s == "Manual" for s in statuses):
        overall = "Manual"
    elif "Unavailable" in statuses:
        overall = "Partial"
    elif "Cached" in statuses:
        overall = "Cached"
    elif "Live" in statuses and all(s in ("Live", "Manual") for s in statuses):
        overall = "Live"
    else:
        overall = "Delayed"

    fetched = [row["price_fetched_at"] for row in rows if row["price_fetched_at"]]
    return {
        "base_currency": base,
        "generated_at": utcnow(),
        "prices_as_of": max(fetched) if fetched else None,
        "demo": config.DEMO,
        "price_status": overall,
        "fx": fx_list,
        "totals": {
            "value": totals["value"],
            "cost": totals["cost"],
            "pl": totals["pl"],
            "pl_pct": _pct(totals["pl"], totals["cost"]),
            "est_annual_dividend": totals["est"],
            "dividend_yield": _pct(totals["est"], totals["value"]),
            "incomplete": incomplete_any,
        },
        "categories": cards,
        "warnings": sorted(set(warnings)),
    }
