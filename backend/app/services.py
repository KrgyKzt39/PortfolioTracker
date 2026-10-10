"""Settings and audit-log helpers."""
from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from .models import AuditLog, Setting

DEFAULT_SETTINGS = {
    "base_currency": "MYR",
    "longbridge_enabled": True,  # used only when credentials are set in .env
    "alpaca_enabled": True,  # used only when credentials are set in .env
    "yahoo_enabled": False,  # unofficial endpoint: opt-in only
    "frankfurter_enabled": True,  # documented ECB reference-rate API
    "refresh_interval_minutes": 30,
    "stale_after_minutes": 90,
    "hide_values": False,
}


def get_settings(db: Session) -> dict:
    out = dict(DEFAULT_SETTINGS)
    for s in db.query(Setting).all():
        try:
            out[s.key] = json.loads(s.value)
        except ValueError:
            out[s.key] = s.value
    return out


def set_settings(db: Session, values: dict) -> dict:
    before = get_settings(db)
    for k, v in values.items():
        if k not in DEFAULT_SETTINGS:
            raise ValueError(f"Unknown setting {k}")
        row = db.get(Setting, k)
        if row is None:
            db.add(Setting(key=k, value=json.dumps(v)))
        else:
            row.value = json.dumps(v)
    db.flush()
    after = get_settings(db)
    audit(db, "settings", None, "update", before, after)
    return after


def _jsonable(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, datetime):  # stored as naive UTC
        return v.isoformat(timespec="seconds") + ("Z" if v.tzinfo is None else "")
    if isinstance(v, date):
        return v.isoformat()
    return v


def row_dict(obj) -> dict:
    return {c.key: _jsonable(getattr(obj, c.key)) for c in inspect(obj).mapper.column_attrs}


def audit(db: Session, entity: str, entity_id: int | None, action: str, before=None, after=None, note=None):
    def dump(x):
        if x is None:
            return None
        if not isinstance(x, dict):
            x = row_dict(x)
        return json.dumps(x, default=_jsonable)

    db.add(AuditLog(entity=entity, entity_id=entity_id, action=action, before=dump(before), after=dump(after), note=note))
