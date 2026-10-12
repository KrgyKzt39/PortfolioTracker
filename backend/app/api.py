"""HTTP API. Money values are returned as decimal strings."""
from __future__ import annotations

import json
import shutil
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import ai, backup, config, dividends
from .db import get_session
from .holdings import NO_BROKER, ValidationError, delete_holding, export_csv, process_import, save_holding, to_decimal
from .jsonutil import DecimalJSONResponse, DecimalRoute
from .market import service as market
from .models import (CURRENCIES, AuditLog, Broker, Category, DividendEvent, DividendPayment, EarningsDate, FxRate,
                     Holding, Instrument, PriceHistory, ValuationSnapshot, utcnow)
from .services import audit, get_settings, row_dict, set_settings
from .valuation import build_portfolio

router = APIRouter(prefix="/api", default_response_class=DecimalJSONResponse, route_class=DecimalRoute)
DB = Depends(get_session)


def fail(exc: Exception, status=422):
    raise HTTPException(status, {"message": str(exc), "field": getattr(exc, "field", None)})


def found(obj, what="Not found"):
    if obj is None:
        raise HTTPException(404, {"message": what, "field": None})
    return obj


def write(db: Session, fn):
    """Run a write; commit on success, roll back and return 422 on validation errors."""
    try:
        out = fn()
        db.commit()
        return out
    except IntegrityError:
        db.rollback()
        fail(ValidationError("That conflicts with existing data"))
    except (ValidationError, ValueError) as exc:
        db.rollback()
        fail(exc)


# ---------------------------------------------------------------- meta / settings
@router.get("/health")
def health(db: Session = DB):
    db.execute(select(1))
    return {"ok": True}


@router.get("/meta")
def meta():
    from .netinfo import lan_addresses, tailscale_addresses
    from .currencies import ALL
    return {"currencies": [{"code": c, "name": n, "symbol": s} for c, (n, s) in ALL.items()], "demo": config.DEMO, "db_path": config.DB_PATH.name,
            "lan_urls": [f"http://{ip}:{config.PORT}" for ip in lan_addresses()] if config.HOST in ("0.0.0.0", "") else [],
            "tailscale_urls": [f"http://{h}:{config.PORT}" for h in tailscale_addresses()] if config.HOST in ("0.0.0.0", "") else [],
            "alphavantage_configured": bool(config.ALPHAVANTAGE_API_KEY),
            "alpaca_configured": config.alpaca_configured(), "longbridge_configured": config.longbridge_configured(),
            "ai_providers": ai.available()}


@router.get("/settings")
def read_settings(db: Session = DB):
    return get_settings(db)


@router.put("/settings")
def write_settings(body: dict, db: Session = DB):
    def go():
        if "base_currency" in body and body["base_currency"] not in CURRENCIES:
            raise ValidationError("unsupported base currency", "base_currency")
        for k in ("refresh_interval_minutes", "stale_after_minutes"):
            if k in body:
                body[k] = int(body[k])
                if body[k] < 5:
                    raise ValidationError(f"{k} must be at least 5", k)
        return set_settings(db, body)
    out = write(db, go)
    from .scheduler import reschedule
    reschedule()
    return out


# ---------------------------------------------------------------- portfolio & layout
@router.get("/portfolio")
def portfolio(base: str | None = None, db: Session = DB):
    if base and base not in CURRENCIES:
        fail(ValidationError("unsupported base currency", "base"))
    pf = build_portfolio(db, base)
    pf["refresh"] = market.STATE.snapshot()
    if base is None or base == get_settings(db)["base_currency"]:
        from .snapshots import write_snapshot
        try:
            write_snapshot(db, pf=pf)
            db.commit()
        except Exception:  # history is a nice-to-have; never fail the main view over it
            db.rollback()
    return pf


