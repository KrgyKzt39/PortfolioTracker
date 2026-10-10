"""Sample data, only ever written to the separate demo database (PT_DEMO=1 -> data/demo.db)."""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select

from . import config
from .db import session_scope
from .dividends import reconcile, save_event
from .market.service import save_manual_price
from .models import Account, FxRate, Instrument
from .transactions import create_txn

D = Decimal

INSTRUMENTS = [
    # symbol, name, ccy, kind, mode, avg, qty, price, forward dps, wht, account
    ("1155.KL", "Malayan Banking", "MYR", "stock", "auto", "10.18", "2800", "10.42", "0.60", "0", "Dividend Acc"),
    ("5176.KL", "Sunway REIT", "MYR", "reit", "auto", "1.95", "14300", "2.03", "0.105", "0.10", "Dividend Acc"),
    ("5258.KL", "Bank Islam Malaysia", "MYR", "stock", "auto", "2.57", "3200", "2.09", "0.20", "0", "Dividend Acc"),
    ("JEPQ", "JPMorgan Nasdaq Equity Premium Income ETF", "USD", "etf", "auto", "55.08", "308.58", "59.08", "6.40",
     "0.30", "Dividend Acc"),
    ("ASNB", "ASNB fixed-price fund (manual NAV)", "MYR", "fund", "manual", "1.00", "56020", "1.00", "0.0475", "0",
     "Dividend Acc"),
    ("MSFT", "Microsoft", "USD", "stock", "auto", "425.12", "21.83", "497.12", "3.32", "0.30", "Growth Acc"),
    ("AAPL", "Apple", "USD", "stock", "auto", "256.29", "23.62", "331.34", "1.04", "0.30", "Growth Acc"),
    ("NVDA", "NVIDIA", "USD", "stock", "auto", "192.92", "40.55", "212.17", "0.04", "0.30", "Growth Acc"),
    ("META", "Meta Platforms", "USD", "stock", "auto", "614.03", "16.27", "670.24", "2.10", "0.30", "Growth Acc"),
    ("GOOGL", "Alphabet", "USD", "stock", "auto", "344.00", "3", "344.98", "0.84", "0.30", "Growth Acc"),
]

DIVIDENDS = {  # symbol -> list of (days ago, gross, tax)
    "1155.KL": [(310, "840.00", "0"), (130, "1279.00", "0")],
    "5176.KL": [(330, "780.00", "78.00"), (240, "800.00", "80.00"), (150, "870.10", "87.01"), (60, "980.01", "98.00")],
    "5258.KL": [(200, "416.00", "0"), (40, "463.88", "0")],
    "JEPQ": [(d, "160.00", "48.00") for d in (335, 305, 275, 245, 215, 185, 155, 125, 95, 65, 35, 5)],
    "ASNB": [(120, "1212.37", "0")],
    "MSFT": [(90, "18.12", "5.44")],
}


def seed_if_empty():
    if not config.DEMO:
        raise RuntimeError("Demo data can only be written to the demo database")
    with session_scope() as db:
        if db.scalar(select(Account.id).limit(1)):
            return
        seed(db)


def seed(db):
    today = date.today()
    start = today - timedelta(days=400)
    accts = {
        "Dividend Acc": Account(name="Dividend Acc", layout="dividend", currency="MYR", broker="Demo broker",
                                sort_order=1),
        "Growth Acc": Account(name="Growth Acc", layout="growth", currency="USD", broker="Demo broker", sort_order=2),
    }
    db.add_all(accts.values())
    for base, quote, then, now in (("USD", "MYR", "4.45", "4.08"), ("SGD", "MYR", "3.38", "3.21"),
                                   ("GBP", "MYR", "5.80", "5.51"), ("HKD", "MYR", "0.572", "0.521")):
        db.add(FxRate(base=base, quote=quote, rate=D(then), rate_date=start - timedelta(days=5), source="manual"))
        db.add(FxRate(base=base, quote=quote, rate=D(now), rate_date=today, source="manual"))
    db.flush()
    insts = {}
    for sym, name, ccy, kind, mode, avg, qty, price, dps, wht, acct in INSTRUMENTS:
        i = Instrument(symbol=sym, name=name, currency=ccy, kind=kind, price_mode=mode,
                       annual_dividend_per_share=D(dps), withholding_tax_rate=D(wht),
                       dividend_frequency=12 if sym == "JEPQ" else (2 if ccy == "MYR" else 4))
        db.add(i)
        db.flush()
        insts[sym] = i
        create_txn(db, {"type": "BUY", "trade_date": start.isoformat(), "account_id": accts[acct].id,
                        "instrument_id": i.id, "quantity": qty, "price": avg, "fees": "0"})
        save_manual_price(db, i, D(price), today)
        for days, gross, tax in DIVIDENDS.get(sym, []):
            create_txn(db, {"type": "DIVIDEND", "trade_date": (today - timedelta(days=days)).isoformat(),
                            "account_id": accts[acct].id, "instrument_id": i.id, "amount": gross, "tax": tax},
                       allow_duplicate=True)
    # Dividend calendar examples (estimates and announcements are not income until reconciled).
    save_event(db, {"instrument_id": insts["1155.KL"].id, "ex_date": (today + timedelta(days=10)).isoformat(),
                    "pay_date": (today + timedelta(days=26)).isoformat(), "amount_per_share": "0.30",
                    "status": "announced"})
    save_event(db, {"instrument_id": insts["5176.KL"].id, "ex_date": (today - timedelta(days=12)).isoformat(),
                    "pay_date": (today + timedelta(days=15)).isoformat(), "amount_per_share": "0.0478",
                    "status": "pending"})
    save_event(db, {"instrument_id": insts["JEPQ"].id, "ex_date": (today + timedelta(days=22)).isoformat(),
                    "pay_date": (today + timedelta(days=26)).isoformat(), "amount_per_share": "0.52",
                    "status": "forecast", "note": "Estimate based on recent monthly distributions"})
    ev = save_event(db, {"instrument_id": insts["5258.KL"].id, "ex_date": (today - timedelta(days=30)).isoformat(),
                         "pay_date": (today - timedelta(days=3)).isoformat(), "amount_per_share": "0.05",
                         "status": "announced"})
    reconcile(db, ev, [{"account_id": accts["Dividend Acc"].id, "gross": "160.00", "tax": "0"}])
