"""Versioned migrations tracked with SQLite's PRAGMA user_version.

v1: original transaction-ledger schema (created from the current models on a fresh database).
v2: holdings-snapshot model. Adds brokers, categories, holdings, dividend payments and earnings
    dates; converts any v1 accounts/transactions into brokers, categories, holdings and payments.
The v1 tables are left in place (unused) so nothing is ever deleted by a migration.
"""
from types import SimpleNamespace

from sqlalchemy import inspect, text

from . import models  # noqa: F401  (registers tables on Base.metadata)
from .db import Base

REQUIRED_TABLES = {
    "brokers", "categories", "instruments", "holdings", "dividend_events", "dividend_payments",
    "earnings_dates", "price_history", "fx_rates", "valuation_snapshots", "settings", "audit_log",
}


def _v1(conn):
    Base.metadata.create_all(conn)


def _add_column(conn, table: str, ddl: str):
    name = ddl.split()[0]
    cols = {c["name"] for c in inspect(conn).get_columns(table)}
    if name not in cols:
        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))


def _v2(conn):
    Base.metadata.create_all(conn)  # creates only the missing tables
    _add_column(conn, "instruments", "category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL")
    _add_column(conn, "instruments", "sort_order INTEGER NOT NULL DEFAULT 0")
    _add_column(conn, "instruments", "events_checked_at DATETIME")
    _add_column(conn, "dividend_events", "source VARCHAR(20)")
    tables = set(inspect(conn).get_table_names())
    if not {"accounts", "transactions"} <= tables:
        return
    if conn.execute(text("SELECT COUNT(*) FROM holdings")).scalar():
        return
    _convert_v1(conn)


def _convert_v1(conn):
    from datetime import date
    from decimal import Decimal

    from .ledger import run_ledger
    from .models import utcnow

    now = utcnow()
    accounts = conn.execute(text("SELECT id, name, layout, sort_order FROM accounts ORDER BY sort_order, id")).all()
    broker_of, category_of = {}, {}
    for a in accounts:
        broker_of[a.id] = conn.execute(text(
            "INSERT INTO brokers (name, sort_order, created_at) VALUES (:n, :s, :t) RETURNING id"),
            {"n": a.name, "s": a.sort_order or 0, "t": now}).scalar()
        category_of[a.id] = conn.execute(text(
            "INSERT INTO categories (name, sort_order, show_dividends, created_at) VALUES (:n, :s, :d, :t) RETURNING id"),
            {"n": a.name, "s": a.sort_order or 0, "d": a.layout == "dividend", "t": now}).scalar()
    inst_ccy = {r.id: r.currency for r in conn.execute(text("SELECT id, currency FROM instruments"))}
    num = ("quantity", "price", "amount", "fees", "tax", "fx_rate", "split_ratio")
    txns = []
    for r in conn.execute(text("SELECT * FROM transactions")).mappings():
        d = dict(r)
        d["trade_date"] = date.fromisoformat(str(d["trade_date"]))
        for k in num:
            d[k] = Decimal(d[k]) if d[k] not in (None, "") else None
        d["fees"] = d["fees"] or Decimal(0)
        d["tax"] = d["tax"] or Decimal(0)
        txns.append(SimpleNamespace(**d))
    ledger = run_ledger(txns, inst_ccy)
    for (acct, inst), p in ledger.positions.items():
        if p.quantity > 0:
            conn.execute(text(
                "INSERT INTO holdings (broker_id, instrument_id, quantity, avg_cost, source, updated_at) "
                "VALUES (:b, :i, :q, :c, 'migrated', :t)"),
                {"b": broker_of[acct], "i": inst, "q": str(p.quantity), "c": str(p.avg_cost), "t": now})
            conn.execute(text("UPDATE instruments SET category_id = :c WHERE id = :i AND category_id IS NULL"),
                         {"c": category_of[acct], "i": inst})
    for t in txns:
        if t.type in ("DIVIDEND", "DRIP"):
            conn.execute(text(
                "INSERT INTO dividend_payments (instrument_id, broker_id, event_id, pay_date, gross, tax, currency, note, created_at) "
                "VALUES (:i, :b, :e, :d, :g, :x, :c, :n, :t)"),
                {"i": t.instrument_id, "b": broker_of.get(t.account_id), "e": t.dividend_event_id, "d": t.trade_date,
                 "g": str(t.amount), "x": str(t.tax), "c": t.currency, "n": t.note, "t": now})


MIGRATIONS = [_v1, _v2]
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
