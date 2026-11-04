"""Mobile entry assets are public; camera/provider endpoints stay loopback-only."""
import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import server


class MobileStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()

    def request(self, path, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.http.server_port)
        conn.request('GET', path, headers=headers or {})
        response = conn.getresponse()
        result = response.status, response.getheader('Content-Type'), response.read()
        conn.close()
        return result

    def test_manifest_and_icons_are_served_with_correct_types(self):
        code, kind, content = self.request('/manifest.webmanifest')
        self.assertEqual(code, 200)
        self.assertIn('application/manifest+json', kind)
        manifest = json.loads(content)
        self.assertEqual(manifest['start_url'], './scan.html')
        self.assertEqual(manifest['scope'], './')
        self.assertEqual(manifest['display'], 'standalone')
        for icon in manifest['icons']:
            code, kind, content = self.request('/' + icon['src'].removeprefix('./'))
            self.assertEqual(code, 200)
            self.assertIn('image/svg+xml', kind)
            self.assertIn(b'<svg', content)

    def test_only_named_mobile_entry_is_added_to_static_allowlist(self):
        # Use a fixture so this check does not depend on the mobile page owner
        # finishing the page before the routing change can be tested.
        with tempfile.TemporaryDirectory() as folder, patch.object(server, 'ROOT', Path(folder).resolve()):
            root = Path(folder).resolve()
            for name in ('scan.html', 'manifest.webmanifest', 'other.html', 'server.py', '.env'):
                (root / name).write_text('fixture')
            self.assertEqual(server.static_file('/scan.html?installed=1'), root / 'scan.html')
            self.assertEqual(server.static_file('/manifest.webmanifest'), root / 'manifest.webmanifest')
            for route in ('/other.html', '/server.py', '/.env', '/%2eenv', '/web/../server.py'):
                self.assertIsNone(server.static_file(route), route)

    def test_mobile_assets_do_not_broaden_local_host_guard(self):
        for host in ('192.168.1.20', 'twinforge.example', 'untrusted.example'):
            code, _, _ = self.request('/manifest.webmanifest', {'Host': host})
            self.assertEqual(code, 403)
        code, _, _ = self.request('/api/status', {'Host': 'twinforge.example'})
        self.assertEqual(code, 403)


if __name__ == '__main__':
    unittest.main()
