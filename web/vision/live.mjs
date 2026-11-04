import {SamObserver} from './observer.mjs';
import {CameraSession} from '../camera/media.mjs';

const $=id=>document.getElementById(id);
const query=new URLSearchParams(location.search),cameraMode=query.get('mode')==='camera';
const familyNames={pendulum:'DOUBLE PENDULUM · NEW RANDOM IMPULSE',collisions:'COLLISIONS · NEW RANDOM INITIAL CONDITIONS',flight:'LAUNCH & REBOUND · NEW RANDOM IMPULSE'};
const familySelect=$('scene-family'),world=$('world-frame'),video=$('camera-video'),overlay=$('vision-overlay');
const pen=overlay.getContext('2d'),sample=document.createElement('canvas'),samplePen=sample.getContext('2d',{willReadFrequently:true});
const camera=new CameraSession(navigator.mediaDevices);
let connected=false,active=false,starting=false,runId=null,frameSerial=0,captureBusy=false,captureEpoch=0,startEpoch=0;
let sourceTime=0,facingMode='environment',previewId=null,lastSnapshot=null,firstReady=false,resetRequested=false,terminalFailure=null;
let budgetScene='vision',pricePerImage=.0025;
const frameCache=new Map();
const observer=new SamObserver({onUpdate:render,sourceKind:cameraMode?'camera':'synthetic',horizon:.2});
$('prediction-horizon').value=observer.horizon.toFixed(1);
const send=(command,extra={})=>world.contentWindow?.postMessage({type:'tf-world',command,...extra},location.origin);
const showMessage=(tag,title,copy)=>{ $('stage-message').hidden=false;$('stage-message-tag').textContent=tag;$('stage-message-title').textContent=title;$('stage-message-copy').textContent=copy; };
const buttonState=()=>{ $('start-observation').disabled=!connected||active||starting||observer.sessionCalls>=observer.maxRequests||(!cameraMode&&!runId);$('stop-observation').disabled=!active&&!starting; };
function showBudget(budget){
  if(!Number.isFinite(budget?.limit_per_scene)||!Number.isFinite(budget.scenes?.[budgetScene]??0))return;
  const remaining=Math.max(0,budget.limit_per_scene-(budget.scenes?.[budgetScene]??0));
  $('sam-remaining').textContent='$'+remaining.toFixed(4)+' · '+Math.max(0,Math.floor((remaining+1e-10)/pricePerImage))+' images';
}
function initialScene(){
  // The iframe can finish before this module installs its message listener.
  // Both the load event and an immediate request cover that ordering.
  if(cameraMode||active||starting||runId)return;
  resetRequested=true;send('reset',{family:familySelect.value});
}
function horizonLabels(){
  const seconds=observer.horizon.toFixed(1);
  $('forecast-legend').textContent='Predicted +'+seconds+' s';
  $('horizon-note').textContent=(observer.horizon===.5?'Stress test':'Short forecast')+' · change starts a new trial';
  if(cameraMode&&!active)showMessage('YOUR CAMERA','Show SAM something that moves.','Name one object above, then start. Keep the phone still; the orange target estimates its position in '+seconds+' seconds.');
}
async function changeHorizon(){
  const horizon=Number($('prediction-horizon').value);
  if(![.2,.5].includes(horizon)||horizon===observer.horizon)return;
  const resume=active||starting;stop({refresh:false});observer.horizon=horizon;
  // Archive old targets before clearing the visible statistics. Even a stopped
  // camera gets a new run, so changing the selector cannot relabel old scores.
  observer.reset({runId:crypto.randomUUID(),sourceKind:cameraMode?'camera':'synthetic',concept:observer.concept});observer.stop();
  clearVisuals();horizonLabels();
  if(resume)await start();else if(!cameraMode)newScene();
}

