import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastMotion} from '../../web/vision/motion.mjs';
import {forecast} from '../../web/camera/prediction.mjs';
const rows=(fn,end=3)=>Array.from({length:Math.round(end/.08)+1},(_,i)=>({t:i*.08,point:fn(i*.08),status:'tracking',confidence:.9,trackId:'measured-object'}));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

test('generic learned periodic motion predicts a withheld curved continuation without its frequency as input',()=>{
  const path=t=>({x:200+55*Math.sin(3.8*t),y:130+30*Math.cos(3.8*t)}),observations=rows(path,3.2),errors=[],baseErrors=[];
  for(let sourceTime=1.6;sourceTime<=3.15;sourceTime+=.16){
    const past=observations.filter(o=>o.t<=sourceTime+1e-9),source=past.at(-1).t;
    const a=forecastMotion(past,{sourceTime:source,horizon:.5}),b=forecast(past,{sourceTime:source,horizon:.5});
    if(a.status!=='predicted'||b.status!=='predicted')continue;
    errors.push(distance(a.point,path(source+.5)));baseErrors.push(distance(b.point,path(source+.5)));
  }
  assert.ok(errors.length>=5);assert.ok(errors.reduce((a,b)=>a+b,0)<baseErrors.reduce((a,b)=>a+b,0)*.7);
});

test('future observations and unrelated scene properties cannot influence model selection',()=>{
  const observations=rows(t=>({x:100+30*Math.sin(4*t),y:80+20*Math.cos(4*t)}),3.2),sourceTime=2.4;
  const prefix=observations.filter(o=>o.t<=sourceTime+1e-9),before=structuredClone(prefix);
  const expected=forecastMotion(prefix,{sourceTime,horizon:.5});
  const poisoned=[...prefix,...observations.filter(o=>o.t>sourceTime+1e-9).map(o=>({...o,point:{x:99999,y:-99999},seed:123,force:999}))];
  assert.deepEqual(forecastMotion(poisoned,{sourceTime,horizon:.5}),expected);
  assert.deepEqual(prefix,before);assert.ok(expected.usedTimes.every(t=>t<=sourceTime+1e-9));
});

test('constant observed velocity remains linear and exact at the future target',()=>{
  const path=t=>({x:40+23*t,y:90-8*t}),observations=rows(path,2.4),sourceTime=observations.at(-1).t;
  const prediction=forecastMotion(observations,{sourceTime,horizon:.5});
  assert.equal(prediction.status,'predicted');assert.ok(distance(prediction.point,path(sourceTime+.5))<1e-6);
});

test('short-horizon curvature uses recent pixels instead of lagging a rapidly changing direction',()=>{
  const path=t=>({x:200+50*Math.cos(3*t+t*t),y:150+50*Math.sin(3*t+t*t)}),observations=rows(path,1.2),sourceTime=observations.at(-1).t;
  const prediction=forecastMotion(observations,{sourceTime,horizon:.2}),longFit=forecast(observations,{sourceTime,horizon:.2}),actual=path(sourceTime+.2);
  assert.equal(prediction.status,'predicted');assert.equal(prediction.motionModel,'short_turn');
  assert.ok(distance(prediction.point,actual)<distance(longFit.point,actual)*.4);
  const future={t:sourceTime+.2,point:{x:99999,y:-99999},status:'tracking',confidence:1,trackId:'measured-object'};
  assert.deepEqual(forecastMotion([...observations,future],{sourceTime,horizon:.2}),prediction);
  assert.ok(prediction.usedTimes.every(t=>t<=sourceTime));
});

test('short candidates retain the required six-sample observation gate',()=>{
  const observations=rows(t=>({x:20+30*t,y:90+10*t}),.32);
  assert.equal(observations.length,5);
  assert.equal(forecastMotion(observations,{sourceTime:.32,horizon:.2}).status,'refused');
});

test('validated short motion is usable before the longer linear validation window fills',()=>{
  const path=t=>({x:100+120*t,y:140-260*t+245*t*t}),observations=rows(path,.72),sourceTime=observations.at(-1).t;
  const prediction=forecastMotion(observations,{sourceTime,horizon:.2});
  assert.equal(prediction.status,'predicted');assert.equal(prediction.motionModel,'short_turn');
  assert.equal(prediction.diagnostics.pastTargetErrorsPx.linear,undefined);
  assert.ok(prediction.diagnostics.pastTargetCounts.short_turn>=2);
  assert.ok(distance(prediction.point,path(sourceTime+.2))<8);
});

