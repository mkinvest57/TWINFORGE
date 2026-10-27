# TWINFORGE — Induction journal (SAM trajectories -> twin)

Source: `trajectories.json` (SAM 3.1 world positions only; no true parameter ever input).
Free-flight segment: 12 samples (t=0.083s..1.0s), 23 samples rejected (FP-02 outliers, rim contact and everything after).

- H1 gravity only: train fit g=12.184 m/s², k=0.0000 -> held-out error **7.4 cm**
- H2 gravity + quadratic drag: train fit g=10.818 m/s², k=0.1888 -> held-out error **4.5 cm**
- Revision decision: keep **H2 gravity + quadratic drag** (lowest held-out error). Residual-driven, no hand tuning.

## Final induced twin (full free-flight fit)
- g = 9.946 ± 0.561 m/s²
- drag k = 0.2611 ± 0.0934
- lateral residual (plane) = -1.345 m/s² — diagnostic only, NOT applied in the twin: in a monocular plane it mostly absorbs perspective foreshortening, applying it would double-count projection.
- held-out prediction error (train-fit model): **4.9 cm** mean
- fit points: 10 (windowed finite differences, contacts rejected)

## Verdict replay (induced twin vs SAM-observed outcome)
- SAM observed rim_cross_down: yes @ 1.0s
- Induced twin crosses rim plane downward near centre: yes
- Verdict agreement on this shot: **AGREE**

## Honest limits
- Monocular plane twin (z=0): gravity/drag are induced in the image plane; a second camera or fiducials are required for a full 3D twin.
- Sparse SAM sampling: the free-flight segment holds few points, so uncertainties stay wide and are printed, not smoothed away.
