import {createTracker} from './tracker.mjs';
import {forecast,assessForecast} from './prediction.mjs';
import {CameraSession,cameraErrorMessage,recordingMime,imageRect,pointInImage} from './media.mjs';

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
  text('camera-selection','Aucun objet sélectionné');text('camera-forecast','En attente');text('camera-confidence','—');text('camera-error','—');
  sessionId=crypto.randomUUID?.()||String(Date.now());draw();
}
function stopRecorder(){
  clearTimeout(recordTimer);
  if(recorder?.state==='recording')recorder.stop();
}
function stopSource(message='Caméra arrêtée. Les mesures restent exportables.'){
  sourceGeneration++;running=false;cancelAnimationFrame(loopId);if(videoLoop&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(loopId);
  $('camera-start').disabled=false;
  stopRecorder();camera.stop();video.pause();video.srcObject=null;video.removeAttribute('src');video.load();
  if(sourceURL)URL.revokeObjectURL(sourceURL);sourceURL=null;source=null;lastFrameTime=-1;
  selected=false;prediction=null;result=null;selectionStart=selectionEnd=null;tracker.reset();video.hidden=false;video.controls=false;overlay.style.pointerEvents='';frame=null;
  text('camera-source','Aucune source active');text('camera-selection','Capture arrêtée');text('camera-forecast','En attente');text('camera-confidence','—');text('camera-fps','— i/s');
  if(message)status(message);buttons();draw();
}
function newSource(kind){
  source=kind;sessionSource=kind;lastFrameTime=-1;lastProcess=0;clearMeasurement();
  text('camera-source',kind==='camera'?'Caméra · traitement local':kind==='example'?'Exemple synthétique · traitement des pixels':'Vidéo importée · traitement local');
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
        ctx.font='600 13px system-ui';ctx.fillStyle='#37c8d9';ctx.fillText('+0,5 s',clamp(p.x+16,8,bounds.width-60),clamp(p.y-15,18,bounds.height-12));
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
  if(frame&&(frame.width!==pixels.width||frame.height!==pixels.height)){clearMeasurement();status('Format de la caméra modifié. Sélectionnez à nouveau l’objet.');}
  frame=pixels;
  if(t<=lastFrameTime){if(t<lastFrameTime-.01){clearMeasurement();lastFrameTime=-1;}else{draw();return;}}
  text('camera-fps',lastFrameTime>=0?Math.round(1/(t-lastFrameTime))+' images/s':'—');lastFrameTime=t;
  if(selected){
    result=tracker.update(frame,t);
    observations.push({t,point:result.point,box:result.box,confidence:result.confidence,status:result.status,trackId:result.trackId,reason:result.reason});
    if(observations.length>=1800){stopSource('Session de mesures complète. La caméra est arrêtée. Exportez vos mesures puis ouvrez une nouvelle source.');return;}
    if(result.status==='tracking'){
      prediction=forecast(observations,{sourceTime:t,horizon:.5});
      text('camera-selection','Objet suivi');text('camera-confidence',Math.round((result.confidence||0)*100)+' %');
      if(prediction.status==='predicted'){
        const outside=prediction.point.x<0||prediction.point.y<0||prediction.point.x>frame.width||prediction.point.y>frame.height;
        text('camera-forecast',outside?'Hors champ à +0,5 s':'+0,5 s');
        status(outside?'La trajectoire prévue sort de l’image. Gardez le téléphone immobile.':'Suivi actif. Le repère cyan indique la position prévue à +0,5 seconde.');
        if(t-lastIssue>=.1){predictions.push({...prediction});lastIssue=t;}
      }else{
        text('camera-forecast','Observation');
        status(prediction.reason==='stationary_or_low_motion'?'L’objet est immobile. Observez son mouvement pour prévoir sa trajectoire.':'Observation du mouvement… La prévision apparaît dès que le suivi est assez stable.');
      }
    }else{
      prediction=null;text('camera-confidence','—');text('camera-forecast','Suspendue');
      text('camera-selection',result.status==='camera_moving'?'Téléphone en mouvement':'Objet perdu');
      status(result.status==='camera_moving'?'Le téléphone a bougé. Stabilisez-le et sélectionnez à nouveau l’objet.':'Objet perdu ou masqué. Aucune trajectoire inventée : replacez-le dans le cadre ou sélectionnez-le à nouveau.');
    }
    for(const p of predictions){
      if(p.assessment||p.targetTime>t)continue;
      const assessment=assessForecast(p,observations,{availableTime:t,maxBracketGap:.18});
      if(assessment){p.assessment=assessment;assessments.push(assessment);}
    }
    const scores=assessments.filter(a=>a.status==='scored'&&Number.isFinite(a.errorPx));
    if(scores.length)text('camera-error',(scores.reduce((n,a)=>n+a.errorPx,0)/scores.length).toFixed(1)+' px · '+scores.length+' prévisions');
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
  text('camera-error','—');text('camera-confidence','—');text('camera-forecast','Observation');
  if(selected){
    observations.push({t,point:result.point,box:result.box,confidence:result.confidence,status:result.status,trackId:result.trackId});
    text('camera-selection','Objet sélectionné');status('Objet sélectionné. Gardez le téléphone fixe et observez son mouvement.');
    showImage();
    if(source==='file'&&video.paused){video.play().catch(()=>{video.controls=true;overlay.style.pointerEvents='none';status('Touchez Lecture dans la vidéo pour démarrer, puis resélectionnez si nécessaire.');});}
  }else{
    text('camera-selection','Sélection à refaire');status(result.reason==='selection_too_small'?'L’objet est trop petit dans l’image. Rapprochez la caméra ou agrandissez le rectangle.':'Choisissez un objet avec des contours visibles. Encadrez-le en glissant le doigt, avec un peu de fond autour.');
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
$('camera-reset').onclick=()=>{clearMeasurement();buttons();status('Touchez l’objet ou encadrez-le en glissant le doigt.');};
async function startCamera(){
  stopSource(null);const generation=sourceGeneration;clearMeasurement();
  if(!window.isSecureContext){status('Pour utiliser la caméra, ouvrez cette page en HTTPS. Vous pouvez aussi importer une vidéo.');return;}
  $('camera-start').disabled=true;$('camera-stop').disabled=false;status('Autorisez la caméra dans la demande du navigateur. Le microphone reste désactivé.');
  if($('mobile-camera-start'))$('mobile-camera-start').disabled=true;
  if($('mobile-camera-stop'))$('mobile-camera-stop').disabled=false;
  try{
    const stream=await camera.start(facing);if(!stream||generation!==sourceGeneration)return;
    video.srcObject=stream;await video.play();if(generation!==sourceGeneration)return;
    newSource('camera');running=true;
    for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(source==='camera')stopSource('La caméra a été interrompue. Vous pouvez la rouvrir.');},{once:true});
    status('Caméra prête. Touchez l’objet ou encadrez-le avec le doigt. Gardez le téléphone immobile.');showImage();schedule();
  }catch(error){if(generation===sourceGeneration){camera.stop();status(cameraErrorMessage(error));}}
  finally{if(generation===sourceGeneration){$('camera-start').disabled=false;buttons();}}
}
$('camera-start').onclick=startCamera;
$('camera-stop').onclick=()=>stopSource();
$('camera-flip').onclick=()=>{facing=facing==='environment'?'user':'environment';startCamera();};
$('camera-example').onclick=()=>{
  stopSource(null);newSource('example');video.hidden=true;fixtureTime=0;fixtureLast=0;renderFixture(0);frame=capturePixels();lastFrameTime=performance.now()/1000;running=true;
  status('Exemple synthétique : sélectionnez l’objet violet au centre. Le suivi analyse les pixels affichés.');buttons();draw();showImage();schedule();
};
$('camera-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  if(!file.type.startsWith('video/')||file.size>64*1024*1024){status('Choisissez une vidéo de moins de 64 Mo.');event.target.value='';return;}
  stopSource(null);const generation=sourceGeneration;newSource('file');sourceURL=URL.createObjectURL(file);video.src=sourceURL;
  status('Chargement de la vidéo sur cet appareil…');
  video.onloadeddata=()=>{
    if(generation!==sourceGeneration||source!=='file')return;
    lastFrameTime=video.currentTime;frame=capturePixels();buttons();draw();showImage();
    status('Vidéo prête. Sélectionnez l’objet sur la première image pour lancer le suivi.');
  };
  video.onerror=()=>{if(source==='file')stopSource('Ce format vidéo n’est pas lisible ici. Essayez MP4/H.264 ou une capture de la caméra.');};
  video.load();event.target.value='';
};
video.addEventListener('ended',()=>{
  if(source==='file'){running=false;prediction=null;text('camera-forecast','Terminée');text('camera-fps','— i/s');draw();status('Vidéo terminée. Exportez les mesures, ou importez-la à nouveau pour une autre sélection.');}
});
video.addEventListener('playing',()=>{
  if(source==='file'&&!running){video.controls=false;overlay.style.pointerEvents='';running=true;schedule();}
});
function download(name,blob){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
$('camera-export').onclick=()=>{
  const report={schema_version:'twinforge.mobile-observations.v1',session_id:sessionId,created_at:new Date().toISOString(),source:sessionSource,processing:'local deterministic visual tracking; no SAM or cloud calls',calibration:{mode:'image_plane',metric:false,dimensions_observed:2,width:frame?.width??sample.width,height:frame?.height??sample.height,units:'px'},horizon_s:.5,observations,predictions,assessments,limitations:['Camera must remain fixed.','Short-term motion extrapolation; collisions and physical properties are not inferred.','No metric 3D reconstruction or guaranteed identity through occlusion.','Only forecasts whose target time was observed receive an error score.']};
  download('twinforge-scan-'+sessionId+'.json',new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));status('Mesures exportées. Les images de la caméra ne sont pas incluses.');
};
$('camera-record').onclick=()=>{
  if(recorder){if(recorder.state==='recording')stopRecorder();return;}
  if(!camera.stream||!window.MediaRecorder){text('camera-record-status','Enregistrement indisponible. Utilisez la capture vidéo de votre téléphone.');return;}
  try{
    const type=recordingMime(window.MediaRecorder);recorder=new MediaRecorder(camera.stream,type?{mimeType:type,videoBitsPerSecond:2000000}:{videoBitsPerSecond:2000000});
    recordData=[];recordBytes=0;let capture=recorder;
    capture.ondataavailable=e=>{if(e.data.size){recordData.push(e.data);recordBytes+=e.data.size;if(recordBytes>16*1024*1024)stopRecorder();}};
    capture.onerror=()=>{text('camera-record-status','Enregistrement interrompu par le navigateur.');stopRecorder();};
    capture.onstop=()=>{
      const type=capture.mimeType||'video/webm';
      const link=$('camera-record-download');
      if(recordURL)URL.revokeObjectURL(recordURL);
      recordURL=null;
      if(recordData.length){
        recordURL=URL.createObjectURL(new Blob(recordData,{type}));link.href=recordURL;
        link.download='twinforge-camera.'+(type.includes('mp4')?'mp4':'webm');link.hidden=false;
      }
      recorder=null;recordData=[];$('camera-record').textContent='Enregistrer 8 s';text('camera-record-status',recordURL?'Clip prêt. Touchez « Télécharger le clip » pour le conserver, sans son ni envoi.':'Aucune image enregistrée. Vous pouvez réessayer.');buttons();
    };
    capture.start(500);recordTimer=setTimeout(stopRecorder,8000);$('camera-record').textContent='Terminer le clip';text('camera-record-status','Enregistrement local en cours · 8 secondes maximum · sans son');
  }catch{recorder=null;text('camera-record-status','Ce navigateur ne peut pas enregistrer ce format. Utilisez la capture vidéo native.');}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopSource('Capture arrêtée lorsque la page est passée en arrière-plan.');});
if($('mobile-camera-start'))$('mobile-camera-start').onclick=()=>{$('camera-start').click();};
if($('mobile-camera-example'))$('mobile-camera-example').onclick=()=>{$('camera-example').click();};
if($('mobile-camera-stop'))$('mobile-camera-stop').onclick=()=>{$('camera-stop').click();};
window.addEventListener('pagehide',()=>stopSource(null));
window.addEventListener('resize',resize);
new ResizeObserver(resize).observe(stage);
resize();buttons();
if(!window.isSecureContext)status('La caméra directe nécessite HTTPS. L’import vidéo et l’exemple restent disponibles.');

