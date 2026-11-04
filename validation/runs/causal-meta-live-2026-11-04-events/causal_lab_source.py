"""Bounded Meta proposal -> numerical counterfactual verification.

Spark sees the supplied initial state and bounded action menu, then outcomes of
its previous proposals. It never receives the exhaustive-search ranking before
choosing. This is a known-model simulation, not a validated real-world predictor.
"""
import argparse
from copy import copy
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import time

from .budget import BudgetExceeded, utc_now
from .process_lab import RunLedger
from .providers import ModelClient, ProviderUnavailable, TOKEN_RATES, message_content

ROOT = Path(__file__).resolve().parents[1]
MODEL = "muse-spark-1.3"
MAX_TOKENS = 1800
MAX_RUN_USD = .12
SCENARIOS = ("cascade", "crossing", "bottleneck")
SYSTEM = (
    "You plan a CIVIL simulated warehouse intervention. You can act ONCE on the "
    "one controllable carrier, choosing an exact id from available_actions. "
    "All bodies are circular 2D rigid bodies on a known floor; masses, drag and "
    "restitution are supplied, not inferred. Brake instantly reduces speed by "
    "amount; steer rotates velocity by amount radians without changing speed. "
    "Only the simulator can judge collisions and protected-cargo impact. "
    "Choose a plausible low-effort action that avoids damaging the protected "
    "cargo. Use previous measured outcomes to revise your next choice; do not "
    "repeat an action. You have no exhaustive-search scores or future positions. "
    "Be concise and explain the causal mechanism in French. Do not claim a "
    "real-world safety guarantee or invent numerical results. JSON only: "
    "candidate_id, reason, expected_effect. Each explanation under 350 characters."
)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def validate_options(raw):
    if not isinstance(raw, dict) or set(raw) - {"scenario_id", "seed", "perturbation", "action_delay_s", "max_iterations", "budget_cap_usd", "use_models"}:
        raise ValueError("Unknown causal experiment option")
    result = {"scenario_id": "cascade", "seed": 20261104, "perturbation": 1., "action_delay_s": .25,
              "max_iterations": 3, "budget_cap_usd": MAX_RUN_USD, "use_models": False, **raw}
    if result["scenario_id"] not in SCENARIOS:
        raise ValueError("Unknown causal scenario")
    if type(result["seed"]) is not int or not 0 <= result["seed"] <= 0xffffffff:
        raise ValueError("Seed must be an unsigned 32-bit integer")
    if type(result["max_iterations"]) is not int or not 1 <= result["max_iterations"] <= 3:
        raise ValueError("Use one to three proposals")
    if type(result["use_models"]) is not bool:
        raise ValueError("use_models must be boolean")
    for key, low, high in (("perturbation", .6, 1.4), ("action_delay_s", 0., 2.), ("budget_cap_usd", .001, MAX_RUN_USD)):
        value = result[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(key + " is outside the allowed range")
    return result


def bridge(options, action_id=None):
    node = shutil.which("node")
    if not node:
        raise ValueError("Node.js is required for causal verification")
    payload = {"options": options, "action_id": action_id}
    run = subprocess.run([node, str(ROOT / "validation/causal_bridge.mjs")], input=json.dumps(payload),
                         capture_output=True, text=True, cwd=ROOT, timeout=90)
    if run.returncode:
        raise ValueError("Causal solver could not complete")
    return json.loads(run.stdout)


def run_job(raw, folder, client=None, solver=None):
    options = validate_options(raw)
    solver = solver or bridge
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    report = {"schema_version": "twinforge.causal.meta.v1", "started_at": utc_now(),
              "source_kind": "synthetic", "mode": "known-model counterfactual intervention",
              "options": options, "journal": [], "provider_calls": 0,
              "scope": "Supplied initial states and contact law. Same-model replay, not independent prediction accuracy or hardware validation.",
              "model_role": "Propose a bounded intervention from geometry, then revise using measured outcomes. Numerical solver owns outcomes; exhaustive search is a separate baseline.",
              "source_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in
                                ("web/causal/engine.mjs", "validation/causal_bridge.mjs", "twinforge_runtime/causal_lab.py")}}
    start = time.perf_counter()
    initial = solver(options)
    report["initial_state_sha256"] = digest(initial["context"])
    report["initial_context"] = initial["context"]
    report["baseline"] = initial["baseline"]
    report["exhaustive_reference"] = initial["reference"]
    report["selected"] = None
    report["status"] = "running"
    client = copy(client or ModelClient()) if options["use_models"] else None
    if client:
        client.ledger = RunLedger(client.ledger)
    try:
        if not client:
            report["selected"] = initial["reference"]
            report["status"] = "complete"
            report["selection_origin"] = "local exhaustive search; no model call"
        else:
            available = list(initial["context"]["available_actions"])
            for iteration in range(options["max_iterations"]):
                context = {**initial["context"], "available_actions": available,
                           "previous_measurements": [{"candidate_id": row["proposal"]["candidate_id"], "verification": row["verification"]} for row in report["journal"]]}
                schema = {"type": "object", "properties": {
                    "candidate_id": {"type": "string", "enum": [a["id"] for a in available]},
                    "reason": {"type": "string"}, "expected_effect": {"type": "string"}},
                    "required": ["candidate_id", "reason", "expected_effect"], "additionalProperties": False}
                messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(context, separators=(",", ":"))}]
                payload = {"model": MODEL, "messages": messages, "max_tokens": MAX_TOKENS, "reasoning_effort": "low",
                           "response_format": {"type": "json_schema", "json_schema": {"name": "twinforge_result", "strict": True, "schema": schema}}}
                size = len(json.dumps(payload).encode())
                if size > 24000:
                    raise ValueError("Causal model context exceeds 24000 bytes")
                ri, ro = TOKEN_RATES[MODEL]
                reservation = ((size + 1024) * ri + MAX_TOKENS * ro) / 1_000_000
                if client.ledger.run_spent() + reservation > options["budget_cap_usd"] + 1e-12:
                    raise BudgetExceeded("Causal run cost ceiling reached before the next call")
                called_at = utc_now()
                call_start = time.perf_counter()
                response = client.chat(messages, model=MODEL, scene="causal", schema=schema, max_tokens=MAX_TOKENS)
                report["provider_calls"] += 1
                content = message_content(response)
                receipt = {**response["twinforge_receipt"], "executed_at": called_at,
                           "duration_seconds": time.perf_counter() - call_start, "usage": response.get("usage", {}),
                           "finish_reason": (response.get("choices") or [{}])[0].get("finish_reason")}
                row = {"iteration": iteration + 1, "receipt": receipt, "raw_response": content,
                       "context_sha256": digest(context)}
                report["journal"].append(row)
                if receipt["finish_reason"] == "length":
                    raise ProviderUnavailable("Truncated model response; not applied, no automatic retry")
                try:
                    proposal = json.loads(content)
                except json.JSONDecodeError:
                    raise ProviderUnavailable("Invalid model JSON; not applied") from None
                if not isinstance(proposal, dict) or set(proposal) != {"candidate_id", "reason", "expected_effect"}:
                    raise ProviderUnavailable("Model proposal does not match the bounded action contract")
                if proposal["candidate_id"] not in [a["id"] for a in available] or not all(isinstance(proposal[k], str) and 0 < len(proposal[k]) <= 2000 for k in ("reason", "expected_effect")):
                    raise ProviderUnavailable("Model proposal is unknown, repeated or invalid")
                row["proposal"] = proposal
                row["verification"] = solver(options, proposal["candidate_id"])["verification"]
                available = [a for a in available if a["id"] != proposal["candidate_id"]]
                (folder / "causal-progress.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
            verified = [row["verification"] for row in report["journal"] if "verification" in row]
            report["selected"] = min(verified, key=lambda v: (not v["metrics"]["safe"], v["metrics"]["protectedImpactEnergyJ"] if not v["metrics"]["safe"] else 0, v["metrics"]["controlImpulseNs"]))
            report["selection_origin"] = "numerical ranking among the model's verified proposals"
            report["status"] = "complete"
    except (ValueError, ProviderUnavailable, BudgetExceeded, KeyError) as error:
        report["status"] = "incomplete"
        report["error"] = str(error)[:400]
    report["charged_usd"] = client.ledger.run_spent() if client else 0.
    report["cost_basis"] = "Provider usage; failed calls retain reserved upper bound when billing is unknown" if client else "No provider call"
    report["duration_seconds"] = time.perf_counter() - start
    report["completed_at"] = utc_now()
    report["report_sha256"] = digest(report)
    (folder / "causal-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return {"report": report}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--models", action="store_true")
    parser.add_argument("--scenario", default="cascade", choices=SCENARIOS)
    args = parser.parse_args()
    result = run_job({"scenario_id": args.scenario, "use_models": args.models}, args.out.parent / (args.out.stem + "-events"))
    args.out.write_text(json.dumps(result["report"], ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: result["report"][k] for k in ("status", "provider_calls", "charged_usd", "duration_seconds")}))
