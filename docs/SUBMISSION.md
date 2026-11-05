# TWINFORGE — The next frame is the test.

**Submission package draft, November 5, 2026. Not submitted.**
Track: **Indie Developer Track**. Theme: **Push the Frontier**. Language: English.
Eligibility, team membership and consent remain the entrant's declarations.

## The project

Twinforge turns visual motion into a prediction you can test. Select an object,
let Meta SAM 3.1 find its shape, then lock where it should appear half a second
or a full second later. When the future arrives, the target stays fixed and the
observed error appears beside it.

The problem is practical: a convincing moving overlay does not tell a developer
whether a system predicted anything. Twinforge gives builders and educators an
inspectable test bench: choose the object, observe the input, commit the
prediction, and examine the miss. It accepts uploaded video, camera input and
randomized 3D scenes. Camera operation is implemented; the retained real-world
evidence is uploaded footage, not a physical-phone test.

The contribution is connecting visual object selection to causal forecasting
and visible evaluation. This prototype does not claim to solve general physics
or human intention prediction. Longer forecasts expose those limits.

## Why Meta is essential

SAM 3.1 is the mandatory visual entry point. A tap or box becomes a native SAM
spatial prompt bound to an exact JPEG; **Hands** uses a text concept. The actual
returned mask initializes tracking. No valid SAM mask means no new track and no
forecast. Image hashes, timestamps, model identity and request receipts bind
the model response to the observed frame.

SAM segments; Twinforge predicts. Sparse feature flow follows camera/video
objects between SAM calls. Robust motion fits compete on already-observed past
targets, then forecast image position at 0.5, 0.75 or 1 second. The displayed
uncertainty grows with the horizon. A separate renderer generates changing 3D
scenes, but its positions, velocities, masses, forces and seed never enter the
observer.

A user can therefore choose a bottle or a hand without supplying simulator
state or a separate hand-authored detector. SAM's role is concrete and
inspectable; subsequent forecasting is not attributed to SAM itself.

## Three-minute demonstration

1. Open with a future target already locked, then reveal its actual outcome.
2. Show selection and the actual SAM mask: point/box on an object, then **Hands**
   on the recorded hand clip. Label photo-motion fixtures clearly.
3. Show the 0.5- and 1-second paths, uncertainty and source/target timestamps.
   Keep one complete lock-to-outcome sequence uncut.
4. Show the randomized scene and its image-only boundary. New scenes require
   visual acquisition; hidden physics never supplies the prediction.
5. Close on the evidence export: model receipt, input hash, immutable target and
   later error. Explain that unexpected human motion remains difficult.

Editing may condense waiting time if the cut is clear. It must not substitute a
new target, erase an error, present transformed photographs as physical motion,
or imply that the provider runs at the local tracking frame rate.

## Inspectable evidence

The [live results](../validation/runs/camera-horizon-2026-11-05/live-results.json)
retain eight separate runs, including two failed hand trials. These actual SAM
API runs are separate from manual-ROI tests and offline replays. Pixel errors
use later visual tracking, not independent physical ground truth.

| Recorded test | Horizon | Scored / unscorable | Mean error |
| --- | ---: | ---: | ---: |
| Bottle photo with controlled motion, point prompt | 0.5 s | 60 / 4 | 3.52 px |
| Bottle photo with controlled motion, box prompt | 1 s | 55 / 8 | 10.17 px |
| Two-hand photo with controlled motion, v14 | 1 s | 114 / 18 | 8.52 px |
| Actual recorded hand movement, v14 | 0.5 s | 61 / 5 | 20.27 px |
| Actual recorded hand movement, final v16 | 1 s | 57 / 8 | 34.10 px |

The real-hand 0.5-second locked target had **29.39 px** error. It was fixed before
the outcome and honestly scored; it was not perfect. The v16 real-hand 1-second
maximum was **129.41 px**. Different runs are not pooled into one accuracy claim.

The v16 run maintained approximately 25 captured frames/s while SAM ran
separately. Its two retained responses had provider times of 1456 and 1004 ms;
client round trips were 5427 and 1381 ms. A third submitted request had no
retained response and is not counted as a confirmed success.

[Software verification](../validation/runs/camera-horizon-2026-11-05/verification.json)
records **358 passing tests**: 207 JavaScript, 132 Python and 19 Worker tests.
Transport tests use mocks; live evidence supplies the actual model calls.
See [architecture](SAM_LIVE_OBSERVATION.md), [forecast limits](long-horizon-forecasting.md)
and [fixture provenance](../validation/runs/camera-horizon-2026-11-05/fixture-provenance.json).

## Access and completion

- Public repository: [github.com/mkinvest57/TWINFORGE](https://github.com/mkinvest57/TWINFORGE).
  Public visibility verified November 5. The final pushed commit must match the demo.
- [Hosted workspace](https://twinforge-mobile-camera.mkinvest57.chatgpt.site/): owner-private.
  Do not claim public judge access unless access is explicitly changed and checked.
- Prepared video page: [Watch the three-minute demo](https://mkinvest57.github.io/TWINFORGE/demo.html).
  The page serves `assets/twinforge-demo.mp4`. **Publication and playback verification
  remain pending until the final MP4 is committed and the Pages build completes.**
- Ready-to-paste copy and participant decisions:
  [submission-fields-2026-11-05.md](submission-fields-2026-11-05.md).

Credentials stay server-side. Submitted images go to Meta; camera capture does
not request audio. This is 2D image forecasting, without metric 3D reconstruction,
an actuator, a safety guarantee or verified physical-phone accuracy. The camera
path is not model predictive control. Earlier numerical decision benchmarks and
Muse experiments are archived, not presented as the live SAM observer's ability.
