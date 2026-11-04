#!/usr/bin/env python3
"""Frozen HSV baseline versus saved SAM outputs, scored AFTER prediction.

Only video pixels, declared camera/ball calibration, and SAM's sampling indices
are available to the baseline. The evaluator truth file is opened only after
both outputs have been frozen and hashed. No API request is made here.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from perception.calibration import prepare,reconstruct
from perception.sam_perception import mask_features

BASELINE={"method":"largest_orange_HSV_contour","hsv_lower":[5,110,60],"hsv_upper":[25,255,255],
          "minimum_area_px":12,"maximum_image_area_fraction":.05,"association_gate_px":100,
          "identity_policy":"nearest previous centroid within gate; reset after any missing frame",
          "threshold_selection":"fixed generic orange-color rule; no tuning or sweep against evaluator truth"}
EVALUATION_THRESHOLD_PX=10.


def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def naive_detections(video,frame_ids,calibration):
    cap=cv2.VideoCapture(str(video))
    if not cap.isOpened():raise ValueError("cannot read source video")
    fps=cap.get(cv2.CAP_PROP_FPS);previous=None;active_id=None;next_id=1;output=[]
    try:
        for index in frame_ids:
            cap.set(cv2.CAP_PROP_POS_FRAMES,index);ok,image=cap.read()
            if not ok:raise ValueError(f"cannot decode sampled frame {index}")
            h,w=image.shape[:2];hsv=cv2.cvtColor(image,cv2.COLOR_BGR2HSV)
            mask=cv2.inRange(hsv,np.array(BASELINE["hsv_lower"],np.uint8),np.array(BASELINE["hsv_upper"],np.uint8))
            contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
            candidates=[c for c in contours if BASELINE["minimum_area_px"]<=cv2.contourArea(c)<=h*w*BASELINE["maximum_image_area_fraction"]]
            frame={"frame":index,"t":index/fps,"track_id":None,"centroid":None,"position_m":None,"quality":{"missing":True}}
            if not candidates:
                previous=None;active_id=None;output.append(frame);continue
            contour=max(candidates,key=cv2.contourArea)
            binary=np.zeros((h,w),np.uint8);cv2.drawContours(binary,[contour],-1,1,cv2.FILLED)
            decoded={"bounds":{"left":0,"top":0},"width":w,"height":h,"raster_base64":base64.b64encode(binary.tobytes()).decode(),
                     "polygons":[contour[:,0,:].astype(float).tolist()]}
            detection=mask_features(decoded,image_rgb=image[:,:,::-1]);centroid=detection["centroid"]
            if previous is None or math.dist(centroid,previous)>BASELINE["association_gate_px"]:
                active_id=next_id;next_id+=1
            frame.update(track_id=active_id,centroid=centroid,area=detection["area"],eccentricity=detection["eccentricity"],quality={"missing":False})
            try:
                frame["position_m"],frame["position_uncertainty"]=reconstruct(detection,calibration)
            except ValueError as error:frame["quality"]["reconstruction_error"]=str(error)
            previous=centroid;output.append(frame)
    finally:cap.release()
    return output


def score(predictions,truth):
    by_index={f["frame_index"]:f for f in truth["frames"]};rows=[];errors_px=[];errors_m=[];within=0
    last_id=None;switches=0;consecutive_same=0;prev=None
    for pred in predictions:
        expected=by_index[pred["frame"]]
        pixel=math.dist(pred["centroid"],expected["center_px"]) if pred.get("centroid") is not None else None
        world=math.dist(pred["position_m"],expected["position_m"]) if pred.get("position_m") is not None else None
        if pixel is not None:
            errors_px.append(pixel);within+=pixel<=EVALUATION_THRESHOLD_PX
            if last_id is not None and pred["track_id"]!=last_id:switches+=1
            last_id=pred["track_id"]
            if prev and prev.get("centroid") is not None and prev["track_id"]==pred["track_id"]:consecutive_same+=1
        if world is not None:errors_m.append(world)
        rows.append({"frame":pred["frame"],"t":pred["t"],"track_id":pred.get("track_id"),"centroid":pred.get("centroid"),"position_m":pred.get("position_m"),
                     "centroid_error_px":pixel,"position_error_m":world,"quality":pred.get("quality",{}),
                     "truth_center_px":expected["center_px"],"truth_position_m":expected["position_m"],"truth_occlusion":expected["occlusion"]})
        prev=pred
    return {"mean_centroid_error_px":statistics.mean(errors_px) if errors_px else None,"max_centroid_error_px":max(errors_px) if errors_px else None,
            "detection_rate":len(errors_px)/len(predictions),"detected":len(errors_px),"sampled":len(predictions),"missing":len(predictions)-len(errors_px),
            "within_10px_count":within,"within_10px_recall":within/len(predictions),"id_switches":switches,
            "consecutive_same_id_rate":consecutive_same/max(1,len(predictions)-1),
            "world_3d":{"measured_frames":len(errors_m),"mean_error_m":statistics.mean(errors_m) if errors_m else None,"max_error_m":max(errors_m) if errors_m else None},"per_frame":rows}


def run(args):
    sam=json.loads(Path(args.sam).read_text());frames=sam["frames"]
    ids=[f["frame"] for f in frames]
    if len(ids)<12 or ids!=sorted(set(ids)):raise ValueError("need at least 12 distinct ordered SAM sample frames")
    c=prepare(json.loads(Path(args.calibration).read_text()))
    if sam["provenance"].get("video_sha256")!=sha(args.video):raise ValueError("SAM and baseline source videos differ")
    # Freeze both outputs before touching any evaluator ground truth.
    predictions=naive_detections(args.video,ids,c)
    naive_snapshot=json.dumps({"source_kind":"synthetic","configuration":BASELINE,"frames":predictions},indent=2,allow_nan=False)+"\n"
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True);frozen=out.with_name(out.stem+"-naive-predictions.json")
    frozen.write_text(naive_snapshot)
    sam_snapshot=hashlib.sha256(json.dumps(frames,sort_keys=True).encode()).hexdigest()
    frozen_naive_sha=sha(frozen)
    truth=json.loads(Path(args.truth).read_text())
    if any(index not in {f["frame_index"] for f in truth["frames"]} for index in ids):raise ValueError("ground truth frame index mismatch")
    for frame in frames:
        target=next(f for f in truth["frames"] if f["frame_index"]==frame["frame"])
        if abs(frame["t"]-target["t"])>1e-8:raise ValueError("ground truth time mismatch")
    variants={"sam":score(frames,truth),"naive":score(predictions,truth)}
    common=[(a,b) for a,b in zip(variants["sam"]["per_frame"],variants["naive"]["per_frame"]) if a["centroid_error_px"] is not None and b["centroid_error_px"] is not None]
    common3d=[(a,b) for a,b in common if a["position_error_m"] is not None and b["position_error_m"] is not None]
    relative=lambda p:str(Path(p).resolve().relative_to(ROOT))
    evidence=[{"path":relative(p),"sha256":sha(p)} for p in (args.video,__file__,frozen)]
    report={"schema_version":"twinforge.perception_ablation.v1","executed_utc":datetime.now(timezone.utc).isoformat(),
            "source_kind":"synthetic","real_world_validation":False,"comparison":"sam_vs_naive_same_frames","frame_ids":ids,
            "source_video_sha256":sha(args.video),"ground_truth_sha256":sha(args.truth),"calibration_sha256":sha(args.calibration),
            "detector_configuration":BASELINE,"evaluation_threshold_px":EVALUATION_THRESHOLD_PX,"variants":variants,
            "paired_detected_frames":{"count":len(common),"sam_mean_px":statistics.mean(a["centroid_error_px"] for a,b in common) if common else None,
                                      "naive_mean_px":statistics.mean(b["centroid_error_px"] for a,b in common) if common else None},
            "paired_3d_frames":{"count":len(common3d),"sam_mean_m":statistics.mean(a["position_error_m"] for a,b in common3d) if common3d else None,
                                "naive_mean_m":statistics.mean(b["position_error_m"] for a,b in common3d) if common3d else None},
            "data_separation":{"truth_loaded_after_predictions_frozen":True,"sam_observation_frames_sha256":sam_snapshot,"naive_predictions_sha256":frozen_naive_sha,"new_api_requests":0},
            "limitations":["One deterministic synthetic video, not real-world generalization.","HSV baseline is specialized to an orange ball; SAM is prompted by concept.",
                           "Largest-contour baseline resets its identity after a missing frame; ID statistics must be read with that declared policy.",
                           "3D uses the same declared camera/diameter reconstruction for both; reported errors include silhouette/depth estimation.",
                           "Missing detections are counted explicitly and never assigned zero error."],"evidence":evidence}
    out.write_text(json.dumps(report,indent=2,allow_nan=False)+"\n")
    print(json.dumps({"out":str(out),"frames":len(ids),"sam_mean_px":variants["sam"]["mean_centroid_error_px"],"naive_mean_px":variants["naive"]["mean_centroid_error_px"],
                      "sam_found":variants["sam"]["detected"],"naive_found":variants["naive"]["detected"],"sam_mean_3d_m":variants["sam"]["world_3d"]["mean_error_m"],"naive_mean_3d_m":variants["naive"]["world_3d"]["mean_error_m"]}))
    return report


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("video","calibration","sam","truth"):parser.add_argument("--"+name,required=True)
    parser.add_argument("--out",default="validation/runs/synthetic-perception-comparison.json")
    run(parser.parse_args())
