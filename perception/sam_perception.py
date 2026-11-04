#!/usr/bin/env python3
"""SAM masks -> observations with provenance, calibration and uncertainty.

No metric scale is guessed. Missing detections remain missing frames. A planar
homography is labelled planar; a 3-component vector does not prove 3D depth.
"""
import argparse
import base64
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    from . import calibration as calib
except ImportError:
    import calibration as calib

SAM_MODEL = "sam-3.1"
_BOX_RE = re.compile(r"(\d+)<\|box;([^|]*)\|>(?:<\|mask;([^|]*)\|>)?")


def parse_sam_text(text):
    records=[]
    for m in _BOX_RE.finditer(text or ""):
        box={}
        for kv in m.group(2).split(";"):
            if "=" in kv:
                k,v=kv.split("=",1)
                try: box[k.strip()]=int(float(v))
                except ValueError: pass
        if not all(k in box for k in ("x1","x2","y1","y2")):
            continue
        mask=m.group(3).split("data=",1)[1] if m.group(3) and "data=" in m.group(3) else None
        records.append({"sam_id":int(m.group(1)),"box":box,"mask_data":mask})
    return records


def box_centroid(box):
    return ((box["x1"]+box["x2"])/2.,(box["y1"]+box["y2"])/2.)


def box_area(box):
    return max(0,box["x2"]-box["x1"])*max(0,box["y2"]-box["y1"])


def mask_features(decoded, scale=(1.,1.), image_rgb=None):
    """Centroid, area, orientation and eccentricity from every foreground pixel."""
    import numpy as np
    raster=np.frombuffer(base64.b64decode(decoded["raster_base64"]),dtype=np.uint8)
    if raster.size != decoded["width"]*decoded["height"]:
        raise ValueError("decoded mask dimensions disagree")
    mask=raster.reshape(decoded["height"],decoded["width"]).astype(bool)
    ys,xs=np.nonzero(mask)
    if len(xs)<1: raise ValueError("empty mask")
    b=decoded["bounds"]; sx,sy=scale
    xs=(xs.astype(float)+b["left"])*sx; ys=(ys.astype(float)+b["top"])*sy
    centroid=np.array([xs.mean(),ys.mean()]); q=np.stack((xs-centroid[0],ys-centroid[1]))
    cov=q@q.T/len(xs); vals,vecs=np.linalg.eigh(cov)
    direction=vecs[:,-1]
    # Exact half-pixel crossings of the binary mask; unlike OpenCV contour
    # foreground centres, these do not shrink the apparent sphere radius.
    padded=np.pad(mask,1)
    yh,xh=np.nonzero(padded[1:-1,1:]!=padded[1:-1,:-1])
    yv,xv=np.nonzero(padded[1:,1:-1]!=padded[:-1,1:-1])
    boundary=np.concatenate((np.column_stack(((xh-.5+b["left"])*sx,(yh+b["top"])*sy)),
                             np.column_stack(((xv+b["left"])*sx,(yv-.5+b["top"])*sy))))
    features={"centroid":centroid.tolist(),"area":float(len(xs)*sx*sy),
            "orientation_rad":math.atan2(float(direction[1]),float(direction[0])),
            "eccentricity":math.sqrt(max(0.,1-float(vals[0])/max(float(vals[1]),1e-12))),
            "polygons":[[[x*sx,y*sy] for x,y in p] for p in decoded["polygons"]],
            "boundary_samples_px":boundary.tolist(),
            "mask_decoded":True}
    if image_rgb is not None:
        h,w=image_rgb.shape[:2]
        color=np.median(image_rgb[np.clip(ys.astype(int),0,h-1),np.clip(xs.astype(int),0,w-1)],axis=0)
        features["color_rgb"]=color.tolist()
    return features


def decode_masks(text):
    result=subprocess.run(["node",str(Path(__file__).with_name("decode_masks.mjs")),"-"],
                          input=text,text=True,capture_output=True,timeout=30,check=False)
    if result.returncode:
        raise RuntimeError("SAM mask decoder failed (run npm install in perception): "+result.stderr[-1200:])
    return json.loads(result.stdout)["masks"]


