/** Exercise the actual scanner controller through its browser boundary.
 * Canvas drawing is a no-op here: these are lifecycle/race tests, not visual
 * evidence or a substitute for a real browser/phone camera test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
  constructor(id=''){this.id=id;this.disabled=false;this.hidden=false;this.textContent='';this.style={};this.listeners=new Map();this.children=[];}
  addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(handler);}
  dispatch(name,event={}){for(const handler of this.listeners.get(name)||[])handler({target:this,currentTarget:this,preventDefault(){},...event});}
  click(){if(!this.disabled)return this.onclick?.({target:this});}
  getBoundingClientRect(){return {left:0,top:0,width:400,height:300};}
  setPointerCapture(){}
  scrollIntoView(){}
  removeAttribute(name){delete this[name];}
  append(child){this.children.push(child);}
  remove(){}
}
class Canvas extends Element{
  constructor(id=''){
    super(id);this.width=400;this.height=300;
    this.context={setTransform(){},clearRect(){},drawImage(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){},setLineDash(){},arc(){},fill(){},fillText(){},
      getImageData:(_x,_y,width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4).fill(80)})};
  }
  getContext(){return this.context;}
}
function stream(){
  const track=new Element();track.stopCount=0;track.stop=()=>{track.stopCount++;};
  return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};
}
let moduleNumber=0;
async function mount(t,{deferPlayback=false}={}){
  const ids=['camera-stage','camera-empty','camera-start','camera-stop','camera-flip','camera-center','camera-reset','camera-export','camera-record',
    'camera-example','camera-file','camera-selection','camera-forecast','camera-confidence','camera-error','camera-source','camera-fps','camera-status',
    'camera-record-status','camera-record-download','mobile-camera-start','mobile-camera-stop','mobile-camera-example'];
  const elements=new Map(ids.map(id=>[id,new Element(id)])),overlay=new Canvas('camera-overlay'),video=new Element('camera-video');
  elements.set(overlay.id,overlay);elements.set(video.id,video);
  const permissions=[],playbacks=[],animation=new Map(),videoFrames=new Map();let callbackId=0;
  Object.assign(video,{paused:true,currentTime:0,videoWidth:640,videoHeight:480,srcObject:null,
    pause(){this.paused=true;},load(){},
    play(){this.paused=false;if(!deferPlayback)return Promise.resolve();const p=deferred();playbacks.push(p);return p.promise;},
    requestVideoFrameCallback(fn){const id=++callbackId;videoFrames.set(id,fn);return id;},
    cancelVideoFrameCallback(id){videoFrames.delete(id);}});
  const document=new Element(),window=new Element();window.isSecureContext=true;
  document.hidden=false;document.body=new Element();document.getElementById=id=>elements.get(id)||null;
  document.createElement=tag=>tag==='canvas'?new Canvas():new Element();
  const globals={document,window,navigator:{mediaDevices:{getUserMedia(constraints){const d=deferred();permissions.push({...d,constraints});return d.promise;}}},
    devicePixelRatio:2,matchMedia:()=>({matches:false}),ResizeObserver:class{observe(){}disconnect(){}},
    requestAnimationFrame(fn){const id=++callbackId;animation.set(id,fn);return id;},cancelAnimationFrame(id){animation.delete(id);}};
  const prior=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  t.after(()=>{
    window.dispatch('pagehide');
    for(const [key,descriptor] of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  });
  await import(new URL(`../../web/camera/scanner.mjs?controller-test=${++moduleNumber}`,import.meta.url));
  return {element:id=>elements.get(id),video,overlay,permissions,playbacks,animation,videoFrames,
    start:()=>elements.get('camera-start').onclick(),stop:()=>elements.get('camera-stop').click(),example:()=>elements.get('camera-example').click()};
}
function pendingButtons(ui){
  for(const id of ['camera-start','mobile-camera-start'])assert.equal(ui.element(id).disabled,true,`${id} stays locked during the current permission request`);
  for(const id of ['camera-stop','mobile-camera-stop'])assert.equal(ui.element(id).disabled,false,`${id} can cancel the pending permission`);
}
function stoppedButtons(ui){
  for(const id of ['camera-start','mobile-camera-start'])assert.equal(ui.element(id).disabled,false);
  for(const id of ['camera-stop','mobile-camera-stop','camera-center','camera-reset','camera-flip','camera-record'])assert.equal(ui.element(id).disabled,true,id);
  assert.equal(ui.element('camera-empty').hidden,false);
}

test('stopping while camera permission is pending leaves both button sets usable after late refusal',async t=>{
  const ui=await mount(t),pending=ui.start();pendingButtons(ui);
  ui.stop();stoppedButtons(ui);const stoppedStatus=ui.element('camera-status').textContent;
  ui.permissions[0].reject({name:'NotAllowedError'});await pending;
  stoppedButtons(ui);assert.equal(ui.element('camera-status').textContent,stoppedStatus);assert.equal(ui.video.srcObject,null);
  assert.equal(ui.animation.size+ui.videoFrames.size,0);
});

test('switching a pending permission request to the example survives late grant without leaking its tracks',async t=>{
  const ui=await mount(t),pending=ui.start();ui.example();const exampleStatus=ui.element('camera-status').textContent;
  const old=stream();ui.permissions[0].resolve(old);await pending;
  assert.equal(old.track.stopCount,1);assert.equal(ui.video.srcObject,null);assert.equal(ui.video.hidden,true);
  assert.equal(ui.element('camera-status').textContent,exampleStatus);assert.match(ui.element('camera-source').textContent,/Exemple synthétique/);
  assert.equal(ui.element('camera-start').disabled,false);assert.equal(ui.element('camera-stop').disabled,false);
  assert.equal(ui.element('camera-center').disabled,false);assert.equal(ui.element('camera-record').disabled,true);
  assert.equal(ui.animation.size,1);assert.equal(ui.videoFrames.size,0);
});

test('late permission refusal leaves the replacement example running with coherent mobile controls',async t=>{
  const ui=await mount(t),pending=ui.start();ui.example();const message=ui.element('camera-status').textContent;
  ui.permissions[0].reject({name:'NotAllowedError'});await pending;
  assert.equal(ui.element('camera-status').textContent,message);assert.match(ui.element('camera-source').textContent,/Exemple synthétique/);
  assert.equal(ui.element('camera-start').disabled,false);assert.equal(ui.element('mobile-camera-start').disabled,false);
  assert.equal(ui.element('camera-stop').disabled,false);assert.equal(ui.element('mobile-camera-stop').disabled,false);
  assert.equal(ui.element('camera-center').disabled,false);assert.equal(ui.element('camera-reset').disabled,false);
  assert.equal(ui.element('camera-empty').hidden,true);assert.equal(ui.animation.size,1);
});

test('a stale playback rejection cannot replace the active example or its buttons',async t=>{
  const ui=await mount(t,{deferPlayback:true}),pending=ui.start(),old=stream();
  ui.permissions[0].resolve(old);await flush();assert.equal(ui.playbacks.length,1);
  ui.example();const message=ui.element('camera-status').textContent;
  ui.playbacks[0].reject({name:'NotAllowedError'});await pending;
  assert.equal(old.track.stopCount,1);assert.equal(ui.element('camera-status').textContent,message);
  assert.match(ui.element('camera-source').textContent,/Exemple synthétique/);assert.equal(ui.animation.size,1);
  assert.equal(ui.element('camera-stop').disabled,false);assert.equal(ui.element('mobile-camera-stop').disabled,false);
  assert.equal(ui.element('camera-start').disabled,false);assert.equal(ui.element('camera-center').disabled,false);
});

test('an older rejected playback cannot unlock buttons for a newer pending camera request',async t=>{
  const ui=await mount(t,{deferPlayback:true}),first=ui.start(),old=stream();
  ui.permissions[0].resolve(old);await flush();ui.stop();const second=ui.start();pendingButtons(ui);
  ui.playbacks[0].reject({name:'NotAllowedError'});await first;pendingButtons(ui);
  assert.match(ui.element('camera-status').textContent,/Autorisez la caméra/);
  ui.stop();ui.permissions[1].reject({name:'NotAllowedError'});await second;stoppedButtons(ui);
});

test('an older playback failure cannot stop the currently active replacement camera stream',async t=>{
  const ui=await mount(t,{deferPlayback:true}),first=ui.start(),old=stream();
  ui.permissions[0].resolve(old);await flush();ui.stop();const second=ui.start(),current=stream();
  ui.permissions[1].resolve(current);await flush();assert.equal(ui.playbacks.length,2);
  ui.playbacks[1].resolve();await second;
  assert.equal(ui.video.srcObject,current);assert.equal(current.track.stopCount,0);const message=ui.element('camera-status').textContent;
  ui.playbacks[0].reject({name:'NotAllowedError'});await first;
  assert.equal(ui.video.srcObject,current);assert.equal(current.track.stopCount,0);assert.equal(old.track.stopCount,1);
  assert.equal(ui.element('camera-status').textContent,message);assert.equal(ui.element('camera-record').disabled,false);
  assert.equal(ui.element('camera-flip').disabled,false);assert.equal(ui.element('camera-stop').disabled,false);assert.equal(ui.videoFrames.size,1);
});

test('pointer events completing an interrupted selection after stop cannot select a stale frame or throw',async t=>{
  const ui=await mount(t);ui.example();
  ui.overlay.dispatch('pointerdown',{pointerId:7,clientX:150,clientY:100});
  ui.overlay.dispatch('pointermove',{pointerId:7,clientX:210,clientY:170});
  ui.stop();
  assert.doesNotThrow(()=>{
    ui.overlay.dispatch('pointermove',{pointerId:7,clientX:215,clientY:175});
    ui.overlay.dispatch('pointerup',{pointerId:7,clientX:215,clientY:175});
    ui.overlay.dispatch('pointercancel',{pointerId:7});
    ui.overlay.dispatch('pointerdown',{pointerId:8,clientX:100,clientY:100});
    ui.overlay.dispatch('pointerup',{pointerId:8});
  });
  stoppedButtons(ui);assert.equal(ui.element('camera-export').disabled,true);assert.equal(ui.animation.size+ui.videoFrames.size,0);
});
