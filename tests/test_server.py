import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
import server


class LocalServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        result = (response.status, response.read())
        conn.close()
        return result

    def test_only_public_assets_are_served(self):
        code, body = self.request('GET', '/')
        self.assertEqual(code, 200)
        self.assertIn(b'TWINFORGE', body)
        for path in ['/.env', '/%2eenv', '/.git/config', '/server.py', '/.twinforge/credits.jsonl', '/web/../../.env']:
            code, body = self.request('GET', path)
            self.assertEqual(code, 404, path)
            self.assertNotIn(b'BASETEN_API_KEY', body)

    def test_cross_origin_requests_cannot_trigger_paid_calls(self):
        code, _ = self.request('POST', '/api/advisor', '{}', {'Origin': 'https://untrusted.example', 'Content-Type': 'application/json'})
        self.assertEqual(code, 403)

    def test_dns_rebinding_host_is_rejected(self):
        code, _ = self.request('GET', '/api/status', headers={'Host': 'untrusted.example'})
        self.assertEqual(code, 403)

    def test_unknown_video_extension_is_rejected(self):
        code, _ = self.request('POST', '/api/upload', b'x', {'X-Filename': '.env', 'Content-Type': 'video/mp4'})
        self.assertEqual(code, 400)


if __name__ == '__main__':
    unittest.main()