class Tracker:
    """Trajectory association; loss/re-acquisition counts concern the primary ball."""
    def __init__(self,gate_px=90,max_missing=4):
        self.gate,self.max_missing=gate_px,max_missing
        self.tracks={}; self.next_id=1; self.primary_id=None; self.events=[]; self.primary_color=None
        self.stats={"fp01_losses":0,"fp01_loss_episodes":0,"fp01_reacquired":0,"frames":0,"id_switches":0}

    def update(self,detections,t):
        self.stats["frames"]+=1
        assigned=[]; used=set()
        def color_distance(a,b):
            if a is None or b is None: return 0.
            return math.dist([v/max(sum(a),1) for v in a],[v/max(sum(b),1) for v in b])
        def match(det,tr):
            c=det.get("centroid") or box_centroid(det["box"])
            dt=t-tr["t"]; pred=[tr["centroid"][i]+tr["vel"][i]*dt for i in range(2)]
            distance=math.dist(c,pred); color=color_distance(det.get("color_rgb"),tr.get("color_rgb"))
            if distance>self.gate or color>.30: return math.inf
            area=det.get("area",box_area(det["box"]))
            shape=abs(math.log(max(area,1)/max(tr.get("area",area),1)))
            return distance+self.gate*(2.5*color+.12*shape)
        ordered=sorted(detections,key=lambda d:-d.get("area",box_area(d["box"])))
        primary_detection=None
        if self.primary_id in self.tracks and ordered:
            costs=[match(d,self.tracks[self.primary_id]) for d in ordered]
            if math.isfinite(min(costs)):
                primary_detection=ordered[costs.index(min(costs))]
                ordered.remove(primary_detection); ordered.insert(0,primary_detection)
        for det in ordered:
            c=det.get("centroid") or box_centroid(det["box"])
            choices=[]
            for tid,tr in self.tracks.items():
                if tid in used or tid==self.primary_id: continue
                choices.append((match(det,tr),tid))
            distance,tid=min(choices,default=(math.inf,None))
            if det is primary_detection:
                tid=self.primary_id; distance=0.
            if tid is not None and math.isfinite(distance):
                tr=self.tracks[tid]
                if tr["missing"] and tid==self.primary_id:
                    self.stats["fp01_reacquired"]+=1
                    self.events.append({"t":t,"event":"fp01_reacquired","track_id":tid,"gap_frames":tr["missing"]})
                dt=max(t-tr["t"],1e-9)
                tr.update(centroid=c,vel=[(c[i]-tr["centroid"][i])/dt for i in range(2)],t=t,missing=0,hits=tr["hits"]+1,area=det.get("area",box_area(det["box"])))
                if det.get("color_rgb") is not None:
                    previous=tr.get("color_rgb") or det["color_rgb"]
                    tr["color_rgb"]=[.9*a+.1*b for a,b in zip(previous,det["color_rgb"])]
            else:
                tid=self.next_id; self.next_id+=1
                self.tracks[tid]={"centroid":c,"vel":[0.,0.],"t":t,"missing":0,"hits":1,"area":det.get("area",box_area(det["box"])),"color_rgb":det.get("color_rgb")}
                if self.primary_id is None and color_distance(det.get("color_rgb"),self.primary_color)<=.30:
                    if self.stats["frames"]>1: self.stats["id_switches"]+=1
                    self.primary_id=tid
                    if self.primary_color is None: self.primary_color=det.get("color_rgb")
            used.add(tid)
            assigned.append({**det,"centroid":c,"track_id":tid,"track_hits":self.tracks[tid]["hits"]})
        for tid,tr in list(self.tracks.items()):
            if tid not in used:
                tr["missing"]+=1
                if tid==self.primary_id:
                    self.stats["fp01_losses"]+=1
                    if tr["missing"]==1:
                        self.stats["fp01_loss_episodes"]+=1
                        self.events.append({"t":t,"event":"fp01_lost","track_id":tid})
                if tr["missing"]>self.max_missing:
                    del self.tracks[tid]
                    if tid==self.primary_id: self.primary_id=None
        eligible=[d for d in assigned if color_distance(d.get("color_rgb"),self.primary_color)<=.30]
        if self.primary_id is None and eligible:
            self.primary_id=max(eligible,key=lambda d:d["track_hits"])["track_id"]
            self.stats["id_switches"]+=1
        return assigned


