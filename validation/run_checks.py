#!/usr/bin/env python3
"""Run and record Python/JS software checks; never claim empirical validation."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def now():
    return datetime.now(timezone.utc).isoformat()


def sources(root):
    paths = [root / name for name in ("server.py", "index.html", "workbench.html", "scan.html", "manifest.webmanifest")]
    paths.extend((root / "assets/mobile").glob("*.svg"))
    for directory in ("twinforge_runtime", "perception", "induction", "web", "tests", "validation", "scripts"):
        base = root / directory
        if base.exists():
            paths.extend(p for p in base.rglob("*") if p.suffix in {".py", ".js", ".mjs", ".css"} and not any(part in {"node_modules", "__pycache__", ".venv"} for part in p.parts))
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(paths)) if p.is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--node", default=shutil.which("node"))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    before = sources(root)
    commands = [[sys.executable, "-B", "-m", "unittest", "discover", "-s", "tests", "-v"]]
    js = sorted(str(p.relative_to(root)) for p in (root / "tests/js").glob("*.test.mjs"))
    if args.node and js:
        commands.append([args.node, "--test", *js])
    record = {"version": 1, "started_at": now(), "scope": "Automated software checks only; provider calls may be mocked. This is not a real-video or physical-control validation.",
              "source_sha256": before, "checks": []}
    for command in commands:
        started = now()
        run = subprocess.run(command, cwd=root, capture_output=True, text=True)
        record["checks"].append({"command": command, "started_at": started, "completed_at": now(), "exit_code": run.returncode, "stdout": run.stdout, "stderr": run.stderr})
    after = sources(root)
    record["source_changed_during_checks"] = before != after
    record["completed_at"] = now()
    record["complete_suite"] = bool(args.node and js)
    record["passed"] = record["complete_suite"] and not record["source_changed_during_checks"] and all(c["exit_code"] == 0 for c in record["checks"])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(args.out), "passed": record["passed"], "source_changed_during_checks": record["source_changed_during_checks"], "checks": [{"command": c["command"], "exit_code": c["exit_code"]} for c in record["checks"]]}, indent=2))
    return 0 if record["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
