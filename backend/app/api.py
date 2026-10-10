"""HTTP API. All money values are returned as decimal strings."""
from __future__ import annotations

import json
import shutil
import tempfile
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import backup, config, csv_io, dividends
from .db import get_session
from .fx import FxTable
from .jsonutil import DecimalJSONResponse, DecimalRoute
from .market import service as market
from .models import (
    CURRENCIES, DIVIDEND_STATUSES, TXN_TYPES, Account, AuditLog, DividendEvent, FxRate, Instrument,
    PriceHistory, Transaction, ValuationSnapshot, utcnow,
)
from .services import audit, get_settings, row_dict, set_settings
from .transactions import (
    DuplicateError, ValidationError, create_txn, delete_txn, txn_out, update_txn, validate_ledger,
)
from .valuation import build_portfolio

router = APIRouter(prefix="/api", default_response_class=DecimalJSONResponse, route_class=DecimalRoute)
DB = Depends(get_session)


def fail(exc: Exception, status=422):
    if isinstance(exc, DuplicateError):
        raise HTTPException(409, {"message": str(exc), "field": "duplicate", "duplicate_ids": exc.ids})
    field = getattr(exc, "field", None)
    raise HTTPException(status, {"message": str(exc), "field": field})


def dec(v, field, required=False, positive=False):
    if v in (None, ""):
        if required:
            raise ValidationError(f"{field} is required", field)
        return None
    try:
        d = Decimal(str(v))
    except InvalidOperation as exc:
        raise ValidationError(f"{field} must be a number", field) from exc
    if positive and d <= 0:
        raise ValidationError(f"{field} must be positive", field)
    return d


# ---------------------------------------------------------------- meta / settings
@router.get("/health")
def health(db: Session = DB):
    db.execute(select(1))
    return {"ok": True}


@router.get("/meta")
def meta():
    from .netinfo import lan_addresses
    return {"currencies": CURRENCIES, "transaction_types": TXN_TYPES, "dividend_statuses": DIVIDEND_STATUSES,
            "demo": config.DEMO, "db_path": str(config.DB_PATH.name), "lan_urls":
            [f"http://{ip}:{config.PORT}" for ip in lan_addresses()] if config.HOST in ("0.0.0.0", "") else [],
            "alphavantage_configured": bool(config.ALPHAVANTAGE_API_KEY),
            "alpaca_configured": config.alpaca_configured(), "longbridge_configured": config.longbridge_configured()}


@router.get("/settings")
def read_settings(db: Session = DB):
    return get_settings(db)


@router.put("/settings")
def write_settings(body: dict, db: Session = DB):
    try:
        if "base_currency" in body and body["base_currency"] not in CURRENCIES:
            raise ValidationError("unsupported base currency", "base_currency")
        for k in ("refresh_interval_minutes", "stale_after_minutes"):
            if k in body:
                body[k] = int(body[k])
                if body[k] < 5:
                    raise ValidationError(f"{k} must be at least 5", k)
        out = set_settings(db, body)
        db.commit()
    except ValueError as exc:
        db.rollback()
        fail(exc)
    from .scheduler import reschedule
    reschedule()
    return out


# ---------------------------------------------------------------- portfolio
@router.get("/portfolio")
def portfolio(base: str | None = None, db: Session = DB):
    if base and base not in CURRENCIES:
        fail(ValidationError("unsupported base currency", "base"))
    pf = build_portfolio(db, base)
    pf["refresh"] = market.STATE.snapshot()
    return pf


@router.get("/snapshots")
def snapshots(db: Session = DB):
    rows = db.scalars(select(ValuationSnapshot).order_by(ValuationSnapshot.snapshot_date))
    return [{"date": r.snapshot_date, "base_currency": r.base_currency, "value": r.total_value,
             "cost": r.total_cost, "pl": r.total_pl} for r in rows]


# ---------------------------------------------------------------- accounts
def _account_fields(db, body: dict, acct: Account | None = None) -> dict:
    name = (body.get("name", acct.name if acct else "") or "").strip()
    if not name:
        raise ValidationError("name is required", "name")
    layout = body.get("layout", acct.layout if acct else "growth")
    if layout not in ("dividend", "growth"):
        raise ValidationError("layout must be dividend or growth", "layout")
    ccy = (body.get("currency", acct.currency if acct else "MYR") or "").upper()
    if ccy not in CURRENCIES:
        raise ValidationError("unsupported currency", "currency")
    clash = db.scalar(select(Account).where(Account.name == name))
    if clash and (acct is None or clash.id != acct.id):
        raise ValidationError("an account with this name exists", "name")
    return {"name": name, "layout": layout, "currency": ccy,
            "broker": body.get("broker", acct.broker if acct else None),
            "track_cash": bool(body.get("track_cash", acct.track_cash if acct else False)),
            "sort_order": int(body.get("sort_order", acct.sort_order if acct else 0) or 0),
            "archived": bool(body.get("archived", acct.archived if acct else False)),
            "notes": body.get("notes", acct.notes if acct else None)}


