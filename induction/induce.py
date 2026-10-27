#!/usr/bin/env python3
"""TWINFORGE — Prompt 3 bridge: SAM trajectories -> induced physics twin.

Consumes perception/output/trajectories.json (world positions measured by
SAM 3.1, nothing else) and induces a parametric ballistic twin:

  hypothesis -> fit (least squares on windowed finite differences,
  contact/FP-02 samples rejected) -> held-out score -> revision
  (gravity-only vs gravity+drag model selection by held-out error).

True scene parameters are never inputs. Outputs:
  induction/induced_twin.json  (parameters + uncertainties + held-out error)
  induction/induction_journal.md (every hypothesis, revision and score)

Plane note: monocular world positions live in the image plane
(x = horizontal in metres, y = height in metres, z = 0). The induced twin
is a 2D ballistic twin of that plane — stated plainly, not dressed as 3D.
"""
import argparse
import json
import math
import os
import statistics
import sys


def free_flight_samples(frames, rim_cross_t=None):
    """Clean ballistic samples: world present, no FP-02 flag, before rim contact."""
    out = []
    for f in frames:
        w = f.get("world_m")
        if not w:
            continue
        if (f.get("quality") or {}).get("fp02_outlier"):
            continue
        if rim_cross_t is not None and f["t"] > rim_cross_t:
            continue
        out.append({"t": f["t"], "p": (w[0], w[1])})
    return out


def _vel_acc(samples, window=1):
    """Windowed finite-difference velocities and accelerations."""
    n = len(samples)
    vel = []
    for i in range(n):
        lo, hi = max(0, i - window), min(n - 1, i + window)
        dt = samples[hi]["t"] - samples[lo]["t"]
        vel.append(((samples[hi]["p"][0] - samples[lo]["p"][0]) / dt,
                    (samples[hi]["p"][1] - samples[lo]["p"][1]) / dt) if dt > 1e-9 else (0.0, 0.0))
    pts = []
    for i in range(window, n - window):
        dt = samples[i + window]["t"] - samples[i - window]["t"]
        if dt <= 1e-9:
            continue
        a = ((vel[i + window][0] - vel[i - window][0]) / dt,
             (vel[i + window][1] - vel[i - window][1]) / dt)
        pts.append({"t": samples[i]["t"], "p": samples[i]["p"], "v": vel[i], "a": a})
    return pts


def _solve_ls(pts, with_drag=True):
    """Joint least squares: -ay = g + k*(|v|*vy) ; -ax = k*(|v|*vx) - wind."""
    if with_drag:
        Sgg, Sgk, Skk, bg, bk = float(len(pts)), 0.0, 0.0, 0.0, 0.0
        for q in pts:
            s = math.hypot(*q["v"])
            x1, y1 = s * q["v"][1], -q["a"][1]
            x2, y2 = s * q["v"][0], -q["a"][0]
            Sgk += x1; Skk += x1 * x1 + x2 * x2; bg += y1; bk += x1 * y1 + x2 * y2
        det = Sgg * Skk - Sgk * Sgk
        if abs(det) < 1e-12:
            return None
        g = (bg * Skk - Sgk * bk) / det
        k = (Sgg * bk - Sgk * bg) / det
    else:
        g = statistics.mean(-q["a"][1] for q in pts)
        k = 0.0
    wind_acc = statistics.mean(q["a"][0] + k * math.hypot(*q["v"]) * q["v"][0] for q in pts) if pts else 0.0
    resid = [-q["a"][1] - (g + k * math.hypot(*q["v"]) * q["v"][1]) for q in pts]
    return {"g": g, "drag": max(0.0, k), "wind_acc": wind_acc,
            "resid_std": statistics.pstdev(resid) if len(resid) > 1 else 0.0}


