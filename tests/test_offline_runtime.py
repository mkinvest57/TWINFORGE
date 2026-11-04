import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from twinforge_runtime.budget import BudgetLedger
from twinforge_runtime.providers import ModelClient, ProviderUnavailable
from twinforge_runtime.narration import narrate_local


class NarrationTests(unittest.TestCase):
    def test_offline_summary_preserves_failures_and_unknowns(self):
        evidence = {'report': {'level': 'L3', 'run': {'mode': 'simulation'},
                    'session_metrics': {'completedShots': 7, 'correctVerdicts': 6, 'errorSum': 140, 'errorCount': 10},
                    'scenes': [{'id': 'hoop', 'tests': [{'id': 'prediction', 'status': 'fail', 'reason': '46.7 cm'},
                              {'id': 'induction', 'status': 'blocked', 'reason': 'No independent shot'}]}]}}
        result = narrate_local(evidence)
        self.assertFalse(result['generated_by_model'])
        self.assertIsNone(result['model'])
        self.assertEqual(result['summary']['ghost_error_mean_cm'], 14)
        self.assertIn('46.7 cm', result['content'])
        self.assertIn('ne constituent pas une validation physique réelle', result['content'])
        empty = narrate_local({})
        self.assertIsNone(empty['summary']['ghost_error_mean_cm'])
        self.assertIn('aucune mesure', empty['content'])

    def test_glimmer_remote_usage_is_charged_and_only_summary_is_sent(self):
        seen = []
        def transport(url, key, payload):
            seen.append((url, key, payload))
            return {'model': payload['model'], 'choices': [{'message': {'content': 'Simulation.'}}],
                    'usage': {'prompt_tokens': 1000, 'completion_tokens': 100}}
        with tempfile.TemporaryDirectory() as root, patch('twinforge_runtime.providers.load_env'), patch.dict('os.environ', {'TOGETHER_API_KEY': 'test-provider-key'}, clear=True):
            client = ModelClient(BudgetLedger(root), transport)
            client.narrate({'report': {'run': {'mode': 'simulation'}}, 'secret_unused_metadata': 'must-not-be-transmitted'})
            self.assertEqual(seen[0][0], 'https://api.together.ai/v1/chat/completions')
            self.assertEqual(seen[0][2]['model'], 'meta-models/Muse-Glimmer-30B')
            self.assertNotIn('must-not-be-transmitted', json.dumps(seen[0][2]))
            self.assertAlmostEqual(client.ledger.summary()['scenes']['hoop'], .0005)

    def test_unknown_host_prices_refused_before_transport(self):
        seen = []
        with tempfile.TemporaryDirectory() as root, patch('twinforge_runtime.providers.load_env'), patch.dict('os.environ', {'GLIMMER_BASE_URL': 'https://example.test/v1', 'GLIMMER_API_KEY': 'test-key'}, clear=True):
            client = ModelClient(BudgetLedger(root), lambda *args: seen.append(args))
            with self.assertRaisesRegex(ProviderUnavailable, 'prices'):
                client.narrate({})
            self.assertEqual(seen, [])

    def test_unconfigured_glimmer_never_calls_another_provider(self):
        with tempfile.TemporaryDirectory() as root, patch('twinforge_runtime.providers.load_env'), patch.dict('os.environ', {}, clear=True):
            calls = []
            client = ModelClient(BudgetLedger(root), lambda *args: calls.append(args))
            with self.assertRaises(ProviderUnavailable): client.narrate({})
            self.assertEqual(calls, [])


class JobRecoveryTests(unittest.TestCase):
    def test_completed_job_survives_server_restart_without_rerun(self):
        with tempfile.TemporaryDirectory() as root, patch.object(server, 'DATA', Path(root)):
            jid = 'a' * 32; folder = Path(root) / 'jobs' / jid; folder.mkdir(parents=True)
            (folder / 'status.json').write_text(json.dumps({'id': jid, 'status': 'complete', 'result': {'measured': 42}}))
            jobs = server.Jobs()
            try:
                self.assertEqual(jobs.get(jid)['result']['measured'], 42)
                self.assertIsNone(jobs.get('../../.env'))
                (folder / 'status.json').write_text(json.dumps({'id': jid, 'status': 'running'}))
                self.assertEqual(jobs.get(jid)['status'], 'interrupted')
            finally: jobs.pool.shutdown()


if __name__ == '__main__': unittest.main()
