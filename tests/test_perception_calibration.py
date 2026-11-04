"""Geometry and evidence tests, with no API requests or assumed real footage."""
import base64
import json
import math
from pathlib import Path
import shutil
import importlib.util
import tempfile
from types import SimpleNamespace
from unittest.mock import patch
import sys
import unittest
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from perception import calibration as cal
from perception import sam_perception as sp


class CalibrationTests(unittest.TestCase):
    def test_plane_is_explicitly_not_observed_depth(self):
        c=cal.prepare({"mode":"plane_homography","points_px":[[0,0],[100,0],[100,100],[0,100]],"points_m":[[0,0],[1,0],[1,1],[0,1]]})
        p,u=cal.reconstruct({"centroid":[50,70]},c)
        np.testing.assert_allclose(p,[.5,.7,0],atol=1e-9)
        self.assertEqual(c["dimensions_observed"],2)
        self.assertEqual(u["depth"],"unobserved")

    def test_uncalibrated_has_no_invented_metres(self):
        self.assertEqual(cal.reconstruct({"centroid":[50,70]},cal.prepare(None)),(None,None))

    def test_example_template_cannot_pass_as_measurement(self):
        with self.assertRaisesRegex(ValueError,"measured calibration"):
            cal.prepare({"example_only":True})

    def test_degenerate_markers_rejected(self):
        with self.assertRaisesRegex(ValueError,"degenerate"):
            cal.homography([[0,0],[1,0],[2,0],[3,0]],[[0,0],[1,0],[2,0],[3,0]])

    def test_stereo_known_point_and_bad_match(self):
        K=np.array([[800,0,320],[0,800,240],[0,0,1.]])
        P=K@np.column_stack((np.eye(3),np.zeros(3)))
        Q=K@np.column_stack((np.eye(3),[-.4,0,0]))
        c=cal.prepare({"mode":"stereo","projection_left":P.tolist(),"projection_right":Q.tolist()})
        X=np.array([.2,.1,3.,1.]); l=P@X; r=Q@X
        point,unc=cal.reconstruct({"centroid":(l[:2]/l[2]).tolist()},c,{"centroid":(r[:2]/r[2]).tolist()})
        np.testing.assert_allclose(point,X[:3],atol=1e-8)
        self.assertGreater(unc["position_std_m"][2],0)
        with self.assertRaisesRegex(ValueError,"reprojection"):
            cal.triangulate(l[:2]/l[2],r[:2]/r[2]+[0,100],c)

    def test_sphere_angular_depth_requires_measured_diameter(self):
        c=cal.prepare({"mode":"sphere_size","camera_matrix":[[800,0,320],[0,800,240],[0,0,1]],
                       "camera_to_world_rotation":np.eye(3).tolist(),"camera_to_world_translation_m":[0,0,0],
                       "ball_diameter_m":.24,"diameter_uncertainty_m":.002})
        rho=800*math.tan(math.asin(.12/3.))
        polygon=[[320+rho*math.cos(t),240+rho*math.sin(t)] for t in np.linspace(0,2*math.pi,100)]
        p,u=cal.reconstruct({"centroid":[320,240],"mask_decoded":True,"eccentricity":0.,"polygons":[polygon]},c)
        np.testing.assert_allclose(p,[0,0,3],atol=1e-8)
        self.assertIsInstance(p,list)
        json.dumps({"position_m":p,"position_uncertainty":u},allow_nan=False)
        self.assertGreater(u["depth_std_m"],0)
        with self.assertRaisesRegex(ValueError,"complete"):
            cal.reconstruct({"centroid":[320,240],"mask_decoded":False},c)

    def test_off_axis_spheres_different_intrinsics_radii_and_coordinate_conventions(self):
        # Analytic tangent cones, independent of the renderer/video fixture.
        for focal,centre,radius,offset in [(430,[1.2,-.7,2.7],.065,0.),
                                           (970,[-2.1,1.3,5.2],.18,.5),
                                           (710,[.4,2.1,4.8],.11,0.)]:
            K=np.array([[focal,0,301],[0,focal*.91,217],[0,0,1.]])
            axis=np.array(centre)/np.linalg.norm(centre);alpha=math.asin(radius/np.linalg.norm(centre))
            u=np.cross(axis,[0,1,0]);u/=np.linalg.norm(u);v=np.cross(axis,u)
            rays=np.array([axis*math.cos(alpha)+(u*math.cos(t)+v*math.sin(t))*math.sin(alpha) for t in np.linspace(0,2*math.pi,160,endpoint=False)])
            projected=rays@K.T;polygon=projected[:,:2]/projected[:,2,None]-offset
            c=cal.prepare({"mode":"sphere_size","camera_matrix":K.tolist(),"camera_to_world_rotation":np.eye(3).tolist(),
                           "camera_to_world_translation_m":[.1,-.3,.2],"ball_diameter_m":2*radius,"diameter_uncertainty_m":.001,
                           "pixel_center_offset_px":offset})
            # Deliberately biased 2D centroid must not set the 3D cone axis.
            detection={"centroid":(polygon.mean(axis=0)+[2,-1]).tolist(),"mask_decoded":True,"eccentricity":.4,"polygons":[polygon.tolist()]}
            p,unc=cal.reconstruct(detection,c)
            np.testing.assert_allclose(p,np.array(centre)+[.1,-.3,.2],atol=1e-8)
            self.assertEqual(unc["pixel_center_offset_px"],offset)

    def test_robust_cone_with_sparse_boundary_errors(self):
        K=np.array([[650,0,300],[0,650,240],[0,0,1.]])
        axis=np.array([.3,-.2,1.]);axis/=np.linalg.norm(axis);distance=3.7;radius=.13
        u=np.cross(axis,[0,1,0]);u/=np.linalg.norm(u);v=np.cross(axis,u);alpha=math.asin(radius/distance)
        rays=np.array([axis*math.cos(alpha)+(u*math.cos(t)+v*math.sin(t))*math.sin(alpha) for t in np.linspace(0,2*math.pi,160,endpoint=False)])
        pixels=rays@K.T;pixels=pixels[:,:2]/pixels[:,2,None]
        pixels[::17]+=[3,-2]
        fitted,angle,sigma,_=cal.sphere_tangent_cone(pixels,K,.5)
        estimated=fitted*radius/math.sin(angle)
        self.assertLess(np.linalg.norm(estimated-axis*distance),.04)
        self.assertGreaterEqual(sigma,.5/650)


