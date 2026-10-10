"""JSON responses that keep Decimal precision (as strings) instead of converting to float."""
import functools
import inspect
import json
from datetime import date, datetime
from decimal import Decimal

from fastapi.responses import JSONResponse, Response
from fastapi.routing import APIRoute

Q = Decimal("1e-8")


def _default(o):
    if isinstance(o, Decimal):
        if not o.is_finite():
            return None
        s = format(o.quantize(Q).normalize() if o.adjusted() < 20 else o, "f")
        return "0" if s in ("-0", "0E-8") else s
    if isinstance(o, datetime):
        return o.isoformat(timespec="seconds") + ("Z" if o.tzinfo is None else "")
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, set):
        return sorted(o)
    raise TypeError(f"Not JSON serialisable: {type(o)}")


class DecimalJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(content, default=_default, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class DecimalRoute(APIRoute):
    """Bypasses FastAPI's jsonable_encoder (which turns Decimal into float) for plain return values."""

    def __init__(self, path, endpoint, **kwargs):
        status = kwargs.get("status_code") or 200

        def wrap(result):
            return result if isinstance(result, Response) else DecimalJSONResponse(result, status_code=status)

        if inspect.iscoroutinefunction(endpoint):
            @functools.wraps(endpoint)
            async def wrapped(*a, **kw):
                return wrap(await endpoint(*a, **kw))
        else:
            @functools.wraps(endpoint)
            def wrapped(*a, **kw):
                return wrap(endpoint(*a, **kw))
        super().__init__(path, wrapped, **kwargs)
