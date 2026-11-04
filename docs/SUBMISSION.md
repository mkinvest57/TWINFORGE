# TWINFORGE — One decision. Two futures.

**Submission draft; not submitted.** Proposed track: Indie, subject to participant eligibility. Proposed theme: Push the Frontier. Presentation language: English.

## Pitch

Seeing an incident coming is only the start. Twinforge tests the action that could change its outcome. Meta proposes one bounded intervention, a physical simulator calculates its consequences, and the model can revise its decision using that feedback. Failed proposals remain visible beside a separate numerical baseline.

The demo begins with a carrier triggering a chain of collisions. Two branches share the exact same starting state; one proceeds without intervention, the other applies a recorded Meta decision. Their trajectories are calculated before playback and shown with a synchronized timeline and exportable data.

The intended value is preparing decisions in simulation before more expensive physical trials. The project does not claim industrial customers, measured financial savings, or real-world safety validation.

## The actual Meta contribution

The default view replays **Muse Spark 1.3’s actual recorded proposal**, evaluated again with the matching physics engine. Without intervention, peak contact energy involving protected cargo is **116.562 J**. Meta’s selected steering command reduces it to **4.564 J**, below the experiment’s **8 J criterion**.

The session completed on **November 4, 2026 at 17:06:58 UTC**. Spark received initial states, physical parameters, and the permitted action IDs. It did not see the exhaustive search results. Each proposal was evaluated by the solver, and the calculated outcome was returned for the next revision.

| Actual call | Proposed action at 0.25 s | Calculated peak | Experimental result |
|---|---|---:|---|
| 1 | Steer −0.16 rad | 104.609 J | Rejected |
| 2 | Steer −0.36 rad | 8.485 J | Rejected |
| 3 | Steer −0.32 rad | 4.564 J | Below 8 J |

The selected proposal uses **62.540 N·s** of control impulse. Recorded usage is **3 calls, 37.8556 seconds, $0.028276**. Original responses, receipts, request hashes, outcomes, and both failures are retained. English translations in the interface are labeled and bound to the original records; exports preserve the originals.

**The separate local search performs better here: 0 J and 39.190 N·s, using +0.20 rad.** It evaluates 37 commands without AI. The project demonstrates a verifiable proposal–revision loop, not an advantage over exhaustive search on this small action space. Meta proposes the action; the numerical solver produces the displayed metrics.

[Public original journal](../assets/causal-meta-session.json) · [Original run report](../validation/runs/causal-meta-live-2026-11-04.json)

The public site replays a recorded real session rather than making a fresh live request. New studies require the local Python service and privately configured credentials. Paid studies are explicitly enabled, limited to three proposals and $0.12 per study, within the persistent $0.50 `causal` scene ceiling. Model output selects bounded action IDs, never executable code.

## Three test scenarios

The numerical search compares 37 commands over 12 simulated seconds. Nominal conditions are seed `20261104`, carrier speed `100%`, and intervention at `0.25 s`.

| Scenario | No intervention | Local search result | Speed checks passing at 95/100/105% |
|---|---:|---:|---:|
| Chain reaction | 116.562 J | 0 J | 3 / 3 |
| Blind intersection | 112.755 J | 3.464 J | 1 / 3 |
| Narrow passage | 149.926 J | 0 J | 3 / 3 |

The **8 J threshold is an arbitrary, predeclared experimental criterion** for protected cargo, not a certified damage threshold. The score is the maximum relative normal kinetic energy before contact involving that cargo. It does not certify the absence of damage elsewhere.

Among candidates meeting the criterion, the local search minimizes control impulse. If none pass, it reports failure and selects the smallest peak. Speed sensitivity re-evaluates the nominal action; it does not optimize a new action for each speed and does not estimate a success probability.

The cascade makes timing tangible: an admissible command exists at `0.25 s`; none of the 37 tested commands passes at `0.50 s`. The search tests nine delays from `0` to `2 s`, in `0.25 s` steps. Its last feasible tested delay is not an exact continuous deadline.

[Reproducible benchmark](../validation/runs/causal-benchmark-2026-11-04.json) · [Engine review](../validation/runs/causal-engine-review-2026-11-04.json)

## Technical scope

- Supplied positions, velocities, masses, and coefficients; no camera reconstruction of the warehouse.
- Circular rigid bodies moving in a plane, with a 3D visualization of their contact envelopes.
- Linear damping, normal collision impulses without tangential friction, and a `1/240 s` integration step.
- One instantaneous intervention: braking up to 90%, or a bounded velocity rotation up to ±0.36 rad.
- Frozen trajectories before playback, synchronized comparisons, inspectable contacts, and JSON exports.
- Half-step checks preserve feasibility of the three nominal local choices; baseline peak-energy variation remains below 3% for those cases.

The calculations and replay use the **same known model**. This is not an independent predictive-accuracy benchmark, discovery of physical laws, or a validated physical robot. Perception uncertainty, actuator dynamics, and industrial deployment remain future work.

The separate mobile camera tool provides local 2D pixel tracking and extrapolation without uploading images. It does not reconstruct this simulation. The historical pendulum workbench retains separate diagnostics.

## Three-minute video

The English video opens with the actual Meta decision and its two futures: **116.562 J → 4.564 J**. It then shows the three real proposals, both failures, the inspectable journal, and the better local 0 J baseline. Delay and sensitivity tests reveal when the tested intervention fails.

[English voiceover](VOICEOVER_3MIN_EN.txt) · [180-second storyboard](VIDEO_3MIN_STORYBOARD.json) · [Provisional English subtitles](CAUSAL_DEMO_SUBTITLES_EN.srt)

These are preparation files, not a completed film or generated-voice receipt. The final edit must keep “simulation,” “known model,” and “recorded session” readable. Captured values must match the export from that capture. The original French response can remain in the evidence export; the jury-facing view is English.

## Access and verification

[Public demo](https://mkinvest57.github.io/TWINFORGE/) · [Public repository](https://github.com/mkinvest57/TWINFORGE) · [Official event guide](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details)

The static site exposes the simulations and recorded journal without credentials. **225 automated tests pass: 114 Python and 111 JavaScript.** The [English studio verification report](../validation/runs/jury-studio-software-checks-2026-11-04.json) pins the current source hashes and confirms no source changes during the checks. Provider calls may be mocked in software tests; no physical-camera or hardware validation is claimed. The [earlier browser review](../validation/runs/causal-browser-2026-11-04/browser-review.json) and [earlier publication proof](../validation/runs/causal-browser-2026-11-04/public-deployment.json) apply to the previous interface.

The consulted event guide lists **November 4 at 9 p.m. EST**, equivalent to **November 5 at 3 a.m. in Paris**. This document is not a submission receipt. Participant eligibility, team details, the rendered video, and the final portal submission require the entrant’s confirmation.

The [French causal brief](archive/SUBMISSION_CAUSAL_FR_2026-11-04.md), [initial workbench brief](archive/SUBMISSION_PRE_PROCESS_2026-11-04.md), and [intermediate version](archive/SUBMISSION_PROCESS_2026-11-04.md) are archived unchanged. The [PDF compliance record](PROMPT_COMPLIANCE.md) retains its original physical requirements; the October 27–29 evidence is not rewritten.

Current English-interface verification: [browser review](../validation/runs/jury-studio-2026-11-04/browser-review.json). The separate motion-lab review includes all three scenarios, playback controls and mobile drawers.

Publication verified: [public deployment proof](../validation/runs/jury-studio-2026-11-04/public-deployment.json). All 17 checked public files match the release sources; the browser export reproduces the locally verified Meta decision.