@router.put("/layout")
def save_layout(body: dict, db: Session = DB):
    """Result of drag and drop: {categories: [{id: category id or null, instrument_ids: [...]}, ...]}."""
    def go():
        cats = {c.id: c for c in db.scalars(select(Category))}
        for pos, group in enumerate(body.get("categories") or []):
            cid = group.get("id")
            if cid is not None:
                if cid not in cats:
                    raise ValidationError("unknown category")
                cats[cid].sort_order = pos
            for order, iid in enumerate(group.get("instrument_ids") or []):
                inst = db.get(Instrument, iid)
                if inst is None:
                    raise ValidationError("unknown stock")
                inst.category_id, inst.sort_order = cid, order
        audit(db, "layout", None, "update", after={"categories": body.get("categories")})
        return {"ok": True}
    return write(db, go)


# ---------------------------------------------------------------- categories & brokers
def _name(db, model, body, obj=None, limit=60):
    name = (body.get("name", obj.name if obj else "") or "").strip()
    if not name:
        raise ValidationError("name is required", "name")
    if len(name) > limit:
        raise ValidationError("name is too long", "name")
    clash = db.scalar(select(model).where(model.name == name))
    if clash and (obj is None or clash.id != obj.id):
        raise ValidationError("that name is already used", "name")
    return name


@router.get("/categories")
def list_categories(db: Session = DB):
    return [row_dict(c) for c in db.scalars(select(Category).order_by(Category.sort_order, Category.id))]


@router.post("/categories", status_code=201)
def create_category(body: dict, db: Session = DB):
    def go():
        last = max((c.sort_order for c in db.scalars(select(Category))), default=-1)
        c = Category(name=_name(db, Category, body), show_dividends=bool(body.get("show_dividends")), sort_order=last + 1)
        db.add(c)
        db.flush()
        audit(db, "category", c.id, "create", after=c)
        return row_dict(c)
    return write(db, go)


@router.put("/categories/{cid}")
def update_category(cid: int, body: dict, db: Session = DB):
    c = found(db.get(Category, cid))

    def go():
        before = row_dict(c)
        c.name = _name(db, Category, body, c)
        if "show_dividends" in body:
            c.show_dividends = bool(body["show_dividends"])
        audit(db, "category", c.id, "update", before=before, after=c)
        return row_dict(c)
    return write(db, go)


@router.delete("/categories/{cid}")
def delete_category(cid: int, db: Session = DB):
    c = found(db.get(Category, cid))

    def go():
        for inst in db.scalars(select(Instrument).where(Instrument.category_id == cid)):
            inst.category_id = None  # its stocks move to Uncategorised; nothing else is deleted
        audit(db, "category", c.id, "delete", before=c)
        db.delete(c)
        return {"ok": True}
    return write(db, go)


@router.get("/brokers")
def list_brokers(db: Session = DB):
    counts: dict[int, int] = {}
    for h in db.scalars(select(Holding)):
        counts[h.broker_id] = counts.get(h.broker_id, 0) + 1
    return [{**row_dict(b), "holdings": counts.get(b.id, 0)}
            for b in db.scalars(select(Broker).order_by(Broker.sort_order, Broker.name))]


@router.post("/brokers", status_code=201)
def create_broker(body: dict, db: Session = DB):
    def go():
        b = Broker(name=_name(db, Broker, body, limit=80), notes=body.get("notes"))
        db.add(b)
        db.flush()
        audit(db, "broker", b.id, "create", after=b)
        return row_dict(b)
    return write(db, go)


@router.put("/brokers/{bid}")
def update_broker(bid: int, body: dict, db: Session = DB):
    b = found(db.get(Broker, bid))
    if b.name == NO_BROKER:
        fail(ValidationError("This is where untagged holdings live; it can't be renamed."))

    def go():
        before = row_dict(b)
        b.name = _name(db, Broker, body, b, limit=80)
        b.notes = body.get("notes", b.notes)
        audit(db, "broker", b.id, "update", before=before, after=b)
        return row_dict(b)
    return write(db, go)