test('one-second forecast smooths centroid noise while retaining a complete future path',()=>{
  const path=t=>({x:50+23*t,y:90-8*t});
  const observations=Array.from({length:121},(_,i)=>({t:i*.05,point:{x:path(i*.05).x+1.5*Math.sin(i*2.7),y:path(i*.05).y+1.2*Math.sin(i*1.91)},status:'tracking',confidence:.95,trackId:'camera-object'}));
  const errors=[];
  for(let i=60;i<=120;i+=12){
    const prefix=observations.slice(0,i+1),sourceTime=prefix.at(-1).t,p=forecastMotion(prefix,{sourceTime,horizon:1});
    assert.equal(p.status,'predicted');errors.push(distance(p.point,path(sourceTime+1)));
    assert.deepEqual(p.trajectory.map(s=>s.dt),[0,.25,.5,.75,1]);
    assert.deepEqual(p.trajectory[0].point,prefix.at(-1).point);
    assert.deepEqual(p.trajectory.at(-1).point,p.point);
    assert.ok(p.trajectory.every((s,j)=>Number.isFinite(s.uncertaintyPx)&&s.uncertaintyPx>=0&&(!j||s.uncertaintyPx>=p.trajectory[j-1].uncertaintyPx)));
    assert.equal(p.uncertainty.calibrated,false);
  }
  assert.ok(errors.reduce((a,b)=>a+b,0)/errors.length<1.5,'one second must not magnify ordinary measurement noise');
});

test('a repeatedly observed collision boundary influences a one-second prediction without receiving geometry',()=>{
  const path=t=>{const d=(t*120+20)%560;return{x:60+(d<=280?d:560-d),y:130+5*t};};
  const observations=Array.from({length:281},(_,i)=>({t:i*.04,point:path(i*.04),status:'tracking',confidence:.95,trackId:'unknown-puck'}));
  const sourceTime=observations.at(-1).t,p=forecastMotion(observations,{sourceTime,horizon:1});
  assert.equal(p.status,'predicted');
  assert.ok(distance(p.point,path(sourceTime+1))<3,'the future target is after a previously seen rebound');
  assert.ok(p.point.x<observations.at(-1).point.x,'the forecast crosses the next impact and reverses');
  const poison=[...observations,{t:sourceTime+.5,point:{x:999999,y:-999999},status:'tracking',confidence:1,trackId:'unknown-puck',boundary:1}];
  assert.deepEqual(forecastMotion(poison,{sourceTime,horizon:1}),p,'future samples cannot teach the contact model');
});

test('a selected stationary object still has an explicit position forecast',()=>{
  const observations=rows(t=>({x:220+.2*Math.sin(17*t),y:150+.2*Math.cos(13*t)}),2.4),sourceTime=observations.at(-1).t;
  const p=forecastMotion(observations,{sourceTime,horizon:1});
  assert.equal(p.status,'predicted');assert.equal(p.reason,'observed_stationary');assert.ok(distance(p.point,{x:220,y:150})<1);
  assert.ok(p.trajectory.every(s=>Number.isFinite(s.point.x)&&Number.isFinite(s.point.y)));
});

test('a new hand direction is learned from later observations and cannot rewrite the earlier target',()=>{
  const path=t=>t<=2?{x:80+40*t,y:120}:{x:160-35*(t-2),y:120+18*(t-2)};
  const before=rows(path,1.92),source=before.at(-1).t,locked=forecastMotion(before,{sourceTime:source,horizon:1}),copy=structuredClone(locked);
  const after=rows(path,3.2),next=forecastMotion(after,{sourceTime:after.at(-1).t,horizon:1});
  assert.deepEqual(locked,copy);assert.ok(distance(locked.point,path(source+1))>40,'the old forecast cannot know a new human intention');
  assert.equal(next.status,'predicted');assert.ok(distance(next.point,path(after.at(-1).t+1))<10,'observed new motion must replace the previous direction');
});

test('long forecasts retain stale, missing and identity-boundary guards',()=>{
  const observations=rows(t=>({x:80+40*t,y:120+7*t}),2.4),sourceTime=observations.at(-1).t;
  assert.equal(forecastMotion(observations,{sourceTime:sourceTime+.5,horizon:1}).reason,'stale_observation');
  assert.equal(forecastMotion(observations,{sourceTime,horizon:1.1}).reason,'invalid_time_or_horizon');
  const lost=[...observations,{...observations.at(-1),t:sourceTime+.08,status:'lost',point:null}];
  assert.equal(forecastMotion(lost,{sourceTime:sourceTime+.08,horizon:1}).status,'refused');
  const changed=observations.map((o,i)=>i<observations.length-3?o:{...o,trackId:'new-object'});
  assert.equal(forecastMotion(changed,{sourceTime,horizon:1}).reason,'insufficient_samples');
});
