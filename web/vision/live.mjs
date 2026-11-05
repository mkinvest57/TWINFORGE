import {SamObserver} from './observer.mjs';
import {CameraSession} from '../camera/media.mjs';
import {imagePoint,selectionFromGesture,selectionLabel} from './selection.mjs';

const $=id=>document.getElementById(id);
const query=new URLSearchParams(location.search),cameraMode=query.get('mode')==='camera';
const familyNames={pendulum:'CHAOS RIG / RANDOM LAUNCH',collisions:'KINETIC CHAMBER / RANDOM MOTION',flight:'REBOUND CASCADE / RANDOM LAUNCH'};
const familySelect=$('scene-family'),world=$('world-frame'),video=$('camera-video'),overlay=$('vision-overlay');
const pen=overlay.getContext('2d'),sample=document.createElement('canvas'),samplePen=sample.getContext('2d',{willReadFrequently:true});
const camera=new CameraSession(navigator.mediaDevices);
const selectionCanvas=$('selection-overlay'),selectionPen=selectionCanvas.getContext('2d');
let connected=false,active=false,starting=false,runId=null,frameSerial=0,captureBusy=false,captureEpoch=0,startEpoch=0;
let sourceTime=0,facingMode='environment',previewId=null,lastSnapshot=null,firstReady=false,resetRequested=false,terminalFailure=null;
let budgetScene='vision',pricePerImage=.0025;
let worldHasStarted=false,challengePhase='idle',ticket=null,ticketDrawKey=null,modalPaused=false,impulseTimer=null;
let samRemaining=null,waitingSince=0;
let inputKind=cameraMode?'camera':'synthetic',videoUrl=null,selectionMode='touch',selectedPrompt=null,selectedConcept='object';
let lastRawFrame=null,lastVideoTime=-1,gesture=null,selectionEpoch=0,autoSelectOnPreview=false,lastEncodedFrameId=null;
let fpsStart=0,fpsFrames=0,localFps=0;
let cancelVideoPreview=null;
const frameCache=new Map();
const interactionLog=[];
function logInteraction(kind,extra={}){interactionLog.push({kind,runId,sourceTimeS:sourceTime,wallTime:new Date().toISOString(),...extra});if(interactionLog.length>200)interactionLog.shift();}
const observer=new SamObserver({onUpdate:render,sourceKind:inputKind,horizon:.5,encodeFrame:encodeSamFrame});
$('prediction-horizon').value=String(observer.horizon);
const send=(command,extra={})=>world.contentWindow?.postMessage({type:'tf-world',command,...extra},location.origin);
const showMessage=(tag,title,copy)=>{ $('stage-message').hidden=false;$('stage-message-tag').textContent=tag;$('stage-message-title').textContent=title;$('stage-message-copy').textContent=copy; };
const formatHorizon=value=>Number(value).toFixed(value===.75?2:1);
const videoHasFuture=()=>inputKind!=='video'||!Number.isFinite(video.duration)||video.currentTime+observer.horizon<video.duration;
const buttonState=()=>{
  $('start-observation').disabled=active||starting||(!cameraMode&&(!connected||observer.sessionCalls>=observer.maxRequests||!runId));
  $('stop-observation').disabled=!active&&!starting;
  $('apply-impulse').disabled=!active||!worldHasStarted||cameraMode||challengePhase!=='idle'||modalPaused;
  $('lock-prediction').disabled=!active||!lastSnapshot?.canLockPrediction||challengePhase!=='idle'||modalPaused||!videoHasFuture();
  $('quick-lock').disabled=$('lock-prediction').disabled;
  $('reveal-prediction').disabled=!active;$('resume-experiment').disabled=!active;
  $('find-concept').disabled=!active||!connected;
};
function showBudget(budget){
  if(budget?.unlimited===true){
    samRemaining=null;$('sam-remaining').textContent='No Twinforge cap';$('connection-summary').textContent='SAM connected';
    $('usage-fill').parentElement.hidden=true;$('usage-label').textContent='Application limit';
    $('usage-note').textContent='No Twinforge spending or image-count cap. Meta account credit still applies. Stop prevents new submissions; an image already sent can finish and be billed.';
    return;
  }
  if(!Number.isFinite(budget?.limit_per_scene)||!Number.isFinite(budget.scenes?.[budgetScene]??0))return;
  $('usage-fill').parentElement.hidden=false;$('usage-label').textContent='Remaining shared allowance';
  const remaining=Math.max(0,budget.limit_per_scene-(budget.scenes?.[budgetScene]??0));
  samRemaining=Math.max(0,Math.floor((remaining+1e-10)/pricePerImage));
  $('sam-remaining').textContent='$'+remaining.toFixed(4)+' · '+samRemaining+' images';
  $('connection-summary').textContent='SAM connected · '+samRemaining+' images left';
  $('usage-fill').style.width=(100*remaining/budget.limit_per_scene).toFixed(1)+'%';
}
function initialScene(){
  // The iframe can finish before this module installs its message listener.
  // Both the load event and an immediate request cover that ordering.
  if(cameraMode||active||starting||runId)return;
  resetRequested=true;send('reset',{family:familySelect.value});
}
function horizonLabels(){
  const seconds=formatHorizon(observer.horizon);
  $('forecast-legend').textContent='Predicted +'+seconds+' s';
  if(!ticket)$('ticket-target-time').textContent='+'+seconds+' s';
  $('horizon-note').textContent='Shaded area: conditional uncertainty · not a guarantee';
  if(cameraMode&&!active)showMessage('YOUR CAMERA','Select anything you can see.','Start the camera, then tap an object or draw around it. Use Hands to find visible hands.');
}
function changeHorizon(){
  const horizon=Number($('prediction-horizon').value);
  if(![.5,.75,1].includes(horizon)||horizon===observer.horizon)return;
  const wasHeld=!cameraMode&&['locked','result'].includes(challengePhase);
  resetChallenge();observer.setHorizon(horizon);horizonLabels();
  if(cameraMode&&active&&!observer.active)showSelectionReady();
  if(wasHeld&&active&&!modalPaused)send('play');
  logInteraction('forecast_horizon_changed',{horizonS:horizon});buttonState();
}

