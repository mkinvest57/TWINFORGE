"""Bounded live SAM 3.1 observations from submitted pixels only.

The detector has no simulator, physics, seed or state input. Every accepted frame
is sent to the actual provider once; errors and missing masks never become local
fallback detections. Private receipts bind the exact JPEG to the response.
"""
import base64
import binascii
import fcntl
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import threading
import time
import uuid

from .budget import BudgetExceeded, BudgetLedger, utc_now
from .providers import ModelClient, ProviderUnavailable, load_env

ROOT = Path(__file__).resolve().parents[1]
MODEL = "sam-3.1"
SCENE = "vision"
IMAGE_PRICE_USD = .0025
MAX_IMAGE_BYTES = 400 * 1024
MAX_BODY_BYTES = 560 * 1024
MAX_RUN_REQUESTS = 60
MAX_OBJECTS = 32
_IN_FLIGHT = threading.BoundedSemaphore(1)
_FIELDS = {"image_base64", "concept", "frame_id", "source_time_s", "run_id", "source_kind"}


class LiveSamBusy(RuntimeError):
    pass


def _decoder_available():
    return bool(shutil.which("node")) and (ROOT / "perception/node_modules/@meta-sam/parser").is_dir()


def _default_client():
    """Optionally allocate a smaller live-SAM share of the existing ledger.

    This changes the reservation ceiling, never the recorded spending or other
    ModelClient instances. The ledger still performs every reservation atomically.
    """
    load_env()
    ledger = BudgetLedger()
    configured = os.environ.get("TWINFORGE_LIVE_SAM_BUDGET_USD", "").strip()
    if configured:
        try:
            live_limit = float(configured)
        except ValueError:
            raise ValueError("Live SAM budget must be finite and nonnegative") from None
        if not math.isfinite(live_limit) or live_limit < 0:
            raise ValueError("Live SAM budget must be finite and nonnegative")
        ledger.limit = min(ledger.limit, live_limit)
    return ModelClient(ledger=ledger)


def status(client=None):
    """Only readiness and public budget metadata; never credentials."""
    load_env()
    client = client or _default_client()
    key_available = bool(os.environ.get("META_MODEL_API_KEY"))
    decoder_available = _decoder_available()
    budget = client.ledger.summary()
    remaining = max(0., budget["limit_per_scene"] - budget["scenes"].get(SCENE, 0.))
    remaining_requests = max(0, math.floor((remaining + 1e-10) / IMAGE_PRICE_USD))
    return {
        "schema_version": "twinforge.sam.status.v1",
        "available": key_available and decoder_available and remaining_requests > 0,
        "key_available": key_available,
        "decoder_available": decoder_available,
        "model": MODEL,
        "provider": "meta-model-api",
        "live_only": True,
        "price_per_image_usd": IMAGE_PRICE_USD,
        "max_requests_per_run": MAX_RUN_REQUESTS,
        "max_image_side": 640,
        "budget_scene": SCENE,
        "budget": budget,
        "remaining_requests": remaining_requests,
        "remaining_usd": round(remaining, 6),
        "scope": "SAM segments pixels; a separate predictor estimates future motion.",
    }


