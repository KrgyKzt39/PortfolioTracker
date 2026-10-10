# Handoff: Portfolio Tracker

Last updated 2026-10-10, end of the first (cloud) build session. Branch: `claude/keen-goodall-7je98z`.

## 1. What the product is (as agreed with the owner)

A simple, central place to see all your holdings across several brokerage accounts and track returns, without the dense stats of a broker app. Brokers stay the record of trades; this app keeps a snapshot of each holding.

Principles the owner set, in their words where possible:
- "Simple and straightforward." No complicated metrics or data points. Remove anything that is not clearly useful.
- No automatic broker syncing for now: people use several brokers for different purposes, so manual entry and file upload are fine.
- The user groups holdings into their own categories (e.g. "Blue chips"); a stock can pay dividends and still be "growth", so no fixed Dividend/Growth split.
- The user picks the base currency. Exchange rates must be automatic.
- Dividends are tracked, but an expected dividend is never counted as income until the user confirms it arrived.

## 2. Current state (working, tested)

Run: `start.bat` (real data, `data/portfolio.db`) or `start-demo.bat` (sample data, `data/demo.db`). iPhone: Safari on the same Wi-Fi, the console prints the address. See README.

Tabs:
- **Portfolio**: total value + P/L in the base currency, header FX rates for currencies you hold, Refresh, privacy eye. One card per user category. The same stock at several brokers is one row; details list "Held at" per broker (tap to edit). Add holding (stock/ETF, or fund/savings such as EPF/ASB/ASNB/unit trusts), Upload (Excel/CSV), Arrange (drag and drop; also a category picker in each stock's settings).
- **Dashboard**: value over time (one point per day, saved when the app is opened, on refresh and nightly) with 1M/3M/6M/1Y/All; "Where your money is" by category / currency / broker.
- **Dividends**: expected per year and per month, received in the last 12 months, "Did these arrive?" confirmations, month-by-month chart, by holding, recently received.
- **Calendar**: ex-dates, pay dates and earnings dates for stocks you hold (next 4 months), manual entry; Longbridge fills US/HK/SG automatically when keys are set.
- **Settings** (gear): base currency (49 currencies), price sources, brokers, categories, export/upload holdings, backup/restore; Advanced: refresh intervals, manual FX rates, change history.

Data and maths:
- Holding = broker + instrument + quantity + average cost. Funds use "amount you put in" (total) instead of a per-unit cost; price/NAV is entered (EPF/ASB at 1.00).
- Gain = (price − avg cost) × qty. P/L = gain + confirmed dividends (net of tax). Return % = P/L ÷ cost. Base-currency values use the latest FX. Missing price/FX → N/A and excluded from totals, never estimated.
- Expected dividend = user's yearly DPS if set, else last 12 months of dividend events × current quantity × (1 − withholding). US stocks default to 30% withholding.
- All money in Python `Decimal`, stored as TEXT; rounding only for display.

Prices and FX (in priority order, per symbol with fallback; last good value kept on failure):
1. Longbridge OpenAPI (official `longbridge` SDK): US, HK, SG. Also dividend and earnings dates.
2. Alpaca market data (REST, free account, IEX feed): US.
3. Alpha Vantage (optional free key): US.
4. Yahoo chart endpoint (unofficial, OFF by default): the only free source for Bursa `.KL`.
5. Manual prices / NAVs.
FX: ECB via Frankfurter, then ExchangeRate-API open endpoint (open.er-api.com) for currencies the ECB lacks, then Yahoo if enabled, then manual. "Live" only when the quote's own timestamp is < 5 minutes old.

Tests: backend 46 (`cd backend && ../.venv/bin/python -m pytest`), browser 11 at phone widths (`cd frontend && npm run build && npx playwright test`). All passing at handoff.

## 3. Code map

```
backend/app/
  models.py        schema (brokers, categories, instruments, holdings, dividend_events, dividend_payments,
                   earnings_dates, price_history, fx_rates, valuation_snapshots, settings, audit_log)
  migrations.py    PRAGMA user_version migrations. v2 converts first-version (transaction ledger) DBs.
  currencies.py    supported currencies, symbols, exchange-suffix -> currency
  holdings.py      add/edit holdings, Excel/CSV import (header detection, mapping, replace/merge), export
  valuation.py     holdings + prices + FX -> category cards and totals
  dividends.py     dividend events, confirmed payments, summary, calendar, earnings dates
  market/          providers.py (Longbridge, Alpaca, AlphaVantage, Yahoo, Frankfurter, ExchangeRate-API),
                   service.py (background refresh, fallback, Longbridge dates)
  api.py           HTTP API (Decimals returned as strings via jsonutil.DecimalRoute)
  snapshots.py     daily value history; demo.py sample data (demo DB only); backup.py; scheduler.py
  ledger.py        ONLY used by the v1 -> v2 migration
frontend/src/
  pages/           Dashboard.tsx (Portfolio tab), Overview.tsx (Dashboard tab), Dividends.tsx, Calendar.tsx
  components/      forms.tsx (all sheets), Arrange.tsx (drag and drop), SettingsSheet.tsx, ui/ (primitives)
  lib/             api.ts, hooks.ts (react-query), format.ts, types.ts
start.bat, start-demo.bat, start.sh, backend/run.py, .env.example
```

## 4. Parked and to-do list (consolidated)

### A. Next to build (owner asked for these)

1. **LLM connection setting.** One OpenAI-compatible endpoint setting (base URL, model, API key in `.env`) so the owner can use a free tier (Groq, Gemini's OpenAI-compatible endpoint, OpenRouter `:free` models) or a local model via Ollama. Keys stay server-side. Free tiers are small and change often; verify current limits on the provider pages.
2. **Statement upload with extraction.** Upload a broker statement PDF, extract its text (e.g. `pypdf`/`pdfplumber`), ask the LLM for a strict JSON list `{symbol, name, quantity, avg_cost, currency}`, then feed that into the existing import preview (`holdings.process_import` logic: same replace/merge, same review screen, nothing saved before the user confirms). Text PDFs first; note that scanned/image PDFs need OCR or a vision model. Never send more than the statement text; tell the user the text goes to the chosen LLM provider.
3. **AI assistant.** Owner wants one similar to Moomoo/Longbridge's, on the free LLM for now. Keep it narrow: a plain-language weekly summary plus Q&A about the user's own data (exposure by currency/category, which holdings drive dividends, what changed). Factual, not buy/sell advice (investment advice is licensed under Malaysia's Securities Commission); show a short disclaimer. Send a compact JSON of the portfolio, not raw history.

### B. Product work (use the Product Management plugin and the owner's `.agent` skills)

4. Competitive brief and positioning. The owner REJECTED "Malaysia-first" and "cross-broker AI" as differentiators. Known competitors: Sharesight (multi-broker incl. Bursa, paid), Snowball Analytics (dividend focus, paid tiers; Bursa coverage unconfirmed), broker apps' own AI (Moomoo, Longbridge). Re-derive the differentiator with the owner.
5. Write specs for items A1–A3 with the plugin's `write-spec` before building them, if the owner wants that process.

### C. On hold (owner said KIV)

6. **Theme / visual refresh.** Current look follows the original screenshot (deep navy, blue hero, green/red/orange). Owner wants it improved later.
7. **Letting friends use it.** Needs auth, per-user data, a cloud database, HTTPS hosting, a privacy notice (PDPA), and a market-data plan: personal Longbridge/Alpaca keys must not be used to serve other people's prices. Native app optional later (a home-screen web app works now).

### D. Verify on the owner's PC (could not be tested from the cloud container: outbound network was blocked)

8. Longbridge with real keys: prices, dividend dates (description text is parsed with a regex: `<amount> <CCY>`), earnings calendar (date and before/after-market labels).
9. Alpaca: the snapshot response shape was written from documentation knowledge, not a live call. Check `AlpacaData.fetch_prices` against a real response.
10. Frankfurter (`api.frankfurter.dev/v1/latest`), ExchangeRate-API (`open.er-api.com/v6/latest/USD`, attribution required by their terms), Yahoo (if enabled).
11. `start.bat` on Windows end to end (venv, pip, npm build, first-run iPhone prompt, firewall prompt). Only the Linux path (`start.sh` / `run.py`) was executed.

### E. Decisions already made (do not reopen without the owner)

- No Transactions tab; holdings are snapshots. Realised gains from past sales are not tracked.
- No automatic broker sync for now. No screenshot import (statement upload replaces it).
- Goal/passive-income target feature: dropped.
- OANDA FX: enterprise pricing (reported ~USD 4,850/yr, no free tier), so ECB + ExchangeRate-API are used. Revisit only if the owner wants to pay.
- Bursa dividend/earnings dates: no free reliable source; manual entry.

### F. Known rough edges

- dnd-kit swallows clicks for 50 ms after a drop (fine for people; the e2e test waits 100 ms).
- The value history only grows from the day the app is first used (demo DB has 6 months of sample history).
- `ledger.py` and the old `accounts`/`transactions` tables exist only for migrating first-version databases.
- The shareable preview artifact (claude.ai link) is a read-only build with a saved data snapshot; it is not updated automatically.

## 5. Working conventions

- Keep the UI simple; ask before adding stats or settings.
- Every feature: backend test in `backend/tests/`, browser test in `frontend/e2e/app.spec.ts` at phone width, and no horizontal scroll at 375/390/430 px.
- Money stays `Decimal` server-side; the API returns decimal strings.
- Never mark estimates as income; never label delayed/manual prices as Live.
- Secrets only in `.env` (never in the frontend). `data/` and `.env` are git-ignored.
