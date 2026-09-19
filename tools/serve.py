#!/usr/bin/env python3
"""
Dev server for katakhelne.

http.server is fine for static files but guesses wrong on two types that a
PWA actually depends on: .webmanifest and .woff2. It also caches nothing,
which is what you want while developing a service worker.

    python3 tools/serve.py [port]      # default 8000

Service workers need a secure context: http://localhost counts, so this is
enough for local development. Deploy over HTTPS.
"""
import functools, http.server, os, socketserver, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.woff2':       'font/woff2',
        '.json':        'application/json',
        '.svg':         'image/svg+xml',
        '.js':          'text/javascript',
        '.css':         'text/css',
    }

    def end_headers(self):
        # Revalidate every request so edits show up immediately, but do NOT
        # send `no-store`: Chrome refuses to register a service worker whose
        # script it is not allowed to store, and fails with a generic
        # "unknown error occurred when fetching the script".
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('  %s\n' % (fmt % args))


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(
            ('127.0.0.1', port),
            functools.partial(Handler, directory=ROOT)) as httpd:
        print(f'katakhelne  ->  http://localhost:{port}')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nbye')
