/** Sparse pyramidal image flow, anchored inside an actual SAM mask.
 * Tracks image features, not an object class, so a hand, label or bottle can
 * move/deform without having one fixed template or one dominant color.
 * Lucas–Kanade pyramid reference: docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html
 * This small JS implementation is independent of OpenCV; no model is substituted
 * for SAM. Forward/backward consistency and robust consensus reject bad flow.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const median=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);const i=s.length>>1;return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const pyramidCache=new WeakMap();
function greyPyramid(frame,maxDimension){
  let entries=pyramidCache.get(frame);if(entries?.has(maxDimension))return entries.get(maxDimension);
  const scale=Math.min(1,maxDimension/Math.max(frame.width,frame.height)),w=Math.max(16,Math.round(frame.width*scale)),h=Math.max(16,Math.round(frame.height*scale));
  const rgba=frame.data.length===frame.width*frame.height*4,data=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=Math.min(frame.height-1,Math.floor((y+.5)*frame.height/h))*frame.width+Math.min(frame.width-1,Math.floor((x+.5)*frame.width/w));
    data[y*w+x]=rgba ? .299*frame.data[k*4]+.587*frame.data[k*4+1]+.114*frame.data[k*4+2]:frame.data[k];
  }
  const levels=[{width:w,height:h,data}];
  while(levels.length<3&&Math.min(levels.at(-1).width,levels.at(-1).height)>=40){
    const p=levels.at(-1),width=Math.floor(p.width/2),height=Math.floor(p.height/2),d=new Float32Array(width*height);
    // Binomial prefilter avoids aliasing the finer texture between levels.
    const weights=[1,2,1];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){let sum=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=p.data[clamp(y*2+j,0,p.height-1)*p.width+clamp(x*2+i,0,p.width-1)]*weights[i+1]*weights[j+1];d[y*width+x]=sum/16;}
    levels.push({width,height,data:d});
  }
  const out={levels,sx:frame.width/w,sy:frame.height/h,width:w,height:h};
  if(!entries){entries=new Map();pyramidCache.set(frame,entries);}entries.set(maxDimension,out);return out;
}
function sample(im,x,y){
  const ix=clamp(Math.floor(x),0,im.width-2),iy=clamp(Math.floor(y),0,im.height-2),fx=clamp(x-ix,0,1),fy=clamp(y-iy,0,1),k=iy*im.width+ix;
  return (im.data[k]*(1-fx)+im.data[k+1]*fx)*(1-fy)+(im.data[k+im.width]*(1-fx)+im.data[k+im.width+1]*fx)*fy;
}
function inPolygon(x,y,p){let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!==(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;return inside;}
function featurePoints(im,box,polygons,count=42){
  const list=[],selected=[];
  const x0=Math.max(5,Math.floor(box.x)),x1=Math.min(im.width-6,Math.ceil(box.x+box.width));
  const y0=Math.max(5,Math.floor(box.y)),y1=Math.min(im.height-6,Math.ceil(box.y+box.height));
  for(let y=y0;y<=y1;y+=2)for(let x=x0;x<=x1;x+=2){
    if(polygons.length&&!polygons.some(p=>inPolygon(x,y,p)))continue;
    let xx=0,xy=0,yy=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const k=(y+j)*im.width+x+i,gx=(im.data[k+1]-im.data[k-1])*.5,gy=(im.data[k+im.width]-im.data[k-im.width])*.5;xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;}
    const eigen=.5*(xx+yy-Math.sqrt((xx-yy)**2+4*xy*xy));if(eigen>24)list.push({x,y,score:eigen});
  }
  list.sort((a,b)=>b.score-a.score);
  const minDistance=Math.max(4,Math.min(box.width,box.height)/9);
  for(const p of list){if(selected.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=minDistance))selected.push(p);if(selected.length>=count)break;}
  return selected;
}
function flow(previous,current,p,guess){
  let q=null,lastError=Infinity;
  for(let level=previous.levels.length-1;level>=0;level--){
    const scale=2**level,a=previous.levels[level],b=current.levels[level],px=p.x/scale,py=p.y/scale;
    q=q?{x:q.x*2,y:q.y*2}:{x:guess.x/scale,y:guess.y/scale};
    const radius=3;
    if(px<radius+1||py<radius+1||px>=a.width-radius-2||py>=a.height-radius-2)continue;
    const samples=[];let xx=0,xy=0,yy=0,meanA=0;
    for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++){
      const value=sample(a,px+x,py+y),gx=(sample(a,px+x+1,py+y)-sample(a,px+x-1,py+y))*.5,gy=(sample(a,px+x,py+y+1)-sample(a,px+x,py+y-1))*.5;
      samples.push({x,y,value,gx,gy});xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;meanA+=value;
    }
    const det=xx*yy-xy*xy;if(det<1e-5||Math.min(xx,yy)<20)return null;meanA/=samples.length;
    for(let iteration=0;iteration<9;iteration++){
      if(q.x<radius+1||q.y<radius+1||q.x>=b.width-radius-2||q.y>=b.height-radius-2)return null;
      let bx=0,by=0,meanB=0;
      const values=samples.map(s=>{const v=sample(b,q.x+s.x,q.y+s.y);meanB+=v;return v;});meanB/=samples.length;
      let residual=0;
      for(let i=0;i<samples.length;i++){const s=samples[i],error=(s.value-meanA)-(values[i]-meanB);bx+=s.gx*error;by+=s.gy*error;residual+=Math.abs(error);}
      const dx=(yy*bx-xy*by)/det,dy=(xx*by-xy*bx)/det;
      if(!Number.isFinite(dx+dy)||Math.abs(dx)>6||Math.abs(dy)>6)return null;
      q.x+=dx;q.y+=dy;lastError=residual/samples.length;
      if(dx*dx+dy*dy<.0025)break;
    }
  }
  return q&&lastError<24?{...q,error:lastError}:null;
}
const center=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
export function createFeatureFlowTracker(options={}){
  const maxDimension=Math.min(480,options.maxDimension??320);let state=null;
  function result(status,t,reason,extra={}){return {status,t,reason,point:null,box:null,confidence:0,identityGuaranteed:false,units:'px',requiresReselection:status!=='tracking',...extra};}
  function seen(t,confidence,reason,diagnostics={}){
    const b=state.box,p=center(b),im=state.pyramid;
    return result('tracking',t,reason,{point:{x:p.x*im.sx,y:p.y*im.sy},box:{x:b.x*im.sx,y:b.y*im.sy,width:b.width*im.sx,height:b.height*im.sy},confidence,
      diagnostics:{method:'sam_mask_pyramidal_feature_flow',featureCount:state.points.length,cameraMotionCompensated:false,coordinates:'image_plane',...diagnostics}});
  }
  function select(frame,roi,t){
    state=null;const pyramid=greyPyramid(frame,maxDimension),im=pyramid.levels[0];
    const polygons=(options.samMaskPolygons??[]).map(p=>p.map(([x,y])=>[x/pyramid.sx,y/pyramid.sy]));
    const box={x:roi.x/pyramid.sx,y:roi.y/pyramid.sy,width:roi.width/pyramid.sx,height:roi.height/pyramid.sy};
    const points=featurePoints(im,box,polygons);
    if(points.length<3)return result('lost',t,'sam_mask_has_too_few_trackable_features',{diagnostics:{featureCount:points.length}});
    state={pyramid,box,points,polygons,t,failed:false,velocity:{x:0,y:0},initialFeatures:points.length,lastFeatureRefresh:t};
    return seen(t,1,'sam_mask_feature_anchor');
  }
  function update(frame,t){
    if(!state)return result('lost',t,'no_selection');
    if(!Number.isFinite(t)||t<=state.t)return result('lost',t,'non_increasing_timestamp');
    if(state.failed)return result('lost',t,'sam_resegmentation_required');
    const dt=t-state.t,current=greyPyramid(frame,maxDimension);
    if(current.width!==state.pyramid.width||current.height!==state.pyramid.height||dt>(options.maxFrameGap??.5)){state.failed=true;return result('lost',t,'tracking_window_expired');}
    const matches=[];
    for(const p of state.points){
      const q=flow(state.pyramid,current,p,{x:p.x+state.velocity.x*dt,y:p.y+state.velocity.y*dt});if(!q)continue;
      const back=flow(current,state.pyramid,q,p);if(!back||Math.hypot(back.x-p.x,back.y-p.y)>1.35)continue;
      matches.push({p,q,dx:q.x-p.x,dy:q.y-p.y,error:q.error});
    }
    if(matches.length<3){state.failed=true;return result('lost',t,'insufficient_consistent_features',{diagnostics:{matched:matches.length,total:state.points.length}});}
    const dx=median(matches.map(m=>m.dx)),dy=median(matches.map(m=>m.dy));
    const residual=median(matches.map(m=>Math.hypot(m.dx-dx,m.dy-dy))),threshold=Math.max(2.5,residual*3);
    const good=matches.filter(m=>Math.hypot(m.dx-dx,m.dy-dy)<=threshold);
    if(good.length<3||good.length<state.points.length*.22){state.failed=true;return result('lost',t,'ambiguous_feature_motion');}
    const translations={x:median(good.map(m=>m.dx)),y:median(good.map(m=>m.dy))},ratios=[];
    for(let i=0;i<good.length;i++)for(let j=i+1;j<good.length;j++){
      const before=Math.hypot(good[i].p.x-good[j].p.x,good[i].p.y-good[j].p.y);if(before<14)continue;
      const ratio=Math.hypot(good[i].q.x-good[j].q.x,good[i].q.y-good[j].q.y)/before;if(ratio>.75&&ratio<1.3)ratios.push(ratio);
    }
    const scale=ratios.length>=4?clamp(median(ratios),.88,1.14):1;
    const oldCenter=center(state.box);
    // Features rarely surround the object's center symmetrically (a bottle
    // label or fingertips can carry most of the texture). Scale their offsets
    // about the old center before estimating its translation, otherwise zoom
    // incorrectly drags the tracked center toward the textured side.
    const newCenter={x:median(good.map(m=>m.q.x-scale*(m.p.x-oldCenter.x))),y:median(good.map(m=>m.q.y-scale*(m.p.y-oldCenter.y)))};
    const width=state.box.width*scale,height=state.box.height*scale;
    if(width<6||height<6||newCenter.x<0||newCenter.y<0||newCenter.x>=current.width||newCenter.y>=current.height){state.failed=true;return result('lost',t,'object_out_of_view');}
    state.box={x:newCenter.x-width/2,y:newCenter.y-height/2,width,height};
    state.polygons=state.polygons.map(p=>p.map(([x,y])=>[newCenter.x+(x-oldCenter.x)*scale,newCenter.y+(y-oldCenter.y)*scale]));
    const retained=good.map(m=>({x:m.q.x,y:m.q.y,score:m.p.score}));
    // Renew only within the transformed original SAM support, after a strong
    // forward/backward consensus; an arbitrary new region is never detected.
    // Existing features already carry the identity. A complete contour scan
    // on every frame wastes most of the camera budget when 40+ features are
    // still healthy; replenish only a depleted set, with a short cooldown.
    if(retained.length<28&&(retained.length<10||t-state.lastFeatureRefresh>=.25)&&good.length>=Math.max(5,state.points.length*.55)){
      const fresh=featurePoints(current.levels[0],state.box,state.polygons,42);
      for(const p of fresh){if(retained.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>4.5))retained.push(p);if(retained.length>=42)break;}
      state.lastFeatureRefresh=t;
    }
    const fraction=good.length/state.points.length,meanError=good.reduce((s,m)=>s+m.error,0)/good.length;
    state.points=retained;state.velocity={x:translations.x/dt,y:translations.y/dt};state.pyramid=current;state.t=t;
    return seen(t,clamp(.4+.6*fraction-.012*meanError,.15,1),'feature_flow_consensus',{matched:good.length,retained:retained.length,flowResidualPx:residual,scale,forwardBackwardChecked:true});
  }
  return {select,update,reset(){state=null;}};
}
