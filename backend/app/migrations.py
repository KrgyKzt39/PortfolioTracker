"""Minimal versioned migrations tracked with SQLite's PRAGMA user_version.

Version 1 creates the full schema. Append future steps to MIGRATIONS; each runs once,
in order, inside a transaction.
"""
from sqlalchemy import text

from . import models  # noqa: F401  (registers tables on Base.metadata)
from .db import Base

REQUIRED_TABLES = {
    "accounts",
    "instruments",
    "transactions",
    "price_history",
    "fx_rates",
    "dividend_events",
    "valuation_snapshots",
    "settings",
    "audit_log",
}


def _v1(conn):
    Base.metadata.create_all(conn)


MIGRATIONS = [_v1]
SCHEMA_VERSION = len(MIGRATIONS)


def migrate(engine) -> int:
    with engine.begin() as conn:
        version = conn.execute(text("PRAGMA user_version")).scalar() or 0
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"Database schema v{version} is newer than this app (v{SCHEMA_VERSION}). Update the app."
            )
        for i in range(version, SCHEMA_VERSION):
            MIGRATIONS[i](conn)
            conn.execute(text(f"PRAGMA user_version={i + 1}"))
    return SCHEMA_VERSION