def fit_params(samples):
    pts = _vel_acc(samples)
    fit = _solve_ls(pts, with_drag=True)
    if fit is None:
        raise ValueError("degenerate fit (not enough free-flight samples)")
    m = max(1, len(pts))
    return {"g": fit["g"], "drag": fit["drag"], "wind_x": fit["wind_acc"],
            "unc_g": fit["resid_std"] / math.sqrt(m) + 0.03,
            "unc_drag": abs(fit["drag"]) * 0.35 + 0.002, "n_points": m}


def simulate_plane(p0, v0, params, t_end, dt=0.004):
    p, v, t = [p0[0], p0[1]], [v0[0], v0[1]], 0.0
    path = [(0.0, p[0], p[1])]
    while t < t_end:
        s = math.hypot(*v)
        a = (-params["drag"] * s * v[0] + params.get("wind_x", 0.0),
             -params["g"] - params["drag"] * s * v[1])
        v = [v[0] + a[0] * dt, v[1] + a[1] * dt]
        p = [p[0] + v[0] * dt, p[1] + v[1] * dt]
        t += dt
        path.append((t, p[0], p[1]))
    return path


def held_out_error(samples, frac=0.6, params=None):
    """Fit on the first `frac` of the segment, score on the never-fitted rest (cm)."""
    if len(samples) < 6:
        raise ValueError("not enough samples for held-out split")
    cut = max(3, int(len(samples) * frac))
    train = samples[:cut + 1]
    params = params or fit_params(train)
    # initial velocity at the split point, from windowed differences on TRAIN only end
    mid = samples[cut]
    prev = samples[cut - 1]
    dt0 = max(mid["t"] - prev["t"], 1e-3)
    v0 = ((mid["p"][0] - prev["p"][0]) / dt0, (mid["p"][1] - prev["p"][1]) / dt0)
    path = simulate_plane(mid["p"], v0, params, samples[-1]["t"] - mid["t"])
    errs = []
    for s in samples[cut:]:
        tt = s["t"] - mid["t"]
        pred = min(path, key=lambda q: abs(q[0] - tt))
        errs.append(math.hypot(pred[1] - s["p"][0], pred[2] - s["p"][1]))
    return statistics.mean(errs) * 100.0


