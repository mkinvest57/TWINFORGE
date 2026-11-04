#!/usr/bin/env python3
"""Persist a browser export and verify its raw-event hashes without grading it."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from validation.preflight import check_gauntlet


def import_bundle(bundle, root, set_current=False):
    report = copy.deepcopy(bundle.get("report"))
    if not isinstance(report, dict):
        raise ValueError("Expected browser export {report, events, files}")
    run_id = report.get("run", {}).get("id", "")
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", run_id):
        raise ValueError("Unsafe or missing run ID")
    files = {}
    for item in bundle.get("files", []):
        name, content = item.get("name"), item.get("content")
        if not isinstance(name, str) or Path(name).name != name or not name.endswith(".json") or not isinstance(content, str):
            raise ValueError("Export files must be named JSON text files without paths")
        if name in files:
            raise ValueError("Duplicate export file name")
        files[name] = content
    destination = Path("validation/runs") / run_id
    resolved = root / destination
    if resolved.exists():
        raise ValueError("Run already archived; never overwrite an existing execution")
    for scene in report.get("scenes", []):
        for test in scene.get("tests", []):
            for item in test.get("evidence", []):
                name = item.get("path")
                content = files.get(name)
                if content is None or hashlib.sha256(content.encode()).hexdigest() != item.get("sha256"):
                    raise ValueError("Raw evidence missing or hash mismatch; nothing imported")
                item["path"] = str(destination / name)
    for name, content in files.items():
        json.loads(content)
    resolved.mkdir(parents=True)
    for name, content in files.items():
        (resolved / name).write_text(content)
    record = resolved / "report.json"
    record.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    if set_current:
        (root / "validation/gauntlet-report.json").write_text(record.read_text())
    issues = check_gauntlet(report, root)
    return {"archived_report": str(record.relative_to(root)), "set_current": set_current, "issues": issues,
            "meaning": "Recorded statuses are preserved. Importing or passing the evidence contract is not scientific certification."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--set-current", action="store_true", help="use this archived run as the current gauntlet report")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    result = import_bundle(json.loads(args.input.read_text()), root, args.set_current)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 1 if result["issues"] else 0


if __name__ == "__main__":
    sys.exit(main())