if(['pendulum','collisions','flight'].includes(query.get('scene')))familySelect.value=query.get('scene');
if(query.get('scene')==='chaos')familySelect.value='pendulum';
if(cameraMode){
  world.hidden=true;world.removeAttribute('src');video.hidden=false;$('vision-stage').className+=' camera-stage';
  $('world-controls').hidden=true;$('camera-controls').hidden=false;$('auto-scene-label').hidden=true;
  $('simulation-link').removeAttribute('aria-current');$('camera-link').setAttribute('aria-current','page');
  $('intro-copy').textContent='Your scene. Your objects. The same image-only observation test.';
  $('apply-impulse').hidden=true;$('impulse-description').textContent='Move the object yourself. Keep the camera still.';
  $('scene-label').textContent='LIVE CAMERA · VISUAL OBSERVATION';$('source-tag').textContent='Camera · image coordinates';
  $('privacy-note').textContent='Camera preview stays on this device. Selecting an object sends occasional frames to Meta. No audio is captured.';
  $('camera-selection').hidden=false;selectionCanvas.hidden=false;$('start-observation').textContent='Start camera';
  $('scene-label').textContent='CAMERA / SELECT AN OBJECT';
  horizonLabels();
  for(const link of document.querySelectorAll('a[href="https://twinforge-mobile-camera.mkinvest57.chatgpt.site/"]'))link.href+='?mode=camera';
}

