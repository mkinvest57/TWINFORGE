"""Metric reconstruction from measured calibration, never guessed scale.

Coordinates are metres, Y up. Homography observes a plane only. Sphere-size
depth needs measured diameter, intrinsics and camera pose. Stereo requires
synchronized views. Each method returns uncertainty and explicit assumptions.
"""
import math
import numpy as np


def homography(points_px, points_m):
    src, dst = np.asarray(points_px, float), np.asarray(points_m, float)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 2 or len(src) < 4:
        raise ValueError("calibration needs four or more pixel/world point pairs")
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.extend(([-x,-y,-1,0,0,0,u*x,u*y,u], [0,0,0,-x,-y,-1,v*x,v*y,v]))
    A = np.asarray(rows)
    if np.linalg.matrix_rank(A) < 8:
        raise ValueError("degenerate fiducials")
    _, _, vh = np.linalg.svd(A)
    H = vh[-1].reshape(3, 3)
    return (H / (H[2,2] if abs(H[2,2]) > 1e-12 else np.linalg.norm(H))).tolist()


def project(H, point):
    q = np.asarray(H, float) @ [point[0], point[1], 1.]
    if abs(q[2]) < 1e-12:
        raise ValueError("point projects to infinity")
    return [float(q[0]/q[2]), float(q[1]/q[2])]


def prepare(config):
    if not config:
        return {"mode":"uncalibrated", "metric":False, "dimensions_observed":0,
                "limitations":["No metric calibration supplied; coordinates remain pixels."]}
    c = dict(config)
    if c.get("example_only"):
        raise ValueError("replace template numbers with measured calibration and remove example_only")
    c.setdefault("mode", "plane_homography" if "points_px" in c else None)
    if c["mode"] == "plane_homography":
        c["H"] = homography(c["points_px"], c["points_m"])
        c.setdefault("origin_m", [0.,0.,0.]); c.setdefault("axis_u", [1.,0.,0.]); c.setdefault("axis_v", [0.,1.,0.])
        u, v = np.array(c["axis_u"]), np.array(c["axis_v"])
        if not (np.isclose(np.linalg.norm(u),1) and np.isclose(np.linalg.norm(v),1) and abs(u@v)<1e-6):
            raise ValueError("plane axes must be orthonormal in metres")
        c.update(metric=True, dimensions_observed=2, limitations=[
            "Coordinates assume the declared motion plane; depth is unobserved.",
            "A ball leaving the calibrated plane invalidates reconstruction."])
    elif c["mode"] == "sphere_size":
        K, R = np.asarray(c["camera_matrix"],float), np.asarray(c["camera_to_world_rotation"],float)
        if K.shape!=(3,3) or R.shape!=(3,3) or not np.allclose(R.T@R,np.eye(3),atol=1e-5):
            raise ValueError("valid camera intrinsics and rotation required")
        if c["ball_diameter_m"] <= 0 or "diameter_uncertainty_m" not in c:
            raise ValueError("measured diameter and uncertainty required")
        if any(abs(float(x))>0 for x in c.get("distortion_coefficients",[])):
            raise ValueError("input must be lens-undistorted")
        c.update(metric=True, dimensions_observed=3, limitations=[
            "Depth is estimated from angular silhouette and measured sphere diameter.",
            "Occluded/non-spherical masks are rejected; calibration error remains."])
    elif c["mode"] == "stereo":
        for key in ("projection_left","projection_right"):
            if np.asarray(c[key]).shape != (3,4):
                raise ValueError(f"{key} must be a calibrated 3x4 matrix, metres, Y up")
        c.update(metric=True, dimensions_observed=3, limitations=[
            "Cameras must be synchronized and lens-undistorted; correspondence can fail at occlusion."])
    else:
        raise ValueError(f"unsupported calibration mode {c['mode']!r}")
    c.setdefault("pixel_uncertainty",1.)
    c.setdefault("pixel_center_offset_px",0.)
    if not math.isfinite(float(c["pixel_center_offset_px"])):
        raise ValueError("pixel center offset must be finite")
    return c


