"""FastAPI entry point: serves the API and the built frontend from one local server."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, scheduler
from .api import router
from .migrations import migrate


@asynccontextmanager
async def lifespan(app: FastAPI):
    if db.engine is None:
        db.init_engine()
    migrate(db.engine)
    if config.DEMO:
        from .demo import seed_if_empty
        seed_if_empty()
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(title="Portfolio Tracker", lifespan=lifespan)
app.include_router(router)

dist = config.FRONTEND_DIST
if (dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    f = (dist / path).resolve()
    if path and f.is_file() and dist.resolve() in f.parents:
        return FileResponse(f)
    index = dist / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Frontend not built. Run start.bat (or npm run build in frontend/)."},
                        status_code=503)
