"""Unit tests for the SAM -> induction bridge (no network)."""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "induction"))

import induce


def synth(g=9.81, k=0.012, wind=0.0, n=40, dt=0.05):
    """Ballistic samples in the image plane (x horizontal, y up), quadratic drag."""
    p = [-2.7, 2.6]
    v = [5.2, 6.1]
    out = []
    for i in range(n):
        out.append({"t": i * dt, "world_m": [p[0], p[1], 0.0], "quality": {"fp02_outlier": False}})
        s = math.hypot(*v)
        a = [-k * s * v[0] + wind, -g - k * s * v[1]]
        v = [v[0] + a[0] * dt, v[1] + a[1] * dt]
        p = [p[0] + v[0] * dt, p[1] + v[1] * dt]
    return out


class TestInduceFit(unittest.TestCase):
    def test_recovers_gravity_and_drag(self):
        samples = induce.free_flight_samples(synth())
        fit = induce.fit_params(samples)
        self.assertAlmostEqual(fit["g"], 9.81, delta=0.35)
        self.assertAlmostEqual(fit["drag"], 0.012, delta=0.008)

    def test_fp02_outliers_excluded(self):
        frames = synth()
        frames[5]["quality"]["fp02_outlier"] = True
        frames[5]["world_m"] = [99.0, 99.0, 0.0]
        samples = induce.free_flight_samples(frames)
        self.assertTrue(all(abs(s["p"][0]) < 50 for s in samples))

    def test_held_out_error_small_on_synth(self):
        frames = synth()
        samples = induce.free_flight_samples(frames)
        err = induce.held_out_error(samples, frac=0.6)
        self.assertLess(err, 12.0)  # cm


if __name__ == "__main__":
    unittest.main()
