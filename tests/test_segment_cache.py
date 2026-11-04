import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from twinforge_runtime.segment_cache import CachedSegmentationClient
from twinforge_runtime.providers import ModelClient, ProviderUnavailable
from twinforge_runtime.budget import BudgetLedger


class SegmentCacheTests(unittest.TestCase):
    def test_reuse_is_bound_to_exact_pixels_and_prompt_without_paid_retry(self):
        with tempfile.TemporaryDirectory() as folder:
            calls = []
            def transport(url, key, payload):
                calls.append(payload)
                return {'output': [{'text': 'measured response'}]}
            client = ModelClient(ledger=BudgetLedger(Path(folder) / 'ledger'), transport=transport)
            import os
            from unittest.mock import patch
            with patch.dict(os.environ, {'META_MODEL_API_KEY': 'test-only'}):
                cache = CachedSegmentationClient(Path(folder) / 'cache', client)
                first = cache.segment('pixels', 'ball')
                self.assertEqual(first, cache.segment('pixels', 'ball'))
                self.assertEqual(len(calls), 1)
                offline = CachedSegmentationClient(Path(folder) / 'cache', client, offline=True)
                self.assertEqual(first, offline.segment('pixels', 'ball'))
                with self.assertRaises(ProviderUnavailable):
                    offline.segment('other-pixels', 'ball')
                path = next((Path(folder) / 'cache').glob('*.json'))
                entry = json.loads(path.read_text())
                entry['response']['output'] = []
                path.write_text(json.dumps(entry))
                with self.assertRaises(ValueError):
                    offline.segment('pixels', 'ball')
                self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
