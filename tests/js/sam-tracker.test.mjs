import test from 'node:test';
import assert from 'node:assert/strict';
import {createSamTracker} from '../../web/vision/sam-tracker.mjs';
import {createTracker} from '../../web/camera/tracker.mjs';
function scene(objects,{width=180,height=120}={}){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++){data[i*4]=80;data[i*4+1]=80;data[i*4+2]=80;data[i*4+3]=255;}
  for(const o of objects)for(let y=Math.max(0,o.y-8);y<Math.min(height,o.y+8);y++)for(let x=Math.max(0,o.x-8);x<Math.min(width,o.x+8);x++)if(Math.hypot(x+.5-o.x,y+.5-o.y)<=8){data.set([...o.rgb,255],(y*width+x)*4);}
  return {width,height,data};
}
const red=[215,40,65],blue=[35,110,220];
const mask=(x,y)=>[Array.from({length:24},(_,i)=>[x+8*Math.cos(i*Math.PI/12),y+8*Math.sin(i*Math.PI/12)])];
const roi=(x,y)=>({x:x-8,y:y-8,width:16,height:16});

test('SAM color anchor follows identical shapes with different colors through crossing paths',()=>{
  const tracker=createSamTracker({samMaskPolygons:mask(45,48),maxSearchRadiusPx:28});
  assert.equal(tracker.select(scene([{x:45,y:48,rgb:red},{x:115,y:70,rgb:blue}]),roi(45,48),0).reason,'sam_mask_color_anchor');
  for(let i=1;i<=14;i++){
    const result=tracker.update(scene([{x:45+i*5,y:48,rgb:red},{x:115-i*5,y:70,rgb:blue}]),i*.08);
    assert.equal(result.status,'tracking',JSON.stringify(result));assert.ok(Math.hypot(result.point.x-(45+i*5),result.point.y-48)<.1);
    assert.equal(result.reason,'sam_color_component');assert.equal(result.identityGuaranteed,false);
  }
});

test('a textureless colored mask can track without inventing grayscale texture',()=>{
  const tracker=createSamTracker({samMaskPolygons:mask(60,50)}),first=scene([{x:60,y:50,rgb:blue}]);
  const selected=tracker.select(first,roi(60,50),0);assert.equal(selected.status,'tracking');
  const moved=tracker.update(scene([{x:64,y:52,rgb:blue}]),.08);
  assert.equal(moved.status,'tracking');assert.ok(Math.hypot(moved.point.x-64,moved.point.y-52)<.1);
});

test('ambiguous same-color candidates and occlusion stop until a fresh SAM anchor',()=>{
  for(const objects of [[{x:40,y:50,rgb:red},{x:72,y:50,rgb:red}],[]]){
    const tracker=createSamTracker({samMaskPolygons:mask(56,50),maxSearchRadiusPx:32});
    tracker.select(scene([{x:56,y:50,rgb:red}]),roi(56,50),0);
    const failed=tracker.update(scene(objects),.08);
    assert.equal(failed.status,'lost');assert.equal(failed.point,null);assert.equal(failed.requiresReselection,true);
    assert.equal(failed.reason,objects.length?'ambiguous_color_components':'color_component_occluded_or_missing');
    assert.equal(tracker.update(scene([{x:58,y:50,rgb:red}]),.16).point,null);
  }
});

test('gray pixels retain the existing NCC tracker and missing SAM polygons cannot activate color tracking',()=>{
  const width=120,height=90,patch=Uint8Array.from({length:20*18},(_,i)=>(i*73+i*i*13)%220+20);
  function frame(x){const data=new Uint8Array(width*height).fill(70);for(let y=0;y<18;y++)for(let xx=0;xx<20;xx++)data[(30+y)*width+x+xx]=patch[y*20+xx];return{width,height,data};}
  const options={samMaskPolygons:[[[35,30],[55,30],[55,48],[35,48]]]},wrapped=createSamTracker(options),ncc=createTracker(options),box={x:35,y:30,width:20,height:18};
  assert.deepEqual(wrapped.select(frame(35),box,0),ncc.select(frame(35),box,0));
  assert.deepEqual(wrapped.update(frame(38),.08),ncc.update(frame(38),.08));
  const noMask=createSamTracker().select(scene([{x:60,y:50,rgb:red}]),roi(60,50),0);
  assert.notEqual(noMask.reason,'sam_mask_color_anchor');
});

test('color tracking preserves the existing coherent-background camera-motion refusal',()=>{
  const initial=scene([{x:60,y:50,rgb:red}]);
  for(let i=0;i<initial.width*initial.height;i++)if(initial.data[i*4]===initial.data[i*4+1]){
    const v=25+(i*47+Math.floor(i/initial.width)*79)%160;initial.data[i*4]=initial.data[i*4+1]=initial.data[i*4+2]=v;
  }
  const moved={...initial,data:new Uint8ClampedArray(initial.data.length).fill(80)};
  for(let y=2;y<initial.height;y++)for(let x=3;x<initial.width;x++)for(let k=0;k<4;k++)moved.data[(y*initial.width+x)*4+k]=initial.data[((y-2)*initial.width+x-3)*4+k];
  const tracker=createSamTracker({samMaskPolygons:mask(60,50)});tracker.select(initial,roi(60,50),0);
  const result=tracker.update(moved,.08);assert.equal(result.status,'camera_moving');assert.equal(result.point,null);assert.equal(result.requiresReselection,true);
});
