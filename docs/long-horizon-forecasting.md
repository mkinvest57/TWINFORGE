# Visual forecasting at 0.5–1 second

`web/vision/motion.mjs` now supports a full second of image-plane forecasting.
It receives timestamped tracked centroids and tracking confidence. It receives
no object masses, world coordinates, scene identifier, simulator forces,
contact geometry, future frames, or human intention.

The long-horizon path estimates motion with robust time-based fits, tests
several motion models against targets already observed, and selects a model
using those past errors. Candidates include smoothed velocity, acceleration,
damped acceleration, turning, periodic motion and previously observed contact
boundaries. A boundary is inferred from abrupt reversals in visual history;
the first unseen contact remains unpredictable. Repeated contact evidence is
retained for up to 12 seconds, subject to the observer's available history.
New short-term motion can replace an old fit after a direction change.

The short-horizon path below 0.5 seconds retains its existing behavior. Tracking
loss, stale observations, gaps, selection changes and insufficient samples
still prevent a forecast. A stationary selected object now returns an explicit
stationary forecast rather than appearing broken.

## Interface

`forecastMotion(observations, {sourceTime, horizon})` retains `status`, `point`,
`trackId`, `sourceTime`, `targetTime`, `horizon`, and `usedTimes`. A successful
long-horizon result additionally contains:

```js
{
  trajectory: [
    {dt: 0, t: sourceTime, point: {x, y}, uncertaintyPx},
    // 0.25, 0.5, 0.75 and 1 second, through the requested horizon
  ],
  motionModel: 'velocity_smooth', // actual selected candidate
  validationState: 'past_targets_checked', // or 'learning'
  uncertainty: {
    kind: 'empirical_motion_envelope',
    calibrated: false,
    radiusPx: uncertaintyPx,
    includesUnknownIntent: false
  }
}
```

The trajectory starts at the latest observation; later positions use the
filtered state. Its envelope grows with forecast time using measurement noise,
observed past-target errors, velocity disagreement and disagreement between
plausible models. It is not a probability, a guaranteed bound, or a claim of
accurate unseen hand intentions. Tracking one selected hand predicts its
tracked image position, not every joint independently.

