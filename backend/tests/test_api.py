"""End-to-end API tests on a temporary SQLite database."""
from datetime import date, timedelta
from decimal import Decimal as D

import httpx
import pytest

TODAY = date.today()


def ago(n):
    return (TODAY - timedelta(days=n)).isoformat()


def holding(pf, account, symbol):
    acct = next(a for a in pf["accounts"] if a["name"] == account)
    return next(h for h in acct["holdings"] + acct["closed"] if h["symbol"] == symbol)


def acct(pf, name):
    return next(a for a in pf["accounts"] if a["name"] == name)


def test_buy_sell_recalculates_holdings_and_pl(api):
    a = api.account("Div", layout="dividend")
    i = api.instrument("1155.KL")
    assert i["currency"] == "MYR"
    api.txn(type="BUY", trade_date=ago(30), account_id=a["id"], instrument_id=i["id"], quantity="1000", price="10", fees="20")
    api.txn(type="BUY", trade_date=ago(20), account_id=a["id"], instrument_id=i["id"], quantity="1000", price="11", fees="20")
    api.txn(type="SELL", trade_date=ago(10), account_id=a["id"], instrument_id=i["id"], quantity="500", price="12", fees="10")
    api.price(i["id"], "12.50")
    h = holding(api.portfolio(), "Div", "1155.KL")
    assert D(h["quantity"]) == 1500
    assert D(h["avg_cost"]) == D("10.52")
    assert D(h["realized"]) == 6000 - 10 - 5260
    assert D(h["unrealized"]) == 1500 * D("12.5") - 15780
    assert D(h["total_pl"]) == D(h["realized"]) + D(h["unrealized"])
    assert h["price_status"] == "Manual"


def test_multi_currency_valuation_and_consolidation(api):
    api.fx("USD", "MYR", "4.00", ago(100))
    api.fx("USD", "MYR", "4.50")
    api.fx("SGD", "MYR", "3.20")
    a1, a2 = api.account("Div", layout="dividend"), api.account("Growth")
    us = api.instrument("MSFT")
    sg = api.instrument("D05.SI")
    my = api.instrument("5176.KL")
    api.txn(type="BUY", trade_date=ago(90), account_id=a2["id"], instrument_id=us["id"], quantity="10", price="100")
    api.txn(type="BUY", trade_date=ago(90), account_id=a1["id"], instrument_id=sg["id"], quantity="100", price="30")
    api.txn(type="BUY", trade_date=ago(90), account_id=a1["id"], instrument_id=my["id"], quantity="1000", price="2")
    api.price(us["id"], 110)
    api.price(sg["id"], 32)
    api.price(my["id"], "2.10")
    pf = api.portfolio("MYR")
    h = holding(pf, "Growth", "MSFT")
    assert D(h["market_value_base"]) == 1100 * D("4.5")
    assert D(h["total_pl_base"]) == 100 * D("4.5")
    # FX effect: cost 1000 USD bought at 4.00, now 4.50 -> +500 MYR on cost basis
    assert D(h["fx_effect_base"]) == 500
    total = D(pf["totals"]["value"])
    assert total == sum(D(a["value"]) for a in pf["accounts"])
    assert total == 4950 + 3200 * D("3.2") + 2100
    assert D(pf["totals"]["pl"]) == sum(D(a["pl"]) for a in pf["accounts"])
    # Same portfolio in USD: values translate consistently
    pf_usd = api.portfolio("USD")
    assert abs(D(pf_usd["totals"]["value"]) * D("4.5") - total) < D("0.0001")


def test_missing_price_and_fx_show_na_not_zero(api):
    a = api.account("G")
    hk = api.instrument("0005.HK")
    my = api.instrument("1155.KL")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=my["id"], quantity="100", price="10")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=hk["id"], quantity="100", price="60")
    pf = api.portfolio()
    h = holding(pf, "G", "1155.KL")
    assert h["price"] is None and h["market_value"] is None and h["pl_pct"] is None
    assert h["price_status"] == "Unavailable" and pf["price_status"] == "Unavailable"
    assert pf["totals"]["incomplete"] is True
    assert pf["totals"]["pl_pct"] is None
    api.price(hk["id"], 65)
    pf = api.portfolio()
    assert holding(pf, "G", "0005.HK")["market_value_base"] is None  # no HKD->MYR rate
    assert any("HKD->MYR" in w for w in pf["warnings"])