class MaskTests(unittest.TestCase):
    def test_mask_centroid_is_not_box_center(self):
        m={"width":3,"height":3,"bounds":{"left":10,"top":20},"raster_base64":base64.b64encode(bytes([1,1,0,1,0,0,0,0,0])).decode(),"polygons":[[[10,20],[12,20],[10,22]]]}
        f=sp.mask_features(m)
        np.testing.assert_allclose(f["centroid"],[10+1/3,20+1/3])
        self.assertEqual(f["area"],3.)
        self.assertTrue(f["mask_decoded"])
        self.assertIsNotNone(f["orientation_rad"])
        self.assertIn([9.5,20.],f["boundary_samples_px"])

    @unittest.skipUnless(shutil.which("node") and (Path(__file__).resolve().parents[1]/"perception/node_modules/@meta-sam/parser").exists(),"npm install in perception enables actual parser test")
    def test_actual_sam_decoder_preserves_mask_geometry(self):
        # Captured protocol example shipped by the installed parser, not API/real-scene evidence.
        readme=(Path(__file__).resolve().parents[1]/"perception/node_modules/@meta-sam/parser/README.md").read_text()
        line=next(l for l in readme.splitlines() if "27,60," in l)
        payload=line.split("data=")[1].split("|>")[0]
        text="<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data="+payload+"|>\n"
        masks=sp.decode_masks(text)
        self.assertEqual(len(masks),1)
        self.assertGreater(sp.mask_features(masks[0])["area"],0)
        self.assertGreater(len(masks[0]["polygons"]),0)


