import json
import tempfile
import unittest
from pathlib import Path
from twinforge_runtime.budget import BudgetLedger, BudgetExceeded
from twinforge_runtime.providers import ModelClient
from twinforge_runtime.scientist import validate_splits


class BudgetTests(unittest.TestCase):
    def test_reservations_persist_and_failed_calls_keep_their_charge(self):
        with tempfile.TemporaryDirectory() as root:
            ledger = BudgetLedger(root, limit=.1)
            receipt = ledger.reserve("hoop", "model", .08, "hash")
            ledger.settle(receipt, {}, status="failed_cost_unconfirmed")
            with self.assertRaises(BudgetExceeded):
                BudgetLedger(root, limit=.1).reserve("hoop", "model", .03, "hash2")
            self.assertAlmostEqual(ledger.summary()["scenes"]["hoop"], .08)

    def test_actual_cost_releases_unused_reservation_once(self):
        with tempfile.TemporaryDirectory() as root:
            ledger = BudgetLedger(root, limit=.1)
            receipt = ledger.reserve("hoop", "model", .08, "hash")
            ledger.settle(receipt, {"input_tokens": 1}, actual=.01)
            self.assertAlmostEqual(ledger.summary()["scenes"]["hoop"], .01)
            with self.assertRaises(ValueError):
                ledger.settle(receipt, {}, actual=0)
            rows = [json.loads(x) for x in (Path(root)/"credits.jsonl").read_text().splitlines()]
            self.assertEqual(rows[1]["previous_hash"], rows[0]["hash"])

    def test_limit_checked_before_provider_is_called(self):
        with tempfile.TemporaryDirectory() as root:
            calls = []
            client = ModelClient(BudgetLedger(root, limit=0), lambda *args: calls.append(args))
            with self.assertRaises(BudgetExceeded):
                client._request("/test", {"model": "test"}, "hoop", .01, lambda _: 0, key="test")
            self.assertEqual(calls, [])


class SplitTests(unittest.TestCase):
    def test_same_observations_with_different_labels_are_rejected(self):
        data = {"frames": [{"t": i*.1, "position_m": [i, i*i, 0]} for i in range(8)]}
        changed_label = {**data, "video": "totally-new-shot.mp4"}
        with self.assertRaises(ValueError):
            validate_splits([data], [], [changed_label])

    def test_crops_from_same_source_are_not_independent(self):
        train = {"provenance": {"source_sha256": "same-video"}, "frames": [{"t": i, "position_m": [i, 0, 0]} for i in range(8)]}
        test = {"provenance": {"source_sha256": "same-video"}, "frames": [{"t": i+8, "position_m": [i+8, 0, 0]} for i in range(8)]}
        with self.assertRaises(ValueError):
            validate_splits([train], [], [test])


if __name__ == "__main__":
    unittest.main()
