#!/usr/bin/env python3
"""Calibrate known L3 physics families using independent shots.

Train chooses coefficients, validation chooses family, test scores once after
selection. No test shot or suffix of a training shot is labelled held-out.
Muse may select these bounded families; this module does not claim free induction.
Historical artifacts are preserved; new outputs default to induction/current/.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys
import numpy as np
try:
    from .simulator import rollout, numeric_parameters
    from .trajectory_fit import refine as refine_trajectories
except ImportError:
    from simulator import rollout, numeric_parameters
    from trajectory_fit import refine as refine_trajectories

FAMILIES=("gravity","quadratic_drag")


def fingerprint(dataset):
    """Observations fingerprint ignores labels/metadata so renamed copies still collide."""
    frames=[{"t":f["t"],"p":f.get("position_m",f.get("world_m")),"centroid":f.get("centroid"),"id":f.get("track_id")} for f in dataset["frames"]]
    return hashlib.sha256(json.dumps(frames,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


def normalize_dataset(data,source="memory"):
    d=deepcopy(data)
    if d.get("schema_version")=="twinforge.bundle.v1": d=d["dataset"]
    if not isinstance(d.get("frames"),list) or not d["frames"]: raise ValueError("dataset has no frames")
    legacy=not d.get("schema_version")
    d.setdefault("schema_version","twinforge.dataset.v1")
    d.setdefault("provenance",{"kind":"unknown","legacy":True,"video_name":d.get("video")})
    d.setdefault("shot_id",d.get("video") or fingerprint(d)[:16])
    d.setdefault("calibration",{"mode":"legacy_assumed_scale","metric":True,"dimensions_observed":2,
                                "limitations":["Historical pixel-to-metre scale used assumed regulation dimensions; not calibrated real-world 3D."]})
    for f in d["frames"]:
        f.setdefault("position_m",f.get("world_m")); f.setdefault("velocity_m_s",None)
        f.setdefault("quality",{})
        p=f.get("position_m")
        if p is not None and (len(p)!=3 or not all(math.isfinite(float(x)) for x in p)):
            raise ValueError("positions must be finite XYZ vectors")
    times=[f["t"] for f in d["frames"]]
    if any(not math.isfinite(t) for t in times) or any(b<=a for a,b in zip(times,times[1:])):
        raise ValueError("timestamps must strictly increase")
    d.setdefault("events",[]); d.setdefault("geometry",{})
    if legacy or d["calibration"].get("mode")=="legacy_assumed_scale" or d["provenance"].get("legacy"):
        # Historical trajectory has no contact flags; retain only the observed pre-rim flight.
        cut=next((e["t"] for e in d["events"] if e["event"]=="rim_cross_down"),None)
        if cut is not None:
            for f in d["frames"]:
                if f["t"]>=cut:
                    f["quality"]["contact"]=True
                    f["quality"]["regime_reason"]="legacy post-rim interval: contact model unidentified, not a measured impact at every frame"
    d["source_path"]=source; d["observation_sha256"]=fingerprint(d)
    return d


def split_keys(dataset):
    keys={"frames:"+fingerprint(dataset)}
    if dataset.get("shot_id"): keys.add("shot:"+str(dataset["shot_id"]))
    prov=dataset.get("provenance",{})
    if prov.get("video_sha256"): keys.add("video:"+prov["video_sha256"])
    elif prov.get("video_name"): keys.add("video_name:"+prov["video_name"])
    return keys


def assert_disjoint_splits(train,validation=(),test=()):
    seen={}
    for name,datasets in (("train",train),("validation",validation),("test",test)):
        for d in datasets:
            for key in split_keys(d):
                if key in seen: raise ValueError(f"shot leakage/duplicate: {key} is in {seen[key]} and {name}")
                seen[key]=name


def free_flight_samples(frames,rim_cross_t=None,events=()):
    """Exclude contacts and their derivative neighbourhood, gaps and FP-02 frames."""
    out=[]; last=None; segment=0
    bounce_times=[e["t"] for e in events if e["event"] in ("bounce","rest","contact")]
    deltas=[b["t"]-a["t"] for a,b in zip(frames,frames[1:]) if b["t"]>a["t"]]
    cadence=statistics.median(deltas) if deltas else .1
    for f in frames:
        p=f.get("position_m",f.get("world_m")); quality=f.get("quality",{})
        bad=(p is None or quality.get("missing") or quality.get("fp02_outlier") or quality.get("contact")
             or (rim_cross_t is not None and f["t"]>=rim_cross_t)
             or any(abs(f["t"]-t)<=2*cadence+1e-9 for t in bounce_times))
        if bad:
            segment+=1; last=None; continue
        if last and (f["t"]-last["t"]>1.6*cadence or f.get("track_id")!=last.get("track_id")):
            segment+=1
        out.append({"t":f["t"],"p":tuple(p),"segment":segment,"track_id":f.get("track_id")})
        last=f
    return out


def _vel_acc(samples,window=2):
    """Local polynomial differentiation, using only one clean contiguous segment."""
    pts=[]
    for i,s in enumerate(samples):
        lo=max(0,i-window); hi=min(len(samples),i+window+1)
        neighbours=[q for q in samples[lo:hi] if q.get("segment",0)==s.get("segment",0)]
        if len(neighbours)<4: continue
        tt=np.asarray([q["t"]-s["t"] for q in neighbours]); pp=np.asarray([q["p"] for q in neighbours],float)
        if pp.shape[1]==2: pp=np.column_stack((pp,np.zeros(len(pp))))
        # Quadratic local regression estimates derivatives without end-point half-acceleration bias.
        A=np.column_stack((np.ones(len(tt)),tt,tt*tt))
        coeff,_,rank,_=np.linalg.lstsq(A,pp,rcond=None)
        if rank<3: continue
        pts.append({"t":s["t"],"p":np.pad(np.asarray(s["p"],float),(0,3-len(s["p"]))).tolist(),"v":coeff[1].tolist(),"a":(2*coeff[2]).tolist()})
    return pts


def _fit_numeric(points,family,dimensions=3):
    if family not in FAMILIES: raise ValueError("unsupported family")
    if len(points)<4: raise ValueError("FP-06: fewer than four clean acceleration samples")
    drag=family=="quadratic_drag"
    # Unknowns g, (k), wx, (wz). Vertical wind is not separately identifiable from gravity.
    names=["g"]+(["drag"] if drag else [])+["wind_x"]+(["wind_z"] if dimensions==3 else [])
    rows=[]; targets=[]
    for q in points:
        speed=math.sqrt(sum(x*x for x in q["v"]))
        for axis in range(3 if dimensions==3 else 2):
            row={"g":-1. if axis==1 else 0.,"drag":-speed*q["v"][axis],
                 "wind_x":1. if axis==0 else 0.,"wind_z":1. if axis==2 else 0.}
            rows.append([row[k] for k in names]); targets.append(q["a"][axis])
    A=np.asarray(rows); y=np.asarray(targets)
    coef,_,rank,_=np.linalg.lstsq(A,y,rcond=None)
    if rank<len(names): raise ValueError("FP-06: model not identifiable from observed motion")
    boundary=False
    if drag and coef[names.index("drag")]<0:
        base=_fit_numeric(points,"gravity",dimensions); base["boundary_drag_zero"]=True
        return base
    residual=y-A@coef; dof=max(1,len(y)-len(names))
    cov=np.linalg.pinv(A.T@A)*float(residual@residual)/dof
    values=dict(zip(names,map(float,coef))); std=dict(zip(names,map(float,np.sqrt(np.maximum(np.diag(cov),0)))))
    if not 0<values["g"]<1000: raise ValueError("FP-06: fitted gravity outside positive model domain")
    return {"g":values["g"],"drag":values.get("drag",0.),"wind":[values["wind_x"],0.,values.get("wind_z",0.)],
            "unc_g":std["g"],"unc_drag":std.get("drag",0.),"unc_wind":[std["wind_x"],None,std.get("wind_z")],
            "n_points":len(points),"acceleration_residual_rms":float(np.sqrt(np.mean(residual**2))),"boundary_drag_zero":boundary}


def fit_params(samples):
    fit=_fit_numeric(_vel_acc(samples),"quadratic_drag",2)
    return {**fit,"wind_x":fit["wind"][0]}


def parameter(value,uncertainty,source,status="estimated",units=None):
    return {"value":value,"uncertainty":uncertainty,"source":source,"status":status,"units":units}


def measure_restitution(datasets):
    measurements={}
    for d in datasets:
        for event in d.get("events",[]):
            if event["event"]!="bounce" or not all(k in event for k in ("normal","v_before_m_s","v_after_m_s")): continue
            n=np.asarray(event["normal"],float); n/=np.linalg.norm(n)
            before=float(np.asarray(event["v_before_m_s"])@n); after=float(np.asarray(event["v_after_m_s"])@n)
            if before<-.1 and after>=0:
                e=-after/before
                if 0<=e<=1.2: measurements.setdefault(event.get("surface","unknown"),[]).append(e)
    return {surface:parameter(statistics.mean(values),statistics.stdev(values)/math.sqrt(len(values)) if len(values)>1 else None,
                              f"normal velocity ratio from {len(values)} observed bounce(s)",units="ratio") for surface,values in measurements.items()}


def fit_family(train_datasets,family="gravity"):
    datasets=[normalize_dataset(d,d.get("source_path","memory")) for d in train_datasets]
    if not datasets: raise ValueError("at least one training shot required")
    assert_disjoint_splits(datasets)
    dimensions=min(d["calibration"].get("dimensions_observed",0) for d in datasets)
    if dimensions<2 or not all(d["calibration"].get("metric") for d in datasets):
        raise ValueError("metric calibration required before physical calibration")
    points=[];segments=[]
    for d in datasets:
        samples=free_flight_samples(d["frames"],events=d["events"])
        points.extend(_vel_acc(samples))
        for sid in sorted({s["segment"] for s in samples}):
            segment=[s for s in samples if s["segment"]==sid]
            if len(segment)>=4:segments.append(segment)
    fit=_fit_numeric(points,family,dimensions)
    fit,trajectory_fit=refine_trajectories(segments,fit,family,dimensions)
    source="training observations only; initialized by finite differences, refined by integrated trajectory residuals; contacts/outliers excluded"
    restitution=measure_restitution(datasets)
    params={"g":parameter(fit["g"],fit["unc_g"],source,units="m/s^2"),
            "drag":parameter(fit["drag"],fit["unc_drag"],source if family=="quadratic_drag" else "zero by selected gravity-only family", "estimated" if family=="quadratic_drag" else "model_assumption", "1/m"),
            "wind":parameter(fit["wind"],fit["unc_wind"],source+"; vertical acceleration absorbed by g",units="m/s^2"),
            "restitution":parameter(None,None,"no universal material coefficient; see per-surface measurements","unobserved","ratio"),
            "friction":parameter(None,None,"no independent rolling/sliding observations fitted","unobserved","ratio"),
            "magnus":parameter(None,None,"spin-induced lift not identifiable without measured spin","unobserved"),
            "spin":parameter(None,None,"ball spin not reconstructed from a silhouette","unobserved","rad/s")}
    if len(restitution)==1: params["restitution"]=deepcopy(next(iter(restitution.values())))
    numeric=numeric_parameters(params); numeric["restitution_by_surface"]={k:v["value"] for k,v in restitution.items()}
    return {"schema_version":"twinforge.twin.v1","level":"L3","status":"calibrated_known_family_unvalidated",
            "family":family,"parameters":params,"restitution_by_surface":restitution,"numeric":numeric,
            "source_fingerprints":[fingerprint(d) for d in datasets],"train_shot_ids":[d["shot_id"] for d in datasets],
            "training_identity_keys":sorted(set().union(*(split_keys(d) for d in datasets))),
            "calibration_dimensions":dimensions,"fit":{"initial_acceleration_residual_rms":fit["acceleration_residual_rms"],"acceleration_residual_rms":fit["acceleration_residual_rms"],"n_points":fit["n_points"],"drag_boundary_zero":fit["boundary_drag_zero"],"trajectory_refinement":trajectory_fit},
            "uncertainty_method":"linear least-squares standard errors; correlated finite differences and calibration systematic error are not included",
            "simulator":{"family":family,"module":"induction.simulator","dimensions":3,"integrator":"semi_implicit_euler","max_step_s":.002,
                         "validated_regime":"free_flight","contact_support":["plane","sphere","rim"],"missing_identification":["friction","spin","net material and geometry"]},
            "limitations":["L3 calibration of predefined families, not autonomous code/physics induction.",
                           "Homography data remain planar even though the integrator uses XYZ vectors.",
                           "Unmeasured contact parameters stay null; contact rollout refuses guessed coefficients."]}


def calibrate_dataset(dataset,family="gravity"):
    fit=fit_family([dataset],family)
    fit["validation"]={"held_out_cm":None,"status":"no_independent_validation_or_test_shot"}
    return fit


def _initial_state(samples,fit=None):
    segment=samples[0].get("segment",0)
    group=[s for s in samples[:4] if s.get("segment",0)==segment]
    if len(group)<3: raise ValueError("three contiguous initialization observations required")
    if fit is not None:
        try:
            from .replay import estimate_causal_state
        except ImportError:
            from replay import estimate_causal_state
        frames=[{"t":s["t"],"position_m":list(s["p"]),"track_id":s.get("track_id"),"quality":{}} for s in group]
        state,reason=estimate_causal_state(frames,group[-1]["t"],fit,window=max(.4,group[-1]["t"]-group[0]["t"])+1e-9)
        if state is None:raise ValueError("causal initialization failed: "+reason)
        return group[-1]["t"],state["position_m"],state["velocity_m_s"],segment
    t0=group[0]["t"]; tt=np.array([s["t"]-t0 for s in group]); pp=np.array([s["p"] for s in group])
    A=np.column_stack((np.ones(len(tt)),tt,tt*tt)); coeff,_,_,_=np.linalg.lstsq(A,pp,rcond=None)
    t=tt[-1]
    return group[-1]["t"],group[-1]["p"],(coeff[1]+2*coeff[2]*t).tolist(),segment


def evaluate(fit,datasets):
    """Forecast after a fixed initialization prefix; no parameter update during scoring."""
    shots=[]; all_errors=[]; correct=0; scored=0
    for original in datasets:
        d=normalize_dataset(original,original.get("source_path","memory"))
        if fingerprint(d) in fit.get("source_fingerprints",[]) or split_keys(d).intersection(fit.get("training_identity_keys",[])):
            raise ValueError("evaluation shot was fitted or shares its source recording")
        samples=free_flight_samples(d["frames"],events=d["events"])
        if len(samples)<6: raise ValueError(f"shot {d['shot_id']}: insufficient clean evaluation trajectory")
        t0,p0,v0,segment=_initial_state(samples,fit)
        targets=[s for s in samples if s["t"]>t0 and s.get("segment",0)==segment]
        if len(targets)<2: raise ValueError("evaluation needs two observations after initialization prefix")
        # Free-flight model scoring never silently introduces unknown contact priors.
        path=rollout(p0,v0,fit["numeric"],[s["t"]-t0 for s in targets])
        errors=[math.dist(pred["position"],s["p"])*100 for pred,s in zip(path,targets)]
        verdict=None; actual=d.get("observed_outcome"); hoop=d.get("geometry",{}).get("hoop")
        if hoop and d["calibration"].get("dimensions_observed")==3:
            n=np.asarray(hoop.get("normal",[0,1,0])); center=np.asarray(hoop["center"])
            prev=np.asarray(p0)
            for pred in path:
                curr=np.asarray(pred["position"]); da=float((prev-center)@n); db=float((curr-center)@n)
                if da>0>=db:
                    cross=prev+(curr-prev)*da/(da-db)
                    verdict=bool(np.linalg.norm(cross-center)+d["geometry"].get("ball_radius_m",0)<hoop["inner_radius_m"]); break
                prev=curr
        if verdict is not None and isinstance(actual,bool): scored+=1; correct+=verdict==actual
        shots.append({"shot_id":d["shot_id"],"observation_sha256":fingerprint(d),"initialization_end_s":t0,
                      "mean_error_cm":statistics.mean(errors),"max_error_cm":max(errors),"samples_scored":len(errors),
                      "forecast_errors":[{"t":s["t"],"error_cm":e} for s,e in zip(targets,errors)],"predicted_outcome":verdict,"observed_outcome":actual})
        all_errors.extend(errors)
    return {"mean_error_cm":statistics.mean(all_errors) if all_errors else None,"shots":shots,
            "verdicts":{"correct":correct,"scored":scored,"accuracy":correct/scored if scored else None},
            "protocol":"frozen training model; causal same-model rollout fit on first 4 clean observations initializes state; later free-flight samples only"}


def simulate_plane(p0,v0,params,t_end,dt=.004):
    """Compatibility utility; no longer used to claim held-out performance."""
    numeric={"g":params["g"],"drag":params["drag"],"wind":[params.get("wind_x",0.),0.,0.]}
    times=np.arange(0,t_end+dt/2,dt).tolist()
    return [(r["t"],r["position"][0],r["position"][1]) for r in rollout([*p0[:2],0.],[*v0[:2],0.],numeric,times,dt=dt)]


def held_out_error(*_args,**_kwargs):
    raise ValueError("a suffix of one shot is not independent held-out evidence; use evaluate(fit, test_datasets)")


def run(args):
    load=lambda paths:[normalize_dataset(json.loads(Path(p).read_text()),str(Path(p).resolve())) for p in paths]
    train_paths=args.train or ([args.trajectories] if args.trajectories else ["perception/output/trajectories.json"])
    train,validation,test=load(train_paths),load(args.validation),load(args.test)
    if getattr(args,"source_kind",None):
        for d in train+validation+test:
            d["provenance"]["kind"]=args.source_kind
            d["provenance"]["kind_source"]="explicit CLI --source-kind declaration"
    assert_disjoint_splits(train,validation,test)
    families=FAMILIES if validation and args.family=="auto" else ("gravity" if args.family=="auto" else args.family,)
    candidates=[]
    for family in families:
        fit=fit_family(train,family)
        score=evaluate(fit,validation) if validation else None
        candidates.append((fit,score))
    chosen,validation_score=min(candidates,key=lambda pair:pair[1]["mean_error_cm"]) if validation else candidates[0]
    # Freeze chosen parameters: no refit on validation/test, no test-driven family choice.
    test_score=evaluate(chosen,test) if test else None
    chosen["validation"]={"train_shots":[d["shot_id"] for d in train],"validation_shots":[d["shot_id"] for d in validation],"test_shots":[d["shot_id"] for d in test],
                          "selection":"independent_validation" if validation else "preselected_family_no_validation",
                          "validation_result":validation_score,"test_result":test_score,
                          "held_out_cm":test_score["mean_error_cm"] if test_score else None,
                          "status":"independent_test_measured" if test_score else "no_independent_test_evidence"}
    chosen["status"]="L3_independent_test_measured" if test_score else "L3_unvalidated"
    chosen["journal"]=[{"family":fit["family"],"train_fingerprints":fit["source_fingerprints"],"train_residual_rms":fit["fit"]["acceleration_residual_rms"],
                        "validation_error_cm":score["mean_error_cm"] if score else None,"selected":fit is chosen} for fit,score in candidates]
    chosen["created_utc"]=datetime.now(timezone.utc).isoformat()
    # Scalars remain explicit aliases for existing adapters, never substitute for evidence.
    chosen.update(g=chosen["numeric"]["g"],drag=chosen["numeric"]["drag"],held_out_cm=chosen["validation"]["held_out_cm"])
    bundle={"schema_version":"twinforge.bundle.v1","dataset":train[0],"twin":chosen,
            "datasets":{"train":train,"validation":validation,"test":test},
            "provenance":{"created_utc":chosen["created_utc"],"kind":"calibrated_L3","historical_sources_unchanged":True}}
    report=["# Calibration L3 — independent-shot protocol",f"Status: **{chosen['status']}**",f"Family: {chosen['family']}",
            "Known simulator family calibrated numerically. Not autonomous free induction.",
            f"Training shots: {len(train)}; validation: {len(validation)}; independent test: {len(test)}.",
            "No coefficient is refitted after selection. Duplicate/cross-split shots are rejected."]
    for item in chosen["journal"]: report.append(json.dumps(item,ensure_ascii=False))
    report.append(f"Independent test mean error: {chosen['held_out_cm']} cm (null means no measurement).")
    report.extend(chosen["limitations"])
    for path,value in ((args.out_json,chosen),(args.bundle,bundle)):
        p=Path(path); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(value,indent=2,allow_nan=False)+"\n")
    p=Path(args.out_journal); p.parent.mkdir(parents=True,exist_ok=True); p.write_text("\n\n".join(report)+"\n")
    print("\n".join(report)); print(f"Bundle: {args.bundle}")
    return 0


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--train",action="append",default=[]); ap.add_argument("--validation",action="append",default=[]); ap.add_argument("--test",action="append",default=[])
    ap.add_argument("--trajectories",default=None,help="legacy alias for one training shot")
    ap.add_argument("--family",choices=("auto",)+FAMILIES,default="auto")
    ap.add_argument("--source-kind",choices=("real","synthetic","unknown"),default=None,help="explicit provenance declaration; never inferred from a filename")
    ap.add_argument("--out-json",default="induction/current/induced_twin.json"); ap.add_argument("--out-journal",default="induction/current/induction_journal.md")
    ap.add_argument("--bundle",default="induction/current/bundle.json")
    args=ap.parse_args()
    try: return run(args)
    except (ValueError,OSError,KeyError) as exc:
        print(f"CALIBRATION INCOMPLETE: {exc}",file=sys.stderr); return 3


if __name__=="__main__": raise SystemExit(main())
