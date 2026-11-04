"""Meaningful evidence checks: hashes, incomplete runs, false claims and privacy."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from validation.preflight import check_ablations, check_gauntlet, check_submission, relative_file, scan_secrets, source_files, SCENES, TESTS
from validation.media import subtitle_coverage, duration_seconds


class TestEvidenceIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        evidence = self.root / "run.json"
        evidence.write_text('{"observations":[1,2,3]}')
        self.evidence = [{"path": "run.json", "sha256": hashlib.sha256(evidence.read_bytes()).hexdigest()}]

    def tearDown(self):
        self.temp.cleanup()

    def complete_gauntlet(self):
        return {"version": 1, "run": {"id": "test", "recorded_at": "2026-11-04T00:00:00Z", "mode": "simulation", "source_commit": "test", "source_sha256": "a" * 64},
                "scenes": [{"id": sid, "validated": True,
                            "tests": [{"id": tid, "status": "pass", "executed_at": "2026-11-04T00:00:00Z", "method": "recorded test", "measurements": {"samples": 10}, "evidence": self.evidence} for tid in TESTS],
                            "metrics": {"ghost_error_mean_cm": 2.5, "verdicts_correct": 2, "verdicts_total": 3, "collisions": 0}} for sid in SCENES]}

    def test_hash_change_invalidates_previously_complete_report(self):
        report = self.complete_gauntlet()
        self.assertEqual(check_gauntlet(report, self.root), [])
        (self.root / "run.json").write_text('{"changed":true}')
        self.assertTrue(any("changed" in issue for issue in check_gauntlet(report, self.root)))

    def test_present_file_is_not_enough_without_measured_execution(self):
        report = self.complete_gauntlet()
        test = report["scenes"][0]["tests"][0]
        test["measurements"] = {}
        test.pop("executed_at")
        issues = check_gauntlet(report, self.root)
        self.assertTrue(any("execution time" in issue for issue in issues))
        self.assertTrue(any("measured values" in issue for issue in issues))

    def test_failed_test_cannot_be_overridden_by_scene_validated(self):
        report = self.complete_gauntlet()
        report["scenes"][0]["tests"][0]["status"] = "fail"
        self.assertTrue(any("invalid validated=true" in x for x in check_gauntlet(report, self.root)))

    def test_missing_scene_and_nonfinite_metrics_rejected(self):
        report = self.complete_gauntlet()
        report["scenes"].pop()
        report["scenes"][0]["metrics"]["ghost_error_mean_cm"] = float("nan")
        issues = check_gauntlet(report, self.root)
        self.assertTrue(any("all five scenes" in x for x in issues))
        self.assertTrue(any("ghost_error_mean_cm" in x for x in issues))

    def test_hoop_net_cannot_be_waived_as_not_applicable(self):
        report = self.complete_gauntlet()
        report["scenes"][0]["tests"][3].update(status="not_applicable", reason="not implemented")
        self.assertTrue(any("N/A requires" in x for x in check_gauntlet(report, self.root)))

    def test_collision_and_impossible_verdict_counts_rejected(self):
        report = self.complete_gauntlet()
        report["scenes"][0]["metrics"].update(collisions=1, verdicts_correct=4)
        issues = check_gauntlet(report, self.root)
        self.assertTrue(any("collision count" in x for x in issues))
        self.assertTrue(any("exceed total" in x for x in issues))

    def test_private_paths_and_directory_traversal_rejected(self):
        (self.root / ".env").write_text("PRIVATE=example")
        for path in (".env", ".twinforge/credits.jsonl", "../run.json", "/etc/passwd"):
            with self.assertRaises(ValueError):
                relative_file(self.root, path)

    def test_packaging_includes_referenced_final_media_without_private_or_temporary_files(self):
        (self.root / "validation").mkdir()
        (self.root / "output/media").mkdir(parents=True)
        (self.root / "output/media/final.mp4").write_bytes(b"test media")
        (self.root / "output/media/unrelated.mp4").write_bytes(b"temporary")
        (self.root / ".env").write_text("PRIVATE=example")
        (self.root / "validation/submission.json").write_text(json.dumps({"assets": {"final_video": {"evidence": [{"path": "output/media/final.mp4", "sha256": "unused by inventory"}]}}}))
        inventory = b".env\x00output/media/final.mp4\x00output/media/unrelated.mp4\x00validation/submission.json\x00"
        with patch("validation.preflight.subprocess.run", return_value=SimpleNamespace(stdout=inventory)):
            paths = [name for name, _ in source_files(self.root)]
        self.assertIn("output/media/final.mp4", paths)
        self.assertNotIn("output/media/unrelated.mp4", paths)
        self.assertNotIn(".env", paths)

    def test_secret_warning_never_contains_token(self):
        fake = "ghp_" + "x" * 40
        path = self.root / "source.py"
        path.write_text("token = '" + fake + "'")
        findings = scan_secrets([("source.py", path)])
        self.assertEqual(len(findings), 1)
        self.assertNotIn(fake, json.dumps(findings))

    def test_configured_ablations_do_not_count_as_measured(self):
        report = {"comparisons": [{"id": ident, "status": "not_run"} for ident in ("sam_vs_naive_tracking", "calibrated_vs_prefit_physics")]}
        self.assertEqual(len(check_ablations(report, self.root)), 2)

    def test_media_presence_does_not_count_as_review_or_real_evidence(self):
        report = {"level": "L3", "assets": {"final_video": {"evidence": self.evidence, "duration_seconds": 150}}}
        issues = check_submission(report, self.root)
        self.assertTrue(any("not produced and reviewed" in x for x in issues))
        self.assertTrue(any("no independent complete filmed shot" in x for x in issues))

    def test_subtitles_must_cover_capture_without_silent_gaps(self):
        srt = self.root / "captions.srt"
        srt.write_text("1\n00:00:00,000 --> 00:00:03,000\nFirst\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond\n")
        with self.assertRaisesRegex(ValueError, "Uncaptioned gap"):
            subtitle_coverage(srt, 5)
        srt.write_text("1\n00:00:00,000 --> 00:00:05,000\nContinuous\n")
        self.assertEqual(subtitle_coverage(srt, 5)["covered_until_seconds"], 5)

    def test_webm_duration_uses_decoded_timestamps_when_metadata_is_missing(self):
        probe = SimpleNamespace(returncode=1, stderr="Duration: N/A", stdout="")
        decoded = SimpleNamespace(returncode=0, stderr="", stdout="out_time_us=5000000\nprogress=continue\nout_time_us=150033333\nprogress=end\n")
        with patch("validation.media.subprocess.run", side_effect=[probe, decoded]) as call:
            result = duration_seconds("ffmpeg", self.root / "capture.webm")
        self.assertAlmostEqual(result, 150.033333)
        self.assertIn("passthrough", call.call_args_list[-1].args[0])
        self.assertIn("null", call.call_args_list[-1].args[0])
        self.assertNotIn("-stream_loop", call.call_args_list[-1].args[0])

    def test_invalid_video_duration_is_not_invented(self):
        probe = SimpleNamespace(returncode=1, stderr="Duration: N/A", stdout="")
        failed = SimpleNamespace(returncode=1, stderr="invalid stream", stdout="out_time_us=0\n")
        with patch("validation.media.subprocess.run", side_effect=[probe, failed]):
            with self.assertRaisesRegex(ValueError, "Cannot determine"):
                duration_seconds("ffmpeg", self.root / "broken.webm")


if __name__ == "__main__":
    unittest.main()