async function checkConnection(){
  connected=false;buttonState();$('retry-connection').disabled=true;
  try{
    const response=await fetch('/api/sam/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('No live SAM server is available at this address.');
    const status=await response.json();
    if(status.model!=='sam-3.1'||status.live_only!==true)throw new Error('This endpoint does not confirm mandatory live SAM 3.1.');
    const unlimited=status.budget?.unlimited===true;
    connected=Boolean(status.available&&(unlimited||status.remaining_requests>0));
    observer.configureRequestLimit(unlimited?null:(Number.isSafeInteger(status.max_requests_per_run)?status.max_requests_per_run:60));
    budgetScene=status.budget_scene||'vision';pricePerImage=Number.isFinite(status.price_per_image_usd)&&status.price_per_image_usd>0?status.price_per_image_usd:.0025;
    const remaining=Number.isFinite(status.remaining_usd)?status.remaining_usd:0;
    samRemaining=status.remaining_requests??0;
    $('sam-remaining').textContent='$'+remaining.toFixed(4)+' · '+samRemaining+' images';
    $('connection-summary').textContent=connected?'SAM connected · '+samRemaining+' images left':'SAM unavailable';
    $('usage-fill').style.width=(100*Math.min(1,remaining/(status.budget?.limit_per_scene||.5))).toFixed(1)+'%';
    $('connection-detail').textContent=connected?'SAM 3.1 is connected. An actual segmentation is required before any forecast. Requests share a persistent spending limit.':(status.message||'SAM is unavailable. Check the server credential and remaining image allowance.');
    if(unlimited){showBudget(status.budget);$('connection-detail').textContent=connected?'SAM 3.1 is connected. No Twinforge spending cap. Meta account credit still applies; its live balance is not reported here.':status.message;}
    $('connection-notice').hidden=connected;
    $('hosted-link').hidden=connected||location.hostname==='twinforge-mobile-camera.mkinvest57.chatgpt.site';
    if(status.service_state==='busy')$('connection-detail').textContent=status.message||'A previous image is still being processed. The connection will recover automatically.';
    if(!connected){$('connection-title').textContent=status.reason_code==='budget_exhausted'?'SAM image allowance used up':'SAM is not ready';$('connection-copy').textContent=$('connection-detail').textContent;}
    if(!active&&!terminalFailure){$('sam-indicator').textContent=connected?'READY':'OFFLINE';$('sam-indicator').className='recorded-dot'+(connected?' connected':'');$('observation-status').textContent=connected?'Ready. Start to send the first image to SAM 3.1.':'No SAM result means no visual prediction.';}
  }catch(error){
    $('connection-notice').hidden=false;$('hosted-link').hidden=false;
    $('connection-title').textContent='This address needs a live SAM connection';
    $('connection-copy').textContent='The scene can be generated here, but SAM inference requires the live workspace or the local Python server. No predictions are fabricated.';
    $('connection-detail').textContent=String(error.message);$('sam-remaining').textContent='Not connected';$('connection-summary').textContent='Live workspace required';
    $('observation-status').textContent='Open the connected workspace to run SAM.';$('sam-indicator').textContent='OFFLINE';
  }finally{$('retry-connection').disabled=false;buttonState();}
}

function clearVisuals(){
  fpsStart=0;fpsFrames=0;localFps=0;$('tracking-rate').textContent='— fps';
  captureEpoch++;frameCache.clear();previewId=null;sourceTime=0;worldHasStarted=false;waitingSince=Date.now();lastRawFrame=null;lastSnapshot=null;lastVideoTime=-1;selectedPrompt=null;selectionEpoch++;resetChallenge();
  pen.clearRect(0,0,overlay.width,overlay.height);
  $('sam-preview').getContext('2d').clearRect(0,0,$('sam-preview').width,$('sam-preview').height);
  $('sam-preview-caption').textContent='No image sent in this scene';$('scene-time').textContent='0.0 s';
  $('sam-count').textContent='0';$('prediction-count').textContent='0';$('checked-count').textContent='0';$('tracked-count').textContent='—';$('forecast-error').textContent='—';
  selectionPen.clearRect(0,0,selectionCanvas.width,selectionCanvas.height);
}
function beginRun(id){
  clearVisuals();runId=id;terminalFailure=null;
  observer.start({runId,sourceKind:inputKind,concept:'ball'});
  if(!cameraMode){send('pause');send('capture');}
  // First SAM image is captured from a paused scene; its result cannot go stale
  // while the provider is working. Only an accepted SAM result starts time.
}
function newScene(){
  if(cameraMode)return;
  resetRequested=true;captureEpoch++;
  if(observer.active)observer.stop();
  clearVisuals();send('reset',{family:familySelect.value});
  showMessage('NEW UNKNOWN SCENE','SAM must observe this scene again.','The previous scene’s positions, motion and masks are discarded.');
}
async function start(){
  if(active||starting||(!cameraMode&&(!connected||observer.sessionCalls>=observer.maxRequests)))return;
  const attempt=++startEpoch;starting=true;terminalFailure=null;buttonState();
  try{
    if(cameraMode){
      if(inputKind==='video'&&videoUrl){video.currentTime=0;await presentFirstFrame(attempt);if(attempt!==startEpoch)return;}
      else{
        inputKind='camera';const stream=await camera.start(facingMode);if(!stream||attempt!==startEpoch)return;
        video.srcObject=stream;await presentFirstFrame(attempt,false);if(attempt!==startEpoch)return;
      }
      clearVisuals();active=true;runId=crypto.randomUUID();
      autoSelectOnPreview=selectionMode==='hands';showSelectionReady();
    }else{
      active=true;newScene();
      showMessage('LIVE SAM 3.1','Looking at the first image…','The scene starts once SAM returns its first mask.');
    }
  }catch(error){
    if(attempt!==startEpoch)return;
    active=false;camera.stop();video.srcObject=null;
    const messages={NotAllowedError:'Camera permission was denied. Allow camera access in your browser and try again.',NotFoundError:'No camera is available. You can open a video instead.',NotReadableError:'The camera is unavailable or being used by another app.',SecurityError:'Camera access requires HTTPS or localhost.'};
    showMessage('COULD NOT START','Camera has not started.',messages[error.name]||error.message);
    $('observation-status').textContent=messages[error.name]||error.message;
  }finally{if(attempt===startEpoch){starting=false;buttonState();}}
}
function showSelectionReady(){
  $('stage-message').hidden=true;$('world-state').textContent=inputKind==='video'?'VIDEO READY':'CAMERA READY';
  $('sam-indicator').textContent='SELECT';$('sam-indicator').className='recorded-dot';
  $('observation-status').textContent=connected?'Tap an object, draw a box, or choose Hands. No image is sent until you select.':'Preview is local. Connect SAM to select and forecast an object.';
  $('selection-guidance').textContent='Tap the object itself. Drag a box if it is small or transparent.';
  $('selection-confirmation').textContent='Waiting for your selection';
  $('challenge-hint').textContent='Select an object to begin predicting its motion.';
}
function stop({refresh=true,failure=null,reason=null}={}){
  const hadRun=active||starting;if(hadRun)logInteraction('observation_stopped',{reason:failure?.message||reason||'user_stop'});active=false;starting=false;resetRequested=false;captureEpoch++;startEpoch++;terminalFailure=failure;
  cancelVideoPreview?.();
  if(hadRun||observer.active)observer.stop();
  send('pause');camera.stop();if(inputKind==='video')video.pause();else video.srcObject=null;$('object-concept').disabled=false;gesture=null;selectionEpoch++;
  pen.clearRect(0,0,overlay.width,overlay.height);selectionPen.clearRect(0,0,selectionCanvas.width,selectionCanvas.height);buttonState();
  $('world-state').textContent='PAUSED';
  if(hadRun&&!failure)showMessage('PAUSED',reason||'Experiment paused.','Start a new experiment when you are ready. This record remains available to download.');
  if(refresh)checkConnection();
}

function presentFirstFrame(attempt,pauseAfter=true){
  // loadeddata can precede a drawable frame. In particular an immediate
  // automatic Hands selection used to submit a black JPEG at video startup.
  return new Promise((resolve,reject)=>{
    let frameHandle=null,timer=null,finished=false;
    const finish=error=>{
      if(finished)return;finished=true;clearTimeout(timer);
      if(frameHandle!==null)video.cancelVideoFrameCallback?.(frameHandle);
      video.removeEventListener('timeupdate',presented);
      if(cancelVideoPreview===cancel)cancelVideoPreview=null;
      if(attempt===startEpoch&&pauseAfter)video.pause();
      error?reject(error):resolve();
    };
    const presented=()=>finish(),cancel=()=>finish();cancelVideoPreview=cancel;
    timer=setTimeout(()=>finish(new Error('No decoded video frame arrived. Try another clip or restart the camera.')),5000);
    if(typeof video.requestVideoFrameCallback==='function')frameHandle=video.requestVideoFrameCallback(presented);
    else video.addEventListener('timeupdate',presented,{once:true});
    video.play().catch(finish);
  });
}

async function bitmapFromBase64(value){
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
}
function retainFrame(frame){
  frameCache.set(frame.frameId,{imageData:frame.imageData,jpeg:frame.imageBase64,width:frame.imageData.width,height:frame.imageData.height,t:frame.t});
  while(frameCache.size>64){
    const key=[...frameCache.keys()].find(k=>k!==previewId&&k!==lastEncodedFrameId&&k!==ticket?.sourceFrameId);
    if(!key)break;frameCache.delete(key);
  }
}
async function encodeSamFrame(frame){
  const c=document.createElement('canvas');c.width=frame.imageData.width;c.height=frame.imageData.height;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.imageData.data),c.width,c.height),0,0);
  const jpeg=c.toDataURL('image/jpeg',.86).split(',')[1];
  const bitmap=await bitmapFromBase64(jpeg);ctx.drawImage(bitmap,0,0);bitmap.close();
  lastEncodedFrameId=frame.frameId;
  const cached=frameCache.get(frame.frameId)||{width:c.width,height:c.height,t:frame.t};cached.jpeg=jpeg;frameCache.set(frame.frameId,cached);
  return {imageBase64:jpeg,imageData:ctx.getImageData(0,0,c.width,c.height)};
}
function frameGeometry(width,height){
  if(overlay.width!==width||overlay.height!==height){overlay.width=width;overlay.height=height;selectionCanvas.width=width;selectionCanvas.height=height;}
  if(cameraMode){
    $('vision-stage').style.aspectRatio=width+'/'+height;
    $('vision-stage').style.setProperty('--camera-aspect',String(width/height));
    $('scene-surface').style.aspectRatio=width+'/'+height;
  }
}
function rawFrame(drawSource,width,height,t,id=runId){
  const scale=Math.min(1,480/Math.max(width,height));
  sample.width=Math.max(16,Math.round(width*scale));sample.height=Math.max(16,Math.round(height*scale));
  samplePen.drawImage(drawSource,0,0,sample.width,sample.height);
  const frame={imageData:samplePen.getImageData(0,0,sample.width,sample.height),t,frameId:'f'+(++frameSerial).toString(36),runId:id};
  frameGeometry(sample.width,sample.height);return frame;
}
function bufferGestureFrame(target,frame){
  if(frame.imageData.width!==target.frame.imageData.width||frame.imageData.height!==target.frame.imageData.height)return false;
  if(frame.t<=target.frames.at(-1).t)return true;
  target.frames.push(frame);
  // Keep the frozen selection image and latest image. Thin dense interior
  // times instead of dropping the start of a long drag's visual history.
  while(target.frames.length>80){
    let remove=1,gap=Infinity;
    for(let i=1;i<target.frames.length-1;i++){
      const candidate=target.frames[i+1].t-target.frames[i-1].t;
      if(candidate<gap){gap=candidate;remove=i;}
    }
    target.frames.splice(remove,1);
  }
  return true;
}
async function captured(drawSource,width,height,t,id,epoch){
  if(!active||epoch!==captureEpoch||id!==runId)return;
  const frame=rawFrame(drawSource,width,height,t,id);
  if(!cameraMode){
    // Preserve the renderer's exact-JPEG observation path. Camera/video only
    // encode when SAM is requested, so local tracking does not wait on codecs.
    const encoded=await encodeSamFrame(frame);frame.imageBase64=encoded.imageBase64;frame.imageData=encoded.imageData;
    if(!active||epoch!==captureEpoch||id!==runId)return;
  }
  lastRawFrame=frame;retainFrame(frame);sourceTime=t;
  const now=performance.now();if(!fpsStart)fpsStart=now;fpsFrames++;
  if(now-fpsStart>=1000){localFps=fpsFrames*1000/(now-fpsStart);$('tracking-rate').textContent=localFps.toFixed(0)+' fps local';fpsFrames=0;fpsStart=now;}
  if(cameraMode&&gesture){
    if(!bufferGestureFrame(gesture,frame)){
      gesture=null;paintSelection(null);$('selection-guidance').textContent='The camera orientation changed. Select the object again.';
    }
    return;
  }
  if(observer.active){
    if(observer.width&&(observer.width!==frame.imageData.width||observer.height!==frame.imageData.height)){
      observer.stop();selectedPrompt=null;showSelectionReady();$('selection-guidance').textContent='The camera orientation changed. Select the object again.';
    }else observer.pushFrame(frame);
  }else if(cameraMode){
    $('scene-time').textContent=t.toFixed(1)+' s';
    if(autoSelectOnPreview){autoSelectOnPreview=false;await selectObservedObject(null,'hand',frame);}
  }
  if(!cameraMode&&$('auto-scene').checked&&t>=20&&!resetRequested&&challengePhase==='idle')newScene();
}

