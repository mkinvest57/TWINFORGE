import {SCENARIOS,sampleRun} from './engine.mjs';

const $=id=>document.getElementById(id);
const put=(id,value)=>{if($(id))$(id).textContent=value;};
const number=(value,digits=1)=>Number.isFinite(value)?value.toLocaleString('fr-FR',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const options={scenarioId:'cascade',seed:20261104,perturbation:1,actionDelayS:.25};
const scenarioSelector=$('scenario-select');scenarioSelector.replaceChildren();
for(const scenario of SCENARIOS){const choice=document.createElement('option');choice.value=scenario.id;choice.textContent=scenario.title;scenarioSelector.append(choice);}
scenarioSelector.value=options.scenarioId;put('scenario-description',SCENARIOS[0].description);
let plan=null,selectedRun=null,selectedRobustness=null,selectedOrigin='Recherche locale',timeS=0,playing=false;
let worker=null,taskId=0,scene=null,dirty=true,lastPaint=0,lastFrame=0,report=null,metaRecorded=true,localBackend=false,metaBusy=false,disposed=false;
let generatedAt=null,metaEngineMatches=false;

function actionLabel(action){
  if(!action||action.kind==='none')return 'Aucune intervention';
  return `${action.kind==='brake'?`Freinage de ${number(action.amount*100,0)} %`:`Déviation de ${number(action.amount*180/Math.PI,1)}°`} à ${number(action.atS,2)} s`;
}
function activateTab(name){
  for(const button of document.querySelectorAll('[data-tab]')){
    const active=button.dataset.tab===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    const panel=$(`panel-${button.dataset.tab}`);if(panel)panel.hidden=!active;
  }
  if(name!=='experience')playing=false;
  dirty=true;scene?.resize();
}
for(const tab of document.querySelectorAll('[data-tab]')){
  tab.addEventListener('click',()=>activateTab(tab.dataset.tab));
  tab.addEventListener('keydown',event=>{
    const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(tab);
    let next;if(event.key==='ArrowRight')next=(i+1)%tabs.length;if(event.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(event.key==='Home')next=0;if(event.key==='End')next=tabs.length-1;
    if(next!==undefined){event.preventDefault();activateTab(tabs[next].dataset.tab);tabs[next].focus();}
  });
}

function updateButtons(busy=false){
  for(const button of document.querySelectorAll('.candidate-choice'))button.disabled=busy||!plan;
  for(const id of ['replay-button','pause-button','reset-button','candidate-select','time-scrubber','export-evidence','export-evidence-secondary'])if($(id))$(id).disabled=busy||!plan;
  if($('pause-button'))$('pause-button').disabled=busy||!playing;
  if($('search-button'))$('search-button').disabled=busy;
  if($('meta-apply-button'))$('meta-apply-button').disabled=busy||!report?.selected?.action||!metaEngineMatches;
}
function refreshMetrics(){
  if(!plan||!selectedRun)return;
  const before=plan.baseline.metrics,after=selectedRun.metrics;
  put('candidate-count',`${plan.candidates.length} possibilités`);
  put('impact-before',`${number(before.protectedImpactEnergyJ)} J`);put('impact-after',`${number(after.protectedImpactEnergyJ)} J`);
  put('baseline-impact',`${number(before.protectedImpactEnergyJ)} J`);put('intervention-impact',`${number(after.protectedImpactEnergyJ)} J`);
  put('effort-value',`${number(after.controlImpulseNs)} N·s`);
  put('baseline-result',before.safe?'Sous le seuil':'Seuil dépassé');
  put('intervention-result',after.safe?'Sous le seuil':'Seuil dépassé');
  $('intervention-result')?.classList.toggle('unsafe',!after.safe);
  $('baseline-result')?.classList.toggle('unsafe',!before.safe);
  $('impact-after')?.classList.toggle('unsafe',!after.safe);
  $('intervention-impact')?.classList.toggle('unsafe',!after.safe);
  put('decision-title',actionLabel(selectedRun.intervention));
  put('decision-explanation',`${selectedOrigin}. ${after.safe?`Le choc maximal sur la charge fragile reste sous le seuil de ${number(after.thresholdJ,0)} J.`:`Cette action dépasse le seuil de ${number(after.thresholdJ,0)} J. ${plan.safe?'Une autre action testée passe le seuil.':'Aucune des actions testées ne passe le seuil à cet instant.'}`}`);
  const deadline=plan.deadline;
  put('deadline-value',deadline?.lastSafeDelayS==null?'Aucun instant trouvé':`${number(deadline.lastSafeDelayS,2)} s${deadline.lastSafeDelayS===deadline.maxDelayS?' (borne testée)':''}`);
  put('robustness-value',selectedRobustness?`${selectedRobustness.safeCount} / ${selectedRobustness.total}`:'—');
  put('outcome-explanation',selectedRobustness?.safeCount<selectedRobustness?.total?'Cette commande échoue sur au moins une variation de vitesse de ±5 %. Le résultat nominal ne suffit pas à la déclarer robuste.':'Cette commande passe les trois vitesses testées : −5 %, nominale et +5 %. Cela ne constitue pas une garantie physique.');
  put('deadline-statement',`Dernier instant trouvé sur une grille de 0,25 s, parmi ${plan.candidates.length} commandes. Le seuil de ${plan.scenario.dangerThresholdJ} J est un critère de cette expérience.`);
  put('evidence-summary',`${plan.candidates.length} commandes comparées sur ${plan.scenario.horizonS} secondes. Pré-calcul avant lecture. Seuil : ${plan.scenario.dangerThresholdJ} J. Un même modèle connu sert aux deux branches; ce n’est pas une mesure de précision sur le réel.`);
  const list=$('candidate-list');
  if(list){list.replaceChildren();for(const candidate of plan.candidates.slice(0,6)){
    const li=document.createElement('li');const button=document.createElement('button');button.type='button';button.className='candidate-choice';
    button.setAttribute('aria-pressed',String(candidate.id===selectedRun.intervention.id));
    const label=document.createElement('strong');label.textContent=actionLabel(candidate.action);const value=document.createElement('span');value.textContent=`${number(candidate.metrics.protectedImpactEnergyJ)} J · ${number(candidate.metrics.controlImpulseNs)} N·s`;
    button.append(label,value);button.addEventListener('click',()=>runWorker(candidate.action));li.append(button);list.append(li);
  }}
  if($('candidate-select'))$('candidate-select').value=selectedRun.intervention.id;
  updateButtons();dirty=true;
}
function fillCandidates(){
  const select=$('candidate-select');if(!select)return;select.replaceChildren();
  for(const c of plan.candidates){const option=document.createElement('option');option.value=c.id;option.textContent=`${actionLabel(c.action)} · ${number(c.metrics.protectedImpactEnergyJ)} J`;select.append(option);}
}
function runWorker(action=null,{autoPlay=false,thenAction=null,origin='Recherche locale'}={}){
  playing=false;timeS=0;worker?.terminate();const id=++taskId;
  if(!action){plan=null;selectedRun=null;put('experiment-status','Calcul des futurs, des commandes et des instants d’intervention…');$('scene-loading').hidden=false;}
  else put('experiment-status','Vérification de cette commande et de trois variations de vitesse…');
  updateButtons(true);dirty=true;
  try{worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});}catch(error){fail(error.message);return;}
  worker.onerror=()=>fail('Le calcul n’a pas pu démarrer. Rechargez la page dans un navigateur récent.');
  worker.onmessage=({data})=>{
    if(data.id!==taskId)return;if(data.error){fail(data.error);return;}
    if(data.plan){plan=data.plan;selectedRun=plan.best;selectedRobustness=plan.robustness;generatedAt=new Date().toISOString();fillCandidates();}
    else{selectedRun=data.run;selectedRobustness=data.robustness;}
    selectedOrigin=origin;timeS=0;$('scene-loading').hidden=true;
    if(thenAction){runWorker(thenAction,{autoPlay,origin});return;}
    playing=autoPlay;refreshMetrics();
    put('experiment-status',`Futurs calculés. ${plan.safe?'Comparez les deux branches ou testez une autre commande.':'Aucune commande testée ne protège la charge à cet instant.'}`);
  };
  worker.postMessage({id,options:{...options},action});
}
function fail(message){playing=false;$('scene-loading').hidden=true;put('experiment-status',message);updateButtons(false);dirty=true;}
function exportEvidence(){
  if(!plan)return;
  save({schema:'twinforge.causal.interface.v1',generatedAt,exportedAt:new Date().toISOString(),options:{...options},
    plan,selectedRun,selectedRobustness,selectedOrigin,playbackTimeS:timeS,
    disclosures:{sourceKind:'synthetic',knownInitialState:true,knownPhysics:true,independentPredictionAccuracy:false,
      physicalControl:false,metaUsedForLocalSearch:false,instantaneousActuation:true}},`twinforge-${options.scenarioId}-evidence.json`);
}
function save(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

$('scenario-select').addEventListener('change',event=>{options.scenarioId=event.target.value;put('scenario-description',SCENARIOS.find(s=>s.id===options.scenarioId).description);runWorker();});
$('action-delay').addEventListener('input',event=>{put('action-delay-value',`${number(Number(event.target.value),2)} s`);});
$('action-delay').addEventListener('change',event=>{options.actionDelayS=Number(event.target.value);runWorker();});
$('speed-factor').addEventListener('input',event=>{put('speed-factor-value',`${number(Number(event.target.value)*100,0)} %`);});
$('speed-factor').addEventListener('change',event=>{options.perturbation=Number(event.target.value);runWorker();});
$('search-button').addEventListener('click',()=>runWorker());
$('candidate-select').addEventListener('change',event=>{const candidate=plan?.candidates.find(c=>c.id===event.target.value);if(candidate)runWorker(candidate.action,{origin:'Commande choisie'});});
$('replay-button').addEventListener('click',()=>{if(!plan)return;activateTab('experience');timeS=0;playing=true;dirty=true;updateButtons();});
$('pause-button').addEventListener('click',()=>{playing=false;dirty=true;updateButtons();});
$('reset-button').addEventListener('click',()=>{playing=false;timeS=0;dirty=true;updateButtons();});
$('time-scrubber').addEventListener('input',event=>{playing=false;timeS=Number(event.target.value);dirty=true;updateButtons();});
$('show-predictions').addEventListener('change',()=>{dirty=true;});
$('export-evidence').addEventListener('click',exportEvidence);
$('export-evidence-secondary')?.addEventListener('click',exportEvidence);

function render(){
  if(!plan||!selectedRun)return;
  $('time-scrubber').value=String(timeS);put('time-value',`${number(timeS,2)} / ${plan.scenario.horizonS} s`);
  put('scene-phase',playing?'Lecture synchronisée':timeS===0?'Futurs calculés · prêt':timeS>=plan.scenario.horizonS?'Lecture terminée':'En pause');
  scene?.render({scenario:plan.scenario,baseline:sampleRun(plan.baseline,timeS),intervention:sampleRun(selectedRun,timeS),
    baselinePrediction:plan.baseline.paths,interventionPrediction:selectedRun.paths,
    baselineEvents:plan.baseline.events,interventionEvents:selectedRun.events,timeS,showPredictions:$('show-predictions').checked});
}
function frame(now){
  if(disposed)return;const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
  if(playing&&!document.hidden){timeS=Math.min(plan.scenario.horizonS,timeS+dt);dirty=true;if(timeS>=plan.scenario.horizonS){playing=false;updateButtons();}}
  if(dirty&&!document.hidden&&now-lastPaint>1000/30){render();dirty=false;lastPaint=now;}
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{lastFrame=performance.now();dirty=true;});
window.addEventListener('resize',()=>{dirty=true;});
$('causal-scene').addEventListener('causal-context-lost',()=>{if($('scene-fallback'))$('scene-fallback').hidden=false;playing=false;updateButtons();});
window.addEventListener('pagehide',event=>{if(!event.persisted){disposed=true;worker?.terminate();scene?.dispose();}});

function showMeta(value,recorded){
  if(value?.schema_version!=='twinforge.causal.meta.v1'||!Array.isArray(value.journal))throw new Error('Format du journal non reconnu');
  report=value;metaRecorded=recorded;
  put('meta-source',value.provider_calls?`${recorded?'Enregistré':'Nouvelle session'} · Muse Spark 1.3`:'Recherche locale');
  put('meta-apply-button',value.provider_calls?'Comparer la proposition Meta':'Comparer la référence calculée');
  put('meta-compatibility',metaEngineMatches?'Moteur identique à celui du journal : commande rejouable.':'Moteur différent du journal : rejeu désactivé.');
  const timeline=$('meta-timeline');timeline.replaceChildren();
  for(const row of value.journal){
    const li=document.createElement('li');const head=document.createElement('strong');head.textContent=`${row.iteration}. ${row.verification?actionLabel(row.verification.action):'Proposition non appliquée'}`;
    const reason=document.createElement('p');reason.textContent=row.proposal?.reason||row.raw_response||'Réponse indisponible';
    const result=document.createElement('p');result.className='step-result';const m=row.verification?.metrics;
    result.textContent=m?`Vérification : ${number(m.protectedImpactEnergyJ)} J · ${m.safe?'sous le seuil':'seuil dépassé'} · ${number(m.controlImpulseNs)} N·s`:'Aucun résultat calculé pour cette proposition.';
    li.append(head,reason,result);timeline.append(li);
  }
  if(!value.journal.length){const li=document.createElement('li');li.textContent='Recherche locale exécutée. Aucun appel à Meta.';timeline.append(li);}
  const m=value.selected?.metrics;
  put('meta-status',`${recorded?'Session enregistrée':'Nouvelle session'} · ${value.status==='complete'?'terminée':'incomplète'} · ${value.provider_calls} appel(s) Meta · ${number(value.charged_usd,5)} $${value.error?` · ${value.error}`:''}`);
  put('meta-selection',value.selected?actionLabel(value.selected.action):'Aucune action retenue');
  put('meta-result',m?`${number(m.protectedImpactEnergyJ)} J · ${m.safe?'sous le seuil':'seuil dépassé'}`:'Pas de résultat retenu');
  put('meta-reference',value.exhaustive_reference?`Recherche locale : ${number(value.exhaustive_reference.metrics.protectedImpactEnergyJ)} J avec ${number(value.exhaustive_reference.metrics.controlImpulseNs)} N·s. Meta : ${m?`${number(m.controlImpulseNs)} N·s`:'—'}.`:'');
  if($('meta-export'))$('meta-export').disabled=false;
  updateButtons();
}
async function checkEngine(reportValue){
  const bytes=await(await fetch('./web/causal/engine.mjs')).arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  return hash===reportValue.source_sha256?.['web/causal/engine.mjs'];
}
async function loadMeta(){
  try{const response=await fetch('./assets/causal-meta-session.json');if(!response.ok)throw new Error('Dossier indisponible');const value=await response.json();metaEngineMatches=await checkEngine(value);showMeta(value,true);if(!metaEngineMatches)put('meta-compatibility','Journal historique : moteur différent, rejeu désactivé.');}
  catch{put('meta-status','Aucune session Meta enregistrée disponible. La recherche locale reste utilisable.');}
  if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){
    try{const response=await fetch('/api/status');if(!response.ok)throw new Error();const data=await response.json();localBackend=true;$('meta-run-button').disabled=false;$('meta-use-models').disabled=!data.meta;put('meta-run-button','Lancer la recherche gratuite');put('backend-status',data.meta?'Serveur local connecté. Appels Meta uniquement sur demande, plafond 0,12 $ par étude.':'Serveur local connecté. La recherche gratuite est disponible; clé Meta absente.');}
    catch{put('backend-status','Le serveur Python local est nécessaire pour lancer une nouvelle étude.');}
  }else put('backend-status','Cette version publique rejoue les réponses enregistrées. Pour de nouveaux appels, lancez le serveur Python local avec votre clé Meta.');
}
$('meta-use-models').addEventListener('change',()=>{put('meta-run-button',$('meta-use-models').checked?'Lancer 3 propositions Meta':'Lancer la recherche gratuite');});
$('meta-export').addEventListener('click',()=>{if(report)save(report,'twinforge-causal-meta.json');});
$('meta-apply-button').addEventListener('click',()=>{
  if(!report?.selected||!metaEngineMatches)return;
  Object.assign(options,{scenarioId:report.options.scenario_id,seed:report.options.seed,perturbation:report.options.perturbation,actionDelayS:report.options.action_delay_s});
  $('scenario-select').value=options.scenarioId;$('action-delay').value=String(options.actionDelayS);$('speed-factor').value=String(options.perturbation);
  put('action-delay-value',`${number(options.actionDelayS,2)} s`);put('speed-factor-value',`${number(options.perturbation*100,0)} %`);
  put('scenario-description',SCENARIOS.find(s=>s.id===options.scenarioId).description);
  activateTab('experience');runWorker(null,{thenAction:report.selected.action,autoPlay:true,origin:report.provider_calls?`${metaRecorded?'Proposition Meta enregistrée':'Proposition Meta de cette session'}`:'Recherche locale de l’étude'});
});
$('meta-run-button').addEventListener('click',async()=>{
  if(!localBackend||metaBusy)return;metaBusy=true;$('meta-run-button').disabled=true;$('meta-use-models').disabled=true;put('meta-status','Étude en cours…');
  try{
    const response=await fetch('/api/jobs/causal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario_id:options.scenarioId,seed:options.seed,perturbation:options.perturbation,action_delay_s:options.actionDelayS,use_models:$('meta-use-models').checked,max_iterations:3,budget_cap_usd:.12})});
    const job=await response.json();if(!response.ok)throw new Error(job.error||'Étude refusée');
    let result;for(let i=0;i<180;i++){
      await new Promise(resolve=>setTimeout(resolve,1000));result=await(await fetch(`/api/jobs/${job.id}`)).json();
      if(['failed','interrupted'].includes(result.status))throw new Error(result.error||'Étude interrompue');
      if(result.status==='complete')break;
    }
    if(result.status!=='complete')throw new Error('Étude toujours en cours sur le serveur. Aucun nouvel appel automatique.');
    metaEngineMatches=await checkEngine(result.result.report);showMeta(result.result.report,false);
  }catch(error){put('meta-status',`Étude non terminée : ${error.message}`);}
  finally{metaBusy=false;$('meta-run-button').disabled=false;$('meta-use-models').disabled=false;}
});

try{const {createCausalScene}=await import('./scene.mjs');scene=createCausalScene($('causal-scene'));}
catch{if($('scene-fallback'))$('scene-fallback').hidden=false;put('experiment-status','Vue 3D indisponible; calculs, comparaison et exports restent accessibles.');}
activateTab('experience');runWorker();loadMeta();requestAnimationFrame(frame);
