# Live SAM observation

This document describes the implemented observation path in the main TWINFORGE interface. It is an architecture and operation record, not a claim of measured live-model accuracy, completed phone testing, or a verified public deployment.

## What SAM does

SAM 3.1 is mandatory for acquiring objects. The backend sends an actual captured JPEG and a short object phrase to Meta's `sam-3.1` model. It decodes the returned masks with `@meta-sam/parser`; a usable object must have a mask, not just a box. The mask supplies an initial centroid, contour, area, and appearance region.

SAM is not being used as a motion-prediction model. A separate local image tracker follows these regions between SAM responses, and the predictor fits their past measured positions. The displayed result is a short forecast in camera-image pixels. There is no fallback that initializes an object from known simulator coordinates when SAM is absent.

The current local tracker learns a dominant hue from captured pixels **inside the returned SAM mask**, never from the renderer's color palette. When that image region has a sufficiently distinct color, it follows a single compatible color component in subsequent images. If no dominant color can be learned at initialization, it instead uses grayscale normalized cross-correlation (NCC) on the SAM-selected region. This is a choice between local tracking methods after mandatory SAM segmentation, not a substitute detector when SAM is unavailable. An ambiguous, missing, or occluded color component loses its track and requires fresh segmentation rather than silently switching identities.

## The pixel boundary

| Stage | Inputs | Outputs |
|---|---|---|
| `web/vision/random-dynamics.mjs` | Private random seed and selected scene family | Hidden simulated state used only by the renderer |
| `web/vision/world.mjs` in `world.html` | Hidden state and rendering camera | 640 × 400 JPEG frames, source time, run identifier; family metadata for the scene label |
| `web/vision/live.mjs` | Rendered frames or camera frames | JPEG-decoded pixels and capture metadata for the observer |
| `web/vision/observer.mjs` | Pixels, JPEG bytes, frame ID, run ID, timestamp, and object phrase | SAM-initialized tracks, issued forecasts, and later assessments |
| `web/vision/sam-tracker.mjs` | Captured pixels and a decoded SAM mask region | Dominant-color tracking where usable; otherwise SAM-initialized grayscale NCC tracking |
| `/api/sam/segment` | Strict image-and-metadata JSON | Decoded SAM detections plus a receipt bound to the exact image |
| `web/camera/prediction.mjs` | Earlier tracked image positions | Baseline sample-quality and chronology checks, plus later target assessment |
| `web/vision/motion.mjs` | Earlier tracked image positions and already-observed past targets | Generic motion-model selection and future pixel target with conditional diagnostics |

The renderer runs in a separate iframe and module scope. Its message interface does not send its random seed, physical parameters, object positions, or velocities to the observer. The observer rejects unknown frame-input fields, and the backend rejects unknown JSON fields. This is an inspectable data-flow boundary, not a browser security sandbox against someone modifying the source or inspecting their own page.

The scene families are a double pendulum, balls with collisions, and launch-and-rebound. A new trial samples different initial conditions and physical parameters from bounded ranges. It does not generate arbitrary unseen categories of physical law. The UI can regenerate a scene manually or every 20 seconds of source time. The simulation timestamp is the renderer's integration clock, not a claim that hidden-tab playback stays synchronized to wall time.

Camera mode uses the same observer. It captures images without audio, rescales the observation image to at most 640 pixels on its longer side, and sends occasional JPEGs to Meta after the user starts. Stop releases the camera stream. The metric remains image pixels, and phone movement can invalidate the extrapolation.

## How a future target is issued

1. A captured image is submitted to SAM. No forecast is available before a usable SAM segmentation.
2. While the response is pending, the observer buffers captured pixels. It retains at most 80 frames and a bounded time window.
3. The returned image hash, dimensions, run ID, frame ID, source timestamp, model name, and receipt are checked against the submission. A response from an old run cannot initialize the new run.
4. The SAM mask initializes local appearance tracking on its own captured frame. Already observed later frames are replayed through that tracker to reach the current capture time. If the required frame has left the buffer, the response cannot start a forecast.
5. Generic image-motion fits use only past measurements. The default target is **0.2 seconds** beyond the current source time; **0.5 seconds** is an optional stress setting. The baseline checks require at least six usable samples across at least 0.18 seconds; stale, interrupted, stationary, or too-uncertain measurements can be refused. Model selection then compares predictions of earlier targets whose observations are already available.
6. Each accepted forecast is frozen with its issue time, target time, input timestamps, and SAM request reference. Backfilled observations are never presented as a forecast issued in the past.
7. Once later tracked positions bracket the target time, the stored target is scored against their interpolated image position. An unavailable bracket, changed track, reset, or interruption produces an unscorable record rather than a made-up error.

