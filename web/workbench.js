/* Observation → calibration → 3D replay. Model results never become ground truth. */
const splits = { train: [], validation: [], test: [] };
let lastBundle = null;
let lastCapture = null;
const host = document.querySelector('.panel.left .pad');
const section = document.createElement('section');
section.className = 'sec';
section.id = 'observation-workbench';
section.innerHTML = `
<h2>OBSERVATIONS · CALIBRATION L3</h2>
<p class="hint">Importez les observations et calibrez un moteur connu. Les tirs de test restent séparés jusqu’au choix final du modèle.</p>
<label class="ctl" for="wb-bundle">Jumeau + observations (bundle JSON)</label>
<input id="wb-bundle" type="file" accept="application/json,.json">
<div class="row" style="margin-top:8px"><button id="wb-example">Charger le tir 3D calibré</button><button id="wb-clear">Retour à la simulation</button></div>
<button id="wb-legacy" style="margin-top:8px">Inspecter l’ancien clip approximatif</button>
<details style="margin-top:10px"><summary>Vérifier les cinq scènes sans caméra</summary>
<p class="hint">Expériences reproductibles avec tirs synthétiques distincts, perturbations et obstacles. Les paramètres du système simulé servent à l’évaluation séparée. Aucun appel payant.</p>
<label class="ctl" for="wb-seed">Graine de l’expérience</label><input id="wb-seed" type="number" min="0" max="4294967295" step="1" value="20261104">
<button id="wb-simulation">Exécuter les expériences</button>
<div id="wb-simulation-result" class="log" role="status" aria-live="polite" style="margin-top:8px">Aucune expérience exécutée dans cette session.</div>
</details>
<details style="margin-top:10px"><summary>Calibrer de nouveaux tirs</summary>
<label class="ctl" for="wb-train">Tirs d’apprentissage</label><input id="wb-train" type="file" accept=".json" multiple>
<label class="ctl" for="wb-validation">Tirs de validation (choix du modèle)</label><input id="wb-validation" type="file" accept=".json" multiple>
<label class="ctl" for="wb-test">Tirs de test indépendants</label><input id="wb-test" type="file" accept=".json" multiple>
<p class="hint" id="wb-counts">Aucun tir chargé.</p>
<label class="ctl"><input id="wb-models" type="checkbox"> Agent Muse Spark / Wonder (facultatif, budget serveur)</label>
<button id="wb-calibrate">Calibrer et importer</button>
</details>
<details style="margin-top:10px"><summary>Traiter une vidéo avec SAM 3.1</summary>
<p class="hint">Sans caméra : générez une vidéo 3D avec horodatages physiques et calibration connue. La vérité du simulateur reste séparée des observations.</p>
<button id="wb-generate">Créer une vidéo synthétique</button><button id="wb-perceive-generated" disabled>Analyser cette vidéo avec SAM</button>
<a id="wb-capture-link" hidden>Voir la vidéo générée</a>
<p class="hint">Le bouton ci-dessous transmet les images de la vidéo choisie à Meta Model API. Traitement limité aux 8 premières secondes, 8 images/s et au budget de la scène. Sans calibration mesurée, aucune précision métrique n’est revendiquée.</p>
<label class="ctl" for="wb-video">Vidéo du tir (64 Mo maximum)</label><input id="wb-video" type="file" accept="video/*">
<label class="ctl" for="wb-source-kind">Origine de la vidéo</label><select id="wb-source-kind"><option value="unknown">Non vérifiée</option><option value="real">Scène physique filmée</option><option value="synthetic">Vidéo synthétique / simulation</option></select>
<label class="ctl" for="wb-calibration">Calibration caméra / marqueurs (JSON)</label><input id="wb-calibration" type="file" accept=".json">
<label class="ctl" for="wb-secondary">Observations de la seconde caméra (stéréo, facultatif)</label><input id="wb-secondary" type="file" accept=".json">
<button id="wb-perceive" style="margin-top:8px">Traiter avec SAM</button>
</details>
<div class="row" style="margin-top:10px"><button id="wb-export">Exporter le jumeau</button><button id="wb-evidence">Exporter les preuves</button></div>
<button id="wb-archives" style="margin-top:8px">Exporter les journaux archivés</button>
<div class="row" style="margin-top:8px"><button id="wb-validate">Exécuter les contrôles</button><button id="wb-narrate">Résumer les anomalies</button></div>
<label class="ctl" for="wb-narrator">Rédaction du résumé</label><select id="wb-narrator"><option value="local">Calcul local · sans modèle ni clé</option value="glimmer">Muse Glimmer · endpoint configuré requis</option></select>
<p class="hint" id="wb-budget"></p>
<div id="wb-status" class="log" role="status" aria-live="polite" style="margin-top:8px">Import JSON disponible. Vérification du serveur…</div>
<details style="margin-top:10px"><summary>Illustration contrefactuelle · Muse Image</summary>
<p class="hint">Image générée à titre d’illustration. Elle ne remplace ni la simulation 3D ni une preuve physique.</p>
<label class="ctl" for="wb-image-prompt">Modification à illustrer</label><input id="wb-image-prompt" type="text" value="Panier décalé de 30 cm à gauche dans un gymnase">
<button id="wb-image" style="margin-top:8px">Générer l’illustration</button>
<figure id="wb-figure" hidden><img id="wb-image-result" alt="Illustration contrefactuelle générée par Muse Image" style="max-width:100%;margin-top:8px"><figcaption class="hint">Illustration générée — aucune mesure.</figcaption></figure>
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
  if (!file || file.size > 16 * 1024 * 1024) throw Error('JSON absent ou supérieur à 16 Mo.');
  return JSON.parse(await file.text());
}
function datasetOf(data) {
  const dataset = data.dataset || data;
  if (!Array.isArray(dataset.frames) || dataset.frames.length < 6) throw Error('Le dataset doit contenir au moins six observations.');
  return dataset;
}
function importBundle(bundle) {
  if (!window.Twinforge?.importObservationBundle) throw Error('La scène 3D n’est pas encore disponible.');
  if (!bundle.dataset || !bundle.twin) throw Error('Le bundle doit contenir dataset et twin.');
  const result = window.Twinforge.importObservationBundle(bundle);
  if (result?.accepted === false) throw Error(result.error || 'Import refusé.');
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
    if (!response.ok) throw Error(state.error || 'Lecture du traitement impossible.');
    if (state.status === 'complete') { refreshBudget(); return state.result; }
    if (state.status === 'failed' || state.status === 'interrupted') throw Error(state.error);
    status(`Traitement ${state.status === 'queued' ? 'en attente' : 'en cours'} · ${start.id.slice(0, 8)}`);
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw Error('Délai dépassé : consulter le journal local. Aucun résultat validé.');
}
async function action(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try { await fn(); } catch (error) { status(error.message); }
  finally { button.disabled = false; }
}
function counts() {
  $('wb-counts').textContent = `${splits.train.length} apprentissage · ${splits.validation.length} validation · ${splits.test.length} test`;
}
function perceptionSummary(dataset){
  const c=dataset.completion||{},t=dataset.tracking||{};
  return `${c.status==='complete'?'Traitement terminé':'Traitement partiel'} : ${c.processed_frames??'—'}/${c.expected_sample_frames??'—'} images traitées, ${t.ball_frames_found??'—'} détections, ${t.id_switches??'—'} changements d’ID. Qualité du dataset : ${dataset.status||'non évaluée'}.`;
}
async function refreshBudget() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) return;
    const d = await response.json();
    const spent = d.budget?.scenes?.hoop || 0;
    $('wb-budget').textContent = `Budget scène : ${spent.toFixed(4)} / ${d.budget.limit_per_scene.toFixed(2)} USD · Glimmer ${d.glimmer ? 'configuré' : 'non connecté'}`;
  } catch { /* Static hosting retains JSON import/export. */ }
}
$('wb-bundle').addEventListener('change', async e => {
  try { importBundle(await jsonFile(e.target.files[0])); } catch (error) { status(error.message); }
});
for (const split of Object.keys(splits)) $('wb-' + split).addEventListener('change', async e => {
  try {
    splits[split] = await Promise.all([...e.target.files].map(async f => datasetOf(await jsonFile(f))));
    counts(); status('Tirs chargés. Les doublons seront refusés avant tout ajustement.');
  } catch (error) { status(error.message); }
});
$('wb-example').onclick = e => action(e.currentTarget, async () => {
  const response = await fetch('./assets/calibrated-synthetic-bundle.json');
  if (!response.ok) throw Error('Exemple 3D calibré indisponible.');
  importBundle(await response.json());
});
$('wb-legacy').onclick = e => action(e.currentTarget, async () => {
  const response = await fetch('./assets/example-bundle.json');
  if (!response.ok) throw Error('Exemple non généré : suivre les commandes du README.');
  importBundle(await response.json());
});
$('wb-generate').onclick = e => action(e.currentTarget, async () => {
  const {generateCapture} = await import('./synthetic-capture.mjs');
  lastCapture = await generateCapture({seed:Number($('wb-seed').value),onProgress:p=>status(`Vidéo synthétique : ${p.phase} · ${p.completed || 0}/${p.total || 36}`)});
  $('wb-capture-link').href=lastCapture.video.url; $('wb-capture-link').hidden=false;
  $('wb-perceive-generated').disabled=false;
  download('calibration-camera-synthetique.json',lastCapture.calibration);
  status('Vidéo synthétique créée : 36 images à temps physique exact. Son analyse SAM utilise le budget indiqué.');
});
$('wb-perceive-generated').onclick = e => action(e.currentTarget, async () => {
  if(!lastCapture) throw Error('Générez une vidéo synthétique.');
  const video=await fetch(lastCapture.video.url), blob=await video.blob();
  const upload=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'video/mp4','X-Filename':encodeURIComponent('synthetic-'+lastCapture.capture_id+'.mp4')},body:blob});
  const uploaded=await upload.json();if(!upload.ok)throw Error(uploaded.error);
  const result=await job('/api/jobs/video',{upload_id:uploaded.upload_id,calibration:lastCapture.calibration,sample_fps:8,source_kind:'synthetic',shot_id:lastCapture.capture_id});
  splits.train.push(datasetOf(result));counts();download('observations-synthetiques-sam.json',result.dataset);
  status(perceptionSummary(result.dataset)+' Observations ajoutées à l’apprentissage; vérité de simulation exclue.');
});
$('wb-clear').onclick = () => {
  window.Twinforge?.clearImportedObservation?.(); lastBundle = null; $('wb-bundle').value = '';
  status('Simulation prête. Les observations et leurs métriques restent conservées dans le journal.');
};
$('wb-simulation').onclick = e => action(e.currentTarget, async () => {
  const seed = Number($('wb-seed').value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw Error('Graine entière requise entre 0 et 4294967295.');
  $('wb-simulation-result').textContent = 'Expériences en cours…';
  try {
    const result = await job('/api/jobs/simulation', {seed});
    const report = result.report;
    $('wb-simulation-result').textContent = `${report.passed ? 'RÉUSSI' : 'ÉCHECS À EXAMINER'} · ${report.scenes.filter(s=>s.passed).length}/${report.scenes.length} scènes · ${report.runtime_seconds.toFixed(2)} s\n`+
      report.scenes.map(s=>`${s.id}: ${s.passed?'réussi':'échec'} · erreur ${Number(s.mean_error).toPrecision(3)} ${s.unit}`).join('\n')+
      (report.failures.length?'\n'+report.failures.map(f=>`${f.scene} / ${f.id}: ${f.value} ${f.operator} ${f.threshold} ${f.unit}`).join('\n'):'\nRapport détaillé téléchargé.');
    download('twinforge-simulation-report.json', report);
    status('Expériences terminées. Le rapport conserve les échecs et les limites; il ne valide pas un dispositif physique.');
  } catch (error) { $('wb-simulation-result').textContent = error.message; throw error; }
});
$('wb-calibrate').onclick = e => action(e.currentTarget, async () => {
  if (!splits.train.length) throw Error('Ajoutez au moins un tir d’apprentissage.');
  const result = await job('/api/jobs/calibrate', { ...splits, use_models: $('wb-models').checked });
  importBundle(result.bundle);
});
$('wb-perceive').onclick = e => action(e.currentTarget, async () => {
  const file = $('wb-video').files[0];
  if (!file || file.size > 64 * 1024 * 1024) throw Error('Choisissez une vidéo inférieure à 64 Mo.');
  const calibrationFile = $('wb-calibration').files[0];
  const calibration = calibrationFile ? await jsonFile(calibrationFile) : null;
  status('Import local de la vidéo…');
  const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type || 'video/mp4', 'X-Filename': encodeURIComponent(file.name) }, body: file });
  const uploaded = await response.json();
  if (!response.ok) throw Error(uploaded.error);
  const secondaryFile = $('wb-secondary').files[0];
  const secondary_dataset = secondaryFile ? datasetOf(await jsonFile(secondaryFile)) : null;
  const result = await job('/api/jobs/video', { upload_id: uploaded.upload_id, calibration, sample_fps: 8,
    source_kind: $('wb-source-kind').value, secondary_dataset });
  splits.train.push(datasetOf(result)); counts();
  download('observations-sam.json', result.dataset);
  status(perceptionSummary(result.dataset)+' Observations ajoutées à l’apprentissage. Importez des tirs distincts pour la validation et le test.');
});
$('wb-export').onclick = () => {
  if (!lastBundle) return status('Aucun jumeau importé.');
  download('twinforge-bundle.json', lastBundle);
};
$('wb-evidence').onclick = e => action(e.currentTarget, async () => {
  if (!window.Twinforge?.exportEvidence) throw Error('Scène indisponible.');
  const evidence = await window.Twinforge.exportEvidence();
  download('twinforge-evidence.json', evidence);
  try { const result = await request('/api/evidence', { evidence }); status('Preuves exportées et sauvegardées : ' + result.path); }
  catch { status('Preuves exportées dans le navigateur. Serveur local absent : aucune copie serveur.'); }
});
$('wb-archives').onclick = e => action(e.currentTarget, async () => {
  if(!window.Twinforge?.exportLocalArchives) throw Error('Export des archives indisponible.');
  const archive=await window.Twinforge.exportLocalArchives();
  download('twinforge-journaux-locaux.json',archive);
  status((archive.errors?.length?'Archives téléchargées avec limites : '+archive.errors.join(' · '):'Archives locales téléchargées.')+' Les preuves de la session courante restent exportables séparément.');
});
$('wb-validate').onclick = e => action(e.currentTarget, async () => {
  if (!window.Twinforge?.runValidation) throw Error('Scène indisponible.');
  const report = await window.Twinforge.runValidation();
  download('twinforge-validation.json', report); status(JSON.stringify(report, null, 2));
});
$('wb-narrate').onclick = e => action(e.currentTarget, async () => {
  const evidence = await window.Twinforge?.exportEvidence?.() || {};
  const result = await request('/api/narrate', { evidence, mode: $('wb-narrator').value });
  status(`${result.generated_by_model ? 'Muse Glimmer · '+result.model : 'Analyse locale · aucun modèle appelé'}\n${result.content}`);
});
$('wb-image').onclick = e => action(e.currentTarget, async () => {
  const result = await job('/api/jobs/image', { prompt: $('wb-image-prompt').value });
  $('wb-image-result').src = result.image_data_url; $('wb-figure').hidden = false; status(result.label);
});
status('Import JSON disponible. Mode L3 : sélection et calibration d’un moteur connu.');
refreshBudget();
