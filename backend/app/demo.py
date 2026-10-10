"""Sample data, only ever written to the separate demo database (PT_DEMO=1 -> data/demo.db)."""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from . import config
from .db import session_scope
from .dividends import record_payment, save_earnings, save_event
from .holdings import save_holding
from .market.service import save_manual_price
from .models import Broker, Category, FxRate, Instrument

D = Decimal

# symbol, name, ccy, kind, mode, category, [(broker, qty, avg)], price, forward dps, wht
STOCKS = [
    ("1155.KL", "Malayan Banking", "MYR", "stock", "auto", "Dividend", [("Rakuten Trade", "2800", "10.18")], "10.42", "0.60", "0"),
    ("5176.KL", "Sunway REIT", "MYR", "reit", "auto", "Dividend", [("Rakuten Trade", "14300", "1.95")], "2.03", "0.105", "0.10"),
    ("5258.KL", "Bank Islam Malaysia", "MYR", "stock", "auto", "Dividend", [("Rakuten Trade", "3200", "2.57")], "2.09", "0.20", "0"),
    ("JEPQ", "JPMorgan Nasdaq Equity Premium Income ETF", "USD", "etf", "auto", "Dividend",
     [("Longbridge", "308.58", "55.08")], "59.08", "6.40", "0.30"),
    ("ASNB", "ASNB fixed-price fund", "MYR", "fund", "manual", "Dividend", [("ASNB", "56020", "1.00")], "1.00", "0.0475", "0"),
    ("MSFT", "Microsoft", "USD", "stock", "auto", "Growth", [("Longbridge", "15", "418.40"), ("Moomoo", "6.83", "439.89")],
     "497.12", None, "0.30"),
    ("AAPL", "Apple", "USD", "stock", "auto", "Growth", [("Longbridge", "23.62", "256.29")], "331.34", None, "0.30"),
    ("NVDA", "NVIDIA", "USD", "stock", "auto", "Growth", [("Moomoo", "40.55", "192.92")], "212.17", None, "0.30"),
    ("META", "Meta Platforms", "USD", "stock", "auto", "Growth", [("Longbridge", "16.27", "614.03")], "670.24", None, "0.30"),
    ("GOOGL", "Alphabet", "USD", "stock", "auto", "Growth", [("Moomoo", "3", "344.00")], "344.98", None, "0.30"),
]

RECEIVED = {  # symbol -> [(days ago, gross, tax)]
    "1155.KL": [(310, "840.00", "0"), (130, "1279.00", "0")],
    "5176.KL": [(330, "780.00", "78.00"), (240, "800.00", "80.00"), (150, "870.10", "87.01"), (60, "980.01", "98.00")],
    "5258.KL": [(200, "416.00", "0"), (40, "463.88", "0")],
    "JEPQ": [(d, "160.00", "48.00") for d in (335, 305, 275, 245, 215, 185, 155, 125, 95, 65, 35)],
    "ASNB": [(120, "1212.37", "0")],
    "MSFT": [(90, "18.12", "5.44")],
}


def seed_if_empty():
    if not config.DEMO:
        raise RuntimeError("Demo data can only be written to the demo database")
    with session_scope() as db:
        if db.scalar(select(Broker.id).limit(1)):
            return
        seed(db)


def seed(db):
    today = date.today()
    for base, quote, rate in (("USD", "MYR", "4.08"), ("SGD", "MYR", "3.21"), ("GBP", "MYR", "5.51"), ("HKD", "MYR", "0.521")):
        db.add(FxRate(base=base, quote=quote, rate=D(rate), rate_date=today, source="manual"))
    cats = {}
    for i, (name, show) in enumerate((("Dividend", True), ("Growth", False))):
        cats[name] = Category(name=name, show_dividends=show, sort_order=i)
        db.add(cats[name])
    brokers = {}
    for i, name in enumerate(("Rakuten Trade", "Longbridge", "Moomoo", "ASNB")):
        brokers[name] = Broker(name=name, sort_order=i)
        db.add(brokers[name])
    db.flush()
    insts = {}
    for order, (sym, name, ccy, kind, mode, cat, lots, price, dps, wht) in enumerate(STOCKS):
        inst = Instrument(symbol=sym, name=name, currency=ccy, kind=kind, price_mode=mode, category_id=cats[cat].id,
                          sort_order=order, annual_dividend_per_share=D(dps) if dps else None, withholding_tax_rate=D(wht))
        db.add(inst)
        db.flush()
        insts[sym] = inst
        for broker, qty, avg in lots:
            save_holding(db, {"broker_id": brokers[broker].id, "instrument_id": inst.id, "quantity": qty, "avg_cost": avg})
        save_manual_price(db, inst, D(price), today)
        broker_id = brokers[lots[0][0]].id
        for days, gross, tax in RECEIVED.get(sym, []):
            record_payment(db, {"instrument_id": inst.id, "broker_id": broker_id, "gross": gross, "tax": tax,
                                "pay_date": (today - timedelta(days=days)).isoformat()})
    # Calendar: dividends (from Longbridge in real use for US stocks) and earnings dates.
    for sym, ex, pay, dps, status in (
        ("1155.KL", 10, 26, "0.30", "announced"),
        ("5176.KL", -12, 15, "0.0478", "pending"),
        ("JEPQ", 22, 26, "0.52", "forecast"),
        ("MSFT", 40, 61, "0.98", "announced"),
        ("5258.KL", -30, -3, "0.05", "pending"),
        ("JEPQ", -8, -4, "0.51", "pending"),
    ):
        save_event(db, {"instrument_id": insts[sym].id, "ex_date": (today + timedelta(days=ex)).isoformat(),
                        "pay_date": (today + timedelta(days=pay)).isoformat(), "amount_per_share": dps, "status": status})
    for sym, days, session in (("MSFT", 18, "after"), ("GOOGL", 18, "after"), ("META", 19, "after"),
                               ("AAPL", 20, "after"), ("NVDA", 48, "after"), ("1155.KL", 45, None)):
        save_earnings(db, {"instrument_id": insts[sym].id, "date": (today + timedelta(days=days)).isoformat(),
                           "session": session, "title": "Quarterly results"})
