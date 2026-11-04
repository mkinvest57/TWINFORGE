import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import jpeg from 'jpeg-js';
import {encodeSegmentationMask} from '../node_modules/@meta-sam/parser/dist/mask-codec.js';
import {initializeBudget, summary, reserve, settle} from '../src/budget.mjs';
import {validateFrame, readBoundedBody, MAX_BODY_BYTES} from '../src/frame.mjs';
import {segment, samStatus, detectionsFromText} from '../src/sam.mjs';

function sqlite(path) {
  const process = spawn('python3', [new URL('./sqlite-bridge.py', import.meta.url).pathname, path], {stdio:['pipe','pipe','inherit']});
  const waiting = new Map(); let serial = 0;
  createInterface({input:process.stdout}).on('line', line => {
    const result = JSON.parse(line), call = waiting.get(result.id); waiting.delete(result.id);
    result.error ? call.reject(new Error(result.error)) : call.resolve(result.result);
  });
  const call = value => new Promise((resolve, reject) => {
    const id = serial++; waiting.set(id, {resolve, reject}); process.stdin.write(JSON.stringify({...value, id}) + '\n');
  });
  return {
    prepare(sql) { return {bind(...params) { return {first:() => call({sql,params,kind:'first'}), run:() => call({sql,params,kind:'run'})}; }, first:() => call({sql,kind:'first'}), run:() => call({sql,kind:'run'})}; },
    script:script => call({script}), close:() => process.stdin.end(),
  };
}
async function environment(t, initial = '0') {
  const folder = await mkdtemp(join(tmpdir(), 'tf-worker-test-'));
  const path = join(folder, 'vision.sqlite'), db = sqlite(path);
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(p => p.endsWith('.sql')).sort();
  assert.equal(migrations.length, 1);
  await db.script(await readFile(new URL('../drizzle/' + migrations[0], import.meta.url), 'utf8'));
  t.after(async () => {db.close(); await rm(folder, {recursive:true, force:true});});
  return {DB:db, INITIAL_VISION_SPENT_UNITS:initial, META_MODEL_API_KEY:'test-placeholder', path};
}
const RUN = '11111111-1111-4111-8111-111111111111';
const image = jpeg.encode({width:64,height:64,data:Buffer.from(Array.from({length:64*64}, () => [180,70,30,255]).flat())}, 90).data;
const payload = changes => ({image_base64:image.toString('base64'), concept:'ball', frame_id:'frame-0', source_time_s:0, run_id:RUN, source_kind:'synthetic', ...changes});
const request = body => new Request('https://private.example/api/sam/segment', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const mask = encodeSegmentationMask(Uint8Array.from([1,1,0,1,0,0,0,0,0]),3,3);
const WIRE = '<0f>1<|box;x1=10;y1=20;x2=12;y2=22;w=64;h=64|><|mask;x=0;y=0;data=3,3,' + mask.payload + '|>';
const providerResponse = text => Response.json({status:'completed',output:[{content:[{type:'output_text',text}]}]});
const fakeFrame = (n=0,run=RUN) => ({run_id:run,frame_id:'frame-'+n,source_time_s:n,source_kind:'synthetic',image_sha256:'a'.repeat(64)});

test('validates actual JPEG bytes and forbids hidden simulator state before any call', async () => {
  const frame = await validateFrame(payload()); assert.equal(frame.width,64); assert.equal(frame.image.data.length,64*64*3);
  for (const change of [{seed:2},{positions:[]},{velocity:[1,2]},{source_time_s:NaN},{source_time_s:true},{concept:'ball, cup'},{run_id:'BAD'},{image_base64:'png'}, {image_base64:jpeg.encode({width:641,height:16,data:Buffer.alloc(641*16*4)},70).data.toString('base64')}]) {
    await assert.rejects(validateFrame(payload(change)), error => error.status===400);
  }
  await assert.rejects(readBoundedBody(new Request('https://x',{method:'POST',body:'{}'})), error => error.status===415);
  await assert.rejects(readBoundedBody(new Request('https://x',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(MAX_BODY_BYTES+1)})), error => error.status===413);
});

test('real official mask decoder computes a foreground centroid, contour and image color', async () => {
  const frame = await validateFrame(payload()), result = await detectionsFromText(WIRE,frame);
  assert.equal(result.length,1); assert.equal(result[0].area,3);
  assert.deepEqual(result[0].box,{x1:10,y1:20,x2:13,y2:23});
  assert.deepEqual(result[0].centroid,[10+1/3,20+1/3]);
  assert.ok(result[0].polygons.length); assert.ok(result[0].color_rgb[0]>170);
  await assert.rejects(detectionsFromText(WIRE.replace('w=64','w=320'),frame),/coordinates/);
  await assert.rejects(detectionsFromText(WIRE.split('<|mask')[0],frame),/mask missing/);
  await assert.rejects(detectionsFromText(WIRE.replace('data=3,3,','data=999999999,999999999,'),frame),/raster exceeds/);
});

