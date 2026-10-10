"""SQLite backup and restore with integrity checks."""
from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from . import config, db as dbmod
from .migrations import REQUIRED_TABLES, SCHEMA_VERSION, migrate


class BackupError(ValueError):
    pass


def check_file(path: Path) -> dict:
    """Validate that `path` is a healthy SQLite database with our schema."""
    try:
        with open(path, "rb") as f:
            if f.read(16) != b"SQLite format 3\x00":
                raise BackupError("Not a SQLite database file")
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        try:
            result = con.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise BackupError(f"Integrity check failed: {result}")
            fk = con.execute("PRAGMA foreign_key_check").fetchall()
            if fk:
                raise BackupError(f"Foreign key check failed on {len(fk)} rows")
            tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            missing = REQUIRED_TABLES - tables
            if missing:
                raise BackupError(f"Missing tables: {', '.join(sorted(missing))}")
            version = con.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise BackupError(f"Backup schema v{version} is newer than this app (v{SCHEMA_VERSION})")
            counts = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                      for t in ("accounts", "instruments", "transactions", "dividend_events")}
        finally:
            con.close()
    except sqlite3.DatabaseError as exc:
        raise BackupError(f"Unreadable database: {exc}") from exc
    return {"schema_version": version, "counts": counts}


def create_backup(label: str = "manual") -> Path:
    config.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    dest = config.BACKUP_DIR / f"portfolio-{stamp}-{label}.db"
    src = sqlite3.connect(dbmod.current_db_path())
    try:
        out = sqlite3.connect(dest)
        with out:
            src.backup(out)
        out.close()
    finally:
        src.close()
    check_file(dest)
    return dest


def list_backups() -> list[dict]:
    if not config.BACKUP_DIR.exists():
        return []
    files = sorted(config.BACKUP_DIR.glob("*.db"), reverse=True)
    return [{"name": f.name, "size": f.stat().st_size,
             "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(timespec="seconds")} for f in files]


def restore_from(path: Path) -> dict:
    info = check_file(path)
    safety = create_backup("pre-restore")
    target = dbmod.current_db_path()
    tmp = target.with_suffix(".restore-tmp")
    shutil.copyfile(path, tmp)
    dbmod.engine.dispose()
    for suffix in ("-wal", "-shm"):
        p = Path(str(target) + suffix)
        if p.exists():
            p.unlink()
    tmp.replace(target)
    eng = dbmod.init_engine(target)
    migrate(eng)
    return {**info, "safety_backup": safety.name}
