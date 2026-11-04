#!/usr/bin/env python3
"""Reproducible independent-shot 3D sensor benchmark; never real-world evidence.

RK4 truth lives only in the generator/evaluator. Calibration receives noisy XYZ
observations and measured static geometry. Train/validation/test use different
initial conditions and sensor-noise draws; the test split is opened after choice.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import statistics
import numpy as np
try:
    from .induce import fit_family, evaluate, assert_disjoint_splits, fingerprint
    from .replay import benchmark_replay
except ImportError:
    from induce import fit_family, evaluate, assert_disjoint_splits, fingerprint
    from replay import benchmark_replay


def generate_shot(name,initial_position,initial_velocity,seed,truth,duration=1.5,sample_dt=.05,sigma_m=.002):
    rng=np.random.default_rng(seed);state=np.array([*initial_position,*initial_velocity],float)
    dt=.001;n_steps=round(duration/dt);stride=round(sample_dt/dt);frames=[];evaluated=[]
    def derivative(s):
        v=s[3:];a=np.asarray(truth["wind"])-[0,truth["g"],0]-truth["drag"]*np.linalg.norm(v)*v
        return np.r_[v,a]
    for i in range(n_steps+1):
        if i%stride==0:
            position=state[:3]+rng.normal(0,sigma_m,3)
            frames.append({"t":round(i*dt,9),"position_m":position.tolist(),"track_id":1,"velocity_m_s":None,
                           "position_uncertainty":{"position_std_m":[sigma_m]*3,"method":"declared synthetic sensor noise"},
                           "quality":{"missing":False,"fp02_outlier":False,"contact":False}})
            evaluated.append({"t":round(i*dt,9),"position_m":state[:3].tolist(),"velocity_m_s":state[3:].tolist()})
        if i<n_steps:
            k1=derivative(state);k2=derivative(state+dt*k1/2);k3=derivative(state+dt*k2/2);k4=derivative(state+dt*k3)
            state+=dt*(k1+2*k2+2*k3+k4)/6
    digest=hashlib.sha256(json.dumps(frames,sort_keys=True).encode()).hexdigest()
    geometry={"ball_radius_m":.12,"hoop":{"center":[3.,2.3,0.],"normal":[0,1,0],"inner_radius_m":.45},
              "kind":"non-contact measurement gate; no rim/net dynamics claimed"}
    outcome=None
    for a,b in zip(evaluated,evaluated[1:]):
        pa,pb=np.array(a["position_m"]),np.array(b["position_m"]);center=np.array(geometry["hoop"]["center"])
        if pa[1]>center[1]>=pb[1]:
            cross=pa+(pb-pa)*(pa[1]-center[1])/(pa[1]-pb[1])
            outcome=bool(np.linalg.norm(cross-center)+geometry["ball_radius_m"]<geometry["hoop"]["inner_radius_m"]);break
    data={"schema_version":"twinforge.dataset.v1","shot_id":name,"provenance":{"kind":"synthetic","sensor":"noisy_3d_position_sensor","source_sha256":digest,"seed":seed},
          "calibration":{"mode":"synthetic_world_frame","metric":True,"dimensions_observed":3,"units":"metres","clock":"exact_integration_timestamps"},
          "geometry":geometry,"frames":frames,"events":[],"observed_outcome":outcome}
    return data,{"shot_id":name,"truth_states":evaluated,"initial_position":initial_position,"initial_velocity":initial_velocity,"seed":seed,"observed_outcome":outcome}


def run(destination):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    truth={"g":9.73,"drag":.042,"wind":[.24,0.,-.11]}
    specifications={"train":[([-1.4,1.6,-.3],[5.1,5.9,.35]),([-1.1,1.8,.2],[4.4,5.3,-.25]),([-1.7,1.5,-.15],[6.2,6.3,.45])],
                    "validation":[([-1.2,1.7,.1],[5.8,5.5,-.15]),([-1.5,1.6,-.25],[4.8,6.1,.3])],
                    "test":[([-1.3,1.9,-.2],[5.4,5.7,.2]),([-1.8,1.4,.15],[6.5,6.4,-.3]),([-1.,1.8,-.1],[4.3,5.2,.4])]}
    split={};evaluations=[];ordinal=0
    for name,shots in specifications.items():
        split[name]=[];(destination/name).mkdir(exist_ok=True)
        for i,(p,v) in enumerate(shots):
            ordinal+=1;data,expected=generate_shot(f"{name}-{i+1}",p,v,20261104+ordinal,truth)
            split[name].append(data);evaluations.append(expected)
            (destination/name/(data["shot_id"]+".json")).write_text(json.dumps(data,indent=2)+"\n")
    assert_disjoint_splits(split["train"],split["validation"],split["test"])
    # Fitting and selection do not receive `truth` or any evaluator state.
    candidates=[]
    for family in ("gravity","quadratic_drag"):
        fit=fit_family(split["train"],family);score=evaluate(fit,split["validation"])
        candidates.append((fit,score))
    selected,validation=min(candidates,key=lambda q:q[1]["mean_error_cm"])
    independent=evaluate(selected,split["test"])
    prior=deepcopy(selected)
    for key,value in {"g":9.3,"drag":.02,"wind":[0.,0.,0.]}.items():
        prior["numeric"][key]=value;prior["parameters"][key].update(value=value,status="unfitted_prior")
    prior_test=evaluate(prior,split["test"])
    causal=[]
    for data in split["test"]:
        report=benchmark_replay(data,selected);report["independent_test"]=True;report["shot_id"]=data["shot_id"];causal.append(report)
    all_errors=[f["error_cm"] for r in causal for f in r["forecasts"] if f["error_cm"] is not None]
    selected["validation"]={"train_shots":[d["shot_id"] for d in split["train"]],"validation_shots":[d["shot_id"] for d in split["validation"]],"test_shots":[d["shot_id"] for d in split["test"]],
                            "held_out_cm":independent["mean_error_cm"],"validation_result":validation,"test_result":independent,"status":"independent_synthetic_test_measured"}
    report={"schema_version":"twinforge.synthetic_benchmark.v1","created_utc":datetime.now(timezone.utc).isoformat(),"source_kind":"synthetic_position_sensor","real_world_validation":False,
            "sensor_noise_std_m":.002,"generator_integrator":"independent_RK4_1ms","fitted_integrator":"semi_implicit_Euler_2ms","horizon_s":.5,"error_threshold_cm":5.,
            "split_ids":{k:[d["shot_id"] for d in v] for k,v in split.items()},"fingerprints":{k:[fingerprint(d) for d in v] for k,v in split.items()},
            "model_selection":[{"family":fit["family"],"validation_mean_cm":score["mean_error_cm"]} for fit,score in candidates],
            "selected_model":selected,"independent_test":independent,"unfitted_prior_test":prior_test,
            "causal_plus_0_5s":{"shots":causal,"all_issued_scorable_mean_cm":statistics.mean(all_errors),"all_issued_scorable_max_cm":max(all_errors),
                                "scored":len(all_errors),"within_5cm":sum(e<=5 for e in all_errors),"scheduled":sum(r["scheduled"] for r in causal),"issued":sum(r["issued"] for r in causal)},
            "limitations":["Numerical 3D sensor benchmark, not SAM/video or real-world proof.","Measurement gate is non-contact; net, rim collision and physical actuation are not validated.","This new dataset does not replace or repair legacy footage timing/calibration."]}
    (destination/"benchmark.json").write_text(json.dumps(report,indent=2,allow_nan=False)+"\n")
    (destination/"evaluation_truth.json").write_text(json.dumps({"evaluation_only":True,"physical_parameters":truth,"shots":evaluations},indent=2)+"\n")
    (destination/"test-bundle.json").write_text(json.dumps({"schema_version":"twinforge.bundle.v1","dataset":split["test"][0],"twin":selected,"provenance":{"kind":"independent_synthetic_test","replaces_legacy_example":False}},indent=2)+"\n")
    print(json.dumps({"path":str(destination/"benchmark.json"),"selected_family":selected["family"],"independent_test_mean_cm":independent["mean_error_cm"],"prior_mean_cm":prior_test["mean_error_cm"],"causal_mean_cm":statistics.mean(all_errors),"causal_max_cm":max(all_errors),"scored":len(all_errors),"within_5cm":sum(e<=5 for e in all_errors)}))
    return report


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--out",default="induction/benchmarks/independent-3d-2026-11-04")
    run(parser.parse_args().out)
