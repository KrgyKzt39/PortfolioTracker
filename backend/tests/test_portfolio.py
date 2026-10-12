"""Holdings, categories, valuation, import and backup through the public API."""
import io
from datetime import date, timedelta
from decimal import Decimal as D

import pytest

from conftest import card, row

TODAY = date.today()


def ago(n):
    return (TODAY - timedelta(days=n)).isoformat()


def test_same_stock_at_two_brokers_is_one_row(api):
    a, b = api.broker("Rakuten Trade"), api.broker("Moomoo")
    cat = api.category("Blue chips")
    api.holding(a["id"], "1155.KL", 1000, "10.00", category_id=cat["id"])
    api.holding(b["id"], "1155.kl", 3000, "11.00")
    iid = api.instrument_id("1155.KL")
    api.price(iid, "12")
    h = row(api.portfolio(), "1155.KL")
    assert D(h["quantity"]) == 4000
    assert D(h["avg_cost"]) == D("10.75")  # (10,000 + 33,000) / 4,000
    assert D(h["gain"]) == 48000 - 43000
    assert [l["broker"] for l in h["lots"]] == ["Moomoo", "Rakuten Trade"]
    assert card(api.portfolio(), "Blue chips")["holdings"][0]["symbol"] == "1155.KL"


def test_adding_existing_holding_updates_it(api):
    a = api.broker()
    api.holding(a["id"], "MSFT", 10, 400)
    api.holding(a["id"], "MSFT", 12, 410)
    hs = api.ok(api.c.get("/api/holdings"))
    assert len(hs) == 1 and D(hs[0]["quantity"]) == 12 and D(hs[0]["avg_cost"]) == 410


def test_pl_includes_dividends_received(api):
    api.fx("USD", "MYR", "4.0")
    a = api.broker()
    api.holding(a["id"], "JEPQ", 100, 50)
    iid = api.instrument_id("JEPQ")
    api.price(iid, 55)
    api.ok(api.c.post("/api/dividends/payments", json={"instrument_id": iid, "gross": "50", "tax": "15", "pay_date": ago(5)}))
    pf = api.portfolio("MYR")
    h = row(pf, "JEPQ")
    assert D(h["gain"]) == 500 and D(h["dividends_net"]) == 35
    assert D(h["total_pl"]) == 535 and D(h["pl_pct"]) == D("10.7")
    assert D(h["total_pl_base"]) == 2140
    assert D(pf["totals"]["value"]) == 5500 * 4


def test_values_consistent_across_categories_and_currencies(api):
    for q, r in (("MYR", "4.5"), ("SGD", "1.3"), ("GBP", "0.75"), ("HKD", "7.8")):
        api.fx("USD", q, r)
    a = api.broker()
    c1, c2 = api.category("Income", True), api.category("Growth")
    api.holding(a["id"], "D05.SI", 100, 30, category_id=c1["id"])
    api.holding(a["id"], "5176.KL", 1000, 2, category_id=c1["id"])
    api.holding(a["id"], "NVDA", 10, 100, category_id=c2["id"])
    for s, p in (("D05.SI", 32), ("5176.KL", "2.10"), ("NVDA", 120)):
        api.price(api.instrument_id(s), p)
    pf = api.portfolio("MYR")
    assert D(pf["totals"]["value"]) == sum(D(c["value"]) for c in pf["categories"])
    expected = 3200 * (D("4.5") / D("1.3")) + 2100 + 1200 * D("4.5")
    assert abs(D(pf["totals"]["value"]) - expected) < D("0.0001")
    for base in ("USD", "SGD", "GBP", "HKD"):
        other = api.portfolio(base)
        assert all(f["rate"] is not None for f in other["fx"])
        rate = D("4.5") if base == "USD" else None
        if rate:
            assert abs(D(other["totals"]["value"]) * rate - expected) < D("0.0001")


def test_missing_price_is_na_and_excluded(api):
    a = api.broker()
    api.holding(a["id"], "1155.KL", 100, 10)
    api.holding(a["id"], "5258.KL", 100, 2)
    api.price(api.instrument_id("5258.KL"), "2.5")
    pf = api.portfolio()
    h = row(pf, "1155.KL")
    assert h["price"] is None and h["market_value"] is None and h["pl_pct"] is None
    assert h["price_status"] == "Unavailable" and pf["price_status"] == "Partial"
    assert D(pf["totals"]["value"]) == 250 and pf["totals"]["incomplete"]


