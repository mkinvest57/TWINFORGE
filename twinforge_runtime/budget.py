"""Append-only, process-safe cost reservations; no secrets or prompts in the ledger."""
import datetime
import fcntl
import hashlib
import json
import math
import os
import re
import uuid
from pathlib import Path


class BudgetExceeded(RuntimeError):
    pass


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class BudgetLedger:
    def __init__(self, root=None, limit=None):
        self.root = Path(root or os.environ.get("TWINFORGE_DATA_DIR", Path(__file__).resolve().parents[1] / ".twinforge"))
        self.limit = float(limit if limit is not None else os.environ.get("TWINFORGE_SCENE_BUDGET_USD", "0.50"))
        if not math.isfinite(self.limit) or self.limit < 0:
            raise ValueError("Scene budget must be finite and nonnegative")
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "credits.jsonl"

    def _transaction(self, action):
        fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        with os.fdopen(fd, "r+", encoding="utf-8") as file:
            fcntl.flock(file, fcntl.LOCK_EX)
            records = [json.loads(line) for line in file if line.strip()]
            result, event = action(records)
            if event is not None:
                event = {"at": utc_now(), "previous_hash": records[-1]["hash"] if records else None, **event}
                event["hash"] = hashlib.sha256(json.dumps(event, sort_keys=True).encode()).hexdigest()
                file.seek(0, 2)
                file.write(json.dumps(event, sort_keys=True) + "\n")
                file.flush()
                os.fsync(file.fileno())
            return result

    @staticmethod
    def spent(records, scene):
        return sum(r.get("budget_delta_usd", 0) for r in records if r.get("scene") == scene)

    def reserve(self, scene, model, amount, request_hash):
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", scene):
            raise ValueError("Invalid scene ID")
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("Invalid cost reservation")
        reservation = uuid.uuid4().hex
        def action(records):
            spent = self.spent(records, scene)
            if spent + amount > self.limit + 1e-12:
                raise BudgetExceeded("Scene budget exhausted: %.4f + %.4f > %.4f USD" % (spent, amount, self.limit))
            return reservation, {"event": "reserved", "id": reservation, "scene": scene, "model": model,
                                 "request_sha256": request_hash, "budget_delta_usd": amount}
        return self._transaction(action)

    def settle(self, reservation, usage, actual=None, status="completed"):
        def action(records):
            original = next(r for r in records if r.get("id") == reservation and r["event"] == "reserved")
            if any(r.get("id") == reservation and r["event"] == "settled" for r in records):
                raise ValueError("Reservation already settled")
            charge = original["budget_delta_usd"] if actual is None else actual
            if not math.isfinite(charge) or charge < 0:
                raise ValueError("Invalid provider cost")
            return None, {"event": "settled", "id": reservation, "scene": original["scene"],
                          "model": original["model"], "status": status, "usage": usage,
                          "cost_usd": charge, "cost_basis": "reservation_unknown_usage" if actual is None else "published_rates",
                          "budget_delta_usd": charge - original["budget_delta_usd"]}
        self._transaction(action)

    def summary(self):
        def action(records):
            scenes = sorted({r["scene"] for r in records})
            return {"currency": "USD", "limit_per_scene": self.limit,
                    "scenes": {s: round(self.spent(records, s), 6) for s in scenes},
                    "requests": sum(r["event"] == "reserved" for r in records),
                    "last_hash": records[-1]["hash"] if records else None}, None
        return self._transaction(action)
