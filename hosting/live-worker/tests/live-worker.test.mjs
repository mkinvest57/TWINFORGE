import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import jpeg from 'jpeg-js';
import {encodeSegmentationMask} from '../node_modules/@meta-sam/parser/dist/mask-codec.js';
import {initializeBudget, summary, reserve, settle, limitUnits, HttpError, IN_FLIGHT_LEASE_MS} from '../src/budget.mjs';
import {validateFrame, readBoundedBody, MAX_BODY_BYTES, buildSamPrompt} from '../src/frame.mjs';
import {segment, samStatus, detectionsFromText} from '../src/sam.mjs';
import {createHandler} from '../src/http.mjs';

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
async function environment(t, initial = '0', migrationCount = Infinity) {
  const folder = await mkdtemp(join(tmpdir(), 'tf-worker-test-'));
  const path = join(folder, 'vision.sqlite'), db = sqlite(path);
  t.after(async () => {db.close(); await rm(folder, {recursive:true, force:true});});
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(p => p.endsWith('.sql')).sort();
  assert.ok(migrations.length >= 2);
  for (const migration of migrations.slice(0,migrationCount)) {
    await db.script(await readFile(new URL('../drizzle/' + migration, import.meta.url), 'utf8'));
  }
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

test('native SAM selections use full JPEG pixel coordinates and inclusive box endpoints', async () => {
  const point = await validateFrame(payload({selection:{type:'point',x:0,y:63},source_kind:'camera'}));
  assert.equal(buildSamPrompt(point), '<0f>1<|point;x=0;y=63;w=64;h=64|>');
  const box = await validateFrame(payload({selection:{type:'box',x:10,y:20,width:3,height:3},source_kind:'video'}));
  assert.equal(buildSamPrompt(box), '<0f>1<|box;x1=10;y1=20;x2=12;y2=22;w=64;h=64|>');
  assert.equal(buildSamPrompt(await validateFrame(payload({selection:null,concept:'hand'}))), 'hand');
  for (const selection of [{type:'point',x:64,y:0},{type:'point',x:2.5,y:3},{type:'point',x:true,y:3},
    {type:'point',x:1,y:1,seed:5},{type:'box',x:63,y:1,width:2,height:2},{type:'box',x:1,y:1,width:0,height:5},
    {type:'mask',text:'injected'},[],5]) {
    await assert.rejects(validateFrame(payload({selection})), error=>error.status===400);
  }
});

test('a selected object reaches SAM as spatial prompt only and selection is bound to its receipt', async t => {
  const env = await environment(t), selection={type:'point',x:10,y:20};
  let actualPayload;
  const body=payload({selection,concept:'bottle',source_kind:'camera'});
  const result=await segment(request(body),env,async(_url,options)=>{
    actualPayload=JSON.parse(options.body);
    assert.equal(actualPayload.input[0].content[0].text,'<0f>1<|point;x=10;y=20;w=64;h=64|>');
    assert.equal(actualPayload.input[0].content.length,2,'do not mix a concept and a spatial prompt');
    assert.equal(actualPayload.input[0].content[1].image_url,'data:image/jpeg;base64,'+body.image_base64);
    return providerResponse(WIRE);
  });
  assert.deepEqual(result.selection,selection);assert.equal(result.prompt_kind,'point');
  assert.equal(result.image_sha256,(await validateFrame(body)).image_sha256);
  for(const value of Object.values(result.timings_ms))assert.ok(Number.isFinite(value)&&value>=0);
  const saved=await env.DB.prepare('SELECT result_json FROM vision_requests WHERE id=?').bind(result.evidence_id).first();
  assert.deepEqual(JSON.parse(saved.result_json).selection,selection);
  const invalid=payload({selection:{type:'point',x:64,y:0},frame_id:'invalid',source_time_s:1});
  await assert.rejects(segment(request(invalid),env,()=>assert.fail('Invalid selection must never spend')));
  assert.equal((await summary(env)).requests,1);
});

test('imported video reaches the provider and preserves its source through a real SQLite reservation', async t => {
  const env=await environment(t),selection={type:'box',x:10,y:20,width:3,height:3};
  let calls=0;
  const result=await segment(request(payload({source_kind:'video',selection,concept:'bottle'})),env,async(_url,options)=>{
    calls++;
    assert.equal(JSON.parse(options.body).input[0].content[0].text,
      '<0f>1<|box;x1=10;y1=20;x2=12;y2=22;w=64;h=64|>');
    return providerResponse(WIRE);
  });
  assert.equal(calls,1);assert.equal(result.source_kind,'video');assert.equal(result.status,'detected');
  const saved=await env.DB.prepare('SELECT source_kind, status, units, result_json FROM vision_requests WHERE id=?')
    .bind(result.evidence_id).first();
  assert.equal(saved.source_kind,'video');assert.equal(saved.status,'complete');assert.equal(saved.units,25);
  assert.equal(JSON.parse(saved.result_json).source_kind,'video');
  assert.equal((await summary(env)).requests,1);
});

test('video source migration preserves every existing ledger column, baseline, indexes and constraints', async t => {
  const env=await environment(t,'1000',1);await initializeBudget(env);
  await assert.rejects(segment(request(payload({source_kind:'video'})),env,
    ()=>assert.fail('Old schema must reject video before the provider')),/vision_source_kind/);
  const complete=await reserve(env,{...fakeFrame(0),source_kind:'camera'},'b'.repeat(64));
  await settle(env,complete,'complete','c'.repeat(64),{evidence:'existing receipt',selection:null});
  const failed=await reserve(env,fakeFrame(1),'d'.repeat(64));await settle(env,failed,'failed');
  const pending=await reserve(env,{...fakeFrame(2),source_kind:'camera'},'e'.repeat(64));
  const rows=await env.DB.prepare('SELECT * FROM vision_requests ORDER BY id').run();
  const baseline=await env.DB.prepare('SELECT * FROM vision_budget_baseline').first();
  const migration=await readFile(new URL('../drizzle/0001_video_source_kind.sql',import.meta.url),'utf8');
  await env.DB.script(migration);
  assert.deepEqual(await env.DB.prepare('SELECT * FROM vision_requests ORDER BY id').run(),rows);
  assert.deepEqual(await env.DB.prepare('SELECT * FROM vision_budget_baseline').first(),baseline);
  assert.equal((await summary(env)).scenes.vision,.1075);
  const indexes=(await env.DB.prepare("PRAGMA index_list('vision_requests')").run()).results;
  for(const name of ['vision_requests_run_time','vision_requests_inflight','vision_unique_frame']) {
    assert.ok(indexes.some(index=>index.name===name),name+' is preserved');
  }
  assert.equal(indexes.find(index=>index.name==='vision_unique_frame').unique,1);
  await assert.rejects(env.DB.prepare('UPDATE vision_requests SET frame_id=? WHERE id=?').bind('frame-0',failed).run(),/UNIQUE constraint/);
  await assert.rejects(env.DB.prepare('UPDATE vision_requests SET source_kind=? WHERE id=?').bind('unknown',complete).run(),/vision_source_kind/);
  await assert.rejects(env.DB.prepare('UPDATE vision_requests SET units=? WHERE id=?').bind(0,complete).run(),/vision_image_price/);
  await assert.rejects(env.DB.prepare('UPDATE vision_requests SET status=? WHERE id=?').bind('unknown',complete).run(),/vision_status/);
  await assert.rejects(env.DB.prepare('UPDATE vision_requests SET id=? WHERE id=?').bind(complete,failed).run(),/UNIQUE constraint/);
  await assert.rejects(env.DB.prepare('UPDATE vision_requests SET image_sha256=NULL WHERE id=?').bind(complete).run(),/NOT NULL constraint/);
  await assert.rejects(env.DB.prepare('UPDATE vision_budget_baseline SET initial_units=-1').run(),/vision_baseline_nonnegative/);
  await settle(env,pending,'complete');
  const video=await segment(request(payload({source_kind:'video',frame_id:'frame-3',source_time_s:3})),env,async()=>providerResponse(WIRE));
  assert.equal(video.source_kind,'video');assert.equal((await summary(env)).scenes.vision,.11);
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

test('optional total cap defaults to $0.50 and rejects invalid config before accessing the ledger', async () => {
  assert.equal(limitUnits({}),5000);
  assert.equal(limitUnits({TOTAL_VISION_BUDGET_UNITS:'20000'}),20000);
  assert.equal(limitUnits({TOTAL_VISION_BUDGET_UNITS:5000}),5000);
  assert.equal(limitUnits({TOTAL_VISION_BUDGET_UNITS:'unlimited'}),null);
  for (const value of ['', '0', 0, -1, 1.5, '1.5', '2e4', '020000', ' 20000',
    '20001', 20001, NaN, Infinity, Number.MAX_SAFE_INTEGER+1, true, {}, 'UNLIMITED', ' unlimited']) {
    const env={TOTAL_VISION_BUDGET_UNITS:value,INITIAL_VISION_SPENT_UNITS:'0',
      DB:{prepare:()=>assert.fail('Invalid cap must not read or mutate the ledger')}};
    const invalid=error=>error.status===503 && error.message.includes('TOTAL_VISION_BUDGET_UNITS');
    assert.throws(()=>limitUnits(env),invalid);
    await assert.rejects(initializeBudget(env),invalid);
    await assert.rejects(summary(env),invalid);
    await assert.rejects(reserve(env,fakeFrame(),'b'.repeat(64)),invalid);
  }
});

test('an explicitly configured $2 total cap is enforced atomically and reported in exhausted status', async t => {
  const env={...await environment(t,'19975'),TOTAL_VISION_BUDGET_UNITS:'20000'};
  await initializeBudget(env);
  const second=sqlite(env.path);t.after(()=>second.close());
  const results=await Promise.allSettled([
    reserve(env,fakeFrame(),'b'.repeat(64)),
    reserve({...env,DB:second},fakeFrame(1,crypto.randomUUID()),'c'.repeat(64)),
  ]);
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
  const budget=await summary(env);
  assert.equal(budget.limit_per_scene,2);assert.equal(budget.scenes.vision,2);
  assert.equal(budget.remaining_requests,0);assert.match(budget.budget_scope,/\$2\.00 combined ceiling/);
  const status=await samStatus(env);
  assert.equal(status.accepting_frame,false);assert.equal(status.reason_code,'budget_exhausted');
  assert.match(status.message,/\$2\.00 image allowance/);
  await assert.rejects(reserve(env,fakeFrame(2,crypto.randomUUID()),'d'.repeat(64)),
    error=>error.status===429 && error.detail.code==='budget_exhausted' && error.message.includes('$2.00'));
});

test('changing the total cap never resets reservations or lowers the imported baseline', async t => {
  const env=await environment(t,'4975');await initializeBudget(env);
  await settle(env,await reserve(env,fakeFrame(),'b'.repeat(64)),'complete');
  const raised={...env,TOTAL_VISION_BUDGET_UNITS:'20000',INITIAL_VISION_SPENT_UNITS:'0'};
  await initializeBudget(raised);
  const before=await summary(raised);
  assert.equal(before.scenes.vision,.5);assert.equal(before.remaining_requests,600);
  assert.equal(before.reserved_local_or_prior_usd,.4975);assert.equal(before.hosted_requests,1);
  await settle(raised,await reserve(raised,fakeFrame(1),'c'.repeat(64)),'failed');
  const after=await summary(raised);
  assert.equal(after.scenes.vision,.5025);assert.equal(after.remaining_requests,599);
  // Omitting the cap restores the conservative default, but never refunds cost.
  await initializeBudget({...env,INITIAL_VISION_SPENT_UNITS:'0'});
  const lowered=await summary(env);
  assert.equal(lowered.limit_per_scene,.5);assert.equal(lowered.scenes.vision,.5025);
  assert.equal(lowered.remaining_requests,0);assert.equal(lowered.hosted_requests,2);
  await assert.rejects(reserve(env,fakeFrame(2),'d'.repeat(64)),/\$0\.50 vision budget is exhausted/);
});

test('explicit unlimited mode removes total and per-run caps but preserves costs, ordering and one in-flight request', async t => {
  const env={...await environment(t,'25000'),TOTAL_VISION_BUDGET_UNITS:'unlimited'};
  await initializeBudget(env);
  const second=sqlite(env.path);t.after(()=>second.close());
  const first=await reserve(env,fakeFrame(),'b'.repeat(64));
  await assert.rejects(reserve({...env,DB:second},fakeFrame(1),'c'.repeat(64)),
    error=>error.status===429 && error.detail.code==='sam_busy' && !error.detail.provider_call_made);
  const busy=await samStatus(env);
  assert.equal(busy.available,true);assert.equal(busy.accepting_frame,false);
  assert.equal(busy.service_state,'busy');assert.equal(busy.remaining_requests,null);
  assert.equal(busy.remaining_usd,null);assert.equal(busy.max_requests_per_run,null);
  await settle(env,first,'failed');
  await assert.rejects(reserve(env,fakeFrame(),'b'.repeat(64)),/already submitted/);
  await assert.rejects(reserve(env,{...fakeFrame(1),source_time_s:0},'c'.repeat(64)),/strictly increasing/);
  // The same run crosses the finite 60-request limit and begins above $2.
  for(let i=1;i<62;i++)await settle(env,await reserve(env,fakeFrame(i),'b'.repeat(64)),'complete');
  await initializeBudget({...env,INITIAL_VISION_SPENT_UNITS:'0'});
  const budget=await summary({...env,DB:second});
  assert.equal(budget.unlimited,true);assert.equal(budget.limit_per_scene,null);
  assert.equal(budget.remaining_requests,null);assert.equal(budget.hosted_requests,62);
  assert.equal(budget.reserved_local_or_prior_usd,2.5);assert.equal(budget.scenes.vision,2.655);
  const ready=await samStatus(env);
  assert.equal(ready.available,true);assert.equal(ready.accepting_frame,true);
  assert.equal(ready.reason_code,null);assert.match(ready.message,/No Twinforge spending cap\. Meta account credit still applies/);
  assert.equal(ready.remaining_requests,null);assert.equal(ready.remaining_usd,null);
  assert.equal(ready.max_requests_per_run,null);
  // Returning to the default changes the cap, not the persistent history.
  const finite={...env,TOTAL_VISION_BUDGET_UNITS:undefined,INITIAL_VISION_SPENT_UNITS:'0'};
  const capped=await samStatus(finite);
  assert.equal(capped.available,false);assert.equal(capped.budget.unlimited,false);
  assert.equal(capped.budget.scenes.vision,2.655);assert.equal(capped.max_requests_per_run,60);
});

test('unlimited mode still requires the private key and initialized persistent ledger', async t => {
  const env={...await environment(t),TOTAL_VISION_BUDGET_UNITS:'unlimited'};
  await assert.rejects(reserve(env,fakeFrame(),'b'.repeat(64)),/has not been initialized/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM vision_requests').first()).count,0);
  assert.equal((await samStatus({...env,META_MODEL_API_KEY:''})).available,false);
  assert.equal((await samStatus({...env,DB:undefined})).available,false);
  assert.equal((await samStatus({...env,INITIAL_VISION_SPENT_UNITS:undefined})).available,false);
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

test('busy readiness is temporary, stale disconnected leases expire without refunding their paid image', async t => {
  const env = await environment(t, '1000'); await initializeBudget(env);
  const id = await reserve(env, fakeFrame(), 'b'.repeat(64));
  const busy = await samStatus(env);
  assert.equal(busy.available, true);
  assert.equal(busy.accepting_frame, false);
  assert.equal(busy.service_state, 'busy');
  assert.equal(busy.reason_code, 'sam_busy');
  assert.ok(busy.retry_after_s > 0 && busy.retry_after_s <= 3);
  assert.ok(busy.busy_until_ms > Date.now());
  await env.DB.prepare('UPDATE vision_requests SET created_ms=? WHERE id=?')
    .bind(Date.now() - IN_FLIGHT_LEASE_MS - 1, id).run();
  const ready = await samStatus(env);
  assert.equal(ready.service_state, 'ready');
  assert.equal(ready.remaining_requests, 159);
  const next = await reserve(env, fakeFrame(1, crypto.randomUUID()), 'c'.repeat(64));
  assert.equal((await env.DB.prepare('SELECT status FROM vision_requests WHERE id=?').bind(id).first()).status, 'failed');
  await settle(env, next, 'complete');
  assert.equal((await summary(env)).scenes.vision, .105);
});

test('HTTP handler retains one dispatched task before response completion and settles after a client disconnect', async t => {
  const env = await environment(t); let finishProvider, calls = 0;
  const retained = [];
  const handler = createHandler({assets:{}, segmenter:(request, env) => segment(request, env, async () => {
    calls++;
    return await new Promise(resolve => { finishProvider = () => resolve(providerResponse(WIRE)); });
  })});
  const controller = new AbortController();
  const incoming = new Request(request(payload()), {signal:controller.signal});
  const responsePromise = handler.fetch(incoming, env, {waitUntil:work => retained.push(work)});
  assert.equal(retained.length, 1, 'register Worker lifetime before awaiting the response');
  while (!finishProvider) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); // Existing request is disconnected; provider job must still finish.
  finishProvider();
  await retained[0];
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal((await env.DB.prepare('SELECT status FROM vision_requests').first()).status, 'complete');
  assert.equal((await samStatus(env)).service_state, 'ready');
});

test('retained failed work settles and returns an explicit billed error; an unbilled busy response has Retry-After', async t => {
  const env = await environment(t), retained = [];
  const failing = createHandler({assets:{}, segmenter:(request, env) => segment(request, env, async () => new Response('',{status:503}))});
  const response = await failing.fetch(request(payload()), env, {waitUntil:promise=>retained.push(promise)});
  await Promise.all(retained);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, 'sam_provider_error');
  assert.equal(body.provider_call_made, true);
  assert.equal(body.charged_usd, .0025);
  assert.equal((await samStatus(env)).service_state, 'ready');
  const blocked = createHandler({assets:{}, segmenter:async()=>{throw new HttpError(429,'Busy',{code:'sam_busy',provider_call_made:false,retry_after_s:3});}});
  const busy = await blocked.fetch(request(payload()), env, {waitUntil:()=>{}});
  assert.equal(busy.status,429); assert.equal(busy.headers.get('Retry-After'),'3');
  assert.equal((await busy.json()).provider_call_made,false);
});
