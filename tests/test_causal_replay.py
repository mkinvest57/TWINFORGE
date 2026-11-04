"""Forecasts must not read future positions or hide unsupported errors."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from induction.induce import normalize_dataset
from induction.replay import estimate_causal_state, benchmark_replay
from induction.synthetic_benchmark import generate_shot


class CausalReplayTests(unittest.TestCase):
    def setUp(self):
        self.parameters={"g":9.7,"drag":.04,"wind":[.2,0,-.1]}
        self.data,_=generate_shot("test-causal",[-1,1.7,.1],[5,6,.3],801,self.parameters,duration=1.2,sigma_m=0.)
        self.twin={"numeric":self.parameters}

    def test_future_position_changes_cannot_change_current_forecast_state(self):
        state,reason=estimate_causal_state(self.data["frames"],.4,self.twin)
        self.assertIsNone(reason)
        changed=deepcopy(self.data)
        for f in changed["frames"]:
            if f["t"]>.4:f["position_m"]=[1e4,-1e4,1e4]
        second,_=estimate_causal_state(changed["frames"],.4,self.twin)
        np.testing.assert_allclose(state["position_m"],second["position_m"],atol=1e-10)
        np.testing.assert_allclose(state["velocity_m_s"],second["velocity_m_s"],atol=1e-10)
        self.assertTrue(all(t<=.4 for t in state["state_estimation"]["sample_times"]))

    def test_unsupported_future_contact_stays_in_global_error(self):
        first=benchmark_replay(self.data,self.twin,source_times=[.3])
        changed=deepcopy(self.data)
        changed["frames"][12]["quality"]["contact"]=True
        second=benchmark_replay(changed,self.twin,source_times=[.3])
        self.assertEqual(first["all_issued_scorable"],second["all_issued_scorable"])
        self.assertEqual(first["supported"]["count"],1)
        self.assertEqual(second["supported"]["count"],0)
        self.assertIn("contact_or_unsupported_regime",second["forecasts"][0]["unsupported_reasons"])

    def test_no_future_frame_used_to_fill_initial_velocity(self):
        state,reason=estimate_causal_state(self.data["frames"],.05,self.twin)
        self.assertIsNone(state)
        self.assertEqual(reason,"insufficient_causal_history")

    def test_same_family_rollout_state_removes_constant_acceleration_bias(self):
        result=benchmark_replay(self.data,self.twin)
        self.assertGreater(result["all_issued_scorable"]["count"],3)
        self.assertLess(result["all_issued_scorable"]["max_cm"],1.5)
        self.assertGreater(result["rejected"],0)

    def test_schema_wrapping_does_not_erase_legacy_contact_policy(self):
        data=deepcopy(self.data)
        data["calibration"]["mode"]="legacy_assumed_scale"
        data["events"]=[{"event":"rim_cross_down","t":.6}]
        normalized=normalize_dataset(data)
        self.assertTrue(all(f["quality"].get("contact") for f in normalized["frames"] if f["t"]>=.6))
        self.assertIn("not a measured impact",normalized["frames"][-1]["quality"]["regime_reason"])


if __name__=="__main__":unittest.main()
