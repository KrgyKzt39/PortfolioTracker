"""Market-data provider adapters.

Provider evaluation (free, no paid subscription):
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


def get_json(client: httpx.Client, url: str, params: dict | None, limiter: RateLimiter, retries: int = 2):
    """GET with timeout, rate limiting and exponential-backoff retries on transient errors."""
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        limiter.wait()
        try:
            r = client.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
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


class YahooChart:
    name = "yahoo"
    url = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"

    def __init__(self, client: httpx.Client):
        self.client = client
        self.limiter = RateLimiter(0.5)

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


class AlphaVantage:
    name = "alphavantage"
    url = "https://www.alphavantage.co/query"

    def __init__(self, client: httpx.Client, api_key: str):
        self.client = client
        self.api_key = api_key
        self.limiter = RateLimiter(12.5)  # free tier: 5 requests/minute

    def fetch_price(self, symbol: str) -> PriceQuote:
        data = get_json(self.client, self.url, {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": self.api_key},
                        self.limiter, retries=0)
        q = data.get("Global Quote") or {}
        if "05. price" not in q:
            raise ProviderError(data.get("Note") or data.get("Information") or f"No Alpha Vantage quote for {symbol}")
        d = date.fromisoformat(q["07. latest trading day"])
        return PriceQuote(symbol, Decimal(q["05. price"]), "USD", datetime(d.year, d.month, d.day), "delayed", self.name)
