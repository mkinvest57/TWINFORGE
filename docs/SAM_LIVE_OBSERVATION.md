# Live SAM observation

This document describes the current observation path and links retained live evidence. The owner has authorized removal of Twinforge's hosted spending and request ceilings. Actual SAM trials now cover point/box selection on a bottle-photo clip, two-hand photo motion, and uploaded footage of a real moving hand. Their results and preceding failures are retained separately. They do not establish public jury access, physical-phone camera validation or a general prediction-accuracy guarantee.

## What SAM does

SAM 3.1 is mandatory for acquiring objects. The backend sends an actual captured JPEG and either a short object phrase or a native point/box prompt to Meta's `sam-3.1` model. It decodes the returned masks with `@meta-sam/parser`; a usable object must have a mask, not just a box. The mask supplies an initial centroid, contour, area, and tracking region.

SAM is not being used as a motion-prediction model. A separate local image tracker follows these regions between SAM responses, and the predictor fits their past measured positions. The displayed result is a short forecast in camera-image pixels. There is no fallback that initializes an object from known simulator coordinates when SAM is absent.

Camera and local-video sources first initialize sparse feature flow inside the SAM region, allowing measured feature motion to follow translation and scale changes. If initialization lacks usable features, the tracker selects the appearance method instead. That method learns dominant hue from captured pixels **inside the returned SAM mask**, never from the renderer's palette; otherwise it uses grayscale normalized cross-correlation (NCC). Synthetic scenes retain this appearance method. The method is selected at initialization and does not silently switch after identity is lost. These are local trackers after mandatory SAM segmentation, not alternative object detectors when SAM is unavailable.

Camera preview is local until an object is selected. A tap or dragged box is bound to the exact captured selection frame and sent as a native spatial prompt. The returned receipt must match that selection, and a point-selected mask must contain the point. Later SAM refreshes use the currently tracked box rather than the original stale tap coordinates; a lost spatially selected object requires a new selection. **Hands** uses the concept `hand`; **Name object** accepts an object phrase. Hands are followed by their overall tracked image position, not by finger-joint forecasts. Choosing **Hands** or submitting an object name requests segmentation; merely starting the default camera preview does not.

## The pixel boundary

| Stage | Inputs | Outputs |
|---|---|---|
| `web/vision/random-dynamics.mjs` | Private random seed and selected scene family | Hidden simulated state used only by the renderer |
| `web/vision/world.mjs` in `world.html` | Hidden state and rendering camera | 640 × 400 JPEG frames, source time, run identifier; family metadata for the scene label |
| `web/vision/live.mjs` | Rendered, camera, or local-video frames | Captured pixels and metadata; camera/video JPEG is encoded only for SAM submissions |
| `web/vision/observer.mjs` | Pixels, frame ID, run ID, timestamp, object phrase, optional spatial selection, and a JPEG encoder | SAM-initialized tracks, issued forecasts, and later assessments |
| `web/vision/sam-tracker.mjs` | Captured pixels and a decoded SAM mask region | Camera/video feature flow, with appearance initialization fallback; synthetic mask-learned color or NCC tracking |
| `/api/sam/segment` | Strict image-and-metadata JSON | Decoded SAM detections plus a receipt bound to the exact image |
| `web/camera/prediction.mjs` | Earlier tracked image positions | Baseline sample-quality and chronology checks, plus later target assessment |
| `web/vision/motion.mjs` | Earlier tracked image positions and already-observed past targets | Generic motion-model selection and future pixel target with conditional diagnostics |

The renderer runs in a separate iframe and module scope. Its message interface does not send its random seed, physical parameters, object positions, or velocities to the observer. The observer rejects unknown frame-input fields, and the backend rejects unknown JSON fields. This is an inspectable data-flow boundary, not a browser security sandbox against someone modifying the source or inspecting their own page.

The scene families are a double pendulum, balls with collisions, and launch-and-rebound. A new trial samples different initial conditions and physical parameters from bounded ranges. It does not generate arbitrary unseen categories of physical law. The UI can regenerate a scene manually or every 20 seconds of source time. The simulation timestamp is the renderer's integration clock, not a claim that hidden-tab playback stays synchronized to wall time.

