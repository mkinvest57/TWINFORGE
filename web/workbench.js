/* Observation → calibration → 3D replay. Model results never become ground truth. */
const localService = /^https?:$/.test(location.protocol) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const splits = { train: [], validation: [], test: [] };
let lastBundle = null;
let lastCapture = null;
const host = document.getElementById('data-tools-body');
const section = document.createElement('section');
section.className = 'sec';
section.id = 'observation-workbench';
section.innerHTML = `
<h2>Observations & calibration</h2>
<p class="hint">Import observations to calibrate a known physics model. Test recordings stay separate until the final model is selected.</p>
<label class="ctl" for="wb-bundle">Twin + observations (JSON bundle)</label>
<input id="wb-bundle" type="file" accept="application/json,.json">
<div class="row" style="margin-top:8px"><button id="wb-example">Load calibrated 3D shot</button><button id="wb-clear">Return to simulation</button></div>
<button id="wb-legacy" style="margin-top:8px">Inspect legacy approximate recording</button>
<details style="margin-top:10px"><summary>Archived engine checks</summary>
<p class="hint">Archived checks cover five model families, including tank and orbit scenes removed from the presentation. Reproducible synthetic experiments use separate trials, disturbances and obstacles. Simulation parameters are reserved for separate evaluation. No paid calls.</p>
<label class="ctl" for="wb-seed">Experiment seed</label><input id="wb-seed" type="number" min="0" max="4294967295" step="1" value="20261104">
<button id="wb-simulation">Run experiments</button>
<div id="wb-simulation-result" class="log" role="status" aria-live="polite" style="margin-top:8px">No experiments run in this session.</div>
</details>
<details style="margin-top:10px"><summary>Calibrate new recordings</summary>
<label class="ctl" for="wb-train">Training recordings</label><input id="wb-train" type="file" accept=".json" multiple>
<label class="ctl" for="wb-validation">Validation recordings (model selection)</label><input id="wb-validation" type="file" accept=".json" multiple>
<label class="ctl" for="wb-test">Independent test recordings</label><input id="wb-test" type="file" accept=".json" multiple>
<p class="hint" id="wb-counts">No recordings loaded.</p>
<label class="ctl"><input id="wb-models" type="checkbox"> Muse Spark / Wonder agent (optional, server budget)</label>
<button id="wb-calibrate">Calibrate & import</button>
</details>
<details style="margin-top:10px"><summary>Process a video with SAM 3.1</summary>
<p class="hint">No camera needed: generate a 3D video with exact physics timestamps and known calibration. Simulation truth stays separate from observations.</p>
<button id="wb-generate">Create synthetic video</button><button id="wb-perceive-generated" disabled>Analyze this video with SAM</button>
<a id="wb-capture-link" hidden>View generated video</a>
<p class="hint">The button below sends frames from your chosen video to Meta Model API. Processing is limited to the first 8 seconds, 8 frames/s and the scene budget. Metric accuracy requires measured calibration.</p>
<label class="ctl" for="wb-video">Shot video (64 MB maximum)</label><input id="wb-video" type="file" accept="video/*">
<label class="ctl" for="wb-source-kind">Video source</label><select id="wb-source-kind"><option value="unknown">Unverified</option><option value="real">Real recorded scene</option><option value="synthetic">Synthetic video / simulation</option></select>
<label class="ctl" for="wb-calibration">Camera / marker calibration (JSON)</label><input id="wb-calibration" type="file" accept=".json">
<label class="ctl" for="wb-secondary">Second-camera observations (stereo, optional)</label><input id="wb-secondary" type="file" accept=".json">
<button id="wb-perceive" style="margin-top:8px">Process with SAM</button>
</details>
<div class="row" style="margin-top:10px"><button id="wb-export">Export twin</button><button id="wb-evidence">Export evidence</button></div>
<button id="wb-archives" style="margin-top:8px">Export archived logs</button>
<div class="row" style="margin-top:8px"><button id="wb-validate">Run checks</button><button id="wb-narrate">Summarize anomalies</button></div>
<label class="ctl" for="wb-narrator">Summary provider</label><select id="wb-narrator"><option value="local">Local analysis · no model or key</option><option value="glimmer">Muse Glimmer · configured endpoint required</option></select>
<p class="hint" id="wb-budget"></p>
<div id="wb-status" class="log" role="status" aria-live="polite" style="margin-top:8px">JSON import available. Checking server…</div>
<details style="margin-top:10px"><summary>Counterfactual illustration · Muse Image</summary>
<p class="hint">Generated illustration only. It does not replace the 3D simulation or physical evidence.</p>
<label class="ctl" for="wb-image-prompt">Change to illustrate</label><input id="wb-image-prompt" type="text" value="Basketball hoop shifted 30 cm to the left in a gym">
<button id="wb-image" style="margin-top:8px">Generate illustration</button>
<figure id="wb-figure" hidden><img id="wb-image-result" alt="Counterfactual illustration generated by Muse Image" style="max-width:100%;margin-top:8px"><figcaption class="hint">Generated illustration · no measurements.</figcaption></figure>
</details>`;
host.append(section);
const $ = id => document.getElementById(id);
const status = text => { $('wb-status').textContent = text; };
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function jsonFile(file) {
  if (!file || file.size > 16 * 1024 * 1024) throw Error('JSON missing or larger than 16 MB.');
  return JSON.parse(await file.text());
}
function datasetOf(data) {
  const dataset = data.dataset || data;
  if (!Array.isArray(dataset.frames) || dataset.frames.length < 6) throw Error('The dataset must contain at least six observations.');
  return dataset;
}
function importBundle(bundle) {
  if (!window.Twinforge?.importObservationBundle) throw Error('The 3D scene is not available yet.');
  if (!bundle.dataset || !bundle.twin) throw Error('The bundle must contain dataset and twin.');
  const result = window.Twinforge.importObservationBundle(bundle);
  if (result?.accepted === false) throw Error(result.error || 'Import rejected.');
  lastBundle = bundle;
  status(JSON.stringify(result, null, 2));
}
async function request(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function job(url, body) {
  const start = await request(url, body);
  const deadline = Date.now() + 16 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/jobs/${start.id}`);
    const state = await response.json();
    if (!response.ok) throw Error(state.error || 'Could not read job status.');
    if (state.status === 'complete') { refreshBudget(); return state.result; }
    if (state.status === 'failed' || state.status === 'interrupted') throw Error(state.error);
    status(`Job ${state.status === 'queued' ? 'queued' : 'running'} · ${start.id.slice(0, 8)}`);
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw Error('Timed out: check the local log. No validated result.');
}
async function action(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try { await fn(); } catch (error) { status(error.message); }
  finally { button.disabled = false; }
}
function counts() {
  $('wb-counts').textContent = `${splits.train.length} training · ${splits.validation.length} validation · ${splits.test.length} test`;
}
function perceptionSummary(dataset){
  const c=dataset.completion||{},t=dataset.tracking||{};
  return `${c.status==='complete'?'Processing complete':'Processing partial'} : ${c.processed_frames??'—'}/${c.expected_sample_frames??'—'} frames processed, ${t.ball_frames_found??'—'} detections, ${t.id_switches??'—'} ID changes. Dataset quality: ${dataset.status||'not evaluated'}.`;
}
async function refreshBudget() {
  if(!localService)return;
  try {
    const response = await fetch('/api/status');
    if (!response.ok) return;
    const d = await response.json();
    const spent = d.budget?.scenes?.hoop || 0;
    $('wb-budget').textContent = `Scene budget: ${spent.toFixed(4)} / ${d.budget.limit_per_scene.toFixed(2)} USD · Glimmer ${d.glimmer ? 'configured' : 'not connected'}`;
  } catch { /* Static hosting retains JSON import/export. */ }
}
$('wb-bundle').addEventListener('change', async e => {
  try { importBundle(await jsonFile(e.target.files[0])); } catch (error) { status(error.message); }
});
for (const split of Object.keys(splits)) $('wb-' + split).addEventListener('change', async e => {
  try {
    splits[split] = await Promise.all([...e.target.files].map(async f => datasetOf(await jsonFile(f))));
    counts(); status('Recordings loaded. Duplicates will be rejected before fitting.');
  } catch (error) { status(error.message); }
});
$('wb-example').onclick = e => action(e.currentTarget, async () => {
  const response = await fetch('./assets/calibrated-synthetic-bundle.json');
  if (!response.ok) throw Error('Calibrated 3D example unavailable.');
  importBundle(await response.json());
});
$('wb-legacy').onclick = e => action(e.currentTarget, async () => {
  const response = await fetch('./assets/example-bundle.json');
  if (!response.ok) throw Error('Example not generated: follow the README commands.');
  importBundle(await response.json());
});
$('wb-generate').onclick = e => action(e.currentTarget, async () => {
  const {generateCapture} = await import('./synthetic-capture.mjs');
  lastCapture = await generateCapture({seed:Number($('wb-seed').value),onProgress:p=>status(`Synthetic video: ${p.phase} · ${p.completed || 0}/${p.total || 36}`)});
  $('wb-capture-link').href=lastCapture.video.url; $('wb-capture-link').hidden=false;
  $('wb-perceive-generated').disabled=false;
  download('calibration-camera-synthetique.json',lastCapture.calibration);
  status('Synthetic video created: 36 frames with exact physics timestamps. SAM analysis uses the displayed budget.');
});
$('wb-perceive-generated').onclick = e => action(e.currentTarget, async () => {
  if(!lastCapture) throw Error('Generate a synthetic video first.');
  const video=await fetch(lastCapture.video.url), blob=await video.blob();
  const upload=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'video/mp4','X-Filename':encodeURIComponent('synthetic-'+lastCapture.capture_id+'.mp4')},body:blob});
  const uploaded=await upload.json();if(!upload.ok)throw Error(uploaded.error);
  const result=await job('/api/jobs/video',{upload_id:uploaded.upload_id,calibration:lastCapture.calibration,sample_fps:8,source_kind:'synthetic',shot_id:lastCapture.capture_id});
  splits.train.push(datasetOf(result));counts();download('observations-synthetiques-sam.json',result.dataset);
  status(perceptionSummary(result.dataset)+' Observations added to training; simulation truth excluded.');
});
$('wb-clear').onclick = () => {
  window.Twinforge?.clearImportedObservation?.(); lastBundle = null; $('wb-bundle').value = '';
  status('Simulation ready. Observations and metrics remain saved in the log.');
};
$('wb-simulation').onclick = e => action(e.currentTarget, async () => {
  const seed = Number($('wb-seed').value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw Error('An integer seed from 0 to 4294967295 is required.');
  $('wb-simulation-result').textContent = 'Running experiments…';
  try {
    const result = await job('/api/jobs/simulation', {seed});
    const report = result.report;
    $('wb-simulation-result').textContent = `${report.passed ? 'PASSED' : 'FAILURES TO REVIEW'} · ${report.scenes.filter(s=>s.passed).length}/${report.scenes.length} scenes · ${report.runtime_seconds.toFixed(2)} s\n`+
      report.scenes.map(s=>`${s.id}: ${s.passed?'passed':'failed'} · error ${Number(s.mean_error).toPrecision(3)} ${s.unit}`).join('\n')+
      (report.failures.length?'\n'+report.failures.map(f=>`${f.scene} / ${f.id}: ${f.value} ${f.operator} ${f.threshold} ${f.unit}`).join('\n'):'\nDetailed report downloaded.');
    download('twinforge-simulation-report.json', report);
    status('Experiments complete. The report preserves failures and limitations; it does not validate a physical device.');
  } catch (error) { $('wb-simulation-result').textContent = error.message; throw error; }
});
$('wb-calibrate').onclick = e => action(e.currentTarget, async () => {
  if (!splits.train.length) throw Error('Add at least one training recording.');
  const result = await job('/api/jobs/calibrate', { ...splits, use_models: $('wb-models').checked });
  importBundle(result.bundle);
});
$('wb-perceive').onclick = e => action(e.currentTarget, async () => {
  const file = $('wb-video').files[0];
  if (!file || file.size > 64 * 1024 * 1024) throw Error('Choose a video smaller than 64 MB.');
  const calibrationFile = $('wb-calibration').files[0];
  const calibration = calibrationFile ? await jsonFile(calibrationFile) : null;
  status('Uploading video to the local server…');
  const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type || 'video/mp4', 'X-Filename': encodeURIComponent(file.name) }, body: file });
  const uploaded = await response.json();
  if (!response.ok) throw Error(uploaded.error);
  const secondaryFile = $('wb-secondary').files[0];
  const secondary_dataset = secondaryFile ? datasetOf(await jsonFile(secondaryFile)) : null;
  const result = await job('/api/jobs/video', { upload_id: uploaded.upload_id, calibration, sample_fps: 8,
    source_kind: $('wb-source-kind').value, secondary_dataset });
  splits.train.push(datasetOf(result)); counts();
  download('observations-sam.json', result.dataset);
  status(perceptionSummary(result.dataset)+' Observations added to training. Import separate recordings for validation and testing.');
});
$('wb-export').onclick = () => {
  if (!lastBundle) return status('No twin imported.');
  download('twinforge-bundle.json', lastBundle);
};
$('wb-evidence').onclick = e => action(e.currentTarget, async () => {
  if (!window.Twinforge?.exportEvidence) throw Error('Scene unavailable.');
  const evidence = await window.Twinforge.exportEvidence();
  download('twinforge-evidence.json', evidence);
  if(!localService){status('Evidence exported in the browser.');return;}
  try { const result = await request('/api/evidence', { evidence }); status('Evidence exported and saved: ' + result.path); }
  catch { status('Evidence exported in the browser. Local server unavailable: no server copy.'); }
});
$('wb-archives').onclick = e => action(e.currentTarget, async () => {
  if(!window.Twinforge?.exportLocalArchives) throw Error('Archive export unavailable.');
  const archive=await window.Twinforge.exportLocalArchives();
  download('twinforge-journaux-locaux.json',archive);
  status((archive.errors?.length?'Archives downloaded with limitations: '+archive.errors.join(' · '):'Local archives downloaded.')+' Current-session evidence can be exported separately.');
});
$('wb-validate').onclick = e => action(e.currentTarget, async () => {
  if (!window.Twinforge?.runValidation) throw Error('Scene unavailable.');
  const report = await window.Twinforge.runValidation();
  download('twinforge-validation.json', report); status(JSON.stringify(report, null, 2));
});
$('wb-narrate').onclick = e => action(e.currentTarget, async () => {
  const evidence = await window.Twinforge?.exportEvidence?.() || {};
  const result = await request('/api/narrate', { evidence, mode: $('wb-narrator').value });
  status(`${result.generated_by_model ? 'Muse Glimmer · '+result.model : 'Local analysis · no model called'}\n${result.content}`);
});
$('wb-image').onclick = e => action(e.currentTarget, async () => {
  const result = await job('/api/jobs/image', { prompt: $('wb-image-prompt').value });
  $('wb-image-result').src = result.image_data_url; $('wb-figure').hidden = false; status(result.label);
});
if(!localService){
  for(const id of ['wb-generate','wb-perceive-generated','wb-simulation','wb-calibrate','wb-perceive','wb-narrate','wb-image']){const button=$(id);button.disabled=true;button.title='Requires the local Python server.';}
  $('wb-budget').textContent='Public version: imports, replay and exports are available. Server processing and Meta calls are disabled here.';
}
status('JSON import available. L3 mode: select and calibrate a known physics model.');
refreshBudget();
