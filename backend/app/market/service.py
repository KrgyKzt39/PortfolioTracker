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
from ..models import CURRENCIES, FxRate, Instrument, PriceHistory, utcnow
from ..services import get_settings
from .providers import AlphaVantage, FrankfurterFx, ProviderError, YahooChart


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
        instruments = list(db.scalars(select(Instrument).where(Instrument.price_mode == "auto")))
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

        for inst in instruments:
            chain = []
            if yahoo:
                chain.append((yahoo, inst.provider_symbol or inst.symbol))
            if av and inst.currency == "USD" and "." not in inst.symbol:
                chain.append((av, inst.provider_symbol or inst.symbol))
            if not chain:
                errors[inst.symbol] = "no provider available (enable one in Settings or enter a manual price)"
                continue
            for provider, sym in chain:
                try:
                    q = provider.fetch_price(sym)
                    if q.currency and q.currency != inst.currency:
                        raise ProviderError(f"provider currency {q.currency} != {inst.currency}")
                    q.currency = inst.currency
                    with session_scope() as db:
                        _upsert_price(db, db.get(Instrument, inst.id), q)
                    results[inst.symbol] = provider.name
                    errors.pop(inst.symbol, None)
                    break
                except ProviderError as exc:
                    errors[inst.symbol] = f"{provider.name}: {exc}"

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
