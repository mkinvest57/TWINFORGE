"""L3 scientist: Muse chooses known families; deterministic fitting owns the numbers.

The historical L1 gate was not established on real observations. This runner does
not reopen free code induction: it selects/calibrates known engines and says so.
The independent test split is only opened after the final family is frozen.
"""
import hashlib
import json
import math
from copy import deepcopy
from .budget import utc_now, BudgetExceeded
from .providers import ModelClient, message_content, ProviderUnavailable

FAMILIES = ("gravity", "quadratic_drag")
PLAN_SCHEMA = {"type": "object", "properties": {
    "family": {"type": "string", "enum": list(FAMILIES)},
    "reason": {"type": "string"}, "next_test": {"type": "string"}},
    "required": ["family", "reason", "next_test"], "additionalProperties": False}


def dataset_fingerprint(dataset):
    frames = [{"t": f.get("t"), "p": f.get("position_m", f.get("world_m")),
               "id": f.get("track_id")} for f in dataset.get("frames", [])]
    return hashlib.sha256(json.dumps(frames, sort_keys=True).encode()).hexdigest()


def validate_splits(train, validation, test):
    if not train:
        raise ValueError("At least one training shot is required")
    seen = set()
    sources = set()
    for name, datasets in (("train", train), ("validation", validation), ("test", test)):
        for dataset in datasets:
            if not isinstance(dataset, dict) or not isinstance(dataset.get("frames"), list) or len(dataset["frames"]) < 6:
                raise ValueError("Every shot needs at least six measured frames")
            digest = dataset_fingerprint(dataset)
            provenance = dataset.get("provenance", {})
            source = provenance.get("source_sha256") or provenance.get("video_sha256")
            if digest in seen or (source and source in sources):
                raise ValueError("Repeated shot or source across splits: independent validation/test required")
            seen.add(digest)
            if source:
                sources.add(source)


