import {SamObserver} from './observer.mjs';
import {CameraSession} from '../camera/media.mjs';

const $=id=>document.getElementById(id);
const query=new URLSearchParams(location.search),cameraMode=query.get('mode')==='camera';
const familyNames={pendulum:'CHAOS RIG / RANDOM LAUNCH',collisions:'KINETIC CHAMBER / RANDOM MOTION',flight:'REBOUND CASCADE / RANDOM LAUNCH'};
const familySelect=$('scene-family'),world=$('world-frame'),video=$('camera-video'),overlay=$('vision-overlay');
const pen=overlay.getContext('2d'),sample=document.createElement('canvas'),samplePen=sample.getContext('2d',{willReadFrequently:true});
const camera=new CameraSession(navigator.mediaDevices);
let connected=false,active=false,starting=false,runId=null,frameSerial=0,captureBusy=false,captureEpoch=0,startEpoch=0;
let sourceTime=0,facingMode='environment',previewId=null,lastSnapshot=null,firstReady=false,resetRequested=false,terminalFailure=null;
let budgetScene='vision',pricePerImage=.0025;
let worldHasStarted=false,challengePhase='idle',ticket=null,ticketDrawKey=null,modalPaused=false,impulseTimer=null;
let samRemaining=null,waitingSince=0;
const frameCache=new Map();
const interactionLog=[];
function logInteraction(kind,extra={}){interactionLog.push({kind,runId,sourceTimeS:sourceTime,wallTime:new Date().toISOString(),...extra});if(interactionLog.length>200)interactionLog.shift();}
const observer=new SamObserver({onUpdate:render,sourceKind:cameraMode?'camera':'synthetic',horizon:.2});
$('prediction-horizon').value=observer.horizon.toFixed(1);
const send=(command,extra={})=>world.contentWindow?.postMessage({type:'tf-world',command,...extra},location.origin);
const showMessage=(tag,title,copy)=>{ $('stage-message').hidden=false;$('stage-message-tag').textContent=tag;$('stage-message-title').textContent=title;$('stage-message-copy').textContent=copy; };
const buttonState=()=>{
  $('start-observation').disabled=!connected||active||starting||observer.sessionCalls>=observer.maxRequests||(!cameraMode&&!runId);
  $('stop-observation').disabled=!active&&!starting;
  $('apply-impulse').disabled=!active||!worldHasStarted||cameraMode||challengePhase!=='idle'||modalPaused;
  $('lock-prediction').disabled=!active||!lastSnapshot?.canLockPrediction||challengePhase!=='idle'||modalPaused;
  $('quick-lock').disabled=$('lock-prediction').disabled;
};
function showBudget(budget){
  if(!Number.isFinite(budget?.limit_per_scene)||!Number.isFinite(budget.scenes?.[budgetScene]??0))return;
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
  const seconds=observer.horizon.toFixed(1);
  $('forecast-legend').textContent='Predicted +'+seconds+' s';
  if(!ticket)$('ticket-target-time').textContent='+'+seconds+' s';
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
  world.hidden=true;world.removeAttribute('src');video.hidden=false;$('vision-stage').className+=' camera-stage';
  $('world-controls').hidden=true;$('camera-controls').hidden=false;$('auto-scene-label').hidden=true;
  $('simulation-link').removeAttribute('aria-current');$('camera-link').setAttribute('aria-current','page');
  $('intro-copy').textContent='Your scene. Your objects. The same image-only observation test.';
  $('apply-impulse').hidden=true;$('impulse-description').textContent='Move the object yourself. Keep the camera still.';
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
    samRemaining=status.remaining_requests??0;
    $('sam-remaining').textContent='$'+remaining.toFixed(4)+' · '+samRemaining+' images';
    $('connection-summary').textContent=connected?'SAM connected · '+samRemaining+' images left':'SAM unavailable';
    $('usage-fill').style.width=(100*Math.min(1,remaining/.5)).toFixed(1)+'%';
    $('connection-detail').textContent=connected?'SAM 3.1 is connected. An actual segmentation is required before any forecast. Requests share a persistent spending limit.':'SAM is unavailable or the shared image allowance has been used. Add the server credential or check the server allowance.';
    $('connection-notice').hidden=connected;
    $('hosted-link').hidden=connected||location.hostname==='twinforge-mobile-camera.mkinvest57.chatgpt.site';
    if(status.service_state==='busy')$('connection-detail').textContent=status.message||'A previous image is still being processed. The connection will recover automatically.';
    if(!connected){$('connection-title').textContent='SAM is not ready';$('connection-copy').textContent=$('connection-detail').textContent;}
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
  captureEpoch++;frameCache.clear();previewId=null;sourceTime=0;worldHasStarted=false;waitingSince=Date.now();resetChallenge();
  pen.clearRect(0,0,overlay.width,overlay.height);
  $('sam-preview').getContext('2d').clearRect(0,0,$('sam-preview').width,$('sam-preview').height);
  $('sam-preview-caption').textContent='No image sent in this scene';$('scene-time').textContent='0.0 s';
}
function beginRun(id){
  clearVisuals();runId=id;terminalFailure=null;
  observer.start({runId,sourceKind:cameraMode?'camera':'synthetic',concept:cameraMode?$('object-concept').value.trim():'ball'});
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
function stop({refresh=true,failure=null,reason=null}={}){
  const hadRun=active||starting;if(hadRun)logInteraction('observation_stopped',{reason:failure?.message||reason||'user_stop'});active=false;starting=false;resetRequested=false;captureEpoch++;startEpoch++;terminalFailure=failure;
  if(hadRun||observer.active)observer.stop();
  send('pause');camera.stop();video.srcObject=null;$('object-concept').disabled=false;
  pen.clearRect(0,0,overlay.width,overlay.height);buttonState();
  $('world-state').textContent='PAUSED';
  if(hadRun&&!failure)showMessage('PAUSED',reason||'Experiment paused.','Start a new experiment when you are ready. This record remains available to download.');
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
  frameCache.set(frameId,{jpeg,width:sample.width,height:sample.height,t});
  while(frameCache.size>90)frameCache.delete(frameCache.keys().next().value);
  sourceTime=t;
  observer.pushFrame({imageData,t,frameId,imageBase64:jpeg,runId:id});
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

const captureTimer=setInterval(async()=>{
  if(!active||captureBusy||resetRequested||modalPaused||(!cameraMode&&['locked','result'].includes(challengePhase)))return;
  if(!cameraMode&&!worldHasStarted)observer.retryPendingFrame?.();
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
  if(!p)return;pen.globalAlpha=alpha;pen.strokeStyle='#ffbd69';pen.lineWidth=1.5;
  pen.beginPath();pen.arc(p.x,p.y,5,0,Math.PI*2);pen.moveTo(p.x-9,p.y);pen.lineTo(p.x+9,p.y);pen.moveTo(p.x,p.y-9);pen.lineTo(p.x,p.y+9);pen.stroke();pen.globalAlpha=1;
}
function drawOverlay(state){
  if(!state.width)return;
  if(overlay.width!==state.width||overlay.height!==state.height){overlay.width=state.width;overlay.height=state.height;}
  if(cameraMode){$('vision-stage').style.aspectRatio=state.width+'/'+state.height;$('scene-surface').style.aspectRatio=state.width+'/'+state.height;}
  pen.clearRect(0,0,overlay.width,overlay.height);
  if(ticket&&challengePhase!=='idle'&&(!cameraMode||challengePhase==='revealing')){drawLockedTarget(pen,ticket);return;}
  for(const track of state.tracks){
    if(track.status!=='tracking'||!track.point)continue;
    line(track.recentTrail,'#68dbed90',1.6);
    if(track.box){pen.strokeStyle='#68dbed';pen.lineWidth=1;pen.strokeRect(track.box.x,track.box.y,track.box.width,track.box.height);}
    pen.beginPath();pen.arc(track.point.x,track.point.y,3,0,Math.PI*2);pen.fillStyle='#68dbed';pen.fill();
    for(const pending of (track.pendingTargets||[]).slice(0,-1))target(pending.point,.16);
    if(track.prediction){
      line([track.point,track.prediction.point],'#ffbd69',1.5,[4,3]);target(track.prediction.point);
      pen.font='10px system-ui';pen.fillStyle='#ffcf94';pen.fillText('+'+track.prediction.horizon.toFixed(1)+' s',track.prediction.point.x+10,track.prediction.point.y-8);
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
  ctx.strokeStyle='#68dbed';ctx.fillStyle='#68dbed33';ctx.lineWidth=1.5;
  for(const track of state.tracks.filter(t=>Math.abs(t.samTimeS-latest.sourceTimeS)<1e-8))for(const polygon of track.samPolygons){
    ctx.beginPath();polygon.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();ctx.stroke();
  }
  $('sam-preview-caption').textContent='MASK · '+latest.sourceTimeS.toFixed(2)+' s';
}
function render(state){
  if(['sam_unavailable','request_limit'].includes(state.status)&&active){stop({refresh:true,failure:{message:state.message}});return;}
  lastSnapshot=state;
  if(!cameraMode&&active&&!worldHasStarted&&state.latestSam&&!modalPaused){worldHasStarted=true;send('play');}
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
  $('sam-latency').textContent=state.latestSam?.latencyMs!=null?(state.latestSam.latencyMs/1000).toFixed(2)+' s':'—';
  $('export-observation').disabled=!state.latestSam&&!state.issuedCount&&!observer.history.length;
  $('observation-status').textContent=terminalFailure?.message||(challengePhase==='locked'?'Prediction locked before its target time. Reveal to advance the scene.':challengePhase==='result'&&!cameraMode?'Outcome held for inspection. Continue when ready.':state.message);
  const hasSam=Boolean(state.latestSam),blocked=Boolean(terminalFailure)||['sam_unavailable','request_limit'].includes(state.status);
  $('sam-indicator').textContent=blocked?'UNAVAILABLE':state.samPending?'OBSERVING':hasSam?(state.active?'LIVE SAM':'RECORDED'):connected?'READY':'OFFLINE';
  $('sam-indicator').className='recorded-dot'+(!blocked&&state.samPending?' pending':!blocked&&state.active&&hasSam?' connected':'');
  if(state.latestSam?.budget)showBudget(state.latestSam.budget);
  $('sam-detail').textContent=hasSam?'Real SAM receipt verified against this captured image. Latest mask: '+state.latestSam.detectedCount+' object'+(state.latestSam.detectedCount===1?'':'s')+'.':'Object masks come from real Meta API calls on the current images.';
  if(blocked)showMessage('NO PREDICTION WITHOUT SAM','SAM observation is unavailable.',terminalFailure?.message||state.message);
  else if(state.active){
    if(!hasSam)showMessage(state.status==='sam_busy'?'SAM IS FINISHING AN IMAGE':'REAL SAM INFERENCE',state.status==='sam_busy'?'Waiting for the previous request…':'Discovering the objects…',state.status==='sam_busy'?'The server is occupied. This scene stays paused and retries automatically.':'The scene is paused while SAM segments the first image. Motion begins when its masks arrive.');
    else if(!state.tracks.length)showMessage('SAM FOUND NO USABLE TRACK','Waiting for a visible object.',state.message);
    else $('stage-message').hidden=true;
  }
  if(challengePhase==='idle'){
    const readiness=typeof state.forecastReadiness==='string'?state.forecastReadiness:state.forecastReadiness?.message;
    $('challenge-hint').textContent=!active?'Start the experiment to unlock a real forecast.':state.canLockPrediction?'A future target is available. Lock it before time advances.':readiness||(!hasSam?'Waiting for the first SAM segmentation…':'Learning motion from the latest observed frames…');
  }
  drawOverlay(state);updatePreview(state).catch(()=>{});
  buttonState();
}

function resetChallenge(){
  challengePhase='idle';ticket=null;ticketDrawKey=null;
  $('challenge-title').textContent='Lock the future.';$('challenge-phase').textContent='READY WHEN YOU ARE';
  $('challenge-copy').textContent='Hold a predicted position on screen. Then let time catch up.';
  $('ticket-number').textContent='—';$('ticket-empty').hidden=false;$('ticket-result').hidden=true;
  $('ticket-source-time').textContent='—';$('ticket-target-time').textContent='+'+observer.horizon.toFixed(1)+' s';
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
  ctx.font='10px ui-monospace,monospace';ctx.fillStyle='#ffbd69';ctx.fillText('LOCKED +'+value.horizon.toFixed(1)+'s',Math.max(5,Math.min(365,p.x+17)),Math.max(14,p.y-17));
  if(actual){ctx.strokeStyle='#68dbed';ctx.fillStyle='#68dbed';ctx.beginPath();ctx.arc(actual.x,actual.y,4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(actual.x,actual.y);ctx.stroke();}
}
async function paintTicket(value){
  const cacheId=value.outcome?.frameId||value.sourceFrameId,cached=frameCache.get(cacheId)||frameCache.get(value.sourceFrameId);
  const key=value.id+':'+value.status+':'+cacheId;if(key===ticketDrawKey||!cached)return;
  ticketDrawKey=key;const bitmap=await bitmapFromBase64(cached.jpeg);
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
  $('challenge-title').textContent=complete?(scored?'Now we can measure.':'The track was lost.'):'The target is frozen.';
  $('challenge-copy').textContent=complete?(scored?'Amber was predicted. Cyan is the later visual observation.':'There is no reliable later observation to compare. This attempt stays in the record.'):(cameraMode?'The camera keeps running. The next frames will test this target.':'The world is paused. This target was recorded before its future frame.');
  $('ticket-result').hidden=!complete;$('ticket-result').textContent=scored?ticket.outcome.errorPx.toFixed(1)+' px error':'UNSCORABLE';
  $('lock-prediction').hidden=true;$('reveal-prediction').hidden=complete||cameraMode||challengePhase!=='locked';$('resume-experiment').hidden=!complete;
  $('challenge-hint').textContent=complete?(scored?'Measured from later tracked pixels, interpolated at the target time.':'Tracking uncertainty is not counted as a correct prediction.'):(cameraMode?'No simulator data is available in camera mode.':'Reveal advances time. The target cannot move to match the result.');
  paintTicket(ticket).catch(()=>{});
}
function lockPrediction(){
  if(!active||challengePhase!=='idle'||!lastSnapshot?.canLockPrediction)return;
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
$('flip-camera').addEventListener('click',async()=>{const resume=active;stop({refresh:false});facingMode=facingMode==='environment'?'user':'environment';if(resume)await start();});
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
addEventListener('pagehide',()=>{stop({refresh:false});clearInterval(captureTimer);});
world.addEventListener('load',initialScene);
initialScene();
checkConnection();
