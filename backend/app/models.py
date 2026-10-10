"""Database schema. Transactions are the single source of truth for holdings and cash."""
from datetime import date, datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, DecimalText

CURRENCIES = ("MYR", "USD", "SGD", "GBP", "HKD")

TXN_TYPES = (
    "BUY",
    "SELL",
    "DIVIDEND",
    "DRIP",
    "DEPOSIT",
    "WITHDRAWAL",
    "FEE",
    "TAX",
    "SPLIT",
    "TRANSFER",
)

DIVIDEND_STATUSES = ("forecast", "announced", "pending", "received")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    layout: Mapped[str] = mapped_column(String(20), default="growth")  # 'dividend' | 'growth'
    currency: Mapped[str] = mapped_column(String(3), default="MYR")
    broker: Mapped[str | None] = mapped_column(String(80))
    track_cash: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (CheckConstraint("layout in ('dividend','growth')", name="ck_account_layout"),)


class Instrument(Base):
    __tablename__ = "instruments"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str | None] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3))
    kind: Mapped[str] = mapped_column(String(16), default="stock")  # stock|etf|reit|fund|other
    price_mode: Mapped[str] = mapped_column(String(10), default="auto")  # auto|manual
    provider_symbol: Mapped[str | None] = mapped_column(String(32))
    annual_dividend_per_share: Mapped[object | None] = mapped_column(DecimalText)
    dividend_frequency: Mapped[int | None] = mapped_column(Integer)
    withholding_tax_rate: Mapped[object] = mapped_column(DecimalText, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(12))
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    # SPLIT is instrument-wide, so account is optional only for that type.
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), index=True)
    to_account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    instrument_id: Mapped[int | None] = mapped_column(ForeignKey("instruments.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[object | None] = mapped_column(DecimalText)
    price: Mapped[object | None] = mapped_column(DecimalText)
    amount: Mapped[object | None] = mapped_column(DecimalText)  # cash amount / gross dividend
    fees: Mapped[object] = mapped_column(DecimalText, default=0)
    tax: Mapped[object] = mapped_column(DecimalText, default=0)  # withholding tax on dividends
    currency: Mapped[str] = mapped_column(String(3))
    fx_rate: Mapped[object | None] = mapped_column(DecimalText)  # 1 `currency` = fx_rate `fx_currency`
    fx_currency: Mapped[str | None] = mapped_column(String(3))
    split_ratio: Mapped[object | None] = mapped_column(DecimalText)
    dividend_event_id: Mapped[int | None] = mapped_column(ForeignKey("dividend_events.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    import_batch: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    account = relationship("Account", foreign_keys=[account_id])
    to_account = relationship("Account", foreign_keys=[to_account_id])
    instrument = relationship("Instrument")

    __table_args__ = (
        CheckConstraint(
            "type in ('BUY','SELL','DIVIDEND','DRIP','DEPOSIT','WITHDRAWAL','FEE','TAX','SPLIT','TRANSFER')",
            name="ck_txn_type",
        ),
        CheckConstraint("account_id is not null or type = 'SPLIT'", name="ck_txn_account"),
    )


class PriceHistory(Base):
    __tablename__ = "price_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    price_date: Mapped[date] = mapped_column(Date)
    price: Mapped[object] = mapped_column(DecimalText)
    currency: Mapped[str] = mapped_column(String(3))
    source: Mapped[str] = mapped_column(String(20))  # manual|yahoo|alphavantage
    quality: Mapped[str] = mapped_column(String(10))  # realtime|delayed|eod|manual
    as_of: Mapped[datetime] = mapped_column(DateTime)  # provider timestamp of the quote
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("instrument_id", "price_date", "source", name="uq_price_day_source"),)


class FxRate(Base):
    __tablename__ = "fx_rates"
    id: Mapped[int] = mapped_column(primary_key=True)
    base: Mapped[str] = mapped_column(String(3))
    quote: Mapped[str] = mapped_column(String(3))
    rate: Mapped[object] = mapped_column(DecimalText)  # 1 base = rate quote
    rate_date: Mapped[date] = mapped_column(Date, index=True)
    source: Mapped[str] = mapped_column(String(20))
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("base", "quote", "rate_date", "source", name="uq_fx_day_source"),)


class DividendEvent(Base):
    __tablename__ = "dividend_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    ex_date: Mapped[date] = mapped_column(Date)
    pay_date: Mapped[date | None] = mapped_column(Date)
    amount_per_share: Mapped[object] = mapped_column(DecimalText)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(10), default="announced")
    withholding_tax_rate: Mapped[object | None] = mapped_column(DecimalText)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    instrument = relationship("Instrument")

    __table_args__ = (
        UniqueConstraint("instrument_id", "ex_date", name="uq_div_event"),
        CheckConstraint("status in ('forecast','announced','pending','received')", name="ck_div_status"),
    )


class ValuationSnapshot(Base):
    __tablename__ = "valuation_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(Date)
    base_currency: Mapped[str] = mapped_column(String(3))
    total_value: Mapped[object] = mapped_column(DecimalText)
    total_cost: Mapped[object] = mapped_column(DecimalText)
    total_pl: Mapped[object] = mapped_column(DecimalText)
    detail: Mapped[str] = mapped_column(Text)  # JSON per account
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("snapshot_date", "base_currency", name="uq_snapshot_day"),)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    entity: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    action: Mapped[str] = mapped_column(String(20))
    before: Mapped[str | None] = mapped_column(Text)
    after: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