addEventListener('message',async event=>{
  if(cameraMode||event.origin!==location.origin||event.source!==world.contentWindow)return;
  const message=event.data;if(!message||typeof message.type!=='string')return;
  if(message.type==='tf-world-ready'){
    if(!firstReady){firstReady=true;if(!active&&!starting){resetRequested=true;send('reset',{family:familySelect.value});}}
  }else if(message.type==='tf-world-reset'){
    resetRequested=false;runId=message.run_id;$('scene-label').textContent=familyNames[message.family]||'NEW RANDOM 3D SCENE';
    if(active)beginRun(runId);else{
      clearVisuals();
      if(observer.runId&&observer.runId!==runId){observer.reset({runId,sourceKind:'synthetic',concept:'ball'});observer.stop();}
      showMessage('UNSEEN SCENE','The observer has not seen this yet.','Start SAM to detect the objects from their pixels.');
    }
    buttonState();
  }else if(message.type==='tf-world-intervention'&&message.run_id===runId){
    logInteraction('private_random_impulse_acknowledged',{sourceTimeS:message.t,physicsStateShared:false});
    $('intervention-flash').hidden=false;clearTimeout(impulseTimer);
    impulseTimer=setTimeout(()=>{$('intervention-flash').hidden=true;},1600);
  }else if(message.type==='tf-world-error'){
    stop({refresh:false});showMessage('RENDERER UNAVAILABLE','The 3D scene could not start.',message.message);
  }else if(message.type==='tf-frame'&&active&&!resetRequested&&message.run_id===runId&&!captureBusy){
    captureBusy=true;const epoch=captureEpoch,id=runId;
    let bitmap;
    try{bitmap=await bitmapFromBase64(message.image_base64);await captured(bitmap,message.width,message.height,message.t,id,epoch);}
    catch(error){$('observation-status').textContent='Frame could not be observed: '+error.message;}
    finally{bitmap?.close();captureBusy=false;}
  }
});

async function captureVideoFrame(){
  if(!cameraMode||!active||captureBusy||modalPaused||video.readyState<2||!video.videoWidth)return;
  if(video.currentTime===lastVideoTime){if(!gesture&&observer.active)observer.retryPendingFrame?.();return;}
  lastVideoTime=video.currentTime;captureBusy=true;
  try{await captured(video,video.videoWidth,video.videoHeight,video.currentTime,runId,captureEpoch);}
  catch(error){$('observation-status').textContent='Camera frame unavailable: '+error.message;}
  finally{captureBusy=false;}
}
const captureTimer=setInterval(async()=>{
  if(!active||captureBusy||resetRequested||modalPaused||(!cameraMode&&['locked','result'].includes(challengePhase)))return;
  if(cameraMode){await captureVideoFrame();return;}
  if(!worldHasStarted)observer.retryPendingFrame?.();send('capture');
},40);