def test_stale_provider_price_is_cached_not_live(api, client):
    from app.db import session_scope
    from app.models import PriceHistory, utcnow
    a = api.account("G")
    i = api.instrument("AAPL")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=i["id"], quantity="1", price="100")
    with session_scope() as db:
        db.add(PriceHistory(instrument_id=i["id"], price_date=TODAY, price=D(150), currency="USD", source="yahoo",
                            quality="delayed", as_of=utcnow(), fetched_at=utcnow() - timedelta(hours=5)))
    assert holding(api.portfolio(), "G", "AAPL")["price_status"] == "Cached"
    with session_scope() as db:
        db.query(PriceHistory).update({"fetched_at": utcnow()})
    pf = api.portfolio()
    assert holding(pf, "G", "AAPL")["price_status"] == "Delayed"
    assert pf["price_status"] == "Delayed"


def test_dividends_withholding_drip_and_estimates(api):
    api.fx("USD", "MYR", "4.0")
    a = api.account("Div", layout="dividend")
    j = api.instrument("JEPQ", annual_dividend_per_share="6", withholding_tax_rate="0.3")
    api.txn(type="BUY", trade_date=ago(100), account_id=a["id"], instrument_id=j["id"], quantity="100", price="50")
    api.txn(type="DIVIDEND", trade_date=ago(50), account_id=a["id"], instrument_id=j["id"], amount="50", tax="15")
    api.txn(type="DRIP", trade_date=ago(20), account_id=a["id"], instrument_id=j["id"], quantity="1", price="49",
            amount="70", tax="21")
    api.price(j["id"], 55)
    h = holding(api.portfolio(), "Div", "JEPQ")
    assert D(h["quantity"]) == 101
    assert D(h["dividends_gross"]) == 120 and D(h["dividend_tax"]) == 36 and D(h["dividends_net"]) == 84
    assert D(h["cost"]) == 5049
    assert D(h["est_annual_dividend"]) == 606
    assert D(h["est_annual_dividend_net"]) == D("424.2")
    assert abs(D(h["dividend_yield"]) - D(6) / 55 * 100) < D("1e-6")
    assert D(h["total_pl"]) == 101 * 55 - 5049 + 84
    s = api.ok(api.c.get("/api/dividends/summary"))
    assert D(s["t12m_net"]) == 84 * 4
    assert D(s["forward_annual_estimate"]) == D("424.2") * 4
    assert len(s["chart"]) == 24


def test_dividend_event_reconciliation_not_automatic(api):
    a = api.account("Div", layout="dividend")
    i = api.instrument("1155.KL", withholding_tax_rate="0")
    api.txn(type="BUY", trade_date=ago(60), account_id=a["id"], instrument_id=i["id"], quantity="1000", price="10")
    # Bought on the ex-date: not eligible
    api.txn(type="BUY", trade_date=ago(30), account_id=a["id"], instrument_id=i["id"], quantity="500", price="10")
    ev = api.ok(api.c.post("/api/dividends/events", json={
        "instrument_id": i["id"], "ex_date": ago(30), "pay_date": ago(10), "amount_per_share": "0.25",
        "status": "announced"}))
    assert D(ev["eligible_shares"]) == 1000 and D(ev["expected_net"]) == 250
    assert ev["suggested_status"] == "pending"
    pf = api.portfolio()
    assert D(holding(pf, "Div", "1155.KL")["dividends_net"]) == 0  # not converted automatically
    r = api.c.put(f"/api/dividends/events/{ev['id']}", json={"status": "received"})
    assert r.status_code == 422
    rec = api.ok(api.c.post(f"/api/dividends/events/{ev['id']}/reconcile",
                            json={"entries": [{"account_id": a["id"], "gross": "250", "tax": "0"}]}))
    assert rec["event"]["status"] == "received" and rec["event"]["reconciled"]
    assert D(holding(api.portfolio(), "Div", "1155.KL")["dividends_net"]) == 250
    dup = api.ok(api.c.post("/api/dividends/events", json={
        "instrument_id": i["id"], "ex_date": ago(30), "amount_per_share": "0.1"}), code=422)
    assert "already" in dup["detail"]["message"]