if(['pendulum','collisions','flight'].includes(query.get('scene')))familySelect.value=query.get('scene');
if(query.get('scene')==='chaos')familySelect.value='pendulum';
if(cameraMode){
  world.hidden=true;world.removeAttribute('src');video.hidden=false;
  $('world-controls').hidden=true;$('camera-controls').hidden=false;$('auto-scene-label').hidden=true;
  $('simulation-link').removeAttribute('aria-current');$('camera-link').setAttribute('aria-current','page');
  $('intro-copy').textContent='Point your phone at a moving object. SAM finds it; observed motion becomes a short forecast.';
  $('scene-label').textContent='LIVE CAMERA · VISUAL OBSERVATION';$('source-tag').textContent='Camera · image coordinates';
  $('privacy-note').textContent='Starting shares occasional camera images with Meta for SAM segmentation. No audio is captured. Stop turns off the camera.';
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
    connected=Boolean(status.available&&status.remaining_requests>0);
    budgetScene=status.budget_scene||'vision';pricePerImage=Number.isFinite(status.price_per_image_usd)&&status.price_per_image_usd>0?status.price_per_image_usd:.0025;
    const remaining=Number.isFinite(status.remaining_usd)?status.remaining_usd:0;
    $('sam-remaining').textContent='$'+remaining.toFixed(4)+' · '+(status.remaining_requests??0)+' images';
    $('connection-detail').textContent=connected?'SAM 3.1 is connected. An actual segmentation is required before any forecast. Requests share a persistent spending limit.':'SAM is unavailable or the shared image allowance has been used. Add the server credential or check the server allowance.';
    $('connection-notice').hidden=connected;
    $('hosted-link').hidden=connected||location.hostname==='twinforge-mobile-camera.mkinvest57.chatgpt.site';
    if(!connected){$('connection-title').textContent='SAM is not ready';$('connection-copy').textContent=$('connection-detail').textContent;}
    if(!active&&!terminalFailure){$('sam-indicator').textContent=connected?'READY':'OFFLINE';$('sam-indicator').className='recorded-dot'+(connected?' connected':'');$('observation-status').textContent=connected?'Ready. Start to send the first image to SAM 3.1.':'No SAM result means no visual prediction.';}
  }catch(error){
    $('connection-notice').hidden=false;$('hosted-link').hidden=false;
    $('connection-title').textContent='This address needs a live SAM connection';
    $('connection-copy').textContent='The scene can be generated here, but SAM inference requires the live workspace or the local Python server. No predictions are fabricated.';
    $('connection-detail').textContent=String(error.message);$('sam-remaining').textContent='Not connected';
    $('observation-status').textContent='Connect the live SAM service to begin observing.';
  }finally{$('retry-connection').disabled=false;buttonState();}
}

function clearVisuals(){
  captureEpoch++;frameCache.clear();previewId=null;sourceTime=0;
  pen.clearRect(0,0,overlay.width,overlay.height);
  $('sam-preview').getContext('2d').clearRect(0,0,$('sam-preview').width,$('sam-preview').height);
  $('sam-preview-caption').textContent='No image sent in this scene';$('scene-time').textContent='0.0 s';
}
function beginRun(id){
  clearVisuals();runId=id;terminalFailure=null;
  observer.start({runId,sourceKind:cameraMode?'camera':'synthetic',concept:cameraMode?$('object-concept').value.trim():'ball'});
  if(!cameraMode)send('play');
}
function newScene(){
  if(cameraMode)return;
  resetRequested=true;captureEpoch++;
  if(observer.active)observer.stop();
  clearVisuals();send('reset',{family:familySelect.value});
  showMessage('NEW UNKNOWN SCENE','SAM must observe this scene again.','The previous scene’s positions, motion and masks are discarded.');
}
async function start(){
  if(!connected||active||starting||observer.sessionCalls>=observer.maxRequests)return;
  const attempt=++startEpoch;starting=true;terminalFailure=null;buttonState();
  try{
    if(cameraMode){
      const concept=$('object-concept').value.trim();
      if(!concept||concept.length>80||/[\x00-\x1f<>|,;]/.test(concept))throw new Error('Enter one object name, such as ball, toy car or bottle.');
      const stream=await camera.start(facingMode);if(!stream||attempt!==startEpoch)return;
      video.srcObject=stream;await video.play();
      if(attempt!==startEpoch)return;
      active=true;beginRun(crypto.randomUUID());
    }else{active=true;newScene();}
    $('object-concept').disabled=true;
    showMessage('LIVE SAM 3.1','Looking at the first image…','Predictions become available only after real SAM masks and enough observed motion.');
  }catch(error){
    if(attempt!==startEpoch)return;
    active=false;camera.stop();video.srcObject=null;
    const messages={NotAllowedError:'Camera permission was denied. Allow camera access in your browser and try again.',NotFoundError:'No camera is available on this device.',NotReadableError:'The camera is unavailable or being used by another app.',SecurityError:'Camera access requires HTTPS or localhost.'};
    showMessage('COULD NOT START','Observation has not started.',messages[error.name]||error.message);
    $('observation-status').textContent=messages[error.name]||error.message;
  }finally{if(attempt===startEpoch){starting=false;buttonState();}}
}
function stop({refresh=true,failure=null}={}){
  const hadRun=active||starting;active=false;starting=false;resetRequested=false;captureEpoch++;startEpoch++;terminalFailure=failure;
  if(hadRun||observer.active)observer.stop();
  send('pause');camera.stop();video.srcObject=null;$('object-concept').disabled=false;
  pen.clearRect(0,0,overlay.width,overlay.height);buttonState();
  if(hadRun&&!failure)showMessage('STOPPED','Observation stopped.','The experiment’s observations and forecasts remain available to export.');
  if(refresh)checkConnection();
}

