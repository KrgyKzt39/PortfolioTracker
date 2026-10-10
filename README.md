# Portfolio Tracker

A local-first, mobile-first investment portfolio tracker. It runs on your Windows PC, stores everything in a local SQLite file, and you open it from Safari on your iPhone over your home Wi-Fi. No cloud, no subscription, no account.

- **Dashboard**: total value in your base currency (MYR, USD, SGD, GBP, HKD), P/L and return %, FX rates, account cards (dividend or growth layout), expandable holding details, privacy toggle, refresh.
- **DV Summary**: forward dividend estimate, trailing-12-month income, monthly received vs expected chart, contribution by holding/account/currency, yield and yield on cost, year-by-year history.
- **Transactions**: buy, sell, dividend, dividend reinvestment, deposit, withdrawal, fee, tax, stock split, transfer between accounts. Search and filters, edit/delete with history checks, duplicate detection, CSV import (column mapping and preview) and export.
- **Dividends**: ex-date / pay-date event ledger, forecast, announced, pending and received statuses, eligible shares, withholding tax, reconciliation of what actually arrived.

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

The app has **no login**. Do not port-forward it or expose it to the internet.

## Market data

Price sources are tried in order; the first one that covers a symbol and returns a quote is used, and anything it can't price falls through to the next. Each source has timeouts, retries and rate limits, and a failed refresh keeps the last good price. Refresh runs in the background so the app never waits on it.

| Order | Source | Covers | Setup |
|---|---|---|---|
| 1 | **Longbridge OpenAPI** (official SDK) | US, Hong Kong, Singapore | Longbridge account + app key, secret, access token in `.env` |
| 2 | **Alpaca** (documented REST API) | US stocks and ETFs | Free Alpaca account (paper is fine), key ID + secret in `.env` |
| 3 | Alpha Vantage | US | Optional free key, ~25 requests/day |
| 4 | Yahoo Finance (unofficial, **off by default**) | Everything incl. Bursa (.KL) | Toggle in Settings |
| – | Manual | Anything, incl. ASNB | Always available |
| FX | Frankfurter (ECB reference rates) | MYR, USD, SGD, GBP, HKD | On by default, no key |

Symbols are mapped automatically: `MSFT` → `MSFT.US`, `0005.HK` → `5.HK`, `D05.SI` → `D05.SG` for Longbridge; plain US tickers for Alpaca.

**Bursa Malaysia:** neither Longbridge nor Alpaca covers .KL stocks. For those, either enter prices manually or enable Yahoo in Settings as a last resort.

**Labels:** a price is shown as **Live** only when the quote's own timestamp is under 5 minutes old. Older quotes (delayed feeds, market closed) show **Delayed**; prices older than the freshness window or from a failed refresh show **Cached**; your entries show **Manual**; no price shows **Unavailable** and is left out of totals. Alpaca's free feed is real-time but IEX-only; Longbridge depends on your quote package.

## How the numbers are calculated

Transactions are the single source of truth. Everything else (holdings, cost, P/L, cash, dividends) is recomputed from them with Python `Decimal`. Rounding happens only for display.

- **Cost basis**: weighted-average cost, including buy fees.
- **Realised P/L**: sale proceeds minus sale fees minus average cost of the shares sold.
- **Capital gain** = unrealised + realised. **Total P/L** = capital gain + net dividends − fees/taxes.
- **Return %** = total P/L ÷ current cost basis (N/A if there is no cost basis or no price).
- **Dividends**: recorded gross with withholding tax, so net = gross − tax. Reinvested dividends (DRIP) count as income once and add shares at the reinvested cost.
- **Splits** change share count, not total cost. **Transfers** move shares with their cost basis and realise nothing.
- **Deposits/withdrawals** are contributions, never returns. Turn on *Track cash* for an account to include its cash balance in value; the account detail then shows value minus net contributions, which reconciles with P/L.
- **Multi-currency**: each holding is valued in its own currency and translated at the latest FX rate. If historical FX rates exist (stored rates, or the FX rate entered on a trade) the app also shows the **FX effect** on cost separately from price movement.
- **Dividend estimates** use your forward dividend per share if set, otherwise trailing-12-month dividends. Estimates are labelled and never turned into income: an expected dividend becomes income only when you reconcile it.
- **Eligibility**: shares held at the close of the day before the ex-date.

Edits and deletes replay the entire history. If a change would make any point in time invalid (for example deleting a buy that a later sale depends on), it is rejected and nothing changes. Every change is written to the audit log (Settings → Audit history), including the full deleted record.

## CSV format

```
date,type,account,to_account,symbol,quantity,price,amount,fees,tax,currency,fx_rate,fx_currency,split_ratio,note
2026-01-15,BUY,Dividend Acc,,1155.KL,1000,10.18,,15,,MYR,,,,
2026-03-01,DIVIDEND,Dividend Acc,,1155.KL,,,300,0,,MYR,,,,
```

Exports use exactly this format, so they re-import cleanly (as duplicates, which are skipped by default). Import lets you map differently named columns, choose the date format (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY), optionally create missing accounts/instruments, and previews every row before writing anything.

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
backend/app/ledger.py       accounting engine (pure functions)
backend/app/valuation.py    holdings + prices + FX -> dashboard numbers
backend/app/dividends.py    events, eligibility, reconciliation, summaries
backend/app/market/         provider adapters and background refresh
backend/app/csv_io.py       CSV import/export
backend/app/backup.py       backup/restore with integrity checks
backend/app/api.py          HTTP API
frontend/src/pages/         Dashboard, DvSummary, Transactions, Dividends
```

## Optional: secure remote access (not implemented)

If you later want access away from home, the simplest safe option is a private mesh VPN such as **Tailscale** on the PC and iPhone: the app stays bound to your private network, nothing is exposed publicly, and Tailscale can issue an HTTPS certificate for the PC's tailnet name (which also enables full PWA features). Avoid router port-forwarding: the app has no authentication. If you ever need public exposure, put it behind a reverse proxy with HTTPS and authentication (e.g. Caddy with basic auth or an identity-aware proxy) first.
