# Status

MVP complete. Last verified 2026-10-10.

## Working

- FastAPI + SQLite (SQLAlchemy, Decimal stored as TEXT) serving API and built React UI from one port.
- Schema with versioned migrations (`PRAGMA user_version`): accounts, instruments, transactions, price_history, fx_rates, dividend_events, valuation_snapshots, settings, audit_log. Cash ledger derived deterministically from transactions.
- Weighted-average ledger: buy, sell, dividend (with withholding), DRIP, deposit, withdrawal, fee, tax, split, transfer (securities and cash). Chronology and quantity validation on every create/edit/delete.
- Multi-currency valuation in any of MYR/USD/SGD/GBP/HKD with triangulated FX; FX effect on cost when historical rates exist; N/A instead of guesses.
- Dividend events: eligibility at ex-date, expected gross/tax/net per account, reconciliation into transactions, suggested "pending" status, no automatic income.
- Market data, in priority order: Longbridge (official SDK), Alpaca (REST), Alpha Vantage, Yahoo (opt-in, unofficial, only free .KL source); manual prices/NAV/FX; Frankfurter FX. Batched requests, per-symbol fallback, Live only when the quote timestamp is < 5 min old. Retries, rate limits, fallback, last-known-good, background refresh, APScheduler interval + daily snapshot.
- CSV import (mapping, date formats, preview, duplicate detection, ledger validation, atomic commit) and export (round-trips).
- Backup/restore with integrity, FK and schema checks plus automatic pre-restore backup.
- Audit log for all writes, including full deleted records.
- Four tabs, settings, forms, toasts, loading/error/empty states, privacy toggle, PWA manifest and icons, iPhone safe areas.
- `start.bat` / `start-demo.bat` (separate demo database) / `start.sh`.

## Tests

- Backend: `cd backend && ../.venv/bin/python -m pytest` → 39 passed (Longbridge/Alpaca adapters and fallback order, ledger, valuation, FX, dividends, DRIP, splits, transfers, cash reconciliation, CSV, duplicates, history edits, stale/missing prices, providers with mocked HTTP, backup/restore, persistence).
- Browser: `cd frontend && npx playwright test` → 9 passed at 390px (plus 375px and 430px overflow checks), no console errors.

## Known limitations

- UI simplified (2026-10-10): fewer stats in holding details, DV Summary reduced to yearly/monthly/last-12-months, Dividends tab has Upcoming/Received and one filter, rarely used settings under Advanced.
- Live provider endpoints (Longbridge, Alpaca, Yahoo, Frankfurter) could not be reached from the build environment (network blocked), so provider adapters are tested against mocked responses only. First real use: enable a provider in Settings and press Refresh; errors are shown in Settings.
- `start.bat` was written for Windows but executed only on Linux (via the equivalent `start.sh`/`run.py` path).
- Return % uses current cost basis; no XIRR/TWR yet.
