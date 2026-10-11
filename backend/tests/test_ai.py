"""AI statement reading and assistant (no network: provider HTTP is mocked)."""
import io
import json
from decimal import Decimal as D

import httpx
import pytest
from pypdf import PdfWriter

from app import ai, config


def blank_pdf() -> bytes:
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


@pytest.fixture()
def keys(monkeypatch):
    for k, v in (("GEMINI_API_KEY", "g"), ("GROQ_API_KEY", "q"), ("LLM_BASE_URL", ""), ("LLM_MODEL", "")):
        monkeypatch.setattr(config, k, v)


def mock(monkeypatch, handler):
    seen = []

    def wrapped(req: httpx.Request):
        seen.append(req)
        return handler(req)
    monkeypatch.setattr(ai, "_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(wrapped)))
    return seen


def gemini_reply(text):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": text}]}}]})


def groq_reply(text):
    return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})


STATEMENT = {"statement_date": "2026-09-30", "holdings": [
    {"symbol": "1155.kl", "name": "Malayan Banking", "quantity": "1,000", "avg_cost": "9.10", "currency": "MYR", "kind": "stock"},
    {"symbol": "ASNB", "name": "ASN Bersama", "quantity": 5000, "total_cost": 5000, "currency": "MYR", "kind": "fund"},
    {"symbol": "", "quantity": 3},  # dropped: no symbol
    {"symbol": "X", "quantity": 0},  # dropped: no quantity
]}


def test_status_lists_configured_providers(client, keys):
    assert client.get("/api/ai/status").json() == {"providers": ["gemini", "groq"]}
    assert client.get("/api/meta").json()["ai_providers"] == ["gemini", "groq"]


def test_statement_pdf_goes_to_gemini_and_rows_are_normalised(client, keys, monkeypatch):
    seen = mock(monkeypatch, lambda req: gemini_reply("```json\n" + json.dumps(STATEMENT) + "\n```"))
    r = client.post("/api/ai/statement", files={"file": ("s.pdf", blank_pdf(), "application/pdf")})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["provider"] == "gemini" and d["statement_date"] == "2026-09-30"
    assert [(x["symbol"], D(x["quantity"]), D(x["avg_cost"]), x["kind"]) for x in d["rows"]] == [
        ("1155.KL", D("1000"), D("9.10"), "stock"), ("ASNB", D("5000"), D("1"), "fund")]
    req = seen[0]
    assert "generativelanguage.googleapis.com" in req.url.host and req.headers["x-goog-api-key"] == "g"
    body = json.loads(req.content)
    assert body["contents"][0]["parts"][0]["inline_data"]["mime_type"] == "application/pdf"
    assert body["generationConfig"]["responseMimeType"] == "application/json"


def test_statement_rejects_non_pdf_and_scanned_without_gemini(client, keys, monkeypatch):
    r = client.post("/api/ai/statement", files={"file": ("s.csv", b"a,b", "text/csv")})
    assert r.status_code == 422 and "PDF" in r.json()["detail"]["message"]
    monkeypatch.setattr(config, "GEMINI_API_KEY", "")
    r = client.post("/api/ai/statement", files={"file": ("s.pdf", blank_pdf(), "application/pdf")})
    assert r.status_code == 422 and "no readable text" in r.json()["detail"]["message"]


def test_no_provider_configured(client, monkeypatch):
    for k in ("GEMINI_API_KEY", "GROQ_API_KEY", "LLM_BASE_URL", "LLM_MODEL"):
        monkeypatch.setattr(config, k, "")
    r = client.post("/api/ai/ask", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 422 and "No AI provider" in r.json()["detail"]["message"]


def test_ask_uses_groq_with_snapshot_and_falls_back_to_gemini(api, keys, monkeypatch):
    b = api.broker("Moomoo")
    api.holding(b["id"], "MSFT", 10, 400)
    api.price(api.instrument_id("MSFT"), 500)

    def ok(req):
        assert req.url.host == "api.groq.com" and req.headers["authorization"] == "Bearer q"
        body = json.loads(req.content)
        assert body["model"] == config.GROQ_MODEL and body["messages"][0]["role"] == "system"
        assert '"symbol":"MSFT"' in body["messages"][0]["content"]
        assert [m["role"] for m in body["messages"][1:]] == ["user", "assistant", "user"]
        return groq_reply("  You hold MSFT.  ")
    mock(monkeypatch, ok)
    msgs = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"},
            {"role": "user", "content": "what do I hold?"}, {"role": "system", "content": "ignored"}]
    assert api.ok(api.c.post("/api/ai/ask", json={"messages": msgs})) == {"answer": "You hold MSFT.", "provider": "groq"}

    def groq_down(req):
        if req.url.host == "api.groq.com":
            return httpx.Response(429, json={"error": {"message": "Rate limit reached"}})
        return gemini_reply("From Gemini")
    mock(monkeypatch, groq_down)
    assert api.ok(api.c.post("/api/ai/ask", json={"messages": msgs[:1]}))["provider"] == "gemini"

    mock(monkeypatch, lambda req: httpx.Response(500, text="boom"))
    r = api.c.post("/api/ai/ask", json={"messages": msgs[:1]})
    assert r.status_code == 422 and "Rate limit" not in r.json()["detail"]["message"] and "groq" in r.json()["detail"]["message"]


def test_ask_needs_a_question(client, keys):
    r = client.post("/api/ai/ask", json={"messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 422