class EventEvidenceTests(unittest.TestCase):
    def test_requested_eight_fps_does_not_round_down_to_six(self):
        indices=sp.sampled_frame_indices(12,12.,8.)
        self.assertEqual(len(indices),8)
        self.assertEqual(len(set(indices)),8)
        self.assertIn(3,indices)

    def test_primary_ball_is_not_stolen_by_a_nearby_ghost_track(self):
        def det(x,color):
            return {"box":{"x1":x-5,"x2":x+5,"y1":0,"y2":10},"centroid":[x,5],"area":100,"color_rgb":color}
        orange=[220,110,30]; cyan=[40,180,220]
        tr=sp.Tracker(175,4)
        tr.update([det(10,orange),det(100,cyan)],0)
        tr.update([det(60,orange),det(65,cyan)],.1)
        assigned=tr.update([det(100,orange),det(60,cyan)],.2)
        main=next(d for d in assigned if d["track_id"]==tr.primary_id)
        self.assertEqual(main["centroid"],[100,5])
        self.assertEqual(main["track_id"],1)
        self.assertEqual(tr.stats["fp01_losses"],0)

    def test_velocity_does_not_bridge_missing_frame(self):
        frames=[{"t":i*.1,"position_m":[i*.1,2*i*.1,0],"track_id":1,"quality":{}} for i in range(6)]
        frames[2]["position_m"]=None
        frames[3]["position_m"]=[100,100,0]
        sp.add_velocities(frames)
        np.testing.assert_allclose(frames[1]["velocity_m_s"],[1,2,0])
        self.assertIsNone(frames[2]["velocity_m_s"])

    def test_projection_crossing_never_claims_basket(self):
        points=[{"t":i*.1,"centroid":[50,y],"track_id":1} for i,y in enumerate((20,40,60,80))]
        events=sp.detect_events(points,{"centroid":[50,50],"box":{"x1":40,"x2":60}})
        crossing=next(e for e in events if e["event"]=="rim_cross_down")
        self.assertIsNone(crossing["inside"])

    def test_metric_bounce_records_normal_velocities(self):
        frames=[{"t":i*.1,"centroid":[20,20],"position_m":[0,y,0],"track_id":1,"quality":{}} for i,y in enumerate((.3,.1,.2,.3))]
        geometry={"ball_radius_m":.1,"planes":[{"name":"floor","point":[0,0,0],"normal":[0,1,0]}]}
        events=sp.detect_events(frames,geometry=geometry,dimensions=3)
        e=next(e for e in events if e["event"]=="bounce")
        self.assertAlmostEqual(e["v_before_m_s"][1],-2)
        self.assertAlmostEqual(e["v_after_m_s"][1],1)

    def test_spurious_track_does_not_count_primary_reacquisition(self):
        def det(x): return {"box":{"x1":x-5,"x2":x+5,"y1":0,"y2":10},"centroid":[x,5],"area":100}
        tr=sp.Tracker(20,4)
        tr.update([det(10),det(200)],0)
        tr.update([det(11)],.1)
        tr.update([det(12),det(200)],.2)
        self.assertEqual(tr.stats["fp01_reacquired"],0)