def sampled_frame_indices(total_frames, source_fps, requested_fps):
    """Nearest source frame to each requested timestamp, without round-stride drift."""
    rate=min(source_fps,requested_fps)
    if total_frames<1 or min(source_fps,rate)<=0: return []
    count=math.ceil(total_frames/source_fps*rate)
    return sorted({min(total_frames-1,int(math.floor(i*source_fps/rate+.5))) for i in range(count)})


def flag_fp02(frames):
    if not frames: return []
    areas=[f.get("area",box_area(f["box"])) for f in frames]
    med=statistics.median(areas) or 1
    flags=[]
    for f,a in zip(frames,areas):
        box=f["box"]; aspect=max(1,box["x2"]-box["x1"])/max(1,box["y2"]-box["y1"])
        flags.append(a<.45*med or a>2.2*med or aspect>2.2 or aspect<.25 or (f.get("eccentricity") or 0)>.94)
    return flags


def apply_homography(H,point):
    return tuple(calib.project(H,point))


def world_from_scale(centroid,rim_centroid,rim_width_px,rim_y_m=None,rim_diameter_m=None,board_height_px=None,board_height_m=None):
    """Legacy explicit-scale utility. No regulation dimensions are supplied implicitly."""
    if rim_y_m is None or rim_diameter_m is None:
        raise ValueError("measured rim height and diameter must be supplied explicitly")
    sx=rim_diameter_m/max(rim_width_px,1)
    sy=board_height_m/board_height_px if board_height_px and board_height_m else sx
    return ((centroid[0]-rim_centroid[0])*sx,rim_y_m+(rim_centroid[1]-centroid[1])*sy,0.)


def add_velocities(frames):
    """Local linear fit on the same contiguous ID; never bridge missing/outlier frames."""
    import numpy as np
    for i,f in enumerate(frames):
        f["velocity_m_s"]=None; f["velocity_uncertainty_m_s"]=None
        if f.get("position_m") is None or f.get("quality",{}).get("fp02_outlier"): continue
        indices=[i]
        for direction in (-1,1):
            for k in (1,2):
                j=i+direction*k
                if j<0 or j>=len(frames): break
                q=frames[j]
                if q.get("position_m") is None or q.get("track_id")!=f.get("track_id") or q.get("quality",{}).get("fp02_outlier"): break
                indices.append(j)
        if len(indices)<2: continue
        tt=np.asarray([frames[j]["t"]-f["t"] for j in indices]); pp=np.asarray([frames[j]["position_m"] for j in indices])
        A=np.column_stack((np.ones(len(tt)),tt)); coeff,_,_,_=np.linalg.lstsq(A,pp,rcond=None)
        f["velocity_m_s"]=coeff[1].tolist()
        if len(tt)>2:
            residual=pp-A@coeff
            sig=np.sqrt(np.sum(residual**2,axis=0)/(len(tt)-2)/max(np.sum((tt-tt.mean())**2),1e-12))
            f["velocity_uncertainty_m_s"]=sig.tolist()


