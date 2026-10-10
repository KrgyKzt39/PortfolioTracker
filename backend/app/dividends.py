"""Dividend events, received payments, the income summary and the calendar.

An event (ex-date, pay date, amount per share) is only an expectation. Income is recorded when
you confirm a payment arrived, so nothing is counted twice or counted before it is paid.
Expected amounts use the quantity you hold now (holdings are snapshots, not trade history).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .fx import FxTable
from .holdings import ValidationError, to_decimal
from .models import Broker, DividendEvent, DividendPayment, EarningsDate, Holding, Instrument
from .services import audit, row_dict
from .valuation import ZERO, build_portfolio, payment_net

CONFIRM_WINDOW_DAYS = 60


def _wht(ev: DividendEvent) -> Decimal:
    if ev.withholding_tax_rate is not None:
        return Decimal(ev.withholding_tax_rate)
    return Decimal(ev.instrument.withholding_tax_rate or 0)


def _held(db: Session) -> dict[int, Decimal]:
    out: dict[int, Decimal] = defaultdict(lambda: ZERO)
    for h in db.scalars(select(Holding)):
        out[h.instrument_id] += Decimal(h.quantity)
    return out


def event_out(ev: DividendEvent, qty: Decimal, paid: list[DividendPayment], today: date) -> dict:
    wht = _wht(ev)
    gross = qty * Decimal(ev.amount_per_share)
    d = row_dict(ev)
    d.update({
        "symbol": ev.instrument.symbol,
        "name": ev.instrument.name,
        "quantity": qty,
        "expected_gross": gross,
        "expected_tax": gross * wht,
        "expected_net": gross * (1 - wht),
        "withholding_rate_effective": wht,
        "received_net": sum((payment_net(p) for p in paid), ZERO) if paid else None,
        "awaiting_confirmation": ev.status != "received" and ev.pay_date is not None and ev.pay_date <= today
        and qty > 0 and ev.pay_date >= today - timedelta(days=CONFIRM_WINDOW_DAYS),
    })
    return d


def list_events(db: Session, instrument_id: int | None = None, today: date | None = None) -> list[dict]:
    today = today or date.today()
    held = _held(db)
    paid = defaultdict(list)
    for p in db.scalars(select(DividendPayment).where(DividendPayment.event_id.is_not(None))):
        paid[p.event_id].append(p)
    q = select(DividendEvent).order_by(DividendEvent.ex_date.desc())
    if instrument_id:
        q = q.where(DividendEvent.instrument_id == instrument_id)
    return [event_out(e, held.get(e.instrument_id, ZERO), paid.get(e.id, []), today) for e in db.scalars(q)]


def _parse_date(v, field):
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(v)
    except ValueError as exc:
        raise ValidationError(f"{field} must be YYYY-MM-DD", field) from exc


def save_event(db: Session, data: dict, ev: DividendEvent | None = None, source: str = "manual") -> DividendEvent:
    inst = db.get(Instrument, data.get("instrument_id") or (ev.instrument_id if ev else None))
    if inst is None:
        raise ValidationError("choose a stock", "instrument_id")
    dps = to_decimal(data.get("amount_per_share", ev.amount_per_share if ev else None), "amount_per_share", positive=True)
    if dps is None:
        raise ValidationError("amount per share is required", "amount_per_share")
    ex = _parse_date(data.get("ex_date", ev.ex_date if ev else None), "ex_date")
    if ex is None:
        raise ValidationError("ex-date is required", "ex_date")
    pay = _parse_date(data.get("pay_date", ev.pay_date if ev else None), "pay_date")
    if pay and pay < ex:
        raise ValidationError("payment date cannot be before the ex-date", "pay_date")
    status = data.get("status", ev.status if ev else "announced")
    if status not in ("forecast", "announced", "pending", "received"):
        raise ValidationError("invalid status", "status")
    wht = data.get("withholding_tax_rate", ev.withholding_tax_rate if ev else None)
    wht = Decimal(str(wht)) if wht not in (None, "") else None
    if wht is not None and not (0 <= wht < 1):
        raise ValidationError("withholding rate must be between 0 and 1 (0.3 = 30%)", "withholding_tax_rate")
    dup = db.scalar(select(DividendEvent).where(DividendEvent.instrument_id == inst.id, DividendEvent.ex_date == ex))
    if dup and (ev is None or dup.id != ev.id):
        raise ValidationError(f"{inst.symbol} already has a dividend with ex-date {ex}", "ex_date")
    before = row_dict(ev) if ev else None
    if ev is None:
        ev = DividendEvent(instrument_id=inst.id, source=source)
        db.add(ev)
    ev.instrument_id, ev.ex_date, ev.pay_date, ev.amount_per_share = inst.id, ex, pay, dps
    ev.currency = (data.get("currency") or inst.currency).upper()
    ev.status, ev.withholding_tax_rate = status, wht
    ev.note = data.get("note", ev.note)
    db.flush()
    audit(db, "dividend_event", ev.id, "update" if before else "create", before=before, after=ev)
    return ev


def record_payment(db: Session, data: dict, ev: DividendEvent | None = None) -> DividendPayment:
    inst = db.get(Instrument, ev.instrument_id if ev else data.get("instrument_id"))
    if inst is None:
        raise ValidationError("choose a stock", "instrument_id")
    gross = to_decimal(data.get("gross"), "gross", positive=True)
    if gross is None:
        raise ValidationError("amount received is required", "gross")
    tax = to_decimal(data.get("tax"), "tax") or ZERO
    if tax > gross:
        raise ValidationError("tax cannot exceed the gross dividend", "tax")
    pay = _parse_date(data.get("pay_date"), "pay_date") or (ev.pay_date if ev and ev.pay_date else date.today())
    if pay > date.today():
        raise ValidationError("payment date cannot be in the future; confirm once it has arrived", "pay_date")
    broker_id = data.get("broker_id")
    if broker_id and db.get(Broker, broker_id) is None:
        raise ValidationError("unknown broker", "broker_id")
    if ev is not None and db.scalar(select(DividendPayment).where(DividendPayment.event_id == ev.id,
                                                                  DividendPayment.broker_id.is_(broker_id) if broker_id is None
                                                                  else DividendPayment.broker_id == broker_id)):
        raise ValidationError("this dividend is already recorded as received", "event")
    p = DividendPayment(instrument_id=inst.id, broker_id=broker_id, event_id=ev.id if ev else None, pay_date=pay,
                        gross=gross, tax=tax, currency=(data.get("currency") or (ev.currency if ev else inst.currency)).upper(),
                        note=data.get("note"))
    db.add(p)
    if ev is not None and ev.status != "received":
        before = row_dict(ev)
        ev.status = "received"
        audit(db, "dividend_event", ev.id, "received", before=before, after=ev)
    db.flush()
    audit(db, "dividend_payment", p.id, "create", after=p)
    return p


def delete_payment(db: Session, p: DividendPayment):
    if p.event_id:
        ev = db.get(DividendEvent, p.event_id)
        others = db.scalar(select(DividendPayment.id).where(DividendPayment.event_id == p.event_id,
                                                            DividendPayment.id != p.id).limit(1))
        if ev and not others:
            ev.status = "pending" if ev.pay_date and ev.pay_date <= date.today() else "announced"
    audit(db, "dividend_payment", p.id, "delete", before=p)
    db.delete(p)
    db.flush()


def payment_out(p: DividendPayment) -> dict:
    d = row_dict(p)
    d.update({"symbol": p.instrument.symbol, "broker": p.broker.name if p.broker else None, "net": payment_net(p)})
    return d


def _month(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def summary(db: Session, base: str | None = None, today: date | None = None) -> dict:
    today = today or date.today()
    pf = build_portfolio(db, base, today)
    base = pf["base_currency"]
    fx = FxTable.load(db)

    def conv(amount, ccy, on=None):
        """FX on the payment date when stored, otherwise the latest rate."""
        v = fx.convert(amount, ccy, base, on) if on else None
        return v if v is not None else fx.convert(amount, ccy, base)

    months = []
    y, m = today.year, today.month
    for _ in range(11):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    for _ in range(24):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1

    received_month = defaultdict(lambda: ZERO)
    t12m = ZERO
    start = today - timedelta(days=365)
    payments = list(db.scalars(select(DividendPayment).order_by(DividendPayment.pay_date.desc())))
    for p in payments:
        v = conv(payment_net(p), p.currency, p.pay_date)
        if v is None:
            continue
        if start < p.pay_date <= today:
            t12m += v
            received_month[_month(p.pay_date)] += v

    expected_month = defaultdict(lambda: ZERO)
    to_confirm, upcoming = [], []
    for e in list_events(db, today=today):
        if e["status"] == "received" or not e["quantity"]:
            continue
        net = conv(e["expected_net"], e["currency"])
        e["expected_net_base"] = net
        key = date.fromisoformat(e["pay_date"] or e["ex_date"])
        if e["awaiting_confirmation"]:
            to_confirm.append(e)
        elif key >= today:
            upcoming.append(e)
            if net is not None and _month(key) in months:
                expected_month[_month(key)] += net

    holdings = []
    for card in pf["categories"]:
        for h in card["holdings"]:
            if h["est_annual_dividend_base"]:
                holdings.append({"symbol": h["symbol"], "category": card["name"], "currency": h["currency"],
                                 "est_annual_net_base": h["est_annual_dividend_base"],
                                 "dividend_yield": h["dividend_yield"], "dps_source": h["dps_source"]})
    holdings.sort(key=lambda h: -h["est_annual_net_base"])
    forward = pf["totals"]["est_annual_dividend"]
    return {
        "base_currency": base,
        "forward_annual_estimate": forward,
        "monthly_average_projected": forward / 12 if forward else ZERO,
        "portfolio_yield": pf["totals"]["dividend_yield"],
        "t12m_net": t12m,
        "chart": [{"month": mk, "received": received_month.get(mk, ZERO), "expected": expected_month.get(mk, ZERO)}
                  for mk in months],
        "holdings": holdings,
        "to_confirm": sorted(to_confirm, key=lambda e: e["pay_date"]),
        "upcoming": sorted(upcoming, key=lambda e: e["pay_date"] or e["ex_date"]),
        "recent_payments": [payment_out(p) for p in payments[:30]],
    }


def calendar(db: Session, days: int = 120, today: date | None = None) -> list[dict]:
    """Upcoming ex-dates, payment dates and earnings dates for stocks you hold."""
    today = today or date.today()
    end = today + timedelta(days=days)
    held = _held(db)
    items = []
    for ev in db.scalars(select(DividendEvent).where(DividendEvent.instrument_id.in_(list(held)))):
        qty = held[ev.instrument_id]
        net = qty * Decimal(ev.amount_per_share) * (1 - _wht(ev))
        base = {"symbol": ev.instrument.symbol, "instrument_id": ev.instrument_id, "event_id": ev.id,
                "currency": ev.currency, "amount_per_share": ev.amount_per_share, "expected_net": net,
                "status": ev.status}
        if today <= ev.ex_date <= end:
            items.append({**base, "kind": "ex_date", "date": ev.ex_date, "pay_date": ev.pay_date})
        if ev.pay_date and today <= ev.pay_date <= end:
            items.append({**base, "kind": "pay_date", "date": ev.pay_date, "ex_date": ev.ex_date})
    for er in db.scalars(select(EarningsDate).where(EarningsDate.instrument_id.in_(list(held)),
                                                    EarningsDate.date >= today, EarningsDate.date <= end)):
        items.append({"kind": "earnings", "date": er.date, "symbol": er.instrument.symbol, "instrument_id": er.instrument_id,
                      "earnings_id": er.id, "session": er.session, "title": er.title, "source": er.source})
    items.sort(key=lambda x: (x["date"], {"earnings": 0, "ex_date": 1, "pay_date": 2}[x["kind"]], x["symbol"]))
    return items


def save_earnings(db: Session, data: dict, er: EarningsDate | None = None, source="manual") -> EarningsDate:
    inst = db.get(Instrument, data.get("instrument_id") or (er.instrument_id if er else None))
    if inst is None:
        raise ValidationError("choose a stock", "instrument_id")
    d = _parse_date(data.get("date", er.date if er else None), "date")
    if d is None:
        raise ValidationError("date is required", "date")
    session = data.get("session") or None
    if session not in (None, "before", "after"):
        raise ValidationError("session must be before or after market", "session")
    dup = db.scalar(select(EarningsDate).where(EarningsDate.instrument_id == inst.id, EarningsDate.date == d))
    if dup and (er is None or dup.id != er.id):
        if source != "manual":
            er = dup
        else:
            raise ValidationError(f"{inst.symbol} already has earnings on {d}", "date")
    if er is None:
        er = EarningsDate(instrument_id=inst.id, date=d)
        db.add(er)
    er.instrument_id, er.date, er.session = inst.id, d, session
    er.title, er.source = data.get("title") or er.title, source
    db.flush()
    return er
