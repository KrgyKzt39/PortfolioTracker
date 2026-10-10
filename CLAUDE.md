# Portfolio Tracker

Local-first, mobile-first portfolio tracker: FastAPI + SQLite backend serving a React (Vite, Tailwind) PWA on one port. Start with `docs/HANDOFF.md` for product principles, current state and the parked list.

## Commands

- Backend tests: `cd backend && ../.venv/bin/python -m pytest -q` (Windows: `..\.venv\Scripts\python -m pytest -q`)
- Frontend typecheck/build: `cd frontend && npx tsc -b && npm run build`
- Browser tests (phone widths, own temp DB): `cd frontend && npm run build && npx playwright test`
- Run with sample data: `start-demo.bat` (or `PT_DEMO=1 ./start.sh`); real data: `start.bat`
- Dev UI with hot reload: `cd frontend && npm run dev` (proxies `/api` to :8000)

## Conventions

- Holdings are snapshots (broker + instrument + quantity + average cost); there is no transaction ledger. `backend/app/ledger.py` is only used by the v1→v2 migration.
- Money and quantities are `Decimal` end to end; stored as TEXT; API returns decimal strings (`jsonutil.DecimalRoute`). Round only for display (`frontend/src/lib/format.ts`).
- Schema changes: add a step to `MIGRATIONS` in `backend/app/migrations.py` (never edit an old step).
- Missing price or FX → N/A and excluded from totals. Expected dividends are never income until confirmed. "Live" only for quotes < 5 minutes old.
- Keep the UI simple: the owner wants a clean central view, not a broker app. Ask before adding stats or settings.
- Every feature gets a backend test and a phone-width Playwright test; no horizontal scroll at 375/390/430 px.
- Secrets live in `.env` only (see `.env.example`); `data/` and `.env` are git-ignored.
