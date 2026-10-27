# TWINFORGE EXTREME — Submission write-up (draft, Cerebral Valley)

**Track:** Indie · **Theme:** Push the Frontier
**Pitch:** Shoot a ball at a vertical hoop. Get its simulator. Predict whether it goes in — before the ball lands.
**Repo:** https://github.com/mkinvest57/TWINFORGE · **Live demo:** https://mkinvest57.github.io/TWINFORGE/

## What it is

From observing a physical scene (first: a ball shot at a vertical hoop), TWINFORGE
builds its executable digital twin by itself: it induces the physics from the
observations alone, predicts the outcome with a ghost projected **+0.5s ahead**
of the object, answers natural-language counterfactuals in the twin, and controls
with sim-to-real MPC replanning every 120 ms (max 3 corrections per flight).

## Architecture — observe → induce → predict → control

1. **Observe (SAM 3.1, Meta Model API `/v1/responses`)** — text concepts
   (`ball`, `basketball hoop`, `backboard`; measured prompt fallbacks), masks/boxes,
   deterministic state extraction (zero LLM), ID tracking with FP-01 re-acquisition
   by predicted trajectory, FP-02 blur outliers flagged and excluded.
2. **Induce** — windowed finite differences on free flight only (contacts rejected),
   joint two-axis least squares separating gravity from drag, restitution measured
   at the bounce, train/held-out split (60/40) as the only score. Hypothesis
   revision (gravity-only vs +drag) is decided by held-out error, in the journal.
3. **Predict** — the ghost is the SAME step integrator as the real ball, projected
   +0.5s ahead with the induced parameters and their error; 18 seeded Monte-Carlo
   ghosts; in/out verdict locked and timestamped before the ball lands; live
   real-vs-predicted error in cm with recalibration.
4. **Control** — MPC: candidates rolled out only in the induced twin,
   `J = Σ ||pᵢ − g||² + c_rock`, only `u*₀` executed, replanned every 120 ms,
   every correction logged with numbers (horizon, predicted error before → after, Δv).

## Measured numbers (all reproducible from this repo)

| Claim | Value | Source |
|---|---|---|
| Browser twin induction (simulated scene) | g = 9.82–9.83 ± 0.07 m/s², held-out 0.5 cm, verdicts 3/3 correct | live demo, induction journal panel |
| SAM perception on test video | ball found 90% @10 fps, ID 1 stable across the whole flight | `perception/output/report.md` |
| SAM → induction bridge | g = 9.95 ± 0.56 m/s² from SAM positions alone, held-out 4.9 cm, verdict replay AGREES | `induction/induction_journal.md` |
| Chaotic horizon (double pendulum) | 4.8 s measured (0.003 rad perturbation diverges > 0.4 rad) | live demo, chaos scene |
| Orbit | ghost +0.6s ahead, induced G wrong by 3.5%, recalibrated every lap, laps counted | live demo, orbit scene |
| MPC | corrections logged, e.g. predicted error 48.6 cm → 1.7 cm, Δv printed per step | live demo, MPC log |

## Gauntlet status (test-by-test, nothing averaged away)

| Scene | Status | Evidence / named failure point |
|---|---|---|
| 1 Hoop shot | Validated in simulation; SAM flight ID stable on real API perception | demo + `perception/output/` |
| 2 Multi-body | Plays (cascade, per-body restitution); no induction/ghost yet — FP-05 open | demo scene 2 |
| 3 Chaotic | Validated for its claim: the horizon is the result (4.8 s) | demo scene 3 |
| 4 Liquid | Particles + splash play; prediction horizon not yet measured — FP-04 open | demo scene 4 |
| 5 Orbit | Validated: laps complete, ghost stays ahead, recalibrations logged | demo scene 5 |

## Ablations

- **Perception:** SAM 3.1 concept prompts vs the same prompts' naive variants —
  `vertical hoop` alone returns nothing on our scene, `basketball hoop` works;
  fallback order is measured, not guessed.
- **Physics:** induced (from observations) vs pre-fitted priors — the UI starts
  from deliberately wrong priors (g = 9.30) and shows the fit converge; verdict
  accuracy is reported per shot, controlled (MPC) trajectories are excluded from fitting.

## Honest level

**L1 demonstrated in simulation + real SAM perception and SAM-fed induction on a
generated test video.** Not yet: a physical MPC rig (control is sim-to-real inside
the page), a real phone-video shot end-to-end, Muse Image/Glimmer integrations.
The Oct 29 hard gate will record GO/NO-GO in `docs/GATE_2026-10-29.md` — if NO-GO,
induction is abandoned that night and the L3 pre-fitted fallback is locked and
labelled as such everywhere. Evaluation rule: true scene parameters were never
given to the agent; every parameter used was induced from observations.

## Credits

Built with Muse Spark Open (`meta-models/muse-spark-open-1026` via Baseten) and
Meta Model API models (Muse Spark 1.3, Muse Wonder 1.0, SAM 3.1). Built with Muse Code.