@router.get("/accounts")
def list_accounts(db: Session = DB):
    return [row_dict(a) for a in db.scalars(select(Account).order_by(Account.sort_order, Account.id))]


@router.post("/accounts", status_code=201)
def create_account(body: dict, db: Session = DB):
    try:
        a = Account(**_account_fields(db, body))
        db.add(a)
        db.flush()
        audit(db, "account", a.id, "create", after=a)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return row_dict(a)


@router.put("/accounts/{acct_id}")
def update_account(acct_id: int, body: dict, db: Session = DB):
    a = db.get(Account, acct_id) or fail(ValidationError("not found"), 404)
    try:
        before = row_dict(a)
        for k, v in _account_fields(db, body, a).items():
            setattr(a, k, v)
        audit(db, "account", a.id, "update", before=before, after=a)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return row_dict(a)


@router.delete("/accounts/{acct_id}")
def delete_account(acct_id: int, db: Session = DB):
    a = db.get(Account, acct_id) or fail(ValidationError("not found"), 404)
    used = db.scalar(select(Transaction.id).where(or_(Transaction.account_id == acct_id,
                                                      Transaction.to_account_id == acct_id)).limit(1))
    if used:
        fail(ValidationError("Account has transactions. Delete them first or archive the account."), 409)
    audit(db, "account", a.id, "delete", before=a)
    db.delete(a)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- instruments
def _instrument_fields(db, body: dict, inst: Instrument | None = None) -> dict:
    g = lambda k, d=None: body.get(k, getattr(inst, k) if inst else d)  # noqa: E731
    sym = (g("symbol", "") or "").strip().upper()
    if not sym:
        raise ValidationError("symbol is required", "symbol")
    clash = db.scalar(select(Instrument).where(Instrument.symbol == sym))
    if clash and (inst is None or clash.id != inst.id):
        raise ValidationError("symbol already exists", "symbol")
    ccy = (g("currency") or csv_io.guess_currency(sym)).upper()
    if ccy not in CURRENCIES:
        raise ValidationError("unsupported currency", "currency")
    if inst and ccy != inst.currency and db.scalar(select(Transaction.id).where(Transaction.instrument_id == inst.id).limit(1)):
        raise ValidationError("cannot change currency of an instrument with transactions", "currency")
    kind = g("kind", "stock")
    if kind not in ("stock", "etf", "reit", "fund", "other"):
        raise ValidationError("invalid kind", "kind")
    mode = g("price_mode", "auto")
    if mode not in ("auto", "manual"):
        raise ValidationError("price_mode must be auto or manual", "price_mode")
    wht = dec(g("withholding_tax_rate", 0), "withholding_tax_rate") or Decimal(0)
    if not (0 <= wht < 1):
        raise ValidationError("withholding rate must be between 0 and 1 (0.3 = 30%)", "withholding_tax_rate")
    freq = g("dividend_frequency")
    return {"symbol": sym, "name": g("name"), "currency": ccy, "kind": kind, "price_mode": mode,
            "provider_symbol": (g("provider_symbol") or None),
            "annual_dividend_per_share": dec(g("annual_dividend_per_share"), "annual_dividend_per_share"),
            "dividend_frequency": int(freq) if freq not in (None, "") else None,
            "withholding_tax_rate": wht, "notes": g("notes")}


@router.get("/instruments")
def list_instruments(db: Session = DB):
    return [row_dict(i) for i in db.scalars(select(Instrument).order_by(Instrument.symbol))]


@router.post("/instruments", status_code=201)
def create_instrument(body: dict, db: Session = DB):
    try:
        i = Instrument(**_instrument_fields(db, body))
        db.add(i)
        db.flush()
        audit(db, "instrument", i.id, "create", after=i)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return row_dict(i)


@router.put("/instruments/{inst_id}")
def update_instrument(inst_id: int, body: dict, db: Session = DB):
    i = db.get(Instrument, inst_id) or fail(ValidationError("not found"), 404)
    try:
        before = row_dict(i)
        for k, v in _instrument_fields(db, body, i).items():
            setattr(i, k, v)
        audit(db, "instrument", i.id, "update", before=before, after=i)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return row_dict(i)


@router.delete("/instruments/{inst_id}")
def delete_instrument(inst_id: int, db: Session = DB):
    i = db.get(Instrument, inst_id) or fail(ValidationError("not found"), 404)
    if db.scalar(select(Transaction.id).where(Transaction.instrument_id == inst_id).limit(1)):
        fail(ValidationError("Instrument has transactions and cannot be deleted"), 409)
    audit(db, "instrument", i.id, "delete", before=i)
    db.delete(i)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- transactions
