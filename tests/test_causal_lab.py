import json
import http.client
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch
import server
from pathlib import Path
import tempfile
import unittest

from twinforge_runtime.budget import BudgetLedger
from twinforge_runtime.causal_lab import run_job, validate_options
from twinforge_runtime.providers import ModelClient


def fake_solver(options, action_id=None):
    candidates = [{"id": "brake:" + str(i), "kind": "brake", "amount": i / 10} for i in (3, 6, 9)]
    metrics = {"safe": True, "protectedImpactEnergyJ": 0., "controlImpulseNs": 20.}
    if action_id is not None:
        return {"verification": {"action": next(a for a in candidates if a["id"] == action_id), "metrics": metrics}}
    return {"context": {"available_actions": candidates, "scenario_id": "cascade", "bodies": []},
            "baseline": {"metrics": {"safe": False, "protectedImpactEnergyJ": 50.}},
            "reference": {"action": candidates[0], "metrics": metrics}}


class CausalJobTests(unittest.TestCase):
    def test_options_cannot_inject_prompts_or_unbounded_cost(self):
        for bad in ({"messages": []}, {"budget_cap_usd": .13}, {"action_delay_s": float("nan")},
                    {"max_iterations": 4}, {"seed": True}, {"use_models": 1}, {"scenario_id": "missile"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate_options(bad)

    def test_free_job_does_not_call_model(self):
        with tempfile.TemporaryDirectory() as folder:
            result = run_job({}, Path(folder), solver=fake_solver)["report"]
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["provider_calls"], 0)
            self.assertEqual(result["charged_usd"], 0)

    def test_model_sees_only_prior_measurements_and_no_search_ranking(self):
        contexts = []
        def transport(url, key, payload):
            context = json.loads(payload["messages"][1]["content"])
            contexts.append(context)
            self.assertNotIn("reference", context)
            self.assertNotIn("exhaustive_reference", context)
            proposal = {"candidate_id": context["available_actions"][0]["id"], "reason": "Freiner avant le contact.", "expected_effect": "Réduire le choc."}
            return {"choices": [{"message": {"content": json.dumps(proposal)}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 100}}
        with tempfile.TemporaryDirectory() as folder:
            client = ModelClient(ledger=BudgetLedger(Path(folder) / "ledger"), transport=transport)
            import os
            from unittest.mock import patch
            with patch.dict(os.environ, {"META_MODEL_API_KEY": "unit-test-placeholder"}):
                report = run_job({"use_models": True}, Path(folder) / "job", client=client, solver=fake_solver)["report"]
            self.assertEqual(report["status"], "complete")
            self.assertEqual(report["provider_calls"], 3)
            self.assertEqual([len(c["previous_measurements"]) for c in contexts], [0, 1, 2])
            self.assertEqual([len(c["available_actions"]) for c in contexts], [3, 2, 1])
            self.assertAlmostEqual(report["charged_usd"], .00165)
            self.assertNotIsInstance(client.ledger, type(None))

    def test_invalid_model_action_is_recorded_but_never_evaluated(self):
        def transport(url, key, payload):
            return {"choices": [{"message": {"content": json.dumps({"candidate_id": "unbounded", "reason": "x", "expected_effect": "y"})}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 100, "completion_tokens": 100}}
        calls = []
        def solver(options, action_id=None):
            calls.append(action_id)
            return fake_solver(options, action_id)
        with tempfile.TemporaryDirectory() as folder:
            import os
            from unittest.mock import patch
            client = ModelClient(ledger=BudgetLedger(Path(folder) / "ledger"), transport=transport)
            with patch.dict(os.environ, {"META_MODEL_API_KEY": "unit-test-placeholder"}):
                report = run_job({"use_models": True}, Path(folder) / "job", client=client, solver=solver)["report"]
            self.assertEqual(report["status"], "incomplete")
            self.assertEqual(calls, [None])
            self.assertIsNone(report["selected"])
            self.assertEqual(len(report["journal"]), 1)
            self.assertGreater(report["charged_usd"], 0)


class CausalHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def request(self, body="{}", headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port)
        connection.request("POST", "/api/jobs/causal", body=body,
                           headers={"Content-Type": "application/json", **(headers or {})})
        response = connection.getresponse()
        result = response.status, json.loads(response.read())
        connection.close()
        return result

    def test_cross_origin_and_rebinding_cannot_queue_causal_model_calls(self):
        with patch.object(server.JOBS, "start") as start:
            for headers in ({"Origin": "https://untrusted.example"}, {"Host": "untrusted.example"}):
                with self.subTest(headers=headers):
                    status, result = self.request('{"use_models":true}', headers)
                    self.assertEqual(status, 403)
            start.assert_not_called()

    def test_causal_http_rejects_large_and_unknown_payloads_before_queueing(self):
        with patch.object(server.JOBS, "start") as start:
            for payload in ("{}" + " " * 4095, "[]", '{"messages":[]}',
                            '{"action_delay_s":3}', '{"use_models":1}', '{"budget_cap_usd":1}'):
                with self.subTest(payload_length=len(payload)):
                    status, result = self.request(payload)
                    self.assertEqual(status, 400)
                    self.assertIn("error", result)
            start.assert_not_called()

    def test_free_causal_request_passes_validated_defaults_to_job(self):
        queued = []
        with patch.object(server.JOBS, "start", side_effect=lambda work: queued.append(work) or {"id": "a" * 32}) as start:
            status, result = self.request()
        self.assertEqual(status, 202)
        self.assertEqual(result["id"], "a" * 32)
        self.assertEqual(len(queued), 1)
        with patch.object(server, "run_causal_job", return_value={}) as run:
            queued[0](Path("unused-mocked-folder"))
        options, folder = run.call_args.args
        self.assertFalse(options["use_models"])
        self.assertEqual(options["max_iterations"], 3)
        self.assertEqual(options["budget_cap_usd"], .12)
        self.assertEqual(options["scenario_id"], "cascade")


if __name__ == "__main__":
    unittest.main()
