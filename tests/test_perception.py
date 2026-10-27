"""Tests unitaires du pipeline perception SAM 3.1 (sans réseau, sans cv2).

Lancer : python3 -m unittest tests.test_perception -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "perception"))

import sam_perception as sp


SAMPLE = (
    "<0f>0<|box;x1=100;y1=200;x2=140;y2=240;w=640;h=480|>"
    "<|mask;x=0;y=0;data=41,41,abcDEF|>"
    ",1<|box;x1=300;y1=100;x2=420;y2=150;w=640;h=480|>"
    "<|mask;x=0;y=0;data=51,121,xyz|>\n"
)


class TestSamTextParser(unittest.TestCase):
    def test_parse_boxes_and_masks(self):
        recs = sp.parse_sam_text(SAMPLE)
        self.assertEqual(len(recs), 2)
        self.assertEqual(recs[0]["box"], {"x1": 100, "y1": 200, "x2": 140, "y2": 240, "w": 640, "h": 480})
        self.assertEqual(recs[0]["mask_data"], "41,41,abcDEF")
        self.assertEqual(recs[1]["box"]["x2"], 420)

    def test_parse_empty(self):
        self.assertEqual(sp.parse_sam_text(""), [])
        self.assertEqual(sp.parse_sam_text("no detections"), [])

    def test_centroid_area(self):
        rec = sp.parse_sam_text(SAMPLE)[0]
        self.assertEqual(sp.box_centroid(rec["box"]), (120.0, 220.0))
        self.assertEqual(sp.box_area(rec["box"]), 1600)


def det(cx, cy, w=40, h=40):
    return {"box": {"x1": cx - w // 2, "y1": cy - h // 2, "x2": cx + w // 2, "y2": cy + h // 2, "w": 640, "h": 480},
            "mask_data": None, "centroid": (float(cx), float(cy)), "area": float(w * h)}


class TestTrackingFP01(unittest.TestCase):
    def test_id_stable_and_reacquisition_after_occlusion(self):
        tr = sp.Tracker(gate_px=90, max_missing=4)
        a1 = tr.update([det(100, 300)], t=0.0)
        tid = a1[0]["track_id"]
        tr.update([det(115, 280)], t=0.1)
        # occlusion : aucune détection pendant 2 frames
        tr.update([], t=0.2)
        tr.update([], t=0.3)
        # réapparition près de la trajectoire prédite -> même ID (FP-01)
        a = tr.update([det(150, 235)], t=0.4)
        self.assertEqual(a[0]["track_id"], tid)
        self.assertEqual(tr.stats["fp01_losses"], 2)
        self.assertEqual(tr.stats["fp01_reacquired"], 1)


class TestFP02(unittest.TestCase):
    def test_blur_outlier_flagged(self):
        frames = [det(100 + i * 10, 300 - i * 5) for i in range(8)]
        frames.append(det(190, 255, w=90, h=18))  # masque étiré = flou de mouvement
        flags = sp.flag_fp02(frames)
        self.assertTrue(flags[-1])
        self.assertFalse(flags[0])


class TestWorldTransform(unittest.TestCase):
    def test_scale_from_rim(self):
        # anneau de 100 px de large = 0,4572 m ; centre anneau (320,180) à 3,05 m
        w = sp.world_from_scale((320, 80), rim_centroid=(320, 180), rim_width_px=100)
        self.assertAlmostEqual(w[0], 0.0, places=6)
        self.assertAlmostEqual(w[1], 3.05 + 100 * 0.4572 / 100, places=4)
        self.assertEqual(w[2], 0.0)


class TestEvents(unittest.TestCase):
    def test_launch_apex_score_events(self):
        # trajectoire : montée, sommet, descente qui traverse l'anneau (y pixel croissant vers le bas)
        pts = []
        ys = [400, 340, 290, 255, 240, 250, 285, 330, 375, 395]
        for i, y in enumerate(ys):
            pts.append({"t": i * 0.1, "world": (0.0, 4.2 - i * 0.12, 0.0), "centroid": (320.0, float(y)), "vel": (0.0, 0.0)})
        rim = {"centroid": (320.0, 330.0), "box": {"x1": 270, "x2": 370, "y1": 315, "y2": 345, "w": 640, "h": 480}}
        events = sp.detect_events(pts, rim)
        kinds = [e["event"] for e in events]
        self.assertIn("apex", kinds)
        self.assertIn("rim_cross_down", kinds)


if __name__ == "__main__":
    unittest.main()
