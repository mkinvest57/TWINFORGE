"""Measured selection of three KNOWN tank models, never free law discovery.

Synthetic observations come from the shared civil-process fixture. Muse may order
the hypotheses and explain measured residuals. Numerical fitting owns parameters;
validation owns selection; independent test observations open only after freezing.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import time
from copy import copy

from .budget import BudgetExceeded, utc_now
from .providers import ModelClient, ProviderUnavailable, message_content, TOKEN_RATES

ROOT = Path(__file__).resolve().parents[1]
FAMILIES = ("constant_inflow", "linear_outflow", "sqrt_outflow")
MODEL = "muse-spark-1.3"
HORIZON_S = 3.0
THRESHOLD_CM = 1.0
MAX_RUN_USD = .12
MAX_TOKENS = 4096
MAX_CONTEXT_BYTES = 16000
PLAN_SCHEMA = {"type": "object", "properties": {
    "family": {"type": "string", "enum": list(FAMILIES)},
    "reason": {"type": "string"}, "next_test": {"type": "string"}},
    "required": ["family", "reason", "next_test"], "additionalProperties": False}
SYSTEM = (
    "You select among THREE KNOWN water-tank model families for civil process tuning. "
    "This is L3 known-model calibration, NOT discovery of laws. The observed variables "
    "are level_m and the commanded inlet valve [0,1]; geometry area_m2 is known. "
    "dh/dt=(qin_lps*valve - kout*f(h))/(1000*area_m2). constant_inflow has kout=0; "
    "linear_outflow uses f(h)=h; sqrt_outflow uses f(h)=sqrt(h). "
    "Select one untried available family; interpret prior measured validation errors "
    "and explain the next experiment. The protocol explores up to three families, "
    "then chooses by validation error, before revealing independent test observations. "
    "Only deterministic code fits parameters and computes scores. You have no true "
    "plant parameters or independent test observations. Never invent numbers. "
    "Return JSON only: family, reason (under 300 characters), next_test (under 200)."
)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()


def finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + " must be finite")
    return float(value)


def specification():
    return {"schema_version": "twinforge.process.spec.v1", "families": list(FAMILIES),
            "source_kind": "synthetic", "level": "L3", "horizon_s": HORIZON_S,
            "threshold_cm": THRESHOLD_CM, "threshold_fixed_before_measurement": True,
            "selection_metric": "mean_error_cm", "acceptance_metric": "mean_error_cm",
            "model": MODEL, "scene": "liquid", "max_iterations": 3,
            "maximum_run_cost_usd": MAX_RUN_USD,
            "known_geometry": "tank area_m2", "observations": ["t", "level_m", "valve"],
            "model_role": "Order known hypotheses and explain measured validation residuals",
            "numerical_role": "Fit training data; select on validation; score frozen model on test",
            "real_world_validation": False}


def validate_options(body):
    allowed = {"seed", "use_models", "max_iterations", "budget_cap_usd"}
    if not isinstance(body, dict) or set(body) - allowed:
        raise ValueError("Only seed, use_models, max_iterations and budget_cap_usd are accepted")
    seed = body.get("seed", 20261104)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 0xffffffff:
        raise ValueError("Seed must be an integer between 0 and 4294967295")
    use_models = body.get("use_models", False)
    if not isinstance(use_models, bool):
        raise ValueError("use_models must be boolean; the default uses no provider")
    iterations = body.get("max_iterations", 3)
    if isinstance(iterations, bool) or not isinstance(iterations, int) or not 1 <= iterations <= 3:
        raise ValueError("max_iterations must be between 1 and 3")
    budget = finite(body.get("budget_cap_usd", MAX_RUN_USD), "budget_cap_usd")
    if not 0 <= budget <= MAX_RUN_USD:
        raise ValueError("budget_cap_usd must be between 0 and 0.12; scene ceiling remains in force")
    return {"seed": seed, "use_models": use_models, "max_iterations": iterations,
            "budget_cap_usd": budget}


def build_experiment(seed):
    """Only the fixed shared fixture module runs; no submitted code or file paths."""
    node = shutil.which("node")
    if not node:
        raise ValueError("Node.js is required to generate the shared process observations")
    script = ("import {buildCalibrationChallenge} from './web/process/engine.mjs';"
              "console.log(JSON.stringify(buildCalibrationChallenge({seed:Number(process.argv[1])})))")
    run = subprocess.run([node, "--input-type=module", "-e", script, str(seed)], cwd=ROOT,
                         capture_output=True, text=True, timeout=60)
    if run.returncode:
        raise ValueError("Shared process fixture could not be generated")
    if len(run.stdout) > 4 * 1024 * 1024:
        raise ValueError("Process fixture exceeds observation limit")
    return json.loads(run.stdout)


def normalize_dataset(raw):
    if not isinstance(raw, dict) or raw.get("source_kind") != "synthetic":
        raise ValueError("This experiment accepts labelled synthetic observations only")
    shot_id = raw.get("shot_id", raw.get("id"))
    if not isinstance(shot_id, str) or not 1 <= len(shot_id) <= 100:
        raise ValueError("Every process shot requires an ID")
    area = finite(raw.get("geometry", {}).get("area_m2"), "area_m2")
    if not .001 <= area <= 10:
        raise ValueError("Tank area is outside the experiment bounds")
    rows = raw.get("observations")
    if not isinstance(rows, list) or not 12 <= len(rows) <= 2000:
        raise ValueError("Every shot requires 12–2000 level observations")
    observations = []
    for row in rows:
        t = finite(row.get("t"), "t")
        h = finite(row.get("level_m"), "level_m")
        u = finite(row.get("valve"), "valve")
        if t < 0 or not 0 <= h <= 10 or not 0 <= u <= 1:
            raise ValueError("Observation time, level or valve is outside physical bounds")
        if observations and t <= observations[-1]["t"]:
            raise ValueError("Observation times must strictly increase")
        observations.append({"t": t, "level_m": h, "valve": u})
    if observations[-1]["t"] - observations[0]["t"] < HORIZON_S + .5:
        raise ValueError("Every shot must cover a 3-second forecast and multiple starting points")
    plan = raw.get("control_plan")
    if not isinstance(plan, list) or not 1 <= len(plan) <= 2000:
        raise ValueError("A valve control_plan declared before the episode is required")
    commands = []
    for row in plan:
        t, valve = finite(row.get("t"), "command time"), finite(row.get("valve"), "command valve")
        if t < 0 or not 0 <= valve <= 1 or (commands and t <= commands[-1]["t"]):
            raise ValueError("Control plan must have ordered times and bounded commands")
        commands.append({"t": t, "valve": valve})
    if commands[0]["t"] > observations[0]["t"]:
        raise ValueError("Control plan does not cover the initial observation")
    for row in observations:
        commanded = next(c["valve"] for c in reversed(commands) if c["t"] <= row["t"]+1e-8)
        if abs(commanded-row["valve"]) > 1e-8:
            raise ValueError("Observed valve differs from the declared ex-ante control plan")
    # Whitelist only measured quantities; evaluator truth/metadata cannot leak to Muse.
    result = {"shot_id": shot_id, "id": shot_id, "source_kind": "synthetic",
              "geometry": {"area_m2": area}, "observations": observations, "control_plan": commands}
    result["fingerprint"] = digest({"geometry": result["geometry"], "observations": observations, "control_plan": commands})
    return result


def validate_splits(experiment):
    splits, seen, ids = {}, set(), set()
    for split in ("train", "validation", "test"):
        datasets = experiment.get(split)
        if not isinstance(datasets, list) or not 1 <= len(datasets) <= 8:
            raise ValueError("Independent train, validation and test shots are required")
        splits[split] = []
        for raw in datasets:
            data = normalize_dataset(raw)
            if data["fingerprint"] in seen or data["shot_id"] in ids:
                raise ValueError("A shot/observation fingerprint is repeated across splits")
            seen.add(data["fingerprint"])
            ids.add(data["shot_id"])
            splits[split].append(data)
    return splits


def drain_basis(family, height):
    if family == "constant_inflow":
        return 0.0
    return math.sqrt(max(0., height)) if family == "sqrt_outflow" else max(0., height)


def fit_family(train, family):
    """Integral volume balance in disjoint >=0.4s windows; nonnegative LS."""
    if family not in FAMILIES:
        raise ValueError("Unknown process family")
    samples = []
    for data in train:
        rows = data["observations"]
        start, inlet, drain = 0, 0., 0.
        for i in range(1, len(rows)):
            a, b = rows[i - 1], rows[i]
            dt = b["t"] - a["t"]
            inlet += a["valve"] * dt
            drain += .5 * (drain_basis(family, a["level_m"]) + drain_basis(family, b["level_m"])) * dt
            if b["t"] - rows[start]["t"] >= .4 - 1e-8:
                delta_l = (b["level_m"] - rows[start]["level_m"]) * data["geometry"]["area_m2"] * 1000
                samples.append((inlet, -drain, delta_l))
                start, inlet, drain = i, 0., 0.
    xx = sum(x*x for x, _, _ in samples)
    xy = sum(x*y for x, y, _ in samples)
    yy = sum(y*y for _, y, _ in samples)
    xz = sum(x*z for x, _, z in samples)
    yz = sum(y*z for _, y, z in samples)
    if xx <= 1e-12:
        raise ValueError("Inlet excitation is insufficient to identify flow")
    candidates = [(max(0., xz / xx), 0.)]
    if family != "constant_inflow":
        det = xx * yy - xy * xy
        if yy <= 1e-12 or det <= 1e-9 * max(xx*yy, 1):
            raise ValueError("Valve/level excitation is insufficient to identify drainage")
        qin, kout = (xz*yy-yz*xy)/det, (yz*xx-xz*xy)/det
        if qin >= 0 and kout >= 0:
            candidates.append((qin, kout))
        candidates.append((0., max(0., yz / yy)))
    qin, kout = min(candidates, key=lambda pair: sum((x*pair[0]+y*pair[1]-z)**2 for x, y, z in samples))
    residual = math.sqrt(sum((x*qin+y*kout-z)**2 for x, y, z in samples)/len(samples))
    return {"family": family, "parameters": {"qin_lps": qin, "kout": kout},
            "geometry": dict(train[0]["geometry"]),
            "units": {"qin_lps": "litre/second", "kout": {
                "constant_inflow": "fixed zero by family assumption",
                "linear_outflow": "litre/second/metre",
                "sqrt_outflow": "litre/second/sqrt(metre)"}[family]},
            "fit": {"method": "nonnegative least squares on integral volume balance",
                    "window_s": .4, "windows": len(samples), "volume_residual_rmse_l": residual},
            "train_fingerprints": [d["fingerprint"] for d in train],
            "level": "L3", "source_kind": "synthetic"}


def advance(height, valve, duration, area, model):
    """Euler forecast, with exact command boundaries; fixture integration is separate."""
    qin, kout = model["parameters"]["qin_lps"], model["parameters"]["kout"]
    remaining = duration
    while remaining > 1e-10:
        dt = min(.005, remaining)
        derivative = (qin * valve - kout * drain_basis(model["family"], height)) / (1000 * area)
        height = max(0., height + dt * derivative)
        remaining -= dt
    return height


def evaluate(model, datasets):
    """Causal 3s predictions: one current level + already scheduled valve commands."""
    predictions, errors = [], []
    for data in datasets:
        rows = data["observations"]
        next_start = rows[0]["t"]
        for start, first in enumerate(rows[:-1]):
            if first["t"] < next_start - 1e-8:
                continue
            target = first["t"] + HORIZON_S
            if target > rows[-1]["t"] + 1e-8:
                break
            height = first["level_m"]
            cursor = first["t"]
            plan = data["control_plan"]
            command_index = max(i for i, command in enumerate(plan) if command["t"] <= cursor+1e-8)
            while cursor < target-1e-10:
                boundary = plan[command_index+1]["t"] if command_index+1 < len(plan) else target
                end = min(target, boundary)
                height = advance(height, plan[command_index]["valve"], end-cursor, data["geometry"]["area_m2"], model)
                cursor = end
                if command_index+1 < len(plan) and cursor >= boundary-1e-10:
                    command_index += 1
            actual = None
            for j in range(start + 1, len(rows)):
                a, b = rows[j-1], rows[j]
                if b["t"] >= target - 1e-8:
                    fraction = min(1., max(0., (target-a["t"])/(b["t"]-a["t"])))
                    actual = a["level_m"] + fraction*(b["level_m"]-a["level_m"])
                    break
            if actual is None:
                continue
            error = abs(height - actual)*100
            errors.append(error)
            predictions.append({"shot_id": data["shot_id"], "issued_at_s": first["t"],
                                "target_at_s": target, "predicted_level_m": height,
                                "observed_level_m": actual, "error_cm": error})
            next_start = first["t"] + .5
    if not errors:
        raise ValueError("No independent forecast can be scored")
    return {"horizon_s": HORIZON_S, "mean_error_cm": sum(errors)/len(errors),
            "max_error_cm": max(errors), "rmse_cm": math.sqrt(sum(x*x for x in errors)/len(errors)),
            "scored_predictions": len(errors), "within_threshold": sum(x <= THRESHOLD_CM for x in errors),
            "threshold_cm": THRESHOLD_CM, "predictions": predictions,
            "known_future_inputs": "Preprogrammed valve commands only; no future level observation used in prediction",
            "source_kind": "synthetic"}


def describe(datasets):
    result = []
    for data in datasets:
        rows = data["observations"]
        indices = sorted({round(i*(len(rows)-1)/12) for i in range(13)})
        result.append({"shot_id": data["shot_id"], "fingerprint": data["fingerprint"],
                       "geometry": data["geometry"], "sample_count": len(rows),
                       "observations": [rows[i] for i in indices]})
    return result


def compact_score(score):
    return {key: value for key, value in score.items() if key != "predictions"}


def ledger_records(client):
    """Read only the already-expurgated ledger, never credentials or raw prompts."""
    # Use the same interprocess lock as writers: another run may be settling now.
    return client.ledger._transaction(lambda records: (records, None))


class RunLedger:
    """Attribute reservations to one run while retaining the shared scene ceiling.

    Failed calls still reserve and settle through this wrapper. Other browser
    tabs/CLI jobs may use the same base ledger without contaminating this report.
    """
    def __init__(self, base):
        self.base = base
        self.reserved_ids = set()
        self.charges = {}

    def __getattr__(self, name):
        return getattr(self.base, name)

    def reserve(self, scene, model, amount, request_hash):
        reservation = self.base.reserve(scene, model, amount, request_hash)
        self.reserved_ids.add(reservation)
        self.charges[reservation] = amount
        return reservation

    def settle(self, reservation, usage, actual=None, status="completed"):
        self.base.settle(reservation, usage, actual=actual, status=status)
        if reservation in self.charges and actual is not None:
            self.charges[reservation] = actual

    def run_spent(self):
        return sum(self.charges.values())


def call_plan(client, context, run_cap):
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": json.dumps(context, separators=(",", ":"))}]
    payload = {"model": MODEL, "messages": messages, "max_tokens": MAX_TOKENS,
               "reasoning_effort": "low", "response_format": {"type": "json_schema",
               "json_schema": {"name": "twinforge_result", "strict": True, "schema": PLAN_SCHEMA}}}
    payload_bytes = len(json.dumps(payload).encode())
    if payload_bytes > MAX_CONTEXT_BYTES:
        raise ValueError("Measured model context exceeds the fixed 16000-byte limit")
    ri, ro = TOKEN_RATES[MODEL]
    reserve = ((payload_bytes + 1024)*ri + MAX_TOKENS*ro) / 1_000_000
    if client.ledger.run_spent() + reserve > run_cap + 1e-12:
        raise BudgetExceeded("Process run cost ceiling reached before the next provider call")
    start = time.perf_counter()
    response = client.chat(messages, model=MODEL, scene="liquid", schema=PLAN_SCHEMA, max_tokens=MAX_TOKENS)
    duration = time.perf_counter()-start
    if (response.get("choices") or [{}])[0].get("finish_reason") == "length":
        raise ProviderUnavailable("Model output was truncated; no hypothesis applied and no automatic retry")
    try:
        plan = json.loads(message_content(response))
    except json.JSONDecodeError:
        raise ProviderUnavailable("Model returned invalid JSON; no automatic retry") from None
    if not isinstance(plan, dict) or set(plan) != {"family", "reason", "next_test"}:
        raise ProviderUnavailable("Model hypothesis did not match the scientific contract")
    if plan["family"] not in context["available_families"]:
        raise ProviderUnavailable("Model selected an unknown or already measured family")
    if not all(isinstance(plan[k], str) and 0 < len(plan[k]) <= 2000 for k in ("reason", "next_test")):
        raise ProviderUnavailable("Model hypothesis explanation is missing or exceeds the limit")
    receipt = {**response.get("twinforge_receipt", {}), "executed_at": utc_now(),
               "usage": response.get("usage", {}), "duration_seconds": duration,
               "reserved_cost_upper_bound_usd": reserve,
               "finish_reason": (response.get("choices") or [{}])[0].get("finish_reason")}
    usage = receipt["usage"]
    ni, no = usage.get("prompt_tokens", usage.get("input_tokens")), usage.get("completion_tokens", usage.get("output_tokens"))
    receipt["cost_usd"] = None if ni is None or no is None else (ni*ri+no*ro)/1_000_000
    return plan, receipt


def run_experiment(experiment, *, use_models=False, client=None, max_iterations=3,
                   budget_cap_usd=MAX_RUN_USD, progress=None):
    options = validate_options({"use_models": use_models, "max_iterations": max_iterations,
                                "budget_cap_usd": budget_cap_usd})
    started_at, clock = utc_now(), time.perf_counter()
    splits = validate_splits(experiment)
    if use_models:
        # Copy only the client shell; preserve transport/test doubles but do not
        # mutate a caller's client, which may also be used by another run.
        client = copy(client or ModelClient())
        client.ledger = RunLedger(client.ledger)
    else:
        client = None
    before = client.ledger.summary() if use_models else None
    journal, candidates, attempted = [], [], set()
    stop_reason = "all_families_measured" if max_iterations == 3 else "iteration_limit"
    emit = progress or (lambda event: None)
    emit({"phase": "started", "at": started_at, "specification": specification()})
    for iteration in range(options["max_iterations"]):
        available = [family for family in FAMILIES if family not in attempted]
        at, timer = utc_now(), time.perf_counter()
        context = {"train": describe(splits["train"]), "available_families": available,
                   "validation_trials": [{"hypothesis": row.get("hypothesis"), "parameters": row.get("parameters"),
                                          "validation": row.get("validation"), "status": row["status"],
                                          "residuals": row.get("validation_residuals", [])}
                                         for row in journal],
                   "threshold_cm": THRESHOLD_CM, "forecast_horizon_s": HORIZON_S,
                   "selection_metric": "mean_error_cm", "acceptance_metric": "mean_error_cm",
                   "source_kind": "synthetic", "test_observations_visible": False}
        emit({"phase": "hypothesis", "iteration": iteration+1, "at": at,
              "available_families": available, "mode": "meta" if use_models else "deterministic"})
        receipt = None
        if use_models:
            try:
                plan, receipt = call_plan(client, context, budget_cap_usd)
            except (BudgetExceeded, ProviderUnavailable, ValueError) as error:
                stop_reason = ("budget_exhausted" if isinstance(error, BudgetExceeded) else
                               "provider_failed" if isinstance(error, ProviderUnavailable) else "context_rejected")
                row = {"iteration": iteration+1, "at": at, "status": stop_reason,
                       "error": str(error), "duration_seconds": time.perf_counter()-timer}
                journal.append(row)
                emit({"phase": "stopped", **row})
                break  # A paid failure is retained; never a silent retry or fallback.
        else:
            plan = {"family": available[0], "reason": "Deterministic enumeration of known families; no model call",
                    "next_test": "Fit only training observations, then score separate validation shots"}
        attempted.add(plan["family"])
        try:
            model = fit_family(splits["train"], plan["family"])
            validation = evaluate(model, splits["validation"])
            row = {"iteration": iteration+1, "at": at, "hypothesis": plan, "status": "measured",
                   "parameters": model["parameters"], "validation": compact_score(validation),
                   "validation_residuals": validation["predictions"][::max(1, len(validation["predictions"])//6)][:6],
                   "provider_receipt": receipt, "duration_seconds": time.perf_counter()-timer}
            candidates.append({"model": model, "validation": validation})
        except ValueError as error:
            row = {"iteration": iteration+1, "at": at, "hypothesis": plan, "status": "fit_rejected",
                   "error": str(error), "provider_receipt": receipt, "duration_seconds": time.perf_counter()-timer}
        journal.append(row)
        emit({"phase": "validation", **row})
    selected, test, frozen_at, frozen_sha = None, None, None, None
    if candidates:
        selected = min(candidates, key=lambda c: c["validation"]["mean_error_cm"])
        frozen_at, frozen_sha = utc_now(), digest(selected["model"])
        emit({"phase": "model_frozen", "at": frozen_at, "model_sha256": frozen_sha,
              "selected_model": selected["model"], "selection": compact_score(selected["validation"])})
        test = evaluate(selected["model"], splits["test"])
        emit({"phase": "independent_test", "at": utc_now(), "metrics": compact_score(test)})
    after = client.ledger.summary() if use_models else None
    usage_records = [r for r in ledger_records(client) if r.get("id") in client.ledger.reserved_ids] if use_models else []
    result = {"schema_version": "twinforge.process.report.v1", "started_at": started_at,
              "completed_at": utc_now(), "duration_seconds": time.perf_counter()-clock,
              "status": "complete" if len(candidates) == max_iterations else "incomplete",
              "mode": "Meta-guided known-family calibration" if use_models else "deterministic known-family baseline",
              "specification": specification(), "source_kind": "synthetic", "real_world_validation": False,
              "provenance": {"experiment_sha256": digest(splits),
                             "split_fingerprints": {k: [d["fingerprint"] for d in v] for k, v in splits.items()},
                             "source_sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
                                               for p in [Path(__file__), ROOT/"web/process/engine.mjs"] if p.is_file()}},
              "datasets": splits, "journal": journal, "stop_reason": stop_reason,
              "selected_model": selected["model"] if selected else None,
              "selection": selected["validation"] if selected else None, "independent_test": test,
              "freeze": {"at": frozen_at, "model_sha256": frozen_sha,
                         "test_revealed_after_selection": bool(test), "model_sent_test_observations": False},
              "provider_calls": sum(r.get("event") == "reserved" for r in usage_records),
              "successful_hypotheses": sum(row.get("provider_receipt") is not None for row in journal),
              "usage_records": usage_records,
              "budget": {"run_cap_usd": budget_cap_usd, "scene": "liquid", "before": before, "after": after,
                         "snapshot_scope": "Shared ledger; before/after may include concurrent runs. Run charge uses exclusive reservation IDs.",
                         "charged_delta_usd": max(0., sum(r.get("budget_delta_usd", 0.) for r in usage_records))},
              "passed": bool(test and selected["validation"]["mean_error_cm"] <= THRESHOLD_CM
                             and test["mean_error_cm"] <= THRESHOLD_CM),
              "limitations": ["Synthetic water-level sensor; no physical installation or real video.",
                              "Three specified model families; no discovery or model-generated simulator code.",
                              "Known tank geometry and future scheduled valve commands are supplied.",
                              "No assertion that Meta ordering improves over deterministic enumeration."]}
    if result["status"] != "complete":
        result["passed"] = False
    emit({"phase": "completed", "at": result["completed_at"], "status": result["status"], "passed": result["passed"]})
    return result


def run_job(body, folder):
    options = validate_options(body)
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    events = folder / "process-events.jsonl"
    def progress(event):
        with events.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        temporary = folder / "process-progress.tmp"
        temporary.write_text(json.dumps(event, ensure_ascii=False, allow_nan=False))
        temporary.replace(folder / "process-progress.json")
    seed = options.pop("seed")
    experiment = build_experiment(seed)
    report = run_experiment(experiment, progress=progress, **options)
    report["provenance"]["generation_seed"] = seed
    report["provenance"]["generator"] = "web/process/engine.mjs:buildCalibrationChallenge"
    (folder / "process-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    return {"report": report, "provider_calls": report["provider_calls"], "mode": report["mode"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=20261104)
    parser.add_argument("--use-models", action="store_true")
    parser.add_argument("--max-iterations", type=int, default=3)
    parser.add_argument("--budget-cap-usd", type=float, default=MAX_RUN_USD)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    options = validate_options({"seed": args.seed, "use_models": args.use_models,
                                "max_iterations": args.max_iterations, "budget_cap_usd": args.budget_cap_usd})
    output = args.out.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    result = run_job(options, output.parent / (output.stem + "-events"))
    output.write_text(json.dumps(result["report"], ensure_ascii=False, indent=2, allow_nan=False))
    report = result["report"]
    print(json.dumps({"path": str(output), "status": report["status"], "passed": report["passed"],
                      "provider_calls": report["provider_calls"], "independent_test": compact_score(report["independent_test"]) if report["independent_test"] else None}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