Camera and local-video modes use the same observer. The current interface rescales captured images to at most 480 pixels on their longer side. Camera capture does not request audio. Preview alone sends nothing to SAM; a tap, box, **Hands**, or named-object selection begins submission. Local tracking reads captured pixels directly. JPEG encoding and decoding occur only for a submitted SAM frame, preserving exact submitted-image binding without a codec round trip on every tracking frame. Buffered raw observations are not rewritten by that encoding. A local video stays on the device, with selected frames sent to Meta; the interface waits for its first presented frame before capture, then waits for selection and SAM confirmation before normal playback. Stop releases the camera stream or pauses the clip. The metric remains image pixels, and camera movement can invalidate the extrapolation.

## How a future target is issued

1. A captured image is submitted to SAM. No forecast is available before a usable SAM segmentation.
2. While the response is pending, the observer buffers captured pixels. It retains at most 80 frames over a bounded time window, thinning redundant frames while preserving endpoints and the pending SAM anchor instead of simply keeping the latest 80 captures.
3. The returned image hash, dimensions, run ID, frame ID, source timestamp, model name, and receipt are checked against the submission. A response from an old run cannot initialize the new run.
4. The SAM mask initializes local visual tracking on its own captured frame. The whole outline is preserved when reducing contour vertices. Already observed later frames are replayed through the tracker in yielding batches so capture can continue. If the required frame has expired from the buffer, the response cannot start a forecast.
5. Image-motion fits use only past measurements. The default target is **0.5 seconds** beyond the current source time; **0.75 and 1 second** are available. Checks require at least six usable samples across at least 0.18 seconds; stale, interrupted, or insufficient observations are refused. A stationary tracked object has an explicit stationary forecast. Long-horizon uncertainty is exposed rather than hiding an otherwise valid track merely because its future is uncertain. Model selection compares predictions of earlier targets whose observations are already available.
6. Each accepted forecast is frozen with its issue time, target time, input timestamps, and SAM request reference. Backfilled observations are never presented as a forecast issued in the past.
7. Once later tracked positions bracket the target time, the stored target is scored against their interpolated image position. An unavailable bracket, changed track, reset, or interruption produces an unscorable record rather than a made-up error.

By default, segmentation submissions are at least three source seconds apart and only one request is pending in the browser. Local tracking bridges those sparse SAM results; it is labeled separately in the observations. The observer tracks at most three simultaneous objects and invalidates an old SAM anchor after eight source seconds. A new SAM mask is reconciled conservatively with past visual tracks. A unique pixel-space match keeps its identity, history and already-issued targets; ambiguous matches create a new track. This is not a guarantee of identity.

Long-horizon candidates use robustly fitted velocity at several time scales, acceleration, damped acceleration, turning, harmonic motion, and contact boundaries inferred from earlier visible reversals. The harmonic candidate learns frequency from measured positions, without a pendulum label. Contact candidates receive no scene geometry and cannot know the first unseen impact. Candidates with at least two already-observed target comparisons receive a validation score; before that, the predictor uses a velocity estimate marked as learning. More flexible candidates must show a material advantage, and short past-target checks help adapt to a new direction. The older sub-0.5-second implementation remains available internally for historical checks, but is not an offered UI horizon. These fits do not learn a general physical law. Their past-target scores are selection inputs, not independent future-prediction evidence.

The result includes future positions at 0.25-second intervals through the selected target and a nondecreasing empirical uncertainty radius. Noise, past-target errors and model disagreement contribute to the envelope. Confidence and uncertainty are diagnostics conditioned on observed motion, not calibrated probabilities or guaranteed bounds. A new human intention, collision, force, occlusion, crossing object or direction change can invalidate the forecast. Neither arbitrary hand movement nor chaotic pendulum motion has a general long-horizon accuracy guarantee here. This camera path is forecasting, not model predictive control: it supplies no actuator or control objective.

Changing the horizon preserves the run, SAM initialization, visual identity and motion history. It does not issue an extra SAM request. New forecasts use the chosen horizon; already-issued targets retain their original values and continue to be assessed. Displayed counts and errors include only the selected horizon cohort. Exports retain all forecasts, `selectedHorizonS`, `horizonsUsed`, and `horizonChanges`; mixed-horizon runs have `mixedHorizon: true` and `horizonS: null` rather than being assigned one misleading horizon.

Historical 0.2-second and 0.5-second reports retain their original metrics and labels. A shorter horizon is an easier task and does not retroactively improve an earlier result. Live results must remain grouped by horizon, scene family, source kind and implementation version, with scored and unscorable counts exposed. Do not combine historical 0.2-second trials with current longer targets into one overall precision claim.

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

