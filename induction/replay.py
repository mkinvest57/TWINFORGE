"""Causal recorded-observation forecasts and complete, auditable scoring.

The current state uses past observations only. Evaluation may inspect future
observations to label unsupported contacts/gaps; it never changes an issued
forecast. All issued scores and every rejection remain in the report.
"""
import math
import statistics
import numpy as np
try:
    from .simulator import rollout
except ImportError:
    from simulator import rollout


def numeric(twin):
    if twin.get("numeric"): return twin["numeric"]
    return {k:v["value"] for k,v in twin["parameters"].items()}


def quality_reason(frame):
    q=frame.get("quality",{})
    if frame.get("position_m") is None or q.get("missing"): return "missing_observation"
    if q.get("fp02_outlier"): return "fp02_outlier"
    if q.get("contact") or q.get("unsupported_regime"): return "contact_or_unsupported_regime"
    return None


def interpolate_actual(frames,t):
    if not frames or t<frames[0]["t"]-1e-9 or t>frames[-1]["t"]+1e-9: return None
    for i,b in enumerate(frames):
        if b["t"]+1e-9>=t:
            a=frames[max(0,i-1)]
            if a.get("position_m") is None or b.get("position_m") is None: return None
            alpha=(t-a["t"])/(b["t"]-a["t"]) if b["t"]>a["t"] else 0.
            return {"position_m":((1-alpha)*np.array(a["position_m"])+alpha*np.array(b["position_m"])).tolist(),"bracket":[a,b]}


def legacy_state(frames,t):
    actual=interpolate_actual(frames,t)
    if actual is None: return None,"outside_recording"
    a,b=actual["bracket"]; dt=b["t"]-a["t"]
    if dt<=0:return None,"initialization"
    f=(t-a["t"])/dt
    av,bv=a.get("velocity_m_s"),b.get("velocity_m_s")
    v=((1-f)*np.array(av)+f*np.array(bv)).tolist() if av is not None and bv is not None else ((np.array(b["position_m"])-a["position_m"])/dt).tolist()
    q=a if f<.5 else b
    if q.get("quality",{}).get("contact"):return None,"contact"
    return {"t":t,"position_m":actual["position_m"],"velocity_m_s":v,"track_id":q.get("track_id")},None


def estimate_causal_state(frames,t,twin,max_points=5,window=.4):
    available=[f for f in frames if f["t"]<=t+1e-9]
    if not available:return None,"no_past_observation"
    latest=available[-1]
    reason=quality_reason(latest)
    if reason:return None,reason
    deltas=[b["t"]-a["t"] for a,b in zip(available,available[1:]) if b["t"]>a["t"]]
    cadence=statistics.median(deltas) if deltas else None
    if cadence and t-latest["t"]>1.75*cadence:return None,"stale_observation"
    points=[]
    for frame in reversed(available):
        if len(points)>=max_points or t-frame["t"]>window+1e-9:break
        if quality_reason(frame) or frame.get("track_id")!=latest.get("track_id"):break
        if points and cadence and points[-1]["t"]-frame["t"]>1.75*cadence:break
        points.append(frame)
    points.reverse()
    if len(points)<3:return None,"insufficient_causal_history"
    times=np.array([f["t"]-points[0]["t"] for f in points]); positions=np.array([f["position_m"] for f in points]);params=numeric(twin)
    velocity=(positions[1]-positions[0])/(times[1]-times[0]);velocity+=np.array([0,params["g"]*(times[1]-times[0])/2,0])
    def residual(v,return_origin=False):
        path=rollout([0.,0.,0.],v.tolist(),params,times.tolist(),dt=.002)
        delta=np.array([s["position"] for s in path]);origin=np.mean(positions-delta,axis=0)
        return origin if return_origin else (delta+origin-positions).ravel()
    errors=residual(velocity);damping=1e-4
    for _ in range(6):
        J=np.column_stack([(residual(velocity+np.eye(3)[j]*1e-4)-errors)/1e-4 for j in range(3)])
        try:change=np.linalg.solve(J.T@J+damping*np.eye(3),-J.T@errors)
        except np.linalg.LinAlgError:break
        trial=velocity+change;trial_errors=residual(trial)
        if float(trial_errors@trial_errors)<float(errors@errors):velocity=trial;errors=trial_errors;damping/=3
        else:damping*=10
    origin=residual(velocity,True)
    state=rollout(origin.tolist(),velocity.tolist(),params,[t-points[0]["t"]],dt=.002)[0]
    return {"t":float(t),"position_m":state["position"],"velocity_m_s":state["velocity"],"track_id":latest.get("track_id"),
            "state_estimation":{"method":"causal-rollout-v3","sample_times":[f["t"] for f in points],
                                "latest_observation_t":latest["t"],"residual_rms_m":float(np.sqrt(np.mean(errors**2))),"uses_future_observations":False}},None


