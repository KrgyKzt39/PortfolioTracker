"""Market-data provider adapters.

Provider order for prices (first that supports a symbol and returns a quote wins):
1. Longbridge OpenAPI (official SDK, needs a Longbridge account + app key/secret/token):
   US, HK and SG listings. Real-time or delayed depending on your quote package.
2. Alpaca Market Data (documented REST, free account key): US stocks/ETFs. The free plan's
   real-time feed is IEX-only.
3. Alpha Vantage (documented, free key, ~25 requests/day): US.
4. Yahoo Finance chart endpoint (unofficial, opt-in): last resort, the only free source with Bursa (.KL).
Quality is derived from the quote's own timestamp, so a delayed or closing price is never shown as Live.

Other evaluated sources:
- Frankfurter (api.frankfurter.dev): documented, keyless, ECB reference rates incl. MYR, USD,
  SGD, GBP, HKD. Published once per working day -> quality "eod". Enabled by default.
- Alpha Vantage (alphavantage.co): documented, free key required (env ALPHAVANTAGE_API_KEY),
  free tier is ~25 requests/day, good for US tickers; Bursa coverage is unreliable. Quality "delayed".
- Yahoo Finance chart endpoint: covers .KL, US, SGX, HKEX, LSE, but it is NOT an officially
  documented public API and may change or rate-limit without notice. Disabled by default and
  must be switched on in Settings. Quality "delayed".
Unsupported funds (e.g. ASNB) use manual NAV entry.
"""
from __future__ import annotations

import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

import httpx

TIMEOUT = httpx.Timeout(8.0, connect=5.0)
HEADERS = {"User-Agent": "PortfolioTracker/1.0 (personal, local)"}


class ProviderError(Exception):
    pass


@dataclass
class PriceQuote:
    symbol: str
    price: Decimal
    currency: str
    as_of: datetime
    quality: str  # realtime|delayed|eod
    source: str


@dataclass
class FxQuote:
    base: str
    quote: str
    rate: Decimal
    rate_date: date
    source: str


