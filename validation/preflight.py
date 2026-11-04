#!/usr/bin/env python3
"""Check evidence contracts without mistaking file presence for validation.

No network access, API calls, publishing, or changes to historical evidence.
Exit 0 means the package is ready for review, not that its scientific claims
are independently proven. Exit 1 reports incomplete or inconsistent evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCENES = ("hoop", "multi", "chaos", "liquid", "orbit")
TESTS = ("launch", "bounce", "hoop_passage", "net", "ghost_ahead", "induction", "control")
STATUSES = {"pass", "fail", "blocked", "not_run", "not_applicable"}
SAFE_SUFFIXES = {".py", ".mjs", ".js", ".html", ".css", ".md", ".json", ".txt", ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webm", ".srt", ".vtt", ".yaml", ".yml"}
SECRET_RULES = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "provider_token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})\b"),
}
HISTORICAL_DIGESTS = {
    "docs/GATE_2026-10-29.md": "d79cb44051bde38a88759744c8e10118882e98647d40c0c939b373c2daa8dc25",
    "docs/gate_series_2026-10-29.json": "cbc4e4027193e66314c2ca50a5a5770a546063b2123afbe2e6f5771b39aadefe",
}
PITCH = "Lance une balle vers un cerceau vertical. Obtiens son simulateur. Prédis si ça rentre — avant que la balle retombe."


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def relative_file(root, value):
    """Reject traversal, symlinks escaping the project, and private file names."""
    if not isinstance(value, str) or not value:
        raise ValueError("an evidence path is required")
    rel = Path(value)
    if rel.is_absolute() or ".." in rel.parts or any(p in rel.parts for p in (".git", ".twinforge")):
        raise ValueError("evidence paths must stay inside the project")
    if any(part.startswith(".env") and part != ".env.example" for part in rel.parts):
        raise ValueError("private environment files cannot be evidence")
    path = (root / rel).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("evidence file is missing or outside the project")
    return path


def check_evidence(root, evidence, prefix, issues):
    if not isinstance(evidence, list) or not evidence:
        issues.append(f"{prefix}: no recorded evidence")
        return
    for item in evidence:
        if not isinstance(item, dict):
            issues.append(f"{prefix}: evidence must include path and sha256")
            continue
        try:
            path = relative_file(root, item.get("path"))
            if not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
                issues.append(f"{prefix}: missing SHA-256 for {item.get('path')}")
            elif digest(path) != item["sha256"]:
                issues.append(f"{prefix}: evidence changed: {item['path']}")
        except (ValueError, OSError) as exc:
            issues.append(f"{prefix}: {exc}")


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def check_gauntlet(report, root):
    issues = []
    if report.get("version") != 1:
        issues.append("gauntlet: version must be 1")
    run = report.get("run", {})
    for key in ("id", "recorded_at", "mode", "source_commit", "source_sha256"):
        if not run.get(key):
            issues.append(f"gauntlet: run.{key} missing")
    if run.get("mode") not in {"simulation", "real"}:
        issues.append("gauntlet: mode must explicitly be simulation or real")
    if not re.fullmatch(r"[0-9a-f]{64}", str(run.get("source_sha256", ""))):
        issues.append("gauntlet: source_sha256 must identify the executed source")
    scenes = report.get("scenes", [])
    if not isinstance(scenes, list):
        return issues + ["gauntlet: scenes must be an array"]
    if [s.get("id") for s in scenes] != list(SCENES):
        issues.append("gauntlet: all five scenes are required in hoop/multi/chaos/liquid/orbit order")
    for scene in scenes:
        sid = scene.get("id", "unknown")
        tests = scene.get("tests", [])
        if not isinstance(tests, list) or [t.get("id") for t in tests] != list(TESTS):
            issues.append(f"gauntlet/{sid}: seven tests are required in the documented order")
            continue
        all_pass = True
        for test in tests:
            prefix = f"gauntlet/{sid}/{test['id']}"
            status = test.get("status")
            if status not in STATUSES:
                issues.append(f"{prefix}: invalid status")
                all_pass = False
            elif status == "pass":
                check_evidence(root, test.get("evidence"), prefix, issues)
                if not test.get("executed_at") or not test.get("method"):
                    issues.append(f"{prefix}: execution time and method required")
                if not test.get("measurements"):
                    issues.append(f"{prefix}: pass requires measured values")
            elif status == "not_applicable":
                allowed = sid != "hoop" and test["id"] in {"hoop_passage", "net", "control"}
                if not allowed or not test.get("reason"):
                    issues.append(f"{prefix}: N/A requires an absent feature and explicit reason")
                    all_pass = False
            else:
                issues.append(f"{prefix}: {status} — {test.get('reason', 'no reason recorded')}")
                all_pass = False
        if scene.get("validated") is True and not all_pass:
            issues.append(f"gauntlet/{sid}: invalid validated=true with incomplete tests")
        metrics = scene.get("metrics", {})
        for key in ("ghost_error_mean_cm", "verdicts_correct", "verdicts_total", "collisions"):
            if not finite_number(metrics.get(key)) or metrics[key] < 0:
                issues.append(f"gauntlet/{sid}: measured {key} missing")
        if finite_number(metrics.get("collisions")) and metrics["collisions"] != 0:
            issues.append(f"gauntlet/{sid}: collision count is nonzero")
        if finite_number(metrics.get("verdicts_total")) and metrics["verdicts_total"] <= 0:
            issues.append(f"gauntlet/{sid}: at least one completed verdict is required")
        if all(finite_number(metrics.get(k)) for k in ("verdicts_correct", "verdicts_total")) and metrics["verdicts_correct"] > metrics["verdicts_total"]:
            issues.append(f"gauntlet/{sid}: correct verdicts exceed total")
    return issues


def check_ablations(report, root):
    issues = []
    pairs = report.get("comparisons", [])
    expected = {"sam_vs_naive_tracking", "calibrated_vs_prefit_physics"}
    if {p.get("id") for p in pairs} != expected:
        issues.append("ablations: both prescribed quantitative comparisons are required")
    for pair in pairs:
        prefix = "ablations/" + pair.get("id", "unknown")
        if pair.get("status") != "measured":
            issues.append(f"{prefix}: not measured")
            continue
        if not pair.get("dataset_ids") or not pair.get("metric") or not pair.get("unit"):
            issues.append(f"{prefix}: common dataset, metric and unit required")
        variants = pair.get("variants", [])
        if len(variants) != 2 or any(not finite_number(v.get("value")) for v in variants):
            issues.append(f"{prefix}: two measured variants required")
        if pair.get("evaluation_split") != "independent_test_shots":
            issues.append(f"{prefix}: use held-out shots, not fit windows or different prompt wording")
        check_evidence(root, pair.get("evidence"), prefix, issues)
    return issues


def check_submission(manifest, root):
    issues = []
    for name in ("final_video", "ghost_gif"):
        asset = manifest.get("assets", {}).get(name, {})
        prefix = "submission/" + name
        if asset.get("status") != "reviewed":
            issues.append(f"{prefix}: not produced and reviewed")
        check_evidence(root, asset.get("evidence"), prefix, issues)
        review = asset.get("review", {})
        if not review.get("reviewed_at") or not review.get("reviewer"):
            issues.append(f"{prefix}: explicit visual review missing")
        if name == "final_video":
            duration = asset.get("duration_seconds")
            if not finite_number(duration) or not 140 <= duration <= 160:
                if not manifest.get("rules", {}).get("duration_exception_evidence"):
                    issues.append(f"{prefix}: expected about 150 seconds, or documented official-rule exception")
            for key in ("continuous_subtitles", "simulation_labels_visible", "numbers_traceable", "no_mockup"):
                if review.get(key) is not True:
                    issues.append(f"{prefix}: {key} not reviewed")
    for key in ("public_repo", "live_demo", "official_rules", "track_and_theme", "licenses"):
        item = manifest.get("checks", {}).get(key, {})
        if item.get("status") != "verified" or not item.get("verified_at"):
            issues.append(f"submission/{key}: not verified")
        else:
            check_evidence(root, item.get("evidence"), "submission/" + key, issues)
    real = manifest.get("real_world_evidence", {})
    if real.get("complete_shot_validated") is not True:
        issues.append("submission/real_world: no independent complete filmed shot has passed end-to-end")
    else:
        check_evidence(root, real.get("evidence"), "submission/real_world", issues)
    if manifest.get("level") != "L3":
        issues.append("submission/level: this recovery package must declare L3; historic L1 is not established")
    return issues


def source_files(root):
    result = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=root, capture_output=True, check=True)
    seen = set()
    included = set()
    for value in result.stdout.decode().split("\0"):
        if not value or value in seen:
            continue
        seen.add(value)
        rel = Path(value)
        if rel.parts[0] in {"output", "tmp", "node_modules", ".venv", ".twinforge"}:
            continue
        if rel.name not in {".gitignore", ".env.example"} and (rel.suffix.lower() not in SAFE_SUFFIXES or rel.name.startswith(".")):
            continue
        try:
            path = relative_file(root, value)
        except ValueError:
            continue
        included.add(value)
        yield value, path
    # Final media can live under output/. Include explicitly referenced evidence,
    # while still excluding archives and unrelated temporary/generated output.
    def references(value):
        if isinstance(value, dict):
            for item in value.get("evidence", []) if isinstance(value.get("evidence", []), list) else []:
                if isinstance(item, dict) and isinstance(item.get("path"), str):
                    yield item["path"]
            for child in value.values():
                yield from references(child)
        elif isinstance(value, list):
            for child in value:
                yield from references(child)
    for name in ("submission.json", "gauntlet-report.json", "ablations.json"):
        try:
            data = read_json(root / "validation" / name)
        except (OSError, ValueError):
            continue
        for value in references(data):
            if value in included or Path(value).suffix.lower() not in SAFE_SUFFIXES:
                continue
            try:
                path = relative_file(root, value)
            except (ValueError, OSError):
                continue
            included.add(value)
            yield value, path


def scan_secrets(files):
    findings = []
    for rel, path in files:
        if path.suffix.lower() in {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".mp4", ".webm"}:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        for line_no, line in enumerate(content.splitlines(), 1):
            for rule, pattern in SECRET_RULES.items():
                if pattern.search(line):
                    findings.append({"path": rel, "line": line_no, "rule": rule})
    return findings


def provenance(root):
    files = list(source_files(root))
    secrets = scan_secrets(files)
    if secrets:
        raise ValueError("Potential credentials found (values withheld): " + json.dumps(secrets))
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=root, capture_output=True, text=True, check=True).stdout)
    return {"version": 1, "created_at": now(), "commit": head, "working_tree_dirty": dirty,
            "scope": "allowlisted source and evidence files; never .env, .git, dependencies or output archives",
            "files": [{"path": rel, "sha256": digest(path), "bytes": path.stat().st_size} for rel, path in sorted(files)]}


def run(root):
    issues = []
    try:
        if (root / "README.md").read_text().splitlines()[0] != PITCH:
            issues.append("README: first line differs from the exact required pitch")
    except (OSError, IndexError):
        issues.append("README: missing required first-line pitch")
    for relative, expected in HISTORICAL_DIGESTS.items():
        path = root / relative
        if not path.is_file() or digest(path) != expected:
            issues.append(f"history: {relative} differs from the preserved pre-correction archive")
    checks = (("validation/gauntlet-report.json", check_gauntlet),
              ("validation/ablations.json", check_ablations),
              ("validation/submission.json", check_submission))
    for relative, validator in checks:
        try:
            issues.extend(validator(read_json(root / relative), root))
        except (OSError, ValueError, TypeError, KeyError) as exc:
            issues.append(f"{relative}: cannot validate: {exc}")
    try:
        matrix = read_json(root / "validation/requirements.json")
        rows = matrix.get("requirements", [])
        if {row.get("prompt") for row in rows} != set(range(9)):
            issues.append("requirements: all nine prompts must be represented")
        ids = [row.get("id") for row in rows]
        if len(ids) != len(set(ids)):
            issues.append("requirements: duplicate IDs")
        for row in rows:
            if row.get("status") != "met":
                issues.append(f"{row.get('id')}: {row.get('status')} — {row.get('blocker') or row.get('requirement')}")
            elif not row.get("verification") or not row.get("evidence"):
                issues.append(f"{row.get('id')}: met requires verification and evidence")
            else:
                for path in row["evidence"]:
                    try:
                        relative_file(root, path)
                    except (ValueError, OSError) as exc:
                        issues.append(f"{row.get('id')}: {exc}")
    except (OSError, ValueError, TypeError) as exc:
        issues.append(f"requirements: cannot validate: {exc}")
    findings = scan_secrets(list(source_files(root)))
    for item in findings:
        issues.append(f"source/{item['path']}:{item['line']}: potential {item['rule']} (value withheld)")
    return {"version": 1, "checked_at": now(), "ready_for_review": not issues,
            "scientifically_validated": False,
            "meaning": "Passing checks establishes a reviewable evidence package, never independent scientific validation.",
            "issues": issues}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--profile", choices=("strict-pdf", "simulation-only"), default="strict-pdf", help="strict PDF remains the default; simulation-only is a separately bounded software scope")
    parser.add_argument("--json", type=Path, help="save preflight result")
    parser.add_argument("--provenance", type=Path, help="write a fresh SHA-256 manifest after validation")
    parser.add_argument("--package", type=Path, help="create a review ZIP; incomplete packages are labelled as such")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.profile == "simulation-only":
        try:
            from .simulation_profile import run as run_simulation
        except ImportError:
            from simulation_profile import run as run_simulation
        result = run_simulation(root)
    else:
        result = run(root)
        result["profile"] = "strict-pdf"
    prov = provenance(root) if args.provenance or args.package else None
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    if args.provenance:
        args.provenance.parent.mkdir(parents=True, exist_ok=True)
        args.provenance.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n")
    if args.package:
        args.package.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(args.package, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in prov["files"]:
                content = (root / item["path"]).read_bytes()
                if hashlib.sha256(content).hexdigest() != item["sha256"]:
                    raise ValueError(f"Source changed during packaging: {item['path']}; rerun after changes settle")
                archive.writestr(item["path"], content)
            archive.writestr("PACKAGE_PROVENANCE.json", json.dumps(prov, indent=2))
            archive.writestr("PACKAGE_PREFLIGHT.json", json.dumps(result, indent=2, ensure_ascii=False))
            archive.writestr("PACKAGE_STATUS.txt", "REVIEW PACKAGE — INCOMPLETE\n" if result["issues"] else "REVIEWABLE PACKAGE — NOT A SCIENTIFIC CERTIFICATION\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["ready_for_review"] else 1


if __name__ == "__main__":
    sys.exit(main())
