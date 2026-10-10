"""SQLAlchemy engine/session setup for the local SQLite database."""
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path

from sqlalchemy import String, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from . import config


class DecimalText(TypeDecorator):
    """Stores Decimal as TEXT so SQLite never rounds through float."""

    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(Decimal(value))

    def process_result_value(self, value, dialect):
        return None if value is None else Decimal(value)


class Base(DeclarativeBase):
    pass


engine = None
SessionLocal = sessionmaker(expire_on_commit=False)


def init_engine(db_path: Path | None = None):
    global engine
    path = Path(db_path or config.DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    if engine is not None:
        engine.dispose()
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    SessionLocal.configure(bind=engine)
    return engine


def current_db_path() -> Path:
    return Path(engine.url.database)


def get_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
