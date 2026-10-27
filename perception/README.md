# SAM 3.1 perception — video → masks → trajectories (Prompt 2)

Real pipeline, runs on a new video without modification. No true scene
parameter is ever used: this stage measures positions, period.

## Run

```bash
pip install -r perception/requirements.txt
# Meta key in the root .env (META_MODEL_API_KEY=...) or the environment — never committed
python3 perception/sam_perception.py --video perception/test_shot.mp4 --out perception/output
python3 -m unittest discover tests -v   # pure tests (parse / tracking / FP-01 / FP-02 / events / induction)
```

Rights-clean test video (3D scene only, no UI, no third-party footage):

```bash
PYTHONPATH=/tmp/w3d-pw:/tmp/samdeps python3 perception/make_test_video.py
```

## How it works

1. **Sampling**: frames at ~6–10 fps (Prompt 2 target: 5–10 fps on useful segments).
2. **SAM 3.1** (Meta Model API, `POST /v1/responses`, model `sam-3.1`) per text concept,
   with measured prompt fallbacks: `ball`/`basketball`, `basketball hoop`/`hoop`
   (`vertical hoop` alone returns nothing on our scene — logged finding), `backboard`.
   Static concepts sampled 1 frame in 6, the ball on every frame.
3. **Deterministic extraction (zero LLM)**: box centroids (rescaled to the original
   frame), windowed finite-difference velocities, polygons = boxes.
   Encoded masks decode to rasters via `decode_masks.mjs` (@meta-sam/parser, optional).
4. **FP-01 tracking**: association by predicted trajectory (175 px gate at full res),
   re-acquisition after occlusion; FP-01 counted on the main track only.
5. **FP-02**: frames with abnormal area/eccentricity flagged `fp02_outlier` (excluded from fit).
6. **Monocular world**: X scale from the real rim diameter (0.4572 m), Y scale from
   the real backboard height (1.07 m) — perspective makes the two differ.
   Stated limit: no depth in mono; `--fiducials` JSON enables a full homography.
7. **Events**: launch, apex, rim_cross_down, rim occlusion zone.

## Result on the test video (generated 2026-10-27, re-sampled at 10 fps)

- 39 frames sampled over the flight segment, ball found on **90%**, FP-02 outliers **2%**.
- **ID 1 stable across the whole flight segment**, from launch to rim crossing
  (Prompt 2 exit criterion: GO on this shot).
- Events detected: launch, apex @0.5 s, rim_cross_down @1.0 s.
- After the rim (net, bounces, rolling, Monte-Carlo ghosts in frame), the ID
  fragments ([1,3,4,5,6] over the full video): reported as-is, never averaged away.
- Dataset: [output/trajectories.json](output/trajectories.json) · Report: [output/report.md](output/report.md)
