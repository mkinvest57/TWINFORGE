/** Deterministic local tracking of a user-selected image patch; no semantic model.
 * Coordinates and ROI are in supplied-frame pixels; timestamps are seconds.
 * RGBA and grey frames use {width,height,data}. No DOM, API or paid dependency.
 */
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const median=a=>{const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length?(s.length%2?s[m]:(s[m-1]+s[m])/2):0;};
export const TRACKER_DEFAULTS=Object.freeze({maxDimension:320,templateSize:16,minTextureStd:7,
  minSimilarity:.74,minUniqueness:.055,searchRadiusPx:24,maxSearchRadiusPx:52,maxLostSeconds:.65,
  maxFrameGap:.5,adaptationRate:.015,cameraMotionThresholdPx:1.5,cameraSearchRadiusPx:6});

function imageOf(frame,maxDimension){
  const width=Number(frame?.width),height=Number(frame?.height),data=frame?.data;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||!data||![width*height,width*height*4].includes(data.length))throw new TypeError('Frame must contain width × height grey or RGBA pixels.');
  const scale=Math.min(1,maxDimension/Math.max(width,height)),w=Math.max(8,Math.round(width*scale)),h=Math.max(8,Math.round(height*scale));
  const grey=new Float32Array(w*h),rgba=data.length===width*height*4;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const ix=Math.min(width-1,Math.floor((x+.5)*width/w)),iy=Math.min(height-1,Math.floor((y+.5)*height/h)),i=iy*width+ix;
    grey[y*w+x]=rgba?(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]):data[i];
  }
  return {width:w,height:h,data:grey,sourceWidth:width,sourceHeight:height,sx:width/w,sy:height/h};
}
function pixel(im,x,y){
  x=clamp(x,0,im.width-1);y=clamp(y,0,im.height-1);
  const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0,x1=Math.min(x0+1,im.width-1),y1=Math.min(y0+1,im.height-1);
  return (im.data[y0*im.width+x0]*(1-fx)+im.data[y0*im.width+x1]*fx)*(1-fy)+(im.data[y1*im.width+x0]*(1-fx)+im.data[y1*im.width+x1]*fx)*fy;
}
function patch(im,box,n){
  const values=new Float32Array(n*n);let sum=0;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const v=pixel(im,box.x+(i+.5)*box.width/n-.5,box.y+(j+.5)*box.height/n-.5);values[j*n+i]=v;sum+=v;}
  const mean=sum/values.length;let square=0;
  for(let i=0;i<values.length;i++){values[i]-=mean;square+=values[i]*values[i];}
  const norm=Math.sqrt(square);return {values,norm,std:norm/Math.sqrt(values.length),mean};
}
function correlation(a,b){if(a.norm<1e-8||b.norm<1e-8)return -1;let dot=0;for(let i=0;i<a.values.length;i++)dot+=a.values[i]*b.values[i];return clamp(dot/(a.norm*b.norm),-1,1);}
const centre=b=>({x:b.x+b.width/2,y:b.y+b.height/2});
const inside=(b,im)=>b.x>=0&&b.y>=0&&b.x+b.width<=im.width&&b.y+b.height<=im.height;
const contains=(b,x,y,pad=0)=>x>=b.x-pad&&x<=b.x+b.width+pad&&y>=b.y-pad&&y<=b.y+b.height+pad;

function cameraMotion(previous,current,exclude,o){
  if(!previous)return {observable:false,moving:false,matches:0};
  const shifts=[],radius=o.cameraSearchRadiusPx,n=5,size=9;
  for(let row=0;row<5;row++)for(let col=0;col<6;col++){
    const x=(col+.5)*current.width/6,y=(row+.5)*current.height/5;
    if(contains(exclude,x,y,Math.max(exclude.width,exclude.height)*.6))continue;
    const box={x:x-size/2,y:y-size/2,width:size,height:size};
    if(box.x<radius||box.y<radius||box.x+size+radius>current.width||box.y+size+radius>current.height)continue;
    const anchor=patch(previous,box,n);if(anchor.std<o.minTextureStd)continue;
    const zero=correlation(anchor,patch(current,box,n));
    if(zero>.985){shifts.push({dx:0,dy:0,col,row,score:zero});continue;}
    let best={score:-1,dx:0,dy:0};
    for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
      const score=correlation(anchor,patch(current,{...box,x:box.x+dx,y:box.y+dy},n));
      if(score>best.score)best={score,dx,dy};
    }
    if(best.score>.88)shifts.push({...best,col,row});
  }
  const dx=median(shifts.map(s=>s.dx)),dy=median(shifts.map(s=>s.dy));
  const coherent=shifts.filter(s=>Math.hypot(s.dx-dx,s.dy-dy)<=1.25);
  const quadrants=new Set(shifts.map(s=>(s.col<3?0:1)+(s.row<2?0:2)));
  const observable=shifts.length>=8&&quadrants.size>=3;
  const moving=shifts.filter(s=>Math.hypot(s.dx,s.dy)>=o.cameraMotionThresholdPx);
  const movingQuadrants=new Set(moving.map(s=>(s.col<3?0:1)+(s.row<2?0:2)));
  const translated=coherent.length/Math.max(1,shifts.length)>=.7&&Math.hypot(dx,dy)>=o.cameraMotionThresholdPx;
  // Rotation/zoom need not have one common translation. Widespread reliable
  // background motion is sufficient to stop, without claiming camera pose.
  const distributed=moving.length/Math.max(1,shifts.length)>=.7&&movingQuadrants.size>=3;
  return {observable,moving:observable&&(translated||distributed),motionKind:translated?'translation':distributed?'distributed_background_flow':'none',
    matches:shifts.length,coherence:shifts.length?coherent.length/shifts.length:0,displacementPx:{x:dx,y:dy}};
}

