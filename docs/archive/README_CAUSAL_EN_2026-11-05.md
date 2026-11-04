> Historical README saved before the live SAM observation interface replaced the main page. Its verification and publication statements describe that earlier release. Relative links have been adjusted for this archive.

# TWINFORGE — One decision. Two futures.

A carrier starts a chain of collisions. Meta proposes one intervention. Twinforge calculates the consequences, keeps the failed attempts, and lets you replay both futures from the same starting point.

[Try the demo](https://mkinvest57.github.io/TWINFORGE/) · [Actual Meta session](../../assets/causal-meta-session.json) · [Submission brief](../../docs/SUBMISSION.md) · [English video script](../../docs/VOICEOVER_3MIN_EN.txt)

## Start with the actual Meta decision

The English interface opens on **Muse Spark 1.3’s recorded decision**, verified again by the browser’s physics engine. Press **Replay decision**, then compare the three recorded attempts. Open **Try your decision** to change the scene, speed, delay, or command; these changes run the separate local search. The Meta journal preserves the original responses. Its English translations are labeled and tied to the exact recorded requests.

For the default chain reaction (`cascade`, seed `20261104`, speed `100%`, intervention at `0.25 s`):

| Decision | Peak contact energy on protected cargo | Control impulse |
|---|---:|---:|
| No intervention | 116.562 J | 0 N·s |
| **Recorded Meta proposal: steer −0.32 rad** | **4.564 J** | **62.540 N·s** |
| Local search: steer +0.20 rad | 0 J | 39.190 N·s |

The **8 J threshold is a predeclared experimental criterion**, not an industrial damage limit. The score is the maximum relative normal kinetic energy before a contact involving protected cargo. Zero here does not mean no collisions elsewhere.

## Where Meta is used

| Component | Responsibility |
|---|---|
| Meta Muse Spark 1.3 | Proposes a bounded action and revises it after receiving calculated outcomes. Three actual calls are recorded. |
| Deterministic physics engine | Calculates trajectories, collisions, contact energy, and control effort. |
| Local search | Evaluates 37 commands and selects the smallest control effort among those meeting the criterion. This search is not AI. |
| Public demo | Replays the recorded session and recomputes its consequences. It does not silently make new model calls. |
| Local Python service | Can run a new study with the privately configured Meta provider and explicit cost limits. |

The actual Meta session produced **104.609 J → 8.485 J → 4.564 J**: two rejected proposals, then one below the 8 J threshold. Spark received the scene, available actions, and outcomes of its previous proposals. It did not receive the exhaustive search scores. Recorded usage: **3 calls, 37.86 seconds, $0.028276**.

The local search does better on this small problem: lower impact and less effort. The demonstrated contribution is a proposal–verification–revision loop whose failures are inspectable, not a performance advantage over exhaustive search. [Original responses, receipts, and hashes](../../assets/causal-meta-session.json).

## Explore the decision

Three civilian scenarios—chain reaction, blind intersection, and narrow passage—compare 37 commands over **12 simulated seconds**. Both branches share the initial state and physical model; only the intervention changes. Trajectories are calculated and frozen before playback. The timeline reads those data rather than redrawing a prediction from the next observed position.

In the default cascade, the tested delay grid finds an admissible command at `0.25 s`, but none at `0.50 s`. Nine delays from `0` to `2 s` are tested in `0.25 s` steps. This is a grid result, not an exact continuous deadline.

The selected nominal action is also checked at `95%`, `100%`, and `105%` carrier speed. The local cascade choice passes all three; the intersection choice passes one. These sensitivity checks are not a probability of safety. The interface exposes failed cases and exports initial states, actions, trajectories, and contacts.

[Reproducible benchmark](../../validation/runs/causal-benchmark-2026-11-04.json) · [Engine review](../../validation/runs/causal-engine-review-2026-11-04.json)

## What the experiment establishes

Initial positions, velocities, masses, and coefficients are supplied. Circular rigid bodies move in a plane; the 3D scene depicts their contact envelopes. The engine uses linear damping, collision impulses without tangential friction, and a `1/240 s` integration step. An intervention is a bounded, instantaneous velocity or direction change; real actuator dynamics are not modeled.

This is a counterfactual comparison within a **known numerical model**. It does not establish independent prediction accuracy, learning physical laws from video, or control of a physical robot. The separate [mobile camera tool](https://mkinvest57.github.io/TWINFORGE/scan.html) tracks and extrapolates **2D pixel motion** locally; it does not reconstruct these warehouse scenarios.

Engine checks cover elastic-contact conservation, restitution, analytic damping, body separation, action bounds, contact-derived metrics, and frozen trajectories. Halving the time step preserves feasibility for the three selected nominal local actions; baseline peak-energy changes stay below 3% in those cases.

## Run and verify

Requires Python 3.9+ and Node.js. Simulation, local search, and recorded-session replay need no API key. Keys for new Meta requests stay on the local server.

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python server.py
```

Open `http://localhost:8000`. The server binds to the local machine only.

```bash
# Free numerical study; no model call
.venv/bin/python -m twinforge_runtime.causal_lab --out output/causal-local.json

# Reproduce the three-scenario benchmark
node validation/causal_benchmark.mjs output/causal-benchmark.json

# Verify the current sources
.venv/bin/python validation/run_checks.py --out output/software-checks-causal.json
```

A new paid study requires the Meta option in the local interface or `--models` on the study command. It permits up to three proposals, with a **$0.12 study ceiling** under a persistent **$0.50 ceiling for the `causal` scene**. Errors do not trigger automatic paid retries. HTTP checks reject external origins, non-local hosts, unknown fields, and oversized JSON bodies.

**225 automated tests pass: 114 Python and 111 JavaScript.** The [English studio check report](../../validation/runs/jury-studio-software-checks-2026-11-04.json) records the current source hashes and confirms that sources did not change during the checks. These are software checks; provider calls may be mocked, and no physical-camera or hardware validation is claimed. The [earlier browser review](../../validation/runs/causal-browser-2026-11-04/browser-review.json) and [earlier publication proof](../../validation/runs/causal-browser-2026-11-04/public-deployment.json) remain historical records of the previous interface.

## Three-minute presentation

[English voiceover](../../docs/VOICEOVER_3MIN_EN.txt) · [180-second English storyboard](../../docs/VIDEO_3MIN_STORYBOARD.json) · [Provisional English subtitles](../../docs/CAUSAL_DEMO_SUBTITLES_EN.srt)

These are editing materials, not an attestation that a final video or synthetic voice has been rendered. The storyboard opens with the actual Meta decision and retains both failed proposals, the better local baseline, and the model’s limits. Subtitle timing must be aligned with the final voice.

The causal laboratory is the main presentation. The tank and orbit are outside that path. Historical experiments and evidence remain archived; they do not become results for this new experiment. The [original PDF compliance record](../../docs/PROMPT_COMPLIANCE.md) still records its separate physical requirements.

[Archived French README](../../docs/archive/README_CAUSAL_FR_2026-11-04.md) · [Earlier project history](../../docs/archive/README_PRE_PROCESS_2026-11-04.md) · [Licenses](../../docs/THIRD_PARTY.md)

Current English-interface verification: [browser review](../../validation/runs/jury-studio-2026-11-04/browser-review.json). The separate motion-lab review includes all three scenarios, playback controls and mobile drawers.

Publication verified: [public deployment proof](../../validation/runs/jury-studio-2026-11-04/public-deployment.json). All 17 checked public files match the release sources; the browser export reproduces the locally verified Meta decision.
