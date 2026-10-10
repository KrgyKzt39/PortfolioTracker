"""Daily portfolio valuation snapshots (one row per day and base currency)."""
import json
from datetime import date

from sqlalchemy import select

from .models import ValuationSnapshot
from .valuation import build_portfolio


def write_snapshot(db, on: date | None = None, pf: dict | None = None):
    """Upsert today's value. Called on refresh, nightly, and when the portfolio is opened."""
    on = on or date.today()
    pf = pf or build_portfolio(db)
    if pf["totals"]["incomplete"] and not pf["totals"]["value"]:
        return None
    t = pf["totals"]
    detail = json.dumps([{"id": a["id"], "name": a["name"], "value": str(a["value"]), "pl": str(a["pl"])}
                         for a in pf["categories"]])
    row = db.scalar(select(ValuationSnapshot).where(
        ValuationSnapshot.snapshot_date == on, ValuationSnapshot.base_currency == pf["base_currency"]))
    if row is None:
        row = ValuationSnapshot(snapshot_date=on, base_currency=pf["base_currency"])
        db.add(row)
    row.total_value, row.total_cost, row.total_pl, row.detail = t["value"], t["cost"], t["pl"], detail
    return row
