# Twinforge — 3-minute English hackathon film

**180-second edit · 24 voice chunks · 355 spoken words.** This is the current live-SAM film. Earlier numerical-control scripts are preserved in `docs/archive/`. This file is a production script, not proof that narration or a final film has been rendered.

The product is a visual motion forecasting lab: select an object, acquire its actual Meta SAM 3.1 mask, follow observed pixels, freeze a future target, then compare it with later visual tracking. The film demonstrates that sequence before explaining its limits.

## Voice and pacing

One consistent English voice: curious, clear, confident, conversational; about 138 words/minute during voiced portions. No trailer announcer. Stress select, lock, reveal, and measure. Pronounce Twinforge as twin-forge and SAM 3.1 as Sam three point one.

24 independent 7.5-second edit slots. Target 6.5 seconds of speech plus 1 second of visual breathing room per slot. The 180-second picture timeline is exact; generated voice duration is not yet verified. Align natural speech in the final edit and trim pauses, never imply provider timing from edited waits.

Use the exact narration below; the separate [plain English voiceover](VOICEOVER_3MIN_EN.txt) contains speech only. The [structured storyboard](VIDEO_3MIN_STORYBOARD.json) supplies frame indices, overlays, source labels, and evidence references.

## Exact timeline

### 00:00.0–00:07.5 · The question

**Voice:** A camera shows you what just happened. Twinforge asks: where will this object be next?

**Picture:** Actual Twinforge randomized scene, cropped tightly around one moving object. Freeze the edit just before a visible event; this editorial freeze is not a locked prediction. Reveal the product name in the last second.

**On screen:** WHERE WILL IT BE NEXT? · TWINFORGE · VISUAL MOTION FORECASTING
**Label:** Simulation · image-only observation

### 00:07.5–00:15.0 · What the product does

**Voice:** Select an object. Predict its position. Test the result. A forecast becomes a measurable claim.

**Picture:** Three quick actual-interface cuts: select an object, show its issued forecast, show a later measured result. Do not fabricate a result or splice one run's target into another run.

**On screen:** SELECT → FORECAST → MEASURE
**Label:** Actual interface capture

### 00:15.0–00:22.5 · Make Meta visible

**Voice:** Meta's SAM three point one segments the object. Twinforge tracks it and estimates its next position.

**Picture:** Open the actual submitted-frame/mask preview. Highlight the real SAM 3.1 label and mask; then cut back to the forecast.

**On screen:** META SAM 3.1: SEGMENTATION · TWINFORGE: MOTION FORECASTING
**Label:** Real SAM result · separate local forecast

### 00:22.5–00:30.0 · The honest boundary

**Voice:** The input is pixels. No simulator coordinates, hidden velocity feed, or prerecorded future trajectory.

**Picture:** Minimal editorial diagram: renderer → captured image → observer. The image is the only payload crossing the boundary apart from prompts and capture IDs/timestamps. No scrolling fake terminal.

**On screen:** PIXELS + VISUAL PROMPT · NO SIMULATOR STATE
**Label:** Architecture diagram

### 00:30.0–00:37.5 · A fresh scene

**Voice:** Start a new trial: randomized launches, collisions, or pendulums. Different starting conditions. A fresh observation.

**Picture:** Record real New scene actions across launch/rebound, collisions, and pendulum. Short cuts may compress resets; retain scene labels and never imply unknown physical laws were discovered.

**On screen:** NEW TRIAL. NEW INITIAL CONDITIONS.
**Label:** Randomized simulation · edited resets

### 00:37.5–00:45.0 · Show what is withheld

**Voice:** The renderer knows its world. Our observer never receives its positions, velocities, masses, or forces.

**Picture:** Hold the pixel preview next to the rendered scene. A restrained graphic lists the withheld state: position, velocity, mass, force. Do not show invented source-code output.

**On screen:** STATE STAYS WITH THE RENDERER
**Label:** Observer receives image observations

### 00:45.0–00:52.5 · Three distinct jobs

**Voice:** Here is the division: SAM finds the object. Local tracking follows it. Twinforge forecasts its motion.

**Picture:** Animate three plain labels using the actual mask, observed trail, and forecast as examples. Each visual is labelled by its actual producing component.

**On screen:** SAM → LOCAL TRACKER → FORECASTER
**Label:** Segmentation ≠ tracking ≠ prediction

### 00:52.5–01:00.0 · Choose the challenge

**Voice:** Choose half a second, three quarters, or one second ahead. Shading shows conditional uncertainty.

**Picture:** Actual horizon control: 0.5, 0.75, 1.0 seconds. Show the uncertainty region without depicting it as a guaranteed confidence bound.

**On screen:** +0.5 s  /  +0.75 s  /  +1.0 s · CONDITIONAL UNCERTAINTY
**Label:** Image coordinates · uncalibrated envelope

