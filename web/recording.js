/* Records the actual live WebGL scene with burned-in subtitles and measured UI values.
   The 2D canvas only composites the camera render and captions; physics stays in WebGL. */
const section = document.createElement('section'); section.className = 'sec';
section.innerHTML = '<h2>DÉMO VIDÉO · SIMULATION L3</h2><p class="hint">Capture de 2 min 30 du rendu WebGL réel, sous-titrée. Aucun tir filmé ni contrôle matériel n’est présenté. Les compteurs viennent du parcours en cours.</p><div class="row"><button id="record-demo">Enregistrer la démo 2:30</button><button id="stop-demo" disabled>Arrêter</button><button id="capture-demo">Capturer l’écran 3D</button></div><p class="hint" id="record-status" role="status">Prêt · le parcours relance la simulation et conserve ses preuves.</p>';
document.querySelector('.panel.left .pad').append(section);
const $ = id => document.getElementById(id);
const read = id => $(id)?.textContent?.trim() || '—';
let recording = null;
function lines(ctx, text, x, y, width, size=23, color='#e8e6e1') {
  ctx.font = `${size}px system-ui`; ctx.fillStyle = color;
  let current='';
  for (const word of text.split(/\s+/)) {
    if (ctx.measureText(current+word).width > width && current) { ctx.fillText(current,x,y); y+=size*1.4; current=''; }
    current+=word+' ';
  }
  ctx.fillText(current,x,y); return y+size*1.4;
}
function composite(caption,elapsed=0) {
  const canvas = document.createElement('canvas'); canvas.width=1280; canvas.height=720;
  const ctx=canvas.getContext('2d');
  const render=(nextCaption=caption,nextElapsed=elapsed)=>{
    ctx.fillStyle='#0e1013';ctx.fillRect(0,0,1280,720);
    const source=document.querySelector('#twinforge-scene-canvas');
    if(source) {
      const scale=Math.min(960/source.width,555/source.height),w=source.width*scale,h=source.height*scale;
      ctx.drawImage(source,(960-w)/2,62+(555-h)/2,w,h);
    }
    ctx.fillStyle='#ff6b1a';ctx.font='bold 26px system-ui';ctx.fillText('TWINFORGE',24,40);
    ctx.fillStyle='#e8e6e1';ctx.font='bold 17px system-ui';ctx.fillText('L3 · SIMULATION · MOTEUR CONNU CALIBRÉ',220,38);
    ctx.font='14px monospace';ctx.fillStyle='#9aa0ad';ctx.fillText(`${Math.floor(nextElapsed/60)}:${String(Math.floor(nextElapsed%60)).padStart(2,'0')} / 2:30`,1120,38);
    ctx.fillStyle='#16181d';ctx.fillRect(960,62,320,555);
    let y=lines(ctx,'MESURES DU PARCOURS',980,94,278,17,'#ffb38a');
    y=lines(ctx,read('hud-verdict'),980,y+22,278,20);
    y=lines(ctx,'Fantôme : +0,5 s',980,y+25,278,18,'#37c8d9');
    y=lines(ctx,'Erreur instantanée : '+read('err-now'),980,y+16,278,17);
    y=lines(ctx,'Moyenne session : '+read('err-avg'),980,y+12,278,17);
    y=lines(ctx,'Verdicts corrects : '+read('st-verdicts'),980,y+12,278,17);
    y=lines(ctx,'Monte-Carlo : '+read('st-prob'),980,y+12,278,17);
    const mpc = window.Twinforge?.status?.().last_mpc;
    if(nextElapsed>=95 && nextElapsed<135 && mpc) {
      y=lines(ctx,'DERNIÈRE CORRECTION MPC',980,y+16,278,15,'#ffb38a');
      y=lines(ctx,`J = ${Number(mpc.J).toFixed(3)} · horizon ${Number(mpc.horizon).toFixed(2)} s`,980,y+8,278,16);
      if(mpc.u)y=lines(ctx,`Δv = (${mpc.u.x.toFixed(2)}, ${mpc.u.y.toFixed(2)}, ${mpc.u.z.toFixed(2)}) m/s`,980,y+8,278,16);
    }
    lines(ctx,'Aucune validation physique réelle. Les résultats non exécutés restent non validés.',980,546,278,14,'#9aa0ad');
    ctx.fillStyle='#08090c';ctx.fillRect(0,617,1280,103);
    lines(ctx,nextCaption,28,651,1220,23);
  };
  render(); return {canvas,render};
}
async function save(blob) {
  const response=await fetch('/api/capture',{method:'POST',headers:{'Content-Type':blob.type},body:blob});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
const click=id=>$(id)?.click();
const chip=text=>document.querySelector(`[data-cf="${text}"]`)?.click();
function controlDemoPreset(){
  // Fixed demonstration input; independent performance belongs to the benchmark.
  for(const [id,value] of [['in-angle',55],['in-power',7.8],['in-spin',0],['in-wind',0]]){
    $(id).value=String(value);$(id).dispatchEvent(new Event('input',{bubbles:true}));
  }
  click('btn-reset');
}
function demoSteps() {
  return [
    [0,'Voici TWINFORGE. Le jumeau prédit le tir avant sa retombée. Cette démonstration est une simulation L3.',()=>{document.querySelector('[data-scene="hoop"]')?.click();if($('tg-mpc')?.classList.contains('on'))click('tg-mpc');click('btn-reset');click('btn-shoot');}],
    [8,'L3 : le système choisit et calibre un moteur physique connu. Il ne prétend pas avoir découvert librement ses équations.',()=>click('wb-example')],
    [20,'Ce tir 3D bruité appartient au test indépendant. Le modèle a été calibré sur d’autres tirs. La vidéo SAM est évaluée séparément.',()=>click('replay-observations')],
    [35,'Le fantôme projette le même intégrateur à +0,5 seconde. Le verdict se verrouille avant l’issue du tir.',()=>{click('wb-clear');click('btn-shoot');}],
    [43,'L’erreur compare la position observée au point prédit pour ce même instant. Les paramètres non mesurés restent des priors.',()=>click('btn-shoot')],
    [52,'18 simulations Monte-Carlo échantillonnent l’incertitude des paramètres. Les chiffres à droite sont ceux de cette exécution.',()=>{controlDemoPreset();click('btn-shoot');}],
    [65,'Et si le lancer était 20 % plus fort ? La trajectoire orange rejoue le contrefactuel dans le jumeau.',()=>chip('shoot 20% harder')],
    [80,'Et si le panier était décalé à gauche ? La scène de référence reste inchangée.',()=>chip('move the hoop to the left')],
    [95,'Le MPC simule des séquences candidates, compare leur coût et n’exécute que la première correction. Ici, il contrôle la simulation.',()=>{controlDemoPreset();if(!$('tg-mpc')?.classList.contains('on'))click('tg-mpc');click('btn-shoot');}],
    [107,'Chaque correction enregistre le coût, l’horizon, l’écart avant et après, ainsi que l’impulsion appliquée.',()=>click('btn-shoot')],
    [119,'Cinq familles physiques disposent de tests synthétiques indépendants. Les preuves et leurs limites restent dans le rapport exportable.',()=>{if($('tg-mpc')?.classList.contains('on'))click('tg-mpc');click('btn-challenge');}],
    [135,'Tout ce parcours fonctionne sans caméra ni dispositif physique. Les résultats synthétiques ne constituent pas une validation du réel.',null],
    [143,'TWINFORGE · Indie · Push the Frontier. Niveau L3. github.com/mkinvest57/TWINFORGE · démo : mkinvest57.github.io/TWINFORGE',null],
  ];
}
$('record-demo').onclick=()=>{
  if(recording)return;
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
  if(!mime){$('record-status').textContent='Enregistrement WebM indisponible dans ce navigateur.';return;}
  const frames=composite('Préparation de la simulation L3'),stream=frames.canvas.captureStream(24),chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2200000});
  const started=performance.now(),steps=demoSteps(),events=[];let current=-1,raf;
  recording=recorder;$('record-demo').disabled=true;$('stop-demo').disabled=false;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=async()=>{
    cancelAnimationFrame(raf);stream.getTracks().forEach(t=>t.stop());
    try {
      const result=await save(new Blob(chunks,{type:'video/webm'}));
      const evidenceResponse=await fetch('/api/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidence:{type:'demo_capture',mode:'L3_simulation',recorded_elapsed_s:(performance.now()-started)/1000,steps:events,media:result,evidence:await window.Twinforge?.exportEvidence?.()}})});
      if(!evidenceResponse.ok)throw Error(`Vidéo sauvegardée dans ${result.path}, mais export des preuves refusé (HTTP ${evidenceResponse.status}). Réessayer « Exporter les preuves ».`);
      $('record-status').textContent='Capture enregistrée : '+result.path;
    }catch(error){$('record-status').textContent='Capture non sauvegardée : '+error.message;}
    recording=null;$('record-demo').disabled=false;$('stop-demo').disabled=true;
  };
  function tick(){
    const elapsed=(performance.now()-started)/1000;
    while(current+1<steps.length&&elapsed>=steps[current+1][0]){
      current++;const [planned,caption,action]=steps[current];
      try{action?.();events.push({planned_s:planned,executed_s:elapsed,caption});}catch(error){events.push({planned_s:planned,error:error.message});}
    }
    frames.render(steps[Math.max(0,current)][1],elapsed);
    $('record-status').textContent=`Enregistrement de la simulation · ${Math.floor(elapsed)} / 150 s`;
    if(elapsed>=150){recorder.stop();return;}
    raf=requestAnimationFrame(tick);
  }
  recorder.start(1000);tick();
};
$('stop-demo').onclick=()=>{if(recording?.state==='recording')recording.stop();};
$('capture-demo').onclick=()=>{
  const {canvas}=composite('Capture du rendu WebGL en cours · Simulation L3 · aucun résultat physique réel revendiqué');
  canvas.toBlob(async blob=>{try{$('record-status').textContent='Capture : '+(await save(blob)).path;}catch(error){$('record-status').textContent=error.message;}},'image/png');
};
