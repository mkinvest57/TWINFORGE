/** Browser lifecycle checks run without a camera or any live model requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {SamObserver} from '../../web/vision/observer.mjs';
import {CameraSession} from '../../web/camera/media.mjs';
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
function harness({cameraMode=false,getUserMedia=async()=>({getTracks:()=>[]})}={}){
  const nodes=new Map(),listeners=new Map(),posts=[],intervals=[],draws=[];
  const element=id=>{
    if(nodes.has(id))return nodes.get(id);
    const pen=new Proxy({},{get:(_target,operation)=>(...args)=>draws.push({id,operation,args})});
    const events=new Map(),node={id,hidden:false,disabled:false,value:id==='object-concept'?'ball':'random',width:480,height:300,style:{},parentElement:{style:{}},textContent:'',
      getContext:()=>pen,addEventListener:(type,fn)=>events.set(type,fn),removeAttribute:()=>{},setAttribute:()=>{},play:async()=>{},
      showModal:()=>{node.open=true;},close:()=>{node.open=false;return events.get('close')?.();},dataset:{},
      scrollIntoView:options=>{node.scrolled=options;},
      events,contentWindow:{postMessage:message=>posts.push(message)}};
    nodes.set(id,node);return node;
  };
  const dialogs=['evidence-dialog','settings-dialog','connection-dialog'].map(element);
  const dialogButtons=dialogs.map(dialog=>{const button=element('open-'+dialog.id);button.dataset.dialog=dialog.id;return button;});
  const context={SamObserver,CameraSession,URLSearchParams,AbortSignal,Blob,atob,createImageBitmap:async()=>({close(){}}),crypto:{randomUUID:()=>NEXT},navigator:{mediaDevices:{getUserMedia}},
    location:{search:cameraMode?'?mode=camera':'',origin:'http://localhost'},document:{getElementById:element,createElement:element,
      querySelectorAll:selector=>selector==='[data-dialog]'?dialogButtons:selector==='dialog'?dialogs:[],addEventListener:()=>{}},
    addEventListener:(type,fn)=>listeners.set(type,fn),setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval:()=>{},setTimeout:()=>{},clearTimeout:()=>{},
    fetch:async()=>({ok:true,json:async()=>({model:'sam-3.1',live_only:true,available:true,remaining_requests:200,remaining_usd:.5,budget_scene:'vision',price_per_image_usd:.0025})})};
  const source=readFileSync(new URL('../../web/vision/live.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source+'\nglobalThis.testApi={start,stop,newScene,render,observer,updatePreview,frameCache,lockPrediction,revealPrediction,resumeExperiment,getState:()=>({active,starting,runId,resetRequested,worldHasStarted,challengePhase,modalPaused,ticket})};',context);
  const api=context.testApi;
  const message=data=>listeners.get('message')({origin:context.location.origin,source:element('world-frame').contentWindow,data});
  return {api,nodes,posts,draws,message,interval:()=>intervals[0](),open:id=>element('open-'+id).events.get('click')(),close:id=>element(id).close(),load:()=>element('world-frame').events.get('load')()};
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

test('changing horizon archives the old cohort and restarts active observation in a fresh trial',async()=>{
  const h=harness();await settle();await h.message({type:'tf-world-reset',run_id:RUN,family:'pendulum'});
  await h.api.start();await h.message({type:'tf-world-reset',run_id:NEXT,family:'pendulum'});
  assert.equal(h.api.observer.horizon,.2);
  h.api.observer.issued.push({id:'old-target',sourceTime:1,targetTime:1.2,horizon:.2});
  h.api.observer.assessments.push({predictionId:'old-target',status:'scored',errorPx:8});
  const control=h.nodes.get('prediction-horizon');control.value='0.5';await control.events.get('change')();
  assert.equal(h.api.observer.horizon,.5);assert.equal(h.api.getState().active,true);assert.equal(h.api.getState().resetRequested,true);
  assert.equal(h.api.observer.snapshot().scoredCount,0);assert.equal(h.api.observer.snapshot().issuedCount,0);
  const prior=h.api.observer.exportEvidence().previousRuns.find(r=>r.issued.some(p=>p.id==='old-target'));
  assert.equal(prior.horizonS,.2);assert.equal(prior.issued[0].horizon,.2);assert.equal(prior.assessments[0].errorPx,8);
  assert.equal(h.nodes.get('forecast-legend').textContent,'Predicted +0.5 s');
  assert.match(h.nodes.get('horizon-note').textContent,/Stress test/);
  await h.message({type:'tf-world-reset',run_id:RUN,family:'pendulum'});
  assert.equal(h.api.observer.active,true);assert.equal(h.api.observer.exportEvidence().current.horizonS,.5);
  assert.equal(h.api.observer.snapshot().tracks.length,0,'a new SAM response is mandatory');
});

test('changing a stopped camera horizon clears scores and updates camera guidance without starting capture',async()=>{
  let requests=0;const h=harness({cameraMode:true,getUserMedia:async()=>{requests++;return{getTracks:()=>[]};}});await settle();
  const control=h.nodes.get('prediction-horizon');control.value='0.5';await control.events.get('change')();
  assert.equal(requests,0);assert.equal(h.api.getState().active,false);
  assert.match(h.nodes.get('stage-message-copy').textContent,/0\.5 seconds/);
  assert.equal(h.api.observer.exportEvidence().current.horizonS,.5);
});

async function runningScene(h) {
  await settle();await h.message({type:'tf-world-reset',run_id:RUN,family:'collisions'});
  await h.api.start();await h.message({type:'tf-world-reset',run_id:NEXT,family:'collisions'});
}

// Pixels and SAM transport are mocked, while the production observer,
// prediction logic, controller, and pause/resume lifecycle execute together.
function observationFixture(h, firstResponse=null) {
  let random=1234,calls=0;
  const noise=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random>>>24;};
  const background=Uint8Array.from({length:128*96},()=>25+noise()%50);
  const appearance=Uint8Array.from({length:20*18},()=>20+noise()%230);
  h.api.observer.fetcher=async(_url,options)=>{
    calls++;const body=JSON.parse(options.body);if(firstResponse&&calls===1)await firstResponse.promise;
    const x=30+Math.round(20*body.source_time_s);
    return {ok:true,status:200,json:async()=>({model:'sam-3.1',run_id:body.run_id,frame_id:body.frame_id,source_time_s:body.source_time_s,
      image_sha256:createHash('sha256').update(Buffer.from(body.image_base64,'base64')).digest('hex'),width:128,height:96,
      receipt:{model:'sam-3.1',request_id:'c'.repeat(32),request_sha256:'d'.repeat(64)},latency_ms:20,
      detections:[{id:'1',box:{x1:x,y1:35,x2:x+20,y2:53},centroid:[x+10,44],area:360,
        polygons:[[[x,35],[x+20,35],[x+20,53],[x,53]]],mask_decoded:true,color_rgb:[170,170,170]}]})};
  };
  return {calls:()=>calls,push(t){
    const x=30+Math.round(20*t),data=new Uint8ClampedArray(background),frameId='fixture-'+Math.round(t*1000);
    for(let y=0;y<18;y++)for(let i=0;i<20;i++)data[(35+y)*128+x+i]=appearance[y*20+i];
    return h.api.observer.pushFrame({runId:h.api.getState().runId,t,frameId,imageData:{width:128,height:96,data},imageBase64:Buffer.from(frameId).toString('base64')});
  }};
}

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
  f.push(.8);f.push(.9);
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
