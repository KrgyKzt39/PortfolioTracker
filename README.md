# Portfolio Tracker

A simple, local-first place to see all your holdings across brokers in one view. It runs on your Windows PC, keeps everything in a local SQLite file, and you open it from Safari on your iPhone over home Wi-Fi. No cloud, no subscription, no account.

Your brokers stay the record of your trades. This app holds a snapshot of each holding (quantity and average cost, as your broker app shows them), adds live prices, and tracks dividends.

- **Portfolio**: total value in the base currency you choose (49 currencies), P/L and return %, one card per category you define (e.g. "Blue chips", "Dividend", "Growth"). The same stock at several brokers shows as one row, with the per-broker split in its details. Arrange stocks by dragging, or pick a category in a stock's settings.
- **Dashboard**: value over time and where your money is (by category, currency or broker).
- **Dividends**: expected per year and per month, received in the last 12 months, a month-by-month chart, each holding's expected dividend and yield, and a short "did these arrive?" list to confirm payments.
- **Calendar**: upcoming ex-dates, payment dates and earnings dates for stocks you hold.
- **Add holdings** by hand, or upload your broker's Excel (.xlsx) or CSV export with a preview first. With an AI key set, you can also upload a PDF statement.
- **Ask** (optional, Dashboard tab): plain-language questions about your own holdings, e.g. "How is my money split by currency?". Factual answers from your data, not advice.

## Run it on Windows

