/**
 * A pixel-only observer. SAM 3.1 supplies each track's segmentation anchor;
 * local appearance tracking bridges SAM keyframes. A separate kinematic
 * predictor uses only past measured pixels. No simulator state is accepted.
 */
import {createSamTracker} from './sam-tracker.mjs';
import {assessForecast} from '../camera/prediction.mjs';
import {forecastMotion as forecast} from './motion.mjs';

const INPUT_KEYS=new Set(['imageData','t','frameId','imageBase64','runId']);
const SOURCE_KINDS=new Set(['synthetic','camera']);
const MAX_REQUESTS=60;
const clone=value=>JSON.parse(JSON.stringify(value));
const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const hex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
function validateRun({runId,sourceKind,concept}){
  if(typeof runId!=='string'||!(/^[a-f0-9]{32}$/.test(runId)||/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId)))throw new TypeError('runId must be a lowercase UUID or 32 hexadecimal characters.');
  if(!SOURCE_KINDS.has(sourceKind))throw new TypeError('sourceKind must be synthetic or camera.');
  if(typeof concept!=='string'||!concept.trim()||concept.length>80||/[\x00-\x1f<>|,;]/.test(concept))throw new TypeError('Use one short object concept.');
}
function validateFrame(frame){
  if(!frame||typeof frame!=='object'||Object.keys(frame).some(k=>!INPUT_KEYS.has(k)))throw new TypeError('Only image pixels, image bytes, frame identity and capture time are accepted.');
  const im=frame.imageData,w=im?.width,h=im?.height;
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||h<8||w>640||h>640||!im.data||![w*h,w*h*4].includes(im.data.length))throw new TypeError('Supply at most 640 × 640 RGBA or grey pixels.');
  if(!Number.isFinite(frame.t)||frame.t<0)throw new TypeError('Frame time must be nonnegative seconds.');
  if(typeof frame.frameId!=='string'||!/^[A-Za-z0-9_.:-]{1,64}$/.test(frame.frameId))throw new TypeError('frameId must be a short alphanumeric identifier.');
  if(typeof frame.imageBase64!=='string'||frame.imageBase64.length>600000||!frame.imageBase64.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(frame.imageBase64))throw new TypeError('Supply bounded raw JPEG base64.');
}
async function digestBase64(base64){
  const raw=atob(base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const result=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(result),v=>v.toString(16).padStart(2,'0')).join('');
}
function sourceColor(detection,index){
  if(Array.isArray(detection.color_rgb)&&detection.color_rgb.length===3&&detection.color_rgb.every(Number.isFinite))return 'rgb('+detection.color_rgb.map(n=>Math.round(Math.max(0,Math.min(255,n)))).join(',')+')';
  return ['#52cddd','#ffab6b','#9ad79d'][index%3];
}
function normalizedDetection(d,w,h){
  const b=d?.box;
  if(!d?.mask_decoded||!b||!['x1','y1','x2','y2'].every(k=>Number.isFinite(b[k]))||
    !Array.isArray(d.centroid)||d.centroid.length!==2||!d.centroid.every(Number.isFinite)||
    !Number.isFinite(d.area)||d.area<=0||!Array.isArray(d.polygons))return null;
  const x=Math.max(0,b.x1),y=Math.max(0,b.y1),right=Math.min(w,b.x2),bottom=Math.min(h,b.y2);
  if(right-x<6||bottom-y<6||d.centroid[0]<0||d.centroid[0]>=w||d.centroid[1]<0||d.centroid[1]>=h)return null;
  const polygons=d.polygons.filter(p=>Array.isArray(p)&&p.length>=3&&p.every(q=>Array.isArray(q)&&q.length===2&&q.every(Number.isFinite))).slice(0,8).map(p=>p.slice(0,400));
  if(!polygons.length)return null;
  return {id:String(d.id),box:{x,y,width:right-x,height:bottom-y},centroid:{x:d.centroid[0],y:d.centroid[1]},area:d.area,polygons,color_rgb:d.color_rgb};
}

/** Tests can inject transport and tracker implementations; production uses
 * the actual HTTP endpoint and the existing measured-pixel tracker. */
