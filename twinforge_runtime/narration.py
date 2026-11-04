"""Measured anomaly summaries, available offline without impersonating a model."""
import math


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def summarize(evidence):
    if not isinstance(evidence, dict):
        raise ValueError("Evidence must be an object")
    report = evidence.get("report", evidence)
    if not isinstance(report, dict):
        raise ValueError("Evidence report must be an object")
    metrics = report.get("session_metrics") or {}
    summary = {"mode": report.get("run", {}).get("mode", "unknown"),
               "level": report.get("level", "L3"),
               "completed_shots": number(metrics.get("completedShots")),
               "correct_verdicts": number(metrics.get("correctVerdicts")),
               "ghost_error_mean_cm": number(metrics.get("ghost_error_mean_cm")),
               "open_checks": [], "failed_checks": [], "scene_count": 0}
    if summary["ghost_error_mean_cm"] is None and number(metrics.get("errorCount")) and number(metrics.get("errorSum")) is not None:
        summary["ghost_error_mean_cm"] = metrics["errorSum"] / metrics["errorCount"]
    for scene in report.get("scenes", [])[:5]:
        summary["scene_count"] += 1
        for check in scene.get("tests", [])[:20]:
            row = {"scene": str(scene.get("id", "unknown"))[:40], "check": str(check.get("id", "unknown"))[:60],
                   "status": str(check.get("status", "not_run"))[:30], "reason": str(check.get("reason", ""))[:240]}
            if row["status"] == "fail": summary["failed_checks"].append(row)
            elif row["status"] not in {"pass", "not_applicable"}: summary["open_checks"].append(row)
    records = evidence.get("events", {}).get("records", [])
    replays = [r.get("data", r.get("payload", {})) for r in records[-500:]
               if r.get("type") == "observation_replay_completed"]
    if replays:
        replay = replays[-1]
        summary["replay"] = {k: replay[k] for k in ("summary", "metrics", "independent_test", "reason") if k in replay}
    return summary


def narrate_local(evidence):
    s = summarize(evidence)
    lines = ["Rapport local calculé depuis les mesures. Aucun modèle génératif appelé.",
             "Mode : %s · niveau %s." % (s["mode"], s["level"])]
    if s["completed_shots"] is not None:
        lines.append("Tirs terminés : %d; verdicts corrects : %s." % (s["completed_shots"],
                     str(int(s["correct_verdicts"])) if s["correct_verdicts"] is not None else "non mesurés"))
    if s["ghost_error_mean_cm"] is not None:
        lines.append("Erreur moyenne du fantôme : %.2f cm." % s["ghost_error_mean_cm"])
    else:
        lines.append("Erreur du fantôme : aucune mesure disponible.")
    for row in s["failed_checks"]:
        lines.append("Échec %s / %s : %s" % (row["scene"], row["check"], row["reason"] or "voir journal"))
    lines.append("Contrôles en attente ou bloqués : %d; échecs mesurés : %d." % (len(s["open_checks"]), len(s["failed_checks"])))
    if s["mode"] != "real":
        lines.append("Ces résultats portent sur la simulation et ne constituent pas une validation physique réelle.")
    return {"provider": "local-deterministic", "model": None, "content": "\n".join(lines),
            "summary": s, "receipt": None, "api_cost_usd": 0, "generated_by_model": False}