This is forecasting, not model predictive control (MPC). MPC selects control
actions for a controlled system over a receding horizon; the phone camera has
no actuator or control objective. SAM supplies visual segmentation/tracking
information; these explicit motion models produce the forecast. See the
[MathWorks MPC definition](https://www.mathworks.com/help/mpc/gs/what-is-mpc.html).

## Reproducible checks and limits

Run `node --test tests/js/sam-motion.test.mjs` for causal, stationary, noisy
linear, contact-history, direction-change and stale/identity regression tests.
Run `node validation/replay_long_horizon.mjs` to regenerate
`validation/runs/long-horizon-camera-2026-11-05.json`.

The evidence includes six fixed synthetic parameter variations per family,
seven forecast origins each, at 0.5, 0.75 and 1 second. These synthetic variants
were written after the implementation, and are not real phone footage. Three
saved visual-observation exports are also replayed. Those exports were examined
during development, so they are development replays, not independent holdouts.
Every forecast receives only the prefix through its origin. The report includes
all scheduled origins, refusals, scorable coverage, errors, and envelope
containment. Source and input hashes allow changes to be identified.

The comparison loads commit `fdeadfdb87842f9540c60c402caf0722ccfd766a` directly
from Git. Only its input horizon cap is raised from 0.75 to 1 second to expose
the old extrapolation at that target. This is not a claim that the old UI
supported 1 second. Paired results compare identical scorable origins:

| Visual replay | Horizon | Paired targets | Old mean error | New mean error |
| --- | --- | --- | --- | --- |
| Collision | 0.5 s | 114 | 26.93 px | 17.47 px |
| Collision | 1 s | 87 | 58.08 px | 50.57 px |
| Flight | 0.5 s | 36 | 59.63 px | 34.73 px |
| Flight | 1 s | 28 | 143.38 px | 87.56 px |
| Short pendulum export | 0.5 s | 4 | 68.76 px | 70.30 px |

The new model forecasts more origins instead of suppressing uncertain long
targets. Across **all** new flight predictions, the mean is 33.82 px at 0.5 s
(62 targets), and 96.43 px at 1 s (58 targets). The short pendulum export has no
scorable 1-second target. Its poor 0.5-second result is retained in the report.

On the synthetic suite, 1-second linear error improves from 0.93 to 0.30 px,
and accelerated error from 7.72 to 4.21 px. Irregular gesture error instead
increases from 64.78 to 68.28 px at 1 second. This is evidence of better stable
motion estimation, not a universal solution to arbitrary movement prediction.
Envelope containment also varies substantially (for example 62/111 collision
targets at 1 second and 0/4 short pendulum targets at 0.5 second). It must not be
presented as an 80% or 95% confidence interval. Physical-phone performance still
requires direct device testing.

## Actual SAM video trials — November 5

The separate [live results](../validation/runs/camera-horizon-2026-11-05/live-results.json)
contain real SAM requests through the hosted interface, followed by forecasts
issued during playback. These are not the offline comparisons above. Bottle
and two-hand photo clips use controlled synthetic motion of real photographs;
the real-hand clip is a recording of actual hand movement. All were uploaded
videos, not live phone-camera tests. Their future reference positions still
come from the same visual tracker and have no independent physical annotations.

| Input and retained release | Horizon | Scored / unscorable | Mean error | Maximum error |
| --- | ---: | ---: | ---: | ---: |
| Bottle photo, point selection | 0.5 s | 60 / 4 | 3.52 px | 8.94 px |
| Bottle photo, box selection | 1 s | 55 / 8 | 10.17 px | 25.48 px |
| Two-hand photo, v14 | 1 s | 114 / 18 | 8.52 px | 19.57 px |
| Recorded hand movement, v14 | 0.5 s | 61 / 5 | 20.27 px | 57.87 px |
| Recorded hand movement, v14 | 1 s | 54 / 9 | 40.90 px | 140.40 px |
| Recorded hand movement, final v16 | 1 s | 57 / 8 | 34.10 px | 129.41 px |

Photo clips were observed at 480 × 270 pixels; the real-hand recording used
413 × 480 pixels. These are separate cohorts, not a pooled precision claim.
No issued forecast in these runs used a timestamp after its source time.
The v14 trials contain no lost tracking observations, but continuous tracking
alone does not prove that each tracked position is correct.

The final v16 smoke test issued 65 one-second targets, scoring 57 and retaining
8 as unscorable when the clip ended. All 201 observations remained tracked,
with a 25.12 Hz capture rate. Three SAM requests were submitted and two responses
were retained; their provider times were 1456 and 1004 ms, versus client round
trips of 5427 and 1381 ms. The unretained submission is not counted as a confirmed
success. Its capture and segmentation timing differ from v14, so the lower
mean in this run is not a controlled model-improvement result.

In the real-hand 0.5-second run, the user-visible locked target was fixed at
source time 4.0038 for target time 4.5038. Its predicted position
`(230.7569, 259.8539)` was assessed against tracked position
`(205.9655, 244.0689)`, giving **29.3902 px** error. The real-hand 1-second
ticket was locked too late, at 7.6918 for target 8.6918 on an approximately
8-second clip, and correctly remains unscorable. The UI now disables such
video-end locks; this later change does not alter the retained ticket.

Retained v14 SAM calls took 532–2014 ms at the provider and 1056–2817 ms round
trip. Local captures continued at approximately 25 frames/s. These are
different timing measurements: the predictor does not wait for a new SAM
response for every frame. Calls submitted without a retained response are
counted separately and are not described as confirmed successes.

The earlier v12 and v13 hand failures remain alongside the retest. The exact
initial JPEG was entirely black in both failures, confirmed by its SHA-256;
SAM's initial empty result therefore did not test visible-hand recognition.
Later failures involved a 518.3 ms capture gap and a frame removed from the
buffer before a delayed response arrived. First-frame capture, buffer
retention, mask-outline handling and catch-up scheduling were corrected before
the v14 retest. This establishes the observed recovery on these clips, not
universal object recognition or reliable prediction of new human intentions.
