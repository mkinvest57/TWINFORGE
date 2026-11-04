# TWINFORGE — See a scene. Predict its next move.

The main interface now observes changing 3D scenes through images. **Actual Meta SAM 3.1 segmentation is required before a track can produce a forecast.** A separate local tracker follows the segmented objects between SAM responses, and a short-horizon motion model estimates their future image position. The observer receives no simulator positions, velocities, masses, forces, or seed.

[Live observation interface](index.html) · [Camera mode](index.html?mode=camera) · [Architecture and setup](docs/SAM_LIVE_OBSERVATION.md)

## What runs

| Component | Responsibility |
|---|---|
| Randomized 3D renderer | Generates double pendulums, collisions, or launch-and-rebound scenes with new initial conditions. Sends captured JPEGs, a clock, and an opaque run identifier to the observation path. |
| Meta SAM 3.1 | Segments the requested object concept in actual submitted images through the Meta Model API. |
| Local appearance tracker | Tracks up to three simultaneous SAM-initialized objects. Learns dominant color from pixels inside each SAM mask; otherwise uses grayscale normalized cross-correlation (NCC) on the SAM-selected region. |
| Image-motion predictor | Selects a generic motion fit using already-observed past targets and records a target **0.2 seconds ahead by default**, with an optional **0.5-second stress setting**, before the target time is observed. |
| Later visual observations | Assess frozen forecasts in pixels; missing or interrupted tracks remain unscored. |

New scenes reset their masks, tracks, and observation history. Changing the forecast horizon also starts a fresh trial, clears the displayed metrics, and requires a new SAM segmentation; the previous trial remains in export history. Optional automatic regeneration changes the simulated scene every 20 source seconds. Camera mode uses the same observation pipeline and requires camera permission.

The candidate motion models describe straight motion, quadratic curves, turning, and oscillation in image coordinates. Selection tests them against earlier targets that have already been observed; it does not use the scene family or hidden physics. A shorter horizon is an easier forecast task, not evidence of a more accurate model. Results from different horizons, scene families, and source types must be reported separately.

The renderer is 3D; the prediction is **2D image-plane extrapolation**. SAM supplies object masks, not a learned physical simulator. Mass, material, metric depth, unseen collisions, and full 3D motion are not reconstructed. Errors are measured against subsequent visual tracking, not independent physical ground truth. A missed segmentation, lost track, or insufficient motion can leave the interface without a prediction.

## Run locally

Requires Python 3.9+, a current Node.js with npm, a WebGL-capable browser, and a Meta Model API credential authorized to use `sam-3.1`.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci --prefix perception
```

Create `.env` from `.env.example` if it does not already exist. Set `META_MODEL_API_KEY` privately. Keep `TWINFORGE_SCENE_BUDGET_USD=0.50` for the default persistent per-scene ceiling. Then:

```bash
.venv/bin/python server.py
```

Open `http://127.0.0.1:8000/` and press **Start observation**. To use another port, run `PORT=8002 .venv/bin/python server.py` and open that port. The connection check reads `/api/sam/status` without calling the provider. Starting observation sends images to Meta and can consume the configured allowance.

The local service binds to loopback and rejects non-local hosts and cross-origin requests. A phone needs an HTTPS deployment serving both the interface and its protected SAM backend; the local loopback URL is not a phone-accessible deployment. GitHub Pages alone can serve the scene and interface but cannot execute the private model calls. No usable SAM connection means no new SAM-based forecasts.

The [owner-private hosted workspace](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/) has a verified **version 5** live SAM browser capture, recorded in the [deployment proof](validation/runs/sam-live-2026-11-05/private-deployment-v5.json). Its [collision trial](validation/runs/sam-live-2026-11-05/hosted-collisions-020.json) is synthetic; it does not validate a physical phone camera or newer local changes. The next hosted revision remains subject to its own review.

SAM requests are accounted at `$0.0025` per image in the implementation. All randomized runs share the persistent `vision` budget; generating a new scene does not reset it. `TWINFORGE_LIVE_SAM_BUDGET_USD` can allocate a smaller local ceiling, including existing vision spending, without raising the global ceiling or changing historical ledger entries. The browser permits at most 60 submissions per page session, and the backend persists a 60-attempt ceiling per run. Only an explicitly unbilled busy response can be retried on a later frame; provider failures do not trigger paid automatic retries. Stopping does not cancel a provider request that has already begun.

## Inspect the evidence

The interface exports submitted-frame hashes, SAM receipts, image observations, forecasts, and subsequent assessments. The local Python backend privately saves the corresponding input JPEG and raw SAM response under `.twinforge/live-sam/`; the hosted service retains hashes and normalized results instead. Keys and private captures are excluded from static serving and Git. The [live evidence audit](validation/runs/sam-live-2026-11-05/live-evidence-summary.json) keeps each horizon, scene, and implementation cohort separate, including failed or unscorable targets. Offline replays do not replace live-issued results.

```bash
# Software checks; provider tests use mocks, with no paid SAM request
.venv/bin/python -B -m unittest discover -s tests -v
node --test tests/js/*.test.mjs
```

These checks verify software contracts and numerical behavior. They do not establish real-camera accuracy or an accuracy bound for every random scene. See the [architecture document](docs/SAM_LIVE_OBSERVATION.md) for the exact observation, timing, and scoring limits.

## Earlier experiments and their evidence

The [recorded Meta decision benchmark](decision.html) is preserved separately. It uses supplied numerical states and records Muse Spark 1.3 proposals, their failed attempts, and the deterministic comparison. The [known-model physics workbench](legacy-workbench.html?scene=chaos) and [earlier local camera tracker](camera-local.html) are archives; neither is evidence that the new live pipeline has independently learned 3D physics.

- [Original Meta decision responses and receipts](assets/causal-meta-session.json)
- [Decision-engine benchmark](validation/runs/causal-benchmark-2026-11-04.json) and [engine review](validation/runs/causal-engine-review-2026-11-04.json)
- [Earlier English interface software checks](validation/runs/jury-studio-software-checks-2026-11-04.json), [browser review](validation/runs/jury-studio-2026-11-04/browser-review.json), and [publication proof](validation/runs/jury-studio-2026-11-04/public-deployment.json)
- [Previous English README](docs/archive/README_CAUSAL_EN_2026-11-05.md), [original PDF compliance record](docs/PROMPT_COMPLIANCE.md), and [third-party provenance](docs/THIRD_PARTY.md)

The [current submission brief](docs/SUBMISSION.md) describes the live SAM observation path. The existing [English voiceover](docs/VOICEOVER_3MIN_EN.txt) and [storyboard](docs/VIDEO_3MIN_STORYBOARD.json) still describe the earlier decision benchmark. They are historical presentation materials, not validation or a finished video for this live SAM interface.
