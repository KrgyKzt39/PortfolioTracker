"""Transaction normalisation, validation, duplicate detection and CRUD with audit."""
from __future__ import annotations

import hashlib
from datetime import date
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ledger import LedgerError, run_ledger
from .models import CURRENCIES, TXN_TYPES, Account, Instrument, Transaction
from .services import audit, row_dict

NUM_FIELDS = ("quantity", "price", "amount", "fees", "tax", "fx_rate", "split_ratio")
FIELDS = (
    "type", "trade_date", "account_id", "to_account_id", "instrument_id", "quantity", "price", "amount",
    "fees", "tax", "currency", "fx_rate", "fx_currency", "split_ratio", "dividend_event_id", "note",
)


class ValidationError(ValueError):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


def to_decimal(v, field: str) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        d = Decimal(str(v).replace(",", "").strip())
    except InvalidOperation as exc:
        raise ValidationError(f"{field}: '{v}' is not a number", field) from exc
    if not d.is_finite():
        raise ValidationError(f"{field}: must be finite", field)
    return d


def fingerprint(data: dict) -> str:
    parts = [str(data.get(k) if data.get(k) is not None else "") for k in
             ("type", "trade_date", "account_id", "to_account_id", "instrument_id", "currency")]
    for k in ("quantity", "price", "amount", "fees", "tax", "split_ratio"):
        v = data.get(k)
        parts.append("" if v is None else format(Decimal(v).normalize(), "f"))
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def normalise(db: Session, raw: dict) -> dict:
    """Validate a single transaction's own fields and fill defaults. Ledger checks happen later."""
    data = {k: raw.get(k) for k in FIELDS}
    t = (data["type"] or "").upper()
    if t not in TXN_TYPES:
        raise ValidationError(f"type must be one of {', '.join(TXN_TYPES)}", "type")
    data["type"] = t
    if isinstance(data["trade_date"], str):
        try:
            data["trade_date"] = date.fromisoformat(data["trade_date"])
        except ValueError as exc:
            raise ValidationError("trade_date must be YYYY-MM-DD", "trade_date") from exc
    if not isinstance(data["trade_date"], date):
        raise ValidationError("trade_date is required", "trade_date")
    if data["trade_date"] > date.today():
        raise ValidationError("trade_date cannot be in the future", "trade_date")
    for f in NUM_FIELDS:
        data[f] = to_decimal(data[f], f)
    data["fees"] = data["fees"] or Decimal(0)
    data["tax"] = data["tax"] or Decimal(0)
    if data["fees"] < 0 or data["tax"] < 0:
        raise ValidationError("fees and tax cannot be negative", "fees")

    acct = db.get(Account, data["account_id"]) if data["account_id"] else None
    if t != "SPLIT" and acct is None:
        raise ValidationError("account is required", "account_id")
    inst = db.get(Instrument, data["instrument_id"]) if data["instrument_id"] else None
    if data["instrument_id"] and inst is None:
        raise ValidationError("unknown instrument", "instrument_id")

    needs_inst = t in ("BUY", "SELL", "DIVIDEND", "DRIP", "SPLIT")
    if needs_inst and inst is None:
        raise ValidationError(f"{t} requires an instrument", "instrument_id")
    if t in ("DEPOSIT", "WITHDRAWAL"):
        data["instrument_id"] = None

    if t in ("BUY", "SELL", "DRIP", "SPLIT") or (t == "TRANSFER" and inst):
        data["currency"] = inst.currency
    if not data["currency"]:
        data["currency"] = inst.currency if inst else (acct.currency if acct else None)
    data["currency"] = (data["currency"] or "").upper()
    if data["currency"] not in CURRENCIES and not (inst and data["currency"] == inst.currency):
        raise ValidationError(f"currency must be one of {', '.join(CURRENCIES)}", "currency")
    if data["fx_currency"]:
        data["fx_currency"] = data["fx_currency"].upper()
        if data["fx_rate"] is None or data["fx_rate"] <= 0:
            raise ValidationError("fx_rate must be positive when fx_currency is set", "fx_rate")
    else:
        data["fx_rate"] = None

    if t in ("BUY", "SELL"):
        if not data["quantity"] or data["quantity"] <= 0:
            raise ValidationError("quantity must be positive", "quantity")
        if data["price"] is None or data["price"] < 0:
            raise ValidationError("price is required", "price")
        data["amount"] = None
    elif t == "DRIP":
        if not data["quantity"] or data["quantity"] <= 0 or data["price"] is None:
            raise ValidationError("DRIP needs reinvested quantity and price", "quantity")
        if data["amount"] is None:
            data["amount"] = data["quantity"] * data["price"] + data["tax"]
    elif t in ("DIVIDEND", "DEPOSIT", "WITHDRAWAL", "FEE", "TAX"):
        if data["amount"] is None or data["amount"] <= 0:
            raise ValidationError("amount must be positive", "amount")
        if t == "DIVIDEND" and data["tax"] > data["amount"]:
            raise ValidationError("withholding tax cannot exceed gross dividend", "tax")
        if t != "DIVIDEND":
            data["quantity"] = data["price"] = None
    elif t == "SPLIT":
        if not data["split_ratio"] or data["split_ratio"] <= 0:
            raise ValidationError("split ratio must be positive (e.g. 2 for 2-for-1, 0.1 for 1-for-10)", "split_ratio")
        data["quantity"] = data["price"] = data["amount"] = None
    elif t == "TRANSFER":
        if not data["to_account_id"] or db.get(Account, data["to_account_id"]) is None:
            raise ValidationError("destination account is required", "to_account_id")
        if data["to_account_id"] == data["account_id"]:
            raise ValidationError("destination must differ from source", "to_account_id")
        if inst:
            if not data["quantity"] or data["quantity"] <= 0:
                raise ValidationError("quantity must be positive", "quantity")
            data["amount"] = None
        elif data["amount"] is None or data["amount"] <= 0:
            raise ValidationError("cash transfer amount must be positive", "amount")
    if t != "TRANSFER":
        data["to_account_id"] = None
    if t != "SPLIT":
        data["split_ratio"] = None
    data["fingerprint"] = fingerprint(data)
    return data