def _txn_query(account_id=None, instrument_id=None, type=None, q=None, start=None, end=None):
    stmt = select(Transaction)
    if account_id:
        stmt = stmt.where(or_(Transaction.account_id == account_id, Transaction.to_account_id == account_id))
    if instrument_id:
        stmt = stmt.where(Transaction.instrument_id == instrument_id)
    if type:
        stmt = stmt.where(Transaction.type.in_(type.upper().split(",")))
    if start:
        stmt = stmt.where(Transaction.trade_date >= start)
    if end:
        stmt = stmt.where(Transaction.trade_date <= end)
    if q:
        like = f"%{q}%"
        stmt = stmt.outerjoin(Instrument, Transaction.instrument_id == Instrument.id).where(
            or_(Instrument.symbol.ilike(like), Instrument.name.ilike(like), Transaction.note.ilike(like)))
    return stmt


@router.get("/transactions")
def list_transactions(account_id: int | None = None, instrument_id: int | None = None, type: str | None = None,
                      q: str | None = None, start: date | None = None, end: date | None = None,
                      limit: int = Query(200, le=2000), offset: int = 0, db: Session = DB):
    stmt = _txn_query(account_id, instrument_id, type, q, start, end)
    total = len(list(db.scalars(stmt.with_only_columns(Transaction.id))))
    rows = db.scalars(stmt.order_by(Transaction.trade_date.desc(), Transaction.id.desc()).limit(limit).offset(offset))
    return {"total": total, "items": [txn_out(t) for t in rows]}