def describe(datasets):
    descriptions = []
    for dataset in datasets:
        frames = dataset["frames"]
        observed = [f for f in frames if f.get("position_m") is not None]
        stride = max(1, len(observed) // 16)
        # Give Muse actual observations, but no arbitrary metadata/evaluation constants.
        observations = [{"t": f["t"], "position_m": f["position_m"],
                         "velocity_m_s": f.get("velocity_m_s"), "quality": f.get("quality", {})}
                        for f in observed[::stride][:17]]
        provenance = dataset.get("provenance", {})
        calibration = dataset.get("calibration", {})
        descriptions.append({"sha256": dataset_fingerprint(dataset), "frames": len(frames),
                             "provenance": {k: provenance[k] for k in ("kind", "video_name", "video_sha256", "legacy") if k in provenance},
                             "calibration": {k: calibration[k] for k in ("mode", "metric", "dimensions_observed", "limitations") if k in calibration},
                             "observations": observations, "events": dataset.get("events", [])[:25]})
    return descriptions


def calibrate(train, validation=None, test=None, use_models=True, client=None, scene="hoop", threshold_cm=5.0, max_iterations=3):
    from induction.induce import fit_family, evaluate, normalize_dataset, assert_disjoint_splits
    validation, test = validation or [], test or []
    train = [normalize_dataset(d) for d in train]
    validation = [normalize_dataset(d) for d in validation]
    test = [normalize_dataset(d) for d in test]
    validate_splits(train, validation, test)
    assert_disjoint_splits(train, validation, test)
    if not math.isfinite(threshold_cm) or threshold_cm <= 0:
        raise ValueError("Prediction threshold must be positive")
    client = client or ModelClient()
    journal, candidates, attempted = [], {}, set()
    stop_reason = "iteration_limit"
    limit = max(1, min(int(max_iterations), 4))
    system = ("You select and calibrate KNOWN physics engines for TWINFORGE L3. "
              "This is not free physics induction. Choose the next untried family from gravity or quadratic_drag. "
              "Only deterministic fitting measures parameters and errors; never invent them. "
              "Interpret observed training/validation residuals, explain the hypothesis and next test. "
              "You have no evaluation parameters and no independent test observations. Return JSON only. "
              "Keep reason under 300 characters and next_test under 200 characters.")
    for iteration in range(limit):
        available = [family for family in FAMILIES if family not in attempted]
        if not available:
            stop_reason = "all_families_tested"
            break
        receipt = None
        if use_models:
            # Wonder is reserved for a difficult revision after a measured Spark candidate failed its threshold.
            previous = journal[-1].get("validation") if journal else None
            previous_error = previous.get("mean_error_cm") if previous else None
            difficult_revision = isinstance(previous_error, (int, float)) and previous_error > 2 * threshold_cm
            model = "muse-wonder-1.0" if iteration and difficult_revision else "muse-spark-1.3"
            context = {"train": describe(train), "validation": describe(validation),
                       "trials": journal, "available_families": available, "threshold_cm": threshold_cm}
            try:
                response = client.chat([{"role": "system", "content": system},
                                        {"role": "user", "content": json.dumps(context)}], model=model, scene=scene, schema=PLAN_SCHEMA,max_tokens=4096)
                choices=response.get("choices") or []
                if choices and choices[0].get("finish_reason")=="length":
                    raise ProviderUnavailable("Agent output was truncated; no hypothesis was applied")
                try:
                    plan = json.loads(message_content(response))
                except json.JSONDecodeError:
                    raise ProviderUnavailable("Agent returned incomplete JSON; no hypothesis was applied") from None
            except (BudgetExceeded, ProviderUnavailable) as error:
                if not candidates:
                    raise
                stop_reason = "budget_exhausted_best_available" if isinstance(error, BudgetExceeded) else "provider_unavailable_best_available"
                journal.append({"at": utc_now(), "iteration": iteration + 1,
                                "status": stop_reason, "error": str(error)})
                break
            if plan.get("family") not in available or not isinstance(plan.get("reason"), str):
                raise ValueError("Agent selected an invalid or already tested family")
            receipt = response.get("twinforge_receipt")
        else:
            plan = {"family": available[0], "reason": "Deterministic baseline, no model call", "next_test": "Measure on a separate validation shot"}
        attempted.add(plan["family"])
        try:
            fit = fit_family(train, family=plan["family"])
            score = evaluate(fit, validation) if validation else None
        except ValueError as error:
            journal.append({"at": utc_now(), "iteration": iteration + 1, "hypothesis": plan,
                            "status": "candidate_rejected", "error": str(error), "provider_receipt": receipt})
            continue
        candidates[plan["family"]] = {"fit": fit, "validation": score}
        journal.append({"at": utc_now(), "iteration": iteration + 1, "hypothesis": plan,
                        "parameters": fit.get("parameters"), "validation": score, "provider_receipt": receipt})
        error = score.get("mean_error_cm") if score else None
        if not validation:
            stop_reason = "no_validation_single_preselected_family"
            break
        if isinstance(error, (int, float)) and math.isfinite(error) and error <= threshold_cm:
            stop_reason = "validation_threshold_reached"
            break
    if not candidates:
        failures = "; ".join(item.get("error", "") for item in journal if item.get("error"))
        raise ValueError("No identifiable calibrated family: " + failures)
    def rank(item):
        score = item[1]["validation"]
        value = score.get("mean_error_cm") if score else None
        return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else math.inf
    family, selected = min(candidates.items(), key=rank)
    fit = selected["fit"]
    test_metrics = evaluate(fit, test) if test else None
    metrics = {"train_shots": [dataset_fingerprint(d) for d in train],
               "validation_shots": [dataset_fingerprint(d) for d in validation],
               "test_shots": [dataset_fingerprint(d) for d in test],
               "selection": selected["validation"], "independent_test": test_metrics,
               "validation_result": selected["validation"], "test_result": test_metrics,
               "family_selection": "independent_validation" if validation else "preselected_family_no_validation",
               "status": "independent_test_measured" if test_metrics else "no_independent_test_evidence",
               "held_out_cm": test_metrics.get("mean_error_cm") if test_metrics else None}
    twin = deepcopy(fit)
    twin.update(level="L3", status="L3_independent_test_measured" if test else "L3_unvalidated", validation=metrics)
    twin.update(g=twin["numeric"]["g"], drag=twin["numeric"]["drag"], held_out_cm=metrics["held_out_cm"])
    twin.setdefault("limitations", []).append("No physical control rig is represented by this run.")
    if not validation:
        twin["limitations"].append("No independent validation shot: family selection is not empirically validated.")
    if not test:
        twin["limitations"].append("No independent test shot: no held-out performance claim.")
    return {"schema_version": "twinforge.bundle.v1", "dataset": train[0], "twin": twin,
            "datasets": {"train": train, "validation": validation, "test": test},
            "scientist": {"mode": "Muse L3 selection and calibration" if use_models else "deterministic L3 baseline",
                          "journal": journal, "stop_reason": stop_reason,
                          "test_revealed_after_selection": bool(test), "budget": client.ledger.summary()}}