def sphere_tangent_cone(boundary_px, camera_matrix, pixel_uncertainty=1., pixel_center_offset_px=0.):
    """Fit the plane of tangent unit rays, not a circle around the mask centroid.

    A sphere silhouette is generally an ellipse off axis. Its unit boundary
    rays lie on n.dot(ray)=cos(alpha), where n is the 3D centre direction.
    Raster mask boundaries are half-pixel crossings between foreground and
    background centres. The calibration offset converts those index-centre
    coordinates to the camera's declared image convention (WebGL edges: .5).
    Six fixed Huber iterations reduce isolated contour errors without truth.
    """
    points=np.asarray(boundary_px,float)
    if points.ndim!=2 or points.shape[1]!=2 or len(points)<8:
        raise ValueError("insufficient sphere boundary")
    K=np.asarray(camera_matrix,float)
    rays=np.column_stack((points+float(pixel_center_offset_px),np.ones(len(points))))@np.linalg.inv(K).T
    rays/=np.linalg.norm(rays,axis=1)[:,None]
    weights=np.ones(len(points)); pixel_angle=float(pixel_uncertainty)/min(K[0,0],K[1,1])
    for _ in range(6):
        mean=np.average(rays,axis=0,weights=weights)
        centred=rays-mean
        eigenvalues,eigenvectors=np.linalg.eigh((centred*weights[:,None]).T@centred/weights.sum())
        if eigenvalues[1]<1e-12: raise ValueError("sphere boundary is geometrically degenerate")
        axis=eigenvectors[:,0]
        if axis@mean<0: axis=-axis
        cosine=float(axis@mean)
        alpha=math.acos(float(np.clip(cosine,-1,1)))
        if alpha<1e-5 or alpha>=math.pi/2: raise ValueError("sphere too small or invalid for depth")
        residual=np.arccos(np.clip(rays@axis,-1,1))-alpha
        delta=1.345*max(pixel_angle,1.4826*float(np.median(np.abs(residual))),1e-10)
        weights=np.minimum(1.,delta/np.maximum(np.abs(residual),1e-12))
    residual_rms=math.sqrt(float(np.average(residual**2,weights=weights)))
    # This is a per-silhouette uncertainty floor, not /sqrt(number of pixels):
    # quantization and segmentation bias are correlated along the boundary.
    sigma=max(pixel_angle,residual_rms)
    return axis,alpha,sigma,{"boundary_points":len(points),"angular_residual_rms_rad":residual_rms,
                            "pixel_center_offset_px":float(pixel_center_offset_px),"fit":"unit-ray tangent cone, six Huber iterations"}


def triangulate(left, right, c):
    P,Q = np.asarray(c["projection_left"],float),np.asarray(c["projection_right"],float)
    A = np.stack((left[0]*P[2]-P[0],left[1]*P[2]-P[1],right[0]*Q[2]-Q[0],right[1]*Q[2]-Q[1]))
    _,s,vh = np.linalg.svd(A)
    X=vh[-1]
    if abs(X[3])<1e-10 or s[-2]<1e-10:
        raise ValueError("stereo depth is degenerate")
    X=X/X[3]
    projections=[P@X,Q@X]
    if any(p[2]<=0 for p in projections):
        raise ValueError("point behind camera")
    err=max(float(np.linalg.norm(p[:2]/p[2]-obs)) for p,obs in zip(projections,(left,right)))
    if err>c.get("max_reprojection_error_px",3.):
        raise ValueError("stereo reprojection threshold exceeded")
    return X[:3].tolist(),err


def reconstruct(detection, calibration, secondary=None):
    mode=calibration["mode"]
    if mode=="uncalibrated":
        return None,None
    c=np.asarray(detection["centroid"],float); px=float(calibration["pixel_uncertainty"])
    if mode=="plane_homography":
        uv=np.asarray(project(calibration["H"],c))
        u,v=np.asarray(calibration["axis_u"]),np.asarray(calibration["axis_v"])
        p=np.asarray(calibration["origin_m"])+u*uv[0]+v*uv[1]
        shifts=[np.abs(np.asarray(project(calibration["H"],c+d))-uv) for d in ([px,0],[0,px])]
        sig=np.abs(u)*max(x[0] for x in shifts)+np.abs(v)*max(x[1] for x in shifts)
        return p.tolist(),{"position_std_m":sig.tolist(),"depth":"unobserved","method":"pixel perturbation, conditional on plane"}
    if mode=="stereo":
        if not secondary:
            raise ValueError("no synchronized secondary detection")
        p,err=triangulate(c,secondary["centroid"],calibration)
        trials=[]
        for i in range(4):
            l,r=c.copy(),np.asarray(secondary["centroid"],float).copy()
            (l if i<2 else r)[i%2]+=px
            try: trials.append(np.asarray(triangulate(l,r,calibration)[0])-p)
            except ValueError: pass
        sig=np.sqrt(np.sum(np.square(trials),axis=0)).tolist() if trials else None
        return p,{"position_std_m":sig,"reprojection_error_px":err,"method":"stereo pixel perturbation"}
    if not detection.get("mask_decoded") or detection.get("eccentricity",1)>.85:
        raise ValueError("sphere depth requires a complete circular decoded mask")
    polygon=detection.get("boundary_samples_px") or max(detection.get("polygons",[]),key=len,default=[])
    if len(polygon)<8:
        raise ValueError("insufficient sphere boundary")
    axis,alpha,ang_sigma,diagnostic=sphere_tangent_cone(polygon,calibration["camera_matrix"],px,calibration.get("pixel_center_offset_px",0.))
    distance=calibration["ball_diameter_m"]/2/math.sin(alpha)
    R=np.asarray(calibration["camera_to_world_rotation"],float)
    p=R@(axis*distance)+np.asarray(calibration["camera_to_world_translation_m"],float)
    depth_sigma=distance*math.hypot(calibration["diameter_uncertainty_m"]/calibration["ball_diameter_m"],ang_sigma/max(math.tan(alpha),1e-9))
    sig=(np.abs(R@axis)*depth_sigma+distance*ang_sigma).tolist()
    return p.tolist(),{"position_std_m":sig,"depth_std_m":depth_sigma,"method":"robust sphere tangent cone + measured diameter",**diagnostic}