/** Shared pixel-only background check for alternative appearance trackers. */
export function estimateCameraMotion(previous,current,exclude,options={}){
  const o={...TRACKER_DEFAULTS,...options},im=imageOf(current,o.maxDimension),before=imageOf(previous,o.maxDimension);
  return cameraMotion(before,im,{x:exclude.x/im.sx,y:exclude.y/im.sy,width:exclude.width/im.sx,height:exclude.height/im.sy},o);
}

export function createTracker(options={}){
  const o={...TRACKER_DEFAULTS,...options};
  for(const k of Object.keys(TRACKER_DEFAULTS))if(!Number.isFinite(o[k])||o[k]<0)throw new TypeError(`Invalid tracker option ${k}`);
  o.templateSize=Math.max(8,Math.round(o.templateSize));o.maxDimension=clamp(Math.round(o.maxDimension),64,640);
  let state=null,selectionCounter=0;
  function result(status,t,reason,extra={}){
    return {status,t,reason,point:null,box:null,confidence:0,trackId:state?.id??null,
      identityGuaranteed:false,units:'px',requiresReselection:false,...extra};
  }
  function reset(){state=null;}
  function select(frame,roi,t){
    if(!Number.isFinite(t))throw new TypeError('Timestamp must be finite seconds.');
    const im=imageOf(frame,o.maxDimension);
    if(!roi||!['x','y','width','height'].every(k=>Number.isFinite(roi[k]))||roi.width<=0||roi.height<=0)throw new TypeError('Selection needs a finite positive rectangle.');
    const x=clamp(roi.x/im.sx,0,im.width),y=clamp(roi.y/im.sy,0,im.height);
    const box={x,y,width:Math.min(roi.width/im.sx,im.width-x),height:Math.min(roi.height/im.sy,im.height-y)};
    reset();
    if(Math.min(box.width,box.height)<6)return result('lost',t,'selection_too_small',{requiresReselection:true});
    const anchor=patch(im,box,o.templateSize);
    if(anchor.std<o.minTextureStd)return result('lost',t,'low_texture',{requiresReselection:true,diagnostics:{textureStd:anchor.std}});
    state={id:++selectionCounter,anchor,adaptive:anchor,box,im,t,lastSeen:t,velocity:{x:0,y:0},lost:false,cameraMoved:false};
    return tracked(im,box,t,1,'selected',{textureStd:anchor.std,cameraMotionObservable:false});
  }
  function tracked(im,box,t,confidence,reason,diagnostics){
    const p=centre(box);
    return result('tracking',t,reason,{point:{x:p.x*im.sx,y:p.y*im.sy},box:{x:box.x*im.sx,y:box.y*im.sy,width:box.width*im.sx,height:box.height*im.sy},confidence,diagnostics});
  }
  function update(frame,t){
    if(!Number.isFinite(t))throw new TypeError('Timestamp must be finite seconds.');
    if(!state)return result('lost',t,'no_selection',{requiresReselection:true});
    if(t<=state.t)return result('lost',t,'non_increasing_timestamp');
    const im=imageOf(frame,o.maxDimension),dt=t-state.t;
    if(im.sourceWidth!==state.im.sourceWidth||im.sourceHeight!==state.im.sourceHeight){reset();return result('lost',t,'frame_dimensions_changed',{requiresReselection:true});}
    if(state.cameraMoved)return result('camera_moving',t,'camera_motion_requires_reselection',{requiresReselection:true});
    if(dt>o.maxFrameGap||t-state.lastSeen>o.maxLostSeconds){state.t=t;state.lost=true;return result('lost',t,'tracking_window_expired',{requiresReselection:true});}
    const motion=cameraMotion(state.im,im,state.box,o);state.im=im;state.t=t;
    if(motion.moving){state.cameraMoved=true;return result('camera_moving',t,'coherent_background_motion',{requiresReselection:true,diagnostics:{cameraMotion:motion}});}
    const old=centre(state.box),age=t-state.lastSeen;
    const predicted={x:old.x+state.velocity.x*Math.min(age,.18),y:old.y+state.velocity.y*Math.min(age,.18)};
    const radius=Math.min(o.maxSearchRadiusPx,o.searchRadiusPx+Math.max(0,age-.1)*35),candidates=[];
    const candidate=(x,y,scale=1)=>{
      const box={x:x-state.box.width*scale/2,y:y-state.box.height*scale/2,width:state.box.width*scale,height:state.box.height*scale};
      if(!inside(box,im))return null;
      const sample=patch(im,box,o.templateSize);if(sample.std<Math.max(o.minTextureStd*.5,state.anchor.std*.3))return null;
      const anchorScore=correlation(state.anchor,sample),score=.8*anchorScore+.2*correlation(state.adaptive,sample);
      return {x,y,box,sample,score,anchorScore};
    };
    // Cover each integer displacement: a two-pixel stride aliases fine texture
    // and can miss a genuine one-pixel translation. Search remains local.
    // No predicted position is ever returned as an observation.
    for(let dy=-Math.floor(radius);dy<=radius;dy++)for(let dx=-Math.floor(radius);dx<=radius;dx++){
      const c=candidate(Math.round(predicted.x)+dx,Math.round(predicted.y)+dy);if(c)candidates.push(c);
    }
    candidates.sort((a,b)=>b.score-a.score);let best=candidates[0];
    if(best){
      const coarse=best;
      for(const scale of [.96,1,1.04])for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        const c=candidate(coarse.x+dx,coarse.y+dy,scale);if(c&&c.score>best.score)best=c;
      }
    }
    const second=best?candidates.find(c=>Math.hypot(c.x-best.x,c.y-best.y)>Math.max(4,Math.min(best.box.width,best.box.height)*.7)):null;
    const uniqueness=best?best.score-(second?.score??-1):0;
    const diagnostics={similarity:best?.score??null,anchorSimilarity:best?.anchorScore??null,uniqueness,cameraMotionObservable:motion.observable,cameraMotion:motion,searchRadiusPx:radius};
    if(!best||best.score<o.minSimilarity||best.anchorScore<o.minSimilarity-.03||uniqueness<o.minUniqueness){
      state.lost=true;return result('lost',t,!best||best.score<o.minSimilarity?'appearance_not_found':'ambiguous_match',{diagnostics});
    }
    // Interpolate only the measured correlation peak, never a future frame.
    const scale=best.box.width/state.box.width,scoreAt=(x,y)=>candidate(x,y,scale)?.score??best.score;
    const sub=(a,b,c)=>{const d=a-2*b+c;return d< -1e-6?clamp(.5*(a-c)/d,-.5,.5):0;};
    const sx=sub(scoreAt(best.x-1,best.y),best.score,scoreAt(best.x+1,best.y));
    const sy=sub(scoreAt(best.x,best.y-1),best.score,scoreAt(best.x,best.y+1));
    const refined=candidate(best.x+sx,best.y+sy,scale);if(refined&&refined.score>=best.score-.01)best=refined;
    const reacquired=state.lost;
    state.velocity=reacquired?{x:0,y:0}:{x:.4*state.velocity.x+.6*(best.x-old.x)/age,y:.4*state.velocity.y+.6*(best.y-old.y)/age};
    state.box=best.box;state.lastSeen=t;state.lost=false;
    const confidence=clamp((best.score-o.minSimilarity)/(1-o.minSimilarity),0,1)*clamp(uniqueness/.15,0,1)*(reacquired?.7:1);
    if(!reacquired&&best.anchorScore>.94&&uniqueness>.12&&confidence>.85){
      const values=state.adaptive.values.map((v,i)=>v*(1-o.adaptationRate)+best.sample.values[i]*o.adaptationRate);
      const norm=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0));state.adaptive={...state.adaptive,values,norm};
    }
    return tracked(im,state.box,t,confidence,reacquired?'reacquired_appearance_identity_unverified':'appearance_match',diagnostics);
  }
  return {select,update,reset};
}
