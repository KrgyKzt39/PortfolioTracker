"""Optional AI features on free LLM tiers: reading broker statements and answering questions.

Providers (configured in .env, keys never leave this PC except to the provider itself):
- gemini: Google Gemini native API. Reads PDFs directly (also scanned ones). Default for statements.
- groq:   Groq, OpenAI-compatible. Fast; free tier ~1,000 requests/day and 8,000 tokens/minute
          on openai/gpt-oss-120b, so prompts are kept compact. Default for the assistant.
- custom: any OpenAI-compatible endpoint (OpenRouter, a local Ollama, ...).
Each feature tries its preferred provider first, then the others that are configured.
"""
from __future__ import annotations

import base64
import io
import json
import re
from datetime import date
from decimal import Decimal

import httpx

from . import config

TIMEOUT = httpx.Timeout(90.0, connect=10.0)
_client_factory = lambda: httpx.Client(timeout=TIMEOUT)  # noqa: E731  (patched in tests)


class AIError(Exception):
    pass


def available() -> list[str]:
    out = []
    if config.GEMINI_API_KEY:
        out.append("gemini")
    if config.GROQ_API_KEY:
        out.append("groq")
    if config.LLM_BASE_URL and config.LLM_MODEL:
        out.append("custom")
    return out


def _order(preferred: str) -> list[str]:
    have = available()
    if not have:
        raise AIError("No AI provider is set up. Add GEMINI_API_KEY or GROQ_API_KEY to .env and restart.")
    return ([preferred] if preferred in have else []) + [p for p in have if p != preferred]


def _error_text(r: httpx.Response) -> str:
    try:
        d = r.json()
        msg = (d.get("error") or {}).get("message") if isinstance(d.get("error"), dict) else d.get("error")
        return str(msg or r.text[:200])
    except ValueError:
        return r.text[:200]


def _gemini(client, system: str, turns: list[dict], files: list[tuple[str, bytes]] | None = None, as_json: bool = False) -> str:
    contents = []
    for i, t in enumerate(turns):
        parts = [{"text": t["content"]}]
        if files and i == len(turns) - 1:
            parts[:0] = [{"inline_data": {"mime_type": mime, "data": base64.b64encode(b).decode()}} for mime, b in files]
        contents.append({"role": "model" if t["role"] == "assistant" else "user", "parts": parts})
    body = {"systemInstruction": {"parts": [{"text": system}]}, "contents": contents,
            "generationConfig": {"temperature": 0.1 if as_json else 0.4}}
    if as_json:
        body["generationConfig"]["responseMimeType"] = "application/json"
    r = client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{config.GEMINI_MODEL}:generateContent",
                    headers={"x-goog-api-key": config.GEMINI_API_KEY}, json=body)
    if r.status_code != 200:
        raise AIError(f"Gemini: {_error_text(r)}")
    try:
        return "".join(p.get("text", "") for p in r.json()["candidates"][0]["content"]["parts"])
    except (KeyError, IndexError, ValueError) as exc:
        raise AIError("Gemini returned no answer (it may have been blocked or the quota is used up)") from exc


def _openai_compatible(client, base: str, key: str, model: str, system: str, turns: list[dict], as_json: bool,
                       name: str) -> str:
    body = {"model": model, "messages": [{"role": "system", "content": system}] + turns,
            "temperature": 0.1 if as_json else 0.4, "max_tokens": 2500}
    if name == "groq" and "gpt-oss" in model:
        body["reasoning_effort"] = "low"  # keeps answers within the free tier's per-minute tokens
    if as_json:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    r = client.post(base.rstrip("/") + "/chat/completions", headers=headers, json=body)
    if r.status_code != 200:
        raise AIError(f"{name}: {_error_text(r)}")
    try:
        return r.json()["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as exc:
        raise AIError(f"{name} returned no answer") from exc


def complete(preferred: str, system: str, turns: list[dict], files: list[tuple[str, bytes]] | None = None,
             as_json=False) -> tuple[str, str]:
    """Returns (text, provider used). Falls back to the next provider on errors."""
    errors = []
    with _client_factory() as client:
        for p in _order(preferred):
            try:
                if p == "gemini":
                    return _gemini(client, system, turns, files, as_json), p
                if files:
                    continue  # only Gemini reads files directly; others get extracted text instead
                if p == "groq":
                    return _openai_compatible(client, "https://api.groq.com/openai/v1", config.GROQ_API_KEY,
                                              config.GROQ_MODEL, system, turns, as_json, "groq"), p
                return _openai_compatible(client, config.LLM_BASE_URL, config.LLM_API_KEY, config.LLM_MODEL,
                                          system, turns, as_json, "custom"), p
            except (AIError, httpx.HTTPError) as exc:
                errors.append(str(exc) or type(exc).__name__)
    raise AIError("; ".join(errors) or "No AI provider could handle this request")


# ---------------------------------------------------------------- statements

STATEMENT_PROMPT = """You read brokerage, fund and savings statements, or screenshots of a broker app's holdings/positions
screen (e.g. Moomoo, Longbridge, Rakuten Trade, Tiger), and list the holdings in them. Several screenshots may be parts
of one long list: combine them and list each holding once.
Return JSON only: {"statement_date": "YYYY-MM-DD or null", "holdings": [{"symbol": str, "name": str or null,
"quantity": number, "avg_cost": number or null, "total_cost": number or null, "currency": "3-letter code or null",
"kind": "stock" | "etf" | "reit" | "fund"}]}
Rules:
- Only positions still held at the statement date. Skip cash balances, trades, fees and totals.
- symbol: Bursa Malaysia stocks as their 4-digit code plus .KL (e.g. Maybank -> 1155.KL); US tickers as is (MSFT);
  Hong Kong as code.HK (0005.HK); Singapore as code.SI (D05.SI). For funds and savings (EPF, ASB, ASNB,
  unit trusts) use a short readable name such as "EPF" or "ASB" and kind "fund".
- quantity: number of shares or units. For EPF/ASB-style balances, the balance.
- avg_cost: average cost per share/unit if shown ("Avg cost", "Average price", "Cost price"). If the app shows both an
  average cost and a "diluted cost", use the average cost. total_cost: total amount invested if that is what is shown.
- Do not use the current/market price as the cost. Ignore market value, today's change and P/L columns.
- Numbers as plain numbers without currency symbols or thousands separators. Never invent values: use null.
"""


def pdf_text(content: bytes, limit: int = 60000) -> str:
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(content))
        if reader.is_encrypted:
            raise AIError("This PDF is password protected. Save an unlocked copy (Print > Save as PDF) and upload that.")
        text = "\n".join((p.extract_text() or "") for p in reader.pages[:30])
    except AIError:
        raise
    except Exception as exc:
        raise AIError(f"Could not read the PDF: {exc}") from exc
    return re.sub(r"[ \t]+", " ", text)[:limit]