def test_stale_provider_price_shows_cached(api):
    from app.db import session_scope
    from app.models import PriceHistory, utcnow
    api.fx("USD", "MYR", "4.5")
    a = api.broker()
    api.holding(a["id"], "AAPL", 1, 100)
    iid = api.instrument_id("AAPL")
    with session_scope() as db:
        db.add(PriceHistory(instrument_id=iid, price_date=TODAY, price=D(150), currency="USD", source="alpaca",
                            quality="realtime", as_of=utcnow(), fetched_at=utcnow() - timedelta(hours=5)))
    assert row(api.portfolio(), "AAPL")["price_status"] == "Cached"
    with session_scope() as db:
        db.query(PriceHistory).update({"fetched_at": utcnow()})
    assert row(api.portfolio(), "AAPL")["price_status"] == "Live"


def test_layout_moves_and_orders_stocks(api, client):
    a = api.broker()
    c1, c2 = api.category("Dividend"), api.category("Growth")
    for s in ("AAPL", "MSFT", "NVDA"):
        api.holding(a["id"], s, 1, 1, category_id=c1["id"])
    ids = {s: api.instrument_id(s) for s in ("AAPL", "MSFT", "NVDA")}
    api.ok(client.put("/api/layout", json={"categories": [
        {"id": c2["id"], "instrument_ids": [ids["NVDA"], ids["AAPL"]]},
        {"id": c1["id"], "instrument_ids": [ids["MSFT"]]},
    ]}))
    pf = api.portfolio()
    assert [c["name"] for c in pf["categories"]] == ["Growth", "Dividend"]
    assert [h["symbol"] for h in card(pf, "Growth")["holdings"]] == ["NVDA", "AAPL"]
    api.ok(client.delete(f"/api/categories/{c2['id']}"))
    pf = api.portfolio()
    assert [h["symbol"] for h in card(pf, "Uncategorised")["holdings"]] == ["NVDA", "AAPL"]  # order kept
    assert len(api.ok(client.get("/api/holdings"))) == 3  # deleting a category never deletes holdings


def test_validation(api, client):
    a = api.broker()
    assert client.post("/api/holdings", json={"broker_id": a["id"], "symbol": "X", "quantity": "0", "avg_cost": "1"}).status_code == 422
    assert client.post("/api/holdings", json={"broker_id": a["id"], "symbol": "X", "quantity": "-1", "avg_cost": "1"}).status_code == 422
    assert client.post("/api/holdings", json={"broker_id": a["id"], "symbol": "X.KL", "quantity": "1", "avg_cost": "1",
                                              "currency": "USD"}).status_code == 201  # new symbol takes given currency
    assert client.post("/api/holdings", json={"broker_id": 999, "symbol": "Y", "quantity": "1", "avg_cost": "1"}).status_code == 422
    assert client.post("/api/brokers", json={"name": "Rakuten Trade"}).status_code == 422
    assert client.delete(f"/api/brokers/{a['id']}").status_code == 409


def csv_bytes(text):
    return text.encode()


def test_import_csv_preview_replace_and_merge(api, client):
    a = api.broker("Rakuten Trade")
    api.holding(a["id"], "OLD.KL", 100, 1)
    data = "Stock Code,Stock Name,Quantity,Avg Price\n1155.KL,Maybank,\"2,800\",RM10.18\n5176.KL,Sunway REIT,14300,1.95\n"
    files = {"file": ("rakuten.csv", csv_bytes(data))}
    pv = api.ok(client.post("/api/import/preview", files=files, data={"broker_id": a["id"]}))
    assert pv["summary"]["new"] == 2 and [r["symbol"] for r in pv["summary"]["removed"]] == ["OLD.KL"]
    assert len(api.ok(client.get("/api/holdings"))) == 1  # preview writes nothing
    api.ok(client.post("/api/import/commit", files=files, data={"broker_id": a["id"]}))
    hs = {h["symbol"]: h for h in api.ok(client.get("/api/holdings"))}
    assert set(hs) == {"1155.KL", "5176.KL"} and D(hs["1155.KL"]["quantity"]) == 2800 and D(hs["1155.KL"]["avg_cost"]) == D("10.18")
    # merge keeps what is not in the file
    more = {"file": ("x.csv", csv_bytes("symbol,quantity,avg_cost\n5258.KL,3200,2.57\n"))}
    api.ok(client.post("/api/import/commit", files=more, data={"broker_id": a["id"], "replace": "false"}))
    assert len(api.ok(client.get("/api/holdings"))) == 3
    again = api.ok(client.post("/api/import/preview", files=files, data={"broker_id": a["id"], "replace": "false"}))
    assert again["summary"]["unchanged"] == 2


