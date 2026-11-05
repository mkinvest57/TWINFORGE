import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeatureFlowTracker} from '../../web/vision/feature-flow.mjs';
import {createSamTracker} from '../../web/vision/sam-tracker.mjs';
const W=240,H=160;
function image({dx=0,dy=0,scale=1,hidden=false,brightness=0}={}){
  const data=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const u=(x-100-dx)/scale+100,v=(y-80-dy)/scale+80,k=(y*W+x)*4;
    let val=27;
    if(!hidden&&u>=70&&u<130&&v>=40&&v<120)val=120+45*Math.sin(u*.57)+35*Math.sin(v*.67)+25*Math.cos((u+v)*.39);
    data[k]=data[k+1]=data[k+2]=Math.min(255,Math.max(0,val+brightness));data[k+3]=255;
  }return {width:W,height:H,data};
}
const roi={x:70,y:40,width:60,height:80},mask=[[[70,40],[130,40],[130,120],[70,120]]];

test('SAM feature flow tracks arbitrary grayscale texture through translation without a color assumption',()=>{
 const t=createFeatureFlowTracker({samMaskPolygons:mask});assert.equal(t.select(image(),roi,0).status,'tracking');
 for(let i=1;i<=12;i++){
   const r=t.update(image({dx:i*2,dy:i*.6,brightness:i*.7}),i/30);
   assert.equal(r.status,'tracking',JSON.stringify(r));assert.ok(Math.abs(r.point.x-(100+i*2))<1.5);assert.ok(Math.abs(r.point.y-(80+i*.6))<1.5);
   assert.equal(r.diagnostics.forwardBackwardChecked,true);
 }
});
test('feature flow measures changing scale and is selected for video objects',()=>{
 const t=createSamTracker({samMaskPolygons:mask,sourceKind:'video'});const first=t.select(image(),roi,0);assert.equal(first.reason,'sam_mask_feature_anchor');
 let r;for(let i=1;i<=8;i++)r=t.update(image({dx:i*.8,dy:i*.25,scale:1+i*.012}),i/30);
 assert.equal(r.status,'tracking');assert.ok(r.box.width>63);assert.ok(Math.abs(r.point.x-106.4)<2);
});
test('feature tracker refuses a vanished object rather than outputting its extrapolated position',()=>{
 const t=createFeatureFlowTracker({samMaskPolygons:mask});t.select(image(),roi,0);
 const r=t.update(image({hidden:true}),1/30);assert.equal(r.status,'lost');assert.equal(r.point,null);
});
test('scale changes preserve the object center when its texture lies on one side',()=>{
 const asymmetricRoi={x:60,y:30,width:140,height:100};
 const t=createFeatureFlowTracker({samMaskPolygons:[[[60,30],[200,30],[200,130],[60,130]]]});
 assert.equal(t.select(image(),asymmetricRoi,0).status,'tracking');
 for(let i=1;i<=20;i++){
   const scale=1+i*.012,r=t.update(image({scale,dx:i*.25}),i/30);
   assert.equal(r.status,'tracking');
   assert.ok(Math.abs(r.point.x-(100+30*scale+i*.25))<2,JSON.stringify(r));
   assert.ok(Math.abs(r.point.y-80)<2);
 }
});
