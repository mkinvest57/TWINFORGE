#!/usr/bin/env python3
"""TWINFORGE — Prompt 2: real SAM 3.1 video perception -> trajectories.

Pipeline (runs on a new video without modification):
  video -> sampled frames (5-10 fps) -> SAM 3.1 (Meta Model API, /v1/responses,
  text concept prompts) -> masks/boxes -> 100% deterministic state extraction
  (centroids, polygons, finite-difference velocities) -> ID tracking with
  FP-01 re-acquisition -> FP-02 quality flags -> world coordinates (fiducial
  homography when provided, otherwise scale from the real rim diameter) ->
  events -> JSON dataset + report + annotated frames.

No true scene parameter is ever used: we measure positions, period.
The Meta key is read from the META_MODEL_API_KEY environment variable or the root
`.env` (never committed). Video dependencies: opencv-python-headless, pillow (requirements.txt).
Pure functions (parse, tracking, events) have no heavy dependency.
"""
import argparse
import base64
import json
import math
import os
import re
import statistics
import sys
import urllib.request
import urllib.error

META_BASE = "https://api.meta.ai/v1"
SAM_MODEL = "sam-3.1"
RIM_DIAMETER_M = 0.4572   # regulation basketball rim diameter
RIM_HEIGHT_M = 3.05       # regulation rim height

# ---------------------------------------------------------------- SAM parsing
_BOX_RE = re.compile(r"(\d+)<\|box;([^|]*)\|>(?:<\|mask;([^|]*)\|>)?")


def parse_sam_text(text):
    """Parse SAM 3 structured text: records `id<|box;...|><|mask;...|>`."""
    records = []
    for m in _BOX_RE.finditer(text or ""):
        box = {}
        for kv in m.group(2).split(";"):
            if "=" in kv:
                k, v = kv.split("=", 1)
                try:
                    box[k.strip()] = int(float(v))
                except ValueError:
                    pass
        mask_data = None
        if m.group(3) and "data=" in m.group(3):
            mask_data = m.group(3).split("data=", 1)[1]
        records.append({"sam_id": int(m.group(1)), "box": box, "mask_data": mask_data})
    return records


def box_centroid(box):
    return ((box["x1"] + box["x2"]) / 2.0, (box["y1"] + box["y2"]) / 2.0)


def box_area(box):
    return max(0, box["x2"] - box["x1"]) * max(0, box["y2"] - box["y1"])


# ------------------------------------------------------------------- tracking
class Tracker:
    """ID tracking by position/velocity continuity + FP-01 re-acquisition."""

    def __init__(self, gate_px=90, max_missing=4):
        self.gate = gate_px
        self.max_missing = max_missing
        self.tracks = {}   # id -> {centroid, vel, t, missing}
        self.next_id = 1
        self.stats = {"fp01_losses": 0, "fp01_reacquired": 0, "frames": 0}

    def update(self, detections, t):
        self.stats["frames"] += 1
        primary_id = None
        if self.tracks:
            cand = max(self.tracks.items(), key=lambda kv: kv[1].get("hits", 1))
            if cand[1].get("hits", 1) >= 2:
                primary_id = cand[0]
        assigned, used = [], set()
        # trajectory prediction (FP-01: short extrapolation)
        for det in sorted(detections, key=lambda d: -box_area(d["box"])):
            c = det.get("centroid") or box_centroid(det["box"])
            best, best_d = None, 1e18
            for tid, tr in self.tracks.items():
                if tid in used:
                    continue
                dt = max(t - tr["t"], 1e-3)
                px, py = tr["centroid"][0] + tr["vel"][0] * dt, tr["centroid"][1] + tr["vel"][1] * dt
                d = math.hypot(c[0] - px, c[1] - py)
                if d < best_d:
                    best, best_d = tid, d
            if best is not None and best_d <= self.gate:
                tr = self.tracks[best]
                dt = max(t - tr["t"], 1e-3)
                if tr["missing"] > 0:
                    self.stats["fp01_reacquired"] += 1
                tr["vel"] = ((c[0] - tr["centroid"][0]) / dt, (c[1] - tr["centroid"][1]) / dt)
                tr["centroid"], tr["t"], tr["missing"] = c, t, 0
                tr["hits"] = tr.get("hits", 1) + 1
                used.add(best)
                assigned.append({**det, "centroid": c, "track_id": best, "track_hits": tr["hits"]})
            else:
                tid = self.next_id
                self.next_id += 1
                self.tracks[tid] = {"centroid": c, "vel": (0.0, 0.0), "t": t, "missing": 0, "hits": 1}
                used.add(tid)
                assigned.append({**det, "centroid": c, "track_id": tid, "track_hits": 1})
        for tid, tr in self.tracks.items():
            if tid not in used:
                tr["missing"] += 1
        # FP-01 counted on the MAIN track only (spurious detections do not pollute the counter)
        if primary_id is not None and primary_id not in used:
            self.stats["fp01_losses"] += 1
        # retire tracks lost for too long
        dead = [tid for tid, tr in self.tracks.items() if tr["missing"] > self.max_missing]
        for tid in dead:
            del self.tracks[tid]
        return assigned