test('provider receives only image and concept; hashed result is durable and duplicate cannot bill twice', async t => {
  const env = await environment(t); let calls = 0;
  const provider = async (url,options) => {
    calls++; assert.equal(url,'https://api.meta.ai/v1/responses');
    const sent = JSON.parse(options.body);
    assert.deepEqual(sent,{model:'sam-3.1',input:[{role:'user',content:[{type:'input_text',text:'ball'},{type:'input_image',image_url:'data:image/jpeg;base64,'+payload().image_base64}]}]});
    return providerResponse(WIRE);
  };
  const result = await segment(request(payload()), env, provider);
  assert.equal(calls,1); assert.equal(result.live_provider_call,true); assert.equal(result.charged_usd,.0025);
  assert.match(result.receipt.request_sha256,/^[a-f0-9]{64}$/); assert.equal(result.budget.scenes.vision,.0025);
  const saved = await env.DB.prepare('SELECT result_json, response_sha256, status FROM vision_requests WHERE id=?').bind(result.evidence_id).first();
  assert.equal(saved.status,'complete'); assert.match(saved.response_sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(saved.result_json).image_sha256,result.image_sha256);
  await assert.rejects(segment(request(payload()),env,provider),/already submitted/); assert.equal(calls,1);
});

test('provider failures remain charged and never produce synthetic detections', async t => {
  const env = await environment(t);
  await assert.rejects(segment(request(payload()),env,async()=>new Response('private details',{status:503})),/HTTP 503/);
  assert.equal((await summary(env)).scenes.vision,.0025);
  assert.equal((await env.DB.prepare('SELECT status FROM vision_requests').first()).status,'failed');
  const result = await segment(request(payload({frame_id:'frame-1',source_time_s:1})),env,async()=>providerResponse(''));
  assert.equal(result.status,'no_matches'); assert.deepEqual(result.detections,[]);
});

test('atomic reservations across separate SQLite connections enforce global cap and imported baseline cannot decrease', async t => {
  const env = await environment(t,'4975'); await initializeBudget(env);
  const second = sqlite(env.path); t.after(()=>second.close());
  const env2 = {...env,DB:second};
  const results = await Promise.allSettled([reserve(env,fakeFrame(),'b'.repeat(64)),reserve(env2,fakeFrame(1,crypto.randomUUID()),'c'.repeat(64))]);
  assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
  assert.equal((await summary(env)).scenes.vision,.5);
  await initializeBudget({...env,INITIAL_VISION_SPENT_UNITS:'0'});
  assert.equal((await summary(env)).scenes.vision,.5);
  assert.equal((await samStatus(env)).remaining_requests,0);
  await assert.rejects(reserve(env,fakeFrame(2,crypto.randomUUID()),'d'.repeat(64)),/exhausted/);
});

test('per-run quota and in-flight limit survive new service instances while global budget spans runs', async t => {
  const env = await environment(t); await initializeBudget(env);
  const first = await reserve(env,fakeFrame(),'b'.repeat(64));
  await assert.rejects(reserve(env,fakeFrame(1),'c'.repeat(64)),error=>error.status===429&&error.detail.code==='sam_busy'&&error.detail.provider_call_made===false);
  await settle(env,first,'failed');
  for(let i=1;i<60;i++) { const id=await reserve(env,fakeFrame(i),'b'.repeat(64)); await settle(env,id,'complete'); }
  await assert.rejects(reserve(env,fakeFrame(60),'b'.repeat(64)),/60-image/);
  const newRun = await reserve(env,fakeFrame(0,crypto.randomUUID()),'b'.repeat(64)); await settle(env,newRun,'complete');
  assert.equal((await summary(env)).scenes.vision,.1525);
  assert.equal((await summary(env)).requests,61);
});

test('missing credentials, baseline or persistent storage disables hosted SAM', async () => {
  assert.equal((await samStatus({})).available,false);
  assert.equal((await samStatus({META_MODEL_API_KEY:'test',INITIAL_VISION_SPENT_UNITS:'0'})).available,false);
  await assert.rejects(initializeBudget({INITIAL_VISION_SPENT_UNITS:'0.5'}),/existing vision spend/);
});
