/** Process view adapted from the repository's gLiquid glass tank, water volume,
 * inlet pipe and forecast plane. It renders supplied state; it predicts nothing.
 * Geometry units are metres. Tank width/depth are the internal wetted dimensions.
 */
import * as THREE from '../../assets/vendor/three/build/three.module.js';

const COLORS={background:0x0e1013,metal:0x84919d,dark:0x242b33,water:0x259bb7,surface:0x6fcee0,reference:0x8393a0,alert:0xe77467,forecast:0xff8a46,target:0x72d6cc};
const finite=Number.isFinite;
const limit=(n,min,max)=>Math.max(min,Math.min(max,n));
const metric=n=>`${n.toFixed(2).replace('.',',')} m`;
const vec=(x,y,z)=>new THREE.Vector3(x,y,z);

export function createProcessScene(container,options={}){
  if(!container?.appendChild)throw new Error('Process scene requires a DOM container.');
  const supplied=options.geometry||options.tank||{},widthM=supplied.widthM??.3,depthM=supplied.depthM??.1,heightM=supplied.heightM??1.5;
  if(![widthM,depthM,heightM].every(n=>finite(n)&&n>0))throw new Error('Tank dimensions must be positive finite metres.');
  const W=widthM,D=depthM,H=heightM,baseY=H*.11,wall=Math.min(W,D)*.065,showReference=options.showReference!==false;
  const comparisonX=W+H*.35,comparisonZ=-D-H*.045;
  const scene=new THREE.Scene();scene.background=new THREE.Color(options.background??COLORS.background);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:options.preserveDrawingBuffer??true,powerPreference:'low-power'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.14;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.domElement.className='tf-process-canvas';renderer.domElement.dataset.scene='process';renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Vue de la cuve, en attente des mesures.');
  Object.assign(renderer.domElement.style,{display:'block',width:'100%',height:'100%',maxWidth:'100%'});
  const previousPosition=container.style.position,previousMinHeight=container.style.minHeight;
  if(getComputedStyle(container).position==='static')container.style.position='relative';
  if(container.getBoundingClientRect().height<1)container.style.minHeight='320px';
  container.appendChild(renderer.domElement);
  const labelHost=document.createElement('div');labelHost.className='tf-process-labels';labelHost.setAttribute('aria-hidden','true');Object.assign(labelHost.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden'});container.appendChild(labelHost);
  const labels=[],geometries=new Set(),materials=new Set();let disposed=false,viewWidth=1,viewHeight=1;
  const ownGeometry=g=>(geometries.add(g),g),ownMaterial=m=>(materials.add(m),m);
  const standard=(color,properties={})=>ownMaterial(new THREE.MeshStandardMaterial({color,roughness:.38,metalness:.6,...properties}));
  const unlit=(color,properties={})=>ownMaterial(new THREE.MeshBasicMaterial({color,...properties}));
  const metal=standard(COLORS.metal),dark=standard(COLORS.dark,{roughness:.62,metalness:.42}),rubber=standard(0x14191e,{roughness:.92,metalness:0});
  const orange=standard(COLORS.forecast,{roughness:.35,metalness:.3}),referenceMetal=standard(0x65727e,{roughness:.6,metalness:.35});
  const point=(group,x,y,z)=>group.localToWorld(vec(x,y,z));
  function box(group,w,h,d,material,x=0,y=0,z=0){const m=new THREE.Mesh(ownGeometry(new THREE.BoxGeometry(w,h,d)),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
  function cylinder(group,r,length,material,from,to,segments=16){const m=new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(r,r,length,segments)),material);m.position.copy(from).add(to).multiplyScalar(.5);m.quaternion.setFromUnitVectors(vec(0,1,0),to.clone().sub(from).normalize());m.castShadow=true;group.add(m);return m;}
  function tube(group,a,b,r,material=metal){const start=vec(...a),end=vec(...b);return cylinder(group,r,start.distanceTo(end),material,start,end);}
  function rect(group,w,d,material,y=0,zOffset=0){const points=[vec(-w/2,y,-d/2+zOffset),vec(w/2,y,-d/2+zOffset),vec(w/2,y,d/2+zOffset),vec(-w/2,y,d/2+zOffset),vec(-w/2,y,-d/2+zOffset)],line=new THREE.Line(ownGeometry(new THREE.BufferGeometry().setFromPoints(points)),material);line.computeLineDistances();group.add(line);return line;}
  function label(kind,text,anchor,{color='#e8e6e1',align='center',dx=0,dy=0,size=11}={}){
    const el=document.createElement('div');el.className=`tf-process-label tf-process-label-${kind}`;el.textContent=text;
    Object.assign(el.style,{position:'absolute',left:'0',top:'0',font:`500 ${size}px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif`,letterSpacing:kind==='tank'?'.025em':'0',color,background:kind==='tank'?'transparent':'rgba(14,16,19,.88)',padding:kind==='tank'?'0':'3px 5px',borderRadius:'3px',whiteSpace:'nowrap',transform:align==='left'?'translate(0,-50%)':align==='right'?'translate(-100%,-50%)':'translate(-50%,-50%)'});
    labelHost.appendChild(el);const descriptor={el,anchor,align,dx,dy,visible:true};labels.push(descriptor);return descriptor;
  }
  const ambient=new THREE.HemisphereLight(0xe0f2ff,0x28333f,2.25);scene.add(ambient);
  const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(-H*2.2,H*3,H*2.5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-H*2;key.shadow.camera.right=H*2;key.shadow.camera.top=H*2.4;key.shadow.camera.bottom=-H*1.5;key.shadow.normalBias=.008;scene.add(key);
  const rim=new THREE.DirectionalLight(0x6bcbd7,1.3);rim.position.set(H*2,H*1.6,-H*2);scene.add(rim);
  const centerX=showReference?comparisonX*.35:-W*.2;
  const floor=box(scene,showReference?comparisonX+W+H*.7:W+H*.7,H*.035,D+H*.65,dark,centerX,H*.015,-D*.25);floor.receiveShadow=true;
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,H*30);camera.position.set(centerX+H*2.7,H*1.9,H*3.6);camera.lookAt(centerX,baseY+H*.54,-D*.3);
  const pipeRadius=Math.min(W*.055,H*.013),waterRadius=pipeRadius*.64;

  function tank({x=0,z=0,reference=false}){
    const group=new THREE.Group();group.position.set(x,baseY,z);scene.add(group);
    const glassMaterial=ownMaterial(new THREE.MeshPhysicalMaterial({color:0xcfe6f2,roughness:.09,metalness:0,transmission:.2,transparent:true,opacity:reference?.12:.2,thickness:wall,depthWrite:false,side:THREE.DoubleSide}));
    // Open vessel: four independent walls, no fake glass lid over the inlet.
    for(const sign of [-1,1]){const side=box(group,wall,H,D+wall*2,glassMaterial,sign*(W+wall)/2,H/2,0);side.castShadow=false;side.renderOrder=5;const face=box(group,W,H,wall,glassMaterial,0,H/2,sign*(D+wall)/2);face.castShadow=false;face.renderOrder=5;}
    box(group,W+wall*4,wall*2,D+wall*4,reference?referenceMetal:metal,0,-wall,0);
    const edgeMaterial=ownMaterial(new THREE.LineBasicMaterial({color:reference?0x71808c:0xa9c5d0,transparent:true,opacity:reference?.55:.85}));
    const edgeGeo=ownGeometry(new THREE.EdgesGeometry(ownGeometry(new THREE.BoxGeometry(W+wall*2,H,D+wall*2))));const edges=new THREE.LineSegments(edgeGeo,edgeMaterial);edges.position.y=H/2;group.add(edges);
    for(const xx of [-1,1])for(const zz of [-1,1]){box(group,wall*2,H,wall*2,reference?referenceMetal:metal,xx*(W+wall*2)/2,H/2,zz*(D+wall*2)/2);box(group,wall*5,baseY*.7,wall*5,rubber,xx*W*.4,-baseY*.35,zz*D*.4);}
    const waterMaterial=standard(reference?COLORS.reference:COLORS.water,{roughness:.18,metalness:.08,transparent:true,opacity:reference?.65:.84,depthWrite:false});
    const water=box(group,W,1,D,waterMaterial);water.castShadow=false;water.renderOrder=2;water.visible=false;
    const surfaceMaterial=standard(reference?0xaab8c2:COLORS.surface,{roughness:.23,metalness:.12,side:THREE.DoubleSide});
    const surface=new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(W,D)),surfaceMaterial);surface.rotation.x=-Math.PI/2;surface.renderOrder=3;surface.visible=false;group.add(surface);
    const rimOutline=rect(group,W,D,ownMaterial(new THREE.LineBasicMaterial({color:reference?0x87949f:0xa9e4eb})));rimOutline.visible=false;
    // Scale ticks are tied to the actual vessel height, not decorative data.
    for(let i=0;i<=10;i++)box(group,W*(i%5===0?.16:.085),H*.002,D*.025,unlit(i%5===0?0xd9e3e6:0x81959e),-W/2,H*i/10,D/2+wall*1.8);
    const alert=rect(group,W+wall*4,D+wall*4,ownMaterial(new THREE.LineDashedMaterial({color:COLORS.alert,dashSize:W*.09,gapSize:W*.045,transparent:true,opacity:.75})));alert.visible=false;
    const target=rect(group,W+wall*4,D+wall*4,ownMaterial(new THREE.LineDashedMaterial({color:COLORS.target,dashSize:W*.065,gapSize:W*.055,transparent:true,opacity:.8})));target.visible=false;
    const ghostGroup=new THREE.Group();group.add(ghostGroup);ghostGroup.visible=false;
    const ghostPlane=new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(W,D)),unlit(COLORS.forecast,{transparent:true,opacity:.15,side:THREE.DoubleSide,depthWrite:false}));ghostPlane.rotation.x=-Math.PI/2;ghostGroup.add(ghostPlane);
    rect(ghostGroup,W+wall*3,D+wall*3,ownMaterial(new THREE.LineDashedMaterial({color:COLORS.forecast,dashSize:W*.08,gapSize:W*.04,transparent:true,opacity:1,depthTest:false}))).renderOrder=8;
    const nozzleY=H+H*.11,nozzleX=-W*.16;
    tube(group,[nozzleX,nozzleY+H*.08,0],[nozzleX,nozzleY,0],pipeRadius,reference?referenceMetal:metal);
    const incoming=new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(waterRadius,waterRadius,1,12)),unlit(reference?0x889eaa:0x9ae5ee,{transparent:true,opacity:.68,depthWrite:false}));incoming.visible=false;group.add(incoming);
    const outgoing=new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(waterRadius*.8,waterRadius*.8,baseY*.65,10)),unlit(COLORS.water,{transparent:true,opacity:.65}));outgoing.position.set(W/2+H*.055,-baseY*.55,0);outgoing.visible=false;group.add(outgoing);
    tube(group,[W/2,H*.025,0],[W/2+H*.055,H*.025,0],pipeRadius*.82,reference?referenceMetal:metal);tube(group,[W/2+H*.055,H*.025,0],[W/2+H*.055,-baseY*.2,0],pipeRadius*.82,reference?referenceMetal:metal);
    const spillMaterial=unlit(COLORS.surface,{transparent:true,opacity:.68,side:THREE.DoubleSide,depthWrite:false});
    const spill=box(group,W*.24,H+baseY*.55,wall*1.3,spillMaterial,W*.2,(H-baseY*.55)/2,D/2+wall*2.8);spill.castShadow=false;spill.visible=false;spill.renderOrder=6;
    const wet=new THREE.Mesh(ownGeometry(new THREE.PlaneGeometry(W*.7,D+H*.13)),unlit(reference?0x7f9aaa:0x3baac1,{transparent:true,opacity:.5,side:THREE.DoubleSide}));wet.rotation.x=-Math.PI/2;wet.position.set(W*.18,-baseY+H*.035,D*.42);wet.visible=false;group.add(wet);
    const name=label('tank',reference?'VANNE OUVERTE · RÉFÉRENCE':'VOTRE CUVE',()=>point(group,0,H+H*.25,0),{color:reference?'#a5b1ba':'#e8e6e1',size:reference?10:11});
    const reading=label('level','—',()=>point(group,W/2+wall*4,water.position.y*2, D/2),{align:'left',dx:9,color:reference?'#adb9c2':'#d6f2f5',size:12});
    const prediction=label('forecast','PRÉVU +5 s',()=>point(group,W/2+wall*4,ghostGroup.position.y,D/2),{align:'left',dx:9,dy:-11,color:'#ffb183',size:11});prediction.visible=false;
    const spillLabel=label('spill','Débordement',()=>point(group,W*.25,H*.1,D/2+wall*6),{color:'#ff9b8e',dy:12,size:10});spillLabel.visible=false;
    let alertLabel=null,targetLabel=null;
    if(!reference){alertLabel=label('alert','ALERTE',()=>point(group,-W/2-wall*4,alert.position.y,D/2),{align:'right',dx:-8,color:'#ed9b91',size:10});targetLabel=label('target','CIBLE',()=>point(group,-W/2-wall*4,target.position.y,D/2),{align:'right',dx:-8,color:'#9adecf',size:10});}
    return {group,water,waterMaterial,surface,surfaceMaterial,rimOutline,alert,target,ghostGroup,incoming,outgoing,spill,wet,name,reading,prediction,spillLabel,alertLabel,targetLabel,nozzleY,nozzleX,reference,level:0};
  }
  const main=tank({}),reference=showReference?tank({x:comparisonX,z:comparisonZ,reference:true}):null;
  // The hardware is schematic but metrically sized; the only moving part is the
  // valve handle, whose angle is exactly the externally supplied opening fraction.
  const plumbing=new THREE.Group();plumbing.position.y=baseY;scene.add(plumbing);const pipeX=-W/2-H*.14,pumpY=H*.18;
  tube(plumbing,[pipeX,pumpY,0],[pipeX,H*1.19,0],pipeRadius);
  tube(plumbing,[pipeX,H*1.19,0],[main.nozzleX,H*1.19,0],pipeRadius);
  const motor=box(plumbing,H*.14,H*.12,H*.115,dark,pipeX,pumpY-H*.06,0);motor.receiveShadow=true;
  const motorFace=new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(H*.043,H*.043,H*.025,24)),metal);motorFace.rotation.x=Math.PI/2;motorFace.position.set(pipeX,pumpY-H*.055,H*.07);plumbing.add(motorFace);
  const ledMaterial=unlit(0x56616a),led=new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(H*.009,12,8)),ledMaterial);led.position.set(pipeX+H*.047,pumpY-H*.055,H*.073);plumbing.add(led);
  const valve=new THREE.Group();valve.position.set(pipeX,H*.47,H*.025);plumbing.add(valve);box(valve,H*.11,H*.014,H*.018,orange);box(plumbing,H*.046,H*.06,H*.048,metal,pipeX,H*.47,0);
  if(reference)tube(scene,[main.nozzleX,baseY+H*1.19,-D*.08],[comparisonX+reference.nozzleX,baseY+H*1.19,comparisonZ],pipeRadius,referenceMetal);
  const hardwareLabel=label('hardware','VANNE · 0 %',()=>point(plumbing,pipeX,H*.41,H*.06),{color:'#d2b39e',dy:14,size:10});
  const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)'),coarse=window.matchMedia?.('(pointer: coarse)');
  const motionChanged=()=>{container.dataset.reducedMotion=String(options.reducedMotion??preference?.matches??false);};motionChanged();preference?.addEventListener?.('change',motionChanged);

  function positionLabels(){
    camera.updateMatrixWorld();scene.updateMatrixWorld(true);
    for(const item of labels){if(!item.visible){item.el.hidden=true;continue;}const p=item.anchor().project(camera);item.el.hidden=p.z<-1||p.z>1;if(item.el.hidden)continue;
      const x=(p.x*.5+.5)*viewWidth+item.dx,y=(-p.y*.5+.5)*viewHeight+item.dy,w=item.el.offsetWidth||80,h=item.el.offsetHeight||18;
      const low=item.align==='left'?4:item.align==='right'?w+4:w/2+4,high=item.align==='left'?viewWidth-w-4:item.align==='right'?viewWidth-4:viewWidth-w/2-4;
      item.el.style.left=`${limit(x,Math.min(low,high),Math.max(low,high))}px`;item.el.style.top=`${limit(y,h/2+4,viewHeight-h/2-4)}px`;
    }
    // Labels may be separated for legibility; their actual planes never move.
    if(main.reading.visible&&main.prediction.visible){const a=Number.parseFloat(main.reading.el.style.top),b=Number.parseFloat(main.prediction.el.style.top);if(Math.abs(a-b)<27)main.prediction.el.style.top=`${limit(a-29,14,viewHeight-14)}px`;}
  }
  function draw(){if(disposed)return;renderer.render(scene,camera);positionLabels();}
  function resize(){
    if(disposed)return;const bounds=container.getBoundingClientRect();if(bounds.width<1||bounds.height<1)return;
    viewWidth=bounds.width;viewHeight=bounds.height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,options.maxPixelRatio??(coarse?.matches?1.5:2)));renderer.setSize(viewWidth,viewHeight,false);
    const aspect=viewWidth/viewHeight,vertical=H*1.72,horizontal=(showReference?comparisonX+W+H*.67:W+H*.75)*1.09,halfHeight=Math.max(vertical/2,horizontal/(2*aspect));
    camera.left=-halfHeight*aspect;camera.right=halfHeight*aspect;camera.top=halfHeight;camera.bottom=-halfHeight;camera.updateProjectionMatrix();draw();
  }
  function updateTank(view,level,{forecast=null,alert=null,target=null,inflow=0,outflow=0,overflowRate=0,overflowVolume=0}={}){
    const valid=finite(level),visibleLevel=valid?limit(level,0,H):0;view.level=valid?level:0;view.water.visible=valid&&visibleLevel>0;view.surface.visible=view.water.visible;view.rimOutline.visible=view.water.visible;
    if(valid){view.water.scale.y=Math.max(visibleLevel,1e-6);view.water.position.y=visibleLevel/2;view.surface.position.y=visibleLevel;view.rimOutline.position.y=visibleLevel;}
    const aboveAlert=valid&&finite(alert)&&level>=alert;
    view.waterMaterial.color.setHex(view.reference?(aboveAlert?0xb76e65:COLORS.reference):COLORS.water);view.surfaceMaterial.color.setHex(view.reference?(aboveAlert?0xd99588:0xaab8c2):COLORS.surface);
    view.reading.visible=valid;view.reading.el.textContent=valid?metric(level):'—';
    view.ghostGroup.visible=!view.reference&&finite(forecast);view.prediction.visible=view.ghostGroup.visible;
    if(view.ghostGroup.visible){view.ghostGroup.position.y=forecast;view.prediction.el.textContent=`+5 s · ${metric(forecast)}`;}
    view.alert.visible=finite(alert);if(view.alert.visible)view.alert.position.y=alert;
    view.target.visible=!view.reference&&finite(target);if(view.target.visible)view.target.position.y=target;
    if(view.alertLabel){view.alertLabel.visible=view.alert.visible;view.alertLabel.el.textContent=finite(alert)?`ALERTE ${metric(alert)}`:'';}
    if(view.targetLabel){view.targetLabel.visible=view.target.visible;view.targetLabel.el.textContent=finite(target)?`CIBLE ${metric(target)}`:'';}
    // Flux columns are displayed only when a measured/simulated flux is supplied.
    // No cosmetic waves, estimated flow from level, or autonomous particle physics.
    view.incoming.visible=valid&&finite(inflow)&&inflow>0&&visibleLevel<view.nozzleY;
    if(view.incoming.visible){const length=view.nozzleY-visibleLevel;view.incoming.scale.y=length;view.incoming.position.set(view.nozzleX,visibleLevel+length/2,0);}
    view.outgoing.visible=finite(outflow)&&outflow>0;view.spill.visible=finite(overflowRate)&&overflowRate>0;view.wet.visible=finite(overflowVolume)&&overflowVolume>0;
    view.spillLabel.visible=view.spill.visible||view.wet.visible;view.spillLabel.el.textContent=view.spill.visible?'DÉBORDEMENT EN COURS':`${(Math.max(0,overflowVolume)*1000).toFixed(1).replace('.',',')} L déversé`;
  }
  function render(snapshot={}){
    if(disposed)return;
    const level=snapshot.levelM??snapshot.observedLevelM,forecast=snapshot.predictedLevelM??snapshot.forecastLevelM,alert=snapshot.alertM??options.alertLevelM??null,target=snapshot.targetM??options.targetLevelM??null;
    const inflow=finite(snapshot.inflowM3S)?snapshot.inflowM3S:finite(snapshot.inflowLps)?snapshot.inflowLps/1000:0,outflow=finite(snapshot.outflowM3S)?snapshot.outflowM3S:finite(snapshot.outflowLps)?snapshot.outflowLps/1000:0;
    const overflowVolume=finite(snapshot.overflowVolumeM3)?snapshot.overflowVolumeM3:finite(snapshot.overflowLitres)?snapshot.overflowLitres/1000:0;
    updateTank(main,level,{forecast,alert,target,inflow,outflow,overflowRate:snapshot.overflowM3S??0,overflowVolume});
    const opening=finite(snapshot.valve)?limit(snapshot.valve,0,1):snapshot.pumpOn?1:0;valve.rotation.z=(1-opening)*Math.PI/2;ledMaterial.color.setHex((snapshot.pumpOn??(opening>0))?0x79d7b5:0x56616a);hardwareLabel.el.textContent=`VANNE · ${Math.round(opening*100)} %`;
    main.name.el.textContent=snapshot.controlEnabled?'VOTRE CUVE · PILOTÉE':'VOTRE CUVE · MANUELLE';
    if(reference){const b=snapshot.baseline;reference.group.visible=!!b;reference.name.visible=!!b;
      if(b)updateTank(reference,b.levelM,{alert,overflowRate:b.overflowM3S??0,overflowVolume:finite(b.overflowVolumeM3)?b.overflowVolumeM3:finite(b.overflowLitres)?b.overflowLitres/1000:0,inflow:finite(b.inflowLps)?b.inflowLps/1000:0,outflow:finite(b.outflowLps)?b.outflowLps/1000:0});
      else for(const item of [reference.reading,reference.prediction,reference.spillLabel])item.visible=false;
    }
    renderer.domElement.setAttribute('aria-label',finite(level)?`Cuve : ${metric(level)}.${finite(forecast)?` Prévision à cinq secondes : ${metric(forecast)}.`:''}${reference&&finite(snapshot.baseline?.levelM)?` Référence vanne ouverte : ${metric(snapshot.baseline.levelM)}.`:''}`:'Cuve : en attente des mesures.');
    draw();
  }
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(resize):null;observer?.observe(container);if(!observer)window.addEventListener('resize',resize);
  resize();render({});
  return {
    render,resize,canvas:renderer.domElement,
    dispose(){if(disposed)return;disposed=true;observer?.disconnect();if(!observer)window.removeEventListener('resize',resize);preference?.removeEventListener?.('change',motionChanged);key.shadow.map?.dispose();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();labelHost.remove();if(container.style.position==='relative')container.style.position=previousPosition;if(container.style.minHeight==='320px')container.style.minHeight=previousMinHeight;delete container.dataset.reducedMotion;},
  };
}
