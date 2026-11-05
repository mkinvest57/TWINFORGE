/**
 * A pixel-only observer. SAM 3.1 supplies each track's segmentation anchor;
 * local appearance tracking bridges SAM keyframes. A separate kinematic
 * predictor uses only past measured pixels. No simulator state is accepted.
 */
import {createSamTracker} from './sam-tracker.mjs';
import {assessForecast,PREDICTION_DEFAULTS} from '../camera/prediction.mjs';
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
const pointDistance=(a,b)=>finitePoint(a)&&finitePoint(b)?Math.hypot(a.x-b.x,a.y-b.y):Infinity;
const boxScale=box=>box?Math.hypot(box.width,box.height):0;
/** Association is deliberately conservative and uses two observed images:
 * the submitted SAM image and the most recent captured image. No object IDs
 * from the scene, velocity, renderer palette or future position are used. */
function compatibleAnchor(old,candidate,anchorTime){
  if(old.status!=='tracking'||candidate.status!=='tracking')return false;
  const atAnchor=old.observations.find(o=>Math.abs(o.t-anchorTime)<1e-8);
  if(atAnchor?.status!=='tracking'||old.observations.some(o=>o.t>=anchorTime&&o.status!=='tracking'))return false;
  const tolerance=Math.max(4,Math.min(boxScale(atAnchor.box),boxScale(candidate.anchorBox))*.38);
  const currentTolerance=Math.max(4,Math.min(boxScale(old.box),boxScale(candidate.box))*.38);
  const ratio=(candidate.anchorBox.width*candidate.anchorBox.height)/Math.max(1,atAnchor.box?.width*atAnchor.box?.height);
  return ratio>.45&&ratio<2.2&&pointDistance(atAnchor.point,candidate.anchorPoint)<=tolerance&&pointDistance(old.point,candidate.point)<=currentTolerance;
}

/** Tests can inject transport and tracker implementations; production uses
 * the actual HTTP endpoint and the existing measured-pixel tracker. */