`GET /api/sam/status` checks credential presence, decoder availability, and the configured Twinforge accounting mode. A finite profile reports its remaining local allowance; the current uncapped host reports `budget.unlimited: true` with null spending/request limits and null remaining-allowance fields. The endpoint does not retrieve the Meta account balance, make an inference request, or prove that the provider will accept the credential. The interface requires successful segmentation after a synthetic experiment starts, or after camera/video selection, before producing a track.

The supplied Python server listens on `127.0.0.1` and accepts only local, same-origin requests. A phone requires a separately configured HTTPS deployment with a protected same-origin SAM service. Static GitHub Pages alone cannot provide that service. An HTTPS address or a working simulation by itself does not establish that live SAM inference is connected.

The [owner-private hosted workspace](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/) uses `TOTAL_VISION_BUDGET_UNITS=unlimited` following the owner's authorization. The [new actual-SAM video results](../validation/runs/camera-horizon-2026-11-05/live-results.json) include verified spatial-selection receipts and the v14 hand retests. They do not establish physical-phone camera accuracy. Retained [version 6 deployment verification](../validation/runs/sam-live-2026-11-05/private-deployment-v6.json), [live launch/rebound export](../validation/runs/sam-live-2026-11-05/hosted-final-flight-020.json), [live pendulum export](../validation/runs/sam-live-2026-11-05/hosted-final-pendulum-020.json), and [browser review](../validation/runs/sam-live-2026-11-05/browser-review.json) describe that earlier release. The [version 5 proof](../validation/runs/sam-live-2026-11-05/private-deployment-v5.json) and collision capture also remain historical; current changes are not attributed retroactively to any of them.

## API contract and usage accounting

`POST /api/sam/segment` accepts the six required fields below plus the optional `selection` field:

```json
{
  "image_base64": "<raw JPEG base64>",
  "concept": "ball",
  "frame_id": "frame-1",
  "source_time_s": 0.25,
  "run_id": "11111111-1111-4111-8111-111111111111",
  "source_kind": "camera",
  "selection": {"type": "point", "x": 120, "y": 80}
}
```

`source_kind` is `synthetic`, `camera`, or `video`. Omit `selection` for an object phrase. A spatial selection is either `{"type":"point","x":120,"y":80}` or `{"type":"box","x":80,"y":40,"width":90,"height":160}`. Coordinates must be integers inside the exact submitted image, not CSS pixels. The backend converts them to SAM's native point/box prompt grammar; the response echoes the selection and prompt kind for verification. The image is limited to 400 KiB, with each dimension between 16 and 640 pixels; the JSON body is limited to 560 KiB. EXIF-rotated images must have their pixels rotated before submission. The backend does not silently resize a submitted image. Metadata cannot contain hidden simulation state. A run accepts strictly increasing timestamps and rejects a repeated frame identifier before another paid call.

A successful `twinforge.sam.frame.v1` response contains the exact image hash, dimensions and capture metadata, `model: "sam-3.1"`, decoded detections, a local evidence identifier, provider receipt, latency, accounted cost, and budget summary. Detection coordinates use submitted JPEG pixels. Box upper bounds are exclusive. A successful empty segmentation returns `status: "no_matches"` and an empty detection list. Missing masks or a decoding failure are errors; box-only fallback is disabled.

The implementation accounts for SAM images at $0.0025 each. Every live observation request uses the fixed accounting scene `vision`, regardless of the run identifier. Its persistent records include reserved in-flight cost; changing the scene or restarting the server does not erase them. These records are application accounting, not invoice reconciliation or a live Meta account balance.

The current hosted value `TOTAL_VISION_BUDGET_UNITS=unlimited` disables Twinforge's shared spending ceiling and per-run request ceiling. The browser reads `budget.unlimited: true` from status and disables its session request ceiling as well. Spending, request counts, duplicate-frame checks, increasing timestamps, submission spacing and single-request concurrency remain in place. Meta account credit, rate limits and other provider-side restrictions still apply. The application does not infer an infinite Meta balance from this setting; allowance fields are null rather than a fabricated remaining credit.

Local development and finite test profiles retain their limits. The default finite $0.50 scene ceiling permits at most 200 accounted images with no prior usage. The optional `TWINFORGE_LIVE_SAM_BUDGET_USD` setting applies a smaller ceiling to the local Python live endpoint. Its effective limit is the minimum of this value and the global scene limit. Existing vision spending counts toward it, and reservations still use the same atomic append-only ledger. Other model clients retain their normal global limit. Blank uses the global limit; invalid or negative values are rejected. The hosted uncapped setting does not silently change these local or offline profiles.

