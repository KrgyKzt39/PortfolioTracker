# Status

Last verified 2026-10-10.

## Model

Holdings are snapshots (broker + stock + quantity + average cost) entered by hand or uploaded from a broker's Excel/CSV export. Brokers remain the record of trades; the transaction ledger from the first version was removed (old databases convert automatically: schema v2).

## Working

- Dashboard tab: value over time (daily history) and split by category / currency / broker.
- Any of 49 base currencies; FX from ECB, then ExchangeRate-API for others, then manual. Header shows only currencies you hold.
- Funds and savings (EPF, ASB, ASNB, unit trusts): balance or units plus amount put in, manual NAV.
- Portfolio tab: user-defined categories as cards, combined rows for stocks held at several brokers, per-broker detail, Arrange mode (drag and drop, plus category picker in stock settings), add/edit/remove holdings, manual prices.
- Upload: .xlsx/.csv, header detection, column guessing and mapping, replace-or-merge per broker, preview before saving.
- Dividends tab: expected per year/month, last 12 months received, "did these arrive?" confirmations, chart, by holding, recently received.
- Calendar tab: ex-dates, pay dates, earnings dates for held stocks; manual entry; Longbridge fills US/HK/SG dates automatically when configured.
- Price sources: Longbridge, Alpaca, Alpha Vantage, Yahoo (opt-in), manual; ECB FX. Live only for quotes < 5 min old.
- Backup/restore with integrity checks, audit log, privacy toggle, PWA manifest, iPhone safe areas, start.bat / start-demo.bat.

## Tests

- Backend: `cd backend && ../.venv/bin/python -m pytest` → 46 passed (currencies, funds, value history, ExchangeRate-API fallback, holdings, categories/layout, import CSV/Excel replace/merge, valuation, FX, dividends confirm flow, calendar, Longbridge prices + dates (mocked), v1→v2 migration, backup/restore).
- Browser: `cd frontend && npx playwright test` → 11 passed at 390px plus 375/430px overflow checks, no console errors.

## Known limitations

- Longbridge, Alpaca, Yahoo and Frankfurter are tested against mocked responses only (blocked from the build environment).
- Bursa dividend/earnings dates are manual (no free source).
- Visual theme to be revisited.

Next steps and the full parked list: `docs/HANDOFF.md`. Prompt for the next session: `docs/KICKSTART_PROMPT.md`.
