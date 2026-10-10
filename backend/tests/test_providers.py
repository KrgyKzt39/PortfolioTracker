"""Alpaca and Longbridge adapters, provider priority and fallback (no network: mocked)."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import httpx
import pytest

from app import config
from app.market import service
from app.market.providers import LongbridgeQuotes, quality_from_age

from test_api import ago, holding


def now_utc():
    return datetime.now(timezone.utc)


@dataclass
class LbQuote:
    symbol: str
    last_done: D
    prev_close: D
    timestamp: datetime


class FakeLbCtx:
    def __init__(self, prices=None, fail=False):
        self.prices, self.fail, self.calls = prices or {}, fail, []

    def quote(self, symbols):
        self.calls.append(list(symbols))
        if self.fail:
            raise RuntimeError("OpenApiException: connection refused")
        return [LbQuote(s, D(p), D(p), now_utc() - timedelta(minutes=1)) for s, p in self.prices.items() if s in symbols]


@pytest.fixture()
def creds(monkeypatch):
    for k, v in (("ALPACA_API_KEY_ID", "kid"), ("ALPACA_API_SECRET_KEY", "sec"), ("LONGBRIDGE_APP_KEY", "a"),
                 ("LONGBRIDGE_APP_SECRET", "b"), ("LONGBRIDGE_ACCESS_TOKEN", "c")):
        monkeypatch.setattr(config, k, v)
    monkeypatch.setattr(config, "ALPHAVANTAGE_API_KEY", "")
    monkeypatch.setattr("app.market.providers.time.sleep", lambda s: None)


def alpaca_transport(seen, prices, ts=None):
    ts = ts or (now_utc() - timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%S.123456789Z")

    def handler(req: httpx.Request):
        if "frankfurter" in req.url.host:
            return httpx.Response(200, json={"date": date.today().isoformat(), "rates": {"MYR": 4.1, "SGD": 1.3, "GBP": 0.75, "HKD": 7.8}})
        assert req.url.host == "data.alpaca.markets"
        seen.append(req)
        syms = req.url.params["symbols"].split(",")
        return httpx.Response(200, json={s: {"latestTrade": {"t": ts, "p": prices[s]}} for s in syms if s in prices})
    return httpx.MockTransport(handler)


def setup_portfolio(api):
    a = api.account("G")
    ids = {}
    for sym in ("MSFT", "BRK-B", "0005.HK", "D05.SI", "1155.KL"):
        i = api.instrument(sym)
        ids[sym] = i["id"]
        api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=i["id"], quantity="1", price="1")
    return ids


def test_symbol_mapping():
    @dataclass
    class I:
        symbol: str
        currency: str
        provider_symbol: str | None = None
    m = LongbridgeQuotes.map_symbol
    assert m(I("MSFT", "USD")) == "MSFT.US"
    assert m(I("BRK-B", "USD")) == "BRK.B.US"
    assert m(I("0005.HK", "HKD")) == "5.HK"
    assert m(I("D05.SI", "SGD")) == "D05.SG"
    assert m(I("1155.KL", "MYR")) is None
    assert m(I("VOD.L", "GBP")) is None


def test_quality_from_quote_age():
    n = datetime(2026, 1, 1, 12, 0)
    assert quality_from_age(n - timedelta(minutes=2), n) == "realtime"
    assert quality_from_age(n - timedelta(minutes=16), n) == "delayed"
    assert quality_from_age(n - timedelta(hours=10), n) == "eod"


def test_longbridge_first_then_alpaca_then_nothing_for_kl(api, creds, monkeypatch):
    ids = setup_portfolio(api)
    lb = FakeLbCtx({"MSFT.US": "500.10", "5.HK": "101.5", "D05.SG": "40.2"})  # no BRK.B quote
    monkeypatch.setattr(service, "_longbridge_ctx", lb)
    seen = []
    monkeypatch.setattr(service, "_client_factory", lambda: httpx.Client(transport=alpaca_transport(seen, {"BRK.B": 480})))
    out = service.refresh_all()
    assert lb.calls == [["5.HK", "BRK.B.US", "D05.SG", "MSFT.US"]]  # one batched call
    assert out["results"] == {**out["results"], "MSFT": "longbridge", "0005.HK": "longbridge", "D05.SI": "longbridge",
                              "BRK-B": "alpaca"}
    assert seen[0].headers["APCA-API-KEY-ID"] == "kid" and seen[0].url.params["feed"] == "iex"
    assert seen[0].url.params["symbols"] == "BRK.B"  # only what Longbridge could not price
    assert "1155.KL" in out["errors"] and "no enabled provider" in out["errors"]["1155.KL"]
    pf = api.portfolio("USD")
    h = holding(pf, "G", "MSFT")
    assert D(h["price"]) == D("500.10") and h["price_source"] == "longbridge" and h["price_status"] == "Live"
    assert holding(pf, "G", "BRK-B")["price_status"] == "Live"
    assert holding(pf, "G", "1155.KL")["price_status"] == "Unavailable"


def test_longbridge_down_falls_back_to_alpaca(api, creds, monkeypatch):
    setup_portfolio(api)
    monkeypatch.setattr(service, "_longbridge_ctx", FakeLbCtx(fail=True))
    seen = []
    monkeypatch.setattr(service, "_client_factory",
                        lambda: httpx.Client(transport=alpaca_transport(seen, {"MSFT": 499, "BRK.B": 480})))
    out = service.refresh_all()
    assert out["results"]["MSFT"] == "alpaca"
    assert "longbridge: connection refused" in out["errors"]["0005.HK"].replace("OpenApiException: ", "")


def test_old_quote_is_not_live(api, creds, monkeypatch):
    setup_portfolio(api)
    api.ok(api.c.put("/api/settings", json={"longbridge_enabled": False}))
    old = (now_utc() - timedelta(hours=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
    monkeypatch.setattr(service, "_client_factory",
                        lambda: httpx.Client(transport=alpaca_transport([], {"MSFT": 499}, ts=old)))
    service.refresh_all()
    h = holding(api.portfolio(), "G", "MSFT")
    assert h["price_source"] == "alpaca" and h["price_status"] == "Delayed"  # market closed: last trade
