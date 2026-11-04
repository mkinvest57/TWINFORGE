/* Records the actual live WebGL scene with burned-in subtitles and measured UI values.
   The 2D canvas only composites the camera render and captions; physics stays in WebGL. */
const section = document.createElement('section'); section.className = 'sec';
section.innerHTML = '<h2>Demo recording · L3 simulation</h2><p class="hint">Record 2:30 of the live WebGL simulation with English captions and measured results. No filmed physical trial or hardware control is presented.</p><div class="row"><button id="record-demo">Record 2:30 demo</button><button id="stop-demo" disabled>Stop</button><button id="capture-demo">Capture 3D view</button></div><p class="hint" id="record-status" role="status">Ready · recording restarts the simulation and preserves its evidence.</p>';
document.getElementById('data-tools-body').append(section);
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
    ctx.fillStyle='#e8e6e1';ctx.font='bold 17px system-ui';ctx.fillText('L3 · SIMULATION · CALIBRATED KNOWN MODEL',220,38);
    ctx.font='14px monospace';ctx.fillStyle='#9aa0ad';ctx.fillText(`${Math.floor(nextElapsed/60)}:${String(Math.floor(nextElapsed%60)).padStart(2,'0')} / 2:30`,1120,38);
    ctx.fillStyle='#16181d';ctx.fillRect(960,62,320,555);
    let y=lines(ctx,'RUN MEASUREMENTS',980,94,278,17,'#ffb38a');
    y=lines(ctx,read('hud-verdict'),980,y+22,278,20);
    y=lines(ctx,'Forecast: +0.5 s',980,y+25,278,18,'#37c8d9');
    y=lines(ctx,'Current error: '+read('err-now'),980,y+16,278,17);
    y=lines(ctx,'Session mean: '+read('err-avg'),980,y+12,278,17);
    y=lines(ctx,'Correct verdicts: '+read('st-verdicts'),980,y+12,278,17);
    y=lines(ctx,'Monte-Carlo : '+read('st-prob'),980,y+12,278,17);
    const mpc = window.Twinforge?.status?.().last_mpc;
    if(nextElapsed>=95 && nextElapsed<135 && mpc) {
      y=lines(ctx,'LATEST MPC CORRECTION',980,y+16,278,15,'#ffb38a');
      y=lines(ctx,`J = ${Number(mpc.J).toFixed(3)} · horizon ${Number(mpc.horizon).toFixed(2)} s`,980,y+8,278,16);
      if(mpc.u)y=lines(ctx,`Δv = (${mpc.u.x.toFixed(2)}, ${mpc.u.y.toFixed(2)}, ${mpc.u.z.toFixed(2)}) m/s`,980,y+8,278,16);
    }
    lines(ctx,'No real-world physical validation. Tests not run remain unvalidated.',980,546,278,14,'#9aa0ad');
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
    [0,'This is TWINFORGE. The twin predicts a shot before it lands. This demo is an L3 simulation.',()=>{document.querySelector('[data-scene="hoop"]')?.click();if($('tg-mpc')?.classList.contains('on'))click('tg-mpc');click('btn-reset');click('btn-shoot');}],
    [8,'L3: the system selects and calibrates a known physics model. It does not claim to discover equations from scratch.',()=>click('wb-example')],
    [20,'This noisy 3D shot belongs to the independent test set. The model was calibrated on other shots. SAM video is evaluated separately.',()=>click('replay-observations')],
    [35,'The forecast runs the same integrator 0.5 seconds ahead. The verdict locks before the shot ends.',()=>{click('wb-clear');click('btn-shoot');}],
    [43,'Error compares the observation with the position predicted for that same time. Unmeasured parameters remain declared priors.',()=>click('btn-shoot')],
    [52,'18 Monte Carlo simulations sample parameter uncertainty. The numbers on the right are measured during this run.',()=>{controlDemoPreset();click('btn-shoot');}],
    [65,'What if the shot were 20% stronger? The orange trajectory replays that counterfactual in the twin.',()=>chip('shoot 20% harder')],
    [80,'What if the hoop moved left? The reference scene stays unchanged.',()=>chip('move the hoop to the left')],
    [95,'MPC simulates candidate action sequences, compares their cost and applies only the first correction. Here, it controls a simulation.',()=>{controlDemoPreset();if(!$('tg-mpc')?.classList.contains('on'))click('tg-mpc');click('btn-shoot');}],
    [107,'Each correction records cost, horizon, error before and after, and the applied impulse.',()=>click('btn-shoot')],
    [119,'Five physics families have independent synthetic tests. Evidence and limitations remain in the exported report.',()=>{if($('tg-mpc')?.classList.contains('on'))click('tg-mpc');click('btn-challenge');}],
    [135,'This workflow needs no camera or physical device. Synthetic results do not establish real-world validation.',null],
    [143,'TWINFORGE · Indie · Push the Frontier. Level L3. github.com/mkinvest57/TWINFORGE · demo: mkinvest57.github.io/TWINFORGE',null],
  ];
}
$('record-demo').onclick=()=>{
  if(recording)return;
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
  if(!mime){$('record-status').textContent='WebM recording is unavailable in this browser.';return;}
  const frames=composite('Preparing L3 simulation'),stream=frames.canvas.captureStream(24),chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2200000});
  const started=performance.now(),steps=demoSteps(),events=[];let current=-1,raf;
  recording=recorder;$('record-demo').disabled=true;$('stop-demo').disabled=false;
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  recorder.onstop=async()=>{
    cancelAnimationFrame(raf);stream.getTracks().forEach(t=>t.stop());
    try {
      const result=await save(new Blob(chunks,{type:'video/webm'}));
      const evidenceResponse=await fetch('/api/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({evidence:{type:'demo_capture',mode:'L3_simulation',recorded_elapsed_s:(performance.now()-started)/1000,steps:events,media:result,evidence:await window.Twinforge?.exportEvidence?.()}})});
      if(!evidenceResponse.ok)throw Error(`Video saved to ${result.path}, but evidence export was rejected (HTTP ${evidenceResponse.status}). Try Export evidence again.`);
      $('record-status').textContent='Recording saved: '+result.path;
    }catch(error){$('record-status').textContent='Recording not saved: '+error.message;}
    recording=null;$('record-demo').disabled=false;$('stop-demo').disabled=true;
  };
  function tick(){
    const elapsed=(performance.now()-started)/1000;
    while(current+1<steps.length&&elapsed>=steps[current+1][0]){
      current++;const [planned,caption,action]=steps[current];
      try{action?.();events.push({planned_s:planned,executed_s:elapsed,caption});}catch(error){events.push({planned_s:planned,error:error.message});}
    }
    frames.render(steps[Math.max(0,current)][1],elapsed);
    $('record-status').textContent=`Recording simulation · ${Math.floor(elapsed)} / 150 s`;
    if(elapsed>=150){recorder.stop();return;}
    raf=requestAnimationFrame(tick);
  }
  recorder.start(1000);tick();
};
$('stop-demo').onclick=()=>{if(recording?.state==='recording')recording.stop();};
$('capture-demo').onclick=()=>{
  const {canvas}=composite('Current WebGL view · L3 simulation · no real-world physical result claimed');
  canvas.toBlob(async blob=>{try{$('record-status').textContent='Capture : '+(await save(blob)).path;}catch(error){$('record-status').textContent=error.message;}},'image/png');
};

if (!/^https?:$/.test(location.protocol) || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  for (const id of ['record-demo','capture-demo']) { $(id).disabled = true; $(id).title = 'Recording requires the local Python server.'; }
  $('record-status').textContent = 'Recording is available with the local Python server.';
}