Requirements: [Python 3.11+](https://www.python.org/downloads/) (tick "Add to PATH") and [Node.js 20+](https://nodejs.org/) (only needed to build the UI the first time).

1. Double-click **`start.bat`**.
   - The first run creates `.venv`, installs dependencies, builds the web app and asks whether to allow iPhone access.
   - The database `data\portfolio.db` is created and migrated automatically.
2. Keep the window open. It prints the addresses to open:
   - On the PC: `http://localhost:8000`
   - On the iPhone (same Wi-Fi): `http://<your-PC-IP>:8000`
3. If Windows Firewall asks, allow Python on **Private networks only**. Make sure your Wi-Fi profile is set to Private.

To try it with sample data first, run **`start-demo.bat`**. That uses a separate `data\demo.db`; your real data is never touched. The header shows a DEMO badge.

After updating the code, run `start.bat --rebuild` to rebuild the UI.

### Add to iPhone Home Screen

Open the address in Safari → Share → **Add to Home Screen**. It opens full-screen with the app icon and respects the notch/home-indicator safe areas.

**HTTP vs HTTPS:** over plain `http://` on your LAN the app works fully (all data lives on the PC). Some PWA features need HTTPS: offline caching via a service worker, and certain standalone-mode behaviours. This app does not register a service worker, so nothing breaks; it simply needs the PC to be running.

## Configuration (`.env`)

See `.env.example`. Main settings:

| Variable | Default | Meaning |
|---|---|---|
| `PT_HOST` | `127.0.0.1` | `0.0.0.0` makes it reachable from your Wi-Fi (iPhone). |
| `PT_PORT` | `8000` | Port. |
| `PT_DATA_DIR` | `./data` | Database and backups folder. |
| `ALPHAVANTAGE_API_KEY` | empty | Optional free key for US stock prices. Kept server-side. |
| `PT_SCHEDULER` | `1` | Background refresh on the interval set in Settings. |
| `GEMINI_API_KEY` | empty | Optional free key ([aistudio.google.com](https://aistudio.google.com/apikey)). Reads statement PDFs; fallback for Ask. |
| `GROQ_API_KEY` | empty | Optional free key ([console.groq.com](https://console.groq.com/keys)). Fast answers for Ask. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | empty | Any other OpenAI-compatible endpoint (OpenRouter, local Ollama). |

**AI and your data:** statement PDFs and Ask send your holdings (symbols, amounts, broker names) to the AI provider. Free tiers may use what you send to improve their models. Nothing is sent unless you use these features.

The app has **no login**. Do not port-forward it or expose it to the internet.

## Market data

Price sources are tried in order; the first one that covers a symbol and returns a quote is used, and anything it can't price falls through to the next. Each source has timeouts, retries and rate limits, and a failed refresh keeps the last good price. Refresh runs in the background so the app never waits on it.

| Order | Source | Covers | Setup |
|---|---|---|---|
| 1 | **Longbridge OpenAPI** (official SDK) | US, Hong Kong, Singapore | Longbridge account + app key, secret, access token in `.env` |
| 2 | **Alpaca** (documented REST API) | US stocks and ETFs | Free Alpaca account (paper is fine), key ID + secret in `.env` |
| 3 | Alpha Vantage | US | Optional free key, ~25 requests/day |
| 4 | Yahoo Finance (unofficial, **off by default**) | Everything incl. Bursa (.KL) | Toggle in Settings |
| – | Longbridge dividend & earnings dates | US, HK, SG holdings | Automatic when Longbridge keys are set (every 12 h on refresh) |
| – | Manual | Anything, incl. ASNB | Always available |
| FX | Frankfurter (ECB reference rates), then ExchangeRate-API (open.er-api.com) | 49 currencies | On by default, no key |

Symbols are mapped automatically: `MSFT` → `MSFT.US`, `0005.HK` → `5.HK`, `D05.SI` → `D05.SG` for Longbridge; plain US tickers for Alpaca.

**Bursa Malaysia:** neither Longbridge nor Alpaca covers .KL stocks. For those, either enter prices manually or enable Yahoo in Settings as a last resort.

**Labels:** a price is shown as **Live** only when the quote's own timestamp is under 5 minutes old. Older quotes (delayed feeds, market closed) show **Delayed**; prices older than the freshness window or from a failed refresh show **Cached**; your entries show **Manual**; no price shows **Unavailable** and is left out of totals. Alpaca's free feed is real-time but IEX-only; Longbridge depends on your quote package.

## How the numbers are calculated

All maths uses Python `Decimal`; rounding happens only for display.

- **Gain** = (price − average cost) × quantity. Average cost is your broker's figure.
- **P/L** = gain + dividends you confirmed as received (after tax). **Return %** = P/L ÷ cost.
- A stock held at two brokers combines quantities with a weighted average cost.
- Base-currency figures use the latest FX rate. A stock with no price (or no FX rate) shows **N/A** and is left out of totals, with a warning.
- **Expected dividends** use your own yearly dividend per share if you set one, otherwise the last 12 months of dividend dates, times the quantity you hold today, after withholding tax (30% by default for US stocks, editable per stock). They are estimates and never count as income until you confirm a payment.
- Realised gains from past sales are not tracked: those live in your broker's records.

## Uploading holdings

Most broker exports work as-is. The app finds the header row (even under title rows in Excel) and guesses the columns: symbol/code/ticker, quantity/qty/shares/units, average cost/avg price/cost price, plus optional name, currency, category and broker. You can change the mapping in the preview. Values like `"2,800"` or `RM10.18` are fine.

Choose the broker, then either "This file is my full list for this broker" (stocks missing from the file are removed from that broker) or turn it off to only add or update. Nothing is saved until you press Import. Settings → Data → Export holdings gives a CSV in the same format.

Symbols: Bursa `1155.KL`, US `MSFT`, SGX `D05.SI`, HK `0005.HK`, LSE `VOD.L`. Funds without a ticker (e.g. ASNB) can use any short name with a manual price.

## Backup and restore

Settings → Data: **Backup now** writes a consistent SQLite snapshot to `data\backups\`, integrity-checked. **Restore** (from the list or an uploaded `.db`) checks the file's integrity, foreign keys, schema and version first, and saves your current data as a `pre-restore` backup before replacing it. You can also simply copy `data\portfolio.db` while the app is stopped.

## Development

```
# backend
python -m venv .venv && .venv/bin/pip install -r backend/requirements-dev.txt
cd backend && ../.venv/bin/python -m pytest

# frontend (proxies /api to :8000)
cd frontend && npm install && npm run dev

# browser tests at phone sizes (starts its own server on a temporary database)
cd frontend && npm run build && npx playwright test
```

Project layout:

```
backend/app/holdings.py     holdings, Excel/CSV import and export
backend/app/valuation.py    holdings + prices + FX -> category cards and totals
backend/app/dividends.py    dividend dates, confirmed payments, summary, calendar
backend/app/market/         price sources, Longbridge dates, background refresh
backend/app/ledger.py       only used to convert databases from the first version
backend/app/ai.py           statement PDF reading and Ask (Gemini, Groq, OpenAI-compatible)
backend/app/backup.py       backup/restore with integrity checks
backend/app/api.py          HTTP API
frontend/src/pages/         Dashboard (Portfolio), Dividends, Calendar
```

## Optional: secure remote access (not implemented)

If you later want access away from home, the simplest safe option is a private mesh VPN such as **Tailscale** on the PC and iPhone: the app stays bound to your private network, nothing is exposed publicly, and Tailscale can issue an HTTPS certificate for the PC's tailnet name (which also enables full PWA features). Avoid router port-forwarding: the app has no authentication. If you ever need public exposure, put it behind a reverse proxy with HTTPS and authentication (e.g. Caddy with basic auth or an identity-aware proxy) first.