export class SamObserver{
  constructor({endpoint='/api/sam/segment',onUpdate=()=>{},concept='ball',sourceKind='synthetic',
    fetcher=(...args)=>fetch(...args),trackerFactory=createSamTracker,trackerOptions={},
    minSamIntervalS=3,maxRequests=MAX_REQUESTS,maxTracks=3,maxBufferedFrames=80,maxBufferSeconds=8,
    maxSamAgeS=8,horizon=.5,issueIntervalS=.1}={}){
    if(typeof onUpdate!=='function'||typeof fetcher!=='function'||typeof trackerFactory!=='function')throw new TypeError('Observer callbacks must be functions.');
    for(const [key,value] of Object.entries({minSamIntervalS,maxRequests,maxTracks,maxBufferedFrames,maxBufferSeconds,maxSamAgeS,horizon,issueIntervalS})){
      if(!Number.isFinite(value)||value<=0)throw new TypeError('Invalid '+key);
    }
    this.endpoint=endpoint;this.onUpdate=onUpdate;this.concept=concept;this.sourceKind=sourceKind;this.fetcher=fetcher;this.trackerFactory=trackerFactory;
    this.trackerOptions={maxDimension:320,templateSize:12,searchRadiusPx:14,maxSearchRadiusPx:28,...trackerOptions};
    this.minSamIntervalS=Math.max(.5,minSamIntervalS);this.maxRequests=Math.min(MAX_REQUESTS,Math.floor(maxRequests));
    this.maxTracks=Math.min(3,Math.floor(maxTracks));this.maxBufferedFrames=Math.min(80,Math.floor(maxBufferedFrames));
    this.maxBufferSeconds=Math.min(10,maxBufferSeconds);this.maxSamAgeS=Math.max(this.minSamIntervalS,maxSamAgeS);
    this.horizon=Math.min(.75,horizon);this.issueIntervalS=Math.max(.1,issueIntervalS);
    this.epoch=0;this.sessionCalls=0;this.sessionAccepted=0;this.history=[];this.active=false;this.pending=null;this.runId=null;
    this._clearRun();
  }
  _clearRun(){
    this.frames=[];this.tracks=[];this.samRecords=[];this.observations=[];this.issued=[];this.assessments=[];
    this.timeS=null;this.width=0;this.height=0;this.runHorizon=this.horizon;this.lastSamRequestTime=-Infinity;this.retryAtSourceTime=-Infinity;this.latestSam=null;this.trackSerial=0;
    this.requestBlocked=false;this.runCalls=0;this.lateSamResponses=0;this.busyResponses=0;this.lastError=null;this.status='idle';this.message='Start a new scene to let SAM observe it.';
  }
  start(options={}){return this.reset(options);}
  reset({runId,sourceKind=this.sourceKind,concept=this.concept}={}){
    validateRun({runId,sourceKind,concept});
    if(this.runId){this._invalidateTracks('run_changed');this.history.push(this._runEvidence());if(this.history.length>12)this.history.shift();}
    this.epoch++;this.pending?.controller.abort();this.pending=null;this._clearRun();
    this.runId=runId;this.sourceKind=sourceKind;this.concept=concept.trim();this.active=true;
    this.status='waiting_for_frame';this.message='SAM has not observed this scene yet. No prediction is available.';
    return this._emit();
  }
  stop(){
    this.active=false;this.epoch++;this.pending?.controller.abort();this.pending=null;
    this._invalidateTracks('observation_stopped');this.frames=[];this.status='stopped';this.message='Observation stopped. Existing evidence is retained.';
    return this._emit();
  }
  pushFrame(input){
    validateFrame(input);
    if(!this.active||input.runId!==this.runId)return false;
    if(this.timeS!==null&&input.t<=this.timeS)return false;
    const im=input.imageData;
    if(this.width&&(im.width!==this.width||im.height!==this.height))throw new TypeError('Reset the observer after changing frame dimensions.');
    this.width=im.width;this.height=im.height;this.timeS=input.t;
    const frame={imageData:{width:im.width,height:im.height,data:new Uint8ClampedArray(im.data)},t:input.t,frameId:input.frameId,imageBase64:input.imageBase64,runId:input.runId};
    this.frames.push(frame);
    while(this.frames.length>this.maxBufferedFrames||this.timeS-this.frames[0].t>this.maxBufferSeconds)this.frames.shift();
    if(this.latestSam&&this.timeS-this.latestSam.sourceTimeS>this.maxSamAgeS&&this.tracks.length){
      this._invalidateTracks('sam_anchor_expired');this.status='sam_stale';this.message='The SAM observation is too old. Waiting for a new segmentation.';
    }
    for(const track of this.tracks)this._observeTrack(track,frame);
    this._scorePending();
    this._issuePredictions();
    if(this.tracks.length&&!this.requestBlocked){
      const seen=this.tracks.some(t=>t.status==='tracking');
      this.status=seen?'tracking':'tracking_lost';
      this.message=seen?'SAM anchors the objects. Local tracking and prediction use only captured pixels.':'Object tracking is uncertain. Waiting for a fresh SAM segmentation.';
    }
    if(!this.pending&&!this.requestBlocked&&this.sessionCalls<this.maxRequests&&this.timeS>=this.retryAtSourceTime&&this.timeS-this.lastSamRequestTime>=this.minSamIntervalS)this._requestSam(frame);
    else if(this.sessionCalls>=this.maxRequests&&!this.pending&&!this.tracks.length){this.status='request_limit';this.message='The bounded SAM session is complete. No unsegmented fallback is used.';}
    this._emit();
    return true;
  }
  _observeTrack(track,frame){
    if(frame.t<=track.lastTime)return;
    const measured=track.tracker.update(frame.imageData,frame.t);track.lastTime=frame.t;
    this._recordObservation(track,measured,frame);
  }
  _recordObservation(track,result,frame,{anchor=false}={}){
    track.status=result.status;track.point=finitePoint(result.point)?{...result.point}:null;track.box=result.box?{...result.box}:null;
    track.confidence=Number.isFinite(result.confidence)?result.confidence:0;track.reason=result.reason;
    const entry=freeze({t:frame.t,frameId:frame.frameId,runId:this.runId,sourceKind:this.sourceKind,trackId:track.id,point:track.point?{...track.point}:null,
      box:track.box?{...track.box}:null,status:track.status,confidence:track.confidence,reason:track.reason,
      source:anchor?'sam_mask_anchor':'local_appearance_tracking',samRequestId:track.receipt.request_id,identityGuaranteed:false,units:'px'});
    track.observations.push(entry);this.observations.push(entry);
    if(track.observations.length>150)track.observations.shift();
    if(track.status!=='tracking')track.prediction=null;
  }
  _issuePredictions(){
    for(const track of this.tracks){
      if(track.status!=='tracking'||this.timeS-track.lastIssue<this.issueIntervalS-1e-8)continue;
      const prediction=forecast(track.observations,{sourceTime:this.timeS,horizon:this.horizon,maxAge:.12});
      track.prediction=prediction.status==='predicted'?prediction:null;
      if(prediction.status!=='predicted')continue;
      // Catch-up observations can be backfilled, but an issued forecast always
      // starts at the current observed frame and targets an unseen later time.
      if(prediction.targetTime<=this.timeS||prediction.usedTimes.some(t=>t>this.timeS))throw new Error('A forecast attempted to use a future observation.');
      const issued=freeze({...clone(prediction),id:this.runId+':'+(this.issued.length+1),runId:this.runId,sourceKind:this.sourceKind,trackId:track.id,
        issuedAtSourceTimeS:this.timeS,issuedAtWallTime:new Date().toISOString(),samRequestId:track.receipt.request_id,
        provenance:'SAM 3.1 segmentation anchor + local pixel tracking + kinematic forecast',onTime:true});
      track.lastIssue=this.timeS;track.prediction=issued;this.issued.push(issued);
    }
  }
  _scorePending(){
    const assessed=new Set(this.assessments.map(a=>a.predictionId));
    for(const prediction of this.issued){
      if(assessed.has(prediction.id))continue;
      const track=this.tracks.find(t=>t.id===prediction.trackId);if(!track)continue;
      const assessment=assessForecast(prediction,track.observations,{availableTime:this.timeS,maxBracketGap:.3});
      if(!assessment)continue;
      const entry=freeze({...clone(assessment),predictionId:prediction.id,trackId:prediction.trackId,runId:this.runId,sourceKind:this.sourceKind,
        scoredAtSourceTimeS:this.timeS,measurementSource:'subsequent_local_pixel_tracking',independentPhysicalGroundTruth:false});
      this.assessments.push(entry);track.lastAssessment=entry;
    }
  }
  _invalidateTracks(reason){
    const assessed=new Set(this.assessments.map(a=>a.predictionId));
    for(const prediction of this.issued)if(!assessed.has(prediction.id))this.assessments.push(freeze({
      status:'unscorable',reason,errorPx:null,predictionId:prediction.id,trackId:prediction.trackId,runId:this.runId,sourceKind:this.sourceKind,
      sourceTime:prediction.sourceTime,targetTime:prediction.targetTime,scoredAtSourceTimeS:this.timeS,units:'px'}));
    this.tracks=[];
  }
  async _requestSam(frame){
    const token={epoch:this.epoch,controller:new AbortController()},epoch=this.epoch;
    this.pending=token;this.lastSamRequestTime=frame.t;
    if(!this.tracks.length){this.status='segmenting';this.message='SAM 3.1 is observing a captured image. No hidden physics state is sent.';}
    try{
      const imageSha=await digestBase64(frame.imageBase64);
      if(epoch!==this.epoch||!this.active)return;
      const body={image_base64:frame.imageBase64,concept:this.concept,frame_id:frame.frameId,source_time_s:frame.t,run_id:frame.runId,source_kind:this.sourceKind};
      this.sessionCalls++;this.runCalls++;
      const response=await this.fetcher(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:token.controller.signal});
      const result=await response.json();
      if(epoch!==this.epoch||!this.active)return;
      // A browser abort does not cancel a provider call already executing on
      // the server. Only this explicit, pre-provider busy response is retried;
      // provider failures and exhausted budgets remain blocked.
      if(response.status===429&&result?.code==='sam_busy'&&result.provider_call_made===false){
        this.busyResponses++;this.retryAtSourceTime=this.timeS+Math.max(1,Math.min(5,Number(result.retry_after_s)||1));
        this.status='sam_busy';this.message='SAM is busy. Waiting to submit a new image.';return;
      }
      if(!response.ok)throw new Error(result?.error||'SAM service returned HTTP '+response.status);
      this._acceptSam(result,frame,imageSha);
    }catch(error){
      if(epoch!==this.epoch||!this.active||error?.name==='AbortError')return;
      this.requestBlocked=true;this.lastError=String(error?.message||'SAM observation failed').slice(0,300);
      this._invalidateTracks('sam_unavailable');this.status='sam_unavailable';this.message=this.lastError;
    }finally{
      if(this.pending===token)this.pending=null;
      if(epoch===this.epoch)this._emit();
    }
  }
  _acceptSam(result,submitted,imageSha){
    if(result?.model!=='sam-3.1'||result.run_id!==this.runId||result.frame_id!==submitted.frameId||
      !Number.isFinite(result.source_time_s)||Math.abs(result.source_time_s-submitted.t)>1e-8||
      result.width!==submitted.imageData.width||result.height!==submitted.imageData.height||
      result.image_sha256!==imageSha||!hex64(result.image_sha256)||!Array.isArray(result.detections)||
      result.receipt?.model!=='sam-3.1'||typeof result.receipt.request_id!=='string'||!result.receipt.request_id||
      !hex64(result.receipt.request_sha256))throw new Error('SAM response does not match the submitted image and receipt.');
    const record=freeze({runId:this.runId,sourceKind:this.sourceKind,frameId:submitted.frameId,sourceTimeS:submitted.t,imageSha256:imageSha,model:result.model,
      receipt:clone(result.receipt),latencyMs:Number.isFinite(result.latency_ms)?result.latency_ms:null,chargedUsd:result.charged_usd,
      receivedAtSourceTimeS:this.timeS,receivedAtWallTime:new Date().toISOString(),detectedCount:result.detections.length,
      width:result.width,height:result.height,evidenceId:result.evidence_id||null,evidence:result.evidence?clone(result.evidence):null,
      budget:result.budget?clone(result.budget):null});
    this.samRecords.push(record);this.sessionAccepted++;
    const anchor=this.frames.find(f=>f.frameId===submitted.frameId&&f.t===submitted.t);
    if(!anchor||this.timeS-submitted.t>this.maxBufferSeconds){this.lateSamResponses++;this.status='sam_response_too_old';this.message='SAM responded after the pixel buffer expired. That response cannot start a forecast.';return;}
    this._scorePending();this._invalidateTracks('sam_reseed');this.latestSam={...record,imageSha:record.imageSha256,sourceTimeS:record.sourceTimeS};
    const detections=result.detections.map(d=>normalizedDetection(d,result.width,result.height)).filter(Boolean).sort((a,b)=>b.area-a.area).slice(0,this.maxTracks);
    for(const [index,d] of detections.entries()){
      const tracker=this.trackerFactory({...this.trackerOptions,samMaskPolygons:d.polygons}),selected=tracker.select(anchor.imageData,d.box,anchor.t);
      if(selected.status!=='tracking')continue;
      // The SAM mask's centroid initializes position. The local tracker follows
      // its appearance box; translating that box preserves the centroid offset.
      const offset={x:d.centroid.x-selected.point.x,y:d.centroid.y-selected.point.y};
      const adjust=r=>r?.point?{...r,point:{x:r.point.x+offset.x,y:r.point.y+offset.y}}:r;
      const track={id:this.runId+':track-'+(++this.trackSerial),samId:d.id,tracker:{update:(im,t)=>adjust(tracker.update(im,t))},
        receipt:clone(result.receipt),samTimeS:anchor.t,samPolygons:d.polygons,color:sourceColor(d,index),observations:[],
        prediction:null,lastAssessment:null,lastIssue:-Infinity,lastTime:anchor.t,status:'tracking',point:null,box:null,confidence:0};
      this._recordObservation(track,adjust(selected),anchor,{anchor:true});
      for(const past of this.frames)if(past.t>anchor.t)this._observeTrack(track,past);
      this.tracks.push(track);
    }
    this.status=this.tracks.length?'tracking':'no_match';
    this.message=this.tracks.length?'SAM found the objects. Local pixel tracking bridges SAM updates; forecasts use past motion only.':'SAM returned no usable segmented object. No substitute detector is used.';
    this._issuePredictions();
  }
  _runEvidence(){
    return clone({runId:this.runId,sourceKind:this.sourceKind,concept:this.concept,horizonS:this.runHorizon,width:this.width,height:this.height,timeS:this.timeS,
      samRecords:this.samRecords,observations:this.observations,issued:this.issued,assessments:this.assessments,runCalls:this.runCalls,lateSamResponses:this.lateSamResponses,busyResponses:this.busyResponses});
  }
  exportEvidence(){
    return {schema_version:'twinforge.sam-observer.v1',exportedAt:new Date().toISOString(),sessionCalls:this.sessionCalls,sessionAccepted:this.sessionAccepted,
      current:this._runEvidence(),previousRuns:clone(this.history),units:'px',perception:'SAM 3.1 keyframes; local appearance tracking between SAM responses',
      prediction:'Causal short-horizon kinematic fit of past measured pixels, not a SAM motion-prediction capability.',
      hiddenSimulationStateConsumed:false,physicalGroundTruthUsed:false,
      limitations:['SAM input is an image and an object prompt, never simulator positions, velocities, forces, masses or seed.',
        'The forecast is frozen before its target capture time; delayed SAM responses are caught up from previously observed pixels.',
        'Scores compare forecasts with subsequent tracked image positions, not independently measured physical coordinates.',
        'Occlusion, motion changes, camera motion and ambiguous identity can make a forecast unavailable or wrong.',
        'Random 3D simulations are observed in their two-dimensional camera image; no metric 3D reconstruction is claimed.']};
  }
  snapshot(){
    const scored=this.assessments.filter(a=>a.status==='scored'&&Number.isFinite(a.errorPx));
    const tracks=this.tracks.map(t=>{
      const own=scored.filter(a=>a.trackId===t.id);
      return {id:t.id,samId:t.samId,point:t.point?{...t.point}:null,box:t.box?{...t.box}:null,color:t.color,confidence:t.confidence,status:t.status,reason:t.reason,
        prediction:t.prediction?clone(t.prediction):null,lastAssessment:t.lastAssessment?clone(t.lastAssessment):null,
        recentTrail:t.observations.filter(o=>finitePoint(o.point)).slice(-20).map(o=>({t:o.t,...o.point})),
        pendingTargets:this.issued.filter(p=>p.trackId===t.id&&p.targetTime>this.timeS).map(p=>({id:p.id,point:{...p.point},sourceTime:p.sourceTime,targetTime:p.targetTime})),
        meanErrorPx:own.length?own.reduce((s,a)=>s+a.errorPx,0)/own.length:null,scoredCount:own.length,samPolygons:clone(t.samPolygons),samTimeS:t.samTimeS};
    });
    return {active:this.active,status:this.status,providerStatus:this.status,message:this.message,runId:this.runId,sourceKind:this.sourceKind,concept:this.concept,
      width:this.width,height:this.height,timeS:this.timeS,samCalls:this.sessionCalls,runSamCalls:this.runCalls,samAccepted:this.sessionAccepted,samPending:Boolean(this.pending),
      latestSam:this.latestSam?clone(this.latestSam):null,tracks,issuedCount:this.issued.length,scoredCount:scored.length,
      unscorableCount:this.assessments.filter(a=>a.status==='unscorable').length,observationsCount:this.observations.length,
      meanErrorPx:scored.length?scored.reduce((s,a)=>s+a.errorPx,0)/scored.length:null,lateSamResponses:this.lateSamResponses,busyResponses:this.busyResponses,
      maxRequests:this.maxRequests,lastError:this.lastError,provenance:'SAM 3.1 + local pixel tracking + kinematic prediction'};
  }
  _emit(){const value=this.snapshot();this.onUpdate(value);return value;}
}
export const createSamObserver=options=>new SamObserver(options);
