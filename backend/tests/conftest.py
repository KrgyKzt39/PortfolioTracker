import os
import sys
from pathlib import Path

os.environ["PT_SCHEDULER"] = "0"
os.environ.setdefault("PT_DEMO", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config, db as dbmod  # noqa: E402
from app.migrations import migrate  # noqa: E402


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "test.db")
    eng = dbmod.init_engine(tmp_path / "test.db")
    migrate(eng)
    yield tmp_path / "test.db"
    dbmod.engine.dispose()


@pytest.fixture()
def client(tmp_db):
    from app.main import app
    with TestClient(app) as c:
        yield c


class Api:
    """Small helper to create fixtures through the public API."""

    def __init__(self, c):
        self.c = c

    def ok(self, r, code=(200, 201)):
        assert r.status_code in (code if isinstance(code, tuple) else (code,)), r.text
        return r.json()

    def broker(self, name="Rakuten Trade"):
        return self.ok(self.c.post("/api/brokers", json={"name": name}))

    def category(self, name, show_dividends=False):
        return self.ok(self.c.post("/api/categories", json={"name": name, "show_dividends": show_dividends}))

    def holding(self, broker_id, symbol, quantity, avg_cost, **kw):
        return self.ok(self.c.post("/api/holdings", json={"broker_id": broker_id, "symbol": symbol,
                                                          "quantity": str(quantity), "avg_cost": str(avg_cost), **kw}))

    def instrument_id(self, symbol):
        return next(i["id"] for i in self.ok(self.c.get("/api/instruments")) if i["symbol"] == symbol)

    def price(self, inst_id, price, on=None):
        return self.ok(self.c.post("/api/prices", json={"instrument_id": inst_id, "price": str(price), "date": on}))

    def fx(self, base, quote, rate, on=None):
        return self.ok(self.c.post("/api/fx", json={"base": base, "quote": quote, "rate": str(rate), "date": on}))

    def portfolio(self, base=None):
        return self.ok(self.c.get("/api/portfolio" + (f"?base={base}" if base else "")))


@pytest.fixture()
def api(client):
    return Api(client)


def row(pf, symbol):
    return next(h for c in pf["categories"] for h in c["holdings"] if h["symbol"] == symbol)


def card(pf, name):
    return next(c for c in pf["categories"] if c["name"] == name)
