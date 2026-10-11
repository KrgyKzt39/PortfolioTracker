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
from ..models import DividendEvent, DividendPayment, EarningsDate, FxRate, Holding, Instrument, PriceHistory, utcnow
from ..services import get_settings
from ..currencies import ECB
from .providers import AlpacaData, AlphaVantage, FrankfurterFx, LongbridgeQuotes, OpenErApiFx, ProviderError, YahooChart


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
            "events": dict(EVENTS_STATE),
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
        # Rates are needed for: the base currency, every held currency, and dividend currencies.
        needed = {settings["base_currency"]}
        needed |= {i.currency for i in db.scalars(select(Instrument).where(Instrument.id.in_(held)))}
        needed |= {p.currency for p in db.scalars(select(DividendPayment))}
    with _client_factory() as client:
        yahoo = YahooChart(client) if settings["yahoo_enabled"] else None
        av = AlphaVantage(client, config.ALPHAVANTAGE_API_KEY) if config.ALPHAVANTAGE_API_KEY else None

        # FX: everything against USD (triangulation covers other pairs). ECB first, then
        # ExchangeRate-API for currencies the ECB does not publish or when Frankfurter fails.
        others = sorted(needed - {"USD"})
        got: dict[str, object] = {}
        sources = []
        if settings["frankfurter_enabled"] and others:
            ecb = [c for c in others if c in ECB]
            if ecb:
                try:
                    for q in FrankfurterFx(client).fetch("USD", ecb):
                        got[q.quote] = q
                    sources.append("ECB")
                except ProviderError as exc:
                    errors["fx:frankfurter"] = str(exc)
            missing = [c for c in others if c not in got]
            if missing:
                try:
                    for q in OpenErApiFx(client).fetch("USD", missing):
                        got[q.quote] = q
                    sources.append("ExchangeRate-API")
                except ProviderError as exc:
                    errors["fx:exchangerate-api"] = str(exc)
        if yahoo:
            for c in [c for c in others if c not in got]:
                try:
                    got[c] = yahoo.fetch_fx("USD", c)
                except ProviderError as exc:
                    errors[f"fx:USD{c}"] = str(exc)
        if got:
            with session_scope() as db:
                for q in got.values():
                    _upsert_fx(db, q)
            results["fx"] = f"{len(got)} rates ({', '.join(sources) or 'yahoo'})"
        elif not others:
            results["fx"] = "no exchange rates needed"
        elif not settings["frankfurter_enabled"] and not yahoo:
            results["fx"] = "exchange-rate updates are off (manual rates only)"
        for c in others:
            if c not in got and f"fx:USD{c}" not in errors:
                errors.setdefault(f"fx:{c}", "no source returned this rate; enter it manually in Settings")

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
                "no enabled price source covers this symbol (enter a price, or enable Yahoo in Settings)")

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
    threading.Thread(target=_events_job, daemon=True, name="events-refresh").start()
    return True


EVENTS_STATE = {"running": False, "message": "", "finished_at": None}


def _events_job():
    """Dividend and earnings dates take a minute or two, so they run separately from prices."""
    if EVENTS_STATE["running"]:
        return
    with session_scope() as db:
        settings = get_settings(db)
    if not ((settings["longbridge_enabled"] and config.longbridge_configured()) or config.ALPHAVANTAGE_API_KEY):
        return
    EVENTS_STATE["running"] = True
    try:
        n = refresh_events()
        EVENTS_STATE["message"] = f"Dividend and earnings dates updated for {n} stocks" if n else "Dividend and earnings dates are up to date"
    except Exception as exc:  # reported in Settings; never breaks price refresh
        EVENTS_STATE["message"] = f"Dividend and earnings dates failed: {exc}"
    finally:
        EVENTS_STATE["running"] = False
        EVENTS_STATE["finished_at"] = utcnow()


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
    """Dividend and earnings dates for stocks you hold. Longbridge: dividends (US/HK/SG) and earnings (HK/SG, and US
    when there is no Alpha Vantage key). Alpha Vantage: all US earnings in one request.
    Runs at most every EVENTS_EVERY_HOURS unless forced. Manual entries are never overwritten."""
    from datetime import date, timedelta

    from .providers import alphavantage_earnings, us_symbol

    with session_scope() as db:
        lb_on = get_settings(db)["longbridge_enabled"] and config.longbridge_configured()
    av_key = config.ALPHAVANTAGE_API_KEY
    lb = LongbridgeQuotes(config.LONGBRIDGE_APP_KEY, config.LONGBRIDGE_APP_SECRET, config.LONGBRIDGE_ACCESS_TOKEN,
                          ctx=_longbridge_ctx)
    with session_scope() as db:
        held_ids = {h.instrument_id for h in db.scalars(select(Holding))}
        lb_due, av_due = {}, {}
        for inst in db.scalars(select(Instrument).where(Instrument.id.in_(held_ids))):
            fresh = inst.events_checked_at and utcnow() - inst.events_checked_at < timedelta(hours=EVENTS_EVERY_HOURS)
            if fresh and not force:
                continue
            if lb_on and (sym := lb.map_symbol(inst)):
                lb_due[sym] = inst.id
            if av_key and (sym := us_symbol(inst)):
                av_due[sym] = inst.id
    if not lb_due and not av_due:
        return None
    today = date.today()
    divs: dict = {}
    earnings: list[tuple[int, dict, str]] = []  # (instrument id, earnings date, source)
    checked: set[int] = set()  # got an answer: not due again for EVENTS_EVERY_HOURS
    replaced: set[int] = set()  # earnings source answered: its old future dates are replaced
    errors = []
    if av_due:
        try:
            with _client_factory() as client:
                rows = alphavantage_earnings(client, av_key)
            earnings += [(av_due[e["symbol"]], e, "alphavantage") for e in rows if e["symbol"] in av_due]
            replaced |= set(av_due.values())
            checked |= set(av_due.values()) - set(lb_due.values())
        except ProviderError as exc:
            errors.append(str(exc))
    if lb_due:
        divs, _errs = lb.fetch_dividends(sorted(lb_due), fundamental_ctx=_longbridge_fundamental)
        checked |= {lb_due[s] for s in divs}
        lb_earn_syms = {s for s, iid in lb_due.items() if iid not in replaced}  # US via Alpha Vantage if it answered
        if lb_earn_syms:
            try:
                earnings += [(lb_due[e["symbol"]], e, "longbridge")
                             for e in lb.fetch_earnings(lb_earn_syms, today, calendar_ctx=_longbridge_calendar)]
                replaced |= {lb_due[s] for s in lb_earn_syms}
            except ProviderError as exc:
                errors.append(f"longbridge: {exc}")
    with session_scope() as db:
        for sym, iid in lb_due.items():
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
        for iid in checked:
            db.get(Instrument, iid).events_checked_at = utcnow()
        for er in db.scalars(select(EarningsDate).where(EarningsDate.instrument_id.in_(replaced),
                                                        EarningsDate.source.in_(("longbridge", "alphavantage")),
                                                        EarningsDate.date >= today)):
            db.delete(er)
        db.flush()
        for iid, e, source in earnings:
            if db.scalar(select(EarningsDate).where(EarningsDate.instrument_id == iid, EarningsDate.date == e["date"])):
                continue
            db.add(EarningsDate(instrument_id=iid, date=e["date"], session=e["session"], title=e["title"], source=source))
    if errors and not earnings and not divs:
        raise ProviderError("; ".join(errors))
    return len(set(lb_due.values()) | set(av_due.values()))