async function bitmapFromBase64(value){
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  return createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
}
async function captured(drawSource,width,height,t,id,epoch){
  if(!active||epoch!==captureEpoch||id!==runId)return;
  const scale=Math.min(1,480/Math.max(width,height));
  sample.width=Math.max(16,Math.round(width*scale));sample.height=Math.max(16,Math.round(height*scale));
  samplePen.drawImage(drawSource,0,0,sample.width,sample.height);
  const jpeg=sample.toDataURL('image/jpeg',.88).split(',')[1];
  // Track the same decoded JPEG pixels that SAM receives, not a higher quality source image.
  const decoded=await bitmapFromBase64(jpeg);
  if(!active||epoch!==captureEpoch||id!==runId){decoded.close();return;}
  samplePen.drawImage(decoded,0,0);decoded.close();
  const frameId='f'+(++frameSerial).toString(36),imageData=samplePen.getImageData(0,0,sample.width,sample.height);
  frameCache.set(frameId,{jpeg,width:sample.width,height:sample.height});
  while(frameCache.size>90)frameCache.delete(frameCache.keys().next().value);
  sourceTime=t;
  observer.pushFrame({imageData,t,frameId,imageBase64:jpeg,runId:id});
  if(!cameraMode&&$('auto-scene').checked&&t>=20&&!resetRequested)newScene();
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

const captureTimer=setInterval(async()=>{
  if(!active||captureBusy||resetRequested)return;
  if(!cameraMode){send('capture');return;}
  if(video.readyState<2||!video.videoWidth)return;
  captureBusy=true;
  try{await captured(video,video.videoWidth,video.videoHeight,video.currentTime,runId,captureEpoch);}
  catch(error){$('observation-status').textContent='Camera frame unavailable: '+error.message;}
  finally{captureBusy=false;}
},80);

function line(points,color,width=1.5,dash=[]){
  if(points.length<2)return;pen.beginPath();pen.setLineDash(dash);pen.lineWidth=width;pen.strokeStyle=color;
  pen.moveTo(points[0].x,points[0].y);for(const p of points.slice(1))pen.lineTo(p.x,p.y);pen.stroke();pen.setLineDash([]);
}
function target(p,alpha=1){
  if(!p)return;pen.globalAlpha=alpha;pen.strokeStyle='#cf4b08';pen.lineWidth=1.5;
  pen.beginPath();pen.arc(p.x,p.y,5,0,Math.PI*2);pen.moveTo(p.x-9,p.y);pen.lineTo(p.x+9,p.y);pen.moveTo(p.x,p.y-9);pen.lineTo(p.x,p.y+9);pen.stroke();pen.globalAlpha=1;
}
function drawOverlay(state){
  if(!state.width)return;
  if(overlay.width!==state.width||overlay.height!==state.height){overlay.width=state.width;overlay.height=state.height;}
  if(cameraMode)$('vision-stage').style.aspectRatio=state.width+'/'+state.height;
  pen.clearRect(0,0,overlay.width,overlay.height);
  for(const track of state.tracks){
    if(track.status!=='tracking'||!track.point)continue;
    line(track.recentTrail,'#087d9690',1.6);
    if(track.box){pen.strokeStyle='#087d96';pen.lineWidth=1;pen.strokeRect(track.box.x,track.box.y,track.box.width,track.box.height);}
    pen.beginPath();pen.arc(track.point.x,track.point.y,3,0,Math.PI*2);pen.fillStyle='#087d96';pen.fill();
    for(const pending of (track.pendingTargets||[]).slice(0,-1))target(pending.point,.16);
    if(track.prediction){
      line([track.point,track.prediction.point],'#cf4b08',1.5,[4,3]);target(track.prediction.point);
      pen.font='10px system-ui';pen.fillStyle='#903300';pen.fillText('+'+track.prediction.horizon.toFixed(1)+' s',track.prediction.point.x+10,track.prediction.point.y-8);
    }
  }
}
async function updatePreview(state){
  const latest=state.latestSam;if(!latest||latest.frameId===previewId)return;
  const cached=frameCache.get(latest.frameId);if(!cached)return;
  previewId=latest.frameId;const expected=previewId,epoch=captureEpoch;
  const bitmap=await bitmapFromBase64(cached.jpeg);
  if(epoch!==captureEpoch||expected!==previewId){bitmap.close();return;}
  const canvas=$('sam-preview');canvas.width=cached.width;canvas.height=cached.height;canvas.parentElement.style.aspectRatio=cached.width+'/'+cached.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  ctx.strokeStyle='#087d96';ctx.fillStyle='#08abc533';ctx.lineWidth=1.5;
  for(const track of state.tracks)for(const polygon of track.samPolygons){
    ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();ctx.stroke();
  }
  $('sam-preview-caption').textContent='SAM MASK · CAPTURED AT '+latest.sourceTimeS.toFixed(2)+' s';
}
function render(state){
  if(['sam_unavailable','request_limit'].includes(state.status)&&active){stop({refresh:true,failure:{message:state.message}});return;}
  lastSnapshot=state;
  $('scene-time').textContent=(state.timeS??0).toFixed(1)+' s';
  $('tracked-count').textContent=String(state.tracks.filter(t=>t.status==='tracking').length);
  $('forecast-error').textContent=state.meanErrorPx===null?'—':state.meanErrorPx.toFixed(1)+' px';
  $('forecast-scores').textContent=state.scoredCount?state.scoredCount+' checked · '+state.unscorableCount+' unscored':'Waiting for future observations';
  $('prediction-count').textContent=String(state.issuedCount);
  $('sam-count').textContent=String(observer.samRecords.length);
  $('sam-latency').textContent=state.latestSam?.latencyMs!=null?(state.latestSam.latencyMs/1000).toFixed(2)+' s':'—';
  $('export-observation').disabled=!state.latestSam&&!state.issuedCount&&!observer.history.length;
  $('observation-status').textContent=terminalFailure?.message||state.message;
  const hasSam=Boolean(state.latestSam),blocked=Boolean(terminalFailure)||['sam_unavailable','request_limit'].includes(state.status);
  $('sam-indicator').textContent=blocked?'UNAVAILABLE':state.samPending?'OBSERVING':hasSam?(state.active?'LIVE SAM':'RECORDED'):connected?'READY':'OFFLINE';
  $('sam-indicator').className='recorded-dot'+(!blocked&&state.samPending?' pending':!blocked&&state.active&&hasSam?' connected':'');
  if(state.latestSam?.budget)showBudget(state.latestSam.budget);
  $('sam-detail').textContent=hasSam?'Real SAM receipt verified against this captured image. Latest mask: '+state.latestSam.detectedCount+' object'+(state.latestSam.detectedCount===1?'':'s')+'.':'Object masks come from real Meta API calls on the current images.';
  if(blocked)showMessage('NO PREDICTION WITHOUT SAM','SAM observation is unavailable.',terminalFailure?.message||state.message);
  else if(state.active){
    if(!hasSam)showMessage('LIVE SAM 3.1','Discovering objects from the image…','No initial state or simulator coordinates are available to the observer.');
    else if(!state.tracks.length)showMessage('SAM FOUND NO USABLE TRACK','Waiting for a visible object.',state.message);
    else $('stage-message').hidden=true;
  }
  drawOverlay(state);updatePreview(state).catch(()=>{});
  buttonState();
}

$('start-observation').addEventListener('click',start);
$('stop-observation').addEventListener('click',()=>stop());
$('new-scene').addEventListener('click',newScene);
familySelect.addEventListener('change',newScene);
$('prediction-horizon').addEventListener('change',changeHorizon);
$('retry-connection').addEventListener('click',checkConnection);
$('flip-camera').addEventListener('click',async()=>{const resume=active;stop({refresh:false});facingMode=facingMode==='environment'?'user':'environment';if(resume)await start();});
$('export-observation').addEventListener('click',()=>{
  const evidence=observer.exportEvidence();
  const url=URL.createObjectURL(new Blob([JSON.stringify(evidence,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='twinforge-sam-observation-'+(runId||'session')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
});
for(const button of document.querySelectorAll('[data-dialog]'))button.addEventListener('click',()=>{if(active||starting)stop();$(button.dataset.dialog).showModal();});
for(const button of document.querySelectorAll('[data-close-dialog]'))button.addEventListener('click',()=>button.closest('dialog').close());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))stop({refresh:false});});
addEventListener('pagehide',()=>{stop({refresh:false});clearInterval(captureTimer);});
world.addEventListener('load',initialScene);
initialScene();
checkConnection();