def validate_frame(raw):
    if not isinstance(raw, dict) or set(raw) != _FIELDS:
        raise ValueError("A SAM frame requires only image_base64, concept, frame_id, source_time_s, run_id and source_kind")
    concept = raw["concept"]
    if not isinstance(concept, str) or not 1 <= len(concept.strip()) <= 80 or any(ord(c) < 32 for c in concept) or any(c in concept for c in "<>|,;\n"):
        raise ValueError("Use one short object concept, such as ball or red cup")
    frame_id = raw["frame_id"]
    if not isinstance(frame_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", frame_id):
        raise ValueError("Invalid frame_id")
    run_id = raw["run_id"]
    if not isinstance(run_id, str):
        raise ValueError("Invalid run_id")
    try:
        parsed_id = uuid.UUID(run_id)
    except ValueError:
        raise ValueError("run_id must be a UUID") from None
    if run_id not in {parsed_id.hex, str(parsed_id)}:
        raise ValueError("run_id must use canonical lowercase UUID spelling")
    source_time = raw["source_time_s"]
    if isinstance(source_time, bool) or not isinstance(source_time, (int, float)) or not math.isfinite(source_time) or not 0 <= source_time <= 86400:
        raise ValueError("source_time_s must be a finite timestamp in [0, 86400]")
    if raw["source_kind"] not in {"synthetic", "camera"}:
        raise ValueError("source_kind must be synthetic or camera")
    encoded = raw["image_base64"]
    if not isinstance(encoded, str) or not encoded or len(encoded) > 4 * ((MAX_IMAGE_BYTES + 2) // 3):
        raise ValueError("JPEG exceeds the 400 KiB limit")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("image_base64 must contain raw JPEG base64") from None
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ValueError("JPEG exceeds the 400 KiB limit")
    from PIL import Image, UnidentifiedImageError
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG":
                raise ValueError("Only JPEG observation frames are accepted")
            width, height = image.size
            if min(width, height) < 16 or max(width, height) > 640:
                raise ValueError("JPEG dimensions must be between 16 and 640 pixels")
            if image.getexif().get(274, 1) != 1:
                raise ValueError("Rotate JPEG pixels before submission; EXIF rotation is not accepted")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            rgb = image.convert("RGB")
            rgb.load()
    except (UnidentifiedImageError, OSError):
        raise ValueError("JPEG could not be decoded") from None
    return {
        "image_bytes": data, "image_base64": encoded, "image": rgb,
        "image_sha256": hashlib.sha256(data).hexdigest(),
        "width": width, "height": height, "concept": concept.strip(),
        "frame_id": frame_id, "run_id": run_id,
        "source_time_s": float(source_time), "source_kind": raw["source_kind"],
    }


def _write_private(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False, indent=2)
        stream.write("\n")


def _claim_frame(folder, frame):
    """Persist run quota before a request; restarting cannot reset it."""
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "state.json"
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, "r+", encoding="utf-8") as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        content = stream.read()
        state = json.loads(content) if content else {"attempts": []}
        attempts = state["attempts"]
        if len(attempts) >= MAX_RUN_REQUESTS:
            raise BudgetExceeded("Live SAM run reached its 60-image request limit")
        if any(item["frame_id"] == frame["frame_id"] for item in attempts):
            raise ValueError("Frame already submitted; no duplicate paid request was made")
        if attempts and frame["source_time_s"] <= attempts[-1]["source_time_s"]:
            raise ValueError("Frames must use strictly increasing source timestamps")
        request_tag = uuid.uuid4().hex
        attempts.append({
            "tag": request_tag, "frame_id": frame["frame_id"],
            "source_time_s": frame["source_time_s"], "image_sha256": frame["image_sha256"],
            "received_at": utc_now(),
        })
        stream.seek(0)
        json.dump(state, stream, allow_nan=False)
        stream.truncate()
        stream.flush()
        os.fsync(stream.fileno())
    return request_tag


def _output_text(response):
    if response.get("status") in {"failed", "incomplete", "cancelled"}:
        raise ProviderUnavailable("SAM did not complete this frame")
    output = response.get("output")
    if not isinstance(output, list):
        raise ProviderUnavailable("SAM returned an unrecognized response")
    return "".join(
        part.get("text", "") for item in output if isinstance(item, dict)
        for part in item.get("content", []) if isinstance(part, dict)
        and part.get("type") == "output_text" and isinstance(part.get("text"), str)
    )


def _detections(text, frame, decoder):
    from perception.sam_perception import parse_sam_text, mask_features
    import numpy as np
    records = parse_sam_text(text)
    if not records:
        if text.strip():
            raise ProviderUnavailable("SAM returned no readable mask records")
        return []
    if len(records) > MAX_OBJECTS:
        raise ProviderUnavailable("Too many objects in one frame; use a narrower concept")
    decoded = {str(mask["object_id"]): mask for mask in decoder(text)}
    image_rgb = np.asarray(frame["image"])
    found = []
    for record in records:
        b = record["box"]
        if b.get("w") != frame["width"] or b.get("h") != frame["height"]:
            raise ProviderUnavailable("SAM coordinates do not match the submitted image")
        if not (0 <= b["x1"] <= b["x2"] < frame["width"] and 0 <= b["y1"] <= b["y2"] < frame["height"]):
            raise ProviderUnavailable("SAM returned an invalid object box")
        mask = decoded.get(str(record["sam_id"]))
        if mask is None:
            raise ProviderUnavailable("SAM mask missing; box-only fallback is disabled")
        features = mask_features(mask, image_rgb=image_rgb)
        if len(features["polygons"]) > 128 or sum(map(len, features["polygons"])) > 20000:
            raise ProviderUnavailable("SAM mask contour exceeds the display limit")
        point = features["centroid"]
        if not all(math.isfinite(x) for x in point) or not (0 <= point[0] < frame["width"] and 0 <= point[1] < frame["height"]):
            raise ProviderUnavailable("SAM mask centroid is outside the submitted image")
        found.append({
            "id": str(record["sam_id"]),
            "box": {"x1": b["x1"], "y1": b["y1"], "x2": b["x2"] + 1, "y2": b["y2"] + 1},
            "centroid": point, "area": features["area"],
            "polygons": features["polygons"],
            "color_rgb": features.get("color_rgb"),
            "mask_decoded": True,
        })
    return found


def segment_frame(raw, client=None, decoder=None, data_root=None):
    frame = validate_frame(raw)
    if not _IN_FLIGHT.acquire(blocking=False):
        raise LiveSamBusy("SAM is processing another frame; wait for it before sending the next")
    started = time.perf_counter()
    audit = None
    audit_path = None
    try:
        from perception.sam_perception import decode_masks
        if decoder is None and not _decoder_available():
            raise ProviderUnavailable("SAM mask decoder is unavailable; install the declared perception dependencies")
        client = client or _default_client()
        decoder = decoder or decode_masks
        root = Path(data_root or client.ledger.root)
        folder = root / "live-sam" / frame["run_id"]
        tag = _claim_frame(folder, frame)
        audit_path = folder / (tag + ".json")
        audit = {k: frame[k] for k in ("run_id", "frame_id", "source_time_s", "source_kind", "image_sha256", "width", "height", "concept")}
        jpeg_name = tag + ".jpg"
        fd = os.open(folder / jpeg_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(frame["image_bytes"])
        audit.update(received_at=utc_now(), provider="meta-model-api", model=MODEL, status="requesting", input_jpeg=jpeg_name)
        _write_private(audit_path, audit)
        # Exact submitted bytes: no geometry, masses, velocities or random seed.
        response = client.segment(frame["image_base64"], frame["concept"], scene=SCENE)
        receipt = response.get("twinforge_receipt")
        if not isinstance(receipt, dict) or receipt.get("model") != MODEL or not re.fullmatch(r"[0-9a-f]{32}", str(receipt.get("request_id", ""))) or not re.fullmatch(r"[0-9a-f]{64}", str(receipt.get("request_sha256", ""))):
            raise ProviderUnavailable("SAM response lacks its request receipt")
        audit["receipt"] = receipt
        audit["provider_response"] = response
        # Persist raw output before decoding, including output that cannot be used.
        audit["status"] = "decoding"
        _write_private(audit_path, audit)
        text = _output_text(response)
        detections = _detections(text, frame, decoder)
        result = {
            "schema_version": "twinforge.sam.frame.v1",
            "run_id": frame["run_id"], "frame_id": frame["frame_id"],
            "source_time_s": frame["source_time_s"], "source_kind": frame["source_kind"],
            "width": frame["width"], "height": frame["height"],
            "image_sha256": frame["image_sha256"],
            "model": MODEL, "provider": "meta-model-api",
            "evidence_id": tag,
            "status": "detected" if detections else "no_matches",
            "detections": detections, "receipt": receipt,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            "charged_usd": IMAGE_PRICE_USD,
            "budget": client.ledger.summary(),
            "observation_units": "px", "live_provider_call": True,
        }
        audit.update(status="complete", completed_at=utc_now(), result=result)
        _write_private(audit_path, audit)
        return result
    except Exception as error:
        if audit is not None and audit_path is not None:
            audit.update(status="failed", completed_at=utc_now(), error_type=type(error).__name__)
            _write_private(audit_path, audit)
        raise
    finally:
        _IN_FLIGHT.release()
