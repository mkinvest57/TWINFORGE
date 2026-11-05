# TWINFORGE — The next frame is the test.

The main interface observes changing 3D scenes, a phone camera, or a local video through images. **Actual Meta SAM 3.1 segmentation is required before a track can produce a forecast.** A separate local tracker follows the segmented objects between SAM responses, and a motion model estimates their image position 0.5–1 second ahead. The observer receives no simulator positions, velocities, masses, forces, or seed.

[Live observation interface](index.html) · [Camera mode](index.html?mode=camera) · [Architecture and setup](docs/SAM_LIVE_OBSERVATION.md)

## The live challenge

Open the [connected workspace](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/), then **Start experiment → Lock a prediction → Reveal the outcome**. The synthetic world waits for its first real SAM mask, pauses with a recorded future target, and resumes until later tracked pixels can test that target. **Change the motion** applies a new private random impulse; only its rendered effect reaches the observer. A phone camera keeps running and records the outcome automatically.

In **Camera**, start a local preview, then tap an object, drag a box around it, choose **Hands**, or name an object type. Starting the preview alone sends no image to SAM. Taps and boxes use native SAM spatial prompts bound to the exact selected frame. **Hands** requests visible hands and follows each tracked hand's overall movement; it does not predict finger joints or future intentions. **Open video** uses the same selection workflow with a local clip. The initial video frame waits for selection and SAM confirmation before playback.

The dark English interface uses native adaptations of inspected 21st.dev temporal, usage, toolbar and dialog patterns. Settings and connection details are separate from the experiment. The static GitHub Pages address links to the connected workspace because it cannot run the private model API.

The November 5 reliability update fixes a disconnected SAM request that could hold the shared service busy for 180 seconds. Paid requests now finish durably; the provider deadline is 15 seconds and a stale lease expires after 30 seconds. A scene reset discards old responses without aborting the underlying paid request. Uniquely matched SAM confirmations preserve visual identity and motion history.

Earlier November 5 live evidence is in [the studio validation folder](validation/runs/studio-2026-11-05/). It retains successful locked targets **and** the flight-tracking failure that led to the color/search correction. Those captures precede the current camera-selection and long-horizon update. Do not turn a single good target into a general accuracy claim.

## What runs

| Component | Responsibility |
|---|---|
| Randomized 3D renderer | Generates double pendulums, collisions, or launch-and-rebound scenes with new initial conditions. Sends captured JPEGs, a clock, and an opaque run identifier to the observation path. |
| Meta SAM 3.1 | Segments the requested object using an object concept or native point/box prompt in the submitted image through the Meta Model API. |
| Local visual tracker | Tracks up to three simultaneous SAM-initialized objects. Camera/video tracking first uses sparse feature flow inside the SAM region; if initialization lacks usable features, it selects the appearance tracker. Synthetic scenes retain mask-learned color tracking or grayscale NCC. |
| Image-motion predictor | Selects a motion fit using already-observed past targets and records a future trajectory at **0.5 seconds by default**, with **0.75 and 1 second** available. The target is fixed before it is observed. |
| Later visual observations | Assess frozen forecasts in pixels; missing or interrupted tracks remain unscored. |

New scenes and new object selections reset their masks, tracks, and observation history. Changing the forecast horizon preserves the SAM initialization and motion history; new forecasts use the selected horizon, while older targets remain unchanged. Displayed scores are filtered to the selected horizon, and exports retain every horizon cohort. Optional automatic regeneration changes the simulated scene every 20 source seconds. Camera mode requires camera permission. Camera/video tracking uses captured pixels directly and encodes JPEG only when a SAM request is submitted, avoiding a codec round trip on every local tracking frame.

The candidate motion models describe robustly smoothed velocity, acceleration, damped acceleration, turning, oscillation, and contact boundaries inferred from earlier visible reversals. Selection tests them against earlier targets that have already been observed; it does not use the scene family or hidden physics. The displayed uncertainty grows along the future trajectory but is not a calibrated probability. A shorter horizon is an easier forecast task, not evidence of a more accurate model. Results from different horizons, scene families, and source types must be reported separately.

The renderer is 3D; the prediction is **2D image-plane extrapolation**. SAM supplies object masks, not a learned physical simulator. Mass, material, metric depth, unseen collisions, and full 3D motion are not reconstructed. Errors are measured against subsequent visual tracking, not independent physical ground truth. A missed segmentation, lost track, or insufficient observation history can leave the interface without a prediction. A tracked stationary object has an explicit stationary forecast. Camera forecasting is not model predictive control: no actuator or control objective is supplied.

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

