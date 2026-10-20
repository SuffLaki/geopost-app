"""Zeigt GeoPost am PC zur Ansicht - nur zum Entwickeln und Nachsehen.

    python tools/serve.py            # Port 8777
    python tools/serve.py 9000       # anderer Port

Die App selbst braucht keinen Server: Auf dem Handy liegt sie als Web-App
auf dem Home-Bildschirm und arbeitet dort eigenstaendig.
"""

import http.server
import os
import socket
import socketserver
import sys
import webbrowser

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXTRA = {
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WURZEL, **kw)

    def guess_type(self, pfad):
        endung = os.path.splitext(str(pfad))[1].lower()
        if endung in EXTRA:
            return EXTRA[endung]
        return super().guess_type(pfad)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


def adressen():
    gefunden = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("10.255.255.255", 1))
        gefunden.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return gefunden


def main():
    port = 8777
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("0.0.0.0", port), Handler) as server:
        print("GeoPost liegt bereit.")
        print("  Am PC:     http://127.0.0.1:%d/" % port)
        for ip in adressen():
            print("  Im WLAN:   http://%s:%d/" % (ip, port))
        print("")
        print("Zum Beenden: Strg+C oder Fenster schliessen.")
        if "--kein-browser" not in sys.argv:
            webbrowser.open("http://127.0.0.1:%d/" % port)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nBeendet.")


if __name__ == "__main__":
    main()
