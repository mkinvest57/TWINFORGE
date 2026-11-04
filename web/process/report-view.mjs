/** Pure presentation contract. Incomplete scientific runs remain exportable evidence. */
const SCHEMA='twinforge.process.report.v1';
const FAMILIES={constant_inflow:'Débit constant',linear_outflow:'Drainage linéaire',sqrt_outflow:'Drainage en racine carrée'};
const STOP_REASONS={all_families_measured:'Toutes les familles ont été mesurées',iteration_limit:'Nombre d’essais prévu atteint',budget_exhausted:'Budget disponible épuisé',provider_failed:'Service du modèle indisponible',context_rejected:'Données de l’étude refusées'};
const KNOWN_SESSION={
  started:'2026-11-04T13:49:54.423495+00:00',
  experiment:'1c6d57ea3fa11c640039d2596860c9b1053ca08f6ec0b97ff8f33036858f4b44',
  source:'3a79221ec138b7fea087d7b1acc6081c89cb2bae0ed380ed2f10ce571840da7c',
  frozen:'29f7b5185fb58b540e044e1b655a63b20516e33cd75f7021661e271191f8932a',
  requests:['a89cd2a18c194ac1ab1d96654633b561','2197be7c325542fbb564ac562a86db7f','df2423fe83a34af8a9675c80d63842da'],
  validation:.09447991370873852,test:.1011282328038083,
};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const count=value=>Number.isInteger(value)&&value>=0?value:null;
const decimal=(value,digits=3)=>value.toLocaleString('fr-FR',{minimumFractionDigits:digits,maximumFractionDigits:digits});

function verifiedRecordedSession(value,recorded){
  return recorded&&value.status==='complete'&&value.passed===true&&value.provider_calls===3&&
    value.started_at===KNOWN_SESSION.started&&value.provenance?.experiment_sha256===KNOWN_SESSION.experiment&&
    value.provenance?.source_sha256?.['twinforge_runtime/process_lab.py']===KNOWN_SESSION.source&&
    value.freeze?.model_sha256===KNOWN_SESSION.frozen&&value.selected_model?.family==='sqrt_outflow'&&
    value.selection?.mean_error_cm===KNOWN_SESSION.validation&&value.independent_test?.mean_error_cm===KNOWN_SESSION.test&&
    value.journal.length===3&&value.journal.every((row,i)=>row.provider_receipt?.request_id===KNOWN_SESSION.requests[i]&&
      row.provider_receipt?.model==='muse-spark-1.3'&&row.status==='measured');
}

function costSummary(value,providerCalls){
  const rows=Array.isArray(value.usage_records)?value.usage_records.filter(row=>object(row)&&row.event==='settled'):[];
  const valid=rows.filter(row=>number(row.cost_usd)!==null&&row.cost_usd>=0);
  let cost=null,costBasis='unknown';
  if(rows.length&&valid.length===rows.length){
    cost=valid.reduce((sum,row)=>sum+row.cost_usd,0);
    costBasis=valid.every(row=>row.cost_basis==='published_rates')?'published_rates':'reservation_unknown_usage';
  }else if(providerCalls===0&&!rows.length){cost=0;costBasis='no_calls';}
  const costText=cost===null?'Coût non documenté':costBasis==='reservation_unknown_usage'?
    `${decimal(cost,5)} $ comptabilisés · coût fournisseur non confirmé`:
    costBasis==='no_calls'?'0 $ · aucun appel':`${decimal(cost,5)} $ · usages et tarifs consignés`;
  return {cost,costBasis,costText};
}

