import test from 'node:test';
import assert from 'node:assert/strict';
import {createTracker} from '../../web/camera/tracker.mjs';
import {forecast,assessForecast} from '../../web/camera/prediction.mjs';

function random(seed){let x=seed>>>0;return ()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};}
function fixture({width=160,height=120,rgba=false}={}){
  const rng=random(4719),background=Uint8Array.from({length:width*height},()=>Math.floor(30+rng()*110));
  const pattern=Uint8Array.from({length:20*18},()=>Math.floor(30+rng()*225));
  function frame(objects=[{x:38,y:42}],{shiftX=0,shiftY=0}={}){
    const grey=new Uint8Array(background);
    for(const p of objects)for(let y=0;y<18;y++)for(let x=0;x<20;x++)if(p.x+x>=0&&p.x+x<width&&p.y+y>=0&&p.y+y<height)grey[(p.y+y)*width+p.x+x]=pattern[y*20+x];
    const shifted=new Uint8Array(grey.length);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sx=x-shiftX,sy=y-shiftY;shifted[y*width+x]=sx>=0&&sy>=0&&sx<width&&sy<height?grey[sy*width+sx]:60;}
    if(!rgba)return {width,height,data:shifted};
    // Blue/green texture, deliberately not a coloured-ball detector.
    const data=new Uint8ClampedArray(width*height*4);
    shifted.forEach((v,i)=>{data[i*4]=v*.25;data[i*4+1]=v;data[i*4+2]=255-v*.4;data[i*4+3]=255;});
    return {width,height,data};
  }
  return {frame,roi:{x:38,y:42,width:20,height:18}};
}
const close=(p,x,y,tolerance=.8)=>assert.ok(Math.hypot(p.x-x,p.y-y)<tolerance,`${JSON.stringify(p)} expected (${x}, ${y})`);
const observations=(times,fn)=>times.map(t=>({t,point:fn(t),confidence:.95,status:'tracking',trackId:1}));
const timeGrid=(count,step=.05)=>Array.from({length:count},(_,i)=>i*step);

test('deterministic grey and non-orange RGBA patch tracking follows observed acceleration',()=>{
  for(const rgba of [false,true]){
    const f=fixture({rgba}),a=createTracker(),b=createTracker();
    assert.deepEqual(a.select(f.frame(),f.roi,0),b.select(f.frame(),f.roi,0));
    for(let i=1;i<=14;i++){
      const x=38+Math.round(i*.8+i*i*.1),y=42+Math.round(i*.45),frame=f.frame([{x,y}]);
      const actual=a.update(frame,i*.05),repeat=b.update(frame,i*.05);
      assert.deepEqual(actual,repeat);assert.equal(actual.status,'tracking',JSON.stringify({i,rgba,actual}));close(actual.point,x+10,y+9);
      assert.ok(actual.confidence>.5);assert.equal(actual.units,'px');
    }
  }
});

test('occlusion emits no invented position and bounded reappearance is explicitly identity-unverified',()=>{
  const f=fixture(),tracker=createTracker();tracker.select(f.frame(),f.roi,0);
  const seen=tracker.update(f.frame([{x:41,y:43}]),.05);assert.equal(seen.status,'tracking',JSON.stringify(seen));
  const hidden=tracker.update(f.frame([]),.1);assert.equal(hidden.status,'lost');assert.equal(hidden.point,null);assert.equal(hidden.box,null);
  const back=tracker.update(f.frame([{x:46,y:45}]),.15);assert.equal(back.status,'tracking');close(back.point,56,54);
  assert.equal(back.reason,'reacquired_appearance_identity_unverified');assert.equal(back.identityGuaranteed,false);
  const expired=tracker.update(f.frame([{x:48,y:46}]),1.);assert.equal(expired.point,null);assert.equal(expired.requiresReselection,true);
});

test('two identical plausible patches are refused rather than assigned an assured identity',()=>{
  const f=fixture(),tracker=createTracker();tracker.select(f.frame(),f.roi,0);
  const ambiguous=tracker.update(f.frame([{x:24,y:42},{x:52,y:42}]),.05);
  assert.equal(ambiguous.status,'lost');assert.equal(ambiguous.reason,'ambiguous_match');assert.equal(ambiguous.point,null);
});

