"""FX conversion from stored rates (latest or as-of a historical date)."""
from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import FxRate

PIVOTS = ("USD", "EUR", "MYR")


@dataclass
class Quote:
    rate: Decimal
    rate_date: date
    source: str
    fetched_at: datetime | None


class FxTable:
    def __init__(self, rows: list[FxRate] | None = None):
        # (base, quote) -> list of Quote sorted by (date, manual-wins, fetched_at)
        self._pairs: dict[tuple[str, str], list[Quote]] = defaultdict(list)
        for r in rows or []:
            self.add(r.base, r.quote, Decimal(r.rate), r.rate_date, r.source, r.fetched_at)
        self._sort()

    @classmethod
    def load(cls, db: Session) -> "FxTable":
        return cls(list(db.scalars(select(FxRate))))

    def add(self, base, quote, rate, rate_date, source="manual", fetched_at=None):
        self._pairs[(base, quote)].append(Quote(Decimal(rate), rate_date, source, fetched_at))

    def _sort(self):
        for lst in self._pairs.values():
            lst.sort(key=lambda q: (q.rate_date, q.source == "manual", q.fetched_at or datetime.min))

    def _direct(self, base: str, quote: str, on: date | None) -> Quote | None:
        lst = self._pairs.get((base, quote))
        if lst:
            if on is None:
                return lst[-1]
            idx = bisect_right([q.rate_date for q in lst], on)
            if idx:
                return lst[idx - 1]
        lst = self._pairs.get((quote, base))
        if lst:
            q = None
            if on is None:
                q = lst[-1]
            else:
                idx = bisect_right([x.rate_date for x in lst], on)
                q = lst[idx - 1] if idx else None
            if q and q.rate:
                return Quote(Decimal(1) / q.rate, q.rate_date, q.source, q.fetched_at)
        return None

    def quote(self, base: str, quote: str, on: date | None = None) -> Quote | None:
        """1 base = rate quote. Tries direct, inverse, then triangulation via a pivot currency."""
        if base == quote:
            return Quote(Decimal(1), on or date.today(), "identity", None)
        q = self._direct(base, quote, on)
        if q:
            return q
        for pivot in PIVOTS:
            if pivot in (base, quote):
                continue
            a = self._direct(base, pivot, on)
            b = self._direct(pivot, quote, on)
            if a and b:
                older = a if a.rate_date <= b.rate_date else b
                return Quote(a.rate * b.rate, older.rate_date, f"{a.source}+{b.source}", older.fetched_at)
        return None

    def rate(self, base: str, quote: str, on: date | None = None) -> Decimal | None:
        q = self.quote(base, quote, on)
        return q.rate if q else None

    def convert(self, amount: Decimal, base: str, quote: str, on: date | None = None) -> Decimal | None:
        r = self.rate(base, quote, on)
        return None if r is None else amount * r
