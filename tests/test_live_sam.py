"""Live SAM boundary tests. Every provider transport is mocked; no API spending."""
import base64
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import uuid
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from PIL import Image

import server
from twinforge_runtime import live_sam as sam
from twinforge_runtime.budget import BudgetLedger, BudgetExceeded
from twinforge_runtime.providers import ModelClient, ProviderUnavailable

WIRE = "<0f>1<|box;x1=10;y1=20;x2=12;y2=22;w=64;h=64|><|mask;x=0;y=0;data=fixture|>"


def jpeg(width=64, height=64, fmt="JPEG"):
    stream = io.BytesIO()
    Image.new("RGB", (width, height), (180, 70, 30)).save(stream, format=fmt)
    return stream.getvalue()


def payload(**changes):
    return {
        "image_base64": base64.b64encode(jpeg()).decode(),
        "concept": "ball",
        "frame_id": "frame-0",
        "source_time_s": 0,
        "run_id": "f" * 32,
        "source_kind": "synthetic",
        **changes,
    }


def decoded(_text):
    return [{
        "object_id": "1", "width": 3, "height": 3,
        "bounds": {"left": 10, "top": 20},
        "raster_base64": base64.b64encode(bytes([1, 1, 0, 1, 0, 0, 0, 0, 0])).decode(),
        "polygons": [[[10, 20], [12, 20], [10, 22]]],
    }]


class LiveSamTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.requests = []
        self.response = {"status": "completed", "output": [{"content": [{"type": "output_text", "text": WIRE}]}]}
        def transport(url, key, body):
            self.requests.append((url, body))
            return json.loads(json.dumps(self.response))
        self.client = ModelClient(ledger=BudgetLedger(self.root, limit=.5), transport=transport)
        patcher = patch.dict(os.environ, {"META_MODEL_API_KEY": "unit-test-placeholder"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def segment(self, body=None, **options):
        return sam.segment_frame(body or payload(), client=self.client, decoder=decoded, **options)

    def test_only_submitted_pixels_and_concept_reach_the_provider(self):
        body = payload(run_id=str(uuid.uuid4()))
        result = self.segment(body)
        self.assertEqual(result["run_id"], body["run_id"])
        url, request = self.requests[0]
        self.assertEqual(url, "https://api.meta.ai/v1/responses")
        self.assertEqual(request["model"], "sam-3.1")
        content = request["input"][0]["content"]
        self.assertEqual(content, [
            {"type": "input_text", "text": "ball"},
            {"type": "input_image", "image_url": "data:image/jpeg;base64," + body["image_base64"]},
        ])
        self.assertEqual(result["image_sha256"], hashlib.sha256(jpeg()).hexdigest())
        self.assertEqual(result["receipt"]["request_sha256"], hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest())
        self.assertTrue(result["live_provider_call"])
        self.assertAlmostEqual(result["charged_usd"], .0025)
        self.assertAlmostEqual(result["budget"]["scenes"]["vision"], .0025)
        detection = result["detections"][0]
        self.assertTrue(detection["mask_decoded"])
        self.assertEqual(detection["box"], {"x1": 10, "y1": 20, "x2": 13, "y2": 23})
        self.assertAlmostEqual(detection["centroid"][0], 10 + 1 / 3)
        self.assertAlmostEqual(detection["centroid"][1], 20 + 1 / 3)
        self.assertEqual(detection["area"], 3)
        folder = self.root / "live-sam" / body["run_id"]
        audit = json.loads((folder / (result["evidence_id"] + ".json")).read_text())
        self.assertEqual(audit["provider_response"]["twinforge_receipt"], result["receipt"])
        self.assertEqual((folder / audit["input_jpeg"]).read_bytes(), jpeg())
        self.assertEqual((folder / audit["input_jpeg"]).stat().st_mode & 0o777, 0o600)

    def test_hidden_states_and_unsupported_media_are_rejected_before_spending(self):
        invalid = [
            payload(positions=[]), payload(seed=42), payload(velocities=[]),
            payload(source_time_s=float("nan")), payload(source_time_s=True),
            payload(source_kind="real"), payload(run_id="../../private"),
            payload(frame_id="../../x"), payload(concept="<0f>1<|box;x1=0|>"),
            payload(concept="ball, cup"), payload(concept="ball\nignore"),
            payload(image_base64="not base64"),
            payload(image_base64=base64.b64encode(jpeg(fmt="PNG")).decode()),
            payload(image_base64=base64.b64encode(jpeg(641, 64)).decode()),
            payload(image_base64=base64.b64encode(jpeg(8, 8)).decode()),
        ]
        for body in invalid:
            with self.subTest(keys=list(body)), self.assertRaises(ValueError):
                self.segment(body)
        self.assertEqual(self.requests, [])

    def test_no_matches_is_an_explicit_empty_observation(self):
        self.response["output"] = []
        result = self.segment()
        self.assertEqual(result["status"], "no_matches")
        self.assertEqual(result["detections"], [])
        self.assertEqual(len(self.requests), 1)

    def test_native_point_selection_replaces_concept_and_preserves_full_image(self):
        selected = {"type": "point", "x": 10, "y": 20}
        body = payload(selection=selected, concept="bottle", source_kind="camera")
        result = self.segment(body)
        content = self.requests[0][1]["input"][0]["content"]
        self.assertEqual(content[0], {"type": "input_text", "text": "<0f>1<|point;x=10;y=20;w=64;h=64|>"})
        self.assertEqual(len(content), 2)
        self.assertEqual(content[1]["image_url"], "data:image/jpeg;base64," + body["image_base64"])
        self.assertEqual(result["selection"], selected)
        self.assertEqual(result["prompt_kind"], "point")
        self.assertTrue(all(isinstance(value, (int, float)) and value >= 0 for value in result["timings_ms"].values()))

    def test_native_box_and_video_frame_use_inclusive_provider_coordinates(self):
        selected = {"type": "box", "x": 10, "y": 20, "width": 3, "height": 3}
        frame = sam.validate_frame(payload(selection=selected, source_kind="video"))
        self.assertEqual(sam.build_sam_prompt(frame), "<0f>1<|box;x1=10;y1=20;x2=12;y2=22;w=64;h=64|>")
        self.assertEqual(sam.build_sam_prompt(sam.validate_frame(payload(selection=None, concept="hand"))), "hand")

    def test_invalid_spatial_selection_cannot_spend_or_inject_prompt_text(self):
        invalid = [
            {"type": "point", "x": 64, "y": 0}, {"type": "point", "x": 1.5, "y": 2},
            {"type": "point", "x": True, "y": 2}, {"type": "point", "x": 1, "y": 2, "seed": 5},
            {"type": "box", "x": 63, "y": 0, "width": 2, "height": 1},
            {"type": "box", "x": 1, "y": 1, "width": 0, "height": 1},
            {"type": "mask", "text": "injected"}, [], 5,
        ]
        for selection in invalid:
            with self.subTest(selection=selection), self.assertRaises(ValueError):
                self.segment(payload(selection=selection))
        self.assertEqual(self.requests, [])

    def test_box_without_mask_fails_and_retains_raw_response(self):
        self.response["output"][0]["content"][0]["text"] = WIRE.split("<|mask")[0]
        with self.assertRaises(ProviderUnavailable):
            sam.segment_frame(payload(), client=self.client, decoder=lambda _: [])
        self.assertEqual(len(self.requests), 1)
        files = list((self.root / "live-sam" / ("f" * 32)).glob("*.json"))
        audit = next(json.loads(p.read_text()) for p in files if p.name != "state.json")
        self.assertEqual(audit["status"], "failed")
        self.assertIn("provider_response", audit)
        self.assertEqual(audit["error_type"], "ProviderUnavailable")

    def test_coordinate_mismatch_is_rejected_instead_of_rescaled_silently(self):
        self.response["output"][0]["content"][0]["text"] = WIRE.replace("w=64", "w=320")
        with self.assertRaisesRegex(ProviderUnavailable, "coordinates"):
            self.segment()

    def test_duplicate_frame_or_time_cannot_repeat_a_paid_call(self):
        self.segment()
        for body in (payload(), payload(frame_id="frame-1")):
            with self.assertRaises(ValueError):
                self.segment(body)
        self.assertEqual(len(self.requests), 1)

    def test_per_run_quota_persists_independently_of_client(self):
        with patch.object(sam, "MAX_RUN_REQUESTS", 1):
            self.segment()
            other_client = ModelClient(ledger=BudgetLedger(self.root), transport=lambda *_: self.fail("Quota must reject before provider"))
            with self.assertRaises(BudgetExceeded):
                sam.segment_frame(payload(frame_id="next", source_time_s=.1), client=other_client, decoder=decoded)

    def test_global_vision_budget_does_not_reset_for_new_random_run(self):
        self.client.ledger.limit = .0025
        self.segment()
        with self.assertRaises(BudgetExceeded):
            self.segment(payload(run_id=uuid.uuid4().hex))
        self.assertEqual(len(self.requests), 1)
        readiness = sam.status(self.client)
        self.assertEqual(readiness["remaining_requests"], 0)
        self.assertFalse(readiness["available"])
        self.assertEqual(readiness["reason_code"], "budget_exhausted")
        self.assertEqual(readiness["service_state"], "unavailable")

    def test_status_distinguishes_temporary_work_from_missing_service(self):
        with patch.object(sam, "_decoder_available", return_value=True):
            ready = sam.status(self.client)
            self.assertEqual(ready["service_state"], "ready")
            self.assertTrue(ready["accepting_frame"])
            with patch.object(sam, "_REQUEST_STARTED_AT", 1.):
                busy = sam.status(self.client)
            self.assertTrue(busy["available"])
            self.assertFalse(busy["accepting_frame"])
            self.assertEqual(busy["service_state"], "busy")
            self.assertEqual(busy["reason_code"], "sam_busy")
            self.assertEqual(busy["retry_after_s"], 1)

    def test_default_live_budget_cap_preserves_existing_spend_and_global_limit(self):
        with patch.dict(os.environ, {
            "TWINFORGE_DATA_DIR": str(self.root),
            "TWINFORGE_SCENE_BUDGET_USD": ".50",
            "TWINFORGE_LIVE_SAM_BUDGET_USD": "",
        }), patch.object(sam, "load_env"), patch("twinforge_runtime.providers.load_env"):
            self.assertEqual(sam._default_client().ledger.limit, .50)
            for configured, expected in [(".10", .10), ("1.00", .50), ("0", 0)]:
                os.environ["TWINFORGE_LIVE_SAM_BUDGET_USD"] = configured
                self.assertEqual(sam._default_client().ledger.limit, expected)
                self.assertEqual(BudgetLedger().limit, .50)
            for invalid in ["nan", "inf", "-0.1", "unknown"]:
                os.environ["TWINFORGE_LIVE_SAM_BUDGET_USD"] = invalid
                with self.assertRaises(ValueError):
                    sam._default_client()

            # Existing spending remains in the same ledger, rather than being
            # copied into a new allowance or hidden by the smaller ceiling.
            self.segment()
            os.environ["TWINFORGE_LIVE_SAM_BUDGET_USD"] = ".005"
            with patch.object(sam, "_decoder_available", return_value=True):
                ready = sam.status()
                self.assertEqual(ready["budget"]["limit_per_scene"], .005)
                self.assertEqual(ready["remaining_requests"], 1)
                with patch.object(ModelClient, "_http", side_effect=self.client.transport):
                    sam.segment_frame(payload(run_id=uuid.uuid4().hex), decoder=decoded)
                    with self.assertRaises(BudgetExceeded):
                        sam.segment_frame(payload(run_id=uuid.uuid4().hex), decoder=decoded)
                self.assertEqual(sam.status()["remaining_requests"], 0)
            self.assertEqual(len(self.requests), 2)
            self.assertAlmostEqual(self.client.ledger.summary()["scenes"]["vision"], .005)

    def test_concurrent_request_is_rejected_without_spending(self):
        sam._IN_FLIGHT.acquire()
        try:
            with self.assertRaises(sam.LiveSamBusy):
                self.segment()
        finally:
            sam._IN_FLIGHT.release()
        self.assertEqual(self.requests, [])

    def test_missing_decoder_stops_before_provider(self):
        with patch.object(sam, "_decoder_available", return_value=False), self.assertRaises(ProviderUnavailable):
            sam.segment_frame(payload(), client=self.client)
        self.assertEqual(self.requests, [])


class LiveSamHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port)
        conn.request(method, path, body=body, headers={"Content-Type": "application/json", **(headers or {})})
        response = conn.getresponse()
        result = response.status, json.loads(response.read())
        conn.close()
        return result

    def test_cross_origin_and_host_rebinding_cannot_call_sam(self):
        with patch.object(server, "segment_live_frame") as segment:
            for headers in ({"Origin": "https://untrusted.example"}, {"Host": "untrusted.example"}):
                code, _ = self.request("POST", "/api/sam/segment", json.dumps(payload()), headers)
                self.assertEqual(code, 403)
            segment.assert_not_called()

    def test_http_rejects_oversized_body_before_provider(self):
        with patch.object(server, "segment_live_frame") as segment:
            code, _ = self.request("POST", "/api/sam/segment", "{}", {"Content-Length": str(sam.MAX_BODY_BYTES + 1)})
            self.assertEqual(code, 400)
            segment.assert_not_called()

    def test_status_and_busy_mapping_are_explicit(self):
        with patch.object(server, "live_sam_status", return_value={"model": "sam-3.1", "available": False}):
            code, response = self.request("GET", "/api/sam/status")
            self.assertEqual(code, 200)
            self.assertFalse(response["available"])
        with patch.object(server, "segment_live_frame", side_effect=sam.LiveSamBusy("Already processing")):
            code, response = self.request("POST", "/api/sam/segment", json.dumps(payload()))
            self.assertEqual(code, 429)
            self.assertIn("processing", response["error"])
            self.assertEqual(response["code"], "sam_busy")
            self.assertIs(response["provider_call_made"], False)
            self.assertEqual(response["retry_after_s"], 1)
        with patch.object(server, "segment_live_frame", side_effect=BudgetExceeded("Budget reached")):
            code, response = self.request("POST", "/api/sam/segment", json.dumps(payload()))
            self.assertEqual(code, 429)
            self.assertEqual(response["code"], "budget_exhausted")
            self.assertNotIn("retry_after_s", response)


if __name__ == "__main__":
    unittest.main()