Open `http://127.0.0.1:8000/` and press **Start experiment**. To use another port, run `PORT=8002 .venv/bin/python server.py` and open that port. The connection check reads `/api/sam/status` without calling the provider. Starting a synthetic experiment, or selecting an object in camera/video mode, sends images to Meta and can consume the configured allowance. Camera preview alone does not submit an image.

The local service binds to loopback and rejects non-local hosts and cross-origin requests. A phone needs an HTTPS deployment serving both the interface and its protected SAM backend; the local loopback URL is not a phone-accessible deployment. GitHub Pages alone can serve the scene and interface but cannot execute the private model calls. No usable SAM connection means no new SAM-based forecasts.

The [owner-private hosted workspace](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/) uses the owner-authorized uncapped Twinforge configuration. The [new live results](validation/runs/camera-horizon-2026-11-05/live-results.json) retain actual SAM point/box selection, two-hand segmentation and forecasts on uploaded video. They include a recording of real hand movement, but do not establish physical-phone camera operation or accuracy. The [version 6 deployment proof](validation/runs/sam-live-2026-11-05/private-deployment-v6.json), [browser review](validation/runs/sam-live-2026-11-05/browser-review.json), and older trials below describe that earlier release. The workspace remains private to the owner.

SAM requests are accounted at `$0.0025` per image in the implementation. The current hosted setting, `TOTAL_VISION_BUDGET_UNITS=unlimited`, removes Twinforge's shared spending ceiling, per-run request ceiling and browser-session request ceiling. Request and spending records remain persistent across new scenes and server restarts. Meta account credit and provider limits still apply; this application does not retrieve or display the actual Meta account balance.

Local development and finite test profiles retain their configured limits: `TWINFORGE_LIVE_SAM_BUDGET_USD` can allocate a smaller local ceiling, and finite profiles retain the 60-request run/session limits. Only an explicitly unbilled busy response can be retried on a later frame; provider failures do not trigger paid automatic retries. One request runs at a time, submission spacing remains enforced, and stopping does not cancel a provider request that has already begun.

## Inspect the evidence

The interface exports submitted-frame hashes, SAM receipts, image observations, forecasts, and subsequent assessments. The local Python backend privately saves the corresponding input JPEG and raw SAM response under `.twinforge/live-sam/`; the hosted service retains hashes and normalized results instead. Keys and private captures are excluded from static serving and Git. The [live evidence audit](validation/runs/sam-live-2026-11-05/live-evidence-summary.json) keeps each horizon, scene, and implementation cohort separate, including failed or unscorable targets. Offline replays do not replace live-issued results.

```bash
# Software checks; provider tests use mocks, with no paid SAM request
.venv/bin/python -B -m unittest discover -s tests -v
node --test tests/js/*.test.mjs
```

These checks verify software contracts and numerical behavior. They do not establish real-camera accuracy or an accuracy bound for every random scene. See the [architecture document](docs/SAM_LIVE_OBSERVATION.md) for the exact observation, timing, and scoring limits.

The current [software verification](validation/runs/camera-horizon-2026-11-05/verification.json) reports **358 passing tests: 207 JavaScript, 132 Python and 19 hosted-worker tests**. These automated tests use mocked transport; actual provider trials are reported separately. Slow-device regressions cover finite SAM catch-up and preservation of a fresher live tracker.

The [recorded software check](validation/runs/sam-live-2026-11-05/software-checks.json) reports **280 passing tests: 145 JavaScript, 128 Python, and 7 hosted-worker tests**, with no provider calls during those tests.

The November 5 [actual-SAM video trials](validation/runs/camera-horizon-2026-11-05/live-results.json) recorded these results. Errors compare a frozen future target with **later tracker pixels**, not independent annotations. Photo-motion clips transform real photographs synthetically; the last two trials instead use a recording of an actual moving hand. Each row is a separate run.

| Uploaded source | Horizon | Scored / unscorable | Mean error |
| --- | ---: | ---: | ---: |
| Bottle photo, native point selection | 0.5 s | 60 / 4 | 3.52 px |
| Bottle photo, native box selection | 1 s | 55 / 8 | 10.17 px |
| Two-hand photo, v14 retest | 1 s | 114 / 18 | 8.52 px |
| Recorded real hand movement, v14 | 0.5 s | 61 / 5 | 20.27 px |
| Recorded real hand movement, v14 | 1 s | 54 / 9 | 40.90 px |
| Recorded real hand movement, final v16 | 1 s | 57 / 8 | 34.10 px |