The historical version 6 finite profile split an aggregate $0.50 ceiling into **$0.10 for local live SAM and $0.40 for hosted SAM**, using local `TWINFORGE_LIVE_SAM_BUDGET_USD=0.10` and hosted `INITIAL_VISION_SPENT_UNITS=1000` (units of $0.0001). That initial value is a **reserved local allowance**, including prior local spending, not necessarily money already charged. The historical split and all ledger entries remain intact for audit; the current hosted configuration no longer enforces that aggregate ceiling. Its recorded total still includes the reserved/prior baseline, so it must not be described as either exact Meta charges or remaining Meta credit.

Finite profiles limit browser sessions to 60 potentially billed submissions and persist a 60-attempt per-run ceiling, including failed accepted attempts. Explicit pre-provider busy refusals do not consume that quota; HTTP attempts are counted separately. These run/session ceilings are disabled on the current uncapped host. A concurrency guard still permits one active SAM operation. If it is busy, the endpoint returns an explicit, unbilled response:

```json
{
  "code": "sam_busy",
  "error": "SAM is processing another frame; wait for it before sending the next",
  "provider_call_made": false,
  "retry_after_s": 1
}
```

Only that HTTP 429 shape allows the observer to try a later captured frame, still respecting its interval and any finite-profile attempt ceiling. Finite-profile budget exhaustion returns HTTP 429 with `code: "budget_exhausted"` and is not retried. Network, provider, or decoding errors stop the observation path instead of causing automatic paid retries. Aborting the browser request or stopping the scene cannot undo an inference request already executing on the server.

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

The current [software verification](../validation/runs/camera-horizon-2026-11-05/verification.json) reports **358 passing tests: 207 JavaScript, 132 Python and 19 hosted-worker tests**. These automated tests use mocked transport; actual provider trials are reported separately. Slow-device regressions cover finite SAM catch-up and preservation of a fresher live tracker.

The [retained software check](../validation/runs/sam-live-2026-11-05/software-checks.json) records **280 passing tests: 145 JavaScript, 128 Python, and 7 hosted-worker tests**, with zero provider calls during the tests.

The [November 5 actual-SAM video report](../validation/runs/camera-horizon-2026-11-05/live-results.json) keeps each source, horizon and release separate. The bottle-photo point-selection run scored 60 targets at 0.5 s with mean error 3.52 px; the box-selection run scored 55 at 1 s with mean 10.17 px. After the capture/buffering fixes, the two-hand photo v14 run scored 114 targets at 1 s with mean 8.52 px. These photo clips have controlled synthetic motion, despite their photographic appearance.

The separate **recording of actual hand movement** scored 61 targets at 0.5 s with mean error **20.27 px**, and 54 at 1 s with mean **40.90 px**. The latter maximum was 140.40 px, so this is not evidence of reliable arbitrary human-motion prediction. Both runs used 413 × 480 observations and retained three real SAM responses. Their local capture rate was approximately 25 Hz, while SAM provider latency ranged from 532 to 1023 ms and round-trip latency from 1056 to 2181 ms. Across all three v14 hand trials, the maximums were 2014 ms provider time and 2817 ms round trip. All errors use subsequent tracker positions, not independent annotations; these were uploaded-video trials, not live phone-camera tests.

The final **v16** smoke test of that recording is retained as an additional cohort: 65 one-second forecasts, 57 scored and 8 unscorable at the clip end, with mean error **34.10 px** and maximum **129.41 px**. All 201 observations remained tracked at 25.12 captured frames/s. Two SAM responses were retained from three submitted requests; provider times were 1456/1004 ms and client round trips 5427/1381 ms. The third submission is not reported as a confirmed success. Different capture and SAM timing prevent treating the changed mean as evidence of model improvement over v14.

The real-hand 0.5-second locked target from 4.0038 to 4.5038 seconds was scored at **29.3902 px** error. The 1-second run's lock at 7.6918 targeted 8.6918, after its approximately 8-second clip ended, and remains unscorable. Its nine unscorable forecasts and the 0.5-second run's five are retained. A later UI correction disables locking when insufficient video duration remains; it does not rewrite these results.

