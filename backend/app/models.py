"""Database schema.

Holdings are snapshots copied from each brokerage (quantity + average cost); the broker remains the
record of trades. Dividends received are logged separately so returns include income.
"""
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base, DecimalText

from .currencies import CODES as CURRENCIES  # noqa: E402
DIVIDEND_STATUSES = ("forecast", "announced", "pending", "received")


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Broker(Base):
    """Where a holding is kept, e.g. "Rakuten Trade" or "Longbridge"."""

    __tablename__ = "brokers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Category(Base):
    """User-defined group shown as one card on the dashboard."""

    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    show_dividends: Mapped[bool] = mapped_column(Boolean, default=False)  # dividend-style columns
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Instrument(Base):
    __tablename__ = "instruments"
    id: Mapped[int] = mapped_column(primary_key=True)
    symbol: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str | None] = mapped_column(String(120))
    currency: Mapped[str] = mapped_column(String(3))
    kind: Mapped[str] = mapped_column(String(16), default="stock")  # stock|etf|reit|fund|other
    price_mode: Mapped[str] = mapped_column(String(10), default="auto")  # auto|manual
    provider_symbol: Mapped[str | None] = mapped_column(String(32))
    annual_dividend_per_share: Mapped[object | None] = mapped_column(DecimalText)  # user's forward estimate
    dividend_frequency: Mapped[int | None] = mapped_column(Integer)
    withholding_tax_rate: Mapped[object] = mapped_column(DecimalText, default=0)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    events_checked_at: Mapped[datetime | None] = mapped_column(DateTime)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    category = relationship("Category")


class Holding(Base):
    """Quantity and average cost of one instrument at one broker, as shown in the broker's app."""

    __tablename__ = "holdings"
    id: Mapped[int] = mapped_column(primary_key=True)
    broker_id: Mapped[int] = mapped_column(ForeignKey("brokers.id", ondelete="RESTRICT"), index=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="RESTRICT"), index=True)
    quantity: Mapped[object] = mapped_column(DecimalText)
    avg_cost: Mapped[object] = mapped_column(DecimalText)  # per share, instrument currency, incl. fees
    source: Mapped[str] = mapped_column(String(20), default="manual")  # manual|import|migrated
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    broker = relationship("Broker")
    instrument = relationship("Instrument")

    __table_args__ = (
        UniqueConstraint("broker_id", "instrument_id", name="uq_holding"),
        CheckConstraint("CAST(quantity AS REAL) > 0", name="ck_holding_qty"),
    )


class DividendEvent(Base):
    """A company's dividend: ex-date, pay date, amount per share. Not income until received."""

    __tablename__ = "dividend_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    ex_date: Mapped[date] = mapped_column(Date)
    pay_date: Mapped[date | None] = mapped_column(Date)
    amount_per_share: Mapped[object] = mapped_column(DecimalText)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(10), default="announced")
    withholding_tax_rate: Mapped[object | None] = mapped_column(DecimalText)
    source: Mapped[str | None] = mapped_column(String(20), default="manual")
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    instrument = relationship("Instrument")

    __table_args__ = (
        UniqueConstraint("instrument_id", "ex_date", name="uq_div_event"),
        CheckConstraint("status in ('forecast','announced','pending','received')", name="ck_div_status"),
    )


class DividendPayment(Base):
    """Dividend actually received (confirmed by the user)."""

    __tablename__ = "dividend_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="RESTRICT"), index=True)
    broker_id: Mapped[int | None] = mapped_column(ForeignKey("brokers.id", ondelete="SET NULL"))
    event_id: Mapped[int | None] = mapped_column(ForeignKey("dividend_events.id", ondelete="SET NULL"))
    pay_date: Mapped[date] = mapped_column(Date, index=True)
    gross: Mapped[object] = mapped_column(DecimalText)
    tax: Mapped[object] = mapped_column(DecimalText, default=0)
    currency: Mapped[str] = mapped_column(String(3))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    instrument = relationship("Instrument")
    broker = relationship("Broker")


class EarningsDate(Base):
    __tablename__ = "earnings_dates"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date)
    session: Mapped[str | None] = mapped_column(String(10))  # before|after|None
    title: Mapped[str | None] = mapped_column(String(120))
    source: Mapped[str] = mapped_column(String(20), default="manual")
    fetched_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    instrument = relationship("Instrument")

    __table_args__ = (UniqueConstraint("instrument_id", "date", name="uq_earnings"),)


class PriceHistory(Base):
    __tablename__ = "price_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id", ondelete="CASCADE"), index=True)
    price_date: Mapped[date] = mapped_column(Date)
    price: Mapped[object] = mapped_column(DecimalText)
    currency: Mapped[str] = mapped_column(String(3))
    source: Mapped[str] = mapped_column(String(20))
    quality: Mapped[str] = mapped_column(String(10))  # realtime|delayed|eod|manual
    as_of: Mapped[datetime] = mapped_column(DateTime)
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


class ValuationSnapshot(Base):
    __tablename__ = "valuation_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_date: Mapped[date] = mapped_column(Date)
    base_currency: Mapped[str] = mapped_column(String(3))
    total_value: Mapped[object] = mapped_column(DecimalText)
    total_cost: Mapped[object] = mapped_column(DecimalText)
    total_pl: Mapped[object] = mapped_column(DecimalText)
    detail: Mapped[str] = mapped_column(Text)
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
