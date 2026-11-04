"""Independent-shot evidence and calibrated physics tests (all fixtures synthetic)."""
from copy import deepcopy
import json
import math
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from induction import induce
from induction.simulator import rollout, step
from twinforge_runtime.scientist import calibrate
from twinforge_runtime.budget import BudgetExceeded


def shot(name,g=9.7,drag=.015,wind=(.2,0,-.1),vx=4.7):
    # Independent ODE integration with small midpoint steps for fixture generation.
    p=np.array([-2.,1.7,.3]); v=np.array([vx,5.8,.7]); frames=[]; dt=.0005
    for i in range(1801):
        if i%100==0:
            frames.append({"t":i*dt,"position_m":p.tolist(),"world_m":p.tolist(),"track_id":1,"quality":{"fp02_outlier":False}})
        a=np.asarray(wind)-[0,g,0]-drag*np.linalg.norm(v)*v
        vm=v+a*dt/2
        am=np.asarray(wind)-[0,g,0]-drag*np.linalg.norm(vm)*vm
        p+=vm*dt; v+=am*dt
    return {"schema_version":"twinforge.dataset.v1","shot_id":name,"provenance":{"kind":"synthetic","video_sha256":name},
            "calibration":{"metric":True,"dimensions_observed":3,"mode":"synthetic_fixture"},"frames":frames,"events":[]}


class SplitTests(unittest.TestCase):
    def test_renamed_duplicate_and_same_video_rejected(self):
        a=shot("A"); b=deepcopy(a); b["shot_id"]="B"; b["provenance"]["video_sha256"]="B"
        with self.assertRaisesRegex(ValueError,"leakage"):
            induce.assert_disjoint_splits([a],[],[b])
        b=shot("B",vx=6.); b["provenance"]["video_sha256"]="A"
        with self.assertRaisesRegex(ValueError,"leakage"):
            induce.assert_disjoint_splits([a],[b],[])

    def test_test_observations_cannot_change_fitted_parameters(self):
        train=shot("train"); test=shot("test",g=15.,vx=6.)
        model=induce.fit_family([train],"quadratic_drag")
        before=deepcopy(model["parameters"])
        result=induce.evaluate(model,[test])
        self.assertEqual(model["parameters"],before)
        self.assertGreater(result["mean_error_cm"],10)
        with self.assertRaisesRegex(ValueError,"fitted"):
            induce.evaluate(model,[train])

    def test_no_independent_test_means_null_not_training_error(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder); source=p/"train.json"; source.write_text(json.dumps(shot("train")))
            args=SimpleNamespace(train=[str(source)],validation=[],test=[],trajectories=None,family="auto",
                                 out_json=str(p/"twin.json"),out_journal=str(p/"journal.md"),bundle=str(p/"bundle.json"))
            induce.run(args)
            result=json.loads((p/"twin.json").read_text())
            self.assertIsNone(result["held_out_cm"])
            self.assertEqual(result["level"],"L3")
            self.assertEqual(result["family"],"gravity")

    def test_independent_validation_selects_then_test_scores_frozen_model(self):
        train=shot("train",drag=.05); validation=shot("validation",drag=.05,vx=6.1); test=shot("test",drag=.05,vx=3.2)
        induce.assert_disjoint_splits([train],[validation],[test])
        candidates=[induce.fit_family([train],f) for f in induce.FAMILIES]
        selected=min(candidates,key=lambda fit:induce.evaluate(fit,[validation])["mean_error_cm"])
        self.assertEqual(selected["family"],"quadratic_drag")
        score=induce.evaluate(selected,[test])
        self.assertLess(score["mean_error_cm"],3.)
        self.assertEqual(len(score["shots"]),1)


