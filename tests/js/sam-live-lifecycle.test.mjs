/** Browser lifecycle checks run without a camera or any live model requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {SamObserver} from '../../web/vision/observer.mjs';
import {CameraSession} from '../../web/camera/media.mjs';
const RUN='a'.repeat(32),NEXT='b'.repeat(32);
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<4;i++)await tick();}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness({cameraMode=false,getUserMedia=async()=>({getTracks:()=>[]})}={}){
  const nodes=new Map(),listeners=new Map(),posts=[];
  const pen=new Proxy({},{get:()=>()=>{}});
  const element=id=>{
    if(nodes.has(id))return nodes.get(id);
    const events=new Map(),node={id,hidden:false,disabled:false,value:id==='object-concept'?'ball':'random',width:480,height:300,style:{},parentElement:{style:{}},textContent:'',
      getContext:()=>pen,addEventListener:(type,fn)=>events.set(type,fn),removeAttribute:()=>{},setAttribute:()=>{},play:async()=>{},
      events,contentWindow:{postMessage:message=>posts.push(message)}};
    nodes.set(id,node);return node;
  };
  const context={SamObserver,CameraSession,URLSearchParams,AbortSignal,crypto:{randomUUID:()=>NEXT},navigator:{mediaDevices:{getUserMedia}},
    location:{search:cameraMode?'?mode=camera':'',origin:'http://localhost'},document:{getElementById:element,createElement:element,querySelectorAll:()=>[],addEventListener:()=>{}},
    addEventListener:(type,fn)=>listeners.set(type,fn),setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>{},
    fetch:async()=>({ok:true,json:async()=>({model:'sam-3.1',live_only:true,available:true,remaining_requests:200,remaining_usd:.5,budget_scene:'vision',price_per_image_usd:.0025})})};
  const source=readFileSync(new URL('../../web/vision/live.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
  vm.runInNewContext(source+'\nglobalThis.testApi={start,stop,newScene,render,observer,getState:()=>({active,starting,runId,resetRequested})};',context);
  const api=context.testApi;
  const message=data=>listeners.get('message')({origin:context.location.origin,source:element('world-frame').contentWindow,data});
  return {api,nodes,posts,message,load:()=>element('world-frame').events.get('load')()};
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