def test_split_and_transfer_via_api(api):
    a, b = api.account("A"), api.account("B")
    i = api.instrument("NVDA")
    api.txn(type="BUY", trade_date=ago(50), account_id=a["id"], instrument_id=i["id"], quantity="10", price="1000")
    api.txn(type="SPLIT", trade_date=ago(40), instrument_id=i["id"], split_ratio="10")
    api.txn(type="TRANSFER", trade_date=ago(30), account_id=a["id"], to_account_id=b["id"], instrument_id=i["id"],
            quantity="40")
    api.price(i["id"], 120)
    pf = api.portfolio("USD")
    ha, hb = holding(pf, "A", "NVDA"), holding(pf, "B", "NVDA")
    assert D(ha["quantity"]) == 60 and D(hb["quantity"]) == 40
    assert D(ha["avg_cost"]) == 100 == D(hb["avg_cost"])
    assert D(pf["totals"]["realized"]) == 0
    assert D(pf["totals"]["value"]) == 100 * 120


def test_cash_tracking_reconciles_with_ledger(api):
    a = api.account("Cash", track_cash=True)
    i = api.instrument("1155.KL")
    api.txn(type="DEPOSIT", trade_date=ago(60), account_id=a["id"], amount="20000")
    api.txn(type="BUY", trade_date=ago(50), account_id=a["id"], instrument_id=i["id"], quantity="1000", price="10", fees="15")
    api.txn(type="SELL", trade_date=ago(40), account_id=a["id"], instrument_id=i["id"], quantity="400", price="11", fees="8")
    api.txn(type="DIVIDEND", trade_date=ago(30), account_id=a["id"], instrument_id=i["id"], amount="120")
    api.txn(type="FEE", trade_date=ago(20), account_id=a["id"], amount="12")
    api.txn(type="WITHDRAWAL", trade_date=ago(10), account_id=a["id"], amount="1000")
    api.price(i["id"], 12)
    ac = acct(api.portfolio(), "Cash")
    cash = D(20000) - 10015 + 4392 + 120 - 12 - 1000
    assert D(ac["cash"]["MYR"]) == cash
    assert D(ac["value"]) == 600 * 12 + cash
    assert D(ac["net_contributions"]) == 19000
    # Deposits are not returns: value - contributions equals the computed P/L.
    assert D(ac["value_minus_contributions"]) == D(ac["pl"])


def test_validation_duplicates_and_history_edits(api, client):
    a = api.account("A")
    i = api.instrument("AAPL")
    buy = api.txn(type="BUY", trade_date=ago(10), account_id=a["id"], instrument_id=i["id"], quantity="10", price="100")
    sell = api.txn(type="SELL", trade_date=ago(5), account_id=a["id"], instrument_id=i["id"], quantity="10", price="110")
    body = {"type": "BUY", "trade_date": ago(10), "account_id": a["id"], "instrument_id": i["id"],
            "quantity": "10", "price": "100"}
    r = client.post("/api/transactions", json=body)
    assert r.status_code == 409 and r.json()["detail"]["duplicate_ids"] == [buy["id"]]
    # Editing the buy down to 5 shares would make the later sell invalid -> rejected, nothing changed
    r = client.put(f"/api/transactions/{buy['id']}", json={"quantity": "5"})
    assert r.status_code == 422 and "exceeds" in r.json()["detail"]["message"]
    assert D(client.get(f"/api/transactions/{buy['id']}").json()["quantity"]) == 10
    r = client.delete(f"/api/transactions/{buy['id']}")
    assert r.status_code == 409
    # Correct the sell, then delete it
    assert client.put(f"/api/transactions/{sell['id']}", json={"price": "120"}).status_code == 200
    assert client.delete(f"/api/transactions/{sell['id']}").status_code == 200
    detail = client.get(f"/api/transactions/{buy['id']}").json()
    assert [h["action"] for h in detail["history"]] == ["create"]
    log = client.get("/api/audit?entity=transaction").json()
    assert {"create", "update", "delete"} <= {e["action"] for e in log}
    deleted = next(e for e in log if e["action"] == "delete")
    assert '"price": "120"' in deleted["before"]
    # Future dates and bad currency rejected
    assert client.post("/api/transactions", json={**body, "trade_date": (TODAY + timedelta(days=3)).isoformat()}).status_code == 422
    assert client.post("/api/transactions", json={"type": "DEPOSIT", "trade_date": ago(1), "account_id": a["id"],
                                                  "amount": "5", "currency": "EUR"}).status_code == 422