def test_import_with_broker_and_category_columns_and_errors(api, client):
    data = ("broker,symbol,quantity,avg_cost,category\n"
            "Moomoo,NVDA,10,100,Growth\nLongbridge,JEPQ,5,55,Income\nLongbridge,BAD,abc,1,Income\n")
    files = {"file": ("all.csv", csv_bytes(data))}
    pv = api.ok(client.post("/api/import/preview", files=files))
    assert pv["summary"]["errors"] == 1 and not pv["can_import"]
    assert client.post("/api/import/commit", files=files).status_code == 422
    assert api.ok(client.get("/api/brokers")) == []  # failed import changed nothing
    ok = {"file": ("all.csv", csv_bytes(data.rsplit("Longbridge,BAD", 1)[0]))}
    res = api.ok(client.post("/api/import/commit", files=ok))
    assert set(res["summary"]["created"]["brokers"]) == {"Moomoo", "Longbridge"}
    pf = api.portfolio()
    assert {c["name"] for c in pf["categories"]} == {"Growth", "Income"}


def test_import_excel_with_title_rows(api, client):
    from openpyxl import Workbook
    a = api.broker("Longbridge")
    wb = Workbook()
    ws = wb.active
    ws.append(["Portfolio statement"])
    ws.append([])
    ws.append(["Symbol", "Shares", "Average Cost", "Currency"])
    ws.append(["MSFT", 15, 418.4, "USD"])
    ws.append(["AAPL", 23.62, 256.29, "USD"])
    buf = io.BytesIO()
    wb.save(buf)
    files = {"file": ("lb.xlsx", buf.getvalue())}
    res = api.ok(client.post("/api/import/commit", files=files, data={"broker_id": a["id"]}))
    assert res["summary"]["new"] == 2
    hs = {h["symbol"]: h for h in api.ok(client.get("/api/holdings"))}
    assert D(hs["AAPL"]["quantity"]) == D("23.62") and D(hs["MSFT"]["avg_cost"]) == D("418.4")
    assert client.get("/api/holdings/export.csv").text.splitlines()[0].startswith("broker,symbol")


def test_backup_restore_and_persistence(api, client, tmp_db):
    a = api.broker("Keep")
    b = api.ok(client.post("/api/backups"))
    assert b["counts"]["brokers"] == 1
    api.broker("Later")
    api.ok(client.post(f"/api/backups/{b['name']}/restore"))
    assert [x["name"] for x in api.ok(client.get("/api/brokers"))] == ["Keep"]
    assert client.post("/api/restore", files={"file": ("x.db", b"not a database")}).status_code == 400
    from app import db as dbmod
    from app.migrations import migrate
    migrate(dbmod.init_engine(tmp_db))
    assert api.ok(client.get("/api/brokers"))[0]["id"] == a["id"]


def test_frontend_or_message(client):
    assert client.get("/").status_code in (200, 503)
    assert client.get("/api/nope").status_code == 404


@pytest.mark.parametrize("base", ["MYR", "USD", "SGD", "GBP", "HKD"])
def test_every_base_currency(api, base):
    for q, r in (("MYR", "4.5"), ("SGD", "1.3"), ("GBP", "0.75"), ("HKD", "7.8")):
        api.fx("USD", q, r)
    a = api.broker()
    api.holding(a["id"], "AAPL", 1, 100)
    api.price(api.instrument_id("AAPL"), 100)
    pf = api.portfolio(base)
    assert pf["base_currency"] == base and D(pf["totals"]["value"]) > 0


def test_any_base_currency_and_header_rates(api, client):
    api.fx("USD", "EUR", "0.9")
    api.fx("USD", "JPY", "150")
    api.fx("USD", "MYR", "4.5")
    a = api.broker()
    api.holding(a["id"], "7203.T", 100, 2500)  # Toyota on Tokyo -> JPY from the suffix
    api.holding(a["id"], "MSFT", 1, 400)
    api.price(api.instrument_id("7203.T"), 3000)
    api.price(api.instrument_id("MSFT"), 450)
    assert row(api.portfolio(), "7203.T")["currency"] == "JPY"
    api.ok(client.put("/api/settings", json={"base_currency": "EUR"}))
    pf = api.portfolio()
    assert pf["base_currency"] == "EUR"
    assert {f["from"] for f in pf["fx"]} == {"JPY", "USD"}  # only currencies you hold
    expected = D(300000) / 150 * D("0.9") + 450 * D("0.9")
    assert abs(D(pf["totals"]["value"]) - expected) < D("0.0001")
    assert client.put("/api/settings", json={"base_currency": "XYZ"}).status_code == 422
    meta = api.ok(client.get("/api/meta"))
    assert {"code": "JPY", "name": "Japanese yen", "symbol": "¥"} in meta["currencies"]


