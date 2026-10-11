"""Alpaca and Longbridge adapters, provider priority and fallback (no network: mocked)."""
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import httpx
import pytest

from app import config
from app.market import service
from app.market.providers import LongbridgeQuotes, quality_from_age

from conftest import row


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
    a = api.broker("G")
    for sym in ("MSFT", "BRK-B", "0005.HK", "D05.SI", "1155.KL"):
        api.holding(a["id"], sym, 1, 1)
    for q, r in (("MYR", "4.5"), ("SGD", "1.3"), ("GBP", "0.75"), ("HKD", "7.8")):
        api.fx("USD", q, r)


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
    setup_portfolio(api)
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
    assert "1155.KL" in out["errors"] and "no enabled price source" in out["errors"]["1155.KL"]
    pf = api.portfolio("USD")
    h = row(pf, "MSFT")
    assert D(h["price"]) == D("500.10") and h["price_source"] == "longbridge" and h["price_status"] == "Live"
    assert row(pf, "BRK-B")["price_status"] == "Live"
    assert row(pf, "1155.KL")["price_status"] == "Unavailable"


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
    h = row(api.portfolio(), "MSFT")
    assert h["price_source"] == "alpaca" and h["price_status"] == "Delayed"  # market closed: last trade


class FakeFundamental:
    def __init__(self, data):
        self.data = data

    def dividend(self, sym):
        @dataclass
        class Item:
            desc: str
            ex_date: str
            payment_date: str
            record_date: str = ""
            symbol: str = ""
            id: str = ""

        @dataclass
        class Resp:
            list: list

        return Resp([Item(*x) for x in self.data.get(sym, [])])


class FakeCalendar:
    def __init__(self, items):
        self.items, self.calls = items, []

    def finance_calendar(self, category, start, end, market, count, offset=0):
        self.calls.append((start, end, market))

        @dataclass
        class Info:
            symbol: str
            date: str
            content: str
            date_type: str = ""
            financial_market_time: str = ""

        @dataclass
        class Group:
            date: str
            infos: list

        @dataclass
        class Resp:
            list: list

        if offset:  # one page per day is enough for the fake
            return Resp([])
        groups = [Group(d, [Info(s, d + " (EST)", "Q3 results", "Post")]) for s, d in self.items
                  if start <= d.replace(".", "-") <= end]
        return Resp(groups)


def test_longbridge_dividend_and_earnings_dates(api, creds, monkeypatch):
    a = api.broker("LB")
    api.holding(a["id"], "MSFT", 10, 400)
    api.holding(a["id"], "1155.KL", 100, 10)
    iid = api.instrument_id("MSFT")
    soon = (date.today() + timedelta(days=30)).strftime("%Y.%m.%d")
    paid = (date.today() + timedelta(days=51)).strftime("%Y.%m.%d")
    past = (date.today() - timedelta(days=90)).strftime("%Y.%m.%d")
    past_pay = (date.today() - timedelta(days=70)).strftime("%Y.%m.%d")
    manual_ex = (date.today() - timedelta(days=180)).isoformat()
    api.ok(api.c.post("/api/dividends/events", json={"instrument_id": iid, "ex_date": manual_ex, "amount_per_share": "1.11"}))
    monkeypatch.setattr(service, "_longbridge_fundamental", FakeFundamental({"MSFT.US": [
        ("Cash dividend 0.98 USD", soon.replace(".", "/")[5:] + "/" + soon[:4], paid), ("每股派息 0.91 USD", past, past_pay),
        ("Stock dividend 1 for 10", past, past_pay), ("Dividend 0.91 USD", manual_ex.replace("-", "."), past_pay)]}))
    earn = (date.today() + timedelta(days=18)).strftime("%Y.%m.%d")
    cal = FakeCalendar([("MSFT.US", earn), ("TSLA.US", earn)])
    monkeypatch.setattr(service, "_longbridge_calendar", cal)
    assert service.refresh_events() == 1  # only MSFT maps to Longbridge
    evs = {e["ex_date"]: e for e in api.ok(api.c.get("/api/dividends/events"))}
    assert evs[soon.replace(".", "-")]["status"] == "announced" and D(evs[soon.replace(".", "-")]["amount_per_share"]) == D("0.98")
    assert evs[past.replace(".", "-")]["status"] == "pending"
    assert D(evs[manual_ex]["amount_per_share"]) == D("1.11")  # manual entry never overwritten
    cal_items = api.ok(api.c.get("/api/calendar"))
    assert [(c["kind"], c["symbol"], c.get("session")) for c in cal_items if c["kind"] == "earnings"] == [("earnings", "MSFT", "after")]
    assert {m for _, _, m in cal.calls} == {"US"} and all(s == e for s, e, _ in cal.calls)  # one day per call
    assert service.refresh_events() is None  # not due again for 12 hours


def test_fx_fallback_for_currencies_the_ecb_does_not_publish(api, monkeypatch):
    from app.market import service
    a = api.broker()
    api.holding(a["id"], "2330.TW", 1000, 500)  # TSMC -> TWD
    api.holding(a["id"], "1155.KL", 100, 10)
    seen = []

    def handler(req: httpx.Request):
        seen.append(req.url.host)
        if "frankfurter" in req.url.host:
            assert "TWD" not in req.url.params["symbols"]
            return httpx.Response(200, json={"date": date.today().isoformat(), "rates": {"MYR": 4.4}})
        if req.url.host == "open.er-api.com":
            return httpx.Response(200, json={"result": "success", "time_last_update_unix": 1_760_000_000,
                                             "rates": {"TWD": 31.5, "MYR": 4.41}})
        return httpx.Response(404)

    monkeypatch.setattr(service, "_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr("app.market.providers.time.sleep", lambda s: None)
    out = service.refresh_all()
    assert "ECB" in out["results"]["fx"] and "ExchangeRate-API" in out["results"]["fx"]
    assert "open.er-api.com" in seen
    rates = {(r["base"], r["quote"]): r for r in api.ok(api.c.get("/api/fx"))}
    assert D(rates[("USD", "TWD")]["rate"]) == D("31.5") and rates[("USD", "MYR")]["source"] == "frankfurter"
