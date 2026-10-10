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
