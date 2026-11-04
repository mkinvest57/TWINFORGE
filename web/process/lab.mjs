import {createExperiment} from './engine.mjs';
import {createProcessScene} from './scene.mjs';
import {describeReport} from './report-view.mjs';

const $=id=>document.getElementById(id);
const text=(id,value)=>{const el=$(id);if(el&&el.textContent!==String(value))el.textContent=value;};
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const family={constant_inflow:'Débit constant',linear_outflow:'Drainage linéaire',sqrt_outflow:'Drainage en racine carrée'};
let experiment=createExperiment(),state=experiment.snapshot(),running=false,scene=null,guide=null,history=[],forecastHistory=new Map(),lastSample=-1,report=null,backend=false,busy=false,lastFrame=0,lastPaint=0;
const sessionId=()=>`TF-${20261104}-${Math.round(performance.timeOrigin).toString(36).toUpperCase()}`;
const id=sessionId();
function toast(message){text('toast',message);$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,4500);}
function download(data,name,type='application/json'){const blob=data instanceof Blob?data:new Blob([JSON.stringify(data,null,2)+'\n'],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function exportEvidence(){download({...experiment.exportEvidence(),interface:{session_id:id,application:'Twinforge Process Lab',model_note:'Live tank uses local known-family calibration. Recorded Meta study is a separate experiment.'}},`twinforge-process-${Math.round(state.t)}s.json`);toast('Journal de l’essai exporté.');}
function chooseTab(name,focus=false){for(const button of document.querySelectorAll('[data-tab]')){const selected=button.dataset.tab===name;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;if(selected&&focus)button.focus();}for(const section of document.querySelectorAll('[id^="panel-"]'))section.hidden=section.id!==`panel-${name}`;document.documentElement.dataset.tab=name;requestAnimationFrame(()=>{scene?.resize();drawChart();});}
document.querySelectorAll('[data-tab]').forEach(button=>{button.addEventListener('click',()=>chooseTab(button.dataset.tab));button.addEventListener('keydown',event=>{const buttons=[...document.querySelectorAll('[data-tab]')],index=buttons.indexOf(button);let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;if(next!==undefined){event.preventDefault();chooseTab(buttons[next].dataset.tab,true);}});});
function dispatch(action){state=experiment.dispatch(action);paint();}
function cancelGuide(){if(guide){guide=null;text('experiment-status','Démo guidée interrompue. Vos réglages prennent le relais.');}}
function reset(){running=false;guide=null;experiment=createExperiment();state=experiment.snapshot();history=[];forecastHistory.clear();lastSample=-1;$('target-level').value=1.05;$('manual-valve').value=85;text('experiment-status','Prêt. Quatre secondes d’observation précèdent les premières prévisions.');paint();}
$('experiment-start').addEventListener('click',()=>{cancelGuide();if(state.t>=120)reset();running=!running;paint();});
$('experiment-reset').addEventListener('click',reset);
$('guided-demo').addEventListener('click',()=>{chooseTab('experiment');reset();guide={controlled:false,disturbed:false};running=true;text('experiment-status','Démo guidée · observation, prévision, contrôle, perturbation.');paint();});
$('control-toggle').addEventListener('click',()=>{cancelGuide();dispatch({type:'control',enabled:!state.controlEnabled});});
$('target-level').addEventListener('input',event=>{cancelGuide();dispatch({type:'target',levelM:Number(event.target.value)});});
$('manual-valve').addEventListener('input',event=>{cancelGuide();dispatch({type:'valve',value:Number(event.target.value)/100});});
$('disturbance').addEventListener('click',()=>{cancelGuide();dispatch({type:'inflow_perturbation',factor:1.35});text('experiment-status','Débit disponible augmenté de 35 % dans les deux cuves.');});
$('export-evidence').addEventListener('click',exportEvidence);$('evidence-export-secondary').addEventListener('click',exportEvidence);
$('export-chart').addEventListener('click',()=>{$('level-chart').toBlob(blob=>{if(blob)download(blob,'twinforge-niveaux.png','image/png');});});

function paint(){
  if(state.t!==lastSample){history.push({t:state.t,level:state.observedLevelM,reference:state.baseline.observedLevelM,target:state.targetM});lastSample=state.t;}
  if(Number.isFinite(state.forecastSourceTime))forecastHistory.set(state.forecastSourceTime,{t:state.forecastTargetTime,level:state.predictedLevelM});
  text('session-state',running?'ESSAI EN COURS':state.t?'ESSAI EN PAUSE':'PRÊT À EXPÉRIMENTER');text('session-time',`${fmt(state.t,1)} s`);
  text('experiment-start',running?'Ⅱ Mettre en pause':state.t>=120?'↻ Nouvel essai':state.t?'▶ Reprendre':'▶ Lancer l’essai');
  text('scene-phase',state.phase==='calibrating'?'01 / Observer':state.controlEnabled?'03 / Réguler':'02 / Prédire');
  text('target-value',`${fmt(state.targetM)} m`);text('valve-value',`${fmt(state.valve*100,0)} %`);$('manual-valve').value=state.valve*100;
  $('control-toggle').setAttribute('aria-checked',String(state.controlEnabled));$('control-toggle').disabled=state.phase==='calibrating';
  $('manual-valve').disabled=state.phase==='calibrating'||state.controlEnabled;$('disturbance').disabled=state.phase==='calibrating';
  text('control-state',state.phase==='calibrating'?'Identification · variation automatique de la vanne':state.controlEnabled?'Contrôle actif · une décision toutes les 200 ms simulées':'Mode manuel · ouvrez la vanne ou activez le contrôle');
  text('level-metric',`${fmt(state.observedLevelM)} m`);text('level-percentage',`${fmt(state.observedLevelM/state.maxM*100,0)} % de la hauteur`);$('level-progress').style.width=`${state.observedLevelM/state.maxM*100}%`;
  text('forecast-metric',state.predictedLevelM===null?'—':`${fmt(state.predictedLevelM)} m`);
  text('forecast-status',state.predictedLevelM===null?'En attente de calibration':`Émise à ${fmt(state.forecastSourceTime,1)} s · cible ${fmt(state.forecastTargetTime,1)} s`);
  text('forecast-statement',state.predictedLevelM===null?'Le niveau prévu apparaîtra après quatre secondes d’observation.':state.timeToAlertS===null?'À vanne constante, aucun franchissement du seuil prévu dans les 60 prochaines secondes.':`À vanne constante, seuil d’alerte prévu dans ${fmt(state.timeToAlertS,1)} s.`);
  text('error-metric',state.meanErrorCm===null?'—':`${fmt(state.meanErrorCm)} cm`);text('error-count',`${state.forecastCounts.scored} évaluées / ${state.forecastCounts.issued} émises · ${state.forecastCounts.supported} sans intervention`);
  text('saved-metric',`${fmt(state.baseline.overflowLitres-state.overflowLitres,1)} L`);
  text('live-insight',state.t<4?'Le système observe les variations de niveau pour estimer les débits.':state.controlEnabled?`Cuve régulée : ${fmt(state.overflowLitres,1)} L débordé · référence ouverte : ${fmt(state.baseline.overflowLitres,1)} L.`:'Les deux branches partent du même état à 4 s. Activez le contrôle pour comparer leur évolution.');
  text('session-id',id);text('evidence-observations',state.observationCount??'—');text('evidence-forecasts',state.forecastCounts.issued);text('evidence-assessed',state.forecastCounts.scored);
  $('fallback-water').style.height=`${state.levelM/state.maxM*100}%`;
  scene?.render(state);drawChart();
}
function drawChart(){
  const canvas=$('level-chart');if(!canvas||canvas.getBoundingClientRect().width===0)return;const width=canvas.getBoundingClientRect().width,height=220,dpr=Math.min(devicePixelRatio||1,2);if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='#17191d';c.fillRect(0,0,width,height);const left=40,right=15,top=18,bottom=30,w=width-left-right,h=height-top-bottom,end=Math.max(15,Math.ceil((state.t+5)/5)*5),x=t=>left+t/end*w,y=level=>top+(1-level/1.6)*h;
  c.font='10px ui-monospace, monospace';c.lineWidth=1;
  for(let level=0;level<=1.51;level+=.5){c.strokeStyle='#2b2e34';c.beginPath();c.moveTo(left,y(level));c.lineTo(width-right,y(level));c.stroke();c.fillStyle='#9299a5';c.fillText(`${fmt(level,1)} m`,0,y(level)+3);}
  for(let i=0;i<=4;i++){const t=end*i/4;c.fillStyle='#9299a5';c.fillText(`${fmt(t,0)} s`,x(t)-8,height-17);}
  c.font='9px ui-monospace, monospace';[['Cuve','#5bd5ce'],['Référence','#8794a3'],['Prévu +5 s','#ff8a46']].forEach(([label,color],i)=>{c.fillStyle=color;c.fillText(label,left+i*w/3,height-2);});
  c.fillStyle='#9299a5';c.fillText('SYNTHÉTIQUE · PRÉVISION À VANNE CONSTANTE',left,10);
  for(const [key,color] of [['reference','#8794a3'],['level','#5bd5ce']]){c.strokeStyle=color;c.lineWidth=2;c.beginPath();history.forEach((p,i)=>i?c.lineTo(x(p.t),y(p[key])):c.moveTo(x(p.t),y(p[key])));c.stroke();}
  if(forecastHistory.size){c.strokeStyle='#ff8a46';c.setLineDash([3,4]);c.beginPath();[...forecastHistory.values()].forEach((p,i)=>i?c.lineTo(x(p.t),y(p.level)):c.moveTo(x(p.t),y(p.level)));c.stroke();c.setLineDash([]);c.fillStyle='#ff8a46';c.beginPath();c.arc(x(state.forecastTargetTime),y(state.predictedLevelM),3,0,Math.PI*2);c.fill();}
}
function frame(now){
  const wasRunning=running,dt=lastFrame?Math.min(.1,(now-lastFrame)/1000):0;lastFrame=now;
  if(running&&document.visibilityState==='visible'){
    // Stop at guide boundaries so commands are issued at exact simulated times,
    // independent of the screen refresh rate. The engine uses fixed 20 ms steps.
    let remaining=dt;
    while(remaining>1e-8){const boundary=guide?(!guide.controlled?11:!guide.disturbed?18:40):120,step=Math.min(remaining,Math.max(0,boundary-state.t));if(step>1e-8){state=experiment.tick(step);remaining-=step;}if(state.t>=boundary-1e-8){if(guide&&!guide.controlled){guide.controlled=true;state=experiment.dispatch({type:'control',enabled:true});text('experiment-status','Contrôle activé. La cuve vise 1,05 m.');}else if(guide&&!guide.disturbed){guide.disturbed=true;state=experiment.dispatch({type:'inflow_perturbation',factor:1.35});text('experiment-status','Perturbation : +35 % de débit disponible dans les deux branches.');}else{running=false;guide=null;text('experiment-status','Essai terminé. Comparez les courbes ou exportez les mesures.');break;}}else break;}
  }
  if((now-lastPaint>100&&running)||wasRunning&&!running||lastPaint===0){paint();lastPaint=now;}requestAnimationFrame(frame);
}

function showReport(value,recorded=true){
  const view=describeReport(value,{recorded});report=value;text('meta-source-badge',view.title);text('meta-run-status',view.statusText);
  const list=$('meta-timeline');list.replaceChildren();
  for(const entry of value.journal){const li=document.createElement('li'),number=document.createElement('span'),body=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p'),measure=document.createElement('span');number.className='step-number';number.textContent=entry.iteration;title.textContent=family[entry.hypothesis?.family]||entry.hypothesis?.family||'Hypothèse';detail.textContent=entry.hypothesis?.reason||entry.status;measure.className='step-result';measure.textContent=Number.isFinite(entry.validation?.mean_error_cm)?`${fmt(entry.validation.mean_error_cm,3)} cm · erreur moyenne de validation`:'Mesure indisponible';body.append(title,detail,measure);li.append(number,body);list.append(li);}
  text('meta-family',view.familyText);text('meta-validation',view.validationMeanCm===null?'—':`${fmt(view.validationMeanCm,3)} cm`);text('meta-test',view.testMeanCm===null?'—':`${fmt(view.testMeanCm,3)} cm`);text('meta-calls',view.providerCalls??'—');text('meta-cost',view.costText);text('meta-explanation',view.explanation);
  list.parentElement.querySelector('.meta-review-note')?.remove();const note=document.createElement('p');note.className='meta-review-note';note.textContent=view.reviewNote;list.after(note);
  $('download-meta').disabled=false;
}
$('download-meta').addEventListener('click',()=>{if(report)download(report,'twinforge-process-model-study.json');});
$('use-meta-live').addEventListener('change',()=>text('run-process-study',$('use-meta-live').checked?'Lancer l’étude Meta · ≤ 0,12 $':'Lancer l’étude gratuite'));
async function loadStudy(){try{const response=await fetch('./assets/process-meta-session.json');if(!response.ok)throw new Error('Journal absent');showReport(await response.json());}catch{text('meta-source-badge','JOURNAL INDISPONIBLE');text('meta-explanation','Le journal enregistré ne peut pas être chargé. Vous pouvez toujours utiliser l’essai local et exporter ses mesures.');}}
async function connectBackend(){
  if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)){text('backend-status','Journal consultable ici. Les nouvelles études nécessitent le serveur Python local.');return;}
  try{const response=await fetch('./api/process/spec',{signal:AbortSignal.timeout(2500)});if(!response.ok)throw new Error('Backend absent');const spec=await response.json();if(spec.schema_version!=='twinforge.process.spec.v1')throw new Error('Endpoint absent');backend=true;$('run-process-study').disabled=false;$('use-meta-live').disabled=false;text('backend-status','Serveur connecté · une nouvelle étude peut être lancée.');}
  catch{text('backend-status','Journal consultable ici. Les nouvelles études nécessitent le serveur Python local.');}
}
$('run-process-study').addEventListener('click',async()=>{
  if(!backend||busy)return;busy=true;$('run-process-study').disabled=true;const paid=$('use-meta-live').checked;$('use-meta-live').disabled=true;text('meta-run-status',paid?'Étude Meta en cours · plafond de 0,12 $.':'Étude numérique gratuite en cours…');
  try{const response=await fetch('./api/jobs/process',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seed:20261104,use_models:paid,max_iterations:3,budget_cap_usd:.12})});const job=await response.json();if(!response.ok)throw new Error(job.error||'Lancement impossible');let done=false;for(let attempt=0;attempt<180&&!done;attempt++){await new Promise(resolve=>setTimeout(resolve,1000));const poll=await fetch(`./api/jobs/${encodeURIComponent(job.id)}`);const result=await poll.json();if(!poll.ok)throw new Error(result.error||'Suivi indisponible');if(['failed','error','interrupted'].includes(result.status))throw new Error(result.error||'Étude échouée');if(result.status==='complete'){showReport(result.result.report,false);done=true;}}if(!done)throw new Error('Délai de suivi dépassé. Le serveur peut poursuivre le travail ; aucun nouvel appel n’a été lancé.');}
  catch(error){text('meta-run-status',error.message);}finally{busy=false;$('run-process-study').disabled=false;$('use-meta-live').disabled=false;}
});

try{scene=createProcessScene($('process-scene'));$('scene-loading').hidden=true;}catch(error){$('scene-loading').hidden=true;$('scene-fallback').hidden=false;text('experiment-status','Affichage 3D indisponible sur cet appareil. Les calculs et les courbes restent utilisables.');}
new ResizeObserver(()=>drawChart()).observe($('level-chart'));
window.addEventListener('pagehide',event=>{if(!event.persisted)scene?.dispose();});
document.addEventListener('visibilitychange',()=>{lastFrame=0;});
chooseTab('experiment');paint();loadStudy();connectBackend();requestAnimationFrame(frame);