The v14 hand trials maintained tracking at approximately 25 captured frames/s. SAM ran separately: retained calls took 0.53–2.01 s at the provider and 1.06–2.82 s round trip. A locked real-hand target from 4.0038 to 4.5038 seconds scored **29.39 px** error. The v14 1-second run also retains a late lock beyond the clip's end as unscorable; the UI now prevents that video-end lock. Longer human-motion forecasts remain substantially less precise: the v14 real-hand 1-second maximum error was 140.40 px.

The final **v16** smoke test retained continuous tracking at 25.12 captured frames/s and two successful SAM responses from three submitted requests. Provider times were 1.46 and 1.00 s; client round trips were 5.43 and 1.38 s. Its 1-second maximum forecast error was 129.41 px. Different capture and SAM timing make this a separate cohort, not evidence that the prediction model improved over v14.

Two earlier hand failures remain in the report. Their initial submitted image was entirely black, verified against its saved hash. Later failures involved a 518 ms capture gap and an expired SAM-frame buffer. The v14 retest follows fixes for first-frame presentation, buffered-frame retention, complete mask outlines and yielding during catch-up tracking. The successful retest does not erase those failures or turn these few clips into a general accuracy guarantee.

The new [long-horizon report](validation/runs/long-horizon-camera-2026-11-05.json) is an **offline comparison**, reproduced by `node validation/replay_long_horizon.mjs`. It includes 0.5-, 0.75-, and 1-second targets, fixed synthetic variations, and saved visual-observation replays, with all attempts, refusals, coverage, paired errors, and regressions retained. Stable motion and several collision/flight comparisons improve; irregular gestures and the short pendulum export still expose failures. These results do not establish physical-camera accuracy, universal prediction, or fresh SAM success. See [the method and limitations](docs/long-horizon-forecasting.md).

The two historical November 5 version 6 live captures remain separate cohorts at their original **0.2-second horizon**. Both observe synthetic scenes at 480 × 300 pixels; error is against later visual tracking, not independent physical measurements.

| Actual v6 trial | Horizon | Scored / unscorable targets | Mean tracked error | SAM calls |
|---|---:|---:|---:|---:|
| [Launch and rebound](validation/runs/sam-live-2026-11-05/hosted-final-flight-020.json) | 0.2 s | 242 / 21 | 8.004 px | 8 |
| [Double pendulum](validation/runs/sam-live-2026-11-05/hosted-final-pendulum-020.json) | 0.2 s | 166 / 16 | 14.142 px | 5 |

These are two recorded trials, not a pooled accuracy claim. Earlier trials with larger errors, different trackers, or different horizons remain in the [audit](validation/runs/sam-live-2026-11-05/live-evidence-summary.json). Offline development replays remain labeled separately and do not replace any original live result. No physical-phone camera test is claimed.

## Earlier experiments and their evidence

The [recorded Meta decision benchmark](decision.html) is preserved separately. It uses supplied numerical states and records Muse Spark 1.3 proposals, their failed attempts, and the deterministic comparison. The [known-model physics workbench](legacy-workbench.html?scene=chaos) and [earlier local camera tracker](camera-local.html) are archives; neither is evidence that the new live pipeline has independently learned 3D physics.

- [Original Meta decision responses and receipts](assets/causal-meta-session.json)
- [Decision-engine benchmark](validation/runs/causal-benchmark-2026-11-04.json) and [engine review](validation/runs/causal-engine-review-2026-11-04.json)
- [Earlier English interface software checks](validation/runs/jury-studio-software-checks-2026-11-04.json), [browser review](validation/runs/jury-studio-2026-11-04/browser-review.json), and [publication proof](validation/runs/jury-studio-2026-11-04/public-deployment.json)
- [Previous English README](docs/archive/README_CAUSAL_EN_2026-11-05.md), [original PDF compliance record](docs/PROMPT_COMPLIANCE.md), and [third-party provenance](docs/THIRD_PARTY.md)

The [current submission brief](docs/SUBMISSION.md) describes the live SAM observation path. The existing [English voiceover](docs/VOICEOVER_3MIN_EN.txt) and [storyboard](docs/VIDEO_3MIN_STORYBOARD.json) still describe the earlier decision benchmark. They are historical presentation materials, not validation or a finished video for this live SAM interface.