export function describeReport(value,{recorded=false}={}){
  if(!object(value)||value.schema_version!==SCHEMA||!Array.isArray(value.journal)||!value.journal.every(object)){
    throw new TypeError('Format du rapport non reconnu : schéma Process Lab et journal requis.');
  }
  // null is a valid outcome when no family could be fitted before a failure.
  if(value.selected_model!==undefined&&value.selected_model!==null&&!object(value.selected_model)){
    throw new TypeError('Le modèle sélectionné doit être un objet ou null.');
  }
  const providerCalls=count(value.provider_calls);
  const isMeta=(providerCalls!==null&&providerCalls>0)||
    (typeof value.mode==='string'&&value.mode.startsWith('Meta-guided'));
  const status=['complete','incomplete','failed'].includes(value.status)?value.status:'unknown';
  const stopReason=typeof value.stop_reason==='string'&&value.stop_reason.trim()?value.stop_reason:null;
  const passed=typeof value.passed==='boolean'?value.passed:null;
  const trialCount=value.journal.filter(row=>object(row.hypothesis)&&typeof row.hypothesis.family==='string').length;
  const measuredTrials=value.journal.filter(row=>row.status==='measured').length;
  const modelFamily=typeof value.selected_model?.family==='string'?value.selected_model.family:null;
  const familyText=modelFamily?(FAMILIES[modelFamily]||modelFamily):'Aucun modèle sélectionné';
  const validationMeanCm=number(value.selection?.mean_error_cm),testMeanCm=number(value.independent_test?.mean_error_cm);
  const testCount=count(value.independent_test?.scored_predictions);
  const hypothesisNoun=trialCount===1?'hypothèse':'hypothèses';
  const measuredNoun=measuredTrials===1?'mesurée':'mesurées';
  const modeTitle=isMeta?(recorded?'ÉTUDE META ENREGISTRÉE':'NOUVELLE ÉTUDE META'):
    (recorded?'ÉTUDE NUMÉRIQUE ENREGISTRÉE':'RÉFÉRENCE NUMÉRIQUE');
  const title=`${modeTitle}${status==='incomplete'?' · INCOMPLÈTE':status==='failed'?' · ÉCHEC':''}${isMeta&&providerCalls===0?' · AUCUN APPEL ATTESTÉ':''}`;
  let statusText;
  if(status==='complete')statusText=passed===true?'Étude terminée · seuil atteint.':
    passed===false?'Étude terminée · seuil non atteint.':'Étude terminée · verdict non renseigné.';
  else if(status==='incomplete')statusText='Étude incomplète.';
  else if(status==='failed')statusText='Étude échouée.';
  else statusText='État du rapport non renseigné.';
  if(stopReason)statusText+=` ${STOP_REASONS[stopReason]||'Le motif détaillé figure dans le journal'}.`;
  statusText+=' Journal disponible à l’export.';
  let explanation=isMeta?
    `${trialCount} ${hypothesisNoun} proposée${trialCount===1?'':'s'}; ${measuredTrials} ${measuredNoun}. Le modèle propose des familles connues; le calcul ajuste leurs paramètres et mesure les résidus.`:
    `${trialCount} ${hypothesisNoun} numérique${trialCount===1?'':'s'}; ${measuredTrials} ${measuredNoun}. La référence déterministe explore des familles connues sans demander de proposition à Meta.`;
  if(!modelFamily)explanation+=' Aucun modèle final n’a été sélectionné; les erreurs et usages disponibles sont conservés.';
  else if(value.freeze?.test_revealed_after_selection===true&&testCount!==null){
    explanation+=' Le modèle a été sélectionné sur validation et figé avant l’évaluation indépendante.';
  }else explanation+=' Le rapport ne documente pas de test indépendant après gel.';
  const isVerifiedRecordedSession=verifiedRecordedSession(value,recorded);
  if(isVerifiedRecordedSession)explanation+=' La référence déterministe vérifiée aboutit au même modèle et à la même précision.';
  const horizon=number(value.specification?.horizon_s),threshold=number(value.specification?.threshold_cm);
  let reviewNote=value.source_kind==='synthetic'?'Données synthétiques':'Source des données à consulter dans le rapport';
  if(horizon!==null)reviewNote+=` · horizon ${decimal(horizon,0)} s`;
  if(testCount!==null)reviewNote+=` · ${testCount} prévisions de test évaluées`;
  reviewNote+='.';
  if(threshold!==null&&(value.specification?.acceptance_metric==='mean_error_cm'||isVerifiedRecordedSession)){
    reviewNote+=` Critère global : erreur moyenne ≤ ${decimal(threshold,2)} cm.`;
  }
  if(isVerifiedRecordedSession)reviewNote+=' Dans le troisième commentaire de cette session enregistrée, Spark évoque le maximum; la sélection numérique applique le critère de moyenne. Ce commentaire ne vaut pas pour une nouvelle exécution.';
  if(status!=='complete')reviewNote+=' Rapport incomplet ou interrompu : aucun succès global annoncé.';
  return {isMeta,title,statusText,familyText,explanation,reviewNote,...costSummary(value,providerCalls),
    status,stopReason,passed,providerCalls,trialCount,measuredTrials,validationMeanCm,testMeanCm,testCount,
    isVerifiedRecordedSession};
}
