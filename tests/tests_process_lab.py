import copy
import concurrent.futures
import http.client
import json
import math
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from twinforge_runtime.budget import BudgetLedger
from twinforge_runtime.providers import ModelClient, ProviderUnavailable
from twinforge_runtime.process_lab import (
    evaluate, fit_family, normalize_dataset, run_experiment, run_job,
    validate_options, validate_splits,
)


def independent_sensor(shot_id, initial, phase, family="sqrt_outflow", noise=.0004):
    """Separate RK4 fixture; estimator uses integral LS and Euler, never these params."""
    qin, kout, area = 1.8, 1.15, .03
    height = initial
    rows = []
    def velocity(h, valve):
        drain = math.sqrt(max(0., h)) if family == "sqrt_outflow" else max(0., h)
        if family == "constant_inflow":
            drain = 0.
        return (qin*valve-kout*drain)/(area*1000)
    for i in range(121):
        t = i*.1
        valve = [.15, .9, .3, .7][(i//30+phase)%4]
        rows.append({"t": t, "level_m": max(0., height+noise*math.sin(i*2.173+phase)), "valve": valve})
        for _ in range(20):
            dt = .005
            k1 = velocity(height, valve)
            k2 = velocity(height+dt*k1/2, valve)
            k3 = velocity(height+dt*k2/2, valve)
            k4 = velocity(height+dt*k3, valve)
            height = max(0., height+dt*(k1+2*k2+2*k3+k4)/6)
    return {"id": shot_id, "source_kind": "synthetic", "geometry": {"area_m2": area},
            "control_plan": [{"t": i*3., "valve": [.15, .9, .3, .7][(i+phase)%4]} for i in range(5)],
            "observations": rows, "evaluator_secret": {"qin": qin, "kout": kout}}


def experiment():
    return {"train": [independent_sensor("train-a", .15, 0), independent_sensor("train-b", .65, 1)],
            "validation": [independent_sensor("validation-only", .43, 2)],
            "test": [independent_sensor("never-sent-test-shot", .82, 3)], "truth": "MUST_NOT_LEAK"}


class ProcessLabTests(unittest.TestCase):
    def test_rk4_holdout_and_identifiable_parameters(self):
        splits = validate_splits(experiment())
        model = fit_family(splits["train"], "sqrt_outflow")
        self.assertAlmostEqual(model["parameters"]["qin_lps"], 1.8, delta=.02)
        self.assertAlmostEqual(model["parameters"]["kout"], 1.15, delta=.02)
        result = evaluate(model, splits["test"])
        self.assertLess(result["mean_error_cm"], .15)
        self.assertEqual(result["scored_predictions"], 19)

    def test_baseline_selects_by_validation_and_no_provider(self):
        with patch("twinforge_runtime.process_lab.ModelClient", side_effect=AssertionError("No provider in baseline")):
            report = run_experiment(experiment())
        self.assertEqual(report["provider_calls"], 0)
        self.assertEqual(report["selected_model"]["family"], "sqrt_outflow")
        self.assertTrue(report["passed"])
        self.assertTrue(report["freeze"]["test_revealed_after_selection"])
        self.assertEqual(report["selected_model"]["train_fingerprints"], report["provenance"]["split_fingerprints"]["train"])

    def test_future_test_changes_score_not_fit_or_selection(self):
        first = run_experiment(experiment())
        changed = experiment()
        for row in changed["test"][0]["observations"][50:]:
            row["level_m"] += .1
        second = run_experiment(changed)
        self.assertEqual(first["selected_model"], second["selected_model"])
        self.assertEqual(first["selection"], second["selection"])
        self.assertGreater(second["independent_test"]["mean_error_cm"], first["independent_test"]["mean_error_cm"])

    def test_prediction_reads_initial_level_and_commands_not_future_levels(self):
        splits = validate_splits(experiment())
        model = fit_family(splits["train"], "sqrt_outflow")
        first = evaluate(model, splits["test"])["predictions"][0]
        changed = copy.deepcopy(splits["test"])
        for row in changed[0]["observations"][10:]:
            row["level_m"] += .1
        second = evaluate(model, changed)["predictions"][0]
        self.assertEqual(first["predicted_level_m"], second["predicted_level_m"])
        self.assertAlmostEqual(second["observed_level_m"]-first["observed_level_m"], .1)

    def test_relabelled_reused_observations_rejected(self):
        data = experiment()
        data["test"] = [copy.deepcopy(data["train"][0])]
        data["test"][0]["id"] = "new-name-same-observations"
        with self.assertRaisesRegex(ValueError, "repeated"):
            run_experiment(data)

    def test_nonfinite_or_nonmonotonic_observations_rejected(self):
        for field, value in (("level_m", float("nan")), ("valve", 2.), ("t", -.1)):
            data = experiment()
            data["train"][0]["observations"][5][field] = value
            with self.assertRaises(ValueError):
                run_experiment(data)
        data = experiment()
        data["train"][0]["observations"][5]["t"] = 0.
        with self.assertRaisesRegex(ValueError, "strictly increase"):
            run_experiment(data)

    def test_unsupported_true_or_missing_splits_rejected(self):
        data = experiment()
        data["test"][0]["source_kind"] = "real"
        with self.assertRaises(ValueError):
            run_experiment(data)
        data = experiment()
        data["validation"] = []
        with self.assertRaises(ValueError):
            run_experiment(data)

    def test_no_excitation_rejected(self):
        data = normalize_dataset(independent_sensor("dry-command", .5, 0))
        for row in data["observations"]:
            row["valve"] = 0.
        with self.assertRaisesRegex(ValueError, "excitation"):
            fit_family([data], "sqrt_outflow")

    def test_forecast_requires_and_checks_ex_ante_commands(self):
        data = experiment()
        del data["test"][0]["control_plan"]
        with self.assertRaisesRegex(ValueError, "control_plan"):
            run_experiment(data)
        data = experiment()
        data["test"][0]["control_plan"][1]["valve"] = .123
        with self.assertRaisesRegex(ValueError, "differs"):
            run_experiment(data)

    def fake_client(self, folder, calls, mode="success"):
        def transport(url, key, payload):
            calls.append(payload)
            if mode == "unavailable":
                raise ProviderUnavailable("Controlled fixture failure")
            context = json.loads(payload["messages"][1]["content"])
            family = context["available_families"][0]
            content = json.dumps({"family": family, "reason": "Interpret observed validation residuals", "next_test": "Fit then measure"})
            return {"choices": [{"finish_reason": "length" if mode == "truncated" else "stop",
                                 "message": {"content": content}}],
                    "usage": {"prompt_tokens": 400, "completion_tokens": 150}}
        return ModelClient(BudgetLedger(folder, limit=.5), transport=transport)

    def test_model_gets_measured_feedback_but_no_test_or_evaluator(self):
        calls, events = [], []
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"META_MODEL_API_KEY": "unit-test-only"}):
            client = self.fake_client(folder, calls)
            report = run_experiment(experiment(), use_models=True, client=client, progress=events.append)
        self.assertEqual(len(calls), 3)
        self.assertEqual(report["provider_calls"], 3)
        self.assertTrue(report["passed"])
        self.assertLessEqual(report["budget"]["charged_delta_usd"], .12)
        serialized = json.dumps(calls)
        self.assertNotIn("never-sent-test-shot", serialized)
        self.assertNotIn("evaluator_secret", serialized)
        self.assertNotIn("MUST_NOT_LEAK", serialized)
        second = json.loads(calls[1]["messages"][1]["content"])
        self.assertEqual(second["validation_trials"][0]["status"], "measured")
        self.assertTrue(second["validation_trials"][0]["residuals"])
        phases = [e["phase"] for e in events]
        self.assertLess(phases.index("model_frozen"), phases.index("independent_test"))
        self.assertNotIn("unit-test-only", json.dumps(report))

    def test_budget_stops_before_first_provider_call(self):
        calls = []
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"META_MODEL_API_KEY": "unit-test-only"}):
            report = run_experiment(experiment(), use_models=True, client=self.fake_client(folder, calls), budget_cap_usd=0)
        self.assertFalse(calls)
        self.assertEqual(report["stop_reason"], "budget_exhausted")
        self.assertEqual(report["status"], "incomplete")
        self.assertFalse(report["passed"])

    def test_paid_truncation_and_failure_are_preserved_without_retry(self):
        for mode in ("truncated", "unavailable"):
            calls = []
            with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"META_MODEL_API_KEY": "unit-test-only"}):
                report = run_experiment(experiment(), use_models=True, client=self.fake_client(folder, calls, mode))
            self.assertEqual(len(calls), 1)
            self.assertEqual(report["provider_calls"], 1)
            self.assertEqual(report["stop_reason"], "provider_failed")
            self.assertFalse(report["passed"])
            self.assertGreater(report["budget"]["charged_delta_usd"], 0)

    def test_concurrent_runs_keep_separate_receipts_and_budgets(self):
        # Both runs share the SAME client and ledger. Interleave every call so a
        # snapshot-difference attribution would incorrectly count both jobs.
        barrier = threading.Barrier(2)
        calls = {}
        def transport(url, key, payload):
            name = threading.current_thread().name
            calls[name] = calls.get(name, 0) + 1
            context = json.loads(payload["messages"][1]["content"])
            barrier.wait(timeout=5)
            return {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
                "family": context["available_families"][0], "reason": "Concurrent mock fixture", "next_test": "Measure"})}}],
                "usage": {"prompt_tokens": 400, "completion_tokens": 150}}
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"META_MODEL_API_KEY": "unit-test-only"}):
            ledger = BudgetLedger(folder, limit=.5)
            client = ModelClient(ledger, transport=transport)
            def run(_):
                return run_experiment(experiment(), use_models=True, client=client)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                reports = list(pool.map(run, range(2)))
            self.assertIs(client.ledger, ledger)
            self.assertEqual(sorted(calls.values()), [3, 3])
            reservations = []
            for report in reports:
                self.assertTrue(report["passed"])
                self.assertEqual(report["provider_calls"], 3)
                self.assertAlmostEqual(report["budget"]["charged_delta_usd"], .0034125)
                own = {row["provider_receipt"]["request_id"] for row in report["journal"]}
                self.assertEqual({row["id"] for row in report["usage_records"]}, own)
                self.assertEqual(len(report["usage_records"]), 6)
                reservations.append(own)
            self.assertFalse(reservations[0] & reservations[1])
            self.assertEqual(ledger.summary()["requests"], 6)

    def test_concurrent_failed_reservations_belong_to_their_own_run(self):
        barrier = threading.Barrier(2)
        def transport(*args):
            barrier.wait(timeout=5)
            raise ProviderUnavailable("Simultaneous controlled failure")
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"META_MODEL_API_KEY": "unit-test-only"}):
            client = ModelClient(BudgetLedger(folder, limit=.5), transport=transport)
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                reports = list(pool.map(lambda _: run_experiment(experiment(), use_models=True, client=client), range(2)))
            reservations = []
            for report in reports:
                self.assertEqual(report["provider_calls"], 1)
                self.assertEqual(report["status"], "incomplete")
                self.assertEqual(len(report["usage_records"]), 2)
                self.assertEqual(report["usage_records"][1]["status"], "failed_cost_unconfirmed")
                self.assertAlmostEqual(report["budget"]["charged_delta_usd"], report["usage_records"][0]["budget_delta_usd"])
                reservations.append(report["usage_records"][0]["id"])
            self.assertNotEqual(*reservations)

    def test_observation_truth_never_in_public_report(self):
        report = run_experiment(experiment())
        self.assertNotIn("evaluator_secret", json.dumps(report))
        self.assertNotIn("MUST_NOT_LEAK", json.dumps(report))

    def test_options_cannot_select_arbitrary_model_prompt_or_spend(self):
        for body in ({"budget_cap_usd": .121}, {"max_iterations": 4}, {"seed": True},
                     {"use_models": "false"}, {"model": "something"}, {"prompt": "override"}):
            with self.assertRaises(ValueError):
                validate_options(body)

    def test_job_persists_phase_sequence_and_complete_export(self):
        with tempfile.TemporaryDirectory() as folder, patch("twinforge_runtime.process_lab.build_experiment", return_value=experiment()):
            result = run_job({}, folder)
            saved = json.loads((Path(folder)/"process-report.json").read_text())
            events = [json.loads(line) for line in (Path(folder)/"process-events.jsonl").read_text().splitlines()]
            self.assertEqual(saved, result["report"])
            self.assertEqual(events[-1]["phase"], "completed")


class ProcessApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import server
        cls.api = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.worker = threading.Thread(target=cls.api.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.api.shutdown()
        cls.api.server_close()
        cls.worker.join()

    def request(self, method, path, value=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.api.server_port)
        conn.request(method, path, json.dumps(value) if value is not None else None,
                     headers or {"Content-Type": "application/json"})
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result

    def test_spec_is_free_fixed_and_synthetic(self):
        status, result = self.request("GET", "/api/process/spec")
        self.assertEqual(status, 200)
        self.assertEqual(result["threshold_cm"], 1.)
        self.assertFalse(result["real_world_validation"])

    def test_invalid_or_remote_process_job_never_queues(self):
        with patch("server.JOBS.start", side_effect=AssertionError("Must not queue")):
            self.assertEqual(self.request("POST", "/api/jobs/process", {"budget_cap_usd": 1})[0], 400)
            self.assertEqual(self.request("POST", "/api/jobs/process", {"use_models": True}, {"Origin": "https://other.example"})[0], 403)
            self.assertEqual(self.request("POST", "/api/jobs/process", {"use_models": True}, {"Host": "other.example"})[0], 403)
            self.assertEqual(self.request("POST", "/api/jobs/process", {"prompt": "x"*5000})[0], 400)

    def test_process_endpoint_defaults_to_no_paid_model(self):
        with patch("server.JOBS.start", return_value={"id": "a"*32, "status": "queued"}) as start:
            status, result = self.request("POST", "/api/jobs/process", {})
            self.assertEqual(status, 202)
            callback = start.call_args[0][0]
            with patch("server.run_process_job", return_value={}) as job:
                callback(Path("unused"))
                self.assertIs(job.call_args[0][0]["use_models"], False)


if __name__ == "__main__":
    unittest.main()
