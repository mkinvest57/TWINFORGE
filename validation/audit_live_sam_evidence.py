"""Audit retained live SAM exports against private local receipts; no API calls.

Public output includes hashes and metadata only, never input JPEGs or raw provider
responses. The named captures are separate cohorts, not an accuracy pool.
"""
import base64
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import statistics


ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "validation/runs/sam-live-2026-11-05"
COHORTS = [
    ("pendulum-baseline.json", "pendulum", "image_plane_kinematics", .5),
    ("collisions-baseline.json", "collisions", "image_plane_kinematics", .5),
    ("pendulum-adaptive-050.json", "pendulum", "image_plane_adaptive_motion", .5),
    ("pendulum-live-020-auto.json", "pendulum", "image_plane_adaptive_motion", .2),
    ("hosted-collisions-020.json", "collisions", "image_plane_adaptive_motion", .2),
    ("pendulum-color-020.json", "pendulum", "image_plane_adaptive_motion", .2),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(value):
    return sha(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode())


def distribution(values):
    if not values:
        return {"count": 0, "mean": None, "median": None, "p95": None, "min": None, "max": None}
    ordered = sorted(values)
    pos = .95 * (len(ordered) - 1)
    lower = math.floor(pos)
    upper = math.ceil(pos)
    return {
        "count": len(values), "mean": statistics.mean(values),
        "median": statistics.median(values),
        "p95": ordered[lower] + (ordered[upper] - ordered[lower]) * (pos - lower),
        "min": min(values), "max": max(values),
    }


def audit():
    checks = Counter()
    failures = []

    def check(name, condition, context):
        checks[name] += 1
        if not condition:
            failures.append({"check": name, "context": context})

    loaded, snapshots, owners = {}, {}, {}
    for filename, family, model, horizon in COHORTS:
        raw = (FOLDER / filename).read_bytes()
        export = json.loads(raw)
        loaded[filename] = {"file": filename, "sha256": sha(raw), "exported_at": export["exportedAt"]}
        check("synthetic_export_declares_no_hidden_state", export.get("hiddenSimulationStateConsumed") is False, filename)
        check("export_declares_no_physical_truth", export.get("physicalGroundTruthUsed") is False, filename)
        items = [("previousRuns[%d]" % i, run) for i, run in enumerate(export["previousRuns"])]
        items.append(("current", export["current"]))
        for location, run in items:
            rid = run["runId"]
            record = {"file": filename, "location": location, "exported_at": export["exportedAt"],
                      "run_sha256": canonical_sha(run), "run": run}
            snapshots.setdefault(rid, []).append(record)
            # Earlier cohorts own a run already carried in later export history.
            owners.setdefault(rid, filename)

    selected = {}
    for rid, records in snapshots.items():
        selected[rid] = max(records, key=lambda r: (
            r["exported_at"], r["run"]["timeS"] or 0,
            len(r["run"]["issued"]), len(r["run"]["assessments"]), r["location"] == "current"))

    deployment_path = FOLDER / "private-deployment-v5.json"
    deployment = json.loads(deployment_path.read_text())
    deployment_reference = {"file": deployment_path.name, "sha256": sha(deployment_path.read_bytes()),
                            "version_number": deployment["version_number"], "status": deployment["status"],
                            "source_commit": deployment["source_commit"], "access": deployment["access"]}
    check("hosted_deployment_record_matches_capture", deployment["status"] == "succeeded" and deployment["real_sam_browser_check"] == "hosted-collisions-020.json", deployment_path.name)
    ledger = [json.loads(line) for line in (ROOT / ".twinforge/credits.jsonl").read_text().splitlines() if line.strip()]
    reserved = {r["id"]: r for r in ledger if r["event"] == "reserved"}
    settled = {r["id"]: r for r in ledger if r["event"] == "settled"}
    receipt_ids = set()
    public_runs = {}
    for rid, snapshot in selected.items():
        run = snapshot["run"]
        check("run_source_is_synthetic", run["sourceKind"] == "synthetic", rid)
        receipts = {}
        public_receipts = []
        for record in run["samRecords"]:
            receipt = record["receipt"]
            request_id = receipt["request_id"]
            check("receipt_unique_across_deduplicated_runs", request_id not in receipt_ids, request_id)
            receipt_ids.add(request_id)
            receipts[request_id] = record
            if owners[rid] == "hosted-collisions-020.json":
                check("hosted_receipt_source_is_synthetic", record["sourceKind"] == "synthetic" and record["runId"] == rid, request_id)
                check("hosted_receipt_names_sam", receipt["model"] == record["model"] == "sam-3.1", request_id)
                check("hosted_receipt_hashes_well_formed", bool(re.fullmatch(r"[0-9a-f]{32}", request_id) and re.fullmatch(r"[0-9a-f]{64}", receipt["request_sha256"]) and re.fullmatch(r"[0-9a-f]{64}", record["imageSha256"])), request_id)
                check("hosted_receipt_has_bounded_charge_and_latency", record["chargedUsd"] == .0025 and math.isfinite(record["latencyMs"]) and record["latencyMs"] >= 0, request_id)
                public_receipts.append({
                    "request_id": request_id, "request_sha256": receipt["request_sha256"],
                    "image_sha256": record["imageSha256"], "evidence_id": record["evidenceId"],
                    "frame_id": record["frameId"], "source_time_s": record["sourceTimeS"],
                    "latency_ms": record["latencyMs"], "accounted_usd": record["chargedUsd"],
                    "detected_objects": record["detectedCount"], "serverReceiptVerifiedLocally": False,
                    "verification_basis": "Live production-browser export and recorded private deployment verification; not matched to a local private audit or local ledger.",
                })
                continue
            path = ROOT / ".twinforge/live-sam" / rid / (record["evidenceId"] + ".json")
            raw = path.read_bytes()
            private = json.loads(raw)
            result = private["result"]
            jpeg = (path.parent / private["input_jpeg"]).read_bytes()
            payload = {"model": "sam-3.1", "input": [{"role": "user", "content": [
                {"type": "input_text", "text": private["concept"]},
                {"type": "input_image", "image_url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()},
            ]}]}
            check("private_audit_completed", private["status"] == "complete", request_id)
            check("actual_provider_response_completed", private["provider_response"].get("status") == "completed", request_id)
            check("actual_sam_model", private["model"] == record["model"] == receipt["model"] == "sam-3.1", request_id)
            check("private_receipt_matches", private["receipt"] == receipt == result["receipt"] == private["provider_response"]["twinforge_receipt"], request_id)
            check("exact_input_jpeg_hash_matches", sha(jpeg) == record["imageSha256"] == private["image_sha256"] == result["image_sha256"], request_id)
            check("exact_provider_request_hash_matches", sha(json.dumps(payload, sort_keys=True).encode()) == receipt["request_sha256"], request_id)
            check("capture_identity_matches", private["run_id"] == record["runId"] == rid and private["frame_id"] == record["frameId"], request_id)
            check("capture_metadata_matches", private["source_time_s"] == record["sourceTimeS"] and private["width"] == record["width"] and private["height"] == record["height"], request_id)
            check("receipt_source_is_synthetic", private["source_kind"] == record["sourceKind"] == "synthetic", request_id)
            check("private_result_confirms_live_call", result["live_provider_call"] is True, request_id)
            check("latency_and_charge_match_private_result", record["latencyMs"] == result["latency_ms"] and record["chargedUsd"] == result["charged_usd"], request_id)
            reservation, settlement = reserved.get(request_id), settled.get(request_id)
            check("ledger_completed_actual_request", bool(reservation and settlement and reservation["scene"] == settlement["scene"] == "vision" and settlement["status"] == "completed" and reservation["request_sha256"] == receipt["request_sha256"] and settlement["cost_usd"] == record["chargedUsd"]), request_id)
            public_receipts.append({
                "request_id": request_id, "request_sha256": receipt["request_sha256"],
                "image_sha256": record["imageSha256"], "private_audit_sha256": sha(raw),
                "evidence_id": record["evidenceId"], "frame_id": record["frameId"],
                "source_time_s": record["sourceTimeS"], "latency_ms": record["latencyMs"],
                "accounted_usd": record["chargedUsd"], "detected_objects": record["detectedCount"],
                "serverReceiptVerifiedLocally": True,
            })

        predictions = {p["id"]: p for p in run["issued"]}
        check("prediction_identifiers_unique", len(predictions) == len(run["issued"]), rid)
        for p in predictions.values():
            check("forecast_uses_only_already_observed_times", bool(p["usedTimes"]) and all(math.isfinite(t) and t <= p["issuedAtSourceTimeS"] + 1e-9 for t in p["usedTimes"]), p["id"])
            check("forecast_precedes_target", p["issuedAtSourceTimeS"] < p["targetTime"] and abs(p["sourceTime"] - p["issuedAtSourceTimeS"]) < 1e-9, p["id"])
            check("forecast_horizon_matches_timestamps", abs(p["targetTime"] - p["sourceTime"] - p["horizon"]) < 1e-9, p["id"])
            check("forecast_references_actual_run_sam_receipt", p["samRequestId"] in receipts, p["id"])
            if p["samRequestId"] in receipts:
                check("sam_received_before_forecast_issue", receipts[p["samRequestId"]]["receivedAtSourceTimeS"] <= p["issuedAtSourceTimeS"] + 1e-9, p["id"])
            check("forecast_source_is_synthetic", p["sourceKind"] == "synthetic" and p["runId"] == rid, p["id"])

        assessed_ids = set()
        early_unscorable = 0
        errors = []
        for assessment in run["assessments"]:
            pid = assessment["predictionId"]
            check("assessment_matches_unique_issued_forecast", pid in predictions and pid not in assessed_ids, pid)
            assessed_ids.add(pid)
            p = predictions[pid]
            check("assessment_source_is_synthetic", assessment["sourceKind"] == "synthetic" and assessment["runId"] == rid, pid)
            if assessment["status"] == "scored":
                check("score_occurs_after_target_observed", assessment["scoredAtSourceTimeS"] + 1e-9 >= p["targetTime"], pid)
                check("score_is_local_tracking_not_physical_truth", assessment["measurementSource"] == "subsequent_local_pixel_tracking" and assessment["independentPhysicalGroundTruth"] is False, pid)
                times = assessment["bracketTimes"]
                check("score_bracket_contains_target_and_is_available", times[0] <= p["targetTime"] + 1e-9 and times[1] + 1e-9 >= p["targetTime"] and times[1] <= assessment["scoredAtSourceTimeS"] + 1e-9, pid)
                actual = assessment["actual"]
                measured = math.hypot(p["point"]["x"] - actual["x"], p["point"]["y"] - actual["y"])
                check("exported_error_matches_frozen_target", abs(measured - assessment["errorPx"]) < 1e-6, pid)
                errors.append(assessment["errorPx"])
            else:
                check("unscorable_has_no_numeric_error", assessment["status"] == "unscorable" and assessment["errorPx"] is None, pid)
                early_unscorable += assessment["scoredAtSourceTimeS"] < p["targetTime"]

        failed_local_attempts = []
        if owners[rid] != "hosted-collisions-020.json":
            for path in (ROOT / ".twinforge/live-sam" / rid).glob("*.json"):
                if path.name == "state.json":
                    continue
                raw = path.read_bytes()
                evidence = json.loads(raw)
                if evidence.get("status") != "failed":
                    continue
                budget_rejected = evidence.get("error_type") == "BudgetExceeded" and "receipt" not in evidence and "provider_response" not in evidence
                failed_local_attempts.append({"evidence_id": path.stem, "private_audit_sha256": sha(raw),
                    "frame_id": evidence["frame_id"], "source_time_s": evidence["source_time_s"],
                    "error_type": evidence.get("error_type"), "unbilled_budget_rejection": budget_rejected})
                if budget_rejected:
                    check("budget_rejected_frame_has_no_sam_receipt", not any(r["frame_id"] == evidence["frame_id"] for r in public_receipts), rid)
        public_runs[rid] = {
            "run_id": rid, "selected_snapshot": {k: snapshot[k] for k in ("file", "location", "exported_at", "run_sha256")},
            "all_snapshot_sources": [{k: s[k] for k in ("file", "location", "exported_at", "run_sha256")} for s in snapshots[rid]],
            "source_kind": run["sourceKind"], "image_width": run["width"], "image_height": run["height"],
            "duration_source_s": run["timeS"], "horizon_s": sorted({p["horizon"] for p in run["issued"]}),
            "run_horizon_metadata_s": run.get("horizonS"), "models": dict(Counter(p["model"] for p in run["issued"])),
            "motion_models": dict(Counter(p.get("motionModel", "baseline") for p in run["issued"])),
            "observation_reason_counts": dict(Counter(o.get("reason", "unspecified") for o in run["observations"])),
            "issued_forecasts": len(predictions), "scored_forecasts": len(errors),
            "unscorable_forecasts": len(run["assessments"]) - len(errors), "unassessed_forecasts": len(predictions.keys() - assessed_ids),
            "unscorable_reasons": dict(Counter(a["reason"] for a in run["assessments"] if a["status"] == "unscorable")),
            "unscorable_invalidated_before_target": early_unscorable,
            "error_px_on_scored_forecasts_only": distribution(errors),
            "sam_actual_completed_calls": len(public_receipts), "sam_accounted_usd": round(sum(r["accounted_usd"] for r in public_receipts), 6),
            "browser_submission_attempts": run["runCalls"], "failed_local_frame_attempts": failed_local_attempts,
            "serverReceiptVerifiedLocally": all(r["serverReceiptVerifiedLocally"] for r in public_receipts),
            "backend": "private_hosted" if owners[rid] == "hosted-collisions-020.json" else "local_python",
            "sam_response_latency_ms": distribution([r["latency_ms"] for r in public_receipts]),
            "sam_receipts": public_receipts,
        }

    cohorts = []
    for filename, family, model, horizon in COHORTS:
        runs = [public_runs[rid] for rid in selected if owners[rid] == filename]
        for run in runs:
            check("cohort_horizon_matches_forecasts", run["horizon_s"] == [horizon], run["run_id"])
            check("cohort_model_matches_forecasts", set(run["models"]) == {model}, run["run_id"])
        cohorts.append({"cohort_file": filename, "file_sha256": loaded[filename]["sha256"], "family_label": family,
                        "family_label_source": "operator capture filename; family is not passed to the predictor",
                        "forecast_model": model, "forecast_horizon_s": horizon,
                        "runs": runs, "aggregate_error_metrics": None})

    replay_path = FOLDER / "motion-replay.json"
    replay = json.loads(replay_path.read_text())
    check("offline_replay_is_not_new_live_inference", replay["newLiveCalls"] == 0 and replay["type"] == "offline_past_only_motion_replay", replay_path.name)
    check("offline_replay_input_matches_retained_capture", replay["inputSha256"] in {record["sha256"] for record in loaded.values()}, replay_path.name)
    for filename, record in loaded.items():
        check("export_unchanged_during_audit", sha((FOLDER / filename).read_bytes()) == record["sha256"], filename)
    short_replay_path = FOLDER / "short-window-replay.json"
    short_replay = json.loads(short_replay_path.read_text())
    check("short_window_replay_declares_development_only", short_replay["type"] == "offline_development_replay" and short_replay["newLiveCalls"] == 0 and short_replay["originalRecordingsModified"] is False, short_replay_path.name)
    for entry in short_replay["inputs"]:
        check("short_window_replay_input_hash_matches", entry["file"] in loaded and loaded[entry["file"]]["sha256"] == entry["sha256"], entry["file"])
    for entry in short_replay["runs"]:
        live = public_runs[entry["runId"]]
        check("short_window_replay_preserves_original_live_metrics", entry["originalScored"] == live["scored_forecasts"] and abs(entry["originalMeanErrorPx"] - live["error_px_on_scored_forecasts_only"]["mean"]) < 1e-8, entry["runId"])
    summary = {
        "schema_version": "twinforge.live-sam-evidence-audit.v1", "audited_at": datetime.now(timezone.utc).isoformat(),
        "audit_command": ".venv/bin/python -B validation/audit_live_sam_evidence.py", "audit_script_sha256": sha(Path(__file__).read_bytes()),
        "timestamp_comparison_tolerance_s": 1e-9,
        "provider_calls_by_audit": 0, "audit_passed": not failures, "checks_executed": dict(checks), "failures": failures,
        "inputs": list(loaded.values()), "snapshot_records": sum(map(len, snapshots.values())), "unique_runs": len(selected),
        "duplicate_snapshot_records_removed": sum(map(len, snapshots.values())) - len(selected),
        "deduplication": "One latest exported snapshot per run ID; ties use source time, completeness, then current snapshot. A run belongs to the first input cohort containing it.",
        "unique_actual_completed_sam_calls": len(receipt_ids),
        "locally_matched_private_completed_calls": sum(r["sam_actual_completed_calls"] for r in public_runs.values() if r["serverReceiptVerifiedLocally"]),
        "hosted_calls_from_production_browser_export": sum(r["sam_actual_completed_calls"] for r in public_runs.values() if not r["serverReceiptVerifiedLocally"]),
        "hosted_deployment_reference": deployment_reference,
        "pooled_error_metrics": None, "cohorts": cohorts,
        "separate_offline_analysis": {"file": replay_path.name, "sha256": sha(replay_path.read_bytes()),
                                      "type": replay["type"], "new_live_calls": replay["newLiveCalls"],
                                      "included_as_fresh_live_benchmark": False,
                                      "note": "Replay changes fitted forecasts over retained observations. Its apparent improvement is separate from the live-issued forecasts audited here."},
        "additional_offline_analysis": {"file": short_replay_path.name, "sha256": sha(short_replay_path.read_bytes()),
                                        "type": short_replay["type"], "new_live_calls": short_replay["newLiveCalls"],
                                        "included_as_fresh_live_benchmark": False,
                                        "note": "Short-window candidates were tuned during development on retained observations. The original live counts and errors were cross-checked, not replaced by replay errors. This audit does not independently rerun that analysis."},
        "limits": [
            "All audited source frames are synthetic. No real-camera or phone accuracy is established.",
            "Errors compare frozen pixel targets with subsequent local visual tracking, not independently measured physical ground truth.",
            "Metrics are conditional on issued and scorable forecasts; missing/refused forecasts are not assigned zero error.",
            "Horizon, scene family and model cohorts remain separate. No pooled precision or general accuracy claim is made.",
            "Early unscorable invalidations are permissible: a stop or reset can abandon a target before its time. Numeric scores must wait until target observations exist.",
            "SAM latency is the exported server response latency including local work, not a pure model-runtime measurement.",
            "Local cohorts were matched to private completed audits, exact JPEG hashes, reconstructed provider request hashes and ledger settlements. Hosted receipts were not matched to that local storage; serverReceiptVerifiedLocally is false for them.",
            "The hosted cohort is supported by the production-browser export and the recorded private v5 deployment check. This audit did not query the hosted database or independently rerun inference, and makes no statement about a later deployment.",
            "Public output contains no images, raw provider responses or credentials.",
            "Application hashes and receipts provide traceability, not provider-signed attestation.",
        ],
    }
    (FOLDER / "live-evidence-summary.json").write_text(json.dumps(summary, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"passed": summary["audit_passed"], "unique_runs": len(selected),
                      "unique_completed_sam_calls": len(receipt_ids), "failures": failures,
                      "runs": [{"run_id": r["run_id"], "horizon_s": r["horizon_s"], "scored": r["scored_forecasts"],
                                "unscorable": r["unscorable_forecasts"], "mean_error_px": r["error_px_on_scored_forecasts_only"]["mean"]} for r in public_runs.values()]}, indent=2))
    return not failures


if __name__ == "__main__":
    raise SystemExit(0 if audit() else 1)
