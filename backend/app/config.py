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
ALPACA_API_KEY_ID = os.environ.get("ALPACA_API_KEY_ID", "")
ALPACA_API_SECRET_KEY = os.environ.get("ALPACA_API_SECRET_KEY", "")
ALPACA_DATA_FEED = os.environ.get("ALPACA_DATA_FEED", "iex")  # "sip" needs a paid plan
LONGBRIDGE_APP_KEY = os.environ.get("LONGBRIDGE_APP_KEY", "")
LONGBRIDGE_APP_SECRET = os.environ.get("LONGBRIDGE_APP_SECRET", "")
LONGBRIDGE_ACCESS_TOKEN = os.environ.get("LONGBRIDGE_ACCESS_TOKEN", "")


def alpaca_configured() -> bool:
    return bool(ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY)


def longbridge_configured() -> bool:
    return bool(LONGBRIDGE_APP_KEY and LONGBRIDGE_APP_SECRET and LONGBRIDGE_ACCESS_TOKEN)


ENABLE_SCHEDULER = os.environ.get("PT_SCHEDULER", "1") == "1"

# AI features (optional). Keys stay on this PC and are never sent to the browser.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
# Any OpenAI-compatible endpoint, e.g. OpenRouter or a local Ollama (http://localhost:11434/v1).
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "")