def test_fund_with_balance_and_amount_invested(api, client):
    a = api.broker("KWSP")
    api.ok(client.post("/api/holdings", json={"broker_id": a["id"], "symbol": "EPF", "name": "EPF Account 1",
                                              "kind": "fund", "currency": "MYR", "quantity": "85000",
                                              "total_cost": "70000", "price": "1"}))
    api.ok(client.post("/api/holdings", json={"broker_id": a["id"], "symbol": "Public Ittikal", "kind": "fund",
                                              "quantity": "10000", "total_cost": "3000", "price": "0.3512",
                                              "currency": "MYR"}))
    pf = api.portfolio()
    epf = row(pf, "EPF")
    assert epf["kind"] == "fund" and epf["price_status"] == "Manual"
    assert D(epf["market_value"]) == 85000 and D(epf["gain"]) == 15000
    ut = row(pf, "PUBLIC ITTIKAL")
    assert D(ut["market_value"]) == D("3512") and D(ut["avg_cost"]) == D("0.3")
    inst = next(i for i in api.ok(client.get("/api/instruments")) if i["symbol"] == "EPF")
    assert inst["price_mode"] == "manual" and D(inst["withholding_tax_rate"]) == 0


def test_value_history_recorded_when_opened(api, client):
    a = api.broker()
    api.holding(a["id"], "1155.KL", 100, 10)
    api.price(api.instrument_id("1155.KL"), 11)
    api.portfolio()
    api.portfolio()
    snaps = api.ok(client.get("/api/snapshots"))
    assert len(snaps) == 1 and D(snaps[0]["value"]) == 1100


def test_import_type_column_makes_funds_manual_priced(api, client):
    a = api.broker("ASNB")
    csv = b"symbol,name,quantity,avg_cost,currency,kind\nASB,Amanah Saham Bumiputera,5000,1,MYR,fund\nMSFT,Microsoft,1,400,USD,Buy\n"
    api.ok(client.post("/api/import/commit", files={"file": ("s.csv", csv, "text/csv")}, data={"broker_id": a["id"]}))
    inst = {i["symbol"]: i for i in api.ok(client.get("/api/instruments"))}
    assert inst["ASB"]["kind"] == "fund" and inst["ASB"]["price_mode"] == "manual"
    assert inst["MSFT"]["kind"] == "stock"  # unknown type values are ignored


def test_tailscale_address_detection(monkeypatch):
    import json
    import subprocess
    from app import netinfo
    assert netinfo.is_tailscale_ip("100.101.5.9") and not netinfo.is_tailscale_ip("100.20.1.1")
    assert not netinfo.is_tailscale_ip("192.168.1.10")
    status = {"MagicDNSSuffix": "tail1234.ts.net", "Self": {"DNSName": "my-pc.tail1234.ts.net.", "TailscaleIPs": ["100.88.1.2", "fd7a::1"]}}
    monkeypatch.setattr("shutil.which", lambda name: "/usr/bin/tailscale")
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=json.dumps(status)))
    assert netinfo.tailscale_addresses() == ["my-pc", "100.88.1.2"]
    monkeypatch.setattr("shutil.which", lambda name: None)  # not installed
    monkeypatch.setattr(netinfo.socket, "getaddrinfo", lambda *a, **k: [(0, 0, 0, "", ("192.168.1.4", 0))])
    assert netinfo.tailscale_addresses() == []


def test_broker_is_optional_for_holdings_and_uploads(api, client):
    api.ok(client.post("/api/holdings", json={"symbol": "MSFT", "quantity": "5", "avg_cost": "400"}))
    assert [r["broker"] for r in api.ok(client.get("/api/holdings"))] == ["No broker"]
    csv = b"symbol,quantity,avg_cost\nAAPL,3,150\nMSFT,6,410\n"
    api.ok(client.post("/api/import/commit", files={"file": ("h.csv", csv, "text/csv")}, data={"replace": "false"}))
    rows = {r["symbol"]: r for r in api.ok(client.get("/api/holdings"))}
    assert D(rows["MSFT"]["quantity"]) == 6 and rows["AAPL"]["broker"] == "No broker"
    # tag later, then untag again
    b = api.broker("Moomoo")
    api.ok(client.put(f"/api/holdings/{rows['AAPL']['id']}", json={"broker_id": b["id"]}))
    api.ok(client.put(f"/api/holdings/{rows['AAPL']['id']}", json={"broker_id": None}))
    assert {r["broker"] for r in api.ok(client.get("/api/holdings"))} == {"No broker"}
    nb = next(x for x in api.ok(client.get("/api/brokers")) if x["name"] == "No broker")
    assert client.put(f"/api/brokers/{nb['id']}", json={"name": "Other"}).status_code == 422