function line(points,color,width=1.5,dash=[]){
  if(points.length<2)return;pen.beginPath();pen.setLineDash(dash);pen.lineWidth=width;pen.strokeStyle=color;
  pen.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))pen.lineTo(p.x,p.y);pen.stroke();pen.setLineDash([]);
}
function target(p,alpha=1){
  if(!p)return;pen.globalAlpha=alpha;pen.strokeStyle='#ffbd69';pen.lineWidth=1.5;
  pen.beginPath();pen.arc(p.x,p.y,5,0,Math.PI*2);pen.moveTo(p.x-9,p.y);pen.lineTo(p.x+9,p.y);pen.moveTo(p.x,p.y-9);pen.lineTo(p.x,p.y+9);pen.stroke();pen.globalAlpha=1;
}
function drawOverlay(state){
  if(!state.width)return;
  if(overlay.width!==state.width||overlay.height!==state.height){overlay.width=state.width;overlay.height=state.height;}
  frameGeometry(state.width,state.height);
  pen.clearRect(0,0,overlay.width,overlay.height);
  if(ticket&&challengePhase!=='idle'&&(!cameraMode||challengePhase==='revealing')){drawLockedTarget(pen,ticket);return;}
  for(const track of state.tracks){
    if(track.status!=='tracking'||!track.point)continue;
    line(track.recentTrail,'#68dbed90',1.6);
    if(track.box){pen.strokeStyle='#68dbed';pen.lineWidth=1;pen.strokeRect(track.box.x,track.box.y,track.box.width,track.box.height);}
    pen.beginPath();pen.arc(track.point.x,track.point.y,3,0,Math.PI*2);pen.fillStyle='#68dbed';pen.fill();
    if(track.prediction){
      drawForecast(track.point,track.prediction);target(track.prediction.point);
      pen.font='10px system-ui';pen.fillStyle='#ffcf94';pen.fillText('+'+formatHorizon(track.prediction.horizon)+' s',track.prediction.point.x+10,track.prediction.point.y-8);
    }
  }
}
async function updatePreview(state){
  const latest=state.latestSam;if(!latest||latest.frameId===previewId)return;
  const cached=frameCache.get(latest.frameId);if(!cached?.jpeg)return;
  previewId=latest.frameId;const expected=previewId,epoch=captureEpoch;
  const bitmap=await bitmapFromBase64(cached.jpeg);
  if(epoch!==captureEpoch||expected!==previewId){bitmap.close();return;}
  const canvas=$('sam-preview');canvas.width=cached.width;canvas.height=cached.height;canvas.parentElement.style.aspectRatio=cached.width+'/'+cached.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  ctx.strokeStyle='#68dbed';ctx.fillStyle='#68dbed33';ctx.lineWidth=1.5;
  for(const track of state.tracks.filter(t=>Math.abs(t.samTimeS-latest.sourceTimeS)<1e-8))for(const polygon of track.samPolygons){
    ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();ctx.stroke();
  }
  $('sam-preview-caption').textContent='MASK · '+latest.sourceTimeS.toFixed(2)+' s';
}
function render(state){
  // A local preview can coexist with the previous stopped observer record.
  // Changing settings must not replay that record into the new preview.
  if(cameraMode&&active&&!state.active){buttonState();return;}
  if(['sam_unavailable','request_limit'].includes(state.status)&&active){stop({refresh:true,failure:{message:state.message}});return;}
  lastSnapshot=state;
  if(!cameraMode&&active&&!worldHasStarted&&state.latestSam&&!modalPaused){worldHasStarted=true;send('play');}
  if(inputKind==='video'&&active&&state.active&&state.latestSam&&video.paused&&challengePhase==='idle'&&!modalPaused)video.play().catch(()=>{});
  if(ticket&&state.predictionTicket?.id===ticket.id){
    ticket=state.predictionTicket;
    if(ticket.status!=='locked'&&['revealing','locked'].includes(challengePhase)){
      challengePhase='result';if(!cameraMode)send('pause');
    }
    renderTicket();
  }
  $('world-state').textContent=!active?'STANDBY':modalPaused?'PAUSED':challengePhase==='locked'?'TARGET LOCKED':challengePhase==='result'&&!cameraMode?'RESULT':!cameraMode&&!worldHasStarted?'AWAITING SAM':'OBSERVING';
  $('stage-mode-label').textContent=challengePhase==='locked'?'FUTURE LOCKED':challengePhase==='result'&&!cameraMode?'OUTCOME HELD':'LIVE VIEW';
  $('checked-count').textContent=String(state.scoredCount);
  $('scene-time').textContent=(state.timeS??0).toFixed(1)+' s';
  $('tracked-count').textContent=String(state.tracks.filter(t=>t.status==='tracking').length);
  $('forecast-error').textContent=state.meanErrorPx===null?'—':state.meanErrorPx.toFixed(1)+' px';
  $('forecast-scores').textContent=state.scoredCount?state.scoredCount+' checked · '+state.unscorableCount+' unscored':'Waiting for future observations';
  $('prediction-count').textContent=String(state.issuedCount);
  $('sam-count').textContent=String(observer.samRecords.length);
  const responseMs=state.latestSam?.clientRoundTripMs??state.latestSam?.latencyMs;
  $('sam-latency').textContent=responseMs!=null?(responseMs/1000).toFixed(2)+' s':'—';
  $('export-observation').disabled=!state.latestSam&&!state.issuedCount&&!observer.history.length;
  $('observation-status').textContent=terminalFailure?.message||(challengePhase==='locked'?'Prediction locked before its target time. Reveal to advance the scene.':challengePhase==='result'&&!cameraMode?'Outcome held for inspection. Continue when ready.':state.message);
  const hasSam=Boolean(state.latestSam),blocked=Boolean(terminalFailure)||['sam_unavailable','request_limit'].includes(state.status);
  const trackVisible=state.tracks.some(t=>t.status==='tracking');
  $('sam-indicator').textContent=blocked?'UNAVAILABLE':state.samPending&&state.active?(hasSam?'REFRESHING':'SAM REQUEST'):hasSam?(state.active?(trackVisible?'TRACKING':state.latestSam.detectedCount?'TRACK LOST':'NO MATCH'):'RECORDED'):connected?'READY':'OFFLINE';
  $('sam-indicator').className='recorded-dot'+(!blocked&&state.samPending&&state.active?' pending':!blocked&&state.active&&hasSam&&trackVisible?' connected':'');
  if(state.latestSam?.budget)showBudget(state.latestSam.budget);
  const timing=state.latestSam?.timingsMs;
  $('sam-detail').textContent=hasSam?'SAM confirmed '+state.latestSam.detectedCount+' object'+(state.latestSam.detectedCount===1?'':'s')+'. '+(timing?'Provider '+Math.round(timing.provider)+' ms · mask decode '+Math.round(timing.mask_decode)+' ms.':'Local tracking runs between these API calls.'):'SAM confirms the selection; local visual tracking keeps following it between requests.';
  if(cameraMode&&hasSam){$('selection-confirmation').textContent=!state.active?'Selection record retained · '+selectionLabel(selectedPrompt,selectedConcept):state.tracks.length?'SAM confirmed · '+selectionLabel(selectedPrompt,selectedConcept):'SAM found no matching object. Tap again or draw a tighter box.';if(!gesture)selectionPen.clearRect(0,0,selectionCanvas.width,selectionCanvas.height);}
  if(cameraMode&&state.status==='tracking_lost')$('selection-confirmation').textContent='Tracking lost. Move closer, keep the camera still, then select again.';

  if(blocked)showMessage('NO PREDICTION WITHOUT SAM','SAM observation is unavailable.',terminalFailure?.message||state.message);
  else if(state.active){
    if(!hasSam){if(cameraMode){$('stage-message').hidden=true;$('selection-confirmation').textContent=state.status==='sam_busy'?'Previous SAM request is finishing. Your selection is queued.':'Selection sent to SAM · waiting for its mask…';}else showMessage(state.status==='sam_busy'?'SAM IS FINISHING AN IMAGE':'REAL SAM INFERENCE','Discovering the objects…','The scene stays paused until SAM returns its first mask.');}
    else if(!state.tracks.length)showMessage('SAM FOUND NO USABLE TRACK','Waiting for a visible object.',state.message);
    else $('stage-message').hidden=true;
  }
  if(challengePhase==='idle'){
    const readiness=typeof state.forecastReadiness==='string'?state.forecastReadiness:state.forecastReadiness?.message;
    $('challenge-hint').textContent=!active?'Start the experiment to unlock a real forecast.':!videoHasFuture()?'This clip ends before that target time. Replay to lock an earlier prediction.':state.canLockPrediction?'A future target is available. Lock it before time advances.':readiness||(!hasSam?'Waiting for the first SAM segmentation…':'Learning motion from the latest observed frames…');
  }
  drawOverlay(state);updatePreview(state).catch(()=>{});
  buttonState();
}

