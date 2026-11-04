"""Persist calibrated synthetic pixels; keep evaluation truth private and separate."""
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess


def build_capture(body, root, data):
    from PIL import Image
    import imageio_ffmpeg
    from perception.calibration import prepare
    if body.get('schema_version') != 'twinforge.synthetic-capture.v1':
        raise ValueError('Unsupported synthetic capture schema')
    capture_id = body.get('capture_id', '')
    if not isinstance(capture_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', capture_id):
        raise ValueError('Invalid synthetic capture ID')
    fps, width, height = body.get('fps'), body.get('width'), body.get('height')
    if (fps, width, height) != (12, 640, 480):
        raise ValueError('Expected the declared 640×480, 12 FPS fixture')
    frames = body.get('frames')
    if not isinstance(frames, list) or len(frames) != 36:
        raise ValueError('Expected 36 fixed-time frames')
    calibration = prepare(body.get('calibration'))
    if calibration['mode'] != 'sphere_size':
        raise ValueError('Synthetic fixture requires sphere-size calibration')
    decoded = []
    for index, frame in enumerate(frames):
        t = frame.get('t')
        if frame.get('frame_index') != index or not isinstance(t, (float, int)) or not math.isfinite(t) or abs(t-index/fps) > 1e-9:
            raise ValueError('Synthetic frames must have sequential physical timestamps')
        value = frame.get('png', '')
        if not isinstance(value, str) or not value.startswith('data:image/png;base64,'):
            raise ValueError('Expected PNG frames')
        raw = base64.b64decode(value.split(',', 1)[1], validate=True)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != 'PNG' or image.size != (width, height):
                raise ValueError('PNG dimensions disagree with capture')
            image.verify()
        decoded.append(raw)
    folder = Path(data) / 'synthetic' / capture_id
    folder.mkdir(parents=True, exist_ok=False)
    (folder / 'frames').mkdir()
    for i, raw in enumerate(decoded):
        (folder / 'frames' / ('%04d.png' % i)).write_bytes(raw)
    # This file is never passed to SAM, induction, or served by the HTTP allowlist.
    (folder / 'evaluation-truth.json').write_text(json.dumps(body.get('evaluation_truth', {}), indent=2))
    (folder / 'calibration.json').write_text(json.dumps(calibration, indent=2))
    target = Path(root) / 'artifacts' / ('synthetic-' + capture_id + '.mp4')
    target.parent.mkdir(exist_ok=True)
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-nostdin',
                    '-framerate', str(fps), '-i', str(folder / 'frames/%04d.png'), '-c:v', 'libx264',
                    '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)],
                   check=True, capture_output=True, timeout=60)
    result = {'capture_id': capture_id, 'source_kind': 'synthetic', 'fps': fps, 'frames': len(frames),
              'video': {'path': str(target), 'url': '/artifacts/' + target.name,
                        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()},
              'calibration': calibration, 'evaluation_truth': 'stored separately; excluded from observation pipeline'}
    (folder / 'capture.json').write_text(json.dumps(result, indent=2))
    return result
