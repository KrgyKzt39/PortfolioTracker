"""Detect this PC's LAN IPv4 addresses so the console can tell you what to open on the iPhone."""
import socket


def lan_addresses() -> list[str]:
    found: list[str] = []
    try:  # The address used for the default route (no packets are sent for UDP connect).
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.0.1", 80))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    private = []
    for ip in found:
        if ip.startswith(("10.", "192.168.")) or (ip.startswith("172.") and 16 <= int(ip.split(".")[1]) <= 31):
            if ip not in private:
                private.append(ip)
    return private


def is_tailscale_ip(ip: str) -> bool:
    """Tailscale gives each device an address in 100.64.0.0/10."""
    parts = ip.split(".")
    return len(parts) == 4 and parts[0] == "100" and 64 <= int(parts[1]) <= 127


def tailscale_addresses() -> list[str]:
    """This PC's Tailscale name and address, so the iPhone can reach it from anywhere. Empty if not installed."""
    import json
    import shutil
    import subprocess

    out: list[str] = []
    exe = shutil.which("tailscale")
    if exe:
        try:
            st = json.loads(subprocess.run([exe, "status", "--json"], capture_output=True, text=True, timeout=4).stdout or "{}")
            me = st.get("Self") or {}
            name = (me.get("DNSName") or "").rstrip(".")
            if name and st.get("MagicDNSSuffix"):
                out.append(name.split(".")[0])  # short MagicDNS name, e.g. "my-pc"
            out += [ip for ip in me.get("TailscaleIPs") or [] if is_tailscale_ip(ip)]
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    if not out:
        try:
            out = [i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET) if is_tailscale_ip(i[4][0])]
        except OSError:
            pass
    return list(dict.fromkeys(out))