@router.get("/transactions/export.csv")
def export_csv(account_id: int | None = None, instrument_id: int | None = None, type: str | None = None,
               q: str | None = None, start: date | None = None, end: date | None = None, db: Session = DB):
    stmt = _txn_query(account_id, instrument_id, type, q, start, end).order_by(Transaction.trade_date, Transaction.id)
    body = csv_io.export(db, list(db.scalars(stmt)))
    return Response(body, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="transactions-{date.today()}.csv"'})


@router.get("/transactions/{txn_id}")
def get_transaction(txn_id: int, db: Session = DB):
    t = db.get(Transaction, txn_id) or fail(ValidationError("not found"), 404)
    hist = db.scalars(select(AuditLog).where(AuditLog.entity == "transaction", AuditLog.entity_id == txn_id)
                      .order_by(AuditLog.ts))
    return {**txn_out(t), "history": [row_dict(h) for h in hist]}


@router.post("/transactions", status_code=201)
def post_transaction(body: dict, allow_duplicate: bool = False, db: Session = DB):
    try:
        t = create_txn(db, body, allow_duplicate=allow_duplicate)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return txn_out(t)


@router.put("/transactions/{txn_id}")
def put_transaction(txn_id: int, body: dict, allow_duplicate: bool = False, db: Session = DB):
    t = db.get(Transaction, txn_id) or fail(ValidationError("not found"), 404)
    try:
        update_txn(db, t, body, allow_duplicate=allow_duplicate)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return txn_out(t)


@router.delete("/transactions/{txn_id}")
def remove_transaction(txn_id: int, db: Session = DB):
    t = db.get(Transaction, txn_id) or fail(ValidationError("not found"), 404)
    try:
        delete_txn(db, t)
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(ValidationError(f"Cannot delete: later history depends on it. {exc}"), 409)
    return {"ok": True}


@router.post("/import/{mode}")
async def import_csv(mode: str, file: UploadFile = File(...), mapping: str | None = Form(None),
                     date_format: str = Form("iso"), create_missing: bool = Form(False),
                     skip_duplicates: bool = Form(True), db: Session = DB):
    if mode not in ("preview", "commit"):
        raise HTTPException(404)
    content = await file.read()
    if len(content) > 5_000_000:
        fail(ValidationError("CSV larger than 5 MB"))
    try:
        result = csv_io.process(db, content, json.loads(mapping) if mapping else None, date_format,
                                create_missing, skip_duplicates, commit=(mode == "commit"))
        if mode == "commit":
            db.commit()
        else:
            db.rollback()
    except (ValidationError, json.JSONDecodeError) as exc:
        db.rollback()
        fail(exc)
    return result


# ---------------------------------------------------------------- prices & fx
@router.get("/prices/{inst_id}")
def price_history(inst_id: int, db: Session = DB):
    rows = db.scalars(select(PriceHistory).where(PriceHistory.instrument_id == inst_id)
                      .order_by(PriceHistory.price_date.desc(), PriceHistory.fetched_at.desc()).limit(100))
    return [row_dict(r) for r in rows]


@router.post("/prices", status_code=201)
def manual_price(body: dict, db: Session = DB):
    inst = db.get(Instrument, body.get("instrument_id")) or fail(ValidationError("unknown instrument", "instrument_id"))
    try:
        on = date.fromisoformat(body.get("date") or date.today().isoformat())
        row = market.save_manual_price(db, inst, dec(body.get("price"), "price", required=True), on,
                                       body.get("currency"))
        db.flush()
        audit(db, "price", row.id, "manual", after=row)
        db.commit()
    except ValueError as exc:
        db.rollback()
        fail(exc)
    return row_dict(row)


@router.delete("/prices/{price_id}")
def delete_price(price_id: int, db: Session = DB):
    p = db.get(PriceHistory, price_id) or fail(ValidationError("not found"), 404)
    audit(db, "price", p.id, "delete", before=p)
    db.delete(p)
    db.commit()
    return {"ok": True}


@router.get("/fx")
def fx_rates(db: Session = DB):
    rows = db.scalars(select(FxRate).order_by(FxRate.rate_date.desc(), FxRate.fetched_at.desc()).limit(200))
    return [row_dict(r) for r in rows]


@router.post("/fx", status_code=201)
def manual_fx(body: dict, db: Session = DB):
    try:
        base, quote = (body.get("base") or "").upper(), (body.get("quote") or "").upper()
        if base not in CURRENCIES or quote not in CURRENCIES or base == quote:
            raise ValidationError("choose two different supported currencies", "base")
        rate = dec(body.get("rate"), "rate", required=True, positive=True)
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
        db.commit()
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        fail(exc)
    return row_dict(row)


@router.get("/fx/convert")
def fx_convert(amount: str, base: str, quote: str, on: date | None = None, db: Session = DB):
    q = FxTable.load(db).quote(base.upper(), quote.upper(), on)
    if q is None:
        return {"rate": None, "result": None}
    return {"rate": q.rate, "result": Decimal(amount) * q.rate, "rate_date": q.rate_date, "source": q.source}


@router.post("/refresh", status_code=202)
def refresh():
    started = market.start_refresh()
    return {"started": started, **market.STATE.snapshot()}


@router.get("/refresh")
def refresh_status():
    return market.STATE.snapshot()


# ---------------------------------------------------------------- dividends
@router.get("/dividends/events")
def div_events(status: str | None = None, instrument_id: int | None = None, account_id: int | None = None,
               db: Session = DB):
    return dividends.list_events(db, status, instrument_id, account_id)


@router.post("/dividends/events", status_code=201)
def create_div_event(body: dict, db: Session = DB):
    try:
        ev = dividends.save_event(db, body)
        db.commit()
    except (ValidationError, ValueError) as exc:
        db.rollback()
        fail(exc)
    return dividends.event_detail(db, ev)


@router.put("/dividends/events/{ev_id}")
def update_div_event(ev_id: int, body: dict, db: Session = DB):
    ev = db.get(DividendEvent, ev_id) or fail(ValidationError("not found"), 404)
    try:
        dividends.save_event(db, body, ev)
        db.commit()
    except (ValidationError, ValueError) as exc:
        db.rollback()
        fail(exc)
    return dividends.event_detail(db, ev)


@router.delete("/dividends/events/{ev_id}")
def delete_div_event(ev_id: int, db: Session = DB):
    ev = db.get(DividendEvent, ev_id) or fail(ValidationError("not found"), 404)
    if db.scalar(select(Transaction.id).where(Transaction.dividend_event_id == ev_id).limit(1)):
        fail(ValidationError("Event has reconciled dividend transactions. Delete those first."), 409)
    audit(db, "dividend_event", ev.id, "delete", before=ev)
    db.delete(ev)
    db.commit()
    return {"ok": True}


@router.post("/dividends/events/{ev_id}/reconcile")
def reconcile_event(ev_id: int, body: dict, db: Session = DB):
    ev = db.get(DividendEvent, ev_id) or fail(ValidationError("not found"), 404)
    try:
        txns = dividends.reconcile(db, ev, body.get("entries") or [])
        db.commit()
    except ValidationError as exc:
        db.rollback()
        fail(exc)
    return {"transactions": [txn_out(t) for t in txns], "event": dividends.event_detail(db, ev)}


@router.get("/dividends/summary")
def div_summary(base: str | None = None, db: Session = DB):
    return dividends.summary(db, base)


# ---------------------------------------------------------------- audit & backups
@router.get("/audit")
def audit_log(entity: str | None = None, entity_id: int | None = None, limit: int = Query(100, le=1000),
              db: Session = DB):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if entity:
        q = q.where(AuditLog.entity == entity)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    return [row_dict(a) for a in db.scalars(q)]


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


@router.post("/ledger/validate")
def ledger_validate(db: Session = DB):
    try:
        validate_ledger(db)
    except ValidationError as exc:
        return {"ok": False, "message": str(exc)}
    return {"ok": True}
