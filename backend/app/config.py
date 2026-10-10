"""Runtime configuration from environment variables (see .env.example)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"'))


_load_dotenv()

DEMO = os.environ.get("PT_DEMO", "0") == "1"
DATA_DIR = Path(os.environ.get("PT_DATA_DIR", ROOT / "data"))
DB_PATH = Path(os.environ.get("PT_DB_PATH", DATA_DIR / ("demo.db" if DEMO else "portfolio.db")))
BACKUP_DIR = DATA_DIR / "backups"
HOST = os.environ.get("PT_HOST", "127.0.0.1")
PORT = int(os.environ.get("PT_PORT", "8000"))
FRONTEND_DIST = ROOT / "frontend" / "dist"
ALPHAVANTAGE_API_KEY = os.environ.get("ALPHAVANTAGE_API_KEY", "")
ENABLE_SCHEDULER = os.environ.get("PT_SCHEDULER", "1") == "1"