def _num(v) -> Decimal | None:
    if v in (None, ""):
        return None
    try:
        d = Decimal(str(v).replace(",", "").strip())
    except Exception:
        return None
    return d if d.is_finite() and d >= 0 else None


IMAGE_TYPES = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg"}


def _file_type(content: bytes) -> str | None:
    if content.startswith(b"%PDF"):
        return "application/pdf"
    for magic, mime in IMAGE_TYPES.items():
        if content.startswith(magic):
            return mime
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content[4:8] == b"ftyp" and content[8:12] in (b"heic", b"heix", b"mif1", b"msf1", b"heis"):
        return "image/heic"
    return None


def extract_statement(files: list[tuple[bytes, str]] | bytes, filename: str = "statement.pdf") -> dict:
    """PDF statement or broker-app screenshots -> {"rows": [...], "provider": ..., "statement_date": ...}. Saves nothing."""
    if isinstance(files, bytes):
        files = [(files, filename)]
    typed = []
    for content, name in files:
        mime = _file_type(content)
        if mime is None:
            raise AIError(f"{name}: upload a PDF statement or a screenshot (PNG, JPEG or HEIC).")
        typed.append((mime, content))
    if not typed:
        raise AIError("Choose a file first.")
    if len(typed) > 10:
        raise AIError("Up to 10 screenshots at a time.")
    if sum(len(c) for _, c in typed) > 15_000_000:
        raise AIError("Files are larger than 15 MB in total")
    have = available()
    images = [t for t in typed if t[0] != "application/pdf"]
    ask = "List the holdings in these screenshots." if images else "List the holdings in this statement."
    if "gemini" in have:
        raw, used = complete("gemini", STATEMENT_PROMPT, [{"role": "user", "content": ask}], files=typed, as_json=True)
    else:
        if images:
            raise AIError("Reading screenshots needs GEMINI_API_KEY in .env (free). PDFs with text also work with Groq.")
        text = "\n\n".join(pdf_text(c) for _, c in typed)
        if len(text.strip()) < 50:
            raise AIError("This PDF has no readable text (probably scanned). Add GEMINI_API_KEY to read scanned statements.")
        raw, used = complete(have[0], STATEMENT_PROMPT, [{"role": "user", "content": f"{ask}\n\n---\n{text[:20000]}"}],
                             as_json=True)
    try:
        data = json.loads(re.sub(r"^```(json)?|```$", "", raw.strip(), flags=re.M))
    except ValueError as exc:
        raise AIError("The AI answer was not readable. Try again, or use an Excel/CSV export instead.") from exc
    rows = []
    for h in data.get("holdings") or []:
        sym = str(h.get("symbol") or "").strip().upper()[:32]
        qty = _num(h.get("quantity"))
        if not sym or not qty:
            continue
        avg = _num(h.get("avg_cost"))
        total = _num(h.get("total_cost"))
        if avg is None and total is not None:
            avg = total / qty
        rows.append({"symbol": sym, "name": (h.get("name") or None), "quantity": qty, "avg_cost": avg,
                     "currency": (str(h.get("currency") or "").upper()[:3] or None),
                     "kind": h.get("kind") if h.get("kind") in ("stock", "etf", "reit", "fund") else "stock"})
    return {"rows": rows, "provider": used, "statement_date": data.get("statement_date")}