def detect_events(points,rim=None,geometry=None,dimensions=0):
    """Geometric tests carry confidence; image-plane crossing is never a made basket."""
    events=[]; geometry=geometry or {}
    valid=[p for p in points if p.get("centroid") is not None]
    if len(valid)<3: return events
    for i in range(1,len(valid)-1):
        a,b,c=valid[i-1:i+2]
        if a.get("track_id")!=b.get("track_id") or c.get("track_id")!=b.get("track_id"): continue
        if any(q.get("quality",{}).get("fp02_outlier") for q in (a,b,c)): continue
        dt0,dt1=b["t"]-a["t"],c["t"]-b["t"]
        if min(dt0,dt1)<=0 or max(dt0,dt1)>.3: continue
        pos=[q.get("position_m") for q in (a,b,c)]
        if all(p is not None for p in pos):
            v0=[(pos[1][j]-pos[0][j])/dt0 for j in range(3)]
            v1=[(pos[2][j]-pos[1][j])/dt1 for j in range(3)]
            if v0[1]>0>=v1[1]: events.append({"t":b["t"],"event":"apex","track_id":b.get("track_id")})
            for surface in geometry.get("planes",[]):
                n=surface["normal"]; d=sum((pos[1][j]-surface["point"][j])*n[j] for j in range(3))
                radius=geometry.get("ball_radius_m",0.)
                before=sum(v0[j]*n[j] for j in range(3)); after=sum(v1[j]*n[j] for j in range(3))
                if abs(d-radius)<=geometry.get("contact_tolerance_m",.06) and before<-.1 and after>.05:
                    events.append({"t":b["t"],"event":"bounce","surface":surface.get("name","plane"),
                                   "normal":n,"v_before_m_s":v0,"v_after_m_s":v1,"track_id":b.get("track_id"),"confidence":"sampled"})
            hoop=geometry.get("hoop")
            if hoop:
                n=hoop.get("normal",[0,1,0]); center=hoop["center"]
                da=sum((pos[0][j]-center[j])*n[j] for j in range(3)); db=sum((pos[1][j]-center[j])*n[j] for j in range(3))
                if da>0>=db:
                    alpha=da/(da-db); cross=[pos[0][j]+alpha*(pos[1][j]-pos[0][j]) for j in range(3)]
                    inside=math.dist(cross,center)+geometry.get("ball_radius_m",0)<hoop["inner_radius_m"]
                    events.append({"t":a["t"]+alpha*dt0,"event":"hoop_crossing","inside":inside if dimensions==3 else None,
                                   "projected_inside":inside,"confidence":"metric_3d" if dimensions==3 else "plane_only"})
        else:
            v0=(b["centroid"][1]-a["centroid"][1])/dt0; v1=(c["centroid"][1]-b["centroid"][1])/dt1
            if v0<0<=v1: events.append({"t":b["t"],"event":"apex","confidence":"image_projection"})
        if rim:
            rc,rb=rim["centroid"],rim["box"]
            if a["centroid"][1]<rc[1]<=b["centroid"][1] and rb["x1"]<=b["centroid"][0]<=rb["x2"]:
                events.append({"t":b["t"],"event":"rim_cross_down","confidence":"image_projection","inside":None})
    velocities=[(q,math.sqrt(sum(v*v for v in q["velocity_m_s"]))) for q in valid if q.get("velocity_m_s")]
    if velocities:
        first=next(((q,s) for q,s in velocities if s>.3),None)
        if first: events.insert(0,{"t":first[0]["t"],"event":"launch","confidence":"first_observed_motion"})
        for i in range(2,len(velocities)):
            group=velocities[i-2:i+1]
            if all(s<.08 for _,s in group) and group[-1][0]["t"]-group[0][0]["t"]>=.15:
                events.append({"t":group[0][0]["t"],"event":"rest","confidence":"three_slow_samples"}); break
    return events


def sam_segment_image(image_bytes,concept,client,max_side=640):
    from PIL import Image
    im=Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if max(im.size)>max_side: im.thumbnail((max_side,max_side))
    buf=io.BytesIO(); im.save(buf,"JPEG",quality=90)
    response=client.segment(base64.b64encode(buf.getvalue()).decode(),concept,scene="hoop")
    text="".join(c.get("text","") for item in response.get("output",[]) for c in item.get("content",[]) if c.get("type")=="output_text")
    return response,text,im.size