@router.delete("/brokers/{bid}")
def delete_broker(bid: int, db: Session = DB):
    b = found(db.get(Broker, bid))
    if db.scalar(select(Holding.id).where(Holding.broker_id == bid).limit(1)):
        fail(ValidationError("This broker still has holdings. Remove them first."), 409)

    def go():
        audit(db, "broker", b.id, "delete", before=b)
        db.delete(b)
        return {"ok": True}
    return write(db, go)


# ---------------------------------------------------------------- instruments & holdings
def _instrument_fields(db, body: dict, inst: Instrument) -> dict:
    def g(k):
        return body.get(k, getattr(inst, k))
    if g("kind") not in ("stock", "etf", "reit", "fund", "other"):
        raise ValidationError("invalid type", "kind")
    if g("price_mode") not in ("auto", "manual"):
        raise ValidationError("pricing must be auto or manual", "price_mode")
    wht = to_decimal(g("withholding_tax_rate"), "withholding_tax_rate") or Decimal(0)
    if wht >= 1:
        raise ValidationError("withholding rate must be below 1 (0.3 = 30%)", "withholding_tax_rate")
    cat = g("category_id")
    if cat and db.get(Category, cat) is None:
        raise ValidationError("unknown category", "category_id")
    freq = g("dividend_frequency")
    return {"name": g("name") or None, "kind": g("kind"), "price_mode": g("price_mode"),
            "provider_symbol": g("provider_symbol") or None,
            "annual_dividend_per_share": to_decimal(g("annual_dividend_per_share"), "annual_dividend_per_share"),
            "dividend_frequency": int(freq) if freq not in (None, "") else None, "withholding_tax_rate": wht,
            "category_id": cat or None, "notes": g("notes")}


@router.get("/instruments")
def list_instruments(db: Session = DB):
    return [row_dict(i) for i in db.scalars(select(Instrument).order_by(Instrument.symbol))]


@router.put("/instruments/{iid}")
def update_instrument(iid: int, body: dict, db: Session = DB):
    i = found(db.get(Instrument, iid))

    def go():
        before = row_dict(i)
        for k, v in _instrument_fields(db, body, i).items():
            setattr(i, k, v)
        audit(db, "instrument", i.id, "update", before=before, after=i)
        return row_dict(i)
    return write(db, go)


@router.get("/holdings")
def list_holdings(db: Session = DB):
    return [{**row_dict(h), "broker": h.broker.name, "symbol": h.instrument.symbol, "kind": h.instrument.kind,
             "currency": h.instrument.currency} for h in db.scalars(select(Holding))]


@router.post("/holdings", status_code=201)
def create_holding(body: dict, db: Session = DB):
    return write(db, lambda: row_dict(save_holding(db, body)))


@router.put("/holdings/{hid}")
def update_holding(hid: int, body: dict, db: Session = DB):
    h = found(db.get(Holding, hid))
    return write(db, lambda: row_dict(save_holding(db, body, h)))


@router.delete("/holdings/{hid}")
def remove_holding(hid: int, db: Session = DB):
    h = found(db.get(Holding, hid))

    def go():
        delete_holding(db, h)
        return {"ok": True}
    return write(db, go)