def instrument_currencies(db: Session) -> dict[int, str]:
    return {i.id: i.currency for i in db.scalars(select(Instrument))}


def validate_ledger(db: Session) -> None:
    """Replay the full history; raises ValidationError if any point in time becomes invalid."""
    db.flush()
    try:
        run_ledger(list(db.scalars(select(Transaction))), instrument_currencies(db))
    except LedgerError as exc:
        raise ValidationError(f"{exc} (transaction #{exc.txn_id})" if exc.txn_id else str(exc)) from exc


def find_duplicates(db: Session, fp: str, exclude_id: int | None = None) -> list[int]:
    q = select(Transaction.id).where(Transaction.fingerprint == fp)
    if exclude_id:
        q = q.where(Transaction.id != exclude_id)
    return list(db.scalars(q))


class DuplicateError(ValidationError):
    def __init__(self, ids: list[int]):
        super().__init__(f"Looks like a duplicate of transaction #{', #'.join(map(str, ids))}. "
                         "Confirm to save anyway.", "duplicate")
        self.ids = ids


def create_txn(db: Session, raw: dict, allow_duplicate=False, source="manual", batch=None) -> Transaction:
    data = normalise(db, raw)
    dups = find_duplicates(db, data["fingerprint"])
    if dups and not allow_duplicate:
        raise DuplicateError(dups)
    t = Transaction(**data, source=source, import_batch=batch)
    db.add(t)
    validate_ledger(db)
    audit(db, "transaction", t.id, "create", after=t)
    return t


def update_txn(db: Session, t: Transaction, raw: dict, allow_duplicate=False) -> Transaction:
    before = row_dict(t)
    merged = {k: getattr(t, k) for k in FIELDS} | {k: v for k, v in raw.items() if k in FIELDS}
    data = normalise(db, merged)
    dups = find_duplicates(db, data["fingerprint"], exclude_id=t.id)
    if dups and not allow_duplicate:
        raise DuplicateError(dups)
    for k, v in data.items():
        setattr(t, k, v)
    validate_ledger(db)
    audit(db, "transaction", t.id, "update", before=before, after=t)
    return t


def delete_txn(db: Session, t: Transaction, note: str | None = None):
    before = row_dict(t)
    db.delete(t)
    validate_ledger(db)
    audit(db, "transaction", before["id"], "delete", before=before, note=note)


def txn_out(t: Transaction) -> dict:
    d = row_dict(t)
    d["account_name"] = t.account.name if t.account else None
    d["to_account_name"] = t.to_account.name if t.to_account else None
    d["symbol"] = t.instrument.symbol if t.instrument else None
    net = None
    if t.type in ("BUY",):
        net = -(Decimal(t.quantity) * Decimal(t.price) + Decimal(t.fees))
    elif t.type == "SELL":
        net = Decimal(t.quantity) * Decimal(t.price) - Decimal(t.fees)
    elif t.type == "DIVIDEND":
        net = Decimal(t.amount) - Decimal(t.tax)
    elif t.type == "DRIP":
        net = Decimal(t.amount) - Decimal(t.tax) - Decimal(t.quantity) * Decimal(t.price)
    elif t.type == "DEPOSIT":
        net = Decimal(t.amount)
    elif t.type in ("WITHDRAWAL", "FEE", "TAX"):
        net = -Decimal(t.amount)
    elif t.type == "TRANSFER" and t.amount is not None:
        net = Decimal(t.amount)
    d["cash_effect"] = str(net) if net is not None else None
    return d