test('coherent camera translation is latched until a new explicit selection',()=>{
  const f=fixture(),tracker=createTracker();tracker.select(f.frame(),f.roi,0);
  const moved=tracker.update(f.frame(undefined,{shiftX:3,shiftY:2}),.05);
  assert.equal(moved.status,'camera_moving');assert.equal(moved.point,null);assert.equal(moved.requiresReselection,true);
  assert.equal(tracker.update(f.frame(),.1).status,'camera_moving');
  assert.equal(tracker.select(f.frame(),f.roi,.15).status,'tracking');
});

test('distributed background motion also refuses a false stationary-camera forecast',()=>{
  const f=fixture(),initial=f.frame(),tracker=createTracker();tracker.select(initial,f.roi,0);
  const shifted={...initial,data:new Uint8Array(initial.data.length)};
  for(let y=0;y<initial.height;y++)for(let x=0;x<initial.width;x++){
    const dx=y<initial.height/2?-3:3,sx=x-dx;
    shifted.data[y*initial.width+x]=sx>=0&&sx<initial.width?initial.data[y*initial.width+sx]:60;
  }
  const result=tracker.update(shifted,.05);assert.equal(result.status,'camera_moving');assert.equal(result.point,null);
});

test('uniform selection, changed dimensions, duplicate times and reset are explicit refusals',()=>{
  const tracker=createTracker(),f=fixture();
  assert.equal(tracker.select({width:80,height:60,data:new Uint8Array(4800).fill(90)},{x:10,y:10,width:20,height:20},0).reason,'low_texture');
  tracker.select(f.frame(),f.roi,1);
  assert.equal(tracker.update(f.frame(),1).reason,'non_increasing_timestamp');
  assert.equal(tracker.update(f.frame([{x:40,y:42}]),1.05).status,'tracking');
  assert.equal(tracker.update(fixture({width:180}).frame(),1.1).reason,'frame_dimensions_changed');
  tracker.reset();assert.equal(tracker.update(f.frame(),1.2).reason,'no_selection');
});

test('downsampled tracking reports source-resolution coordinates, not internal coordinates',()=>{
  const f=fixture(),small=f.frame();
  const enlarge=frame=>{
    const data=new Uint8Array(frame.width*2*frame.height*2);
    for(let y=0;y<frame.height*2;y++)for(let x=0;x<frame.width*2;x++)data[y*frame.width*2+x]=frame.data[Math.floor(y/2)*frame.width+Math.floor(x/2)];
    return {width:frame.width*2,height:frame.height*2,data};
  };
  const tracker=createTracker({maxDimension:160});tracker.select(enlarge(small),{x:76,y:84,width:40,height:36},0);
  const actual=tracker.update(enlarge(f.frame([{x:42,y:45}])),.05);assert.equal(actual.status,'tracking');close(actual.point,104,108,1.6);
});

test('tracker uses real elapsed timestamps across dropped frames',()=>{
  const f=fixture(),tracker=createTracker();tracker.select(f.frame(),f.roi,0);
  for(const t of [.04,.08,.2,.24]){
    const x=38+Math.round(40*t),y=42+Math.round(10*t),result=tracker.update(f.frame([{x,y}]),t);
    assert.equal(result.status,'tracking');close(result.point,x+10,y+9);
  }
});

test('constant velocity and accelerated pixel forecasts use past observations only',()=>{
  for(const fn of [t=>({x:20+30*t,y:50-12*t}),t=>({x:20+22*t+40*t*t,y:50-8*t+18*t*t})]){
    const input=observations(timeGrid(25),fn),sourceTime=.5,result=forecast(input,{sourceTime});
    assert.equal(result.status,'predicted');close(result.point,fn(1).x,fn(1).y,1e-6);
    assert.ok(result.usedTimes.every(t=>t<=sourceTime));assert.equal(result.units,'px');
    const corrupted=input.map(s=>s.t>sourceTime?{...s,point:{x:1e9,y:-1e9},status:'camera_moving',trackId:99}:s);
    assert.deepEqual(forecast(corrupted,{sourceTime}),result);
  }
});