def test_csv_import_preview_duplicates_and_export_roundtrip(api, client):
    api.account("Main")
    csv_text = (
        "Date,Action,Account,Ticker,Shares,Price,Commission,Amount,Tax,Currency\n"
        f"{ago(30)},Buy,Main,1155.KL,1000,10,15,,,\n"
        f"{ago(20)},Sell,Main,1155.KL,200,11,5,,,\n"
        f"{ago(10)},Dividend,Main,1155.KL,,,,300,,MYR\n"
        f"{ago(30)},Buy,Main,1155.KL,1000,10,15,,,\n"  # duplicate inside the file
        f"{ago(5)},Buy,Main,AAPL,1,200,,,,\n"
    )
    files = {"file": ("t.csv", csv_text.encode(), "text/csv")}
    pv = api.ok(client.post("/api/import/preview", files=files, data={"create_missing": "false"}))
    assert pv["mapping"]["quantity"] == "Shares" and pv["mapping"]["fees"] == "Commission"
    assert pv["summary"]["errors"] == 5  # unknown symbols without create_missing
    pv = api.ok(client.post("/api/import/preview", files=files, data={"create_missing": "true"}))
    assert pv["summary"] == {**pv["summary"], "valid": 4, "duplicates": 1, "errors": 0}
    assert pv["can_import"]
    assert api.ok(client.get("/api/transactions"))["total"] == 0  # preview writes nothing
    assert api.ok(client.get("/api/instruments")) == []
    res = api.ok(client.post("/api/import/commit", files=files, data={"create_missing": "true"}))
    assert res["summary"]["imported"] == 4
    again = api.ok(client.post("/api/import/preview", files=files, data={"create_missing": "true"}))
    assert again["summary"]["duplicates"] == 5 and again["summary"]["valid"] == 0
    # Oversell in CSV is caught by ledger validation
    bad = f"date,type,account,symbol,quantity,price\n{ago(1)},SELL,Main,AAPL,5,100\n"
    r = client.post("/api/import/commit", files={"file": ("b.csv", bad.encode())})
    assert r.status_code == 422
    exported = client.get("/api/transactions/export.csv")
    assert exported.status_code == 200 and exported.text.startswith("date,type,account")
    assert exported.text.count("\n") == 5
    # Export re-imported into a clean ledger matches exactly (all duplicates)
    rt = api.ok(client.post("/api/import/preview", files={"file": ("e.csv", exported.content)}))
    assert rt["summary"]["duplicates"] == 4


def test_csv_dmy_dates(api, client):
    api.account("Main")
    api.instrument("1155.KL")
    d = TODAY - timedelta(days=3)
    text = f"date,type,account,symbol,quantity,price\n{d:%d/%m/%Y},BUY,Main,1155.KL,10,1\n"
    r = api.ok(client.post("/api/import/commit", files={"file": ("x.csv", text.encode())}, data={"date_format": "dmy"}))
    assert r["summary"]["imported"] == 1
    assert api.ok(client.get("/api/transactions"))["items"][0]["trade_date"] == d.isoformat()