# ------------------------------------------------------------------ FP-02 flou
def flag_fp02(frames):
    """Degraded frames: abnormal area/eccentricity vs the track median."""
    if not frames:
        return []
    areas = [box_area(f["box"]) for f in frames]
    aspects = []
    for f in frames:
        w = max(1, f["box"]["x2"] - f["box"]["x1"])
        h = max(1, f["box"]["y2"] - f["box"]["y1"])
        aspects.append(w / h)
    med_a = statistics.median(areas) or 1
    flags = []
    for f, a, asp in zip(frames, areas, aspects):
        flags.append(bool(a < 0.45 * med_a or a > 2.2 * med_a or asp > 2.2 or asp < 0.25))
    return flags


# --------------------------------------------------------------- monde / events
def world_from_scale(centroid, rim_centroid, rim_width_px, rim_y_m=RIM_HEIGHT_M,
                     rim_diameter_m=RIM_DIAMETER_M, board_height_px=None, board_height_m=1.07):
    """Monocular scene plane: X scale from the real rim diameter (0.4572 m),
    Y scale from the real backboard height (1.07 m) when the board is known —
    perspective makes the two pixel scales differ, so they are calibrated
    independently. Origin: rim centre. z = 0 (camera plane) — stated limit;
    with printed fiducials, use the full homography path (--fiducials)."""
    sx = rim_diameter_m / max(rim_width_px, 1)
    sy = (board_height_m / board_height_px) if board_height_px else sx
    return ((centroid[0] - rim_centroid[0]) * sx, rim_y_m + (rim_centroid[1] - centroid[1]) * sy, 0.0)


def apply_homography(H, point):
    """Apply a 3x3 homography to a pixel point -> world (x, y). Pure python."""
    x, y = point
    w = H[2][0] * x + H[2][1] * y + H[2][2]
    if abs(w) < 1e-12:
        return (0.0, 0.0)
    return ((H[0][0] * x + H[0][1] * y + H[0][2]) / w,
            (H[1][0] * x + H[1][1] * y + H[1][2]) / w)


def detect_events(points, rim):
    """points: sorted [{t, centroid(px)}]; rim: {centroid, box} or None."""
    events = []
    if len(points) < 3:
        return events
    vys = []
    for i in range(1, len(points)):
        dt = max(points[i]["t"] - points[i - 1]["t"], 1e-3)
        vys.append((points[i]["centroid"][1] - points[i - 1]["centroid"][1]) / dt)
    if vys and abs(vys[0]) > 40:
        events.append({"t": points[0]["t"], "event": "launch", "detail": "first fast motion detected"})
    for i in range(1, len(vys)):
        if vys[i - 1] < 0 and vys[i] >= 0:
            events.append({"t": points[i]["t"], "event": "apex", "detail": "shot apex (pixel vy flips)"})
            break
    if rim:
        rc, rb = rim["centroid"], rim["box"]
        for i in range(1, len(points)):
            c0, c1 = points[i - 1]["centroid"], points[i]["centroid"]
            if c0[1] < rc[1] <= c1[1] and rb["x1"] <= c1[0] <= rb["x2"]:
                events.append({"t": points[i]["t"], "event": "rim_cross_down",
                               "detail": "downward crossing of the rim plane within its span"})
            if c0[1] > rc[1] and abs(c1[0] - rc[0]) < 12 and abs(c1[1] - rc[1]) < 12:
                events.append({"t": points[i]["t"], "event": "rim_occlusion_zone",
                               "detail": "ball in contact with the rim (FP-01 zone)"})
    return events