function resetChallenge(){
  challengePhase='idle';ticket=null;ticketDrawKey=null;
  $('challenge-title').textContent='Lock the future.';$('challenge-phase').textContent='READY WHEN YOU ARE';
  $('challenge-copy').textContent='Hold a predicted position on screen. Then let time catch up.';
  $('ticket-number').textContent='—';$('ticket-empty').hidden=false;$('ticket-result').hidden=true;
  $('ticket-source-time').textContent='—';$('ticket-target-time').textContent='+'+formatHorizon(observer.horizon)+' s';
  $('ticket-progress').style.left='0%';$('lock-prediction').hidden=false;$('reveal-prediction').hidden=true;$('resume-experiment').hidden=true;
  $('ticket-preview').getContext('2d').clearRect(0,0,480,300);
}
function drawLockedTarget(ctx,value){
  const p=value.point,origin=value.originPoint||value.anchorPoint,actual=value.outcome?.observedPoint;
  if(!p)return;
  ctx.lineWidth=1.8;ctx.strokeStyle='#ffbd69';ctx.fillStyle='#ffbd691e';ctx.setLineDash([]);
  if(origin){ctx.beginPath();ctx.setLineDash([4,4]);ctx.moveTo(origin.x,origin.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.setLineDash([]);}
  ctx.beginPath();ctx.arc(p.x,p.y,11,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(p.x-18,p.y);ctx.lineTo(p.x-7,p.y);ctx.moveTo(p.x+7,p.y);ctx.lineTo(p.x+18,p.y);ctx.moveTo(p.x,p.y-18);ctx.lineTo(p.x,p.y-7);ctx.moveTo(p.x,p.y+7);ctx.lineTo(p.x,p.y+18);ctx.stroke();
  ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#ffbd69';ctx.fillText('LOCKED +'+formatHorizon(value.horizon)+'s',Math.max(5,Math.min(365,p.x+17)),Math.max(14,p.y-17));
  if(actual){ctx.strokeStyle='#68dbed';ctx.fillStyle='#68dbed';ctx.beginPath();ctx.arc(actual.x,actual.y,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(actual.x,actual.y);ctx.stroke();}
}
async function paintTicket(value){
  const cacheId=value.outcome?.frameId||value.sourceFrameId,cached=frameCache.get(cacheId)||frameCache.get(value.sourceFrameId);
  const key=value.id+':'+value.status+':'+cacheId;if(key===ticketDrawKey||!cached)return;
  ticketDrawKey=key;const bitmap=cached.jpeg?await bitmapFromBase64(cached.jpeg):await createImageBitmap(new ImageData(new Uint8ClampedArray(cached.imageData.data),cached.width,cached.height));
  if(ticketDrawKey!==key){bitmap.close();return;}
  const canvas=$('ticket-preview');canvas.width=cached.width;canvas.height=cached.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  ctx.fillStyle='#0b10162b';ctx.fillRect(0,0,canvas.width,canvas.height);drawLockedTarget(ctx,value);
}
function renderTicket(){
  if(!ticket)return;
  const complete=ticket.status!=='locked',scored=ticket.status==='scored';
  $('ticket-empty').hidden=true;$('ticket-number').textContent='#'+(observer.tickets?.length||1).toString().padStart(2,'0');
  $('ticket-source-time').textContent=ticket.sourceTime.toFixed(2)+' s';$('ticket-target-time').textContent=ticket.targetTime.toFixed(2)+' s';
  $('ticket-progress').style.left=complete?'100%':challengePhase==='revealing'?'50%':'0%';
  $('challenge-phase').textContent=complete?'OUTCOME RECORDED':challengePhase==='revealing'?'WAITING FOR THE FUTURE':'PREDICTION LOCKED';
  $('challenge-title').textContent=complete?(scored?'Now we can measure.':'No later observation.'):'The target is frozen.';
  $('challenge-copy').textContent=complete?(scored?'Amber was predicted. Cyan is the later visual observation.':'There is no reliable later observation to compare. This attempt stays in the record.'):(cameraMode?'The camera keeps running. The next frames will test this target.':'The world is paused. This target was recorded before its future frame.');
  $('ticket-result').hidden=!complete;$('ticket-result').textContent=scored?ticket.outcome.errorPx.toFixed(1)+' px error':'UNSCORABLE';
  $('lock-prediction').hidden=true;$('reveal-prediction').hidden=complete||cameraMode||challengePhase!=='locked';$('resume-experiment').hidden=!complete;
  $('challenge-hint').textContent=complete?(scored?'Measured from later tracked pixels, interpolated at the target time.':'Unscorable targets remain in the record.'):(cameraMode?'No simulator data is available in camera mode.':'Reveal advances time. The target cannot move to match the result.');
  paintTicket(ticket).catch(()=>{});
}
function lockPrediction(){
  if(!active||challengePhase!=='idle'||!lastSnapshot?.canLockPrediction||!videoHasFuture())return;
  const locked=observer.lockPrediction();if(!locked)return;
  ticket=locked;challengePhase=cameraMode?'revealing':'locked';if(!cameraMode){captureEpoch++;send('pause');}
  render(lastSnapshot);buttonState();
}
function revealPrediction(){
  if(!ticket||challengePhase!=='locked'||!active)return;
  challengePhase='revealing';send('play');render(lastSnapshot);buttonState();
}
function resumeExperiment(){
  resetChallenge();if(active&&!cameraMode)send('play');if(lastSnapshot)render(lastSnapshot);buttonState();
}
function drawForecast(origin,prediction){
  const path=prediction.trajectory?.length?prediction.trajectory:[{dt:0,point:origin,uncertaintyPx:0},{dt:prediction.horizon,point:prediction.point,uncertaintyPx:prediction.uncertaintyPx||0}];
  // The envelope is a conditional estimate. Clip display radius to the image;
  // the full numeric uncertainty remains in the exported prediction.
  for(const step of path.slice(1)){
    const p=step.point,r=Math.min(Math.hypot(overlay.width,overlay.height)/2,Math.max(2,step.uncertaintyPx||0));
    pen.beginPath();pen.arc(p.x,p.y,r,0,Math.PI*2);pen.fillStyle='#ffbd6910';pen.fill();pen.strokeStyle='#ffbd6926';pen.lineWidth=.6;pen.stroke();
  }
  line(path.map(step=>step.point),'#ffbd69',1.8,[4,3]);
  for(const step of path.slice(1,-1)){pen.beginPath();pen.arc(step.point.x,step.point.y,2,0,Math.PI*2);pen.fillStyle='#ffbd69';pen.fill();}
}
function paintSelection(selection){
  selectionPen.clearRect(0,0,selectionCanvas.width,selectionCanvas.height);
  if(gesture){const data=gesture.frame.imageData;selectionPen.putImageData(new ImageData(new Uint8ClampedArray(data.data),data.width,data.height),0,0);}
  if(!selection)return;
  selectionPen.strokeStyle='#edf2f3';selectionPen.lineWidth=1.5;selectionPen.setLineDash([4,3]);
  if(selection.type==='box')selectionPen.strokeRect(selection.x,selection.y,selection.width,selection.height);
  else{selectionPen.beginPath();selectionPen.arc(selection.x,selection.y,12,0,Math.PI*2);selectionPen.stroke();selectionPen.beginPath();selectionPen.arc(selection.x,selection.y,2,0,Math.PI*2);selectionPen.fillStyle='#edf2f3';selectionPen.fill();}
  selectionPen.setLineDash([]);
}
function chooseSelectionMode(mode){
  selectionMode=mode;
  for(const [id,value] of [['select-touch','touch'],['select-hands','hands'],['select-name','name']])$(id).setAttribute('aria-pressed',String(mode===value));
  $('concept-form').hidden=mode!=='name';
  $('selection-guidance').textContent=mode==='touch'?'Tap any visible object. Drag a box for a small or transparent object.':mode==='hands'?'SAM finds visible hands; the forecast follows each hand’s overall movement.':'Name one object type. For a particular object, tap it directly.';
  if(mode==='hands'){if(active&&lastRawFrame)selectObservedObject(null,'hand');else autoSelectOnPreview=true;}
}
async function selectObservedObject(selection,concept='object',frame=null,bufferedFrames=[]){
  if(!cameraMode||!active)return;
  if(!connected){$('selection-confirmation').textContent='Connect SAM before selecting an object.';return;}
  const name=String(concept).trim();if(!name||name.length>80||/[\x00-\x1f<>|,;]/.test(name)){$('selection-confirmation').textContent='Use one short object name, or tap the object.';return;}
  const selected={...(frame||rawFrame(video,video.videoWidth,video.videoHeight,video.currentTime))};
  const generation=++selectionEpoch;captureEpoch++;resetChallenge();terminalFailure=null;
  fpsStart=0;fpsFrames=0;localFps=0;$('tracking-rate').textContent='— fps';
  selectedPrompt=selection;selectedConcept=name;runId=crypto.randomUUID();selected.runId=runId;
  retainFrame(selected);lastRawFrame=selected;lastVideoTime=selected.t;sourceTime=selected.t;previewId=null;
  $('sam-preview').getContext('2d').clearRect(0,0,$('sam-preview').width,$('sam-preview').height);
  if(inputKind==='video')video.pause();
  observer.start({runId,sourceKind:inputKind,concept:name,selection});
  if(generation!==selectionEpoch)return;
  paintSelection(selection);$('selection-confirmation').textContent='Selected · confirming with SAM…';
  observer.pushFrame(selected);
  for(const capturedFrame of bufferedFrames){
    if(generation!==selectionEpoch||!active)break;
    if(capturedFrame.t<=sourceTime)continue;
    const current={...capturedFrame,runId};retainFrame(current);
    lastRawFrame=current;lastVideoTime=current.t;sourceTime=current.t;observer.pushFrame(current);
  }
  buttonState();logInteraction('visual_object_selected',{selection,concept:name,sourceKind:inputKind});
}
selectionCanvas.addEventListener('pointerdown',event=>{
  if(!cameraMode||!active||video.readyState<2||!connected)return;
  event.preventDefault();chooseSelectionMode('touch');
  const frame=rawFrame(video,video.videoWidth,video.videoHeight,video.currentTime);
  const point=imagePoint(event.clientX,event.clientY,selectionCanvas.getBoundingClientRect(),frame.imageData.width,frame.imageData.height);if(!point)return;
  gesture={pointerId:event.pointerId,point,last:point,frame,frames:[frame]};selectionCanvas.setPointerCapture?.(event.pointerId);paintSelection({type:'point',...point});
});
selectionCanvas.addEventListener('pointermove',event=>{
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  const point=imagePoint(event.clientX,event.clientY,selectionCanvas.getBoundingClientRect(),gesture.frame.imageData.width,gesture.frame.imageData.height);
  if(point){gesture.last=point;paintSelection(selectionFromGesture(gesture.point,point,gesture.frame.imageData.width,gesture.frame.imageData.height));}
});
selectionCanvas.addEventListener('pointerup',event=>{
  if(!gesture||gesture.pointerId!==event.pointerId)return;
  event.preventDefault();const picked=gesture;gesture=null;
  if(!bufferGestureFrame(picked,rawFrame(video,video.videoWidth,video.videoHeight,video.currentTime))){paintSelection(null);return;}
  const point=imagePoint(event.clientX,event.clientY,selectionCanvas.getBoundingClientRect(),picked.frame.imageData.width,picked.frame.imageData.height)||picked.last;
  selectObservedObject(selectionFromGesture(picked.point,point,picked.frame.imageData.width,picked.frame.imageData.height),'object',picked.frame,picked.frames);
});
selectionCanvas.addEventListener('pointercancel',()=>{gesture=null;paintSelection(null);});
selectionCanvas.addEventListener('keydown',event=>{
  if(!['Enter',' '].includes(event.key)||!active||video.readyState<2)return;event.preventDefault();
  const frame=rawFrame(video,video.videoWidth,video.videoHeight,video.currentTime);selectObservedObject({type:'point',x:Math.floor(frame.imageData.width/2),y:Math.floor(frame.imageData.height/2)},'object',frame);
});
$('select-touch').addEventListener('click',()=>chooseSelectionMode('touch'));
$('select-hands').addEventListener('click',()=>chooseSelectionMode('hands'));
$('select-name').addEventListener('click',()=>chooseSelectionMode('name'));
$('find-concept').addEventListener('click',()=>selectObservedObject(null,$('object-concept').value));
$('object-concept').addEventListener('keydown',event=>{if(event.key==='Enter')selectObservedObject(null,$('object-concept').value);});
$('load-video').addEventListener('click',()=>$('video-file').click());
$('video-file').addEventListener('change',async()=>{
  const file=$('video-file').files?.[0];if(!file)return;
  stop({refresh:false});const attempt=++startEpoch;starting=true;inputKind='video';if(videoUrl)URL.revokeObjectURL(videoUrl);videoUrl=URL.createObjectURL(file);
  video.srcObject=null;video.src=videoUrl;video.loop=false;video.autoplay=false;
  let cleanup;
  const loaded=new Promise((resolve,reject)=>{
    const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('This video cannot be decoded. Try MP4/H.264.'));};
    cleanup=()=>{video.removeEventListener('loadeddata',done);video.removeEventListener('error',failed);};
    video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',failed,{once:true});
  });video.load();buttonState();
  try{await loaded;if(attempt!==startEpoch)return;await presentFirstFrame(attempt);if(attempt!==startEpoch)return;clearVisuals();active=true;runId=crypto.randomUUID();autoSelectOnPreview=selectionMode==='hands';$('start-observation').textContent='Replay video';$('scene-label').textContent='YOUR VIDEO / SELECT AN OBJECT';$('source-tag').textContent='Uploaded video · image coordinates';$('privacy-note').textContent='The video stays on this device. Selected frames are sent to Meta for SAM segmentation.';showSelectionReady();await captureVideoFrame();}
  catch(error){if(attempt!==startEpoch)return;active=false;showMessage('VIDEO UNAVAILABLE','Could not open this video.',error.message);}
  finally{cleanup();if(attempt===startEpoch){starting=false;buttonState();}}
});
video.addEventListener('ended',()=>{if(inputKind==='video'&&active)stop({refresh:false,reason:'Video ended. Replay it or open another clip.'});});
horizonLabels();

$('lock-prediction').addEventListener('click',lockPrediction);
$('quick-lock').addEventListener('click',()=>{lockPrediction();if(ticket)$('challenge-card').scrollIntoView({behavior:'auto',block:'start'});});
$('reveal-prediction').addEventListener('click',revealPrediction);
$('resume-experiment').addEventListener('click',resumeExperiment);
$('apply-impulse').addEventListener('click',()=>{if(active&&!cameraMode&&challengePhase==='idle')send('impulse');});
$('start-observation').addEventListener('click',start);
$('stop-observation').addEventListener('click',()=>stop());
$('new-scene').addEventListener('click',newScene);
familySelect.addEventListener('change',newScene);
$('prediction-horizon').addEventListener('change',changeHorizon);
$('retry-connection').addEventListener('click',checkConnection);
$('flip-camera').addEventListener('click',async()=>{const resume=active;stop({refresh:false});inputKind='camera';if(videoUrl){URL.revokeObjectURL(videoUrl);videoUrl=null;video.removeAttribute('src');}facingMode=facingMode==='environment'?'user':'environment';$('start-observation').textContent='Start camera';if(resume)await start();});
$('export-observation').addEventListener('click',()=>{
  const evidence=observer.exportEvidence();evidence.interfaceEvents=interactionLog.map(event=>({...event}));
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='twinforge-sam-observation-'+(runId||'session')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
});
for(const button of document.querySelectorAll('[data-dialog]'))button.addEventListener('click',()=>{
  if(active||starting){if(cameraMode)stop({reason:'Camera paused while viewing details.'});else{modalPaused=true;send('pause');}}
  $(button.dataset.dialog).showModal();buttonState();
});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('close',()=>{
  const hadStarted=worldHasStarted;modalPaused=false;if(active&&lastSnapshot)render(lastSnapshot);if(hadStarted&&active&&!cameraMode&&worldHasStarted&&['idle','revealing'].includes(challengePhase))send('play');buttonState();
});
for(const button of document.querySelectorAll('[data-close-dialog]'))button.addEventListener('click',()=>button.closest('dialog').close());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))stop({refresh:false,reason:'Paused because this tab was hidden.'});});
addEventListener('pagehide',()=>{stop({refresh:false});clearInterval(captureTimer);if(videoUrl)URL.revokeObjectURL(videoUrl);});
world.addEventListener('load',initialScene);
initialScene();
checkConnection();
