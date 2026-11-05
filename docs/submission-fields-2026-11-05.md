# Submission fields — TWINFORGE

Prepared November 5, 2026. **Draft only; nothing submitted.** Field labels and the
three-minute/public-GitHub requirements come from the entrant's form screenshots.
No field-length limits were independently visible; shorten only if required by
the portal.

## Verified event requirements

The published deadline is **November 4, 2026, 9:00 PM ET**, equivalent to
**November 5, 02:00 UTC / 03:00 Paris**. The public pages list judging November
4–8 and finals November 9. Schedule changes would be posted there; no extension
was visible during this check. [Organizer event page](https://cerebralvalley.ai/e/meta-ai-developer-hackathon),
[Meta event page](https://dev.meta.ai/events/global-hackathon).

Project weights are **Impact 30%, Meta tooling 25%, Technical depth/execution
20%, Demo 25%**. Indie teams may have up to four members; one authorized
representative submits and names the others. An entrant/project uses one track.
Indie first prize is **US$150,000**, not €150,000; the Indie pool is US$400,000
and the announced overall pool US$1M. Awards require eligibility verification.
[Official rules and waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver).

The rules require accepted eligible participants, truthful information, rights
to submitted material and compliance with included open-source licences.
Entrants retain ownership but grant organizers broad usage rights. Identity,
eligibility, rights and acceptance remain the entrant's declarations.
[Official rules and waiver](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver).

Research note: anonymous text extraction showed Loading for details/waiver.
The complete official waiver was read from the public HTML's embedded document
data. The authenticated attendee-only details body was unavailable. Additional
signed-in portal instructions take precedence. The public waiver did not
independently establish video length or repository visibility; those constraints
come from the supplied form screenshots.

## Team name

```text
TWINFORGE
```

This is the project/team display name. Actual team members and their legal names
must be supplied by the representative; they are not inferred from GitHub.

## Track

```text
Indie Developer Track
```

## Problem statement / theme

```text
Push the Frontier
```

This fits the demonstrated capability: testing visual prediction and understanding
of moving systems. No personal-domain story is invented for Build for Your World.

## Project description

```text
Twinforge turns visual motion into a prediction you can test.

Tap an object, draw a box, or choose Hands. Meta SAM 3.1 finds its shape in the actual submitted image. Twinforge tracks the observed pixels and forecasts where the object will appear 0.5 to 1 second later. Lock a target before that moment arrives; the target stays fixed while the interface reveals the later observation and pixel error.

We built this for developers and educators who need to distinguish a convincing overlay from a real prediction. It accepts uploaded video, camera input and randomized 3D scenes. The scene renderer never supplies positions, velocities, forces or other hidden physics to the observer.

Every run can export image hashes, SAM receipts, observation timestamps, frozen predictions and later assessments. Actual SAM trials include bottle selection, two-hand segmentation and recorded real hand movement. Failed trials remain in the evidence. Camera support is implemented, but physical-phone accuracy is not claimed. This prototype predicts 2D image position; unexpected motion remains difficult, and its uncertainty display is not a guarantee.
```

## Public GitHub repository

```text
https://github.com/mkinvest57/TWINFORGE
```

The GitHub API reported private:false on November 5. Verify the final commit,
README, evidence and assets are pushed before submitting.

## Three-minute demo video link

YouTube URL:

```text
https://youtu.be/ySzrCQ7G3Tk
```

Upload completed and public publication requested; processing/playback confirmation
was pending at handoff. Verify public playback, audio and the ending.

Backup: https://mkinvest57.github.io/TWINFORGE/demo.html — the final MP4 is committed
at `assets/twinforge-demo.mp4`; the latest Pages deployment must finish.

## How did you use Meta AI models or tools?

```text
Meta SAM 3.1 is the mandatory perception model in Twinforge's live workflow. We call it through the Meta Model API with an exact captured JPEG and either an object concept or a native point/box prompt. Its returned mask initializes the selected object's visual track; without a valid SAM result, no new track or forecast is created.

We bind each response to its image hash, dimensions, capture time, run identity and model receipt. Local feature flow follows the SAM-selected region between API calls. A separate causal motion-model selector uses past visual measurements to forecast 0.5, 0.75 or 1 second ahead. SAM performs segmentation; Twinforge's own tracking and forecasting logic produces and evaluates the future target.

The repository includes retained real SAM receipts, later pixel-error assessments and failed runs, alongside 358 automated software tests. Earlier Muse experiments are archived separately and are not claimed as part of the current live prediction path.
```

## Why was Meta AI important to your project?

```text
SAM 3.1 makes the user's chosen object the starting point. Instead of giving the predictor a simulator's object coordinates or building a different detector for each example, we ask SAM to segment what the user points at or names, then follow that region through subsequent frames.

That visual boundary is central to the project: the same observation workflow can start from a bottle, a hand, uploaded footage or a freshly randomized scene. SAM is therefore not a decorative API call; its mask is required to create every new track. Twinforge adds the missing test around that perception capability: commit a future position, wait for the evidence and show the error honestly.
```

## Optional partner feedback

Leave blank unless the entrant wants to provide it. Do not claim use of Baseten,
Modal or Fireworks based only on event sponsorship. Suggested technical feedback,
**for entrant review**, if a suitable general Meta feedback field exists:

```text
Native point and box prompts made object selection much more useful than a fixed object-name workflow. Keeping image hashes and model receipts helped us verify the integration. Separating API round-trip time from local tracking cadence was essential for a responsive experience. More predictable end-to-end latency and explicit guidance for delayed video-frame responses would help developers building interactive perception tools.
```

## Subjective questionnaire and consent

The entrant must answer these personally; no answer is selected here:

- Prior familiarity with or use of Meta tools before this event.
- Satisfaction, likelihood to use/recommend, ratings and personal opinions.
- How the entrant heard about the event, if asked.
- Permission to receive marketing or share contact details for marketing.
- Team identities, eligibility, ownership and terms/waiver declarations.

The current project demonstrably uses Meta Model API and SAM 3.1. That objective
fact does not establish earlier experience or a personal rating. Marketing
consent is not inferred from a request to prepare this package.

## Final handoff

Remaining fields are the uploaded video URL and the entrant's identity,
subjective and consent answers. Submit through the
[Cerebral Valley portal](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit)
and retain its confirmation. A local render or Git push is not a submission receipt.