class CalibrationFitTests(unittest.TestCase):
    def test_recovers_3d_acceleration_from_positions(self):
        fit=induce.fit_family([shot("A")],"quadratic_drag")
        self.assertAlmostEqual(fit["numeric"]["g"],9.7,delta=.1)
        self.assertAlmostEqual(fit["numeric"]["drag"],.015,delta=.003)
        self.assertAlmostEqual(fit["numeric"]["wind"][2],-.1,delta=.08)
        self.assertIsNone(fit["parameters"]["friction"]["value"])
        self.assertIsNone(fit["parameters"]["restitution"]["value"])

    def test_contacts_excluded_before_differentiation(self):
        data=shot("A")
        data["frames"][8]["position_m"]=[50,50,50]
        data["events"]=[{"t":.4,"event":"bounce"}]
        samples=induce.free_flight_samples(data["frames"],events=data["events"])
        self.assertTrue(all(abs(s["t"]-.4)>.1 for s in samples))
        fit=induce.fit_family([data],"quadratic_drag")
        self.assertAlmostEqual(fit["numeric"]["g"],9.7,delta=.2)

    def test_restitution_is_measured_and_surface_specific(self):
        data=shot("A")
        data["events"]=[{"t":2.,"event":"bounce","surface":"floor","normal":[0,1,0],"v_before_m_s":[1,-4,0],"v_after_m_s":[1,2.8,0]}]
        measured=induce.measure_restitution([data])
        self.assertAlmostEqual(measured["floor"]["value"],.7)
        self.assertIsNone(measured["floor"]["uncertainty"])

    def test_uncalibrated_input_cannot_be_called_physics(self):
        data=shot("A"); data["calibration"]={"metric":False,"dimensions_observed":0}
        with self.assertRaisesRegex(ValueError,"metric calibration"):
            induce.fit_family([data])


class SimulatorTests(unittest.TestCase):
    def test_gravity_changes_actual_3d_motion(self):
        path=rollout([0,2,1],[2,3,.5],{"g":10,"drag":0,"wind":[0,0,0]},[.4])
        np.testing.assert_allclose(path[0]["position"],[.8,2+1.2-.8,1.2],atol=.005)

    def test_contact_refuses_unknown_coefficients(self):
        geometry={"ball_radius_m":.1,"planes":[{"point":[0,0,0],"normal":[0,1,0],"name":"floor"}]}
        state={"position":[0,.09,0],"velocity":[0,-1,0]}
        with self.assertRaisesRegex(ValueError,"restitution"):
            step(state,{"g":10,"drag":0},.002,geometry)
        bounced=step(state,{"g":10,"drag":0,"restitution":.8,"friction":.2},.002,geometry)
        self.assertGreater(bounced["velocity"][1],0)
        self.assertEqual(bounced["contacts"][0]["surface"],"floor")


class ScientificRunnerTests(unittest.TestCase):
    class Client:
        def __init__(self,fail_after=None):
            self.calls=[]; self.fail_after=fail_after
            self.ledger=SimpleNamespace(summary=lambda:{"fixture":True,"scenes":{}})
        def chat(self,messages,**kwargs):
            self.calls.append(messages)
            if self.fail_after is not None and len(self.calls)>self.fail_after:
                raise BudgetExceeded("fixture budget reached")
            family="gravity" if len(self.calls)==1 else "quadratic_drag"
            content=json.dumps({"family":family,"reason":"unit test plan based on observations","next_test":"score validation"})
            return {"choices":[{"message":{"content":content}}],"twinforge_receipt":{"fixture":True}}

    def test_budget_stop_keeps_fitted_candidate_without_test_leak(self):
        client=self.Client(fail_after=1)
        test=shot("PRIVATE_TEST_SHOT",g=12,vx=6.4)
        bundle=calibrate([shot("train")],[shot("validation",vx=5.8)],[test],client=client,threshold_cm=.00001)
        self.assertEqual(bundle["twin"]["family"],"gravity")
        self.assertEqual(bundle["scientist"]["stop_reason"],"budget_exhausted_best_available")
        self.assertNotIn("PRIVATE_TEST_SHOT",json.dumps(client.calls))
        self.assertIsNotNone(bundle["twin"]["validation"]["test_result"]["mean_error_cm"])
        self.assertEqual(bundle["twin"]["numeric"]["g"],bundle["twin"]["parameters"]["g"]["value"])

    def test_no_validation_stops_after_first_choice_without_false_accuracy(self):
        client=self.Client()
        bundle=calibrate([shot("train")],client=client)
        self.assertEqual(len(client.calls),1)
        self.assertIsNone(bundle["twin"]["held_out_cm"])
        self.assertEqual(bundle["twin"]["level"],"L3")
        self.assertIn("observations",json.dumps(client.calls))


if __name__=="__main__": unittest.main()
