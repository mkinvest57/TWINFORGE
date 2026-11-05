import test from 'node:test';
import assert from 'node:assert/strict';
import {imagePoint,selectionFromGesture,selectionLabel} from '../../web/vision/selection.mjs';

test('camera tap coordinates use image pixels after CSS scaling and floor to a pixel',()=>{
  const rect={left:20,top:30,width:200,height:100};
  assert.deepEqual(imagePoint(45.3,55.2,rect,800,400),{x:101,y:100});
  assert.deepEqual(imagePoint(219.99,129.99,rect,800,400),{x:799,y:399});
  assert.equal(imagePoint(220,130,rect,800,400),null,'right and bottom edges are outside pixel bounds');
});

test('wide camera images reject taps in top and bottom letterboxing',()=>{
  const rect={left:10,top:20,width:400,height:400};
  assert.equal(imagePoint(210,119.9,rect,400,200),null);
  assert.deepEqual(imagePoint(10,120,rect,400,200),{x:0,y:0});
  assert.deepEqual(imagePoint(409.9,319.9,rect,400,200),{x:399,y:199});
  assert.equal(imagePoint(210,320,rect,400,200),null);
});

test('portrait camera images reject side pillars and account for their offset',()=>{
  const rect={left:10,top:20,width:400,height:400};
  assert.equal(imagePoint(109.9,200,rect,200,400),null);
  assert.deepEqual(imagePoint(110,20,rect,200,400),{x:0,y:0});
  assert.deepEqual(imagePoint(309.9,419.9,rect,200,400),{x:199,y:399});
  assert.equal(imagePoint(310,200,rect,200,400),null);
});

test('unavailable or collapsed image geometry cannot select a pixel',()=>{
  assert.equal(imagePoint(0,0,null,100,100),null);
  assert.equal(imagePoint(0,0,{left:0,top:0,width:0,height:100},100,100),null);
  assert.equal(imagePoint(0,0,{left:0,top:0,width:100,height:100},0,100),null);
});

test('small touch jitter stays a point while a deliberate drag becomes an inclusive box',()=>{
  assert.deepEqual(selectionFromGesture({x:20,y:30},{x:24.8,y:35.9},100,80),{type:'point',x:24,y:35});
  assert.deepEqual(selectionFromGesture({x:40.9,y:50.9},{x:20.1,y:30.1},100,80),{type:'box',x:20,y:30,width:21,height:21});
  assert.deepEqual(selectionFromGesture({x:10,y:10},{x:19,y:10},100,80),{type:'box',x:10,y:10,width:10,height:1});
});

test('drag boxes stay inside the exact submitted image and include its final pixels',()=>{
  assert.deepEqual(selectionFromGesture({x:-10,y:-5},{x:130,y:95},128,96),{type:'box',x:0,y:0,width:128,height:96});
  assert.equal(selectionFromGesture(null,{x:20,y:20},128,96),null);
  assert.equal(selectionFromGesture({x:20,y:20},null,128,96),null);
});

test('selection labels distinguish user-selected objects, regions and the hand concept',()=>{
  assert.equal(selectionLabel({type:'point'},'object'),'Selected object');
  assert.equal(selectionLabel({type:'box'},'object'),'Selected region');
  assert.equal(selectionLabel(null,'hand'),'Hands');
  assert.equal(selectionLabel(null,'bottle'),'bottle');
});