export class SamObserver{
  constructor({endpoint='/api/sam/segment',onUpdate=()=>{},concept='ball',sourceKind='synthetic',
    fetcher=(...args)=>fetch(...args),trackerFactory=createSamTracker,trackerOptions={},
    minSamIntervalS=3,maxRequests=MAX_REQUESTS,maxTracks=3,maxBufferedFrames=80,maxBufferSeconds=8,
    maxSamAgeS=8,horizon=.5,issueIntervalS=.1,requestTimeoutMs=25000,now=()=>Date.now()}={}){
    if(typeof onUpdate!=='function'||typeof fetcher!=='function'||typeof trackerFactory!=='function'||typeof now!=='function')throw new TypeError('Observer callbacks must be functions.');
    for(const [key,value] of Object.entries({minSamIntervalS,maxRequests,maxTracks,maxBufferedFrames,maxBufferSeconds,maxSamAgeS,horizon,issueIntervalS,requestTimeoutMs})){
      if(!Number.isFinite(value)||value<=0)throw new TypeError('Invalid '+key);
    }
    this.endpoint=endpoint;this.onUpdate=onUpdate;this.concept=concept;this.sourceKind=sourceKind;this.fetcher=fetcher;this.trackerFactory=trackerFactory;
    this.trackerOptions={maxDimension:320,templateSize:12,searchRadiusPx:14,maxSearchRadiusPx:28,...trackerOptions};
    this.minSamIntervalS=Math.max(.5,minSamIntervalS);this.maxRequests=Math.min(MAX_REQUESTS,Math.floor(maxRequests));
    this.maxTracks=Math.min(3,Math.floor(maxTracks));this.maxBufferedFrames=Math.min(80,Math.floor(maxBufferedFrames));
    this.maxBufferSeconds=Math.min(10,maxBufferSeconds);this.maxSamAgeS=Math.max(this.minSamIntervalS,maxSamAgeS);
    this.horizon=Math.min(.75,horizon);this.issueIntervalS=Math.max(.1,issueIntervalS);
    this.requestTimeoutMs=Math.max(1000,Math.min(45000,requestTimeoutMs));this.now=now;
    this.epoch=0;this.sessionCalls=0;this.httpAttempts=0;this.sessionAccepted=0;this.history=[];this.active=false;this.pending=null;this.runId=null;
    this._clearRun();
  }
  _clearRun(){
    this.frames=[];this.tracks=[];this.samRecords=[];this.observations=[];this.issued=[];this.assessments=[];this.tickets=[];this.revalidations=[];
    this.timeS=null;this.width=0;this.height=0;this.runHorizon=this.horizon;this.lastSamRequestTime=-Infinity;this.retryAtSourceTime=-Infinity;
    this.retryAtWallTime=-Infinity;this.retryableBusy=false;this.latestSam=null;this.trackSerial=0;
    this.requestBlocked=false;this.runCalls=0;this.lateSamResponses=0;this.busyResponses=0;this.lastError=null;this.status='idle';this.message='Start a new scene to let SAM observe it.';
  }
  start(options={}){return this.reset(options);}
  reset({runId,sourceKind=this.sourceKind,concept=this.concept}={}){
    validateRun({runId,sourceKind,concept});
    if(this.runId){this._invalidateTracks('run_changed');this.history.push(this._runEvidence());if(this.history.length>12)this.history.shift();}
    // Aborting a paid POST does not cancel its provider work. Keep its one
    // transport slot alive; the epoch guard discards a previous run's result.
    this.epoch++;this._clearRun();
    this.runId=runId;this.sourceKind=sourceKind;this.concept=concept.trim();this.active=true;
    this.status='waiting_for_frame';this.message='SAM has not observed this scene yet. No prediction is available.';
    return this._emit();
  }
  stop(){
    this.active=false;this.epoch++;
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
    const expired=this.tracks.filter(t=>this.timeS-t.samTimeS>this.maxSamAgeS).map(t=>t.id);
    if(expired.length){
      this._invalidateTracks('sam_anchor_expired',expired);this.status='sam_stale';this.message='The SAM observation is too old. Waiting for a new segmentation.';
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
  _observeTrack(track,frame,{record=true}={}){
    if(frame.t<=track.lastTime)return;
    const measured=track.tracker.update(frame.imageData,frame.t);track.lastTime=frame.t;
    this._recordObservation(track,measured,frame,{record});
  }
  _recordObservation(track,result,frame,{anchor=false,record=true}={}){
    track.status=result.status;track.point=finitePoint(result.point)?{...result.point}:null;track.box=result.box?{...result.box}:null;
    track.confidence=Number.isFinite(result.confidence)?result.confidence:0;track.reason=result.reason;
    const entry=freeze({t:frame.t,frameId:frame.frameId,runId:this.runId,sourceKind:this.sourceKind,trackId:track.id,point:track.point?{...track.point}:null,
      box:track.box?{...track.box}:null,status:track.status,confidence:track.confidence,reason:track.reason,
      source:anchor?'sam_mask_anchor':'local_appearance_tracking',samRequestId:track.receipt.request_id,identityGuaranteed:false,units:'px'});
    track.observations.push(entry);if(record)this.observations.push(entry);
    if(track.observations.length>150)track.observations.shift();
    if(track.status!=='tracking'){track.prediction=null;track.forecastStatus='refused';track.forecastReason=result.reason;}
  }
  _issuePredictions({force=false}={}){
    for(const track of this.tracks){
      if(track.status!=='tracking'||Math.abs(this.timeS-track.lastIssue)<1e-8||(!force&&this.timeS-track.lastIssue<this.issueIntervalS-1e-8))continue;
      const prediction=forecast(track.observations,{sourceTime:this.timeS,horizon:this.horizon,maxAge:.12});
      track.forecastStatus=prediction.status;track.forecastReason=prediction.reason;track.forecastSampleCount=prediction.diagnostics?.sampleCount??0;
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
  /** A paused synthetic scene cannot advance its capture clock to retry a
   * busy service. Re-submit exactly the last image only if it was explicitly
   * refused before provider work, or if a previous run occupied the slot and
   * this run's first image has never been submitted. No observation is added. */
  retryPendingFrame(){
    if(!this.active||this.pending||this.requestBlocked||this.sessionCalls>=this.maxRequests)return false;
    const initialUnsubmitted=this.runCalls===0&&this.lastSamRequestTime===-Infinity&&!this.samRecords.length;
    if(!initialUnsubmitted&&(!this.retryableBusy||this.now()<this.retryAtWallTime))return false;
    const frame=this.frames.at(-1);if(!frame)return false;
    this._requestSam(frame);this._emit();return true;
  }
  /** Lock an already causal forecast for the UI's blind reveal. This method
   * consumes no image, no provider call and no simulator state. Its return is
   * a detached copy; future scoring cannot move the locked target. */
  lockPrediction({trackId=null}={}){
    if(!this.active)return null;
    this._issuePredictions({force:true});
    const track=this.tracks.find(t=>(trackId===null||t.id===trackId)&&t.status==='tracking'&&t.prediction?.targetTime>this.timeS&&Math.abs(t.prediction.sourceTime-this.timeS)<1e-8);
    if(!track)return null;
    const p=track.prediction;
    const ticket=freeze({id:this.runId+':ticket-'+(this.tickets.length+1),runId:this.runId,sourceKind:this.sourceKind,
      trackId:track.id,sourceTime:p.sourceTime,targetTime:p.targetTime,horizon:p.horizon,point:clone(p.point),originPoint:{...track.point},
      predictionId:p.id,lockedAtSourceTimeS:this.timeS,lockedAtWallTime:new Date().toISOString(),
      sourceFrameId:track.observations.at(-1)?.frameId??null,anchorPoint:{...track.point},prediction:clone(p)});
    this.tickets.push(ticket);this._emit();return this._ticketSnapshot(ticket);
  }
  _ticketSnapshot(ticket){
    if(!ticket)return null;
    const assessment=this.assessments.find(a=>a.predictionId===ticket.predictionId);
    return {...clone(ticket),status:assessment?.status??'locked',assessment:assessment?clone(assessment):null,
      outcome:assessment?.status==='scored'?{observedPoint:clone(assessment.actual),errorPx:assessment.errorPx,observedTime:assessment.targetTime,
        frameId:assessment.bracketFrameIds?.at(-1)??null,bracketTimes:clone(assessment.bracketTimes),bracketFrameIds:clone(assessment.bracketFrameIds??[])}:null};
  }
  _scorePending(){
    const assessed=new Set(this.assessments.map(a=>a.predictionId));
    for(const prediction of this.issued){
      if(assessed.has(prediction.id))continue;
      const track=this.tracks.find(t=>t.id===prediction.trackId);if(!track)continue;
      const assessment=assessForecast(prediction,track.observations,{availableTime:this.timeS,maxBracketGap:.3});
      if(!assessment)continue;
      const entry=freeze({...clone(assessment),predictionId:prediction.id,trackId:prediction.trackId,runId:this.runId,sourceKind:this.sourceKind,
        scoredAtSourceTimeS:this.timeS,bracketFrameIds:assessment.bracketTimes?.map(t=>track.observations.find(o=>Math.abs(o.t-t)<1e-8)?.frameId??null)??[],
        measurementSource:'subsequent_local_pixel_tracking',independentPhysicalGroundTruth:false});
      this.assessments.push(entry);track.lastAssessment=entry;
    }
  }
  _invalidateTracks(reason,trackIds=null){
    const assessed=new Set(this.assessments.map(a=>a.predictionId));
    const invalidate=trackIds?new Set(trackIds):null;
    for(const prediction of this.issued)if(!assessed.has(prediction.id)&&(!invalidate||invalidate.has(prediction.trackId)))this.assessments.push(freeze({
      status:'unscorable',reason,errorPx:null,predictionId:prediction.id,trackId:prediction.trackId,runId:this.runId,sourceKind:this.sourceKind,
      sourceTime:prediction.sourceTime,targetTime:prediction.targetTime,scoredAtSourceTimeS:this.timeS,units:'px'}));
    this.tracks=invalidate?this.tracks.filter(t=>!invalidate.has(t.id)):[];
  }
  async _requestSam(frame){
    const token={epoch:this.epoch,controller:new AbortController()},epoch=this.epoch;let timeout=null,timedOut=false;
    this.pending=token;this.lastSamRequestTime=frame.t;this.retryableBusy=false;
    if(!this.tracks.length){this.status='segmenting';this.message='SAM 3.1 is observing a captured image. No hidden physics state is sent.';}
    try{
      const imageSha=await digestBase64(frame.imageBase64);
      if(epoch!==this.epoch||!this.active)return;
      const body={image_base64:frame.imageBase64,concept:this.concept,frame_id:frame.frameId,source_time_s:frame.t,run_id:frame.runId,source_kind:this.sourceKind};
      this.sessionCalls++;this.httpAttempts++;this.runCalls++;
      timeout=setTimeout(()=>{timedOut=true;token.controller.abort();},this.requestTimeoutMs);
      const response=await this.fetcher(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:token.controller.signal});
      const result=await response.json();
      const explicitlyUnbilled=!response.ok&&result?.provider_call_made===false;
      const unbilledBusy=response.status===429&&result?.code==='sam_busy'&&explicitlyUnbilled;
      if(explicitlyUnbilled){
        this.sessionCalls--;
        if(epoch===this.epoch)this.runCalls--;
        else{
          const archived=this.history.findLast(run=>run.runId===frame.runId);
          if(archived){archived.runCalls=Math.max(0,archived.runCalls-1);if(unbilledBusy)archived.busyResponses++;}
        }
      }
      if(epoch!==this.epoch||!this.active)return;
      // A browser abort does not cancel a provider call already executing on
      // the server. Only this explicit, pre-provider busy response is retried;
      // provider failures and exhausted budgets remain blocked.
      if(unbilledBusy){
        const retryAfterS=Math.max(1,Math.min(5,Number(result.retry_after_s)||1));
        this.busyResponses++;this.retryAtSourceTime=this.timeS+retryAfterS;
        this.retryAtWallTime=this.now()+retryAfterS*1000;this.retryableBusy=true;
        this.status='sam_busy';this.message='SAM is busy. Waiting to submit a new image.';return;
      }
      if(!response.ok)throw new Error(result?.error||'SAM service returned HTTP '+response.status);
      this._acceptSam(result,frame,imageSha);
    }catch(error){
      if(epoch!==this.epoch||!this.active)return;
      this.requestBlocked=true;this.lastError=timedOut?'SAM did not respond within the request deadline. Start again to retry.':String(error?.message||'SAM observation failed').slice(0,300);
      this._invalidateTracks('sam_unavailable');this.status='sam_unavailable';this.message=this.lastError;
    }finally{
      if(timeout!==null)clearTimeout(timeout);
      if(this.pending===token)this.pending=null;
      this._emit();
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
    this._scorePending();this.latestSam={...record,imageSha:record.imageSha256,sourceTimeS:record.sourceTimeS};
    const detections=result.detections.map(d=>normalizedDetection(d,result.width,result.height)).filter(Boolean).sort((a,b)=>b.area-a.area).slice(0,this.maxTracks);
    const candidates=[];
    for(const [index,d] of detections.entries()){
      const tracker=this.trackerFactory({...this.trackerOptions,samMaskPolygons:d.polygons}),selected=tracker.select(anchor.imageData,d.box,anchor.t);
      if(selected.status!=='tracking')continue;
      // The SAM mask's centroid initializes position. The local tracker follows
      // its appearance box; translating that box preserves the centroid offset.
      const offset={x:d.centroid.x-selected.point.x,y:d.centroid.y-selected.point.y};
      const adjust=r=>r?.point?{...r,point:{x:r.point.x+offset.x,y:r.point.y+offset.y}}:r;
      const track={id:null,samId:d.id,tracker:{update:(im,t)=>adjust(tracker.update(im,t))},
        receipt:clone(result.receipt),samTimeS:anchor.t,samPolygons:d.polygons,color:sourceColor(d,index),observations:[],
        anchorPoint:{...d.centroid},anchorBox:{...d.box},prediction:null,lastAssessment:null,lastIssue:-Infinity,lastTime:anchor.t,status:'tracking',point:null,box:null,confidence:0};
      this._recordObservation(track,adjust(selected),anchor,{anchor:true,record:false});
      for(const past of this.frames)if(past.t>anchor.t)this._observeTrack(track,past,{record:false});
      candidates.push(track);
    }
    // A no-match refresh cannot erase an otherwise continuous visual track.
    // Its previous SAM anchor still expires on its own source timestamp.
    if(candidates.length){
      const previous=this.tracks,links=candidates.map(c=>previous.filter(t=>compatibleAnchor(t,c,anchor.t)));
      const retained=new Set(),next=[];
      for(const [index,candidate] of candidates.entries()){
        const match=links[index].length===1&&links.filter(list=>list.includes(links[index][0])).length===1?links[index][0]:null;
        if(match){
          const agreement=pointDistance(match.point,candidate.point),previousRequestId=match.receipt.request_id;
          Object.assign(match,{tracker:candidate.tracker,receipt:candidate.receipt,samTimeS:candidate.samTimeS,samPolygons:candidate.samPolygons,
            samId:candidate.samId,color:candidate.color});
          // Existing observations and issued targets remain byte-for-byte
          // unchanged. The replacement tracker only measures future frames.
          this.revalidations.push(freeze({trackId:match.id,sourceKind:this.sourceKind,runId:this.runId,sourceTimeS:anchor.t,
            sourceFrameId:anchor.frameId,confirmedAtSourceTimeS:this.timeS,samRequestId:result.receipt.request_id,previousSamRequestId:previousRequestId,
            agreementPx:agreement,method:'unique_observed_anchor_and_current_pixel_match',identityGuaranteed:false}));
          retained.add(match.id);next.push(match);
        }else{
          candidate.id=this.runId+':track-'+(++this.trackSerial);
          candidate.observations=candidate.observations.map(o=>freeze({...o,trackId:candidate.id}));
          this.observations.push(...candidate.observations);next.push(candidate);
        }
      }
      this._invalidateTracks('sam_identity_changed',previous.filter(t=>!retained.has(t.id)).map(t=>t.id));
      this.tracks=next;
    }
    const hasTracking=this.tracks.some(t=>t.status==='tracking');
    this.status=hasTracking?'tracking':this.tracks.length?'tracking_lost':'no_match';
    this.message=hasTracking?(candidates.length?'SAM confirmed the objects. Existing motion history and frozen forecasts are retained when identity agrees.':'SAM found no fresh mask. Previously anchored visual tracks continue only until their SAM anchor expires.'):
      this.tracks.length?'The observed object could not be followed reliably. Waiting for a fresh SAM segmentation.':'SAM returned no usable segmented object. No substitute detector is used.';
    this._issuePredictions();
  }
  _runEvidence(){
    return clone({runId:this.runId,sourceKind:this.sourceKind,concept:this.concept,horizonS:this.runHorizon,width:this.width,height:this.height,timeS:this.timeS,
      samRecords:this.samRecords,observations:this.observations,issued:this.issued,assessments:this.assessments,tickets:this.tickets.map(t=>this._ticketSnapshot(t)),revalidations:this.revalidations,
      runCalls:this.runCalls,lateSamResponses:this.lateSamResponses,busyResponses:this.busyResponses});
  }
  exportEvidence(){
    return {schema_version:'twinforge.sam-observer.v1',exportedAt:new Date().toISOString(),sessionCalls:this.sessionCalls,httpAttempts:this.httpAttempts,sessionAccepted:this.sessionAccepted,
      current:this._runEvidence(),previousRuns:clone(this.history),units:'px',perception:'SAM 3.1 keyframes; local appearance tracking between SAM responses',
      prediction:'Causal short-horizon kinematic fit of past measured pixels, not a SAM motion-prediction capability.',
      hiddenSimulationStateConsumed:false,physicalGroundTruthUsed:false,
      limitations:['SAM input is an image and an object prompt, never simulator positions, velocities, forces, masses or seed.',
        'The forecast is frozen before its target capture time; delayed SAM responses are caught up from previously observed pixels.',
        'Scores compare forecasts with subsequent tracked image positions, not independently measured physical coordinates.',
        'Occlusion, motion changes, camera motion and ambiguous identity can make a forecast unavailable or wrong.',
        'Random 3D simulations are observed in their two-dimensional camera image; no metric 3D reconstruction is claimed.']};
  }
  _forecastReadiness(){
    const common={minSamples:PREDICTION_DEFAULTS.minSamples,sampleCount:Math.max(0,...this.tracks.map(t=>t.forecastSampleCount??0))};
    if(!this.active)return {...common,state:'stopped',message:'Start observation to discover the objects and their motion.'};
    if(this.tracks.some(t=>t.status==='tracking'&&t.prediction?.targetTime>this.timeS))return {...common,state:'ready',message:'Forecast ready. Lock its target before revealing the outcome.'};
    if(!this.tracks.length)return {...common,state:this.requestBlocked?'unavailable':'waiting_for_sam',message:this.requestBlocked?this.message:this.status==='no_match'?'SAM has not found a usable object mask. Try another view or object.':'Waiting for SAM to identify an object in the captured image.'};
    const measured=this.tracks.filter(t=>t.status==='tracking');
    if(!measured.length)return {...common,state:'tracking_lost',message:'The object is not being followed reliably. Waiting for a fresh SAM mask.'};
    if(measured.some(t=>t.forecastReason==='stationary_or_low_motion'))return {...common,state:'stationary',message:'The observed object is almost still. Motion is needed before a forecast can be shown.'};
    if(measured.some(t=>t.forecastReason==='insufficient_samples'||t.forecastReason==='insufficient_time_span'))return {...common,state:'learning',message:'Learning motion · '+Math.min(common.sampleCount,common.minSamples)+' of '+common.minSamples+' measured frames.'};
    return {...common,state:'uncertain',message:'The observed motion is too uncertain to issue a forecast. Continue observing.'};
  }
  snapshot(){
    const scored=this.assessments.filter(a=>a.status==='scored'&&Number.isFinite(a.errorPx));
    const tracks=this.tracks.map(t=>{
      const own=scored.filter(a=>a.trackId===t.id);
      return {id:t.id,samId:t.samId,point:t.point?{...t.point}:null,box:t.box?{...t.box}:null,color:t.color,confidence:t.confidence,status:t.status,reason:t.reason,
        prediction:t.prediction?clone(t.prediction):null,lastAssessment:t.lastAssessment?clone(t.lastAssessment):null,
        forecastStatus:t.forecastStatus??'refused',forecastReason:t.forecastReason??'insufficient_samples',forecastSampleCount:t.forecastSampleCount??0,
        recentTrail:t.observations.filter(o=>finitePoint(o.point)).slice(-20).map(o=>({t:o.t,...o.point})),
        pendingTargets:this.issued.filter(p=>p.trackId===t.id&&p.targetTime>this.timeS).map(p=>({id:p.id,point:{...p.point},sourceTime:p.sourceTime,targetTime:p.targetTime})),
        meanErrorPx:own.length?own.reduce((s,a)=>s+a.errorPx,0)/own.length:null,scoredCount:own.length,samPolygons:clone(t.samPolygons),samTimeS:t.samTimeS};
    });
    return {active:this.active,status:this.status,providerStatus:this.status,message:this.message,runId:this.runId,sourceKind:this.sourceKind,concept:this.concept,
      width:this.width,height:this.height,timeS:this.timeS,samCalls:this.sessionCalls,runSamCalls:this.runCalls,samAccepted:this.sessionAccepted,samPending:Boolean(this.pending),
      latestSam:this.latestSam?clone(this.latestSam):null,tracks,issuedCount:this.issued.length,scoredCount:scored.length,
      unscorableCount:this.assessments.filter(a=>a.status==='unscorable').length,observationsCount:this.observations.length,
      meanErrorPx:scored.length?scored.reduce((s,a)=>s+a.errorPx,0)/scored.length:null,lateSamResponses:this.lateSamResponses,busyResponses:this.busyResponses,
      maxRequests:this.maxRequests,httpAttempts:this.httpAttempts,lastError:this.lastError,revalidationCount:this.revalidations.length,
      forecastReadiness:this._forecastReadiness(),retryableBusy:this.retryableBusy,retryAfterMs:this.retryableBusy?Math.max(0,this.retryAtWallTime-this.now()):0,
      canLockPrediction:this.active&&this.tracks.some(t=>t.status==='tracking'&&t.prediction?.targetTime>this.timeS),predictionTicket:this._ticketSnapshot(this.tickets.at(-1)),
      provenance:'SAM 3.1 + local pixel tracking + kinematic prediction'};
  }
  _emit(){const value=this.snapshot();this.onUpdate(value);return value;}
}
export const createSamObserver=options=>new SamObserver(options);
