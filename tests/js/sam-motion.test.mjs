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
