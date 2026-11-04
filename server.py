#!/usr/bin/env python3
"""Loopback workbench: video perception, calibrated bundles, bounded Meta APIs.
Run .venv/bin/python server.py. Private uploads and secrets are not static files.
"""
import base64
import concurrent.futures
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from twinforge_runtime.budget import BudgetExceeded, utc_now
from twinforge_runtime.providers import ModelClient, ProviderUnavailable, load_env, message_content, TOKEN_RATES
from twinforge_runtime.scientist import calibrate
from twinforge_runtime.narration import narrate_local
from twinforge_runtime.synthetic_capture import build_capture
from twinforge_runtime.process_lab import run_job as run_process_job, validate_options as validate_process_options, specification as process_specification
from twinforge_runtime.causal_lab import run_job as run_causal_job, validate_options as validate_causal_options

ROOT = Path(__file__).resolve().parent
load_env()
DATA = Path(os.environ.get('TWINFORGE_DATA_DIR', ROOT / '.twinforge')).resolve()
MAX_JSON, MAX_VIDEO = 16 * 1024 * 1024, 64 * 1024 * 1024


def static_file(url):
    path = urllib.parse.unquote(urllib.parse.urlsplit(url).path).lstrip('/') or 'index.html'
    parts = Path(path).parts
    if any(p.startswith('.') for p in parts) or '..' in parts:
        return None
    candidate = (ROOT / path).resolve()
    if not candidate.is_relative_to(ROOT) or not candidate.is_file():
        return None
    if path in {'index.html', 'workbench.html', 'scan.html', 'manifest.webmanifest'} or (parts[0] in {'web', 'assets', 'artifacts'} and candidate.suffix.lower() in {
        '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.woff2', '.mp4', '.webm'}):
        return candidate
    return None


