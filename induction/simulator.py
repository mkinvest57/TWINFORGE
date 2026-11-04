"""Executable calibrated L3 sphere model; all forces use supplied parameters.

Unknown contact coefficients raise instead of silently borrowing true values.
Geometry is measured input. Collision support: planes, static spheres, a circular
rim. A deformable net is not inferred here and is explicitly unsupported.
"""
import math
import numpy as np


def numeric_parameters(parameters):
    return {k:(v.get("value") if isinstance(v,dict) and "value" in v else v) for k,v in parameters.items()}


def _contact(p,v,omega,normal,penetration,radius,params,surface):
    if penetration<=0: return p,v,omega,None
    e=params.get("restitution")
    by_surface=params.get("restitution_by_surface") or {}
    e=by_surface.get(surface,e)
    mu=params.get("friction")
    if e is None or mu is None:
        raise ValueError(f"contact on {surface} requires measured restitution and explicit friction prior/estimate")
    n=np.asarray(normal,float); n/=np.linalg.norm(n)
    p=p+n*penetration
    vn=float(v@n)
    if vn>=0: return p,v,omega,None
    normal_impulse=-(1+e)*vn
    v=v+normal_impulse*n
    arm=-radius*n
    tangent=v+np.cross(omega,arm); tangent-=n*float(tangent@n)
    speed=float(np.linalg.norm(tangent))
    if speed>1e-12:
        # Homogeneous solid sphere I/m = 2 r²/5; Coulomb impulse, no easing.
        impulse=-tangent/speed*min(speed/3.5,mu*normal_impulse)
        v+=impulse
        omega+=np.cross(arm,impulse)/(.4*radius*radius)
    return p,v,omega,{"surface":surface,"normal_speed_before":vn,"normal_impulse_per_mass":normal_impulse}


def step(state,params,dt,geometry=None):
    if dt<=0 or dt>.02: raise ValueError("integration step must be in (0,.02] seconds")
    geometry=geometry or {}; params=numeric_parameters(params)
    p=np.asarray(state["position"],float).copy(); v=np.asarray(state["velocity"],float).copy()
    omega=np.asarray(state.get("angular_velocity",[0.,0.,0.]),float).copy()
    wind=np.asarray(params.get("wind",[0.,0.,0.]),float)
    acceleration=wind-np.array([0.,params["g"],0.])-params["drag"]*np.linalg.norm(v)*v
    magnus=params.get("magnus")
    if magnus is not None: acceleration+=magnus*np.cross(omega,v)
    v+=acceleration*dt; p+=v*dt
    contacts=[]; radius=geometry.get("ball_radius_m")
    if geometry.get("planes") or geometry.get("spheres") or geometry.get("hoop"):
        if radius is None or radius<=0: raise ValueError("contacts require measured ball radius")
    for plane in geometry.get("planes",[]):
        n=np.asarray(plane["normal"],float); n/=np.linalg.norm(n)
        if plane.get("bounds_min") and not all(plane["bounds_min"][i]-radius<=p[i]<=plane["bounds_max"][i]+radius for i in range(3)):
            continue
        penetration=radius-float((p-np.asarray(plane["point"]))@n)
        p,v,omega,event=_contact(p,v,omega,n,penetration,radius,params,plane.get("name","plane"))
        if event: contacts.append(event)
    for sphere in geometry.get("spheres",[]):
        delta=p-np.asarray(sphere["center"]); dist=float(np.linalg.norm(delta))
        if dist<1e-9: raise ValueError("sphere contact normal is undefined")
        p,v,omega,event=_contact(p,v,omega,delta/dist,radius+sphere["radius_m"]-dist,radius,params,sphere.get("name","sphere"))
        if event: contacts.append(event)
    hoop=geometry.get("hoop")
    if hoop and "tube_radius_m" in hoop:
        n=np.asarray(hoop.get("normal",[0,1,0]),float); n/=np.linalg.norm(n)
        center=np.asarray(hoop["center"]); offset=p-center; radial=offset-n*float(offset@n)
        length=float(np.linalg.norm(radial))
        if length>1e-9:
            curve=center+radial/length*(hoop["inner_radius_m"]+hoop["tube_radius_m"])
            delta=p-curve; dist=float(np.linalg.norm(delta))
            if dist>1e-9:
                p,v,omega,event=_contact(p,v,omega,delta/dist,radius+hoop["tube_radius_m"]-dist,radius,params,"rim")
                if event: contacts.append(event)
    rotation=np.asarray(state.get("rotation",[0.,0.,0.]),float)+omega*dt
    return {"position":p.tolist(),"velocity":v.tolist(),"angular_velocity":omega.tolist(),"rotation":rotation.tolist(),"contacts":contacts}


def rollout(position,velocity,params,times,geometry=None,dt=.002,angular_velocity=None):
    state={"position":list(position),"velocity":list(velocity),"angular_velocity":angular_velocity or [0.,0.,0.]}
    t=0.; output=[]
    for target in times:
        if target<t-1e-9: raise ValueError("rollout timestamps must increase")
        while t<target-1e-12:
            h=min(dt,target-t); state=step(state,params,h,geometry); t+=h
        output.append({"t":float(target),**state})
    return output