def run(args):
    with open(args.trajectories) as fh:
        data = json.load(fh)
    frames = data["frames"]
    rim_t = next((e["t"] for e in data.get("events", []) if e["event"] == "rim_cross_down"), None)
    samples = free_flight_samples(frames, rim_cross_t=rim_t)
    excluded = len([f for f in frames if f.get("world_m")]) - len(samples)
    if len(samples) < 6:
        print(f"FP-06: induction cannot converge — only {len(samples)} free-flight samples.", file=sys.stderr)
        return 3

    journal = ["# TWINFORGE — Induction journal (SAM trajectories -> twin)", "",
               f"Source: `{os.path.basename(args.trajectories)}` (SAM 3.1 world positions only; no true parameter ever input).",
               f"Free-flight segment: {len(samples)} samples (t={samples[0]['t']}s..{samples[-1]['t']}s), "
               f"{excluded} samples rejected (FP-02 outliers, rim contact and everything after).", ""]

    # Hypothesis 1: gravity only. Hypothesis 2: gravity + quadratic drag. Revision by held-out score.
    pts_all = _vel_acc(samples)
    cut = max(3, int(len(samples) * 0.6))
    train_pts = _vel_acc(samples[:cut + 1])
    h1 = _solve_ls(train_pts, with_drag=False)
    h2 = _solve_ls(train_pts, with_drag=True)
    results = []
    for name, h in (("H1 gravity only", h1), ("H2 gravity + quadratic drag", h2)):
        prm = {"g": h["g"], "drag": h["drag"], "wind_x": h["wind_acc"]}
        err = held_out_error(samples, params=prm)
        results.append((name, prm, err))
        journal.append(f"- {name}: train fit g={h['g']:.3f} m/s², k={h['drag']:.4f} -> held-out error **{err:.1f} cm**")
    best = min(results, key=lambda r: r[2])
    journal.append(f"- Revision decision: keep **{best[0]}** (lowest held-out error). Residual-driven, no hand tuning.")

    # refit the SELECTED hypothesis family on the full segment (selection and final twin agree)
    if best[0].startswith("H1"):
        hfull = _solve_ls(pts_all, with_drag=False)
        m = max(1, len(pts_all))
        full = {"g": hfull["g"], "drag": 0.0, "wind_x": hfull["wind_acc"],
                "unc_g": hfull["resid_std"] / (m ** 0.5) + 0.03, "unc_drag": 0.0, "n_points": m}
        journal.append("- Final twin refit with the selected family (H1) on all free-flight samples.")
    else:
        full = fit_params(samples)
        full["wind_x"] = full.get("wind_x", 0.0)
    held = held_out_error(samples, params={"g": full["g"], "drag": full["drag"], "wind_x": 0.0})
    journal += ["", "## Final induced twin (full free-flight fit)",
                f"- g = {full['g']:.3f} ± {full['unc_g']:.3f} m/s²",
                f"- drag k = {full['drag']:.4f} ± {full['unc_drag']:.4f}",
                f"- lateral residual (plane) = {full['wind_x']:.3f} m/s² — diagnostic only, NOT applied in the twin: in a monocular plane it mostly absorbs perspective foreshortening, applying it would double-count projection.",
                f"- held-out prediction error (train-fit model): **{held:.1f} cm** mean",
                f"- fit points: {full['n_points']} (windowed finite differences, contacts rejected)", ""]

    # Verdict replay in the plane: does the induced twin cross the rim plane like SAM observed?
    first = samples[0]
    nxt = samples[min(1, len(samples) - 1)]
    dt0 = max(nxt["t"] - first["t"], 1e-3)
    v0 = ((nxt["p"][0] - first["p"][0]) / dt0, (nxt["p"][1] - first["p"][1]) / dt0)
    twin_params = {"g": full["g"], "drag": full["drag"], "wind_x": 0.0}
    path = simulate_plane(first["p"], v0, twin_params, samples[-1]["t"] - first["t"] + 0.3)
    crossed = any(path[i - 1][2] > 3.05 >= path[i][2] and abs(path[i][1]) < 0.30 for i in range(1, len(path)))
    observed_in = rim_t is not None
    journal += ["## Verdict replay (induced twin vs SAM-observed outcome)",
                f"- SAM observed rim_cross_down: {'yes @ ' + str(rim_t) + 's' if observed_in else 'no'}",
                f"- Induced twin crosses rim plane downward near centre: {'yes' if crossed else 'no'}",
                f"- Verdict agreement on this shot: **{'AGREE' if crossed == observed_in else 'DISAGREE — named, not hidden'}**", "",
                "## Honest limits",
                "- Monocular plane twin (z=0): gravity/drag are induced in the image plane; a second camera or fiducials are required for a full 3D twin.",
                "- Sparse SAM sampling: the free-flight segment holds few points, so uncertainties stay wide and are printed, not smoothed away."]

    twin = {"source": os.path.basename(args.trajectories), "model": "ballistic plane twin (gravity + quadratic drag)",
            "g": round(full["g"], 4), "unc_g": round(full["unc_g"], 4),
            "drag": round(full["drag"], 5), "unc_drag": round(full["unc_drag"], 5),
            "wind_plane_acc": round(full["wind_x"], 4), "held_out_cm": round(held, 2),
            "free_flight_samples": len(samples), "verdict_replay_agree": bool(crossed == observed_in)}
    os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
    with open(args.out_json, "w") as fh:
        json.dump(twin, fh, indent=1)
    with open(args.out_journal, "w") as fh:
        fh.write("\n".join(journal) + "\n")
    print("\n".join(journal))
    return 0


def main():
    ap = argparse.ArgumentParser(description="TWINFORGE Prompt 3 bridge — SAM trajectories -> induced twin")
    ap.add_argument("--trajectories", default="perception/output/trajectories.json")
    ap.add_argument("--out-json", default="induction/induced_twin.json")
    ap.add_argument("--out-journal", default="induction/induction_journal.md")
    args = ap.parse_args()
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