class Jobs:
    def __init__(self):
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        self.records = {}

    def start(self, fn):
        job_id = uuid.uuid4().hex
        folder = DATA / 'jobs' / job_id
        folder.mkdir(parents=True, exist_ok=True)
        self.records[job_id] = {'id': job_id, 'status': 'queued', 'created_at': utc_now()}
        def persist():
            temporary = folder / 'status.tmp'
            temporary.write_text(json.dumps(self.records[job_id], ensure_ascii=False, indent=2))
            temporary.replace(folder / 'status.json')
        persist()
        def work():
            self.records[job_id]['status'] = 'running'
            persist()
            try:
                result = fn(folder)
                (folder / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
                self.records[job_id].update(status='complete', result=result)
            except Exception as error:
                self.records[job_id].update(status='failed', error=str(error)[:600])
            self.records[job_id]['completed_at'] = utc_now()
            persist()
        self.pool.submit(work)
        return {'id': job_id, 'status': 'queued'}

    def get(self, job_id):
        if job_id in self.records:
            return self.records[job_id]
        if not re.fullmatch(r'[0-9a-f]{32}', job_id):
            return None
        path = DATA / 'jobs' / job_id / 'status.json'
        if not path.is_file():
            return None
        value = json.loads(path.read_text())
        if value.get('status') in {'queued', 'running'}:
            value.update(status='interrupted', error='Server restarted before completion; saved outputs remain on disk. No paid call was restarted.')
        return value


JOBS = Jobs()


def run_simulation_job(body, folder):
    """Reproducible offline trials, never a hardware-control or provider claim."""
    node = shutil.which('node')
    if not node:
        raise ValueError('Node.js is required for the offline simulation benchmark')
    seed = body.get('seed', 20261104)
    if not isinstance(seed, int) or isinstance(seed, bool) or not 0 <= seed <= 0xffffffff:
        raise ValueError('Seed must be an integer between 0 and 4294967295')
    output = folder / 'simulation-report.json'
    run = subprocess.run([node, str(ROOT / 'validation/simulation_benchmark.mjs'), '--out', str(output), '--seed', str(seed)],
                         cwd=ROOT, capture_output=True, text=True, timeout=900)
    (folder / 'benchmark.log').write_text(run.stdout + '\n' + run.stderr)
    if run.returncode not in {0, 1} or not output.is_file():
        raise ValueError('Simulation benchmark could not complete; inspect local benchmark.log')
    report = json.loads(output.read_text())
    return {'report': report, 'mode': 'simulation', 'provider_calls': 0, 'exit_code': run.returncode}


def run_video_job(body, folder):
    upload_id = str(body.get('upload_id', ''))
    if not re.fullmatch(r'[0-9a-f]{32}', upload_id):
        raise ValueError('Invalid upload ID')
    metadata_path = DATA / 'uploads' / (upload_id + '.json')
    if not metadata_path.exists():
        raise ValueError('Upload not found')
    metadata = json.loads(metadata_path.read_text())
    video = DATA / 'uploads' / metadata['stored_name']
    fps = float(body.get('sample_fps', 8))
    if not 5 <= fps <= 10:
        raise ValueError('Use 5 to 10 sampled frames per second')
    python = str(ROOT / '.venv/bin/python') if (ROOT / '.venv/bin/python').exists() else sys.executable
    command = [python, str(ROOT / 'perception/cached_perception.py'), '--cache-dir', str(DATA / 'sam-cache'), '--video', str(video), '--out', str(folder / 'perception'),
               '--sample-fps', str(fps), '--max-seconds', '8']
    source_kind = body.get('source_kind', 'unknown')
    if source_kind not in {'real', 'synthetic', 'unknown'}:
        raise ValueError('Source kind must be real, synthetic or unknown')
    command += ['--source-kind', source_kind]
    if body.get('shot_id'):
        shot_id = str(body['shot_id'])
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', shot_id):
            raise ValueError('Shot ID must contain 1–64 letters, digits, underscores or hyphens')
        command += ['--shot-id', shot_id]
    if body.get('secondary_dataset') is not None:
        secondary_path = folder / 'secondary-dataset.json'
        secondary_path.write_text(json.dumps(body['secondary_dataset']))
        command += ['--secondary-dataset', str(secondary_path)]
    calibration = body.get('calibration')
    if calibration is not None:
        calibration_path = folder / 'calibration.json'
        calibration_path.write_text(json.dumps(calibration))
        command += ['--fiducials', str(calibration_path)]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=900)
    (folder / 'pipeline.log').write_text(completed.stdout + '\n' + completed.stderr)
    if completed.returncode:
        raise ValueError('Perception failed (exit %d); inspect local %s' % (completed.returncode, folder / 'pipeline.log'))
    dataset = json.loads((folder / 'perception/trajectories.json').read_text())
    return {'dataset': dataset, 'original_filename': metadata['original_name'],
            'next': 'Add separate validation/test shots before reporting independent prediction accuracy.'}


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def _body(self, maximum=MAX_JSON):
        length = int(self.headers.get('Content-Length', '0'))
        if length < 1 or length > maximum:
            raise ValueError('Request body is empty or exceeds the size limit')
        return self.rfile.read(length)

    def _read_json(self, maximum=MAX_JSON):
        value = json.loads(self._body(maximum))
        if not isinstance(value, dict):
            raise ValueError('Expected a JSON object')
        return value

    def _local_request(self):
        host = self.headers.get('Host', '')
        parsed = urllib.parse.urlsplit('http://' + host)
        if parsed.hostname not in {'localhost', '127.0.0.1', '::1'}:
            return False
        origin = self.headers.get('Origin')
        return not origin or origin in {'http://' + host, 'https://' + host}

    def do_GET(self):
        if not self._local_request():
            return self._json(403, {'error': 'Local same-origin access only'})
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/status':
            return self._json(200, {'meta': bool(os.environ.get('META_MODEL_API_KEY')),
                'baseten': bool(os.environ.get('BASETEN_API_KEY')), 'baseten_model': 'not used by calibrated L3 runner',
                'glimmer': bool(os.environ.get('GLIMMER_BASE_URL') or os.environ.get('TOGETHER_API_KEY')),
                'local_narration': True, 'offline_benchmark': True, 'level': 'L3', 'budget': ModelClient().ledger.summary(),
                'physical_control': 'not connected', 'mode': 'known-engine calibration; simulation separately labelled'})
        match = re.fullmatch(r'/api/jobs/([0-9a-f]{32})', path)
        if match:
            value = JOBS.get(match[1])
            return self._json(200 if value else 404, value or {'error': 'Unknown job'})
        if path == '/api/credits':
            return self._json(200, ModelClient().ledger.summary())
        if path == '/api/process/spec':
            return self._json(200, process_specification())
        progress_match = re.fullmatch(r'/api/process/([0-9a-f]{32})/progress', path)
        if progress_match:
            progress_path = DATA / 'jobs' / progress_match[1] / 'process-progress.json'
            return self._json(200, json.loads(progress_path.read_text())) if progress_path.is_file() else self._json(404, {'error': 'No process progress available'})
        candidate = static_file(self.path)
        if candidate is None:
            return self._json(404, {'error': 'Not found'})
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(str(candidate))[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if not self._local_request():
            return self._json(403, {'error': 'Local same-origin access only'})
        try:
            path = urllib.parse.urlsplit(self.path).path
            if path == '/api/capture':
                kind = self.headers.get('Content-Type', '').split(';')[0]
                extension = {'video/webm': '.webm', 'image/png': '.png'}.get(kind)
                if extension is None:
                    raise ValueError('Only demo WebM and PNG captures are accepted')
                data = self._body(128 * 1024 * 1024)
                folder = ROOT / 'artifacts'
                folder.mkdir(exist_ok=True)
                name = 'simulation-' + uuid.uuid4().hex[:12] + extension
                (folder / name).write_bytes(data)
                return self._json(201, {'path': str(folder / name), 'url': '/artifacts/' + name, 'bytes': len(data)})
            if path == '/api/upload':
                original = Path(urllib.parse.unquote(self.headers.get('X-Filename', 'video.mp4'))).name
                ext = Path(original).suffix.lower()
                if ext not in {'.mp4', '.mov', '.webm', '.avi'}:
                    raise ValueError('Upload a video file (MP4, MOV, WebM or AVI)')
                data = self._body(MAX_VIDEO)
                upload_id = uuid.uuid4().hex
                folder = DATA / 'uploads'
                folder.mkdir(parents=True, exist_ok=True)
                stored = upload_id + ext
                (folder / stored).write_bytes(data)
                (folder / (upload_id + '.json')).write_text(json.dumps({'stored_name': stored, 'original_name': original}))
                return self._json(201, {'upload_id': upload_id, 'bytes': len(data), 'filename': original})
            # Large legacy journals can be recovered; ordinary inputs stay bounded.
            body = self._read_json(128 * 1024 * 1024 if path == '/api/evidence' else (4096 if path in {'/api/jobs/process', '/api/jobs/causal'} else MAX_JSON))
            if path == '/api/jobs/causal':
                options = validate_causal_options(body)
                return self._json(202, JOBS.start(lambda folder: run_causal_job(options, folder)))
            if path == '/api/jobs/process':
                options = validate_process_options(body)
                return self._json(202, JOBS.start(lambda folder: run_process_job(options, folder)))
            if path == '/api/synthetic/build':
                return self._json(201, build_capture(body, ROOT, DATA))
            if path == '/api/jobs/video':
                return self._json(202, JOBS.start(lambda folder: run_video_job(body, folder)))
            if path == '/api/jobs/simulation':
                return self._json(202, JOBS.start(lambda folder: run_simulation_job(body, folder)))
            if path == '/api/jobs/calibrate':
                def work(folder):
                    bundle = calibrate(body.get('train', []), body.get('validation', []), body.get('test', []),
                                       use_models=body.get('use_models', True) is True,
                                       threshold_cm=float(body.get('threshold_cm', 5)))
                    (folder / 'bundle.json').write_text(json.dumps(bundle, indent=2, ensure_ascii=False))
                    return {'bundle': bundle}
                return self._json(202, JOBS.start(work))
            if path in {'/api/advisor', '/api/meta/chat'}:
                model = body.get('model', 'muse-spark-1.3')
                if model not in TOKEN_RATES:
                    raise ValueError('Only standard Spark 1.3 and Wonder 1.0 are enabled')
                messages = body.get('messages') if path.endswith('/chat') else [
                    {'role': 'system', 'content': 'TWINFORGE L3 scientific advisor. Diagnose only supplied measurements. This is known-engine calibration, not free induction. Distinguish simulation from real observations. Never invent evidence.'},
                    {'role': 'user', 'content': str(body.get('context', 'No measured shot supplied'))[:12000]}]
                if not isinstance(messages, list) or not messages:
                    raise ValueError('Messages are required')
                response = ModelClient().chat(messages, model=model)
                return self._json(200, {'provider': 'meta-model-api', 'model': model,
                                        'content': message_content(response), 'usage': response.get('usage'),
                                        'receipt': response['twinforge_receipt']})
            if path == '/api/narrate':
                mode = body.get('mode', 'local')
                if mode == 'local':
                    return self._json(200, narrate_local(body.get('evidence', {})))
                if mode != 'glimmer':
                    raise ValueError('Narration mode must be local or glimmer')
                response = ModelClient().narrate(body.get('evidence', {}))
                return self._json(200, {'provider': 'glimmer-endpoint', 'generated_by_model': True,
                                        'model': response.get('model'), 'content': message_content(response),
                                        'receipt': response['twinforge_receipt']})
            if path == '/api/jobs/image':
                def generate(folder):
                    prompt = 'Illustration of a TWINFORGE counterfactual, not a measurement or live physics proof. ' + str(body.get('prompt', ''))[:4000]
                    response = ModelClient().image(prompt)
                    data = (response.get('data') or [{}])[0].get('b64_json')
                    if not data:
                        raise ValueError('Muse Image returned no image')
                    (folder / 'illustration.png').write_bytes(base64.b64decode(data, validate=True))
                    return {'image_data_url': 'data:image/png;base64,' + data,
                            'label': 'Muse Image illustration — not a simulation or measurement', 'receipt': response['twinforge_receipt']}
                return self._json(202, JOBS.start(generate))
            if path == '/api/evidence':
                evidence = body.get('evidence')
                if not isinstance(evidence, dict):
                    raise ValueError('Evidence object required')
                folder = DATA / 'evidence'
                folder.mkdir(parents=True, exist_ok=True)
                name = uuid.uuid4().hex + '.json'
                (folder / name).write_text(json.dumps({'received_at': utc_now(), 'evidence': evidence}, ensure_ascii=False, indent=2))
                return self._json(201, {'saved': True, 'id': name, 'path': str(folder / name)})
            return self._json(404, {'error': 'Not found'})
        except BudgetExceeded as error:
            return self._json(429, {'error': str(error)})
        except ProviderUnavailable as error:
            return self._json(503, {'error': str(error)})
        except (ValueError, TypeError, KeyError) as error:
            return self._json(400, {'error': str(error)[:600]})
        except Exception as error:
            return self._json(500, {'error': 'Local execution failed: ' + type(error).__name__})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    print('TWINFORGE workbench http://127.0.0.1:%d — L3 known-engine calibration' % port, flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