@unittest.skipUnless(importlib.util.find_spec("cv2") and shutil.which("node") and (Path(__file__).resolve().parents[1]/"perception/node_modules/@meta-sam/parser").exists(),"OpenCV and npm parser enable full video pipeline smoke")
class PipelineSmokeTests(unittest.TestCase):
    def test_complete_sphere_calibrated_dataset_serializes_xyz(self):
        import cv2
        cx,cy,radius=160,167,15
        yy,xx=np.mgrid[:334,:320];raster=((xx-cx)**2+(yy-cy)**2<=radius**2).astype(np.uint8)
        polygon=[[cx+radius*math.cos(t),cy+radius*math.sin(t)] for t in np.linspace(0,2*math.pi,60)]
        decoded={"object_id":"0","width":320,"height":334,"bounds":{"left":0,"top":0},"polygons":[polygon],"raster_base64":base64.b64encode(raster.tobytes()).decode()}
        class Client:
            def __init__(self):self.ledger=SimpleNamespace(summary=lambda:{"fixture":True,"requests":0})
            def segment(self,*_args,**_kwargs):
                return {"output":[{"content":[{"type":"output_text","text":"<0f>0<|box;x1=145;y1=152;x2=175;y2=182;w=320;h=334|><|mask;x=0;y=0;data=fixture|>"}]}]}
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);video=p/"synthetic.mp4";calibration=p/"camera.json"
            calibration.write_text(json.dumps({"mode":"sphere_size","camera_matrix":[[800,0,cx],[0,800,cy],[0,0,1]],"camera_to_world_rotation":np.eye(3).tolist(),"camera_to_world_translation_m":[0,0,0],"ball_diameter_m":.24,"diameter_uncertainty_m":.001}))
            writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*"mp4v"),10,(320,334))
            for _ in range(6):
                image=np.zeros((334,320,3),np.uint8);image[raster.astype(bool)]=[30,120,230];writer.write(image)
            writer.release()
            args=SimpleNamespace(out=str(p/"run"),overwrite=False,calibration=str(calibration),secondary_dataset="",video=str(video),sample_fps=10.,gate=175,max_missing=4,static_every=20,max_seconds=0.,allow_box_fallback=False,source_kind="synthetic",shot_id="sphere-export")
            with patch.object(sp,"decode_masks",lambda _text:[decoded]):sp.run_pipeline(args,client=Client())
            result=json.loads((p/"run/trajectories.json").read_text())
            self.assertEqual(result["calibration"]["dimensions_observed"],3)
            self.assertEqual(len(result["frames"]),6)
            self.assertTrue(all(isinstance(f["position_m"],list) and len(f["position_m"])==3 for f in result["frames"]))

    def test_budget_stop_preserves_measured_frames_and_cost_evidence(self):
        import cv2
        from twinforge_runtime.budget import BudgetExceeded
        readme=(Path(__file__).resolve().parents[1]/"perception/node_modules/@meta-sam/parser/README.md").read_text()
        payload=next(l for l in readme.splitlines() if "27,60," in l).split("data=")[1].split("|>")[0]
        sample="<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data="+payload+"|>\n"
        class LimitedClient:
            def __init__(self):
                self.calls=0
                self.ledger=SimpleNamespace(summary=lambda:{"fixture":True,"scenes":{"hoop":.0025},"requests":1})
            def segment(self,*_args,**_kwargs):
                self.calls+=1
                if self.calls>1: raise BudgetExceeded("fixture budget exhausted")
                return {"output":[{"content":[{"type":"output_text","text":sample}]}]}
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder); video=p/"synthetic.mp4"
            writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*"mp4v"),10,(320,334))
            for _ in range(6): writer.write(np.zeros((334,320,3),np.uint8))
            writer.release()
            args=SimpleNamespace(out=str(p/"run"),overwrite=False,calibration="",secondary_dataset="",video=str(video),
                                 sample_fps=10.,gate=175,max_missing=4,static_every=20,max_seconds=0.,allow_box_fallback=False,
                                 source_kind="synthetic",shot_id="budget-smoke")
            with patch("twinforge_runtime.providers.ModelClient",LimitedClient):
                self.assertEqual(sp.run_pipeline(args),0)
            d=json.loads((p/"run/trajectories.json").read_text())
            self.assertEqual(len(d["frames"]),1)
            self.assertEqual(d["completion"]["reason"],"budget_exhausted")
            self.assertEqual(d["status"],"partial")
            self.assertEqual(d["budget"]["scenes"]["hoop"],.0025)
            self.assertIn("Partial sampled annotated video",(p/"run/report.md").read_text())
            self.assertTrue((p/"run/annotated.mp4").exists())

    def test_full_video_keeps_missing_frame_and_raw_mask_evidence(self):
        import cv2
        readme=(Path(__file__).resolve().parents[1]/"perception/node_modules/@meta-sam/parser/README.md").read_text()
        payload=next(l for l in readme.splitlines() if "27,60," in l).split("data=")[1].split("|>")[0]
        sample="<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data="+payload+"|>\n"
        class FakeClient:
            def __init__(self):
                self.balls=0
                self.ledger=SimpleNamespace(summary=lambda:{"fixture":True,"requests":0})
            def segment(self,image_b64,concept,scene):
                if concept=="ball": self.balls+=1
                missing=self.balls==2 and concept in ("ball","basketball")
                return {"output":[{"content":[{"type":"output_text","text":"" if missing else sample}]}],"test_fixture":True}
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder); video=p/"synthetic.mp4"
            writer=cv2.VideoWriter(str(video),cv2.VideoWriter_fourcc(*"mp4v"),10,(320,334))
            self.assertTrue(writer.isOpened())
            for _ in range(6): writer.write(np.zeros((334,320,3),np.uint8))
            writer.release()
            args=SimpleNamespace(out=str(p/"run"),overwrite=False,calibration="",secondary_dataset="",video=str(video),
                                 sample_fps=10.,gate=175,max_missing=4,static_every=20,max_seconds=0.,allow_box_fallback=False,
                                 source_kind="synthetic",shot_id="smoke")
            with patch("twinforge_runtime.providers.ModelClient",FakeClient):
                sp.run_pipeline(args)
            data=json.loads((p/"run/trajectories.json").read_text())
            self.assertEqual(len(data["frames"]),6)
            self.assertTrue(data["frames"][1]["quality"]["missing"])
            self.assertEqual(data["tracking"]["fp01_losses"],1)
            self.assertEqual(data["tracking"]["fp01_reacquired"],1)
            self.assertTrue(data["frames"][0]["quality"]["mask_decoded"])
            self.assertIsNone(data["frames"][0]["position_m"])
            self.assertTrue(list((p/"run/raw").glob("*.json")))
            cap=cv2.VideoCapture(str(p/"run/annotated.mp4"))
            self.assertEqual(int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),6)
            cap.release()


if __name__=="__main__": unittest.main()
