"""CSV import (column mapping, validation, duplicate detection) and export."""
from __future__ import annotations

import csv
import io
import uuid
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .ledger import LedgerError, run_ledger
from .models import Account, Instrument, Transaction
from .services import audit
from .transactions import ValidationError, find_duplicates, instrument_currencies, normalise

COLUMNS = ["date", "type", "account", "to_account", "symbol", "quantity", "price", "amount", "fees", "tax",
           "currency", "fx_rate", "fx_currency", "split_ratio", "note"]
REQUIRED = ["date", "type", "account"]

ALIASES = {
    "date": ["date", "trade date", "trade_date", "transaction date", "settlement date"],
    "type": ["type", "action", "transaction type", "side"],
    "account": ["account", "account name", "portfolio"],
    "to_account": ["to_account", "to account", "destination"],
    "symbol": ["symbol", "ticker", "stock", "code", "instrument"],
    "quantity": ["quantity", "qty", "shares", "units"],
    "price": ["price", "unit price", "price per share"],
    "amount": ["amount", "value", "gross", "gross amount", "total"],
    "fees": ["fees", "fee", "commission", "brokerage"],
    "tax": ["tax", "withholding", "withholding tax", "wht"],
    "currency": ["currency", "ccy"],
    "fx_rate": ["fx_rate", "fx rate", "exchange rate"],
    "fx_currency": ["fx_currency", "fx currency"],
    "split_ratio": ["split_ratio", "split ratio", "ratio"],
    "note": ["note", "notes", "memo", "description"],
}

TYPE_ALIASES = {
    "buy": "BUY", "b": "BUY", "purchase": "BUY", "bought": "BUY",
    "sell": "SELL", "s": "SELL", "sold": "SELL", "sale": "SELL",
    "dividend": "DIVIDEND", "div": "DIVIDEND", "dividends": "DIVIDEND", "distribution": "DIVIDEND",
    "drip": "DRIP", "reinvest": "DRIP", "dividend reinvestment": "DRIP",
    "deposit": "DEPOSIT", "withdrawal": "WITHDRAWAL", "withdraw": "WITHDRAWAL",
    "fee": "FEE", "fees": "FEE", "tax": "TAX", "split": "SPLIT", "transfer": "TRANSFER",
}

SUFFIX_CCY = {".KL": "MYR", ".SI": "SGD", ".HK": "HKD", ".L": "GBP"}


def guess_currency(symbol: str) -> str:
    for suf, ccy in SUFFIX_CCY.items():
        if symbol.upper().endswith(suf):
            return ccy
    return "USD"


