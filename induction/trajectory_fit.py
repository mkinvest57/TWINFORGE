"""Refine a finite-difference estimate against integrated TRAIN trajectories.

The optimizer receives observations only. Validation/test shots never enter this
module. Each segment starts at its first clean measured position; initial
velocity is a nuisance variable, not a physical constant. The same step
integrator is used for fitting and forecasting.
"""
import math
import numpy as np
try:
    from .simulator import rollout
except ImportError:
    from simulator import rollout


def refine(segments, initial, family, dimensions, iterations=18):
    segments=[s for s in segments if len(s)>=4]
    if not segments:return initial,{"status":"insufficient_contiguous_observations"}
    names=["g"]+(["drag"] if family=="quadratic_drag" else [])+["wind_x"]+(["wind_z"] if dimensions==3 else [])
    values={"g":initial["g"],"drag":initial["drag"],"wind_x":initial["wind"][0],"wind_z":initial["wind"][2]}
    x=[values[name] for name in names];prepared=[]
    for segment in segments:
        P=np.asarray([q["p"] for q in segment],float);T=np.asarray([q["t"]-segment[0]["t"] for q in segment],float)
        early=min(5,len(T));A=np.column_stack((np.ones(early),T[:early],T[:early]**2))
        coef=np.linalg.lstsq(A,P[:early],rcond=None)[0]
        x.extend(coef[1,:dimensions]);prepared.append((T,P))
    x=np.asarray(x,float);n_global=len(names)
    def unpack(candidate):
        globals_=dict(zip(names,candidate[:n_global]))
        return {"g":globals_["g"],"drag":globals_.get("drag",0.),"wind":[globals_["wind_x"],0.,globals_.get("wind_z",0.)]}
    def residual(candidate):
        params=unpack(candidate)
        if not 0<params["g"]<1000 or not 0<=params["drag"]<100:return None
        if not np.all(np.isfinite(candidate)) or np.max(np.abs(candidate))>10000:return None
        rows=[]
        try:
            for i,(T,P) in enumerate(prepared):
                v=np.zeros(3);v[:dimensions]=candidate[n_global+i*dimensions:n_global+(i+1)*dimensions]
                path=rollout([0.,0.,0.],v.tolist(),params,T.tolist(),dt=.002)
                delta=np.asarray([s["position"] for s in path]);p0=P[0]
                rows.extend((delta+p0-P)[:,:dimensions].ravel())
        except (OverflowError,ValueError):return None
        r=np.asarray(rows)
        return r if np.all(np.isfinite(r)) else None
    r=residual(x)
    if r is None:return initial,{"status":"initial_trajectory_invalid"}
    before=float(np.sqrt(np.mean(r*r)));damping=1e-3;trace=[];J=None
    for iteration in range(iterations):
        columns=[]
        for j in range(len(x)):
            trial=x.copy();epsilon=1e-4;trial[j]+=epsilon;rr=residual(trial)
            if rr is None:break
            columns.append((rr-r)/epsilon)
        if len(columns)!=len(x):break
        J=np.column_stack(columns)
        # Huber weights reduce the influence of unflagged tracking noise, using training residuals only.
        delta=max(.01,1.5*float(np.median(np.abs(r))));weights=np.minimum(1.,delta/np.maximum(np.abs(r),1e-12))
        A=J.T@(weights[:,None]*J);gradient=J.T@(weights*r)
        try:change=np.linalg.solve(A+damping*np.diag(np.maximum(np.diag(A),1e-8)),-gradient)
        except np.linalg.LinAlgError:break
        candidate=x+change;rr=residual(candidate)
        accepted=rr is not None and float(rr@rr)<float(r@r)
        if accepted:x=candidate;r=rr;damping=max(damping/3,1e-9)
        else:damping=min(damping*10,1e12)
        trace.append({"iteration":iteration+1,"accepted":bool(accepted),"train_position_rmse_cm":float(np.sqrt(np.mean(r*r))*100)})
        if accepted and np.linalg.norm(change)<1e-6:break
    result={**initial,**unpack(x)}
    uncertainty={}
    if J is not None:
        covariance=np.linalg.pinv(J.T@J)*float(r@r)/max(1,len(r)-len(x))
        std=np.sqrt(np.maximum(np.diag(covariance),0.))
        uncertainty={name:float(std[i]) for i,name in enumerate(names)}
        result["unc_g"]=uncertainty["g"];result["unc_drag"]=uncertainty.get("drag",0.)
        result["unc_wind"]=[uncertainty["wind_x"],None,uncertainty.get("wind_z")]
    return result,{"status":"refined_on_training_observations","method":"bounded_LM_integrated_positions_with_training_Huber_weights",
                   "initial_position_rmse_cm":before*100,"final_position_rmse_cm":float(np.sqrt(np.mean(r*r))*100),
                   "segments":len(segments),"positions":sum(len(s) for s in segments),"integrator_step_s":.002,
                   "uncertainty":"approximate local least-squares; calibration systematic error not included","iterations":trace,
                   "uses_validation_or_test":False}
