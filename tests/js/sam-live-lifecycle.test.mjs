/** Browser lifecycle checks run without a camera or any live model requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {SamObserver} from '../../web/vision/observer.mjs';
import {CameraSession} from '../../web/camera/media.mjs';
import {imagePoint,selectionFromGesture,selectionLabel} from '../../web/vision/selection.mjs';
const RUN='a'.repeat(32),NEXT='b'.repeat(32);
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<4;i++)await tick();}
async function until(predicate, message, timeoutMs=1500){
  const deadline=Date.now()+timeoutMs;
  while(!predicate()){
    assert.ok(Date.now()<deadline,message);
    // WebCrypto digest completion uses the host worker pool. A fixed count of
    // event-loop turns can finish before it, especially during parallel tests.
    await new Promise(resolve=>setTimeout(resolve,2));
  }
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness({cameraMode=false,getUserMedia=async()=>({getTracks:()=>[]}),status={},autoPresent=true,videoFrameCallbacks=true}={}){
  const nodes=new Map(),listeners=new Map(),posts=[],intervals=[],draws=[],encodedImages=new Map();
  let canvasSerial=0,uuidSerial=0,encodingSerial=0;
  const copyImage=image=>({width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)});
  const element=id=>{
    if(nodes.has(id))return nodes.get(id);
    let image=null;
    const methods={
      drawImage(source){
        const pixels=source.id==='camera-video'
          ? source.hasPresentedFrame&&(source.frameAtTime?.(source.presentedTime)||source.imageData)
          : source.frameAtTime?.(source.currentTime)||source.imageData;
        image=pixels?copyImage(pixels):null;
      },
      putImageData(pixels){image=copyImage(pixels);},
      getImageData(_x,_y,width,height){
        return image&&image.width===width&&image.height===height?copyImage(image):{width,height,data:new Uint8ClampedArray(width*height*4)};
      }
    };
    const pen=new Proxy(methods,{get:(target,operation)=>target[operation]||((...args)=>draws.push({id,operation,args}))});
    const events=new Map(),handlers=new Map(),frameCallbacks=new Map(),cancelledFrames=[];
    let callbackSerial=0;
    const node={id,hidden:false,disabled:false,value:id==='object-concept'?'ball':'random',width:480,height:300,style:{setProperty(name,value){this[name]=value;}},parentElement:{style:{}},textContent:'',
      currentTime:0,videoWidth:128,videoHeight:96,readyState:4,paused:true,srcObject:null,
      hasPresentedFrame:false,presentedTime:0,playCalls:0,pauseCalls:0,frameCallbacks,cancelledFrames,
      getContext:()=>pen,
      addEventListener(type,fn){
        if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);
        events.set(type,event=>{const results=[...handlers.get(type)].map(fn=>fn(event));return results.length===1?results[0]:Promise.all(results);});
      },
      removeEventListener:(type,fn)=>handlers.get(type)?.delete(fn),removeAttribute:()=>{},setAttribute:()=>{},
      play:async()=>{node.paused=false;node.playCalls++;if(autoPresent)queueMicrotask(()=>node.presentFrame());},
      pause:()=>{node.paused=true;node.pauseCalls++;},load:()=>{node.hasPresentedFrame=false;node.currentTime=0;node.paused=true;},
      requestVideoFrameCallback:videoFrameCallbacks?fn=>{const id=++callbackSerial;frameCallbacks.set(id,fn);return id;}:undefined,
      cancelVideoFrameCallback:videoFrameCallbacks?id=>{cancelledFrames.push(id);frameCallbacks.delete(id);}:undefined,
      presentFrame(t=node.currentTime){
        node.currentTime=t;node.presentedTime=t;node.hasPresentedFrame=true;
        const queued=[...frameCallbacks];frameCallbacks.clear();
        for(const [,fn]of queued)fn(performance.now(),{mediaTime:t,width:node.videoWidth,height:node.videoHeight});
        events.get('timeupdate')?.();
      },
      getBoundingClientRect:()=>({left:0,top:0,width:128,height:96}),setPointerCapture:()=>{},
      toDataURL:()=>{const token='mock-jpeg-'+(++encodingSerial);encodedImages.set(token,copyImage(image));return 'data:image/jpeg;base64,'+Buffer.from(token).toString('base64');},
      showModal:()=>{node.open=true;},close:()=>{node.open=false;return events.get('close')?.();},dataset:{},
      scrollIntoView:options=>{node.scrolled=options;},
      events,contentWindow:{postMessage:message=>posts.push(message)}};
    nodes.set(id,node);return node;
  };
  const dialogs=['evidence-dialog','settings-dialog','connection-dialog'].map(element);
  const dialogButtons=dialogs.map(dialog=>{const button=element('open-'+dialog.id);button.dataset.dialog=dialog.id;return button;});
  const context={SamObserver,CameraSession,imagePoint,selectionFromGesture,selectionLabel,URLSearchParams,AbortSignal,Blob,atob,performance,
    URL:{createObjectURL:()=> 'blob:local-video-'+(++uuidSerial),revokeObjectURL:()=>{}},
    ImageData:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},
    createImageBitmap:async blob=>({imageData:encodedImages.get(await blob.text()),close(){}}),
    crypto:{randomUUID:()=> (++uuidSerial).toString(16).padStart(32,'c')},navigator:{mediaDevices:{getUserMedia}},
    location:{search:cameraMode?'?mode=camera':'',origin:'http://localhost'},document:{getElementById:element,createElement:tag=>element(tag+'-'+(++canvasSerial)),
      querySelectorAll:selector=>selector==='[data-dialog]'?dialogButtons:selector==='dialog'?dialogs:[],addEventListener:()=>{}},
    addEventListener:(type,fn)=>listeners.set(type,fn),setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval:()=>{},setTimeout:()=>{},clearTimeout:()=>{},
    fetch:async()=>({ok:true,json:async()=>({model:'sam-3.1',live_only:true,available:true,remaining_requests:200,remaining_usd:.5,budget_scene:'vision',price_per_image_usd:.0025,...status})})};
  const source=readFileSync(new URL('../../web/vision/live.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source+'\nglobalThis.testApi={start,stop,newScene,render,observer,updatePreview,frameCache,lockPrediction,revealPrediction,resumeExperiment,getState:()=>({active,starting,connected,samRemaining,runId,resetRequested,worldHasStarted,challengePhase,modalPaused,ticket,inputKind,selectedPrompt,lastRawFrame,sourceTime,gesture})};',context);
  const api=context.testApi;
  const message=data=>listeners.get('message')({origin:context.location.origin,source:element('world-frame').contentWindow,data});
  return {api,nodes,posts,draws,message,encodedImages,encodings:()=>encodingSerial,
    frame:async t=>{element('camera-video').presentFrame(t);await intervals[0]();},
    pointer:(type,x,y,pointerId=1)=>element('selection-overlay').events.get(type)({clientX:x,clientY:y,pointerId,preventDefault(){}}),
    interval:()=>intervals[0](),open:id=>element('open-'+id).events.get('click')(),close:id=>element(id).close(),load:()=>element('world-frame').events.get('load')()};
}

test('a scene initializes when early iframe ready/reset events were missed',async()=>{
  const h=harness();await settle();
  assert.equal(h.posts[0].command,'reset','module setup actively requests a scene');
  h.load();assert.equal(h.posts.length,2,'iframe load retries a request sent before child initialization');
  await h.message({type:'tf-world-reset',run_id:RUN,family:'pendulum'});
  assert.equal(h.nodes.get('start-observation').disabled,false);
  await h.api.start();const before=h.posts.length;h.load();
  assert.equal(h.posts.length,before,'loading callbacks cannot reset an active run');
});

test('stopped receipts are recorded evidence and never labeled LIVE SAM',async()=>{
  const h=harness();await settle();
  h.api.render({...h.api.observer.snapshot(),active:false,latestSam:{frameId:'old',detectedCount:1,latencyMs:20}});
  assert.equal(h.nodes.get('sam-indicator').textContent,'RECORDED');
  assert.equal(h.nodes.get('sam-indicator').className,'recorded-dot');
});

test('a cancelled camera start cannot clear or stop a replacement permission request',async()=>{
  const first=deferred(),second=deferred();let calls=0,oldStopped=0,newStopped=0;
  const h=harness({cameraMode:true,getUserMedia:()=>++calls===1?first.promise:second.promise});await settle();
  const oldStart=h.api.start();h.api.stop({refresh:false});const newStart=h.api.start();
  first.resolve({getTracks:()=>[{stop:()=>oldStopped++}]});await oldStart;
  assert.equal(h.api.getState().starting,true,'old finally must not overwrite the replacement start');
  second.resolve({getTracks:()=>[{stop:()=>newStopped++}]});await newStart;
  assert.equal(h.api.getState().active,true);assert.equal(h.api.getState().starting,false);
  assert.equal(oldStopped,1);assert.equal(newStopped,0);
});

test('new scenes immediately stop the old observer and provider failure fully stops capture',async()=>{
  const h=harness();await settle();await h.message({type:'tf-world-reset',run_id:RUN,family:'pendulum'});
  await h.api.start();await h.message({type:'tf-world-reset',run_id:NEXT,family:'pendulum'});
  assert.equal(h.api.observer.active,true);
  h.api.newScene();assert.equal(h.api.observer.active,false);assert.equal(h.api.getState().resetRequested,true);
  await h.message({type:'tf-world-reset',run_id:RUN,family:'collisions'});
  h.api.render({...h.api.observer.snapshot(),status:'sam_unavailable',message:'Provider rejected image'});
  assert.equal(h.api.getState().active,false);assert.equal(h.api.observer.active,false);
  assert.equal(h.nodes.get('sam-indicator').textContent,'UNAVAILABLE');
  assert.equal(h.nodes.get('observation-status').textContent,'Provider rejected image');
});

test('receipt spending updates the shared allowance and session request cap disables restart',async()=>{
  const h=harness();await settle();await h.message({type:'tf-world-reset',run_id:RUN,family:'pendulum'});
  h.api.render({...h.api.observer.snapshot(),latestSam:{frameId:'f1',detectedCount:1,budget:{limit_per_scene:.5,scenes:{vision:.0125}}}});
  assert.equal(h.nodes.get('sam-remaining').textContent,'$0.4875 · 195 images');
  h.api.observer.sessionCalls=60;h.api.render(h.api.observer.snapshot());
  assert.equal(h.nodes.get('start-observation').disabled,true);await h.api.start();assert.equal(h.api.getState().active,false);
});

test('explicit unlimited server status connects with a null remaining count and hides the allowance meter',async()=>{
  for(const cameraMode of [false,true]){
    const h=harness({cameraMode,status:{available:true,remaining_requests:null,remaining_usd:null,max_requests_per_run:null,budget:{unlimited:true,limit_per_scene:null}}});
    await settle();
    assert.equal(h.api.getState().connected,true);assert.equal(h.api.getState().samRemaining,null);
    assert.equal(h.api.observer.maxRequests,Infinity);assert.equal(h.api.observer.snapshot().unlimitedRequests,true);
    assert.equal(h.nodes.get('connection-notice').hidden,true);assert.equal(h.nodes.get('usage-fill').parentElement.hidden,true);
    assert.equal(h.nodes.get('sam-remaining').textContent,'No Twinforge cap');
    assert.equal(h.nodes.get('connection-summary').textContent,'SAM connected');
    assert.doesNotMatch(h.nodes.get('connection-detail').textContent,/0 images|used up|exhausted/i);
    assert.match(h.nodes.get('connection-detail').textContent,/Meta account credit still applies/);
    if(!cameraMode)await h.message({type:'tf-world-reset',run_id:RUN,family:'pendulum'});
    h.api.observer.sessionCalls=75;h.api.render(h.api.observer.snapshot());
    assert.equal(h.nodes.get('start-observation').disabled,false,'the removed 60-image cap cannot disable a new run');
    assert.equal(h.nodes.get('sam-remaining').textContent,'No Twinforge cap');
  }
});

test('changing horizon preserves the active source, SAM anchor and previously issued forecasts',async()=>{
  const h=harness();await runningScene(h);const f=observationFixture(h);
  f.push(0);await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'SAM response was not accepted');
  for(let i=1;i<=7;i++)f.push(i*.1);
  const before=h.api.observer.snapshot(),issued=structuredClone(h.api.observer.issued),posts=h.posts.length;
  assert.equal(before.horizon,.5);assert.ok(issued.length>0);
  const control=h.nodes.get('prediction-horizon');control.value='1';await control.events.get('change')();
  const after=h.api.observer.snapshot(),evidence=h.api.observer.exportEvidence();
  assert.equal(after.horizon,1);assert.equal(h.api.getState().active,true);assert.equal(h.api.getState().resetRequested,false);
  assert.equal(after.runId,before.runId);assert.equal(after.timeS,before.timeS);assert.equal(after.samCalls,before.samCalls);
  assert.equal(after.tracks[0].id,before.tracks[0].id);assert.equal(after.latestSam.frameId,before.latestSam.frameId);
  assert.deepEqual(h.api.observer.issued.slice(0,issued.length),issued,'issued forecasts cannot be rewritten by the horizon control');
  assert.equal(h.posts.length,posts,'horizon changes do not reset, pause or recapture the scene');
  assert.equal(evidence.current.mixedHorizon,true);assert.equal(evidence.current.horizonS,null);
  assert.deepEqual(evidence.current.horizonsUsed,[.5,1]);
  assert.equal(h.nodes.get('forecast-legend').textContent,'Predicted +1.0 s');
  assert.match(h.nodes.get('horizon-note').textContent,/conditional uncertainty/);
  h.api.stop({refresh:false});
});

test('changing a stopped camera horizon updates guidance without starting capture',async()=>{
  let requests=0;const h=harness({cameraMode:true,getUserMedia:async()=>{requests++;return{getTracks:()=>[]};}});await settle();
  const control=h.nodes.get('prediction-horizon');control.value='1';await control.events.get('change')();
  assert.equal(requests,0);assert.equal(h.api.getState().active,false);
  assert.match(h.nodes.get('stage-message-copy').textContent,/tap an object/);
  assert.equal(h.api.observer.exportEvidence().current.selectedHorizonS,1);
});

async function runningScene(h) {
  await settle();await h.message({type:'tf-world-reset',run_id:RUN,family:'collisions'});
  await h.api.start();await h.message({type:'tf-world-reset',run_id:NEXT,family:'collisions'});
}

// Pixels and SAM transport are mocked, while the production observer,
// prediction logic, controller, and pause/resume lifecycle execute together.
function observationFixture(h, firstResponse=null) {
  let random=1234,calls=0;const requests=[];
  const noise=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random>>>24;};
  const background=Uint8Array.from({length:128*96},()=>25+noise()%50);
  const appearance=Uint8Array.from({length:20*18},()=>20+noise()%230);
  function pixels(t){
    const x=30+Math.round(20*t),grey=new Uint8ClampedArray(background),data=new Uint8ClampedArray(128*96*4);
    for(let y=0;y<18;y++)for(let i=0;i<20;i++)grey[(35+y)*128+x+i]=appearance[y*20+i];
    for(let i=0;i<grey.length;i++){data[i*4]=data[i*4+1]=data[i*4+2]=grey[i];data[i*4+3]=255;}
    return {width:128,height:96,data};
  }
  h.nodes.get('camera-video').frameAtTime=pixels;
  h.api.observer.fetcher=async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);requests.push(body);if(firstResponse&&calls===1)await firstResponse.promise;
    const x=30+Math.round(20*body.source_time_s);
    return {ok:true,status:200,json:async()=>({model:'sam-3.1',run_id:body.run_id,frame_id:body.frame_id,source_time_s:body.source_time_s,
      image_sha256:createHash('sha256').update(Buffer.from(body.image_base64,'base64')).digest('hex'),width:128,height:96,
      selection:body.selection||null,prompt_kind:body.selection?.type||'concept',
      receipt:{model:'sam-3.1',request_id:'c'.repeat(32),request_sha256:'d'.repeat(64)},latency_ms:20,
      detections:[{id:'1',box:{x1:x,y1:35,x2:x+20,y2:53},centroid:[x+10,44],area:360,
        polygons:[[[x,35],[x+20,35],[x+20,53],[x,53]]],mask_decoded:true,color_rgb:[170,170,170]}]})};
  };
  return {calls:()=>calls,requests,pixels,push(t){
    const frameId='fixture-'+Math.round(t*1000);
    return h.api.observer.pushFrame({runId:h.api.getState().runId,t,frameId,imageData:pixels(t),imageBase64:Buffer.from(frameId).toString('base64')});
  }};
}

test('camera preview captures local raw pixels without a SAM request or JPEG until an object is selected',async()=>{
  let permissions=0;const h=harness({cameraMode:true,getUserMedia:async()=>{permissions++;return{getTracks:()=>[]};}});
  await settle();const f=observationFixture(h);await h.api.start();
  for(let i=0;i<12;i++)await h.frame(i/24);
  assert.equal(permissions,1);assert.equal(h.api.getState().active,true);
  assert.equal(h.api.observer.active,false);assert.equal(f.calls(),0);assert.equal(h.encodings(),0);
  assert.equal(h.api.observer.sessionCalls,0);assert.equal(h.api.observer.snapshot().tracks.length,0);
  assert.equal(h.nodes.get('sam-indicator').textContent,'SELECT');
  assert.ok(h.api.frameCache.size>=12);assert.match(h.nodes.get('observation-status').textContent,/No image is sent until you select/);
  h.api.stop({refresh:false});
});

test('a camera tap submits the exact pointer-down image and a new selection clears the old target without restarting capture',async()=>{
  let permissions=0,stops=0;const stream={getTracks:()=>[{stop:()=>stops++}]};
  const h=harness({cameraMode:true,getUserMedia:async()=>{permissions++;return stream;}});await settle();
  const f=observationFixture(h);await h.api.start();await h.frame(1);
  h.pointer('pointerdown',60,44);const selectedFrame=h.api.getState().gesture.frame;
  await h.frame(1.4);h.pointer('pointerup',60,44);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'the selected object was not accepted');
  const request=f.requests[0];
  assert.deepEqual(request.selection,{type:'point',x:60,y:44});assert.equal(request.source_time_s,1);
  assert.equal(request.frame_id,selectedFrame.frameId);assert.equal(request.source_kind,'camera');
  const encoded=h.encodedImages.get(Buffer.from(request.image_base64,'base64').toString());
  assert.deepEqual(encoded.data,f.pixels(1).data,'the model must receive the image on which the tap was made');
  assert.equal(h.api.observer.snapshot().tracks.length,1);assert.equal(h.encodings(),1);
  const oldTrack=h.api.observer.snapshot().tracks[0].id;
  h.pointer('pointerdown',68,44);h.pointer('pointerup',68,44);
  assert.equal(h.api.observer.snapshot().tracks.length,0,'old target disappears immediately, before replacement SAM completes');
  await until(()=>h.api.observer.sessionAccepted===2&&!h.api.observer.pending,'replacement selection was not accepted');
  assert.notEqual(h.api.observer.snapshot().tracks[0].id,oldTrack);
  assert.equal(permissions,1);assert.equal(stops,0);assert.equal(h.nodes.get('camera-video').srcObject,stream);
  h.api.stop({refresh:false});
});

test('a reverse camera drag submits an inclusive box on its frozen initial image',async()=>{
  const h=harness({cameraMode:true});await settle();const f=observationFixture(h);await h.api.start();await h.frame(0);
  h.pointer('pointerdown',58,57);const selectedFrame=h.api.getState().gesture.frame;
  await h.frame(.3);h.pointer('pointermove',29,33);h.pointer('pointerup',29,33);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'box selection was not accepted');
  assert.deepEqual(f.requests[0].selection,{type:'box',x:29,y:33,width:30,height:25});
  assert.equal(f.requests[0].frame_id,selectedFrame.frameId);assert.equal(f.requests[0].source_time_s,0);
  assert.equal(h.api.observer.snapshot().latestSam.promptKind,'box');
  assert.equal(h.api.observer.snapshot().tracks.length,1);h.api.stop({refresh:false});
});

test('a one-second camera drag preserves frozen selection pixels and replays measured motion without a tracking gap',async()=>{
  const h=harness({cameraMode:true});await settle();const f=observationFixture(h);await h.api.start();await h.frame(0);
  h.pointer('pointerdown',58,57);const selectedFrame=h.api.getState().gesture.frame;
  for(let i=1;i<=30;i++)await h.frame(i/30);
  const gesture=h.api.getState().gesture;
  assert.equal(gesture.frames.length,31);assert.equal(gesture.frames[0].frameId,selectedFrame.frameId);
  assert.equal(f.calls(),0);assert.equal(h.encodings(),0,'drag capture stays local until release');
  assert.deepEqual(h.nodes.get('selection-overlay').getContext('2d').getImageData(0,0,128,96).data,f.pixels(0).data,
    'the selection surface remains the pointer-down image while underlying camera frames are buffered');
  h.pointer('pointermove',29,33);h.pointer('pointerup',29,33);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'drag selection did not catch up to the current frame');
  const state=h.api.observer.snapshot(),evidence=h.api.observer.exportEvidence().current;
  assert.equal(f.requests[0].frame_id,selectedFrame.frameId);assert.equal(f.requests[0].source_time_s,0);
  assert.equal(state.timeS,1);assert.equal(state.tracks[0].status,'tracking');
  assert.equal(evidence.observations.length,31);assert.equal(evidence.observations[0].frameId,selectedFrame.frameId);
  assert.ok(evidence.observations.every(o=>o.runId===state.runId));
  assert.ok(evidence.observations.every((o,i)=>i===0||o.t-evidence.observations[i-1].t<.04));
  assert.ok(evidence.issued.length>0);assert.ok(evidence.issued.every(p=>p.sourceTime===1&&p.targetTime>1));
  for(let i=31;i<=48;i++)await h.frame(i/30);
  assert.ok(h.api.observer.snapshot().scoredCount>0);assert.equal(f.calls(),1);assert.equal(h.encodings(),1);
  h.api.stop({refresh:false});
});

test('long camera gestures retain first and latest raw images with bounded temporal thinning',async()=>{
  const h=harness({cameraMode:true});await settle();const f=observationFixture(h);await h.api.start();await h.frame(0);
  h.pointer('pointerdown',58,57);const first=h.api.getState().gesture.frame;
  for(let i=1;i<=100;i++)await h.frame(i/30);
  const frames=h.api.getState().gesture.frames;
  assert.equal(frames.length,80);assert.equal(frames[0].frameId,first.frameId);assert.equal(frames.at(-1).t,100/30);
  assert.ok(frames.every((frame,i)=>i===0||frame.t-frames[i-1].t<.2));
  assert.equal(f.calls(),0);assert.equal(h.encodings(),0);
  h.api.stop({refresh:false});assert.equal(h.api.getState().gesture,null);
});

test('Hands selected before camera start asks SAM for visible hands on the first preview frame',async()=>{
  const h=harness({cameraMode:true});await settle();const f=observationFixture(h);
  h.nodes.get('select-hands').events.get('click')();assert.equal(f.calls(),0);
  await h.api.start();assert.equal(f.calls(),0);await h.frame(0);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'hand concept selection was not accepted');
  assert.equal(f.requests[0].concept,'hand');assert.equal(f.requests[0].source_kind,'camera');
  assert.equal(f.requests[0].selection,undefined,'Hands uses SAM concept segmentation, not a fabricated hand box');
  assert.equal(h.api.observer.snapshot().latestSam.promptKind,'concept');
  assert.match(h.nodes.get('selection-confirmation').textContent,/SAM confirmed.*Hands/);
  h.api.stop({refresh:false});
});

test('camera horizon controls preserve the stream, selected object, forecast history and cumulative SAM count',async()=>{
  let permissions=0,stops=0;const stream={getTracks:()=>[{stop:()=>stops++}]};
  const h=harness({cameraMode:true,getUserMedia:async()=>{permissions++;return stream;}});await settle();
  const f=observationFixture(h);await h.api.start();await h.frame(0);
  h.pointer('pointerdown',40,44);h.pointer('pointerup',40,44);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'camera selection was not accepted');
  for(let i=1;i<=24;i++)await h.frame(i/24);
  const before=h.api.observer.snapshot(),issued=structuredClone(h.api.observer.issued),historyLength=h.api.observer.history.length;
  assert.ok(issued.length>0,'measured camera motion must produce forecasts before changing the horizon');
  const control=h.nodes.get('prediction-horizon');
  for(const value of ['0.75','1']){control.value=value;await control.events.get('change')();}
  const after=h.api.observer.snapshot();
  assert.equal(permissions,1);assert.equal(stops,0);assert.equal(h.nodes.get('camera-video').srcObject,stream);
  assert.equal(after.runId,before.runId);assert.equal(after.tracks[0].id,before.tracks[0].id);assert.equal(after.timeS,before.timeS);
  assert.equal(after.samCalls,before.samCalls);assert.equal(f.calls(),1);assert.equal(h.encodings(),1);
  assert.equal(h.api.observer.history.length,historyLength);assert.equal(after.horizon,1);
  assert.deepEqual(h.api.observer.issued.slice(0,issued.length),issued);
  assert.ok(after.totalIssuedCount>=issued.length);assert.equal(after.tracks[0].prediction.horizon,1);
  assert.deepEqual(after.selection,{type:'point',x:40,y:44});h.api.stop({refresh:false});
});

test('uploaded video stays paused and local until selection, then uses video source provenance',async()=>{
  const h=harness({cameraMode:true});await settle();const f=observationFixture(h);
  const input=h.nodes.get('video-file'),video=h.nodes.get('camera-video');input.files=[new Blob(['local fixture'])];
  const loading=input.events.get('change')();video.events.get('loadeddata')();await loading;
  assert.equal(h.api.getState().inputKind,'video');assert.equal(h.api.getState().active,true);
  assert.equal(video.paused,true);assert.equal(h.api.observer.active,false);assert.equal(f.calls(),0);assert.equal(h.encodings(),0);
  h.pointer('pointerdown',40,44);h.pointer('pointerup',40,44);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'uploaded video selection was not accepted');
  assert.equal(f.requests[0].source_kind,'video');assert.equal(video.paused,false);
  video.events.get('ended')();assert.equal(h.api.getState().active,false);assert.equal(video.paused,true);
});

test('video end bounds disable both lock controls and direct locking, while a reachable shorter horizon remains usable',async()=>{
  const h=harness({cameraMode:true});await settle();observationFixture(h);
  const input=h.nodes.get('video-file'),video=h.nodes.get('camera-video');
  video.duration=2;input.files=[new Blob(['local fixture'])];
  const loading=input.events.get('change')();video.events.get('loadeddata')();await loading;
  h.pointer('pointerdown',40,44);h.pointer('pointerup',40,44);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'video selection was not accepted');
  for(let i=1;i<=9;i++)await h.frame(i/10);
  const horizon=h.nodes.get('prediction-horizon');horizon.value='1';await horizon.events.get('change')();
  assert.equal(h.api.observer.snapshot().canLockPrediction,true,'the observer has a real pixel-derived forecast');
  assert.equal(h.nodes.get('lock-prediction').disabled,false,'a target before the clip end is reachable');
  assert.equal(h.nodes.get('quick-lock').disabled,false);
  for(const t of [1,1.1]){
    await h.frame(t);
    assert.equal(h.api.observer.snapshot().canLockPrediction,true,'video duration, not tracking failure, must block this target');
    assert.equal(h.nodes.get('lock-prediction').disabled,true);
    assert.equal(h.nodes.get('quick-lock').disabled,true);
    assert.match(h.nodes.get('challenge-hint').textContent,/clip ends before that target time/i);
    h.api.lockPrediction();h.nodes.get('quick-lock').events.get('click')();
    assert.equal(h.api.getState().ticket,null,'programmatic locking cannot bypass the end-of-video guard');
    assert.equal(h.api.observer.tickets.length,0);
  }
  horizon.value='0.5';await horizon.events.get('change')();
  assert.equal(h.nodes.get('lock-prediction').disabled,false);assert.equal(h.nodes.get('quick-lock').disabled,false);
  h.api.lockPrediction();
  const ticket=h.api.getState().ticket;
  assert.ok(ticket);assert.ok(ticket.targetTime<video.duration);assert.equal(h.api.observer.tickets.length,1);
  // A user may still stop early: keep the attempt without inventing a tracking failure.
  h.api.stop({refresh:false});
  assert.equal(h.api.getState().ticket.status,'unscorable');
  assert.equal(h.nodes.get('challenge-title').textContent,'No later observation.');
  assert.match(h.nodes.get('challenge-copy').textContent,/attempt stays in the record/);
  assert.doesNotMatch(h.nodes.get('challenge-title').textContent,/track was lost/i);
  assert.equal(h.api.observer.exportEvidence().current.tickets.length,1);
});

test('automatic Hands waits for a presented video frame and sends its visible pixels rather than a black startup image',async()=>{
  for(const videoFrameCallbacks of [true,false]){
    const h=harness({cameraMode:true,autoPresent:false,videoFrameCallbacks});await settle();const f=observationFixture(h);
    h.nodes.get('select-hands').events.get('click')();
    const input=h.nodes.get('video-file'),video=h.nodes.get('camera-video');input.files=[new Blob(['local fixture'])];
    const loading=input.events.get('change')();video.events.get('loadeddata')();await settle();
    assert.equal(video.playCalls,1,'play primes the decoder before pausing for selection');
    assert.equal(video.paused,false);assert.equal(video.hasPresentedFrame,false);
    assert.equal(h.api.getState().starting,true);assert.equal(h.api.getState().active,false);
    await h.interval();assert.equal(f.calls(),0);assert.equal(h.encodings(),0);
    video.presentFrame(.04);await loading;
    await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'presented Hands image was not accepted');
    assert.equal(f.requests[0].concept,'hand');assert.equal(f.requests[0].source_kind,'video');
    assert.equal(f.requests[0].source_time_s,.04);
    const encoded=h.encodedImages.get(Buffer.from(f.requests[0].image_base64,'base64').toString());
    assert.deepEqual(encoded.data,f.pixels(.04).data,'first JPEG must contain the first presented pixels');
    assert.ok(encoded.data.some((value,index)=>index%4!==3&&value>0),'RGB pixels are not black');
    h.api.stop({refresh:false});
  }
});

test('cancelling first-frame presentation cannot reactivate or pause a replacement camera start',async()=>{
  let oldStopped=0,newStopped=0,calls=0;
  const oldStream={getTracks:()=>[{stop:()=>oldStopped++}]},newStream={getTracks:()=>[{stop:()=>newStopped++}]};
  const h=harness({cameraMode:true,autoPresent:false,getUserMedia:async()=>++calls===1?oldStream:newStream});
  await settle();observationFixture(h);
  const video=h.nodes.get('camera-video'),oldStart=h.api.start();await settle();
  const [oldHandle,latePresentation]=[...video.frameCallbacks][0];
  assert.equal(h.api.getState().starting,true);assert.equal(h.api.getState().active,false);
  h.api.stop({refresh:false});const newStart=h.api.start();await settle();
  assert.ok(video.cancelledFrames.includes(oldHandle));assert.equal(video.srcObject,newStream);
  assert.equal(h.api.getState().starting,true);assert.equal(h.api.getState().active,false);
  const pauses=video.pauseCalls;
  latePresentation(performance.now(),{mediaTime:0});await oldStart;
  assert.equal(h.api.getState().starting,true,'old finally must not clear replacement start');
  assert.equal(h.api.getState().active,false,'old frame must not reactivate capture');
  assert.equal(video.pauseCalls,pauses,'old frame must not pause replacement playback');
  assert.equal(video.srcObject,newStream);assert.equal(oldStopped,1);assert.equal(newStopped,0);
  video.presentFrame(.04);await newStart;
  assert.equal(h.api.getState().active,true);assert.equal(h.api.getState().starting,false);
  assert.equal(video.paused,false);assert.equal(newStopped,0);h.api.stop({refresh:false});
});

test('replaying a completed video and changing horizon keeps the fresh preview paused without restoring old metrics',async()=>{
  const h=harness({cameraMode:true});await settle();const f=observationFixture(h);
  const input=h.nodes.get('video-file'),video=h.nodes.get('camera-video');input.files=[new Blob(['local fixture'])];
  const loading=input.events.get('change')();video.events.get('loadeddata')();await loading;
  h.pointer('pointerdown',40,44);h.pointer('pointerup',40,44);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'video SAM selection did not complete');
  for(let i=1;i<=45;i++)await h.frame(i/30);
  assert.ok(h.api.observer.snapshot().scoredCount>0,'the completed run must contain actual measured forecast outcomes');
  video.events.get('ended')();const priorSam=h.api.observer.snapshot().latestSam;
  assert.equal(h.api.observer.active,false);assert.equal(h.nodes.get('sam-indicator').textContent,'RECORDED');
  await h.api.start();assert.equal(video.paused,true);assert.equal(video.currentTime,0);
  assert.equal(h.api.getState().active,true);assert.equal(h.api.observer.active,false);
  assert.equal(h.api.observer.snapshot().latestSam.frameId,priorSam.frameId,'the old evidence remains downloadable');
  const control=h.nodes.get('prediction-horizon');control.value='1';await control.events.get('change')();
  await h.interval();
  assert.equal(video.paused,true,'a stopped SAM receipt cannot start the new video preview');
  assert.equal(h.api.observer.active,false);assert.equal(f.calls(),1,'replay and horizon changes do not submit new images');
  assert.equal(h.nodes.get('world-state').textContent,'VIDEO READY');assert.equal(h.nodes.get('sam-indicator').textContent,'SELECT');
  assert.equal(h.nodes.get('sam-count').textContent,'0');assert.equal(h.nodes.get('checked-count').textContent,'0');
  assert.equal(h.nodes.get('prediction-count').textContent,'0');assert.equal(h.nodes.get('forecast-error').textContent,'—');
  assert.equal(h.nodes.get('selection-confirmation').textContent,'Waiting for your selection');
  h.api.stop({refresh:false});
});

test('stopping while a SAM refresh is pending labels prior evidence RECORDED and retains selection success',async()=>{
  const h=harness({cameraMode:true});await settle();observationFixture(h);await h.api.start();await h.frame(0);
  h.pointer('pointerdown',40,44);h.pointer('pointerup',40,44);
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'first camera SAM selection did not complete');
  const refresh=deferred(),fetcher=h.api.observer.fetcher;
  h.api.observer.fetcher=async(...args)=>{await refresh.promise;return fetcher(...args);};
  for(let i=1;i<=90;i++)await h.frame(i/30);
  await until(()=>h.api.observer.httpAttempts===2,'the refresh was not dispatched');
  assert.equal(h.nodes.get('sam-indicator').textContent,'REFRESHING');
  h.api.stop({refresh:false});
  assert.equal(h.api.observer.active,false);assert.ok(h.api.observer.pending,'already dispatched work is allowed to finish');
  assert.equal(h.nodes.get('sam-indicator').textContent,'RECORDED');assert.doesNotMatch(h.nodes.get('sam-indicator').className,/pending/);
  assert.match(h.nodes.get('selection-confirmation').textContent,/Selection record retained/);
  assert.doesNotMatch(h.nodes.get('selection-confirmation').textContent,/no matching|found no/i);
  refresh.resolve();await until(()=>!h.api.observer.pending,'stopped refresh did not finish');
  assert.equal(h.nodes.get('sam-indicator').textContent,'RECORDED');
  assert.match(h.nodes.get('selection-confirmation').textContent,/Selection record retained/);
  assert.equal(h.api.getState().active,false);
});

test('a late uploaded-video load event cannot restart a cancelled session',async()=>{
  const h=harness({cameraMode:true});await settle();observationFixture(h);
  const input=h.nodes.get('video-file'),video=h.nodes.get('camera-video');input.files=[new Blob(['local fixture'])];
  const loading=input.events.get('change')();assert.equal(h.api.getState().starting,true);
  h.api.stop({refresh:false});video.events.get('loadeddata')();await loading;
  assert.equal(h.api.getState().active,false);assert.equal(h.api.getState().starting,false);
  assert.equal(h.api.observer.active,false);assert.equal(h.encodings(),0);
});

test('a synthetic cold start stays paused until the first real SAM receipt, then starts exactly once',async()=>{
  const h=harness(),response=deferred();await runningScene(h);
  const f=observationFixture(h,response);f.push(0);await until(()=>f.calls()===1,'first SAM request was not dispatched');
  assert.equal(h.api.getState().worldHasStarted,false);
  assert.equal(h.posts.some(p=>p.command==='play'),false);
  response.resolve();await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'SAM response was not accepted');
  assert.equal(h.api.getState().worldHasStarted,true);
  assert.equal(h.posts.filter(p=>p.command==='play').length,1);
  f.push(.1);f.push(.2);assert.equal(h.posts.filter(p=>p.command==='play').length,1);
  h.api.stop({refresh:false});
});

test('first SAM receipt arriving inside a dialog starts the paused world after the dialog closes',async()=>{
  const h=harness(),response=deferred();await runningScene(h);
  const f=observationFixture(h,response);f.push(0);await until(()=>f.calls()===1,'first SAM request was not dispatched');
  h.open('evidence-dialog');response.resolve();
  await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'SAM response was not accepted while the dialog was open');
  assert.equal(h.api.getState().modalPaused,true);
  assert.equal(h.posts.some(p=>p.command==='play'),false,'reading details must keep the source clock paused');
  h.close('evidence-dialog');await h.interval();
  assert.equal(h.api.getState().worldHasStarted,true,'a receipt received while paused must not strand the scene at time zero');
  assert.equal(h.posts.filter(p=>p.command==='play').length,1);
  h.api.stop({refresh:false});
});

test('lock pauses the world, reveal retains the target, and a later measured outcome pauses for inspection',async()=>{
  const h=harness();await runningScene(h);const f=observationFixture(h);
  f.push(0);await until(()=>h.api.observer.sessionAccepted===1&&!h.api.observer.pending,'SAM response was not accepted');
  for(let i=1;i<=7;i++)f.push(i*.1);
  assert.equal(h.nodes.get('lock-prediction').disabled,false);
  assert.equal(h.nodes.get('quick-lock').disabled,false);
  h.nodes.get('quick-lock').events.get('click')();const locked=h.api.getState().ticket;
  assert.equal(h.api.getState().challengePhase,'locked');assert.equal(h.posts.at(-1).command,'pause');
  assert.equal(h.nodes.get('world-state').textContent,'TARGET LOCKED');
  assert.equal(h.nodes.get('stage-mode-label').textContent,'FUTURE LOCKED');
  assert.equal(h.nodes.get('challenge-card').scrolled.block,'start');
  assert.equal(h.nodes.get('reveal-prediction').hidden,false);
  const before=h.posts.length;await h.interval();assert.equal(h.posts.length,before,'a held prediction must not capture new frames');
  h.open('evidence-dialog');h.close('evidence-dialog');
  assert.equal(h.posts.at(-1).command,'pause','closing details cannot accidentally reveal a locked prediction');
  h.api.revealPrediction();assert.equal(h.posts.at(-1).command,'play');
  assert.equal(h.api.getState().challengePhase,'revealing');
  for(let t=.8;t<=locked.targetTime+.1;t+=.1)f.push(t);
  const result=h.api.getState().ticket;
  assert.equal(h.api.getState().challengePhase,'result');assert.equal(result.status,'scored');
  assert.equal(h.nodes.get('world-state').textContent,'RESULT');
  assert.deepEqual(result.point,locked.point);assert.deepEqual(result.prediction,locked.prediction);
  assert.equal(h.posts.at(-1).command,'pause');assert.equal(h.nodes.get('resume-experiment').hidden,false);
  h.api.resumeExperiment();assert.equal(h.api.getState().challengePhase,'idle');assert.equal(h.posts.at(-1).command,'play');
  assert.equal(h.api.observer.exportEvidence().current.tickets.length,1,'continuing cannot erase the recorded attempt');
  h.api.stop({refresh:false});
});

test('camera details stop the stream and cannot restart capture on dialog close',async()=>{
  let stops=0;const h=harness({cameraMode:true,getUserMedia:async()=>({getTracks:()=>[{stop:()=>stops++}]})});await settle();
  await h.api.start();h.open('connection-dialog');
  assert.equal(stops,1);assert.equal(h.api.getState().active,false);
  h.close('connection-dialog');await h.interval();assert.equal(h.api.getState().active,false);
  assert.equal(h.posts.some(p=>p.command==='play'),false);
});

test('SAM proof preview never overlays an older mask on a newer no-match image',async()=>{
  const h=harness();await settle();
  const cache={jpeg:Buffer.from('test-image').toString('base64'),width:128,height:96};
  h.api.frameCache.set('no-match',cache);
  const old={samTimeS:0,samPolygons:[[[1,1],[2,1],[1,2]]]};
  await h.api.updatePreview({latestSam:{frameId:'no-match',sourceTimeS:3,detectedCount:0},tracks:[old]});
  assert.equal(h.draws.filter(d=>d.id==='sam-preview'&&d.operation==='stroke').length,0,
    'ongoing visual tracking is not evidence of a fresh SAM mask on this new image');
  h.api.frameCache.set('new-mask',cache);
  const fresh={samTimeS:6,samPolygons:[[[4,4],[8,4],[4,8]]]};
  await h.api.updatePreview({latestSam:{frameId:'new-mask',sourceTimeS:6,detectedCount:1},tracks:[old,fresh]});
  assert.equal(h.draws.filter(d=>d.id==='sam-preview'&&d.operation==='stroke').length,1);
  assert.deepEqual(h.draws.filter(d=>d.id==='sam-preview'&&d.operation==='moveTo').map(d=>d.args),[[4,4]]);
});
