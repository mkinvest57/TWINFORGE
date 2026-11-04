#!/usr/bin/env python3
"""Prepare a labelled video and GIF from a genuine continuous browser capture.

This utility burns subtitles and a simulation label; it never generates or
extends footage, changes playback speed, invents results, or approves the video.
Use the produced provenance record for a subsequent full visual review.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def evidence_path(path):
    root = Path(__file__).resolve().parents[1]
    try:
        return str(path.relative_to(root))
    except ValueError:
        return path.name


def stamp(value):
    h, m, rest = value.split(":")
    s, ms = rest.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def subtitle_coverage(path, duration, tolerance=0.15):
    ranges = []
    for start, stop in re.findall(r"(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})", path.read_text()):
        begin, end = stamp(start), stamp(stop)
        if begin >= end:
            raise ValueError("Subtitle interval must have positive duration")
        ranges.append((begin, end))
    end = 0.0
    for begin, stop in sorted(ranges):
        if begin - end > tolerance:
            raise ValueError(f"Uncaptioned gap from {end:.3f}s to {begin:.3f}s")
        end = max(end, stop)
    if not ranges or end < duration - tolerance:
        raise ValueError("Subtitles do not cover the complete capture")
    return {"intervals": len(ranges), "covered_until_seconds": end}


def ffmpeg_path(explicit=None):
    if explicit:
        return explicit
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise SystemExit("ffmpeg missing. Use .venv/bin/python or --ffmpeg /path/to/ffmpeg.")


def duration_seconds(ffmpeg, path):
    run = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True)
    match = re.search(r"Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)", run.stderr)
    if match:
        return int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    # MediaRecorder WebM streams often omit container duration. Decode the actual
    # video to a null sink and use its final timestamp; never pad/loop/re-time it.
    decoded = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(path),
                              "-map", "0:v:0", "-fps_mode", "passthrough",
                              "-progress", "pipe:1", "-nostats", "-f", "null", "-"],
                             capture_output=True, text=True)
    times = [int(value) for value in re.findall(r"^out_time_us=(-?\d+)\s*$", decoded.stdout, re.MULTILINE)]
    if decoded.returncode != 0 or not times or max(times) <= 0:
        raise ValueError("Cannot determine source duration from metadata or decoded timestamps; inspect the capture")
    return max(times) / 1_000_000


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--subtitles", type=Path)
    parser.add_argument("--already-captioned", action="store_true", help="preserve labels/subtitles already burned by the app; full visual review is still required")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--gif", type=Path)
    parser.add_argument("--gif-start", type=float, default=35)
    parser.add_argument("--gif-duration", type=float, default=8)
    parser.add_argument("--ffmpeg")
    args = parser.parse_args()
    source, output = args.input.resolve(), args.output.resolve()
    subtitles = args.subtitles.resolve() if args.subtitles else None
    if args.already_captioned == bool(subtitles):
        raise SystemExit("Choose either --subtitles or --already-captioned")
    if not source.is_file() or (subtitles and not subtitles.is_file()):
        raise SystemExit("Source capture and optional SRT must exist")
    if source == output or output.exists():
        raise SystemExit("Choose a new output; original capture and existing media are never overwritten")
    ffmpeg = ffmpeg_path(args.ffmpeg)
    duration = duration_seconds(ffmpeg, source)
    if not 140 <= duration <= 160:
        raise SystemExit(f"Capture is {duration:.2f}s. Record about 150s; this tool never pads, loops or speeds footage.")
    coverage = subtitle_coverage(subtitles, duration) if subtitles else {"source": "embedded_by_application", "coverage_requires_visual_review": True}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="twinforge-media-") as tmp:
        temp = Path(tmp)
        filter_args = []
        if subtitles:
            shutil.copyfile(subtitles, temp / "captions.srt")
            # A second track supplies a persistent, visible provenance label.
            (temp / "label.srt").write_text("1\n00:00:00,000 --> 00:10:00,000\nSIMULATION - L3 - calibration moteur connu\n")
            filters = "subtitles=captions.srt:force_style='FontSize=18,MarginV=24',subtitles=label.srt:force_style='Alignment=8,FontSize=16,MarginV=18'"
            filter_args = ["-vf", filters]
        subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(source), *filter_args,
                        "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p",
                        "-r", "24", "-fps_mode", "cfr",
                        "-c:a", "aac", "-movflags", "+faststart", str(output)], cwd=temp, check=True)
    result = {"version": 1, "created_at": datetime.now(timezone.utc).isoformat(), "status": "produced_not_reviewed",
              "mode": "simulation", "source": {"path": evidence_path(source), "sha256": sha256(source), "duration_seconds": duration},
              "subtitles": {**({"path": evidence_path(subtitles), "sha256": sha256(subtitles)} if subtitles else {}), **coverage},
              "output": {"path": evidence_path(output), "sha256": sha256(output), "duration_seconds": duration_seconds(ffmpeg, output)},
              "transform": "Same continuous footage and playback speed; timestamps resampled at 24 fps for compatible H264 encoding, app captions preserved." if args.already_captioned else "Same continuous footage and playback speed; subtitles and simulation/L3 label burned in, timestamps resampled at 24 fps for H264 encoding.",
              "visual_review_required": True}
    if args.gif:
        target = args.gif.resolve()
        if target.exists() or target == source:
            raise SystemExit("GIF output already exists; choose a new output")
        if args.gif_start < 0 or args.gif_duration <= 0 or args.gif_start + args.gif_duration > duration:
            raise SystemExit("GIF interval must lie within the captured footage")
        target.parent.mkdir(parents=True, exist_ok=True)
        filters = "fps=12,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"
        subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-ss", str(args.gif_start), "-t", str(args.gif_duration),
                        "-i", str(output), "-filter_complex", filters, str(target)], check=True)
        result["gif"] = {"path": evidence_path(target), "sha256": sha256(target), "start_seconds": args.gif_start, "duration_seconds": args.gif_duration}
    record = output.with_suffix(output.suffix + ".provenance.json")
    record.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
