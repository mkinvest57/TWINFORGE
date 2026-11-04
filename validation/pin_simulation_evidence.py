#!/usr/bin/env python3
"""Pin existing report bytes, without changing their status or claiming validity."""
import hashlib
import json
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    target = root / 'validation/simulation-manifest.json'
    manifest = json.loads(target.read_text())
    for item in manifest['evidence'].values():
        path = root / item['path']
        item['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    target.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    print('Existing evidence hashes pinned; run preflight --profile simulation-only for validation.')


if __name__ == '__main__':
    main()
