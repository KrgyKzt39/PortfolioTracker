"""Dividend events, confirming payments, summary, calendar and the v1 -> v2 migration."""
import sqlite3
from datetime import date, timedelta
from decimal import Decimal as D

from conftest import row

TODAY = date.today()


def day(n):
    return (TODAY + timedelta(days=n)).isoformat()


def setup(api):
    a = api.broker()
    api.holding(a["id"], "1155.KL", 1000, 10)
    iid = api.instrument_id("1155.KL")
    api.price(iid, 11)
    return a, iid


def test_expected_is_not_income_until_confirmed(api, client):
    a, iid = setup(api)
    ev = api.ok(client.post("/api/dividends/events", json={"instrument_id": iid, "ex_date": day(-20), "pay_date": day(-2),
                                                           "amount_per_share": "0.25"}))
    s = api.ok(client.get("/api/dividends/summary"))
    assert [e["symbol"] for e in s["to_confirm"]] == ["1155.KL"]
    assert D(s["to_confirm"][0]["expected_net"]) == 250
    assert D(s["t12m_net"]) == 0 and D(row(api.portfolio(), "1155.KL")["dividends_net"]) == 0
    api.ok(client.post(f"/api/dividends/events/{ev['id']}/received", json={"gross": "250", "broker_id": a["id"]}))
    s = api.ok(client.get("/api/dividends/summary"))
    assert s["to_confirm"] == [] and D(s["t12m_net"]) == 250
    assert D(row(api.portfolio(), "1155.KL")["total_pl"]) == 1000 + 250
    dup = client.post(f"/api/dividends/events/{ev['id']}/received", json={"gross": "250", "broker_id": a["id"]})
    assert dup.status_code == 422
    pid = s["recent_payments"][0]["id"]
    api.ok(client.delete(f"/api/dividends/payments/{pid}"))
    assert [e["symbol"] for e in api.ok(client.get("/api/dividends/summary"))["to_confirm"]] == ["1155.KL"]


def test_payment_rules(api, client):
    _, iid = setup(api)
    assert client.post("/api/dividends/payments", json={"instrument_id": iid, "gross": "10", "pay_date": day(3)}).status_code == 422
    assert client.post("/api/dividends/payments", json={"instrument_id": iid, "gross": "10", "tax": "11"}).status_code == 422
    assert client.post("/api/dividends/events", json={"instrument_id": iid, "ex_date": day(5), "pay_date": day(1),
                                                      "amount_per_share": "1"}).status_code == 422


def test_forward_estimate_and_upcoming(api, client):
    api.fx("USD", "MYR", "4")
    a = api.broker()
    api.holding(a["id"], "MSFT", 10, 400)
    iid = api.instrument_id("MSFT")
    api.price(iid, 500)
    for d, amt in ((-300, "0.91"), (-200, "0.91"), (-100, "0.91"), (-10, "0.98")):
        api.ok(client.post("/api/dividends/events", json={"instrument_id": iid, "ex_date": day(d), "pay_date": day(d + 20),
                                                          "amount_per_share": amt, "status": "pending"}))
    api.ok(client.post("/api/dividends/events", json={"instrument_id": iid, "ex_date": day(80), "pay_date": day(100),
                                                      "amount_per_share": "0.98"}))
    h = row(api.portfolio(), "MSFT")
    assert D(h["dps"]) == D("3.71") and h["dps_source"] == "last 12 months"
    assert D(h["est_annual_dividend_net"]) == D("3.71") * 10 * D("0.7")  # 30% US withholding by default
    s = api.ok(client.get("/api/dividends/summary"))
    assert [e["ex_date"] for e in s["upcoming"]] == [day(-10), day(80)]
    assert sum(D(c["expected"]) for c in s["chart"]) > 0
    # Your own estimate wins
    api.ok(client.put(f"/api/instruments/{iid}", json={"annual_dividend_per_share": "4"}))
    assert row(api.portfolio(), "MSFT")["dps_source"] == "your estimate"


def test_calendar_merges_dividends_and_earnings_for_held_stocks(api, client):
    _, iid = setup(api)
    b = api.broker("Other")
    api.holding(b["id"], "AAPL", 1, 1)
    aapl = api.instrument_id("AAPL")
    api.ok(client.post("/api/dividends/events", json={"instrument_id": iid, "ex_date": day(5), "pay_date": day(20),
                                                      "amount_per_share": "0.3"}))
    api.ok(client.post("/api/earnings", json={"instrument_id": aapl, "date": day(10), "session": "after"}))
    assert client.post("/api/earnings", json={"instrument_id": aapl, "date": day(10)}).status_code == 422
    cal = api.ok(client.get("/api/calendar"))
    assert [(c["kind"], c["symbol"]) for c in cal] == [("ex_date", "1155.KL"), ("earnings", "AAPL"), ("pay_date", "1155.KL")]
    assert D(cal[0]["expected_net"]) == 300
    hid = next(h["id"] for h in api.ok(client.get("/api/holdings")) if h["symbol"] == "AAPL")
    api.ok(client.delete(f"/api/holdings/{hid}"))
    assert all(c["symbol"] != "AAPL" for c in api.ok(client.get("/api/calendar")))


