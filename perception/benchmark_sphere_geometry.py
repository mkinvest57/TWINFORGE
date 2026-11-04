#!/usr/bin/env python3
"""Analytic pinhole sphere masks on unseen cameras/radii; no fixture truth input."""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from perception.calibration import prepare,reconstruct
from perception.sam_perception import mask_features


def run(output):
    rng=np.random.default_rng(903117);rows=[]
    # These independent cases test geometry and quantization, not SAM accuracy.
    for index in range(24):
        width,height=640,480;focal=float(rng.uniform(480,940))
        K=np.array([[focal,0,320],[0,focal*rng.uniform(.92,1.08),240],[0,0,1.]])
        distance=float(rng.uniform(2.3,6.3));radius=float(rng.uniform(.065,.19))
        axis=np.array([rng.uniform(-.19,.19),rng.uniform(-.14,.14),1.]);axis/=np.linalg.norm(axis)
        centre=axis*distance;offset=.5 if index%2 else 0.
        angle=float(rng.uniform(-1,1));R=np.array([[math.cos(angle),0,math.sin(angle)],[0,1,0],[-math.sin(angle),0,math.cos(angle)]])
        translation=rng.uniform(-2,2,3)
        calibration=prepare({"mode":"sphere_size","camera_matrix":K.tolist(),"camera_to_world_rotation":R.tolist(),
                             "camera_to_world_translation_m":translation.tolist(),"ball_diameter_m":2*radius,
                             "diameter_uncertainty_m":0.,"pixel_uncertainty":.5,"pixel_center_offset_px":offset})
        yy,xx=np.mgrid[:height,:width]
        rays=np.stack((xx+offset,yy+offset,np.ones_like(xx)),axis=-1)@np.linalg.inv(K).T
        rays/=np.linalg.norm(rays,axis=-1)[:,:,None]
        # Closed-form ray/sphere intersection, independent of fitted cone code.
        projection=rays@centre
        raster=((projection>0)&(projection**2>=centre@centre-radius**2)).astype(np.uint8)
        decoded={"width":width,"height":height,"bounds":{"left":0,"top":0},"polygons":[],
                 "raster_base64":base64.b64encode(raster.tobytes()).decode()}
        detection=mask_features(decoded)
        estimated,uncertainty=reconstruct(detection,calibration)
        expected=R@centre+translation;error=float(np.linalg.norm(np.array(estimated)-expected))
        std=float(np.linalg.norm(uncertainty["position_std_m"]))
        rows.append({"case":index,"camera_focal_px":focal,"radius_m":radius,"range_m":distance,
                     "pixel_center_offset_px":offset,"foreground_pixels":int(raster.sum()),"error_m":error,
                     "reported_position_std_norm_m":std,"inside_reported_std_norm":error<=std})
    report={"schema_version":"twinforge.geometry_benchmark.v1","source_kind":"analytic_synthetic", "real_world_validation":False,
            "method":"24 fixed-seed independent pinhole cameras, poses, radii and ranges; binary ray/sphere intersection masks",
            "evaluation_separation":"Camera and measured sphere diameter only enter reconstruction; sphere centres are evaluator-only.",
            "configuration_frozen_before_fixture_evaluation":True,"seed":903117,"cases":rows,
            "mean_error_m":float(np.mean([r["error_m"] for r in rows])),"max_error_m":max(r["error_m"] for r in rows),
            "within_reported_std_norm":sum(r["inside_reported_std_norm"] for r in rows),
            "limitations":["Ideal binary masks quantify geometry and rasterization only; no segmentation or calibration bias.",
                           "Conditional uncertainty includes pixel floor, not an empirically calibrated confidence interval."],
            "evidence":[{"path":str(Path(__file__).relative_to(ROOT)),"sha256":hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}]}
    Path(output).write_text(json.dumps(report,indent=2,allow_nan=False)+"\n")
    print(json.dumps({k:v for k,v in report.items() if k in ("mean_error_m","max_error_m","within_reported_std_norm")}))
    return report


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out",default="validation/runs/sphere-geometry-analytic-v2.json")
    run(parser.parse_args().out)
