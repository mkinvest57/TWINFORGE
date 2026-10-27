# Shoot a ball at a vertical hoop. Get its simulator. Predict whether it goes in — before the ball lands.

**TWINFORGE EXTREME** — Meta Global AI Developer Hackathon 2026 · Track **Indie** · Theme **Push the Frontier**

**Live demo:** https://mkinvest57.github.io/TWINFORGE/ (physics demo; live APIs need the local server below)

## The project

TWINFORGE is the digital twin of a real physical system: from observing a scene
(first: a ball shot at a vertical hoop), the system observes the scene, induces
its own physics (gravity, drag, restitution…) from the observations alone,
predicts what happens next with a ghost projected **+0.5s AHEAD** of the object,
then controls the real system with sim-to-real MPC, replanning at every step
(120 ms, max 3 corrections per flight).

Imposed architecture, 4 stages in order:

1. **Observe** — SAM 3.1 perception by concept ("ball", "vertical hoop", "backboard"),
   deterministic state extraction, FP-01 (occlusion) and FP-02 (motion blur) handling.
2. **Induce** — scientific agent: hypothesis → parametric simulator + fit → residuals → revision.
   Gravity/wind estimated from observed velocities only (contacts rejected), restitution measured at the bounce.
3. **Predict** — ghost +0.5s computed with EXACTLY the same integrator as the real ball,
   Monte-Carlo (18 ghosts), "in / out" verdict locked before the ball lands.
4. **Control** — MPC: `J = Σ ||pᵢ − g||² + c_rock`, only `u*₀` executed, replanning at every step.

## Meta stack

SAM 3.1 (perception) · Muse Spark / Wonder (induction, counterfactuals) · Muse Image
(rendered counterfactuals) · Muse Glimmer (anomaly narration) · Muse Code (construction).
The true scene parameters are used for external evaluation only: the agent never
receives them — it induces its own, with uncertainties and held-out error.

## Real video perception (Prompt 2) — wired

Pipeline [perception/sam_perception.py](perception/sam_perception.py): video → SAM 3.1
(Meta Model API `/v1/responses`, text concepts with measured fallbacks) → deterministic
extraction → FP-01/FP-02 tracking → monocular world trajectories → events.
On the test video generated from the 3D scene: ball found on 85–90% of frames,
**ID 1 stable across the whole flight through the rim**, launch/apex/rim-cross events
detected. Dataset and report: [perception/output/](perception/output/) ·
Details: [perception/README.md](perception/README.md) · Tests: `python3 -m unittest discover tests -v`

## SAM → induction bridge (Prompt 3) — wired

[induction/induce.py](induction/induce.py) consumes ONLY the SAM trajectories and induces
a ballistic twin (hypothesis selection by held-out error, journal included).
On the current test shot: **g = 9.95 ± 0.56 m/s² induced from SAM positions alone,
held-out error 4.9 cm, verdict replay agrees** with the SAM-observed outcome.
Journal: [induction/induction_journal.md](induction/induction_journal.md)

## Status — honest

Built during the hackathon (Oct 26 – Nov 4, 2026).

- Interactive 3D demo: step-by-step physics (no scripted trajectories), induction
  computed live from the simulated scene's observed trajectories, ghost, Monte-Carlo,
  MPC and a 5-scene gauntlet. This is a **simulation**, honestly labelled.
- Real perception: SAM 3.1 pipeline works on video (tested on a rights-clean video
  generated from our own 3D scene; any phone video can be fed to it next).
- Live APIs: Baseten `meta-models/muse-spark-open-1026` (advisor) + Meta Model API
  (`muse-spark-1.3`, `muse-wonder-1.0`, `sam-3.1`…) through the local proxy.
- Not yet: a physical control rig (MPC controls the simulated "real" for now),
  the demo video, and the Cerebral Valley submission package.
  Target level: **L1 (induction + ghost)** demonstrated; the Oct 29 hard gate
  will confirm GO or lock the L3 pre-fitted fallback, in writing, either way.

- Ghost GIF: *(to add from the first capture)*
- Gauntlet report: "Gauntlet" panel in the demo (5 scenes: hoop, multi-body,
  chaotic, liquid, orbit), test-by-test checklist.

## How to run

Physics demo (no install, no key): open `index.html` in a modern browser
(internet required for the Three.js CDN), or use the live demo link above.

Live API mode (Muse Spark advisor in the right panel):

```bash
cp .env.example .env   # then fill in your keys — .env is NEVER committed
python3 server.py      # serves the page + API proxy at http://localhost:8000
```

then open http://localhost:8000 and click "Request a hypothesis revision".

### Wired APIs (server-side keys only)

| Role | Provider | Model / endpoint |
|---|---|---|
| Induction advisor (primary) | Baseten `https://inference.baseten.co/v1` | **`meta-models/muse-spark-open-1026`** (imposed hackathon model, the only model this key serves) |
| Fallback + other Meta models | Meta Model API `https://api.meta.ai/v1` | `muse-spark-1.3`, `muse-wonder-1.0` (chat); `sam-3.1`, `muse-image-1.0` listed by `/v1/models` |

The browser only calls the local proxy (`/api/status`, `/api/advisor`, `/api/meta/chat`):
no key in the code, the HTML, or the git history.

Controls: drag to orbit, scroll to zoom, **SHOOT THE BALL**, angle/power/spin/wind
sliders, Ghost / Monte-Carlo / MPC toggles, gauntlet scenes, natural-language
counterfactual field ("shoot 20% harder", "double the wind", "move the hoop left").