def target_support(frames,source_t,target_t,track_id):
    actual=interpolate_actual(frames,target_t)
    if actual is None:return None,["target_unobserved"]
    relevant=[f for f in frames if source_t-1e-9<=f["t"]<=target_t+1e-9]
    relevant=sorted({f["t"]:f for f in relevant+actual["bracket"]}.values(),key=lambda f:f["t"])
    reasons=set()
    for f in relevant:
        reason=quality_reason(f)
        if reason:reasons.add(reason)
        if f.get("track_id")!=track_id:reasons.add("id_switch")
    all_dt=[b["t"]-a["t"] for a,b in zip(frames,frames[1:]) if b["t"]>a["t"]]
    cadence=statistics.median(all_dt) if all_dt else .1
    if any(b["t"]-a["t"]>1.75*cadence for a,b in zip(relevant,relevant[1:])):reasons.add("observation_gap")
    return actual["position_m"],sorted(reasons)


def benchmark_replay(dataset,twin,mode="causal",horizon=.5,interval=.1,source_times=None):
    frames=dataset["frames"]
    times=source_times if source_times is not None else [round(frames[0]["t"]+i*interval,9) for i in range(math.floor((frames[-1]["t"]-frames[0]["t"])/interval)+1)]
    forecasts=[]; rejected=[]
    for t in times:
        state,reason=legacy_state(frames,t) if mode=="legacy" else estimate_causal_state(frames,t,twin)
        if state is None:
            rejected.append({"source_t":t,"reason":reason});continue
        prediction=rollout(state["position_m"],state["velocity_m_s"],numeric(twin),[horizon])[0]
        target_t=t+horizon;actual,reasons=target_support(frames,t,target_t,state.get("track_id"))
        error=math.dist(prediction["position"],actual)*100 if actual is not None else None
        forecasts.append({"source_t":t,"target_t":target_t,"predicted_position_m":prediction["position"],"actual_position_m":actual,
                          "error_cm":error,"supported":not reasons,"unsupported_reasons":reasons,"state":state})
    scored=[f for f in forecasts if f["error_cm"] is not None];supported=[f for f in scored if f["supported"]]
    def summary(rows):
        values=[f["error_cm"] for f in rows]
        return {"count":len(values),"mean_cm":statistics.mean(values) if values else None,"max_cm":max(values) if values else None}
    return {"mode":mode,"horizon_s":horizon,"scheduled":len(times),"issued":len(forecasts),"rejected":len(rejected),
            "all_issued_scorable":summary(scored),"supported":summary(supported),
            "coverage":{"issued_over_scheduled":len(forecasts)/len(times) if times else 0.,"supported_over_scheduled":len(supported)/len(times) if times else 0.,
                        "supported_over_issued":len(supported)/len(forecasts) if forecasts else 0.},
            "forecasts":forecasts,"rejections":rejected,"independent_test":False,
            "interpretation":"Diagnostic on this recorded shot; support labels do not remove errors from all-issued statistics."}
