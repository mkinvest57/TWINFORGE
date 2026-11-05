/** Local appearance tracking initialized exclusively from a decoded SAM mask.
 * Hue is learned from masked image pixels, never a renderer palette. */
import {createTracker,estimateCameraMotion} from '../camera/tracker.mjs';
const distance=(a,b)=>Math.min(Math.abs(a-b),360-Math.abs(a-b));
const quantile=(values,fraction)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*fraction)];};
function hsv(data,i){
  const r=data[i],g=data[i+1],b=data[i+2],high=Math.max(r,g,b),low=Math.min(r,g,b),delta=high-low;
  let h=0;if(delta)h=high===r?60*((g-b)/delta%6):high===g?60*((b-r)/delta+2):60*((r-g)/delta+4);
  return {h:(h+360)%360,s:high?delta/high:0,v:high,chroma:delta};
}
function insidePolygon(x,y,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
function dominant(frame,roi,polygons){
  if(frame.data.length!==frame.width*frame.height*4||!polygons?.length)return null;
  const pixels=[],bins=new Array(36).fill(0);let masked=0;
  for(let y=Math.max(0,Math.floor(roi.y));y<Math.min(frame.height,roi.y+roi.height);y++)for(let x=Math.max(0,Math.floor(roi.x));x<Math.min(frame.width,roi.x+roi.width);x++){
    if(!polygons.some(p=>insidePolygon(x+.5,y+.5,p)))continue;masked++;
    const color=hsv(frame.data,(y*frame.width+x)*4);
    if(color.s<.3||color.chroma<35||color.v<45)continue;
    pixels.push({...color,x,y});bins[Math.floor(color.h/10)]++;
  }
  if(pixels.length<25||pixels.length<masked*.45)return null;
  let best=0;for(let i=1;i<36;i++)if(bins[i]+bins[(i+1)%36]+bins[(i+35)%36]>bins[best]+bins[(best+1)%36]+bins[(best+35)%36])best=i;
  const cluster=pixels.filter(p=>distance(p.h,best*10+5)<25);
  if(cluster.length<pixels.length*.8)return null;
  const angle=Math.atan2(cluster.reduce((s,p)=>s+Math.sin(p.h*Math.PI/180),0),cluster.reduce((s,p)=>s+Math.cos(p.h*Math.PI/180),0));
  return {h:(angle*180/Math.PI+360)%360,minS:Math.max(.22,cluster.reduce((s,p)=>Math.min(s,p.s),1)*.7),
    // A hue alone is not an object's appearance. A dark blue wall/grid must
    // not join a bright blue object into one connected component. These
    // thresholds are learned from the real SAM mask's lower color quantile.
    minV:Math.max(35,quantile(cluster.map(p=>p.v),.1)*.70),minChroma:Math.max(25,quantile(cluster.map(p=>p.chroma),.1)*.65),area:cluster.length,
    point:{x:cluster.reduce((s,p)=>s+p.x+.5,0)/cluster.length,y:cluster.reduce((s,p)=>s+p.y+.5,0)/cluster.length}};
}
function components(frame,region,color){
  const x0=Math.max(0,Math.floor(region.x)),y0=Math.max(0,Math.floor(region.y));
  const x1=Math.min(frame.width,Math.ceil(region.x+region.width)),y1=Math.min(frame.height,Math.ceil(region.y+region.height)),w=x1-x0,h=y1-y0;
  if(w<=0||h<=0)return [];
  const mask=new Uint8Array(w*h),queue=new Int32Array(w*h),out=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=hsv(frame.data,((y+y0)*frame.width+x+x0)*4);if(p.s>=color.minS&&p.chroma>=color.minChroma&&p.v>=color.minV&&distance(p.h,color.h)<=22)mask[y*w+x]=1;
  }
  for(let start=0;start<mask.length;start++)if(mask[start]){
    let head=0,tail=1,sx=0,sy=0,minX=w,minY=h,maxX=0,maxY=0,touches=false;queue[0]=start;mask[start]=0;
    while(head<tail){const k=queue[head++],x=k%w,y=Math.floor(k/w);sx+=x+x0+.5;sy+=y+y0+.5;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);if(x===0||y===0||x===w-1||y===h-1)touches=true;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const n=yy*w+xx;if(mask[n]){mask[n]=0;queue[tail++]=n;}}
    }
    out.push({area:tail,point:{x:sx/tail,y:sy/tail},box:{x:minX+x0,y:minY+y0,width:maxX-minX+1,height:maxY-minY+1},touches});
  }return out;
}
export function createSamTracker(options={}){
  const fallback=createTracker(options);let state=null,mode='ncc';
  const lost=(t,reason,extra={})=>({status:'lost',t,point:null,box:null,confidence:0,reason,identityGuaranteed:false,units:'px',...extra});
  const seen=(t,confidence,reason)=>({status:'tracking',t,point:{...state.point},box:{...state.box},confidence,reason,identityGuaranteed:false,units:'px',diagnostics:{method:'sam_mask_color_components',cameraMotionObservable:state.motionObservable??false}});
  function select(frame,roi,t){
    state=null;mode='ncc';const color=dominant(frame,roi,options.samMaskPolygons);
    if(!color)return fallback.select(frame,roi,t);
    mode='color';state={color,point:color.point,box:{...roi},frame,t,lastSeen:t,velocity:{x:0,y:0},failed:false};
    return seen(t,1,'sam_mask_color_anchor');
  }
  function update(frame,t){
    if(mode!=='color')return fallback.update(frame,t);
    if(!state)return lost(t,'no_selection',{requiresReselection:true});
    if(!Number.isFinite(t)||t<=state.t)return lost(t,'non_increasing_timestamp');
    if(frame.width!==state.frame.width||frame.height!==state.frame.height||frame.data.length!==frame.width*frame.height*4)return lost(t,'frame_dimensions_changed',{requiresReselection:true});
    if(state.failed)return lost(t,'sam_resegmentation_required',{requiresReselection:true});
    const dt=t-state.t;if(dt>(options.maxFrameGap??.5)){state.failed=true;return lost(t,'tracking_window_expired',{requiresReselection:true});}
    const motion=estimateCameraMotion(state.frame,frame,state.box,options);state.frame=frame;state.t=t;state.motionObservable=motion.observable;
    if(motion.moving){state.failed=true;return lost(t,'coherent_background_motion',{status:'camera_moving',requiresReselection:true,diagnostics:{cameraMotion:motion}});}
    const scale=Math.max(1,Math.max(frame.width,frame.height)/(options.maxDimension??320));
    const radius=(options.maxSearchRadiusPx??52)*scale;
    const center={x:state.point.x+state.velocity.x*Math.min(dt,.18),y:state.point.y+state.velocity.y*Math.min(dt,.18)};
    // A velocity extrapolation can point away from an object immediately
    // after an unseen collision. Search both the predicted neighborhood and
    // the last actually measured neighborhood; do not assume the bounce.
    const left=Math.min(center.x,state.point.x),top=Math.min(center.y,state.point.y);
    const region={x:left-state.box.width/2-radius,y:top-state.box.height/2-radius,
      width:Math.abs(center.x-state.point.x)+state.box.width+radius*2,height:Math.abs(center.y-state.point.y)+state.box.height+radius*2};
    const candidates=components(frame,region,state.color).filter(c=>!c.touches&&c.area>=state.color.area*.65&&c.area<=state.color.area*1.8&&
      Math.min(Math.hypot(c.point.x-center.x,c.point.y-center.y),Math.hypot(c.point.x-state.point.x,c.point.y-state.point.y))<=radius);
    if(candidates.length!==1){state.failed=true;return lost(t,candidates.length?'ambiguous_color_components':'color_component_occluded_or_missing',{requiresReselection:true});}
    const c=candidates[0],old=state.point;
    state.velocity={x:.4*state.velocity.x+.6*(c.point.x-old.x)/dt,y:.4*state.velocity.y+.6*(c.point.y-old.y)/dt};state.point=c.point;state.box=c.box;state.lastSeen=t;
    return seen(t,Math.max(.25,1-Math.abs(Math.log(c.area/state.color.area))), 'sam_color_component');
  }
  return {select,update,reset(){state=null;mode='ncc';fallback.reset();}};
}
