#!/usr/bin/env python3
"""Serve markmaga-hub over HTTPS on all interfaces for Mac + phone LAN preview."""
# --- preview-ctl guard v2: begin ---
# Managed by ~/bin/preview-ctl.py. Two hazards this removes:
#   1. The launching terminal can go away while the server runs on. Writing an
#      access-log line to a dead pipe would raise mid-response and leave the
#      port open and silent. Make stdio unable to raise.
#   2. A browser or phone that walks away mid-response is normal, not an error.
#      Left alone it writes a traceback per disconnect into the log.
import socketserver as _pc_ss
import ssl as _pc_ssl
import sys as _pc_sys


class _PcQuiet:
    def __init__(self, stream):
        self._stream = stream

    def write(self, data):
        try:
            return self._stream.write(data)
        except Exception:
            return len(data) if isinstance(data, (str, bytes)) else 0

    def flush(self):
        try:
            self._stream.flush()
        except Exception:
            pass

    def isatty(self):
        try:
            return self._stream.isatty()
        except Exception:
            return False

    def fileno(self):
        return self._stream.fileno()

    def __getattr__(self, name):
        return getattr(self._stream, name)


_pc_sys.stdout = _PcQuiet(_pc_sys.stdout)
_pc_sys.stderr = _PcQuiet(_pc_sys.stderr)

_PC_QUIET_ERRORS = (
    BrokenPipeError,
    ConnectionResetError,
    ConnectionAbortedError,
    TimeoutError,
    _pc_ssl.SSLError,
)
_pc_handle_error = _pc_ss.BaseServer.handle_error


def _pc_quiet_handle_error(self, request, client_address):
    if isinstance(_pc_sys.exc_info()[1], _PC_QUIET_ERRORS):
        return
    return _pc_handle_error(self, request, client_address)


_pc_ss.BaseServer.handle_error = _pc_quiet_handle_error
# --- preview-ctl guard v2: end ---

from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import ssl
import sys

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8870
CERT = ROOT / ".local-cert.pem"
KEY = ROOT / ".local-key.pem"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        path = (self.path or "").split("?", 1)[0].lower()
        if path.endswith(
            (
                ".png",
                ".jpg",
                ".jpeg",
                ".webp",
                ".ico",
                ".webmanifest",
                ".svg",
            )
        ) or path.endswith("manifest.webmanifest"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        else:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def _lan_ips():
    ips = []
    try:
        import socket

        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    try:
        import subprocess

        for iface in ("en0", "en1", "en2"):
            out = subprocess.check_output(
                ["ipconfig", "getifaddr", iface], stderr=subprocess.DEVNULL, text=True
            ).strip()
            if out and out not in ips:
                ips.insert(0, out)
    except Exception:
        pass
    return ips


def main():
    mode = "https"
    argv = [a for a in sys.argv[1:] if a]
    port = DEFAULT_PORT
    if argv and argv[0] in ("--http", "http"):
        mode = "http"
        argv = argv[1:]
    if argv:
        port = int(argv[0])

    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    lan = _lan_ips()

    if mode == "https":
        if not CERT.exists() or not KEY.exists():
            print("Missing .local-cert.pem / .local-key.pem", file=sys.stderr)
            sys.exit(1)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        print("markmaga-hub HTTPS", flush=True)
        print(f"  Mac:    https://127.0.0.1:{port}/", flush=True)
        for ip in lan:
            print(f"  device: https://{ip}:{port}/", flush=True)
        print("  Self-signed: Advanced → proceed on first visit.", flush=True)
    else:
        print("markmaga-hub HTTP", flush=True)
        print(f"  Mac:    http://127.0.0.1:{port}/", flush=True)
        for ip in lan:
            print(f"  device: http://{ip}:{port}/", flush=True)

    print(f"  Dir:    {ROOT}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
