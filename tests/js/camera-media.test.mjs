import test from 'node:test';
import assert from 'node:assert/strict';
import {CameraSession,pointInImage,recordingMime,cameraErrorMessage} from '../../web/camera/media.mjs';
test('camera capture requests no audio and prefers rear camera',async()=>{
  let constraints,stopped=0;
  const stream={getTracks:()=>[{stop:()=>stopped++}]};
  const session=new CameraSession({getUserMedia:async c=>{constraints=c;return stream;}});
  assert.equal(await session.start(),stream);assert.equal(constraints.audio,false);
  assert.equal(constraints.video.facingMode.ideal,'environment');
  session.stop();assert.equal(stopped,1);assert.equal(session.stream,null);
});
test('late camera permission after cancellation stops every track',async()=>{
  let resolve,stopped=0;
  const session=new CameraSession({getUserMedia:()=>new Promise(r=>resolve=r)});
  const pending=session.start();session.stop();
  resolve({getTracks:()=>[{stop:()=>stopped++},{stop:()=>stopped++}]});
  assert.equal(await pending,null);assert.equal(stopped,2);
});
test('overconstrained capture retries video-only while permission refusal never retries',async()=>{
  let calls=[];
  const session=new CameraSession({getUserMedia:async c=>{calls.push(c);if(calls.length===1)throw {name:'OverconstrainedError'};return{getTracks:()=>[]};}});
  await session.start('user');assert.equal(calls.length,2);assert.equal(calls[1].audio,false);assert.equal(calls[1].video.facingMode.ideal,'user');
  let count=0;const denied=new CameraSession({getUserMedia:async()=>{count++;throw{name:'NotAllowedError'};}});
  await assert.rejects(denied.start());assert.equal(count,1);
});
test('tap coordinates exclude letterbox and stay aligned after rotation',()=>{
  const box={left:10,top:20,width:400,height:400};
  assert.equal(pointInImage(20,30,box,640,480),null);
  assert.deepEqual(pointInImage(210,220,box,640,480),{x:320,y:240});
  assert.deepEqual(pointInImage(210,220,box,480,640),{x:240,y:320});
});
test('recording negotiates a supported Safari MP4 or browser default and reports denied camera',()=>{
  assert.equal(recordingMime({isTypeSupported:t=>t==='video/mp4'}),'video/mp4');
  assert.equal(recordingMime({isTypeSupported:()=>false}),'');
  assert.equal(recordingMime(null),null);assert.match(cameraErrorMessage({name:'NotAllowedError'}),/refusé/);
});