By default, segmentation submissions are at least three source seconds apart and only one request is pending in the browser. Local tracking bridges those sparse SAM results; it is labeled separately in the observations. The observer tracks at most three simultaneous objects and invalidates an old SAM anchor after eight source seconds. New SAM responses reinitialize identities, so cross-response object identity is not guaranteed.

The motion candidates are linear, quadratic, turning, and harmonic image trajectories. Each is fitted to earlier image positions. The harmonic candidate learns an oscillation frequency from these measurements; it is not given a pendulum label or mechanical parameters. A candidate needs at least two already-observed target comparisons to enter the selection, and a more flexible model must show a material advantage over the linear candidate on those past targets. This is short-window model selection from pixels, not learning a general physical law. Its past-target score is part of model selection and must not be reported as an independent future-prediction test.

The fit's confidence and uncertainty are diagnostics conditioned on the observed motion. They are not calibrated safety probabilities. In particular, a collision, sudden force, occlusion, crossing objects, or a direction change can make the forecast wrong even when the preceding fit looked smooth. Chaotic pendulum motion has no general long-horizon accuracy guarantee here.

Changing the horizon stops the old observation run and starts a fresh trial with cleared display metrics and a new SAM initialization. An active observation resumes on that new trial; the old one remains in export history. Each issued prediction retains its own horizon, and each run records `horizonS`.

Changing from 0.5 to 0.2 seconds reduces the forecast horizon; it does not retroactively improve any earlier result. Existing 0.5-second reports retain their original metrics and labels. Live results should be grouped by horizon, scene family, source kind, and relevant implementation version, with scored and unscorable counts exposed. Do not combine easier 0.2-second trials with 0.5-second stress trials into a single overall precision claim.

## Provider setup and local operation

Use Python 3.9+, a current Node.js with npm, and a WebGL-capable browser. The Python image dependencies and the mask decoder must be installed:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci --prefix perception
```

If `.env` does not exist, create it from `.env.example`. Configure `META_MODEL_API_KEY` with a credential that has access to `sam-3.1`. Keep credentials in that private file or the process environment. The default persistent spending ceiling is set by `TWINFORGE_SCENE_BUDGET_USD=0.50`.

```bash
.venv/bin/python server.py
```

Open `http://127.0.0.1:8000/` for the randomized simulation or `http://127.0.0.1:8000/index.html?mode=camera` for the camera. An alternate local instance uses `PORT=8002 .venv/bin/python server.py`.

`GET /api/sam/status` checks credential presence, decoder availability, and the remaining persistent allowance. It does not make an inference request and cannot prove that the provider will accept the credential. The interface requires an actual successful segmentation after Start before producing a track.

The supplied Python server listens on `127.0.0.1` and accepts only local, same-origin requests. A phone requires a separately configured HTTPS deployment with a protected same-origin SAM service. Static GitHub Pages alone cannot provide that service. An HTTPS address or a working simulation by itself does not establish that live SAM inference is connected.

The [owner-private hosted workspace](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/) has a retained [version 5 deployment verification](../validation/runs/sam-live-2026-11-05/private-deployment-v5.json) and a [live synthetic collision export](../validation/runs/sam-live-2026-11-05/hosted-collisions-020.json). That evidence establishes the recorded version's live SAM browser path, not public jury access, physical-phone camera validation, or a later release. The next hosted revision remains pending its separate review. The new mask-color tracker described here is a local source change and must not be attributed retroactively to the version 5 capture.

## API contract and bounded usage

`POST /api/sam/segment` accepts exactly these fields:

```json
{
  "image_base64": "<raw JPEG base64>",
  "concept": "ball",
  "frame_id": "frame-1",
  "source_time_s": 0.25,
  "run_id": "11111111-1111-4111-8111-111111111111",
  "source_kind": "synthetic"
}
```

`source_kind` is `synthetic` or `camera`. The image is limited to 400 KiB, with each dimension between 16 and 640 pixels; the JSON body is limited to 560 KiB. EXIF-rotated images must have their pixels rotated before submission. The backend does not silently resize a submitted image. Metadata cannot contain hidden simulation state. A run accepts strictly increasing timestamps and rejects a repeated frame identifier before another paid call.

A successful `twinforge.sam.frame.v1` response contains the exact image hash, dimensions and capture metadata, `model: "sam-3.1"`, decoded detections, a local evidence identifier, provider receipt, latency, accounted cost, and budget summary. Detection coordinates use submitted JPEG pixels. Box upper bounds are exclusive. A successful empty segmentation returns `status: "no_matches"` and an empty detection list. Missing masks or a decoding failure are errors; box-only fallback is disabled.