def run_pipeline(args, client=None):
    import cv2
    import numpy as np
    from twinforge_runtime.providers import ModelClient, ProviderUnavailable
    from twinforge_runtime.budget import BudgetExceeded
    out=Path(args.out)
    if (out/"trajectories.json").exists() and not args.overwrite:
        raise ValueError("output dataset exists; choose a new --out or explicitly pass --overwrite")
    out.mkdir(parents=True,exist_ok=True); raw=out/"raw"; raw.mkdir(exist_ok=True)
    config=json.loads(Path(args.calibration).read_text()) if args.calibration else None
    calibration=calib.prepare(config)
    secondary=json.loads(Path(args.secondary_dataset).read_text())["frames"] if args.secondary_dataset else []
    if calibration["mode"]=="stereo" and not secondary: raise ValueError("stereo mode needs --secondary-dataset")
    cap=cv2.VideoCapture(args.video)
    if not cap.isOpened(): raise ValueError("unreadable video")
    src_fps=cap.get(cv2.CAP_PROP_FPS)
    if src_fps<=0: raise ValueError("video needs valid timestamps/frame rate")
    actual_fps=min(src_fps,args.sample_fps)
    total_frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    last_frame=min(total_frames-1,math.floor(args.max_seconds*src_fps)) if args.max_seconds else total_frames-1
    sample_indices=set(sampled_frame_indices(last_frame+1,src_fps,actual_fps))
    expected_samples=len(sample_indices)
    tracker=Tracker(args.gate,args.max_missing); client=client or ModelClient()
    frames=[]; statics={}; writer=None; frame_no=-1
    stop_reason="video_complete"; stop_message=None
    prompts={"ball":["ball","basketball"],"vertical hoop":["vertical hoop","basketball hoop","hoop"],"backboard":["backboard"]}

    def segment(jpg,concept,width,height,frame_id):
        for attempt,prompt in enumerate(prompts[concept]):
            response,text,size=sam_segment_image(jpg,prompt,client)
            stem=f"{frame_id:06d}_{concept.replace(' ','_')}_{attempt}"
            (raw/(stem+".json")).write_text(json.dumps({"concept":concept,"prompt":prompt,"resized":size,"response":response},indent=2))
            (raw/(stem+".txt")).write_text(text)
            recs=parse_sam_text(text)
            if not recs: continue
            decoded={str(m["object_id"]):m for m in decode_masks(text)}
            result=[]; sx,sy=width/size[0],height/size[1]
            for r in recs:
                b=r["box"]
                r["box"]={"x1":b["x1"]*sx,"x2":(b["x2"]+1)*sx,"y1":b["y1"]*sy,"y2":(b["y2"]+1)*sy,"w":width,"h":height}
                m=decoded.get(str(r["sam_id"]))
                if m:
                    r.update(mask_features(m,(sx,sy),image[:,:,::-1]))
                    # Keep exact compressed wire mask plus raw response, and mask geometry.
                    r["raw_response"]="raw/"+stem+".json"
                    result.append(r)
                elif args.allow_box_fallback:
                    r.update(centroid=box_centroid(r["box"]),area=box_area(r["box"]),polygons=[],orientation_rad=None,eccentricity=None,mask_decoded=False,raw_response="raw/"+stem+".json")
                    result.append(r)
            if result: return result
        return []

    try:
        while True:
            ok,image=cap.read()
            if not ok: break
            frame_no+=1; t=frame_no/src_fps
            if args.max_seconds and t>args.max_seconds: break
            if frame_no not in sample_indices: continue
            h,w=image.shape[:2]
            _,jpg=cv2.imencode(".jpg",image,[cv2.IMWRITE_JPEG_QUALITY,92])
            assigned=tracker.update(segment(jpg.tobytes(),"ball",w,h,frame_no),t)
            main=next((d for d in assigned if d["track_id"]==tracker.primary_id),None)
            f={"t":t,"frame":frame_no,"track_id":main["track_id"] if main else None,
               "position_m":None,"world_m":None,"velocity_m_s":None,"centroid":main["centroid"] if main else None,
               "quality":{"missing":main is None,"fp02_outlier":False,"mask_decoded":bool(main and main["mask_decoded"]),"contact":False}}
            if main:
                f.update({k:main[k] for k in ("box","area","orientation_rad","eccentricity","polygons","mask_data","raw_response")})
                f["color_rgb"]=main.get("color_rgb")
                other=None
                if secondary:
                    candidates=[q for q in secondary if q.get("centroid") is not None]
                    other=min(candidates,key=lambda q:abs(q["t"]+calibration.get("secondary_time_offset_s",0)-t),default=None)
                    if other and abs(other["t"]+calibration.get("secondary_time_offset_s",0)-t)>calibration.get("sync_tolerance_s",.025): other=None
                try:
                    p,unc=calib.reconstruct(main,calibration,other)
                    f.update(position_m=p,world_m=p,position_uncertainty=unc)
                except ValueError as exc:
                    f["quality"]["reconstruction_error"]=str(exc)
                for poly in main["polygons"]:
                    cv2.polylines(image,[np.asarray(poly,dtype=np.int32)],True,(0,220,70),1)
                cv2.circle(image,tuple(int(x) for x in main["centroid"]),4,(20,100,255),-1)
            frames.append(f)
            for prev in frames[-25:]:
                if prev.get("centroid"): cv2.circle(image,tuple(int(x) for x in prev["centroid"]),2,(230,180,40),-1)
            label=f"t={t:.3f}s  "+(f"ball ID {main['track_id']}" if main else "FP-01 missing detection")
            cv2.putText(image,label,(12,28),cv2.FONT_HERSHEY_SIMPLEX,.65,(255,255,255),2)
            cv2.putText(image,calibration["mode"],(12,55),cv2.FONT_HERSHEY_SIMPLEX,.55,(255,255,255),1)
            if writer is None:
                writer=cv2.VideoWriter(str(out/"annotated.mp4"),cv2.VideoWriter_fourcc(*"mp4v"),actual_fps,(w,h))
                if not writer.isOpened(): raise RuntimeError("annotated video encoder unavailable")
            writer.write(image)
            print(label,flush=True)
            # A cost stop on a static concept must not discard the ball frame just measured.
            if (len(frames)-1)%args.static_every==0:
                for concept in ("vertical hoop","backboard"):
                    dets=segment(jpg.tobytes(),concept,w,h,frame_no)
                    if dets: statics[concept]=max(dets,key=lambda d:d["area"])
    except BudgetExceeded as exc:
        stop_reason="budget_exhausted"; stop_message=str(exc)
        print("PERCEPTION PARTIAL: "+stop_message,file=sys.stderr,flush=True)
    except ProviderUnavailable as exc:
        stop_reason="provider_unavailable"; stop_message=str(exc)
        print("PERCEPTION PARTIAL: "+stop_message,file=sys.stderr,flush=True)
    finally:
        cap.release()
        if writer: writer.release()
    valid=[f for f in frames if f.get("box")]
    for f,flag in zip(valid,flag_fp02(valid)): f["quality"]["fp02_outlier"]=bool(flag)
    add_velocities(frames)
    geometry=(config or {}).get("geometry",{})
    events=detect_events(frames,statics.get("vertical hoop"),geometry,calibration["dimensions_observed"])+tracker.events
    events.sort(key=lambda e:e["t"])
    for f in frames:
        f["events"]=[e["event"] for e in events if abs(e["t"]-f["t"])<.5/actual_fps]
        f["quality"]["contact"]=any(e["event"] in ("bounce","rest") and abs(e["t"]-f["t"])<=2/actual_fps for e in events)
    video=Path(args.video); sha=hashlib.sha256(video.read_bytes()).hexdigest()
    if stop_reason=="video_complete" and len(frames)<expected_samples:
        stop_reason="video_ended_early"; stop_message="Video decoding ended before all expected sampled frames."
    tracking={**tracker.stats,"sampled_frames":len(frames),"ball_frames_found":len(valid),
              "continuity":len(valid)/max(1,len(frames)),"distinct_ids":sorted({f["track_id"] for f in valid}),
              "fp02_frames":sum(f["quality"]["fp02_outlier"] for f in valid)}
    full=len(valid)>=6 and calibration["dimensions_observed"]==3 and all(f.get("position_m") is not None for f in valid)
    status="ready_for_independent_validation" if stop_reason=="video_complete" and full and len(tracking["distinct_ids"])==1 and tracking["continuity"]>=.95 else "partial"
    completion={"status":"complete" if stop_reason=="video_complete" else "partial","reason":stop_reason,
                "message":stop_message,"processed_frames":len(frames),"expected_sample_frames":expected_samples}
    budget=client.ledger.summary()
    dataset={"schema_version":"twinforge.dataset.v1","shot_id":args.shot_id or sha[:16],
             "provenance":{"kind":args.source_kind,"video_name":video.name,"video_sha256":sha,"created_utc":datetime.now(timezone.utc).isoformat(),"model":SAM_MODEL,"raw_responses":"raw/",
                           "collection_mode":getattr(client,"collection_mode","live_provider")},
             "calibration":calibration,"geometry":geometry,"sample_fps":actual_fps,"frames":frames,"events":events,"tracking":tracking,"statics":statics,
             "status":status,"completion":completion,"budget":budget,
             "observed_outcome":next((e["inside"] for e in events if e["event"]=="hoop_crossing" and e.get("inside") is not None),None)}
    (out/"trajectories.json").write_text(json.dumps(dataset,indent=2,allow_nan=False))
    report=["# Perception run",f"Status: **{status}** (not an L1/gauntlet GO)",f"Source: {args.source_kind}; SHA256 {sha}",
            f"Frames: {len(valid)}/{len(frames)}; IDs: {tracking['distinct_ids']}; lost frames {tracking['fp01_losses']}; loss episodes {tracking['fp01_loss_episodes']}; re-acquisitions {tracking['fp01_reacquired']}",
            f"FP-02: {tracking['fp02_frames']} frames; calibration: {calibration['mode']}; observed dimensions: {calibration['dimensions_observed']}",
            *calibration["limitations"],f"Collection: {stop_reason}; processed {len(frames)}/{expected_samples} sampled frames. {stop_message or ''}",
            "Budget evidence: "+json.dumps(budget,sort_keys=True),
            ("Full" if stop_reason=="video_complete" else "Partial")+" sampled annotated video: annotated.mp4. Raw API responses: raw/.",
            "No unobserved depth, missing frame or unknown basket outcome is filled with a guessed value."]
    (out/"report.md").write_text("\n\n".join(report)+"\n")
    return 0


def main(argv=None, client=None):
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video",required=True); ap.add_argument("--out",required=True)
    ap.add_argument("--calibration","--fiducials",dest="calibration",default="")
    ap.add_argument("--secondary-dataset",default="")
    ap.add_argument("--source-kind",choices=("real","synthetic","unknown"),default="unknown")
    ap.add_argument("--shot-id",default=""); ap.add_argument("--sample-fps",type=float,default=8.)
    ap.add_argument("--static-every",type=int,default=6); ap.add_argument("--gate",type=float,default=175.)
    ap.add_argument("--max-missing",type=int,default=4); ap.add_argument("--max-seconds",type=float,default=0.)
    ap.add_argument("--allow-box-fallback",action="store_true"); ap.add_argument("--overwrite",action="store_true")
    args=ap.parse_args(argv)
    if args.sample_fps<=0 or args.static_every<1: ap.error("positive sampling rate and static interval required")
    try: return run_pipeline(args, client=client)
    except (ValueError,RuntimeError,OSError) as exc:
        print(f"PERCEPTION INCOMPLETE: {exc}",file=sys.stderr); return 2


if __name__=="__main__": raise SystemExit(main())