class RateLimiter:
    """Minimum spacing between calls to one provider."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._last = 0.0
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            delta = time.monotonic() - self._last
            if delta < self.min_interval:
                time.sleep(self.min_interval - delta)
            self._last = time.monotonic()


class _Retryable(ProviderError):
    pass


def get_json(client: httpx.Client, url: str, params: dict | None, limiter: RateLimiter, retries: int = 2,
             headers: dict | None = None):
    """GET with timeout, rate limiting and exponential-backoff retries on transient errors."""
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        limiter.wait()
        try:
            r = client.get(url, params=params, headers={**HEADERS, **(headers or {})}, timeout=TIMEOUT)
            if r.status_code == 429 or r.status_code >= 500:
                raise _Retryable(f"HTTP {r.status_code}")
            if r.status_code != 200:
                raise ProviderError(f"HTTP {r.status_code}")
            return r.json()
        except (httpx.HTTPError, _Retryable, ValueError) as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(0.5 * (2 ** attempt))
    raise ProviderError(str(last_exc) or type(last_exc).__name__)


def quality_from_age(as_of: datetime, now: datetime | None = None) -> str:
    """realtime if the quote is <= 5 min old, delayed if <= 30 min, otherwise a closing/older price."""
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    age = (now - as_of).total_seconds()
    if age <= 300:
        return "realtime"
    if age <= 1800:
        return "delayed"
    return "eod"


def to_utc_naive(ts: datetime) -> datetime:
    if ts.tzinfo is None:  # assume local time; errs towards "older", never towards Live
        ts = ts.astimezone()
    return ts.astimezone(timezone.utc).replace(tzinfo=None)


class SingleQuoteBatch:
    """Adapter for providers that fetch one symbol per request."""

    def fetch_prices(self, symbols: list[str]) -> tuple[dict[str, PriceQuote], dict[str, str]]:
        quotes, errors = {}, {}
        for sym in symbols:
            try:
                quotes[sym] = self.fetch_price(sym)
            except ProviderError as exc:
                errors[sym] = str(exc)
        return quotes, errors


class FrankfurterFx:
    name = "frankfurter"
    url = "https://api.frankfurter.dev/v1/latest"

    def __init__(self, client: httpx.Client):
        self.client = client
        self.limiter = RateLimiter(1.0)

    def fetch(self, base: str, quotes: list[str]) -> list[FxQuote]:
        quotes = [q for q in quotes if q != base]
        if not quotes:
            return []
        data = get_json(self.client, self.url, {"base": base, "symbols": ",".join(quotes)}, self.limiter)
        try:
            d = date.fromisoformat(data["date"])
            return [FxQuote(base, q, Decimal(str(v)), d, self.name) for q, v in data["rates"].items()]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError(f"Unexpected Frankfurter response: {exc}") from exc


class OpenErApiFx:
    """ExchangeRate-API open access endpoint (https://www.exchangerate-api.com/docs/free).
    Free, no key, ~160 currencies, updated once a day. Their terms ask for attribution."""

    name = "exchangerate-api"
    url = "https://open.er-api.com/v6/latest/{base}"

    def __init__(self, client: httpx.Client):
        self.client = client
        self.limiter = RateLimiter(1.0)

    def fetch(self, base: str, quotes: list[str]) -> list[FxQuote]:
        quotes = [q for q in quotes if q != base]
        if not quotes:
            return []
        data = get_json(self.client, self.url.format(base=base), None, self.limiter)
        if data.get("result") != "success":
            raise ProviderError(data.get("error-type") or "ExchangeRate-API error")
        d = datetime.fromtimestamp(int(data["time_last_update_unix"]), tz=timezone.utc).date()
        rates = data.get("rates") or {}
        return [FxQuote(base, q, Decimal(str(rates[q])), d, self.name) for q in quotes if q in rates]


class YahooChart(SingleQuoteBatch):
    name = "yahoo"
    url = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

    def __init__(self, client: httpx.Client):
        self.client = client
        self.limiter = RateLimiter(0.5)

    @staticmethod
    def map_symbol(inst) -> str | None:
        return inst.provider_symbol or inst.symbol

    def fetch_price(self, symbol: str) -> PriceQuote:
        data = get_json(self.client, self.url.format(symbol=symbol), {"range": "5d", "interval": "1d"}, self.limiter)
        try:
            meta = data["chart"]["result"][0]["meta"]
            price = Decimal(str(meta["regularMarketPrice"]))
            ts = datetime.fromtimestamp(int(meta["regularMarketTime"]), tz=timezone.utc).replace(tzinfo=None)
            ccy = (meta.get("currency") or "").upper()
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ProviderError(f"No Yahoo quote for {symbol}") from exc
        if meta.get("currency") == "GBp":
            ccy, price = "GBP", price / 100
        return PriceQuote(symbol, price, ccy, ts, "delayed", self.name)

    def fetch_fx(self, base: str, quote: str) -> FxQuote:
        q = self.fetch_price(f"{base}{quote}=X")
        return FxQuote(base, quote, q.price, q.as_of.date(), self.name)


class AlphaVantage(SingleQuoteBatch):
    name = "alphavantage"
    url = "https://www.alphavantage.co/query"

    def __init__(self, client: httpx.Client, api_key: str):
        self.client = client
        self.api_key = api_key
        self.limiter = RateLimiter(12.5)  # free tier: 5 requests/minute

    @staticmethod
    def map_symbol(inst) -> str | None:
        return us_symbol(inst)

    def fetch_price(self, symbol: str) -> PriceQuote:
        data = get_json(self.client, self.url, {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": self.api_key},
                        self.limiter, retries=0)
        q = data.get("Global Quote") or {}
        if "05. price" not in q:
            raise ProviderError(data.get("Note") or data.get("Information") or f"No Alpha Vantage quote for {symbol}")
        d = date.fromisoformat(q["07. latest trading day"])
        return PriceQuote(symbol, Decimal(q["05. price"]), "USD", datetime(d.year, d.month, d.day), "delayed", self.name)


def us_symbol(inst) -> str | None:
    """Plain US ticker for a USD instrument without an exchange suffix (BRK-B -> BRK.B)."""
    sym = inst.symbol.upper()
    if inst.currency != "USD" or any(sym.endswith(s) for s in (".KL", ".SI", ".HK", ".L", ".SG")):
        return None
    return sym.replace("-", ".")


class AlpacaData:
    """Alpaca Market Data v2 multi-symbol snapshots (https://docs.alpaca.markets)."""

    name = "alpaca"
    url = "https://data.alpaca.markets/v2/stocks/snapshots"

    def __init__(self, client: httpx.Client, key_id: str, secret: str, feed: str = "iex"):
        self.client = client
        self.auth = {"APCA-API-KEY-ID": key_id, "APCA-API-SECRET-KEY": secret}
        self.feed = feed
        self.limiter = RateLimiter(0.4)  # free plan allows 200 requests/minute

    @staticmethod
    def map_symbol(inst) -> str | None:
        return us_symbol(inst)

    def fetch_prices(self, symbols: list[str]) -> tuple[dict[str, PriceQuote], dict[str, str]]:
        quotes, errors = {}, {}
        for i in range(0, len(symbols), 100):
            chunk = symbols[i:i + 100]
            data = get_json(self.client, self.url, {"symbols": ",".join(chunk), "feed": self.feed}, self.limiter,
                            headers=self.auth)
            snaps = data.get("snapshots", data) if isinstance(data, dict) else {}
            for sym in chunk:
                snap = snaps.get(sym) or {}
                trade, bar = snap.get("latestTrade") or {}, snap.get("dailyBar") or {}
                try:
                    if trade.get("p"):
                        price, ts = trade["p"], trade["t"]
                    elif bar.get("c"):
                        price, ts = bar["c"], bar["t"]
                    else:
                        errors[sym] = "no data returned"
                        continue
                    as_of = _parse_rfc3339(ts)
                    quotes[sym] = PriceQuote(sym, Decimal(str(price)), "USD", as_of, quality_from_age(as_of), self.name)
                except (KeyError, ValueError, TypeError) as exc:
                    errors[sym] = f"unexpected response: {exc}"
        return quotes, errors


def _parse_rfc3339(ts: str) -> datetime:
    # Alpaca uses nanosecond precision, e.g. 2026-10-09T19:59:59.123456789Z
    ts = ts.replace("Z", "+00:00")
    if "." in ts:
        head, rest = ts.split(".", 1)
        frac = "".join(ch for ch in rest if ch.isdigit())
        tz = rest[len(frac):]
        ts = f"{head}.{frac[:6]}{tz}"
    return to_utc_naive(datetime.fromisoformat(ts))


class LongbridgeQuotes:
    """Longbridge OpenAPI via the official `longbridge` SDK (QuoteContext.quote)."""

    name = "longbridge"
    TIMEOUT_S = 20

    def __init__(self, app_key: str, app_secret: str, access_token: str, ctx=None):
        self._creds = (app_key, app_secret, access_token)
        self._ctx = ctx

    @staticmethod
    def map_symbol(inst) -> str | None:
        sym = inst.symbol.upper()
        if sym.endswith(".HK"):
            code = sym[:-3].lstrip("0") or "0"
            return f"{code}.HK"
        if sym.endswith(".SI"):
            return f"{sym[:-3]}.SG"
        us = us_symbol(inst)
        return f"{us}.US" if us else None

    def _config(self):
        try:
            from longbridge.openapi import Config, Language
        except ImportError as exc:
            raise ProviderError("longbridge package not installed (run start.bat again)") from exc
        return Config.from_apikey(*self._creds, language=Language.EN, enable_print_quote_packages=False)

    def _context(self):
        if self._ctx is None:
            from longbridge.openapi import QuoteContext
            self._ctx = QuoteContext(self._config())
        return self._ctx

    def _run(self, fn, timeout=None):
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            return pool.submit(fn).result(timeout=timeout or self.TIMEOUT_S)
        except FutTimeout as exc:
            raise ProviderError("timed out") from exc
        except ProviderError:
            raise
        except Exception as exc:  # SDK raises its own OpenApiException
            raise ProviderError(str(exc) or type(exc).__name__) from exc
        finally:
            pool.shutdown(wait=False)

    def fetch_dividends(self, symbols: list[str], fundamental_ctx=None) -> tuple[dict[str, list[dict]], dict[str, str]]:
        """Dividend history and announcements per symbol: [{ex_date, pay_date, amount, currency}]."""
        def call():
            ctx = fundamental_ctx
            if ctx is None:
                from longbridge.openapi import FundamentalContext
                ctx = FundamentalContext(self._config())
            out, errs = {}, {}
            for sym in symbols:
                try:
                    out[sym] = [d for d in (parse_dividend(x) for x in ctx.dividend(sym).list) if d]
                except Exception as exc:  # one bad symbol must not stop the rest
                    errs[sym] = str(exc) or type(exc).__name__
            return out, errs
        return self._run(call, timeout=60)

    def fetch_earnings(self, symbols: set[str], start: date, days: int = 60, calendar_ctx=None) -> list[dict]:
        """Earnings dates for the given symbols from the market-wide calendar.
        The endpoint returns one day per request, so we ask day by day and page within each day."""
        markets = sorted({s.rsplit(".", 1)[-1] for s in symbols})

        def call():
            from datetime import timedelta
            ctx = calendar_ctx
            if ctx is None:
                from longbridge.openapi import CalendarContext
                ctx = CalendarContext(self._config())
            category = _report_category()
            found = []
            for market in markets:
                for n in range(days):
                    day = (start + timedelta(days=n)).isoformat()
                    offset = 0
                    for _ in range(5):  # page within a busy day
                        resp = ctx.finance_calendar(category, day, day, market, 500, offset)
                        infos = [i for g in resp.list for i in g.infos]
                        if not infos:
                            break
                        for info in infos:
                            if info.symbol in symbols:
                                e = parse_earnings(info)
                                if e:
                                    found.append(e)
                        offset += len(infos)
            return found
        return self._run(call, timeout=600)

    def fetch_prices(self, symbols: list[str]) -> tuple[dict[str, PriceQuote], dict[str, str]]:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout

        def call():
            ctx = self._context()
            out = []
            for i in range(0, len(symbols), 50):
                out.extend(ctx.quote(symbols[i:i + 50]))
            return out

        pool = ThreadPoolExecutor(max_workers=1)
        try:
            rows = pool.submit(call).result(timeout=self.TIMEOUT_S)
        except FutTimeout as exc:
            raise ProviderError("timed out") from exc
        except ProviderError:
            raise
        except Exception as exc:  # SDK raises its own OpenApiException
            raise ProviderError(str(exc) or type(exc).__name__) from exc
        finally:
            pool.shutdown(wait=False)
        quotes, errors = {}, {}
        for r in rows:
            try:
                price = Decimal(str(r.last_done))
                as_of = to_utc_naive(r.timestamp)
                quality = quality_from_age(as_of)
                if price <= 0:  # suspended / no trade yet: fall back to previous close
                    price, quality = Decimal(str(r.prev_close)), "eod"
                if price > 0:
                    quotes[r.symbol] = PriceQuote(r.symbol, price, "", as_of, quality, self.name)
            except (AttributeError, ValueError, TypeError) as exc:
                errors[getattr(r, "symbol", "?")] = f"unexpected response: {exc}"
        for sym in symbols:
            if sym not in quotes and sym not in errors:
                errors[sym] = "no quote returned (check your Longbridge quote permissions for this market)"
        return quotes, errors


_DPS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([A-Z]{3})\b")


def _lb_date(v: str) -> date | None:
    """Longbridge dates: "2026.11.19" (Chinese responses) or "11/19/2026" (English), sometimes with a suffix."""
    v = (v or "").strip().split(" ")[0]
    for fmt in ("%Y.%m.%d", "%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def parse_dividend(item) -> dict | None:
    """Longbridge DividendItem -> dict. Only cash dividends with an explicit amount and currency."""
    m = _DPS_RE.search(item.desc or "")
    ex = _lb_date(item.ex_date)
    if not m or not ex:
        return None
    amount = Decimal(m.group(1))
    if amount <= 0:
        return None
    return {"ex_date": ex, "pay_date": _lb_date(item.payment_date), "amount": amount, "currency": m.group(2)}


def parse_earnings(info) -> dict | None:
    d = _lb_date(info.date)
    if not d:
        return None
    t = f"{getattr(info, 'financial_market_time', '')} {getattr(info, 'date_type', '')}".lower()
    session = "before" if ("before" in t or "pre" in t or "盘前" in t) else "after" if ("after" in t or "post" in t or "盘后" in t) else None
    return {"symbol": info.symbol, "date": d, "session": session, "title": (info.content or "")[:120] or None}


def _report_category():
    from longbridge.openapi import CalendarCategory
    return CalendarCategory.Report