# ---------------------------------------------------------------- assistant

ASSISTANT_PROMPT = """You are the assistant inside a personal portfolio tracker. You see a JSON snapshot of the user's
holdings (all figures in their base currency unless a field says otherwise).
- Answer only from the snapshot. If something is not in it (e.g. news, future prices), say you don't have that data.
- All "value", "cost", "pl" and "expected_yearly_dividend" figures are ALREADY in the base currency. Never convert them
  again, and label them with the base currency. Use the pre-computed "breakdown" and "top_..." lists instead of doing
  your own arithmetic or sorting. Fields ending in "_native" are in the holding's own currency.
- Use "today" for anything about dates; only call something "this week" if its date is within 7 days of today.
- Be brief and plain: at most about 6 short sentences or bullets, numbers rounded sensibly, write amounts like
  "RM 12,345". No headings, no tables, no LaTeX or formulas.
- Explain and describe; do not tell the user to buy, sell or hold anything, and do not predict prices.
  If asked for a recommendation, give the relevant facts and say the decision is theirs.
- Expected dividends are estimates, not guaranteed.
"""


def portfolio_context(pf: dict, div: dict) -> str:
    """A compact snapshot that fits a free tier's per-minute token limit."""
    def r(x, dp=2):
        return None if x in (None, "") else round(float(x), dp)

    holdings = []
    for c in pf["categories"]:
        for h in c["holdings"]:
            holdings.append({
                "symbol": h["symbol"], "name": h["name"], "category": c["name"], "currency": h["currency"],
                "qty": r(h["quantity"], 4), "value": r(h["market_value_base"]), "cost": r(h["cost_base"]),
                "pl": r(h["total_pl_base"]), "pl_pct": r(h["pl_pct"]), "dividends_received_native": r(h["dividends_net"]),
                "expected_yearly_dividend": r(h["est_annual_dividend_base"]), "yield_pct": r(h["dividend_yield"]),
                "brokers": [l["broker"] for l in h["lots"]], "price_status": h["price_status"],
            })
    total = sum(h["value"] or 0 for h in holdings) or 0

    def split(key):
        acc: dict[str, float] = {}
        for h in holdings:
            for k in ([h[key]] if key != "brokers" else h[key][:1]):
                acc[k] = acc.get(k, 0) + (h["value"] or 0)
        return {k: {"value": round(v, 2), "pct_of_portfolio": round(v / total * 100, 1) if total else None}
                for k, v in sorted(acc.items(), key=lambda kv: -kv[1])}

    snap = {
        "base_currency": pf["base_currency"],
        "today": date.today().isoformat(),
        "breakdown": {"by_currency": split("currency"), "by_category": split("category")},
        "top_by_expected_yearly_dividend": [{"symbol": h["symbol"], "expected_yearly_dividend": h["expected_yearly_dividend"]}
                                            for h in sorted(holdings, key=lambda h: -(h["expected_yearly_dividend"] or 0))[:5]
                                            if h["expected_yearly_dividend"]],
        "top_by_pl": [{"symbol": h["symbol"], "pl": h["pl"], "pl_pct": h["pl_pct"]}
                      for h in sorted(holdings, key=lambda h: -(h["pl"] or 0))[:5]],
        "bottom_by_pl": [{"symbol": h["symbol"], "pl": h["pl"], "pl_pct": h["pl_pct"]}
                         for h in sorted(holdings, key=lambda h: (h["pl"] or 0))[:3]],
        "totals": {k: r(pf["totals"][k]) for k in ("value", "cost", "pl", "pl_pct", "est_annual_dividend", "dividend_yield")},
        "fx_to_base": {f["from"]: r(f["rate"], 4) for f in pf["fx"]},
        "holdings": holdings,
        "dividends": {"received_last_12_months": r(div["t12m_net"]), "expected_per_year": r(div["forward_annual_estimate"]),
                      "upcoming": [{"symbol": e["symbol"], "ex_date": e["ex_date"], "pay_date": e["pay_date"],
                                    "expected_net_native": r(e["expected_net"]), "currency": e["currency"]}
                                   for e in div["upcoming"][:10]]},
        "warnings": pf["warnings"][:10],
    }
    return json.dumps(snap, separators=(",", ":"), default=str)


def ask(pf: dict, div: dict, messages: list[dict]) -> dict:
    turns = [{"role": m["role"], "content": str(m["content"])[:2000]} for m in messages[-8:]
             if m.get("role") in ("user", "assistant") and m.get("content")]
    if not turns or turns[-1]["role"] != "user":
        raise AIError("Ask a question first")
    system = ASSISTANT_PROMPT + "\nPortfolio snapshot:\n" + portfolio_context(pf, div)
    text, used = complete("groq", system, turns)
    return {"answer": text.strip(), "provider": used}