The implementation accounts for SAM images at $0.0025 each. Every live observation request uses the fixed budget scene `vision`, regardless of the run identifier. The persistent ledger includes reserved in-flight cost, so a scene reset or server restart does not reset the shared allowance. The default $0.50 ceiling permits at most 200 accounted images if that scene has no previous usage. This is the implementation's accounting rule, not an invoice reconciliation.

The optional `TWINFORGE_LIVE_SAM_BUDGET_USD` setting applies a smaller ceiling to the local live endpoint. Its effective limit is the minimum of this value and the global scene limit. Existing vision spending counts toward it, and reservations still use the same atomic append-only ledger. Other model clients retain their normal global limit. Blank uses the global limit; invalid or negative values are rejected.

The local/hosted split allocates **$0.10 total to local live SAM and $0.40 to hosted SAM**, preserving an aggregate $0.50 ceiling. Set the local variable to `0.10` and the hosted `INITIAL_VISION_SPENT_UNITS` to `1000` (units of $0.0001). Here `1000` is a **reserved local allowance**, including existing local spending, not a claim that $0.10 had already been charged when hosting started. The hosted baseline prevents those same dollars from being spent again on the host. This split is valid only while local cumulative vision spending remains within $0.10 and both configurations are enforced. It neither rewrites local history nor adds a fabricated provider charge. The version 5 deployment proof records that allocation; each runtime's persistent ledger remains authoritative for its remaining allowance.

The browser limits each page session to 60 submission attempts, including busy responses. The backend separately persists at most 60 accepted attempts per run, including failed attempts. A process-wide semaphore permits one active SAM operation. If it is busy, the endpoint returns an explicit, unbilled response:

```json
{
  "code": "sam_busy",
  "error": "SAM is processing another frame; wait for it before sending the next",
  "provider_call_made": false,
  "retry_after_s": 1
}
```

Only that HTTP 429 shape allows the observer to try a later captured frame, still respecting its interval and attempt ceiling. Budget exhaustion returns HTTP 429 with `code: "budget_exhausted"` and is not retried. Network, provider, or decoding errors stop the observation path instead of causing automatic paid retries. Aborting the browser request or stopping the scene cannot undo an inference request already executing on the server.

## Evidence and privacy

The frontend JSON export includes SAM request receipts, submitted-image hashes, observations, forecast issue and target times, assessments, and source labels. It keeps at most 12 preceding run records. It does not include camera image bytes or API keys.

The local Python backend saves the exact submitted JPEG and raw response privately under `.twinforge/live-sam/<run_id>/`, bound by the returned evidence identifier. Its audit also retains unsuccessful decoding results. Input and audit files use private file permissions. They are excluded by Git and the server's static-file allowlist; they remain on the operator's machine until removed. The hosted service retains hashes and normalized results rather than original JPEGs or raw provider text, so its receipts do not support replay of the original camera image. Do not describe this as a pipeline where all camera pixels remain on the device: submitted images go to the configured Meta service.

The request receipt and SHA-256 hashes provide traceability within the application's records. They are not a provider-signed attestation or proof that the visual track is correct. The assessment's `independentPhysicalGroundTruth` flag is false: a forecast and its later reference position share the image-tracking pipeline.

## Verification scope and archives

Software checks can run without a paid provider request:

```bash
.venv/bin/python -B -m unittest discover -s tests -v
node --test tests/js/*.test.mjs
```

Relevant checks cover strict frame inputs, request/image binding, decoded-mask requirements, run quotas, budget persistence, concurrency, origin guards, observer reset races, forecast chronology, and unscorable targets. Provider tests use mocked transport. They do not measure actual SAM latency or accuracy, camera behavior on a physical phone, or scene-wide forecast accuracy. Those claims require separately retained live-run evidence and a stated evaluation method.

The [live evidence audit](../validation/runs/sam-live-2026-11-05/live-evidence-summary.json) deduplicates exported run snapshots, verifies forecast chronology and score arithmetic, and retains each actual run's original measurements. Local receipts are matched against private completed responses, exact input images, request hashes, and ledger entries. Hosted version 5 receipts have a different verification basis: the production-browser export and deployment record, with `serverReceiptVerifiedLocally: false`. Offline model replays remain separate from fresh live inference; an offline error reduction does not replace the recorded live error, including the mask-color pendulum trial. The [short-window development replay](../validation/runs/sam-live-2026-11-05/short-window-replay.json) explicitly records that multiple window choices were compared on retained observations; it is not an independent new live benchmark.

The former [decision interface](../decision.html), [known-model workbench](../legacy-workbench.html?scene=chaos), and [local camera tracker](../camera-local.html) remain available as earlier experiments. Their numerical results, model calls, publication proofs, and presentation materials retain their original scope. The [previous README](archive/README_CAUSAL_EN_2026-11-05.md) records that release; it is not validation of this observation path.