test('irregular/drop timestamps are fitted in seconds and forecasts keep the same future target',()=>{
  const fn=t=>({x:10+40*t+12*t*t,y:30+18*t-8*t*t});
  const times=[0,.03,.07,.11,.17,.22,.31,.37,.43,.5,.55,.6,.7,.8,.9,1.,1.1];
  const result=forecast(observations(times,fn),{sourceTime:.5});assert.equal(result.status,'predicted');close(result.point,fn(1).x,fn(1).y,1e-6);
  const regular=forecast(observations(timeGrid(23),fn),{sourceTime:.5});assert.equal(regular.targetTime,result.targetTime);close(regular.point,result.point.x,result.point.y,1e-6);
});

test('stationary motion, occlusion, sample shortage, stale age and duplicate times refuse prediction',()=>{
  const input=observations(timeGrid(15),t=>({x:10+40*t,y:30-20*t}));
  assert.equal(forecast(input.slice(0,4)).reason,'insufficient_samples');
  assert.equal(forecast(observations(timeGrid(15),()=>({x:10,y:20}))).reason,'stationary_or_low_motion');
  assert.equal(forecast(input,{sourceTime:1}).reason,'stale_observation');
  const lost=structuredClone(input);lost.at(-1).point=null;lost.at(-1).status='lost';assert.equal(forecast(lost).reason,'tracking_interrupted');
  const duplicate=structuredClone(input);duplicate[10].t=duplicate[9].t;assert.equal(forecast(duplicate).reason,'non_increasing_timestamps');
  const changed=structuredClone(input);changed.slice(-3).forEach(s=>s.trackId=2);assert.equal(forecast(changed).reason,'insufficient_samples');
});

test('uncertainty and confidence respond to horizon and age without fabricated physical units',()=>{
  const input=observations(timeGrid(15),t=>({x:10+40*t,y:20+10*t}));
  const short=forecast(input,{horizon:.2}),long=forecast(input,{horizon:.5}),older=forecast(input,{sourceTime:.77});
  assert.equal(older.status,'predicted');assert.ok(long.uncertaintyPx>short.uncertaintyPx);assert.ok(long.confidence<short.confidence);assert.ok(older.confidence<long.confidence);
  assert.equal(long.position_m,undefined);assert.equal(long.error_cm,undefined);
});

test('an unexplained position jump increases uncertainty instead of silently projecting a precise trajectory',()=>{
  const input=observations(timeGrid(15),t=>({x:10+40*t,y:20+10*t}));input[10].point={x:170,y:50};
  const result=forecast(input);assert.equal(result.status,'refused');assert.equal(result.reason,'forecast_uncertain');assert.equal(result.point,null);
});

test('a sequence of measured tracked positions feeds a future pixel prediction and retrospective score',()=>{
  const f=fixture(),tracker=createTracker(),history=[];
  history.push(tracker.select(f.frame(),f.roi,0));
  for(let i=1;i<=20;i++)history.push(tracker.update(f.frame([{x:38+i,y:42}]),i*.05));
  const result=forecast(history,{sourceTime:.5});assert.equal(result.status,'predicted');
  const assessment=assessForecast(result,history,{availableTime:1});assert.equal(assessment.status,'scored');assert.ok(assessment.errorPx<1);
});

test('retrospective assessment waits for target and preserves large errors on identical target cohorts',()=>{
  const fn=t=>({x:20+30*t,y:50-12*t}),input=observations(timeGrid(25),fn),result=forecast(input,{sourceTime:.5});
  assert.equal(assessForecast(result,input,{availableTime:.95}),null);
  const correct=assessForecast(result,input,{availableTime:1});assert.equal(correct.status,'scored');assert.ok(correct.errorPx<1e-6);
  const wrong={...result,point:{x:result.point.x+100,y:result.point.y}};
  const bad=assessForecast(wrong,input,{availableTime:1});assert.equal(bad.status,'scored');assert.equal(bad.targetTime,correct.targetTime);assert.ok(Math.abs(bad.errorPx-100)<1e-6);
  const interrupted=structuredClone(input);interrupted[13].status='lost';interrupted[13].point=null;assert.equal(assessForecast(result,interrupted,{availableTime:1}).reason,'tracking_interrupted');
  const changed=structuredClone(input);changed.slice(13).forEach(s=>s.trackId=2);assert.equal(assessForecast(result,changed,{availableTime:1}).reason,'selection_changed');
});