def test_migrates_v1_ledger_database(tmp_path):
    from app import db as dbmod
    from app.migrations import migrate
    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.executescript("""
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, name VARCHAR(80) UNIQUE NOT NULL, layout VARCHAR(20) NOT NULL,
      currency VARCHAR(3) NOT NULL, broker VARCHAR(80), track_cash BOOLEAN NOT NULL, sort_order INTEGER NOT NULL,
      archived BOOLEAN NOT NULL, notes TEXT, created_at DATETIME NOT NULL);
    CREATE TABLE instruments (id INTEGER PRIMARY KEY, symbol VARCHAR(32) UNIQUE NOT NULL, name VARCHAR(120),
      currency VARCHAR(3) NOT NULL, kind VARCHAR(16) NOT NULL, price_mode VARCHAR(10) NOT NULL, provider_symbol VARCHAR(32),
      annual_dividend_per_share VARCHAR, dividend_frequency INTEGER, withholding_tax_rate VARCHAR NOT NULL, notes TEXT,
      created_at DATETIME NOT NULL);
    CREATE TABLE dividend_events (id INTEGER PRIMARY KEY, instrument_id INTEGER NOT NULL, ex_date DATE NOT NULL,
      pay_date DATE, amount_per_share VARCHAR NOT NULL, currency VARCHAR(3) NOT NULL, status VARCHAR(10) NOT NULL,
      withholding_tax_rate VARCHAR, note TEXT, created_at DATETIME NOT NULL,
      CONSTRAINT ck_div_status CHECK (status in ('forecast','announced','pending','received')));
    CREATE TABLE transactions (id INTEGER PRIMARY KEY, type VARCHAR(12) NOT NULL, trade_date DATE NOT NULL,
      account_id INTEGER, to_account_id INTEGER, instrument_id INTEGER, quantity VARCHAR, price VARCHAR, amount VARCHAR,
      fees VARCHAR NOT NULL, tax VARCHAR NOT NULL, currency VARCHAR(3) NOT NULL, fx_rate VARCHAR, fx_currency VARCHAR(3),
      split_ratio VARCHAR, dividend_event_id INTEGER, note TEXT, fingerprint VARCHAR(64) NOT NULL, source VARCHAR(20) NOT NULL,
      import_batch VARCHAR(40), created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
    CREATE TABLE price_history (id INTEGER PRIMARY KEY, instrument_id INTEGER NOT NULL, price_date DATE NOT NULL,
      price VARCHAR NOT NULL, currency VARCHAR(3) NOT NULL, source VARCHAR(20) NOT NULL, quality VARCHAR(10) NOT NULL,
      as_of DATETIME NOT NULL, fetched_at DATETIME NOT NULL);
    CREATE TABLE fx_rates (id INTEGER PRIMARY KEY, base VARCHAR(3), quote VARCHAR(3), rate VARCHAR, rate_date DATE,
      source VARCHAR(20), fetched_at DATETIME);
    CREATE TABLE valuation_snapshots (id INTEGER PRIMARY KEY, snapshot_date DATE, base_currency VARCHAR(3),
      total_value VARCHAR, total_cost VARCHAR, total_pl VARCHAR, detail TEXT, created_at DATETIME);
    CREATE TABLE settings (key VARCHAR(60) PRIMARY KEY, value TEXT);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, ts DATETIME, entity VARCHAR(30), entity_id INTEGER,
      action VARCHAR(20), before TEXT, after TEXT, note TEXT);
    INSERT INTO accounts VALUES (1,'Div Acc','dividend','MYR',NULL,0,0,0,NULL,'2025-01-01');
    INSERT INTO instruments VALUES (1,'1155.KL',NULL,'MYR','stock','auto',NULL,NULL,NULL,'0',NULL,'2025-01-01');
    INSERT INTO transactions VALUES (1,'BUY','2025-01-02',1,NULL,1,'1000','10',NULL,'20','0','MYR',NULL,NULL,NULL,NULL,NULL,'a','manual',NULL,'2025-01-02','2025-01-02');
    INSERT INTO transactions VALUES (2,'SELL','2025-02-02',1,NULL,1,'400','11',NULL,'0','0','MYR',NULL,NULL,NULL,NULL,NULL,'b','manual',NULL,'2025-02-02','2025-02-02');
    INSERT INTO transactions VALUES (3,'DIVIDEND','2025-03-02',1,NULL,1,NULL,NULL,'150','0','0','MYR',NULL,NULL,NULL,NULL,NULL,'c','manual',NULL,'2025-03-02','2025-03-02');
    PRAGMA user_version=1;
    """)
    con.close()
    eng = dbmod.init_engine(path)
    migrate(eng)
    con = sqlite3.connect(path)
    assert con.execute("PRAGMA user_version").fetchone()[0] == 2
    assert con.execute("SELECT name FROM brokers").fetchall() == [("Div Acc",)]
    assert con.execute("SELECT name, show_dividends FROM categories").fetchall() == [("Div Acc", 1)]
    q, c = con.execute("SELECT quantity, avg_cost FROM holdings").fetchone()
    assert D(q) == 600 and D(c) == D("10.02")
    assert con.execute("SELECT gross FROM dividend_payments").fetchall() == [("150",)]
    assert con.execute("SELECT category_id FROM instruments").fetchone()[0] == 1
    con.close()
    eng.dispose()