@router.get("/holdings/export.csv")
def holdings_csv(db: Session = DB):
    return Response(export_csv(db), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="holdings-{date.today()}.csv"'})


@router.post("/import/{mode}")
async def import_holdings(mode: str, file: UploadFile = File(...), broker_id: int | None = Form(None),
                          mapping: str | None = Form(None), replace: bool = Form(True), db: Session = DB):
    if mode not in ("preview", "commit"):
        raise HTTPException(404)
    content = await file.read()
    if len(content) > 5_000_000:
        fail(ValidationError("File is larger than 5 MB"))
    try:
        result = process_import(db, content, file.filename or "upload.csv", broker_id,
                                json.loads(mapping) if mapping else None, "replace" if replace else "merge",
                                commit=(mode == "commit"))
        if mode == "commit":
            db.commit()
        else:
            db.rollback()  # preview never writes
    except (ValidationError, json.JSONDecodeError) as exc:
        db.rollback()
        fail(exc)
    return result


# ---------------------------------------------------------------- prices & fx
@router.get("/prices/{iid}")
def price_history(iid: int, db: Session = DB):
    rows = db.scalars(select(PriceHistory).where(PriceHistory.instrument_id == iid)
                      .order_by(PriceHistory.price_date.desc(), PriceHistory.fetched_at.desc()).limit(60))
    return [row_dict(r) for r in rows]


@router.post("/prices", status_code=201)
def manual_price(body: dict, db: Session = DB):
    inst = found(db.get(Instrument, body.get("instrument_id")), "unknown stock")

    def go():
        on = date.fromisoformat(body.get("date") or date.today().isoformat())
        if on > date.today():
            raise ValidationError("date cannot be in the future", "date")
        price = to_decimal(body.get("price"), "price", positive=True)
        if price is None:
            raise ValidationError("price is required", "price")
        row = market.save_manual_price(db, inst, price, on)
        db.flush()
        audit(db, "price", row.id, "manual", after=row)
        return row_dict(row)
    return write(db, go)


@router.delete("/prices/{pid}")
def delete_price(pid: int, db: Session = DB):
    p = found(db.get(PriceHistory, pid))

    def go():
        audit(db, "price", p.id, "delete", before=p)
        db.delete(p)
        return {"ok": True}
    return write(db, go)


@router.get("/fx")
def fx_rates(db: Session = DB):
    rows = db.scalars(select(FxRate).order_by(FxRate.rate_date.desc(), FxRate.fetched_at.desc()).limit(200))
    return [row_dict(r) for r in rows]


@router.post("/fx", status_code=201)
def manual_fx(body: dict, db: Session = DB):
    def go():
        base, quote = (body.get("base") or "").upper(), (body.get("quote") or "").upper()
        if base not in CURRENCIES or quote not in CURRENCIES or base == quote:  # noqa: SIM102
            raise ValidationError("choose two different supported currencies", "base")
        rate = to_decimal(body.get("rate"), "rate", positive=True)
        if rate is None:
            raise ValidationError("rate is required", "rate")
        on = date.fromisoformat(body.get("date") or date.today().isoformat())
        row = db.scalar(select(FxRate).where(FxRate.base == base, FxRate.quote == quote, FxRate.rate_date == on,
                                             FxRate.source == "manual"))
        if row is None:
            row = FxRate(base=base, quote=quote, rate=rate, rate_date=on, source="manual")
            db.add(row)
        else:
            row.rate, row.fetched_at = rate, utcnow()
        db.flush()
        audit(db, "fx", row.id, "manual", after=row)
        return row_dict(row)
    return write(db, go)


@router.post("/refresh", status_code=202)
def refresh():
    return {"started": market.start_refresh(), **market.STATE.snapshot()}


@router.get("/refresh")
def refresh_status():
    return market.STATE.snapshot()


# ---------------------------------------------------------------- dividends & calendar
@router.get("/dividends/summary")
def div_summary(base: str | None = None, db: Session = DB):
    return dividends.summary(db, base)


@router.get("/dividends/events")
def div_events(instrument_id: int | None = None, db: Session = DB):
    return dividends.list_events(db, instrument_id)


@router.post("/dividends/events", status_code=201)
def create_div_event(body: dict, db: Session = DB):
    return write(db, lambda: row_dict(dividends.save_event(db, body)))


@router.put("/dividends/events/{eid}")
def update_div_event(eid: int, body: dict, db: Session = DB):
    ev = found(db.get(DividendEvent, eid))
    return write(db, lambda: row_dict(dividends.save_event(db, body, ev)))


@router.delete("/dividends/events/{eid}")
def delete_div_event(eid: int, db: Session = DB):
    ev = found(db.get(DividendEvent, eid))

    def go():
        audit(db, "dividend_event", ev.id, "delete", before=ev)
        db.delete(ev)  # received payments are kept; only their link is cleared
        return {"ok": True}
    return write(db, go)


@router.post("/dividends/events/{eid}/received", status_code=201)
def confirm_received(eid: int, body: dict, db: Session = DB):
    ev = found(db.get(DividendEvent, eid))
    return write(db, lambda: dividends.payment_out(dividends.record_payment(db, body, ev)))


@router.post("/dividends/payments", status_code=201)
def add_payment(body: dict, db: Session = DB):
    return write(db, lambda: dividends.payment_out(dividends.record_payment(db, body)))


@router.delete("/dividends/payments/{pid}")
def remove_payment(pid: int, db: Session = DB):
    p = found(db.get(DividendPayment, pid))

    def go():
        dividends.delete_payment(db, p)
        return {"ok": True}
    return write(db, go)


@router.get("/calendar")
def get_calendar(days: int = Query(120, le=365), db: Session = DB):
    return dividends.calendar(db, days)


@router.post("/earnings", status_code=201)
def add_earnings(body: dict, db: Session = DB):
    return write(db, lambda: row_dict(dividends.save_earnings(db, body)))


@router.delete("/earnings/{eid}")
def remove_earnings(eid: int, db: Session = DB):
    er = found(db.get(EarningsDate, eid))

    def go():
        db.delete(er)
        return {"ok": True}
    return write(db, go)


# ---------------------------------------------------------------- AI (optional)
@router.get("/ai/status")
def ai_status():
    return {"providers": ai.available()}


@router.post("/ai/statement")
async def ai_statement(file: list[UploadFile] = File(...)):
    """Read holdings from a statement PDF or broker-app screenshots. Returns rows for the normal import preview."""
    files = [(await f.read(), f.filename or "upload") for f in file]
    try:
        out = ai.extract_statement(files)
    except ai.AIError as exc:
        fail(ValidationError(str(exc)))
    return out


@router.post("/ai/ask")
def ai_ask(body: dict, db: Session = DB):
    pf = build_portfolio(db)
    div = dividends.summary(db)
    try:
        return ai.ask(pf, div, body.get("messages") or [])
    except ai.AIError as exc:
        fail(ValidationError(str(exc)))


# ---------------------------------------------------------------- audit, snapshots, backups
@router.get("/snapshots")
def snapshots(base: str | None = None, db: Session = DB):
    base = base or get_settings(db)["base_currency"]
    rows = db.scalars(select(ValuationSnapshot).where(ValuationSnapshot.base_currency == base)
                      .order_by(ValuationSnapshot.snapshot_date))
    return [{"date": r.snapshot_date, "base_currency": r.base_currency, "value": r.total_value, "pl": r.total_pl}
            for r in rows]


@router.get("/audit")
def audit_log(limit: int = Query(100, le=1000), db: Session = DB):
    return [row_dict(a) for a in db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))]


@router.get("/backups")
def backups():
    return backup.list_backups()


@router.post("/backups", status_code=201)
def make_backup():
    p = backup.create_backup("manual")
    return {"name": p.name, **backup.check_file(p)}


def _backup_path(name: str) -> Path:
    p = (config.BACKUP_DIR / name).resolve()
    if p.parent != config.BACKUP_DIR.resolve() or not p.exists() or p.suffix != ".db":
        raise HTTPException(404, {"message": "backup not found"})
    return p


@router.get("/backups/{name}")
def download_backup(name: str):
    return FileResponse(_backup_path(name), media_type="application/octet-stream", filename=name)


@router.post("/backups/{name}/restore")
def restore_named(name: str):
    try:
        return backup.restore_from(_backup_path(name))
    except backup.BackupError as exc:
        fail(exc, 400)


@router.post("/restore")
async def restore_upload(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp:
        shutil.copyfileobj(file.file, tmp)
        path = Path(tmp.name)
    try:
        return backup.restore_from(path)
    except backup.BackupError as exc:
        fail(exc, 400)
    finally:
        path.unlink(missing_ok=True)
