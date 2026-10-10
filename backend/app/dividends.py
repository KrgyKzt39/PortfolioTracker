"""Dividend events, eligibility, reconciliation and income summaries.

Expected dividends are never turned into income automatically: income only comes from
DIVIDEND/DRIP transactions, created by the user (directly or via reconciliation).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .fx import FxTable
from .ledger import ZERO, quantity_at
from .models import Account, DividendEvent, Instrument, Transaction
from .services import audit, row_dict
from .transactions import ValidationError, create_txn, instrument_currencies
from .valuation import build_portfolio


def _wht(ev: DividendEvent) -> Decimal:
    if ev.withholding_tax_rate is not None:
        return Decimal(ev.withholding_tax_rate)
    return Decimal(ev.instrument.withholding_tax_rate or 0)


def event_detail(db: Session, ev: DividendEvent, txns=None, inst_ccy=None, accounts=None) -> dict:
    txns = txns if txns is not None else list(db.scalars(select(Transaction)))
    inst_ccy = inst_ccy or instrument_currencies(db)
    accounts = accounts or {a.id: a.name for a in db.scalars(select(Account))}
    # Eligible = held at the close of the day before the ex-date.
    held = quantity_at(txns, inst_ccy, ev.instrument_id, ev.ex_date - timedelta(days=1))
    wht = _wht(ev)
    dps = Decimal(ev.amount_per_share)
    linked = [t for t in txns if t.dividend_event_id == ev.id]
    per_account = []
    for acct_id, qty in sorted(held.items()):
        gross = qty * dps
        tax = gross * wht
        rec = [t for t in linked if t.account_id == acct_id]
        received_net = sum((Decimal(t.amount) - Decimal(t.tax) for t in rec), ZERO) if rec else None
        per_account.append({
            "account_id": acct_id,
            "account_name": accounts.get(acct_id),
            "eligible_shares": qty,
            "expected_gross": gross,
            "expected_tax": tax,
            "expected_net": gross - tax,
            "received_net": received_net,
            "transaction_ids": [t.id for t in rec],
            "difference": (received_net - (gross - tax)) if received_net is not None else None,
        })
    d = row_dict(ev)
    d["symbol"] = ev.instrument.symbol
    d["withholding_rate_effective"] = wht
    d["eligible_shares"] = sum((p["eligible_shares"] for p in per_account), ZERO)
    d["expected_gross"] = sum((p["expected_gross"] for p in per_account), ZERO)
    d["expected_net"] = sum((p["expected_net"] for p in per_account), ZERO)
    d["received_net"] = sum((Decimal(t.amount) - Decimal(t.tax) for t in linked), ZERO) if linked else None
    d["accounts"] = per_account
    today = date.today()
    suggested = ev.status
    if ev.status in ("forecast", "announced") and ev.ex_date <= today:
        suggested = "pending"
    d["suggested_status"] = suggested
    d["reconciled"] = bool(per_account) and all(p["transaction_ids"] for p in per_account)
    return d


def list_events(db: Session, status=None, instrument_id=None, account_id=None) -> list[dict]:
    q = select(DividendEvent).order_by(DividendEvent.ex_date.desc())
    if status:
        q = q.where(DividendEvent.status == status)
    if instrument_id:
        q = q.where(DividendEvent.instrument_id == instrument_id)
    txns = list(db.scalars(select(Transaction)))
    inst_ccy = instrument_currencies(db)
    accounts = {a.id: a.name for a in db.scalars(select(Account))}
    out = [event_detail(db, ev, txns, inst_ccy, accounts) for ev in db.scalars(q)]
    if account_id:
        out = [e for e in out if any(p["account_id"] == account_id for p in e["accounts"])]
    return out


def save_event(db: Session, data: dict, ev: DividendEvent | None = None) -> DividendEvent:
    inst = db.get(Instrument, data.get("instrument_id") or (ev.instrument_id if ev else None))
    if inst is None:
        raise ValidationError("instrument is required", "instrument_id")
    try:
        dps = Decimal(str(data.get("amount_per_share", ev.amount_per_share if ev else "")))
    except Exception as exc:
        raise ValidationError("amount per share must be a number", "amount_per_share") from exc
    if dps <= 0:
        raise ValidationError("amount per share must be positive", "amount_per_share")
    status = data.get("status", ev.status if ev else "announced")
    if status not in ("forecast", "announced", "pending", "received"):
        raise ValidationError("invalid status", "status")
    ex = data.get("ex_date", ev.ex_date if ev else None)
    ex = date.fromisoformat(ex) if isinstance(ex, str) else ex
    if not ex:
        raise ValidationError("ex-date is required", "ex_date")
    pay = data.get("pay_date", ev.pay_date if ev else None)
    pay = date.fromisoformat(pay) if isinstance(pay, str) and pay else (pay or None)
    if pay and pay < ex:
        raise ValidationError("payment date cannot be before ex-date", "pay_date")
    wht = data.get("withholding_tax_rate", ev.withholding_tax_rate if ev else None)
    wht = Decimal(str(wht)) if wht not in (None, "") else None
    if wht is not None and not (0 <= wht < 1):
        raise ValidationError("withholding rate must be between 0 and 1 (e.g. 0.3 for 30%)", "withholding_tax_rate")
    dup = db.scalar(select(DividendEvent).where(DividendEvent.instrument_id == inst.id, DividendEvent.ex_date == ex))
    if dup and (ev is None or dup.id != ev.id):
        raise ValidationError(f"{inst.symbol} already has a dividend event with ex-date {ex}", "ex_date")
    if status == "received" and (ev is None or not any(True for _ in db.scalars(
            select(Transaction.id).where(Transaction.dividend_event_id == ev.id)))):
        raise ValidationError("Use Reconcile to mark an event received, so the income is recorded", "status")
    before = row_dict(ev) if ev else None
    if ev is None:
        ev = DividendEvent(instrument_id=inst.id)
        db.add(ev)
    ev.instrument_id = inst.id
    ev.ex_date, ev.pay_date, ev.amount_per_share = ex, pay, dps
    ev.currency = (data.get("currency") or inst.currency).upper()
    ev.status, ev.withholding_tax_rate, ev.note = status, wht, data.get("note", ev.note)
    db.flush()
    audit(db, "dividend_event", ev.id, "update" if before else "create", before=before, after=ev)
    return ev


def reconcile(db: Session, ev: DividendEvent, entries: list[dict]) -> list[Transaction]:
    """Record actual received dividends for an event (one DIVIDEND transaction per account)."""
    if not entries:
        raise ValidationError("Enter at least one received amount")
    created = []
    for e in entries:
        existing = db.scalar(select(Transaction).where(
            Transaction.dividend_event_id == ev.id, Transaction.account_id == e["account_id"]))
        if existing:
            raise ValidationError(f"Account #{e['account_id']} already reconciled (transaction #{existing.id})")
        t = create_txn(db, {
            "type": "DIVIDEND",
            "trade_date": e.get("pay_date") or (ev.pay_date.isoformat() if ev.pay_date else date.today().isoformat()),
            "account_id": e["account_id"],
            "instrument_id": ev.instrument_id,
            "amount": e["gross"],
            "tax": e.get("tax") or 0,
            "currency": ev.currency,
            "fx_rate": e.get("fx_rate"),
            "fx_currency": e.get("fx_currency"),
            "dividend_event_id": ev.id,
            "note": e.get("note") or f"Reconciled dividend event #{ev.id}",
        }, allow_duplicate=True, source="reconcile")
        created.append(t)
    before = row_dict(ev)
    ev.status = "received"
    audit(db, "dividend_event", ev.id, "reconcile", before=before, after=ev)
    return created


def _month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def summary(db: Session, base: str | None = None, today: date | None = None) -> dict:
    today = today or date.today()
    pf = build_portfolio(db, base, today)
    base = pf["base_currency"]
    fx = FxTable.load(db)
    instruments = {i.id: i for i in db.scalars(select(Instrument))}
    accounts = {a.id: a.name for a in db.scalars(select(Account))}
    txns = [t for t in db.scalars(select(Transaction)) if t.type in ("DIVIDEND", "DRIP")]

    def conv(amount, ccy, on):
        """Historical FX on the payment date when stored, otherwise latest (flagged)."""
        v = fx.convert(amount, ccy, base, on)
        if v is not None:
            return v, False
        v = fx.convert(amount, ccy, base)
        return v, True

    start12 = today - timedelta(days=365)
    months_back = []
    y, m = today.year, today.month
    for _ in range(12):
        months_back.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months_back.reverse()
    months_fwd = []
    y, m = today.year, today.month
    for _ in range(12):
        m += 1
        if m == 13:
            y, m = y + 1, 1
        months_fwd.append(f"{y:04d}-{m:02d}")

    received_by_month = defaultdict(lambda: ZERO)
    by_year = defaultdict(lambda: ZERO)
    by_holding = defaultdict(lambda: {"t12m_net": ZERO, "lifetime_net": ZERO})
    by_account = defaultdict(lambda: ZERO)
    by_ccy_t12m = defaultdict(lambda: ZERO)
    t12m_net = ZERO
    t12m_gross = ZERO
    t12m_tax = ZERO
    fx_fallback = False
    unconverted = []
    for t in txns:
        net_native = Decimal(t.amount) - Decimal(t.tax)
        net, fell_back = conv(net_native, t.currency, t.trade_date)
        gross, _ = conv(Decimal(t.amount), t.currency, t.trade_date)
        if net is None:
            unconverted.append(t.id)
            continue
        fx_fallback |= fell_back
        sym = instruments[t.instrument_id].symbol
        by_year[str(t.trade_date.year)] += net
        by_holding[sym]["lifetime_net"] += net
        if start12 < t.trade_date <= today:
            t12m_net += net
            t12m_gross += gross
            t12m_tax += gross - net
            received_by_month[_month_key(t.trade_date)] += net
            by_holding[sym]["t12m_net"] += net
            by_account[accounts.get(t.account_id, "?")] += net
            by_ccy_t12m[t.currency] += net_native

    # Forecast: announced/forecast/pending events not yet received, using current eligible holdings
    # for future ex-dates and actual eligibility for past ex-dates.
    forecast_by_month = defaultdict(lambda: ZERO)
    upcoming = []
    for ev in list_events(db):
        if ev["status"] == "received":
            continue
        pay = ev["pay_date"] or ev["ex_date"]
        pay_d = date.fromisoformat(pay) if isinstance(pay, str) else pay
        if ev["ex_date"] and date.fromisoformat(ev["ex_date"]) > today:
            # Future ex-date: assume current holdings (an estimate, labelled as such).
            qty = sum((h["quantity"] for a in pf["accounts"] for h in a["holdings"]
                       if h["instrument_id"] == ev["instrument_id"]), ZERO)
            gross = qty * Decimal(ev["amount_per_share"])
            net_native = gross * (1 - Decimal(ev["withholding_rate_effective"]))
        else:
            net_native = ev["expected_net"]
        net, _ = conv(net_native, ev["currency"], today)
        if net is None:
            continue
        if _month_key(pay_d) in months_fwd or _month_key(pay_d) == _month_key(today):
            forecast_by_month[_month_key(pay_d)] += net
        if pay_d >= today - timedelta(days=60):
            upcoming.append({**ev, "expected_net_base": net, "date_for_calendar": pay_d.isoformat()})

    forward = pf["totals"]["est_annual_dividend"]
    monthly_avg = forward / 12 if forward else ZERO
    chart = [{"month": mk, "received": received_by_month.get(mk, ZERO), "forecast": forecast_by_month.get(mk, ZERO),
              "run_rate": monthly_avg, "period": "past" if mk <= _month_key(today) else "future"}
             for mk in months_back + months_fwd]

    holdings = []
    for a in pf["accounts"]:
        for h in a["holdings"]:
            holdings.append({
                "account": a["name"], "symbol": h["symbol"], "currency": h["currency"],
                "est_annual_net_base": (h["est_annual_dividend_net"] * h["fx_rate"])
                if (h["est_annual_dividend_net"] is not None and h["fx_rate"] is not None) else None,
                "est_annual_gross": h["est_annual_dividend"],
                "dps": h["dps"], "dps_source": h["dps_source"],
                "dividend_yield": h["dividend_yield"], "yield_on_cost": h["yield_on_cost"],
                "withholding_tax_rate": h["withholding_tax_rate"],
                "t12m_net_base": by_holding.get(h["symbol"], {}).get("t12m_net", ZERO),
            })
    total_fwd = sum((h["est_annual_net_base"] for h in holdings if h["est_annual_net_base"]), ZERO)
    for h in holdings:
        h["share_pct"] = (h["est_annual_net_base"] / total_fwd * 100) if (total_fwd and h["est_annual_net_base"]) else None

    fwd_by_ccy = defaultdict(lambda: ZERO)
    for a in pf["accounts"]:
        for h in a["holdings"]:
            if h["est_annual_dividend_net"] is not None:
                fwd_by_ccy[h["currency"]] += h["est_annual_dividend_net"]
    fwd_by_account = {a["name"]: a["est_annual_dividend"] for a in pf["accounts"]}

    cost = pf["totals"]["cost"]
    return {
        "base_currency": base,
        "forward_annual_estimate": forward,
        "forward_annual_estimate_gross": pf["totals"]["est_annual_dividend_gross"],
        "monthly_average_projected": monthly_avg,
        "t12m_net": t12m_net,
        "t12m_gross": t12m_gross,
        "t12m_tax": t12m_tax,
        "portfolio_yield": pf["totals"]["dividend_yield"],
        "yield_on_cost": (forward / cost * 100) if cost else None,
        "chart": chart,
        "holdings": sorted(holdings, key=lambda h: -(h["est_annual_net_base"] or 0)),
        "by_account": [{"account": k, "t12m_net": by_account.get(k, ZERO), "forward_net": fwd_by_account.get(k, ZERO)}
                       for k in fwd_by_account],
        "by_currency": [{"currency": c, "t12m_net": by_ccy_t12m.get(c, ZERO), "forward_net": fwd_by_ccy.get(c, ZERO)}
                        for c in sorted(set(by_ccy_t12m) | set(fwd_by_ccy))],
        "by_year": [{"year": y, "net": v} for y, v in sorted(by_year.items())],
        "upcoming": sorted(upcoming, key=lambda e: e["date_for_calendar"]),
        "notes": {
            "estimates": "Forward figures are estimates from manual forward DPS or trailing dividends; not guaranteed.",
            "fx_fallback": fx_fallback,
            "unconverted_transactions": unconverted,
        },
    }
