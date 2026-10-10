"""Background price/FX refresh with provider fallback and last-known-good caching.

Refresh never blocks API requests: it runs in a worker thread and the UI polls its status.
Failed fetches leave the previous stored values untouched; their age turns them "Cached".
"""
from __future__ import annotations

import threading
from datetime import datetime
from decimal import Decimal

import httpx
from sqlalchemy import select

from .. import config
from ..db import session_scope
from ..models import CURRENCIES, DividendEvent, EarningsDate, FxRate, Holding, Instrument, PriceHistory, utcnow
from ..services import get_settings
from .providers import AlpacaData, AlphaVantage, FrankfurterFx, LongbridgeQuotes, ProviderError, YahooChart


class RefreshState:
    def __init__(self):
        self.lock = threading.Lock()
        self.running = False
        self.started_at: datetime | None = None
        self.finished_at: datetime | None = None
        self.results: dict[str, str] = {}
        self.errors: dict[str, str] = {}
        self.message = "Not run yet"

    def snapshot(self) -> dict:
        return {
            "running": self.running,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "message": self.message,
            "results": dict(self.results),
            "errors": dict(self.errors),
        }


STATE = RefreshState()
_client_factory = lambda: httpx.Client(follow_redirects=True)  # noqa: E731  (patched in tests)
_longbridge_ctx = None  # injected in tests; otherwise the SDK connects on first use
_longbridge_fundamental = None
_longbridge_calendar = None
EVENTS_EVERY_HOURS = 12


def price_providers(client, settings: dict) -> list:
    """Price sources in priority order: official APIs first, the unofficial Yahoo feed last."""
    chain = []
    if settings["longbridge_enabled"] and config.longbridge_configured():
        chain.append(LongbridgeQuotes(config.LONGBRIDGE_APP_KEY, config.LONGBRIDGE_APP_SECRET,
                                      config.LONGBRIDGE_ACCESS_TOKEN, ctx=_longbridge_ctx))
    if settings["alpaca_enabled"] and config.alpaca_configured():
        chain.append(AlpacaData(client, config.ALPACA_API_KEY_ID, config.ALPACA_API_SECRET_KEY, config.ALPACA_DATA_FEED))
    if config.ALPHAVANTAGE_API_KEY:
        chain.append(AlphaVantage(client, config.ALPHAVANTAGE_API_KEY))
    if settings["yahoo_enabled"]:
        chain.append(YahooChart(client))
    return chain


def _upsert_price(db, inst: Instrument, q):
    d = q.as_of.date()
    row = db.scalar(select(PriceHistory).where(
        PriceHistory.instrument_id == inst.id, PriceHistory.price_date == d, PriceHistory.source == q.source))
    if row is None:
        db.add(PriceHistory(instrument_id=inst.id, price_date=d, price=q.price, currency=q.currency,
                            source=q.source, quality=q.quality, as_of=q.as_of, fetched_at=utcnow()))
    else:
        row.price, row.currency, row.quality, row.as_of, row.fetched_at = q.price, q.currency, q.quality, q.as_of, utcnow()


def _upsert_fx(db, q):
    row = db.scalar(select(FxRate).where(FxRate.base == q.base, FxRate.quote == q.quote,
                                         FxRate.rate_date == q.rate_date, FxRate.source == q.source))
    if row is None:
        db.add(FxRate(base=q.base, quote=q.quote, rate=q.rate, rate_date=q.rate_date, source=q.source,
                      fetched_at=utcnow()))
    else:
        row.rate, row.fetched_at = q.rate, utcnow()


def refresh_all() -> dict:
    """Synchronous refresh (used by the worker thread, the scheduler and tests)."""
    results, errors = {}, {}
    with session_scope() as db:
        settings = get_settings(db)
        held = select(Holding.instrument_id)
        instruments = list(db.scalars(select(Instrument).where(Instrument.price_mode == "auto", Instrument.id.in_(held))))
    with _client_factory() as client:
        yahoo = YahooChart(client) if settings["yahoo_enabled"] else None
        av = AlphaVantage(client, config.ALPHAVANTAGE_API_KEY) if config.ALPHAVANTAGE_API_KEY else None
        fxp = FrankfurterFx(client) if settings["frankfurter_enabled"] else None

        # FX: all supported currencies against USD (triangulation covers the rest).
        fx_quotes = []
        others = [c for c in CURRENCIES if c != "USD"]
        if fxp:
            try:
                fx_quotes = fxp.fetch("USD", others)
                results["fx"] = f"frankfurter ({len(fx_quotes)} rates)"
            except ProviderError as exc:
                errors["fx:frankfurter"] = str(exc)
        if not fx_quotes and yahoo:
            for c in others:
                try:
                    fx_quotes.append(yahoo.fetch_fx("USD", c))
                except ProviderError as exc:
                    errors[f"fx:USD{c}"] = str(exc)
            if fx_quotes:
                results["fx"] = f"yahoo ({len(fx_quotes)} rates)"
        if fx_quotes:
            with session_scope() as db:
                for q in fx_quotes:
                    _upsert_fx(db, q)
        elif not fxp and not yahoo:
            results["fx"] = "no FX provider enabled (manual rates only)"

        remaining = {i.id: i for i in instruments}
        tried: dict[int, list[str]] = {i.id: [] for i in instruments}
        for provider in price_providers(client, settings):
            wanted = {iid: provider.map_symbol(inst) for iid, inst in remaining.items()}
            wanted = {iid: sym for iid, sym in wanted.items() if sym}
            if not wanted:
                continue
            try:
                quotes, errs = provider.fetch_prices(sorted(set(wanted.values())))
            except ProviderError as exc:
                quotes, errs = {}, {sym: str(exc) for sym in wanted.values()}
            for iid, sym in wanted.items():
                inst, q = remaining[iid], quotes.get(sym)
                if q is None:
                    tried[iid].append(f"{provider.name}: {errs.get(sym, 'no quote')}")
                    continue
                if q.currency and q.currency != inst.currency:
                    tried[iid].append(f"{provider.name}: currency {q.currency} != {inst.currency}")
                    continue
                q.currency = inst.currency
                with session_scope() as db:
                    _upsert_price(db, db.get(Instrument, iid), q)
                results[inst.symbol] = provider.name
                del remaining[iid]
        for iid, inst in remaining.items():
            errors[inst.symbol] = "; ".join(tried[iid]) or (
                "no enabled provider covers this symbol (enter a manual price, or enable Yahoo for .KL)")

    if settings["longbridge_enabled"] and config.longbridge_configured():
        try:
            n = refresh_events()
            if n is not None:
                results["dividend & earnings dates"] = f"longbridge ({n} stocks)"
        except ProviderError as exc:
            errors["dividend & earnings dates"] = f"longbridge: {exc}"

    from ..snapshots import write_snapshot
    try:
        with session_scope() as db:
            write_snapshot(db)
    except Exception as exc:  # snapshot failure must not hide refresh results
        errors["snapshot"] = str(exc)
    return {"results": results, "errors": errors}


