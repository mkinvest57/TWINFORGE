"""Test-only D1 adapter using SQLite itself; no mock quota decisions."""
import json
import sqlite3
import sys

db = sqlite3.connect(sys.argv[1], timeout=10, isolation_level=None)
db.row_factory = sqlite3.Row
db.execute("PRAGMA busy_timeout=10000")
for line in sys.stdin:
    try:
        request = json.loads(line)
        if request.get("script"):
            db.executescript(request["script"])
            result = None
        else:
            cursor = db.execute(request["sql"], request.get("params", []))
            rows = [dict(row) for row in cursor.fetchall()]
            result = rows[0] if request.get("kind") == "first" and rows else None if request.get("kind") == "first" else {"results": rows, "success": True}
        print(json.dumps({"id": request["id"], "result": result}), flush=True)
    except Exception as error:
        print(json.dumps({"id": request.get("id"), "error": str(error)}), flush=True)