### 01:00.0–01:07.5 · Freeze the claim

**Voice:** Lock a target before the future arrives. Its position and timestamp are now fixed.

**Picture:** Continuous capture of Lock prediction in a synthetic run. Hold the target and its source/target timestamps. Keep this exact run for the next shot.

**On screen:** PREDICTION LOCKED · ISSUED BEFORE THE TARGET TIME
**Label:** Simulation · same run continues

### 01:07.5–01:15.0 · Let time answer

**Voice:** Reveal. The scene advances. Amber is the prediction. Cyan is the later observation. Measure the gap.

**Picture:** Continue the previous capture through Reveal and the measured outcome. Amber target stays fixed. Hold the actual error number long enough to read; never substitute a lower error.

**On screen:** AMBER: PREDICTED · CYAN: LATER TRACKED POSITION
**Label:** Error measured against later visual tracking

### 01:15.0–01:22.5 · Keep the record honest

**Voice:** Keep the misses. Keep unscorable attempts. Each result stays tied to its source and horizon.

**Picture:** Open that run's actual scored/unscorable counts or export. Show one real unscorable record alongside measured results, with no invented percentages.

**On screen:** SCORED + UNSCORABLE · FAILURES STAY IN THE RECORD
**Label:** Individual run · not a universal accuracy claim

### 01:22.5–01:30.0 · Your images

**Voice:** Now use camera mode, or open a local video. Tap an object. Box a bottle.

**Picture:** Show actual camera-mode controls and native point/box selection on the bottle fixture. If using the existing fixture, its photo-motion label must remain visible. A phone mockup is layout illustration only.

**On screen:** TAP AN OBJECT · DRAW A BOX
**Label:** Bottle example: controlled photo motion

### 01:30.0–01:37.5 · Real hand movement

**Voice:** Choose Hands. SAM finds visible hands. This example uses a recording of real human movement.

**Picture:** Use the retained real-hand run, preferably v16, and its corresponding original hand clip. Show Hands selection and actual SAM mask. Do not use the two-hand synthetic photo-motion clip here.

**On screen:** HANDS · REAL RECORDED MOVEMENT
**Label:** Uploaded real hand video · not a live phone test

### 01:37.5–01:45.0 · An uncertain human future

**Voice:** The fingers change shape. The hand changes direction. We forecast overall motion, not intention.

**Picture:** Continue that real-hand run through a direction or shape change. Keep both the observed position and predicted point visible; retain visible disagreement.

**On screen:** FORECASTING OVERALL HAND MOTION
**Label:** Recorded real movement · same trial

### 01:45.0–01:52.5 · An auditable number

**Voice:** In this recorded trial, one-second forecasts averaged thirty-four pixels of error across fifty-seven scored targets.

**Picture:** Show a clean result card derived from real-hand-1-v16.json, paired with that exact run. This may be an editorial data card; label it Recorded trial, never Live measurement.

**On screen:** +1.0 s · 57 SCORED · 34.10 px MEAN ERROR · 129.41 px MAX ERROR
**Label:** Recorded v16 trial · 413 × 480 observations

### 01:52.5–02:00.0 · The denominator matters

**Voice:** Eight more were unscorable. These comparisons use later visual tracking, not independent ground truth.

**Picture:** Continue the same card: add 8 unscorable outcomes, and identify the comparison method. Do not turn this into a success percentage or accuracy guarantee.

**On screen:** 57 SCORED · 8 UNSCORABLE · REFERENCE: LATER VISUAL TRACKING
**Label:** Not independent ground truth

### 02:00.0–02:07.5 · Two different clocks

**Voice:** Local tracking ran around twenty-five frames per second. SAM inference ran separately, with its latency measured.

**Picture:** Use the same v16 measurements. Show local observed cadence separately from the two retained SAM provider response times, and keep client round-trip timing in smaller readable text.

**On screen:** LOCAL CAPTURE: 25.12 Hz · SAM PROVIDER: 1.00–1.46 s · CLIENT ROUND TRIP: 1.38–5.43 s
**Label:** v16 · 2 retained SAM responses / 3 submissions

### 02:07.5–02:15.0 · Stay responsive while waiting

**Voice:** During that wait, captured frames keep arriving. SAM's confirmed mask anchors tracking through those observations.

**Picture:** Actual refresh capture after an established SAM anchor: local movement continues while a later SAM request is pending. Initial synthetic/video acquisition may pause; do not use that initial wait as the example.

**On screen:** LOCAL TRACKING BETWEEN SAM REQUESTS
**Label:** Any compressed wait must be labelled

### 02:15.0–02:22.5 · Open the proof

**Voice:** Open the evidence: submitted image, segmentation mask, request receipts, prediction timestamps, and measured outcomes.