def start_refresh() -> bool:
    with STATE.lock:
        if STATE.running:
            return False
        STATE.running = True
        STATE.started_at = utcnow()
        STATE.message = "Refreshing"

    def work():
        try:
            out = refresh_all()
            STATE.results, STATE.errors = out["results"], out["errors"]
            ok, bad = len(out["results"]), len(out["errors"])
            STATE.message = f"Updated {ok}, failed {bad}" if bad else f"Updated {ok}"
        except Exception as exc:
            STATE.errors = {"refresh": str(exc)}
            STATE.message = f"Refresh failed: {exc}"
        finally:
            STATE.finished_at = utcnow()
            STATE.running = False

    threading.Thread(target=work, daemon=True, name="price-refresh").start()
    return True


def save_manual_price(db, inst: Instrument, price: Decimal, on, currency: str | None = None):
    if price <= 0:
        raise ValueError("Price must be positive")
    if currency and currency != inst.currency:
        raise ValueError(f"Price currency must be {inst.currency}")
    row = db.scalar(select(PriceHistory).where(
        PriceHistory.instrument_id == inst.id, PriceHistory.price_date == on, PriceHistory.source == "manual"))
    as_of = datetime(on.year, on.month, on.day)
    if row is None:
        row = PriceHistory(instrument_id=inst.id, price_date=on, price=price, currency=inst.currency,
                           source="manual", quality="manual", as_of=as_of, fetched_at=utcnow())
        db.add(row)
    else:
        row.price, row.fetched_at = price, utcnow()
    return row


def refresh_events(force: bool = False) -> int | None:
    """Pull dividend dates and earnings dates from Longbridge for stocks you hold (US/HK/SG).
    Runs at most every EVENTS_EVERY_HOURS unless forced. Manual entries are never overwritten."""
    from datetime import date, timedelta

    lb = LongbridgeQuotes(config.LONGBRIDGE_APP_KEY, config.LONGBRIDGE_APP_SECRET, config.LONGBRIDGE_ACCESS_TOKEN,
                          ctx=_longbridge_ctx)
    with session_scope() as db:
        held_ids = {h.instrument_id for h in db.scalars(select(Holding))}
        due = {}
        for inst in db.scalars(select(Instrument).where(Instrument.id.in_(held_ids))):
            sym = lb.map_symbol(inst)
            fresh = inst.events_checked_at and utcnow() - inst.events_checked_at < timedelta(hours=EVENTS_EVERY_HOURS)
            if sym and (force or not fresh):
                due[sym] = inst.id
    if not due:
        return None
    today = date.today()
    divs, _errs = lb.fetch_dividends(sorted(due), fundamental_ctx=_longbridge_fundamental)
    earnings = lb.fetch_earnings(set(due), today, calendar_ctx=_longbridge_calendar)
    with session_scope() as db:
        for sym, iid in due.items():
            inst = db.get(Instrument, iid)
            for d in divs.get(sym, []):
                if d["ex_date"] < today - timedelta(days=400) or d["currency"] != inst.currency:
                    continue
                ev = db.scalar(select(DividendEvent).where(DividendEvent.instrument_id == iid,
                                                           DividendEvent.ex_date == d["ex_date"]))
                status = "announced" if (d["pay_date"] or d["ex_date"]) > today else "pending"
                if ev is None:
                    db.add(DividendEvent(instrument_id=iid, ex_date=d["ex_date"], pay_date=d["pay_date"],
                                         amount_per_share=d["amount"], currency=d["currency"], status=status,
                                         source="longbridge"))
                elif ev.source == "longbridge" and ev.status != "received":
                    ev.pay_date, ev.amount_per_share, ev.status = d["pay_date"], d["amount"], status
            if sym in divs:
                inst.events_checked_at = utcnow()
            for er in db.scalars(select(EarningsDate).where(EarningsDate.instrument_id == iid,
                                                            EarningsDate.source == "longbridge",
                                                            EarningsDate.date >= today)):
                db.delete(er)
        db.flush()
        for e in earnings:
            iid = due.get(e["symbol"])
            if iid is None:
                continue
            if db.scalar(select(EarningsDate).where(EarningsDate.instrument_id == iid, EarningsDate.date == e["date"])):
                continue
            db.add(EarningsDate(instrument_id=iid, date=e["date"], session=e["session"], title=e["title"],
                                source="longbridge"))
    return len(due)
