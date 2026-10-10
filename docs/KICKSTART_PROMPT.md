# Kickstart prompt for the next session

Paste this into a new local Claude Code session opened in the PortfolioTracker folder (after `git pull` of branch `claude/keen-goodall-7je98z`).

---

You're picking up my Portfolio Tracker project. Before doing anything:

1. Read `docs/HANDOFF.md` (product principles, current state, parked list, decisions), `CLAUDE.md`, `README.md` and `STATUS.md`.
2. List the skills and plugins available in this session, including my `.agent` folder skills and the Product Management plugin, and tell me in two lines which ones you'll use for what. Use them; the previous cloud session couldn't access them.
3. Run the checks and tell me the result: `cd backend && ../.venv/bin/python -m pytest -q` and `cd frontend && npm run build && npx playwright test`. If `.venv` or `node_modules` are missing, set them up first (see README).
4. Run `start-demo.bat` (or `start.sh` with `PT_DEMO=1` on Mac/Linux) and confirm the app opens at http://localhost:8000.

Then work through the handoff list in this order, checking with me at each step:

- **D. Verify on this PC** (items 8–11): test the live price/FX/date sources with my keys from `.env` and fix anything that doesn't match the real responses (Alpaca's response shape especially). Run `start.bat` once on Windows end to end.
- **B. Product work** (items 4–5): use the Product Management plugin to write a short competitive brief and propose the real differentiator. Remember I rejected "Malaysia-first" and "cross-broker AI". Keep it brief and ask before writing long specs.
- **A. Build** (items 1–3): the LLM connection setting (OpenAI-compatible: Groq, Gemini, OpenRouter, or local Ollama), then statement PDF upload with extraction into the existing import preview, then the narrow AI assistant (summary + Q&A on my data, factual only, not advice).

Ground rules: keep the app simple, with no extra stats or settings unless I ask. Every feature gets tests (backend plus a phone-width browser test). Never count expected dividends as income, never label delayed or manual prices as Live, keep money as Decimal, and keep secrets in `.env`. Theme refresh and sharing with friends are on hold until I say so. Commit in small steps with clear messages, and tell me plainly what you verified and what you couldn't.
