import {createTracker} from './tracker.mjs';
import {forecast,assessForecast} from './prediction.mjs';
import {CameraSession,recordingMime,imageRect,pointInImage} from './media.mjs';

const cameraErrorMessage=error=>({
  NotAllowedError:'Camera access was denied. Allow it in your browser settings, then try again.',
  NotFoundError:'No camera found. You can import a video instead.',
  NotReadableError:'The camera is busy or unavailable. Close other camera apps.',
  OverconstrainedError:'This camera does not support the requested settings.',
  SecurityError:'Camera access is blocked. Open this page over HTTPS.',
})[error?.name]||'Could not open the camera. Try again or import a video.';
const $=id=>document.getElementById(id);
const video=$('camera-video'),overlay=$('camera-overlay'),stage=$('camera-stage');
const ctx=overlay.getContext('2d'),sample=document.createElement('canvas'),sampleCtx=sample.getContext('2d',{willReadFrequently:true});
const fixture=document.createElement('canvas'),fixtureCtx=fixture.getContext('2d');
fixture.width=640;fixture.height=480;sample.width=320;sample.height=240;
const camera=new CameraSession(navigator.mediaDevices),tracker=createTracker();
let source=null,sessionSource=null,sourceGeneration=0,sourceURL=null,facing='environment',running=false,selected=false,frame=null,result=null,prediction=null;
let observations=[],predictions=[],assessments=[],lastFrameTime=-1,lastIssue=-Infinity,lastProcess=0,loopId=null,videoLoop=false,selectionStart=null,selectionEnd=null;
let sessionId=crypto.randomUUID?.()||String(Date.now()),fixtureTime=0,fixtureLast=0,recorder=null,recordTimer=null,recordURL=null,recordData=[],recordBytes=0,drawRect=null;
const status=text=>{$('camera-status').textContent=text;};
const text=(id,value)=>{if($(id))$(id).textContent=value;};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function buttons(){
  $('camera-empty').hidden=!!source;
  $('camera-stop').disabled=!source&&!camera.stream&&!running;
  $('camera-flip').disabled=source!=='camera';
  $('camera-center').disabled=!frame;
  $('camera-reset').disabled=!frame;
  $('camera-export').disabled=!observations.length;
  $('camera-record').disabled=source!=='camera'&&!recorder;
  if($('mobile-camera-stop'))$('mobile-camera-stop').disabled=$('camera-stop').disabled;
  if($('mobile-camera-start'))$('mobile-camera-start').disabled=$('camera-start').disabled;
}
function showImage(){if(matchMedia('(max-width: 859px)').matches)stage.scrollIntoView({block:'start',behavior:'instant'});}
function clearMeasurement(){
  tracker.reset();selected=false;result=null;prediction=null;observations=[];predictions=[];assessments=[];lastIssue=-Infinity;
  text('camera-selection','No object selected');text('camera-forecast','Waiting');text('camera-confidence','—');text('camera-error','—');
  sessionId=crypto.randomUUID?.()||String(Date.now());draw();
}
function stopRecorder(){
  clearTimeout(recordTimer);
  if(recorder?.state==='recording')recorder.stop();
}
function stopSource(message='Camera stopped. Your measurements can still be exported.'){
  sourceGeneration++;running=false;cancelAnimationFrame(loopId);if(videoLoop&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(loopId);
  $('camera-start').disabled=false;
  stopRecorder();camera.stop();video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=null;source=null;lastFrameTime=-1;
  selected=false;prediction=null;result=null;selectionStart=selectionEnd=null;tracker.reset();video.hidden=false;video.controls=false;overlay.style.pointerEvents='';frame=null;
  text('camera-source','No active source');text('camera-selection','Capture stopped');text('camera-forecast','Waiting');text('camera-confidence','—');text('camera-fps','— fps');
  if(message)status(message);buttons();draw();
}
function newSource(kind){
  source=kind;sessionSource=kind;lastFrameTime=-1;lastProcess=0;clearMeasurement();
  text('camera-source',kind==='camera'?'Camera · on-device processing':kind==='example'?'Synthetic example · pixel tracking':'Imported video · on-device processing');
}
function resize(){
  const bounds=stage.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);
  overlay.width=Math.max(1,Math.round(bounds.width*dpr));overlay.height=Math.max(1,Math.round(bounds.height*dpr));
  ctx.setTransform(dpr,0,0,dpr,0,0);draw();
}
function draw(){
  const bounds=stage.getBoundingClientRect();ctx.clearRect(0,0,bounds.width,bounds.height);
  if(source==='example'){
    const r=imageRect(bounds.width,bounds.height,fixture.width,fixture.height);
    ctx.drawImage(fixture,r.x,r.y,r.width,r.height);
  }
  if(!frame)return;
  const r=imageRect(bounds.width,bounds.height,frame.width,frame.height);
  const map=p=>({x:r.x+p.x*r.scale,y:r.y+p.y*r.scale});
  if(selected&&result?.point){
    const recent=observations.slice(-40);let previous=null;
    ctx.strokeStyle='#ff6b1a';ctx.lineWidth=2;ctx.beginPath();recent.forEach(o=>{
      if(!o.point||o.status!=='tracking'){previous=null;return;}
      const p=map(o.point);if(previous&&previous.trackId===o.trackId)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);previous=o;
    });ctx.stroke();
    const b=result.box;if(b){ctx.strokeStyle='#ff6b1a';ctx.strokeRect(r.x+b.x*r.scale,r.y+b.y*r.scale,b.width*r.scale,b.height*r.scale);}
    if(prediction?.status==='predicted'){
      const from=map(result.point),p=map(prediction.point);
      if(p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height){
        ctx.strokeStyle='#37c8d9';ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='#37c8d94d';ctx.beginPath();ctx.arc(p.x,p.y,12,0,Math.PI*2);ctx.fill();ctx.stroke();
        ctx.font='600 13px system-ui';ctx.fillStyle='#37c8d9';ctx.fillText('+0.5 s',clamp(p.x+16,8,bounds.width-60),clamp(p.y-15,18,bounds.height-12));
      }
    }
  }
  if(selectionStart&&selectionEnd){
    const a=map(selectionStart),b=map(selectionEnd);ctx.strokeStyle='#fff';ctx.setLineDash([5,4]);ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);ctx.setLineDash([]);
  }else if(!selected){
    const size=Math.min(frame.width,frame.height)*.22,b=map({x:(frame.width-size)/2,y:(frame.height-size)/2});
    ctx.strokeStyle='#ffffffa0';ctx.lineWidth=1.5;ctx.setLineDash([8,6]);ctx.strokeRect(b.x,b.y,size*r.scale,size*r.scale);ctx.setLineDash([]);
  }
}
function renderFixture(dt){
  if(selected)fixtureTime+=dt;
  const x=320+150*Math.sin(fixtureTime*.32),y=240+55*Math.sin(fixtureTime*.24);
  fixtureCtx.fillStyle='#202934';fixtureCtx.fillRect(0,0,640,480);
  fixtureCtx.strokeStyle='#2d3a47';fixtureCtx.lineWidth=1;
  for(let i=0;i<640;i+=40){fixtureCtx.beginPath();fixtureCtx.moveTo(i,0);fixtureCtx.lineTo(i,480);fixtureCtx.stroke();}
  for(let i=0;i<480;i+=40){fixtureCtx.beginPath();fixtureCtx.moveTo(0,i);fixtureCtx.lineTo(640,i);fixtureCtx.stroke();}
  fixtureCtx.fillStyle='#e9b4ff';fixtureCtx.beginPath();fixtureCtx.arc(x,y,24,0,Math.PI*2);fixtureCtx.fill();
  fixtureCtx.strokeStyle='#532e6f';fixtureCtx.lineWidth=6;fixtureCtx.beginPath();fixtureCtx.moveTo(x-17,y-12);fixtureCtx.lineTo(x+17,y+12);fixtureCtx.moveTo(x-12,y+18);fixtureCtx.lineTo(x+12,y-18);fixtureCtx.stroke();
}
function capturePixels(){
  const w=source==='example'?fixture.width:video.videoWidth,h=source==='example'?fixture.height:video.videoHeight;
  if(!(w&&h))return null;
  sample.width=320;sample.height=Math.max(1,Math.round(320*h/w));
  sampleCtx.drawImage(source==='example'?fixture:video,0,0,sample.width,sample.height);
  return sampleCtx.getImageData(0,0,sample.width,sample.height);
}
function processFrame(t,wallTime){
  const pixels=capturePixels();if(!pixels)return;
  if(frame&&(frame.width!==pixels.width||frame.height!==pixels.height)){clearMeasurement();status('Camera format changed. Select the object again.');}
  frame=pixels;
  if(t<=lastFrameTime){if(t<lastFrameTime-.01){clearMeasurement();lastFrameTime=-1;}else{draw();return;}}
  text('camera-fps',lastFrameTime>=0?Math.round(1/(t-lastFrameTime))+' fps':'—');lastFrameTime=t;
  if(selected){
    result=tracker.update(frame,t);
    observations.push({t,point:result.point,box:result.box,confidence:result.confidence,status:result.status,trackId:result.trackId,reason:result.reason});
    if(observations.length>=1800){stopSource('Measurement session complete. Export your results, then open a new source.');return;}
    if(result.status==='tracking'){
      prediction=forecast(observations,{sourceTime:t,horizon:.5});
      text('camera-selection','Tracking object');text('camera-confidence',Math.round((result.confidence||0)*100)+' %');
      if(prediction.status==='predicted'){
        const outside=prediction.point.x<0||prediction.point.y<0||prediction.point.x>frame.width||prediction.point.y>frame.height;
        text('camera-forecast',outside?'Outside frame at +0.5 s':'+0.5 s');
        status(outside?'The predicted position leaves the frame. Keep the camera still.':'Tracking. The cyan marker shows the predicted position in 0.5 seconds.');
        if(t-lastIssue>=.1){predictions.push({...prediction});lastIssue=t;}
      }else{
        text('camera-forecast','Observing');
        status(prediction.reason==='stationary_or_low_motion'?'The object is still. Move it to see a motion forecast.':'Observing movement. A forecast appears when tracking is stable.');
      }
    }else{
      prediction=null;text('camera-confidence','—');text('camera-forecast','Paused');
      text('camera-selection',result.status==='camera_moving'?'Camera moving':'Object lost');
      status(result.status==='camera_moving'?'The camera moved. Hold it still and select the object again.':'Object lost or hidden. Bring it back into view or select it again.');
    }
    for(const p of predictions){
      if(p.assessment||p.targetTime>t)continue;
      const assessment=assessForecast(p,observations,{availableTime:t,maxBracketGap:.18});
      if(assessment){p.assessment=assessment;assessments.push(assessment);}
    }
    const scores=assessments.filter(a=>a.status==='scored'&&Number.isFinite(a.errorPx));
    if(scores.length)text('camera-error',(scores.reduce((n,a)=>n+a.errorPx,0)/scores.length).toFixed(1)+' px · '+scores.length+' forecasts');
  }
  buttons();draw();lastProcess=wallTime;
}
function loop(now,metadata){
  if(!running)return;
  if(source==='example'){
    const dt=fixtureLast?Math.min((now-fixtureLast)/1000,.1):0;fixtureLast=now;renderFixture(dt);
  }
  const t=source==='example'?now/1000:metadata?.mediaTime??video.currentTime;
  if(now-lastProcess>=60)processFrame(t,now);
  schedule();
}
function schedule(){
  if(!running)return;
  videoLoop=source!=='example'&&typeof video.requestVideoFrameCallback==='function';
  loopId=videoLoop?video.requestVideoFrameCallback(loop):requestAnimationFrame(loop);
}
function selectAt(box){
  if(!frame)return;
  // Some mobile decoders expose metadata before the first drawable frame.
  if(source==='file'&&video.paused){frame=capturePixels()||frame;lastFrameTime=video.currentTime;}
  const t=Math.max(0,lastFrameTime);
  result=tracker.select(frame,box,t);selected=result.status==='tracking';prediction=null;
  observations=[];predictions=[];assessments=[];lastIssue=-Infinity;
  text('camera-error','—');text('camera-confidence','—');text('camera-forecast','Observing');
  if(selected){
    observations.push({t,point:result.point,box:result.box,confidence:result.confidence,status:result.status,trackId:result.trackId});
    text('camera-selection','Object selected');status('Object selected. Keep the camera still and watch it move.');
    showImage();
    if(source==='file'&&video.paused){video.play().catch(()=>{video.controls=true;overlay.style.pointerEvents='none';status('Press Play in the video to begin, then select the object again if needed.');});}
  }else{
    text('camera-selection','Select again');status(result.reason==='selection_too_small'?'The object is too small. Move closer or draw a larger selection.':'Choose an object with clear edges. Draw around it, leaving a little background.');
  }
  buttons();draw();
}
overlay.addEventListener('pointerdown',event=>{
  if(!frame)return;selectionStart=pointInImage(event.clientX,event.clientY,overlay.getBoundingClientRect(),frame.width,frame.height);
  if(selectionStart){selectionEnd=selectionStart;overlay.setPointerCapture(event.pointerId);event.preventDefault();draw();}
});
overlay.addEventListener('pointermove',event=>{
  if(!selectionStart||!frame)return;selectionEnd=pointInImage(event.clientX,event.clientY,overlay.getBoundingClientRect(),frame.width,frame.height)||selectionEnd;draw();
});
overlay.addEventListener('pointerup',()=>{
  if(!selectionStart||!frame){selectionStart=selectionEnd=null;return;}
  const a=selectionStart,b=selectionEnd||a,size=Math.min(frame.width,frame.height)*.22;
  let box=Math.hypot(b.x-a.x,b.y-a.y)<10?{x:a.x-size/2,y:a.y-size/2,width:size,height:size}:{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};
  box.x=clamp(box.x,0,frame.width-12);box.y=clamp(box.y,0,frame.height-12);
  box.width=clamp(box.width,12,frame.width-box.x);box.height=clamp(box.height,12,frame.height-box.y);
  selectionStart=selectionEnd=null;selectAt(box);
});
overlay.addEventListener('pointercancel',()=>{selectionStart=selectionEnd=null;draw();});
$('camera-center').onclick=()=>{if(frame){const size=Math.min(frame.width,frame.height)*.22;selectAt({x:(frame.width-size)/2,y:(frame.height-size)/2,width:size,height:size});}};
$('camera-reset').onclick=()=>{clearMeasurement();buttons();status('Tap the object or drag a rectangle around it.');};
async function startCamera(){
  stopSource(null);const generation=sourceGeneration;clearMeasurement();
  if(!window.isSecureContext){status('Open this page over HTTPS to use the camera. You can also import a video.');return;}
  $('camera-start').disabled=true;$('camera-stop').disabled=false;status('Allow camera access in your browser. The microphone stays off.');
  if($('mobile-camera-start'))$('mobile-camera-start').disabled=true;
  if($('mobile-camera-stop'))$('mobile-camera-stop').disabled=false;
  try{
    const stream=await camera.start(facing);if(!stream||generation!==sourceGeneration)return;
    video.srcObject=stream;await video.play();if(generation!==sourceGeneration)return;
    newSource('camera');running=true;
    for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(source==='camera')stopSource('Camera access was interrupted. You can open it again.');},{once:true});
    status('Camera ready. Tap the object or drag around it. Keep the camera still.');showImage();schedule();
  }catch(error){if(generation===sourceGeneration){camera.stop();status(cameraErrorMessage(error));}}
  finally{if(generation===sourceGeneration){$('camera-start').disabled=false;buttons();}}
}
$('camera-start').onclick=startCamera;
$('camera-stop').onclick=()=>stopSource();
$('camera-flip').onclick=()=>{facing=facing==='environment'?'user':'environment';startCamera();};
$('camera-example').onclick=()=>{
  stopSource(null);newSource('example');video.hidden=true;fixtureTime=0;fixtureLast=0;renderFixture(0);frame=capturePixels();lastFrameTime=performance.now()/1000;running=true;
  status('Synthetic example: select the purple object in the center. Tracking uses the displayed pixels.');buttons();draw();showImage();schedule();
};
$('camera-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  if(!file.type.startsWith('video/')||file.size>64*1024*1024){status('Choose a video smaller than 64 MB.');event.target.value='';return;}
  stopSource(null);const generation=sourceGeneration;newSource('file');sourceURL=URL.createObjectURL(file);video.src=sourceURL;
  status('Loading video on this device…');
  video.onloadeddata=()=>{
    if(generation!==sourceGeneration||source!=='file')return;
    lastFrameTime=video.currentTime;frame=capturePixels();buttons();draw();showImage();
    status('Video ready. Select the object in the first frame to start tracking.');
  };
  video.onerror=()=>{if(source==='file')stopSource('This video format cannot be played here. Try MP4/H.264 or a camera recording.');};
  video.load();event.target.value='';
};
video.addEventListener('ended',()=>{
  if(source==='file'){running=false;prediction=null;text('camera-forecast','Finished');text('camera-fps','— fps');draw();status('Video finished. Export your measurements, or import it again to select another object.');}
});
video.addEventListener('playing',()=>{
  if(source==='file'&&!running){video.controls=false;overlay.style.pointerEvents='';running=true;schedule();}
});
function download(name,blob){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('camera-export').onclick=()=>{
  const report={schema_version:'twinforge.mobile-observations.v1',session_id:sessionId,created_at:new Date().toISOString(),source:sessionSource,processing:'local deterministic visual tracking; no SAM or cloud calls',calibration:{mode:'image_plane',metric:false,dimensions_observed:2,width:frame?.width??sample.width,height:frame?.height??sample.height,units:'px'},horizon_s:.5,observations,predictions,assessments,limitations:['Camera must remain fixed.','Short-term motion extrapolation; collisions and physical properties are not inferred.','No metric 3D reconstruction or guaranteed identity through occlusion.','Only forecasts whose target time was observed receive an error score.']};
  download('twinforge-scan-'+sessionId+'.json',new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));status('Measurements exported. Camera images are not included.');
};
$('camera-record').onclick=()=>{
  if(recorder){if(recorder.state==='recording')stopRecorder();return;}
  if(!camera.stream||!window.MediaRecorder){text('camera-record-status','Recording is unavailable. Use your device camera app instead.');return;}
  try{
    const type=recordingMime(window.MediaRecorder);recorder=new MediaRecorder(camera.stream,type?{mimeType:type,videoBitsPerSecond:2000000}:{videoBitsPerSecond:2000000});
    recordData=[];recordBytes=0;let capture=recorder;
    capture.ondataavailable=e=>{if(e.data.size){recordData.push(e.data);recordBytes+=e.data.size;if(recordBytes>16*1024*1024)stopRecorder();}};
    capture.onerror=()=>{text('camera-record-status','Recording was interrupted by the browser.');stopRecorder();};
    capture.onstop=()=>{
      const type=capture.mimeType||'video/webm';
      const link=$('camera-record-download');
      if(recordURL)URL.revokeObjectURL(recordURL);
      recordURL=null;
      if(recordData.length){
        recordURL=URL.createObjectURL(new Blob(recordData,{type}));link.href=recordURL;
        link.download='twinforge-camera.'+(type.includes('mp4')?'mp4':'webm');link.hidden=false;
      }
      recorder=null;recordData=[];$('camera-record').textContent='Record 8 s';text('camera-record-status',recordURL?'Clip ready. Download it to keep a local copy, without audio or uploads.':'No frames were recorded. You can try again.');buttons();
    };
    capture.start(500);recordTimer=setTimeout(stopRecorder,8000);$('camera-record').textContent='Stop recording';text('camera-record-status','Recording locally · up to 8 seconds · no audio');
  }catch{recorder=null;text('camera-record-status','This browser cannot record that format. Use your device camera app.');}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSource('Capture stopped when the page moved to the background.');});
if($('mobile-camera-start'))$('mobile-camera-start').onclick=()=>{$('camera-start').click();};
if($('mobile-camera-example'))$('mobile-camera-example').onclick=()=>{$('camera-example').click();};
if($('mobile-camera-stop'))$('mobile-camera-stop').onclick=()=>{$('camera-stop').click();};
window.addEventListener('pagehide',()=>stopSource(null));
window.addEventListener('resize',resize);
new ResizeObserver(resize).observe(stage);
resize();buttons();
if(!window.isSecureContext)status('Live camera access requires HTTPS. Video import and the example are still available.');