def test_backup_restore_and_persistence(api, client, tmp_db):
    a = api.account("Keep")
    b = api.ok(client.post("/api/backups"))
    assert b["counts"]["accounts"] == 1
    api.account("Later")
    assert len(api.ok(client.get("/api/accounts"))) == 2
    r = api.ok(client.post(f"/api/backups/{b['name']}/restore"))
    assert r["safety_backup"]
    assert [x["name"] for x in api.ok(client.get("/api/accounts"))] == ["Keep"]
    bad = client.post("/api/restore", files={"file": ("x.db", b"not a database at all")})
    assert bad.status_code == 400
    assert [x["name"] for x in api.ok(client.get("/api/accounts"))] == ["Keep"]
    # Persistence: reopen the engine on the same file
    from app import db as dbmod
    from app.migrations import migrate
    migrate(dbmod.init_engine(tmp_db))
    assert api.ok(client.get("/api/accounts"))[0]["id"] == a["id"]


def test_providers_fallback_and_last_known_good(api, monkeypatch):
    from app.market import service
    a = api.account("G")
    i = api.instrument("MSFT")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=i["id"], quantity="2", price="100")
    api.ok(api.c.put("/api/settings", json={"yahoo_enabled": True}))
    state = {"fail": False}

    def handler(req: httpx.Request):
        if state["fail"]:
            return httpx.Response(503)
        if "frankfurter" in req.url.host:
            return httpx.Response(200, json={"base": "USD", "date": TODAY.isoformat(),
                                             "rates": {"MYR": 4.2, "SGD": 1.3, "GBP": 0.75, "HKD": 7.8}})
        return httpx.Response(200, json={"chart": {"result": [{"meta": {
            "regularMarketPrice": 123.45, "regularMarketTime": 1_760_000_000, "currency": "USD"}}]}})

    monkeypatch.setattr(service, "_client_factory", lambda: httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr("app.market.providers.time.sleep", lambda s: None)
    out = service.refresh_all()
    assert out["results"]["MSFT"] == "yahoo" and "frankfurter" in out["results"]["fx"]
    pf = api.portfolio()
    h = holding(pf, "G", "MSFT")
    assert D(h["price"]) == D("123.45") and h["price_status"] == "Delayed"
    assert D(h["fx_rate"]) == D("4.2")
    state["fail"] = True
    out = service.refresh_all()
    assert "MSFT" in out["errors"] and "fx:frankfurter" in out["errors"]
    assert D(holding(api.portfolio(), "G", "MSFT")["price"]) == D("123.45")  # last known good kept
    snaps = api.ok(api.c.get("/api/snapshots"))
    assert len(snaps) == 1


def test_manual_mode_without_providers(api):
    a = api.account("Div", layout="dividend")
    f = api.instrument("ASNB", currency="MYR", kind="fund", price_mode="manual", annual_dividend_per_share="0.0475")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=f["id"], quantity="10000", price="1")
    api.price(f["id"], "1.00")
    pf = api.portfolio()
    assert pf["price_status"] == "Manual"
    h = holding(pf, "Div", "ASNB")
    assert D(h["dividend_yield"]) == D("4.75")
    assert D(acct(pf, "Div")["est_annual_dividend"]) == 475


def test_delete_guards(api, client):
    a = api.account("A")
    i = api.instrument("AAPL")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=i["id"], quantity="1", price="1")
    assert client.delete(f"/api/accounts/{a['id']}").status_code == 409
    assert client.delete(f"/api/instruments/{i['id']}").status_code == 409


@pytest.mark.parametrize("base", ["MYR", "USD", "SGD", "GBP", "HKD"])
def test_all_base_currencies(api, base):
    for q, r in (("MYR", "4.5"), ("SGD", "1.3"), ("GBP", "0.75"), ("HKD", "7.8")):
        api.fx("USD", q, r)
    a = api.account("A")
    i = api.instrument("AAPL")
    api.txn(type="BUY", trade_date=ago(5), account_id=a["id"], instrument_id=i["id"], quantity="1", price="100")
    api.price(i["id"], 100)
    pf = api.portfolio(base)
    assert pf["base_currency"] == base and D(pf["totals"]["value"]) > 0
    assert all(x["rate"] is not None for x in pf["fx"])


def test_frontend_served_or_clear_message(client):
    r = client.get("/")
    assert r.status_code in (200, 503)
    assert client.get("/api/nope").status_code == 404
