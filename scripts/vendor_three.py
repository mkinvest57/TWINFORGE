#!/usr/bin/env python3
"""Vendor the pinned official Three.js modules required for offline rendering."""
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import tarfile
import urllib.request

VERSION = '0.186.1'
URL = 'https://registry.npmjs.org/three/-/three-' + VERSION + '.tgz'
INTEGRITY = 'blFeqb49wRCSGUGj7gtpfnSGHy2lwDk94RhUmS1c/hTby70kvChbWpkJ4Pm1390LqzzvTmzgXKHPEafJwCb8jA=='
ROOT = Path(__file__).resolve().parents[1]


def main():
    with urllib.request.urlopen(URL, timeout=60) as response:
        raw = response.read()
    if base64.b64encode(hashlib.sha512(raw).digest()).decode() != INTEGRITY:
        raise RuntimeError('Official npm artifact integrity mismatch')
    target = ROOT / 'assets/vendor/three'
    pending = ['build/three.module.js', 'examples/jsm/controls/OrbitControls.js', 'examples/jsm/environments/RoomEnvironment.js']
    seen = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as archive:
        while pending:
            name = pending.pop()
            if name in seen: continue
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                raise RuntimeError('Unsafe dependency path')
            content = archive.extractfile('package/' + name).read()
            path = target / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
            seen[name] = hashlib.sha256(content).hexdigest()
            for dependency in re.findall(r"(?:from\s*|import\s*)['\"]([^'\"]+)['\"]", content.decode()):
                if dependency.startswith('.'):
                    pending.append(posixpath.normpath(posixpath.join(posixpath.dirname(name), dependency)))
                elif dependency == 'three':
                    pending.append('build/three.module.js')
        license_text = archive.extractfile('package/LICENSE').read()
        (target / 'LICENSE.txt').write_bytes(license_text)
        seen['LICENSE.txt'] = hashlib.sha256(license_text).hexdigest()
    manifest = {'name': 'three', 'version': VERSION, 'registry_tarball': URL,
                'npm_integrity': 'sha512-' + INTEGRITY, 'files_sha256': dict(sorted(seen.items())),
                'purpose': 'Unmodified upstream runtime modules, bundled for network-independent simulation rendering.'}
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'version': VERSION, 'files': len(seen), 'bytes': sum((target / p).stat().st_size for p in seen)}))


if __name__ == '__main__': main()
