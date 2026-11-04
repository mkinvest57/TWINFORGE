# TWINFORGE — See a scene. Predict its next move.

**Current submission draft; not submitted.** Presentation language: English. This brief describes the implemented live SAM observation path. Live-run measurements and deployment verification must be added from retained evidence; the historical benchmark results below do not substitute for them.

## Pitch

A new scene starts. Twinforge sees the images, but receives none of the simulator's positions, velocities, forces, or masses. Meta SAM 3.1 finds the objects. Their observed motion becomes a recorded prediction of where they will appear next: 0.2 seconds ahead by default, or 0.5 seconds in the stress setting. When that moment arrives, Twinforge checks the prediction against what it subsequently observes.

The user can generate another scene immediately: a double pendulum with different initial motion, balls colliding with different velocities, or a new launch and rebound. The observer must acquire the objects again from fresh SAM segmentation. Camera mode sends phone images through the same observation pipeline.

The intended value is making visual prediction inspectable: what the model actually saw, which object it found, what the system predicted before the target time, and how that prediction compared with later images. This is an experimental image-motion observer, with no claim of physical control or safety certification.

## Where Meta is essential

**SAM 3.1 is required before a track can produce a forecast.** The server sends a captured JPEG and a short object phrase to the Meta Model API, decodes the actual returned masks, and returns their contours and centroids with a request receipt. The frontend checks the image hash, capture identity, dimensions, timestamp, and model receipt. No usable SAM result means no SAM-initialized track.

SAM performs segmentation. Local appearance tracking follows the segmented regions between model responses. A separate image-motion predictor compares generic linear, curved, turning, and harmonic fits against earlier targets that have already been observed, then uses the selected fit for its next forecast. Selection receives no scene family or hidden physics. This project does not attribute the local motion fit, discovery of physical laws, or a learned physical simulator to SAM.

| Part | What it knows |
|---|---|
| Randomized 3D renderer | The hidden physical state required to generate the scene |
| Observation path | Captured pixels, capture time, opaque run ID, and an object phrase |
| SAM 3.1 | The submitted JPEG and object phrase |
| Local tracker and predictor | The SAM initialization and subsequently captured image measurements |
| Retrospective assessment | The previously stored prediction and later tracked image positions |

The scene family is available to label the UI, not as physical state supplied to the observer. The separate renderer and strict message/API contracts make this data flow inspectable; they are not a security sandbox against a person modifying the application.

## What the demonstration shows

1. Start observation on a newly randomized scene. Show the actual image submitted to SAM and its returned masks.
2. Allow enough usable motion observations to accumulate. The interface displays an issued target **0.2 seconds ahead by default**, or **0.5 seconds** with the stress setting selected. Its horizon, issue time, and target time are retained.
3. Let the target time arrive. The system compares the frozen target to later tracked image positions and reports error in **pixels**. Missing observations remain unscored.
4. Generate another scene. Its old masks and tracks are discarded, and a new actual SAM segmentation is required.
5. Export the record. It contains image hashes, model receipts, image observations, predictions, later assessments, and source labels.

Optional automatic regeneration starts another simulated scene every 20 source seconds. Camera mode applies the same segmentation-and-tracking path to live images after camera permission. A physical phone demonstration should only be described as verified once its own run has been retained and reviewed.

## The limits are part of the result

The scene is rendered in 3D, but the observer predicts **2D camera-image coordinates**. It does not reconstruct metric depth, mass, material, or the full physical state. Initial conditions vary within the implemented families; this is not generation of arbitrary new physical laws.

SAM requests are sparse, with a default interval of at least three source seconds. Local tracking bridges their latency and spacing. A delayed response can initialize tracking on its captured frame and catch up through already observed images; any resulting forecast is issued from the current time, never backdated as a successful prediction.

A short fit can fail at a bounce, collision, direction change, occlusion, or ambiguous crossing. Camera motion also violates its stationary-camera assumption. Insufficient samples, low motion, lost tracking, or an uncertain fit can cause the system to withhold a prediction. Conditional fit confidence is not a calibrated probability of correctness.

Displayed errors compare predictions against subsequent visual tracking. Both use the same image-processing pipeline; this is **not independent physical ground truth**. No current live accuracy number, latency result, or real-phone result is asserted by this draft.

The 0.2-second default is a shorter, easier task than the 0.5-second stress setting. It does not erase the earlier horizon's errors. Changing the setting starts a fresh trial with fresh SAM segmentation and cleared display metrics; the previous trial remains in export history. Measurements must remain separate by horizon, scene family, source kind, and relevant version, with scored and unscorable counts visible. Past targets used to choose the motion model are not independent future-test results. This brief makes no aggregate precision claim across those groups.

## Access, operation, and evidence

[Main interface](../index.html) · [Camera interface](../index.html?mode=camera) · [Architecture and setup](SAM_LIVE_OBSERVATION.md) · [Repository](https://github.com/mkinvest57/TWINFORGE)

The local service requires a privately configured Meta credential and the installed SAM mask decoder. The static GitHub Pages interface cannot execute private SAM calls by itself. Hosting with a private backend is being prepared; this brief does not claim that a new public live deployment has been verified. A phone requires HTTPS and a working backend, not just the static page.

All randomized trials share the persistent `vision` spending budget. The default ceiling is $0.50; the implementation accounts at $0.0025 per image. Scene resets do not replenish it. Browser submission limits, a persistent per-run limit, and a single active server request bound usage. Provider failures do not trigger automatic paid retries. An explicitly unbilled busy response can be followed by a later fresh frame.

The prepared hosting allocation reserves $0.10 for local live requests and leaves $0.40 for hosted requests. The local cap includes earlier vision spending; the hosted baseline of `1000` units records that reserved allowance, not a measured $0.10 charge. This configuration must be enforced and verified before both services operate, so two independent $0.50 allowances are never presented as one budget.

The local Python server privately retains the exact submitted JPEG and raw response linked to the exported receipt. The prepared hosted service retains hashes and normalized results rather than original images or raw provider text. Camera images submitted for segmentation go to Meta; no audio is captured. The browser export excludes image bytes and credentials. Hashes and application receipts support traceability but are not provider-signed attestations.

Automated tests cover the observation contract, image/request binding, forecast chronology, run reset behavior, budget handling, and missing-evidence cases. Provider tests use mocks. Software-test results must remain separate from actual inference, camera, or forecast-accuracy measurements.

## Earlier work and presentation files

The [recorded Meta decision experiment](../decision.html) uses supplied simulation states and actual recorded Muse Spark 1.3 proposals. Its [original responses](../assets/causal-meta-session.json), [numerical benchmark](../validation/runs/causal-benchmark-2026-11-04.json), and [archived submission brief](archive/SUBMISSION_CAUSAL_EN_2026-11-05.md) remain intact as earlier work. They do not establish the new observation pipeline's accuracy.

The existing [English voiceover](VOICEOVER_3MIN_EN.txt), [storyboard](VIDEO_3MIN_STORYBOARD.json), and [provisional subtitles](CAUSAL_DEMO_SUBTITLES_EN.srt) describe that earlier decision experiment. They are **historical preparation files, not a current film for the live SAM project**. This revision does not claim that a replacement video or synthetic narration has been produced.

The [original PDF compliance record](PROMPT_COMPLIANCE.md) retains its earlier scope and physical requirements. This brief is neither a submission receipt nor confirmation of participant eligibility, judging outcome, or acceptance by the event organizer.