The two earlier hands-photo failures are also retained. Their initial submitted JPEG hashes match an entirely black captured image, so the zero-object SAM responses were correct for those inputs. Subsequent failures came from a 518.3 ms capture gap and a 4.1602-second delayed response whose anchor had left the old buffer. First-frame presentation, buffered-frame retention, complete mask outlines and yielding catch-up batches were fixed before the successful v14 retest. See the [forecast method and detailed limits](long-horizon-forecasting.md) for the complete result table and timing distinctions.

The current [long-horizon offline comparison](../validation/runs/long-horizon-camera-2026-11-05.json), regenerated by `node validation/replay_long_horizon.mjs`, evaluates 0.5, 0.75 and 1 second. It includes fixed synthetic parameter variations written after the predictor and saved visual-observation exports used during development. Every forecast receives only its observed prefix. All scheduled attempts, refusals, scoring coverage, paired errors, regressions and empirical envelope containment are retained. For example, paired flight replay error at 1 second decreases from 143.38 to 87.56 pixels, while the mean over all newly forecast flight targets is 96.43 pixels; these are different cohorts. Irregular gesture comparisons and the short pendulum export still show failures. This is neither new live SAM inference nor a physical-camera benchmark. The [forecasting method and limits](long-horizon-forecasting.md) describe the old-code baseline, hashes, coverage and uncalibrated uncertainty.

The [live evidence audit](../validation/runs/sam-live-2026-11-05/live-evidence-summary.json) deduplicates exported run snapshots, verifies forecast chronology and score arithmetic, and retains each actual run's original measurements. Local receipts are matched against private completed responses, exact input images, request hashes, and ledger entries. Hosted version 5 and 6 receipts have a different verification basis: the production-browser exports and their corresponding deployment records, with `serverReceiptVerifiedLocally: false`. Offline model replays remain separate from fresh live inference; an offline error reduction does not replace the recorded live error, including the mask-color pendulum trial. The [short-window development replay](../validation/runs/sam-live-2026-11-05/short-window-replay.json) explicitly records that multiple window choices were compared on retained observations; it is not an independent new live benchmark.

The historical November 5 version 6 launch/rebound trial used eight SAM calls and scored 242 targets at its original 0.2-second horizon, with 21 unscorable targets and mean tracked error 8.004 pixels. Its separate pendulum trial used five calls and scored 166 targets at the same horizon, with 16 unscorable targets and mean tracked error 14.142 pixels. Both use 480 × 300 synthetic observations. These two runs do not establish current long-horizon performance or performance across arbitrary scenes, and their errors are not pooled. Earlier larger errors remain visible in their own cohorts. The exported empty reset run and repeated flight history are retained or deduplicated explicitly rather than counted as additional successes.

The former [decision interface](../decision.html), [known-model workbench](../legacy-workbench.html?scene=chaos), and [local camera tracker](../camera-local.html) remain available as earlier experiments. Their numerical results, model calls, publication proofs, and presentation materials retain their original scope. The [previous README](archive/README_CAUSAL_EN_2026-11-05.md) records that release; it is not validation of this observation path.

## Locked targets and reliability update — November 5

The first synthetic image is captured while the world is paused. An accepted SAM result starts source time. `retryPendingFrame()` can resubmit that still image after an explicitly unbilled busy response; it cannot replay an accepted or billed request.

`lockPrediction()` selects an on-time forecast before any future observation exists, stores its source/target times and point, and exposes a ticket. The UI pauses synthetic time until Reveal. A later tracked bracket determines the outcome without moving the target. The displayed actual position may be interpolated between frames; the adjacent captured image is illustrative, not an exact independent sensor reading. Camera time cannot be paused, so camera tickets reveal automatically.

A Stop/Reset no longer aborts an already-dispatched paid request. The browser retains the pending slot, discards obsolete responses by epoch, then permits a new request. The hosted Worker retains the same task with `waitUntil` through durable settlement. Its provider deadline is 15 seconds; a stale requesting lease expires after 30 seconds without refunding its accounted cost. Readiness distinguishes temporarily busy from unavailable. Opening a synthetic-mode dialog pauses capture and resumes appropriately; camera details stop the stream. Hiding the page stops observation with a visible reason.

The tracker learns brightness and chroma thresholds from SAM-mask pixels and searches around both its last measured position and its extrapolated position. No renderer palette, force or coordinate is supplied. This improves recovery after a direction reversal without claiming that the unseen collision was predicted.

[Earlier November 5 studio checks and real trials](../validation/runs/studio-2026-11-05/) are separate from the retained version 6 trials above and precede the current camera-selection and long-horizon update. Their accuracy numbers do not describe the current revision.