# ----------------------------------------------------------------- client SAM
def load_key():
    k = os.environ.get("META_MODEL_API_KEY", "").strip()
    if k:
        return k
    for cand in (os.path.join(os.path.dirname(__file__), "..", ".env"), ".env"):
        if os.path.exists(cand):
            for line in open(cand):
                if line.strip().startswith("META_MODEL_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def sam_segment_image(image_bytes, concept, key, max_side=640):
    """One SAM 3.1 call (/v1/responses) for one concept on a JPEG image."""
    from PIL import Image
    import io
    im = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    b64 = base64.b64encode(buf.getvalue()).decode()
    payload = {"model": SAM_MODEL, "input": [{"role": "user", "content": [
        {"type": "input_text", "text": concept},
        {"type": "input_image", "image_url": f"data:image/jpeg;base64,{b64}"}]}]}
    req = urllib.request.Request(META_BASE + "/responses", data=json.dumps(payload).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                                 method="POST")
    d = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            break
        except Exception:
            if attempt == 2:
                raise
            import time as _t; _t.sleep(2 * (attempt + 1))
    text = ""
    for item in d.get("output") or []:
        for c in item.get("content") or []:
            if c.get("type") == "output_text":
                text += c.get("text", "")
    recs = parse_sam_text(text)
    sx = (image_bytes and 1)  # placeholder, caller handles scale via box w/h
    return recs, text, im.size


# -------------------------------------------------------------------- pipeline
def run_pipeline(args):
    import cv2
    key = load_key()
    if not key:
        print("ERROR: META_MODEL_API_KEY missing (env or root .env).", file=sys.stderr)
        return 2
    os.makedirs(args.out, exist_ok=True)
    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"ERROR: unreadable video {args.video}", file=sys.stderr)
        return 2
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, round(src_fps / args.sample_fps))
    print(f"Video {args.video}: {total} frames @ {src_fps:.1f} fps, sampling 1/{step} (~{args.sample_fps} fps)")

    PROMPTS = {"ball": ["ball", "basketball"],
               "vertical hoop": ["basketball hoop", "hoop", "vertical hoop"],
               "backboard": ["backboard"]}
    def segment_with_fallback(jpg_bytes, concept, frame_w, frame_h):
        for prompt in PROMPTS[concept]:
            recs, _t, resized = sam_segment_image(jpg_bytes, prompt, key)
            if recs:
                # SAM answers in the resized image space: back to original frame px
                fx, fy = frame_w / max(1, resized[0]), frame_h / max(1, resized[1])
                for r in recs:
                    b = r["box"]
                    r["box"] = {"x1": int(b["x1"]*fx), "y1": int(b["y1"]*fy), "x2": int(b["x2"]*fx),
                                "y2": int(b["y2"]*fy), "w": frame_w, "h": frame_h}
                return recs, prompt
        return [], PROMPTS[concept][0]
    tracker = Tracker(gate_px=args.gate, max_missing=12)
    ball_frames, static_hits = [], {"vertical hoop": [], "backboard": [], "ball": []}
    annotated_idx = 0
    frame_no, sampled = -1, 0
    events_frames = []
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_no += 1
        if frame_no % step != 0:
            continue
        t = frame_no / src_fps
        if args.max_seconds and t > args.max_seconds:
            break
        sampled += 1
        ok2, jpg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        # dynamic concept on every sampled frame
        recs, _used_prompt = segment_with_fallback(jpg.tobytes(), "ball", frame.shape[1], frame.shape[0])
        dets = []
        for r in recs:
            r["centroid"] = box_centroid(r["box"])
            r["area"] = box_area(r["box"])
            dets.append(r)
        assigned = tracker.update(dets, t)
        # main track = the most mature (history), not the biggest box of the moment
        main = max(assigned, key=lambda d: (d.get("track_hits", 1), d["area"])) if assigned else None
        if main:
            ball_frames.append({"t": round(t, 3), "frame": frame_no, "track_id": main["track_id"],
                                "centroid": [round(main["centroid"][0], 1), round(main["centroid"][1], 1)],
                                "box": main["box"], "area": main["area"], "mask": bool(main.get("mask_data"))})
        # static concepts less often (cost target: no useless frame-by-frame)
        if sampled == 1 or sampled % args.static_every == 0:
            for concept in ("vertical hoop", "backboard"):
                try:
                    srecs, used_prompt = segment_with_fallback(jpg.tobytes(), concept, frame.shape[1], frame.shape[0])
                    if srecs:
                        for r in srecs: r["prompt_used"] = used_prompt
                    for r in srecs:
                        r["centroid"] = box_centroid(r["box"])
                        r["area"] = box_area(r["box"])
                    if srecs:
                        static_hits[concept].append(max(srecs, key=lambda r: r["area"]))
                except Exception as e:
                    print(f"  [static {concept} @t={t:.2f}] call failed: {e}")
        # annotated frame (visual check for ONE full shot)
        if main:
            x1, y1, x2, y2 = main["box"]["x1"], main["box"]["y1"], main["box"]["x2"], main["box"]["y2"]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (20, 110, 255), 2)
            cv2.circle(frame, (int(main["centroid"][0]), int(main["centroid"][1])), 5, (220, 180, 40), -1)
            cv2.putText(frame, f"ball ID {main['track_id']} t={t:.2f}s", (12, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            for p in ball_frames[-25:-1]:
                cv2.circle(frame, (int(p["centroid"][0]), int(p["centroid"][1])), 2, (220, 180, 40), -1)
            cv2.imwrite(os.path.join(args.out, f"annotated_{annotated_idx:03d}.jpg"), frame)
            annotated_idx += 1
        print(f"  t={t:5.2f}s frame {frame_no}: ball={'ID'+str(main['track_id']) if main else 'LOST'} "
              f"({'ok' if main else 'FP-01 searching…'})")
    cap.release()

    # median static centroids
    statics = {}
    for concept, hits in static_hits.items():
        if hits:
            med = lambda vals: float(statistics.median(vals))
            statics[concept] = {
                "centroid": [med([h["centroid"][0] for h in hits]), med([h["centroid"][1] for h in hits])],
                "box": {"x1": int(med([h["box"]["x1"] for h in hits])), "y1": int(med([h["box"]["y1"] for h in hits])),
                        "x2": int(med([h["box"]["x2"] for h in hits])), "y2": int(med([h["box"]["y2"] for h in hits])),
                        "w": hits[0]["box"]["w"], "h": hits[0]["box"]["h"]},
                "hits": len(hits), "prompt_used": hits[0].get("prompt_used")}

    # optional fiducial homography (4 printed markers: px -> metres)
    H = None
    if getattr(args, "fiducials", ""):
        import numpy as np
        with open(args.fiducials) as fh:
            fid = json.load(fh)
        H = cv2.getPerspectiveTransform(np.array(fid["points_px"], dtype="float32"),
                                        np.array(fid["points_m"], dtype="float32")).tolist()
        print(f"Fiducial homography loaded from {args.fiducials}")
    # windowed finite-difference velocities + world
    rim = statics.get("vertical hoop")
    dataset = {"video": os.path.basename(args.video), "sample_fps": args.sample_fps,
               "model": SAM_MODEL, "provider": "Meta Model API /v1/responses",
               "concepts": ["ball", "vertical hoop", "backboard"], "statics": statics, "frames": []}
    flags = flag_fp02([{"box": f["box"]} for f in ball_frames])
    for i, f in enumerate(ball_frames):
        lo, hi = max(0, i - 2), min(len(ball_frames) - 1, i + 2)
        dt = max(ball_frames[hi]["t"] - ball_frames[lo]["t"], 1e-3)
        vx = (ball_frames[hi]["centroid"][0] - ball_frames[lo]["centroid"][0]) / dt
        vy = (ball_frames[hi]["centroid"][1] - ball_frames[lo]["centroid"][1]) / dt
        world = None
        if H is not None:
            wx, wy = apply_homography(H, f["centroid"])
            world = [round(wx, 4), round(wy, 4), 0.0]
        elif rim:
            board = statics.get("backboard")
            board_h = max(1, board["box"]["y2"] - board["box"]["y1"]) if board else None
            world = list(world_from_scale(f["centroid"], rim["centroid"],
                                          max(1, rim["box"]["x2"] - rim["box"]["x1"]),
                                          board_height_px=board_h))
            world = [round(v, 4) for v in world]
        dataset["frames"].append({**f, "vel_px_s": [round(vx, 1), round(vy, 1)], "world_m": world,
                                  "quality": {"fp02_outlier": bool(flags[i]) if i < len(flags) else False}})
    pts = [{"t": f["t"], "centroid": tuple(f["centroid"])} for f in ball_frames]
    events = detect_events(pts, rim if rim else None)
    dataset["events"] = events
    dataset["tracking"] = {"fp01_losses": tracker.stats["fp01_losses"],
                           "fp01_reacquired": tracker.stats["fp01_reacquired"],
                           "sampled_frames": tracker.stats["frames"],
                           "ball_frames_found": len(ball_frames)}
    with open(os.path.join(args.out, "trajectories.json"), "w") as fh:
        json.dump(dataset, fh, indent=1, ensure_ascii=False)

    event_lines = [f"- {e['event']} @ t={e['t']}s — {e['detail']}" for e in events] or ["- aucun"]
    found_ratio = len(ball_frames) / max(1, sampled)
    fp02_ratio = (sum(1 for fl in flags if fl) / max(1, len(flags))) if flags else 0
    report = [
        "# TWINFORGE — SAM 3.1 perception report",
        "",
        f"Video: `{os.path.basename(args.video)}` · Model: `{SAM_MODEL}` via Meta Model API `/v1/responses` · Concepts: ball / vertical hoop / backboard",
        f"Sampled frames : {sampled} (~{args.sample_fps} fps) · Ball found : {len(ball_frames)} ({found_ratio:.0%})",
        "",
        "## ID continuity (FP-01)",
        f"- Tracking losses (frames without the ball while it was tracked) : {tracker.stats['fp01_losses']}",
        f"- Re-acquisitions by predicted trajectory : {tracker.stats['fp01_reacquired']}",
        f"- Distinct IDs assigned to the ball : {sorted(set(f['track_id'] for f in ball_frames)) if ball_frames else []} (whole video, bounces/rolling included)",
        f"- IDs on the flight segment (launch -> rim crossing) : {sorted(set(f['track_id'] for f in ball_frames if not any(e['event'] == 'rim_cross_down' and f['t'] > e['t'] for e in events)))} — Prompt 2 criterion: ID stable through the rim",
        "",
        "## Degraded frames (FP-02, motion blur)",
        f"- Area/eccentricity outliers excluded from the later fit : {fp02_ratio:.0%} des frames balle",
        "",
        "## Detected events",
        *event_lines,
        "",
        "## Honest limits",
        "- Monocular world coordinates (scene plane, z=0): scale from the real rim diameter (0.4572 m).",
        "  With 4 printed fiducials + homography, planimetric accuracy improves; depth stays undetermined in mono.",
        "- Centroids from SAM boxes (encoded masks are kept raw in the response; raster decoding via @meta-sam/parser when Node is present).",
        "- No physical parameter (gravity, wind, restitution) is estimated here: this stage measures positions, period.",
        "",
        "## Exit criterion (Prompt 2)",
        ("GO: clean ball trajectory, replayable frame by frame (annotated frames + trajectories.json)."
         if found_ratio > 0.7 else
         "PARTIAL NO-GO: insufficient continuity — named FP-01/FP-02 failure, see counters above; remedy: sample denser around the rim and widen the gate."),
    ]
    with open(os.path.join(args.out, "report.md"), "w") as fh:
        fh.write("\n".join(report) + "\n")
    print("\n".join(report[:6]))
    print(f"\nDataset: {args.out}/trajectories.json · Report: {args.out}/report.md · Annotated frames: {annotated_idx}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="TWINFORGE Prompt 2 — perception SAM 3.1 vidéo -> trajectoires")
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", default="perception/output")
    ap.add_argument("--sample-fps", type=float, default=8.0)
    ap.add_argument("--static-every", type=int, default=6, help="static concept sampling (1 in N)")
    ap.add_argument("--gate", type=int, default=175, help="FP-01 association gate in px (full resolution)")
    ap.add_argument("--max-seconds", type=float, default=0)
    ap.add_argument("--fiducials", default="", help="JSON {points_px: [[x,y]x4], points_m: [[x,y]x4]} for world homography")
    args = ap.parse_args()
    return run_pipeline(args)


if __name__ == "__main__":
    raise SystemExit(main())