def decode(content: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValidationError("File is not valid UTF-8 or Windows-1252 text")


def read_csv(content: bytes) -> tuple[list[str], list[dict]]:
    text = decode(content)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    headers = [h.strip() for h in (reader.fieldnames or [])]
    rows = [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]
    if not headers:
        raise ValidationError("CSV has no header row")
    return headers, rows


def suggest_mapping(headers: list[str]) -> dict[str, str | None]:
    lower = {h.lower(): h for h in headers}
    return {field: next((lower[a] for a in aliases if a in lower), None) for field, aliases in ALIASES.items()}


def parse_date(v: str, fmt: str) -> date:
    v = v.strip()
    fmts = {"iso": ["%Y-%m-%d"], "dmy": ["%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"], "mdy": ["%m/%d/%Y", "%m-%d-%Y"]}
    for f in fmts.get(fmt, fmts["iso"]) + (["%Y-%m-%d"] if fmt != "iso" else []):
        try:
            return datetime.strptime(v, f).date()
        except ValueError:
            continue
    raise ValidationError(f"date '{v}' does not match format {fmt}", "date")


def process(db: Session, content: bytes, mapping: dict | None, date_format="iso", create_missing=False,
            skip_duplicates=True, commit=False) -> dict:
    """Parse and validate. With commit=False the caller must roll the session back (preview)."""
    headers, raw_rows = read_csv(content)
    mapping = mapping or suggest_mapping(headers)
    missing = [f for f in REQUIRED if not mapping.get(f)]
    if missing:
        raise ValidationError(f"Map required columns: {', '.join(missing)}")
    for f, h in mapping.items():
        if h and h not in headers:
            raise ValidationError(f"Mapped column '{h}' not in file")

    accounts = {a.name.lower(): a for a in db.scalars(select(Account))}
    instruments = {i.symbol.upper(): i for i in db.scalars(select(Instrument))}
    batch = uuid.uuid4().hex[:12]
    seen: dict[str, int] = {}
    results = []
    to_add: list[tuple[dict, Transaction]] = []
    created = {"accounts": [], "instruments": []}

    def val(r, f):
        h = mapping.get(f)
        return r.get(h, "") if h else ""

    for n, r in enumerate(raw_rows, start=2):  # header is line 1
        res = {"line": n, "raw": r, "errors": [], "duplicate_of": None, "status": "ok"}
        try:
            typ = TYPE_ALIASES.get(val(r, "type").lower(), val(r, "type").upper())
            acct_name = val(r, "account")
            acct = accounts.get(acct_name.lower()) if acct_name else None
            if acct is None and typ != "SPLIT":
                if not acct_name:
                    raise ValidationError("account is empty", "account")
                if not create_missing:
                    raise ValidationError(f"unknown account '{acct_name}'", "account")
                acct = Account(name=acct_name, layout="growth", currency="MYR")
                db.add(acct)
                db.flush()
                accounts[acct_name.lower()] = acct
                created["accounts"].append(acct_name)
            to_acct = None
            if val(r, "to_account"):
                to_acct = accounts.get(val(r, "to_account").lower())
                if to_acct is None:
                    raise ValidationError(f"unknown destination account '{val(r, 'to_account')}'", "to_account")
            sym = val(r, "symbol").upper()
            inst = instruments.get(sym) if sym else None
            if sym and inst is None:
                if not create_missing:
                    raise ValidationError(f"unknown symbol '{sym}'", "symbol")
                ccy = (val(r, "currency") or guess_currency(sym)).upper()
                inst = Instrument(symbol=sym, currency=ccy, kind="stock", price_mode="auto")
                db.add(inst)
                db.flush()
                instruments[sym] = inst
                created["instruments"].append(sym)
            data = normalise(db, {
                "type": typ,
                "trade_date": parse_date(val(r, "date"), date_format),
                "account_id": acct.id if acct else None,
                "to_account_id": to_acct.id if to_acct else None,
                "instrument_id": inst.id if inst else None,
                "quantity": val(r, "quantity"), "price": val(r, "price"), "amount": val(r, "amount"),
                "fees": val(r, "fees"), "tax": val(r, "tax"), "currency": val(r, "currency") or None,
                "fx_rate": val(r, "fx_rate"), "fx_currency": val(r, "fx_currency") or None,
                "split_ratio": val(r, "split_ratio"), "note": val(r, "note") or None,
            })
            fp = data["fingerprint"]
            dup = find_duplicates(db, fp)
            if dup:
                res["duplicate_of"] = dup[0]
            elif fp in seen:
                res["duplicate_of"] = f"line {seen[fp]}"
            if res["duplicate_of"] is not None:
                res["status"] = "duplicate"
                if skip_duplicates:
                    results.append(res)
                    continue
            seen[fp] = n
            t = Transaction(**data, source="csv", import_batch=batch)
            db.add(t)
            to_add.append((res, t))
            res["data"] = {k: (str(v) if v is not None else None) for k, v in data.items() if k != "fingerprint"}
        except ValidationError as exc:
            res["errors"].append(str(exc))
            res["status"] = "error"
        results.append(res)

    db.flush()
    ledger_error = None
    try:
        run_ledger(list(db.scalars(select(Transaction))), instrument_currencies(db))
    except LedgerError as exc:
        ledger_error = str(exc)
        for res, t in to_add:
            if t.id == exc.txn_id:
                res["errors"].append(f"ledger: {exc}")
                res["status"] = "error"
        if not any(t.id == exc.txn_id for _, t in to_add):
            ledger_error = f"Import would invalidate existing transaction #{exc.txn_id}: {exc}"

    summary = {
        "rows": len(raw_rows),
        "valid": sum(1 for r in results if r["status"] == "ok"),
        "duplicates": sum(1 for r in results if r["status"] == "duplicate"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "ledger_error": ledger_error,
        "will_create": created,
        "batch": batch,
    }
    ok = summary["errors"] == 0 and ledger_error is None
    if commit:
        if not ok:
            raise ValidationError("Fix errors before importing", "csv")
        for _, t in to_add:
            audit(db, "transaction", t.id, "import", after=t, note=f"batch {batch}")
        summary["imported"] = len(to_add)
    return {"headers": headers, "mapping": mapping, "rows": results[:500], "summary": summary, "can_import": ok}


def export(db: Session, txns: list[Transaction] | None = None) -> str:
    txns = txns if txns is not None else list(db.scalars(select(Transaction).order_by(Transaction.trade_date, Transaction.id)))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS)

    def s(v):
        return "" if v is None else str(v)

    for t in txns:
        w.writerow([t.trade_date.isoformat(), t.type, t.account.name if t.account else "",
                    t.to_account.name if t.to_account else "", t.instrument.symbol if t.instrument else "",
                    s(t.quantity), s(t.price), s(t.amount), s(t.fees), s(t.tax), t.currency, s(t.fx_rate),
                    s(t.fx_currency), s(t.split_ratio), s(t.note)])
    return buf.getvalue()
