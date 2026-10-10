"""Periodic price refresh and a daily valuation snapshot (APScheduler, in-process)."""
import logging

from apscheduler.schedulers.background import BackgroundScheduler

from . import config
from .db import session_scope
from .market import service as market
from .services import get_settings

log = logging.getLogger("portfolio.scheduler")
_sched: BackgroundScheduler | None = None


def _providers_enabled(s: dict) -> bool:
    return bool(s["yahoo_enabled"] or s["frankfurter_enabled"] or config.ALPHAVANTAGE_API_KEY
                or (s["alpaca_enabled"] and config.alpaca_configured())
                or (s["longbridge_enabled"] and config.longbridge_configured()))


def _tick():
    with session_scope() as db:
        s = get_settings(db)
    if _providers_enabled(s):
        market.start_refresh()


def _snapshot():
    from .snapshots import write_snapshot
    with session_scope() as db:
        write_snapshot(db)


def reschedule():
    if _sched is None:
        return
    with session_scope() as db:
        minutes = int(get_settings(db)["refresh_interval_minutes"])
    _sched.reschedule_job("refresh", trigger="interval", minutes=minutes)


def start():
    global _sched
    if not config.ENABLE_SCHEDULER or _sched is not None:
        return
    with session_scope() as db:
        minutes = int(get_settings(db)["refresh_interval_minutes"])
    _sched = BackgroundScheduler(daemon=True)
    _sched.add_job(_tick, "interval", minutes=minutes, id="refresh", max_instances=1, coalesce=True)
    _sched.add_job(_snapshot, "cron", hour=23, minute=50, id="snapshot", max_instances=1, coalesce=True)
    _sched.start()
    log.info("Scheduler started: refresh every %s min", minutes)


def stop():
    global _sched
    if _sched:
        _sched.shutdown(wait=False)
        _sched = None
