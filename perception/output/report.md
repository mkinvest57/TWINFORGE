# TWINFORGE — SAM 3.1 perception report

Video: `test_shot.mp4` · Model: `sam-3.1` via Meta Model API `/v1/responses` · Concepts: ball / vertical hoop / backboard
Sampled frames: 39 (~10.0 fps) · Ball found: 35 (90%)

## ID continuity (FP-01)
- Tracking losses (frames without the ball while it was tracked): 16
- Re-acquisitions by predicted trajectory: 12
- Distinct IDs assigned to the ball: [1, 3, 4] (whole video, bounces/rolling included)
- IDs on the flight segment (launch -> rim crossing): [1] — Prompt 2 criterion: ID stable through the rim

## Degraded frames (FP-02, motion blur)
- Area/eccentricity outliers excluded from the later fit: 3% of ball frames

## Detected events
- launch @ t=0.0s — first fast motion detected
- apex @ t=0.5s — shot apex (pixel vy flips)
- rim_cross_down @ t=1.0s — downward crossing of the rim plane within its span

## Honest limits
- Monocular world coordinates (scene plane, z=0): X scale from the real rim diameter (0.4572 m), Y scale from the real backboard height (1.07 m).
  With 4 printed fiducials + homography, planimetric accuracy improves; depth stays undetermined in mono.
- Centroids from SAM boxes (encoded masks are kept raw in the response; raster decoding via @meta-sam/parser when Node is present).
- No physical parameter (gravity, wind, restitution) is estimated here: this stage measures positions, period.

## Exit criterion (Prompt 2)
GO: clean ball trajectory, replayable frame by frame (annotated frames + trajectories.json).