**Picture:** Actual evidence dialog: submitted frame and its mask, then real receipt/timestamp fields. Mask must correspond to the displayed frame. Hide credentials; do not invent a diagnostic dashboard.

**On screen:** IMAGE · MASK · RECEIPT · TIMESTAMP
**Label:** Actual retained evidence

### 02:22.5–02:30.0 · Make it inspectable

**Voice:** Export the record. Anyone reviewing it can ask: was this claim recorded before its outcome?

**Picture:** Click the real export action. Show a readable excerpt with the same run ID and issue/target/observation times; timestamps must come from that file.

**On screen:** CLAIM FIRST. OBSERVATION LATER. · EXPORT THE RECORD
**Label:** Forecast chronology from actual export

### 02:30.0–02:37.5 · What exists today

**Voice:** Today, Twinforge forecasts two-dimensional image positions. Physical reconstruction and robot control are future work.

**Picture:** Return to a clear wide product view. Use two simple labels: built today, future work. No robot actuation footage presented as implemented functionality.

**On screen:** TODAY: 2D VISUAL FORECASTING · FUTURE: PHYSICAL VALIDATION
**Label:** No full 3D reconstruction or robot control

### 02:37.5–02:45.0 · Where it could matter

**Voice:** The potential is practical: help robotics teams test anticipation before trusting predictions with real actions.

**Picture:** Optional short generated robotics concept shot, visually distinct from the app capture, or a clean editorial diagram of perception → forecast → test. No fake SAM overlays or claims of deployed hardware.

**On screen:** POTENTIAL USE: ROBOTICS VALIDATION
**Label:** Future application · concept illustration

### 02:45.0–02:52.5 · The next experiment

**Voice:** Next: independent annotations, harder motion, and physical device trials. Keep testing the limits.

**Picture:** Three concise roadmap cards over actual hand/simulation stills: independent annotations, harder motion, device trials. These are next steps, not completed validations.

**On screen:** INDEPENDENT LABELS · HARDER MOTION · REAL DEVICE TRIALS
**Label:** Next validation steps

### 02:52.5–03:00.0 · End on the product

**Voice:** Twinforge. See motion. Freeze a forecast. Measure what happens next. Then improve the next prediction.

**Picture:** Return to the real UI and logo. Resolve to the public source/evidence URL; keep it readable through the final second. Do not identify the owner-private backend as public jury access.

**On screen:** TWINFORGE · SEE → FORECAST → MEASURE · github.com/mkinvest57/TWINFORGE
**Label:** Source + recorded evidence

## Measurement behind the result card

The result at 01:45–02:00 belongs only to the retained **v16 recorded real-hand trial**: 1-second horizon, 413 × 480 observations, 57 scored targets, 8 unscorable, mean error 34.10 px, maximum 129.41 px. It uses later visual tracking as the comparison, not independent ground-truth annotations. The trial had 25.12 Hz local capture and two retained SAM responses from three submissions. Rounded provider times were 1.46 and 1.00 s; client round trips were 5.43 and 1.38 s. Do not turn local frame cadence into a SAM inference-speed claim.

Source: [live-results.json](../validation/runs/camera-horizon-2026-11-05/live-results.json), run `d0b07f2c-52b6-40c8-989e-f0497e96d396`, and its [original v16 export](../validation/runs/camera-horizon-2026-11-05/real-hand-1-v16.json). Earlier failures remain in that report. If the editor uses a different run, retain this labelled historical card or update narration and every number together from the replacement export.

## Final edit requirements

- Final picture duration must be exactly 180 seconds; at 30 fps this is 5400 frames. Verify the exported media, not just the edit grid.
- Review the complete film with audio and again muted. Subtitles must match actual speech and fit mobile-readable safe margins.
- Do not claim that SAM predicts motion: SAM segments; local tracking and the separate Twinforge predictor handle motion.
- Do not attribute 25 Hz local capture/tracking to the SAM provider. Keep inference and client round-trip times distinct.
- Do not fake a mask, a receipt, a successful lock outcome, a mobile camera test, or a physical-control demonstration.
- Every lock/reveal pair must use the same real run and unchanged issued target. Any displayed error comes from its export.
- The 34.10 px / 57 scored / 8 unscorable card refers only to the retained real-hand v16 one-second trial.
- Keep uploaded real video, controlled photo motion, randomized simulation, and generated concept illustrations clearly distinct.
- Keep synthetic initial conditions hidden from the observer; do not claim arbitrary physics discovery or general 3D reconstruction.
- No prediction is available without an actual usable SAM mask. Do not depict manual rectangles as a SAM result.
- Owner-private hosted access is not public jury access. The closing public link is the source/evidence repository.
- No claimed win probability, prize entitlement, universal accuracy, guaranteed safety, or implemented robot actuation.
