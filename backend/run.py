"""Start the server and print how to open it on this PC and on an iPhone."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn  # noqa: E402

from app import config  # noqa: E402
from app.netinfo import lan_addresses  # noqa: E402


def banner():
    line = "=" * 64
    print(line)
    print(" Portfolio Tracker" + ("  [DEMO DATA - separate demo.db]" if config.DEMO else ""))
    print(line)
    print(f" Database : {config.DB_PATH}")
    print(f" On this PC: http://localhost:{config.PORT}")
    if config.HOST in ("0.0.0.0", ""):
        ips = lan_addresses()
        if ips:
            print(" On your iPhone (same Wi-Fi), open Safari and go to:")
            for ip in ips:
                print(f"     http://{ip}:{config.PORT}")
        else:
            print(" No LAN address detected. Check that this PC is on Wi-Fi/Ethernet.")
        print(" If the iPhone cannot connect: allow Python through Windows Firewall")
        print(" for PRIVATE networks only, and make sure your Wi-Fi is set to Private.")
        print(" Add to Home Screen: Safari > Share > Add to Home Screen.")
    else:
        print(" iPhone access is OFF (PT_HOST=127.0.0.1). To enable it, set")
        print(" PT_HOST=0.0.0.0 in .env and restart.")
    print(" Keep this window open while using the app. Ctrl+C to stop.")
    print(line)


if __name__ == "__main__":
    banner()
    uvicorn.run("app.main:app", host=config.HOST or "0.0.0.0", port=config.PORT, log_level="warning",
                app_dir=str(Path(__file__).resolve().parent))
