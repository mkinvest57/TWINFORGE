/**
 * Two synchronized views of supplied planar rigid-body states.
 * No physics or independent clock lives here. Paths remain those calculated before
 * replay; event rings denote recorded contacts, not particles or new motion.
 * Industrial objects are schematic bodies inside the engine's circular envelopes.
 */
import * as THREE from '../../assets/vendor/three/build/three.module.js';
import {SCENARIO_COPY} from './copy.mjs';

const C={background:0x11161d,floor:0x1b242d,edge:0x44515e,grid:0x33414e,rail:0x313d49,muted:0x7f929f,orange:0xff9b60,cyan:0x62dce7,metal:0xa6b2bc,dark:0x18212a,success:0x80d3ac};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const finite=Number.isFinite;
export function createCausalScene(container,options={}){
  if(!container?.appendChild)throw new TypeError('A DOM container is required.');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setClearColor(C.background,1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','Two views of the same scenario: baseline on the left, intervention on the right.');container.appendChild(renderer.domElement);
  const geometries=new Set(),materials=new Set(),textures=new Set();let disposed=false,width=1,height=1,last=null,signature='',stacked=false;
  const ownGeometry=g=>(geometries.add(g),g),ownMaterial=m=>(materials.add(m),m),ownTexture=t=>(textures.add(t),t);
  const standard=(color,props={})=>ownMaterial(new THREE.MeshStandardMaterial({color,roughness:.72,metalness:.22,...props}));
  const basic=(color,props={})=>ownMaterial(new THREE.MeshBasicMaterial({color,...props}));
  const floorMat=standard(C.floor,{roughness:.95,metalness:.05}),railMat=standard(C.rail),wheelMat=standard(0x0b1117),darkMat=standard(C.dark),metalMat=standard(C.metal,{metalness:.65,roughness:.45});
  const mesh=(group,geometry,material,x=0,y=0,z=0)=>{const m=new THREE.Mesh(ownGeometry(geometry),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
  const box=(g,w,h,d,m,x=0,y=0,z=0)=>mesh(g,new THREE.BoxGeometry(w,h,d),m,x,y,z);
  const cylinder=(g,r,h,m,x=0,y=0,z=0,sides=32)=>mesh(g,new THREE.CylinderGeometry(r,r,h,sides),m,x,y,z);
  const line=(g,points,color,opacity=.5)=>{const geometry=ownGeometry(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))));const material=ownMaterial(new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:false}));const result=new THREE.Line(geometry,material);g.add(result);return result;};
  function textSprite(text,{color='#dfe5e8',background=null,width=1.5,height=.35,fontSize=38}={}){
    const canvas=document.createElement('canvas');let ctx=canvas.getContext('2d');const font=`500 ${fontSize}px -apple-system,BlinkMacSystemFont,Arial,sans-serif`;ctx.font=font;canvas.width=Math.ceil(ctx.measureText(text).width+fontSize*.45);canvas.height=Math.ceil(fontSize*1.5);ctx=canvas.getContext('2d');
    if(background){ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);}ctx.fillStyle=color;ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,canvas.width/2,canvas.height/2,canvas.width-8);
    const texture=ownTexture(new THREE.CanvasTexture(canvas));texture.colorSpace=THREE.SRGBColorSpace;const material=ownMaterial(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));const sprite=new THREE.Sprite(material);sprite.scale.set(width,height,1);sprite.renderOrder=12;return sprite;
  }
  function branch(color){
    const scene=new THREE.Scene();scene.background=new THREE.Color(C.background);
    scene.add(new THREE.HemisphereLight(0xc5d9ed,0x18212b,2.3));
    const key=new THREE.DirectionalLight(0xf6f5ee,3.4);key.position.set(-6,16,8);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-11;key.shadow.camera.right=11;key.shadow.camera.top=9;key.shadow.camera.bottom=-9;key.shadow.normalBias=.035;key.shadow.bias=-.0003;scene.add(key);
    const rim=new THREE.DirectionalLight(0x8cb9d6,1.2);rim.position.set(10,8,-8);scene.add(rim);
    const camera=new THREE.OrthographicCamera(-10,10,7,-7,.1,100);camera.position.set(0,18,15);camera.lookAt(0,0,0);
    const arenaGroup=new THREE.Group(),bodyGroup=new THREE.Group(),pathGroup=new THREE.Group(),eventGroup=new THREE.Group();scene.add(arenaGroup,bodyGroup,pathGroup,eventGroup);
    const events=[];for(let i=0;i<8;i++){
      const material=basic(color,{transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
      const ring=mesh(eventGroup,new THREE.RingGeometry(.38,.44,40),material);ring.rotation.x=-Math.PI/2;ring.visible=false;ring.castShadow=false;ring.receiveShadow=false;events.push(ring);
    }
    return {scene,key,camera,arenaGroup,bodyGroup,pathGroup,eventGroup,events,color,bodies:new Map(),pathsRef:null,pathMeshes:[],markers:[],width:16,depth:10};
  }
  const branches=[branch(C.orange),branch(C.cyan)];
  function disposeObject(object){
    object.traverse(child=>{if(child.geometry){child.geometry.dispose();geometries.delete(child.geometry);}const list=Array.isArray(child.material)?child.material:[child.material];for(const material of list){if(!material)continue;if(material===floorMat||material===railMat||material===wheelMat||material===darkMat||material===metalMat)continue;if(material.map){material.map.dispose();textures.delete(material.map);}material.dispose();materials.delete(material);}});
    object.removeFromParent();
  }
  function clear(group){for(const item of [...group.children])disposeObject(item);}
  function buildArena(view,scenario){
    clear(view.arenaGroup);view.width=scenario.arena.width;view.depth=scenario.arena.depth;const w=view.width,d=view.depth,g=view.arenaGroup;
    box(g,w+.24,.14,d+.24,floorMat,0,-.1,0);
    // Metric grid and perimeter share the exact physical arena dimensions.
    const gridPoints=[];for(let x=-w/2;x<=w/2+.001;x+=1){gridPoints.push(x,.001,-d/2,x,.001,d/2);}for(let z=-d/2;z<=d/2+.001;z+=1){gridPoints.push(-w/2,.001,z,w/2,.001,z);}
    const gridGeometry=ownGeometry(new THREE.BufferGeometry());gridGeometry.setAttribute('position',new THREE.Float32BufferAttribute(gridPoints,3));const grid=new THREE.LineSegments(gridGeometry,ownMaterial(new THREE.LineBasicMaterial({color:C.grid,transparent:true,opacity:.45})));g.add(grid);
    box(g,w+.2,.14,.1,railMat,0,.025,-d/2-.05);box(g,w+.2,.14,.1,railMat,0,.025,d/2+.05);box(g,.1,.14,d,railMat,-w/2-.05,.025,0);box(g,.1,.14,d,railMat,w/2+.05,.025,0);
    const perimeter=[[-w/2,.006,-d/2],[w/2,.006,-d/2],[w/2,.006,d/2],[-w/2,.006,d/2],[-w/2,.006,-d/2]];line(g,perimeter,C.edge,.8);
    // Floor annotations are measurements, never obstacles or sensor claims.
    const scaleLabel=textSprite('1 m',{color:'#7c8d9c',width:.8,height:.35,fontSize:42});scaleLabel.position.set(-w/2+1.3,.12,d/2-.25);g.add(scaleLabel);
    line(g,[[-w/2+.8,.012,d/2-.55],[-w/2+1.8,.012,d/2-.55]],0x71818d,.9);
    for(const x of [-w/2+.8,-w/2+1.8])line(g,[[x,.012,d/2-.67],[x,.012,d/2-.43]],0x71818d,.9);
  }
  function buildBody(view,body,scenario){
    const group=new THREE.Group(),r=body.radius,bodyColor=new THREE.Color(body.color||'#91a2af'),material=standard(bodyColor),lightMaterial=standard(bodyColor.clone().lerp(new THREE.Color(0xffffff),.25)),accent=basic(body.id===scenario.protectedBodyId?C.success:body.id===scenario.controlBodyId?C.orange:C.muted);
    const envelope=mesh(group,new THREE.RingGeometry(r-.012,r+.012,48),basic(body.id===scenario.protectedBodyId?C.success:0x778895,{transparent:true,opacity:.55,side:THREE.DoubleSide}),0,.013,0);envelope.rotation.x=-Math.PI/2;envelope.castShadow=false;envelope.receiveShadow=false;
    const physical=new THREE.Group();group.add(physical);let top=.9*r;
    if(body.kind==='carrier'){
      cylinder(physical,r*.82,r*.26,darkMat,0,r*.18,0,8);cylinder(physical,r*.78,r*.24,material,0,r*.42,0,8);
      box(physical,r*.85,r*.16,r*.82,lightMaterial,0,r*.62,0);box(physical,r*.43,r*.035,r*.48,darkMat,0,r*.72,0);
      for(const x of [-.57,.57])for(const z of [-.53,.53]){const wheel=cylinder(physical,r*.18,r*.14,wheelMat,x*r,r*.17,z*r,16);wheel.rotation.z=Math.PI/2;}
      box(physical,r*.05,r*.07,r*.42,accent,r*.77,r*.42,0);box(physical,r*.04,r*.04,r*.18,basic(0x88d9e6),r*.8,r*.46,-r*.2);
      const arrow=mesh(physical,new THREE.ConeGeometry(r*.09,r*.22,3),accent,r*.25,r*.73,0);arrow.rotation.z=-Math.PI/2;top=r*.84;
    }else if(body.kind==='fragile'){
      cylinder(physical,r*.8,r*.15,darkMat,0,r*.11,0,8);box(physical,r*1.05,r*1.45,r*.9,lightMaterial,0,r*.9,0);
      box(physical,r*.68,r*.65,.02,darkMat,0,r*1.12,r*.46);box(physical,r*.45,r*.06,.025,basic(C.success),0,r*1.33,r*.48);
      for(let i=0;i<3;i++)box(physical,r*.45,r*.025,.026,metalMat,0,r*(.95-i*.13),r*.48);
      box(physical,r*1.1,r*.10,r*.96,material,0,r*1.67,0);box(physical,r*.24,r*.08,r*.36,accent,0,r*1.77,0);top=r*1.95;
    }else{
      cylinder(physical,r*.82,r*.12,darkMat,0,r*.1,0,8);box(physical,r*1.1,r*.95,r*1.1,material,0,r*.67,0);
      box(physical,r*1.14,r*.07,r*1.14,lightMaterial,0,r*1.18,0);box(physical,r*.12,r*.98,r*1.12,darkMat,0,r*.69,0);box(physical,r*1.12,r*.98,r*.12,darkMat,0,r*.69,0);
      box(physical,r*.45,r*.3,.015,lightMaterial,r*.16,r*.82,r*.565);top=r*1.45;
    }
    const shortLabel=(body.label||body.id).split(' · ')[0],label=textSprite(shortLabel,{color:body.id===scenario.protectedBodyId?'#a4eedb':'#ced8df',width:.42,height:.48,fontSize:64});label.position.y=top+.22;group.add(label);
    if(body.id===scenario.protectedBodyId){const tag=textSprite('FRAGILE CARGO',{color:'#a5c9be',width:2.8,height:.42,fontSize:38});tag.position.y=top+.72;group.add(tag);}
    view.bodyGroup.add(group);view.bodies.set(body.id,{group,physical,label,initial:body});return group;
  }
  function configure(scenario){
    const next=JSON.stringify([scenario.id,scenario.arena,scenario.bodies.map(b=>[b.id,b.kind,b.radius,b.color,b.label]),scenario.protectedBodyId]);if(next===signature)return;signature=next;
    for(const view of branches){buildArena(view,scenario);clear(view.bodyGroup);view.bodies.clear();for(const b of scenario.bodies)buildBody(view,b,scenario);clear(view.pathGroup);view.pathsRef=null;view.pathMeshes=[];view.markers=[];}resize();
  }
  function setPaths(view,paths,scenario){
    if(paths===view.pathsRef)return;clear(view.pathGroup);view.pathsRef=paths;view.pathMeshes=[];view.markers=[];if(!paths)return;
    for(const [id,points] of Object.entries(paths)){
      if(!Array.isArray(points)||points.length<2)continue;const body=scenario.bodies.find(b=>b.id===id);if(!body)continue;
      let distance=0;for(let i=1;i<points.length;i++)distance+=Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);if(distance<.04)continue;
      const important=id===scenario.controlBodyId||id===scenario.protectedBodyId,trajectory=line(view.pathGroup,points.map(p=>[p.x,.033,p.z]),view.color,important?.75:.30);trajectory.renderOrder=2;view.pathMeshes.push(trajectory);
      const marker=mesh(view.pathGroup,new THREE.RingGeometry(body.radius*1.08,body.radius*1.08+.028,40),basic(view.color,{transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}),points[0].x,.043,points[0].z);marker.rotation.x=-Math.PI/2;marker.castShadow=false;marker.receiveShadow=false;
      view.markers.push({mesh:marker,points});
      const start=mesh(view.pathGroup,new THREE.CircleGeometry(.06,12),basic(view.color,{side:THREE.DoubleSide}),points[0].x,.045,points[0].z);start.rotation.x=-Math.PI/2;start.castShadow=false;start.receiveShadow=false;
    }
  }
  function samplePath(points,timeS){
    let low=0,high=points.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(points[mid].timeS<=timeS)low=mid;else high=mid-1;}
    const a=points[low],b=points[Math.min(low+1,points.length-1)],fraction=b.timeS>a.timeS?clamp((timeS-a.timeS)/(b.timeS-a.timeS),0,1):0;return {x:a.x+(b.x-a.x)*fraction,z:a.z+(b.z-a.z)*fraction};
  }
  function updateBranch(view,frame,paths,events,scenario,timeS,showPredictions){
    for(const b of frame?.bodies||scenario.bodies){const item=view.bodies.get(b.id);if(!item)continue;item.group.position.set(b.x,0,b.z);const speed=Math.hypot(b.vx||0,b.vz||0);if(b.kind==='carrier'&&speed>.05)item.physical.rotation.y=-Math.atan2(b.vz,b.vx);}
    setPaths(view,paths,scenario);view.pathGroup.visible=showPredictions;
    for(const marker of view.markers){const p=samplePath(marker.points,timeS);marker.mesh.position.set(p.x,.043,p.z);}
    // Brief contact annotations are derived from recorded contact timestamps.
    const active=(events||[]).filter(e=>e.type!=='intervention'&&e.timeS<=timeS&&timeS-e.timeS<.55).slice(-view.events.length);
    view.events.forEach((ring,index)=>{const event=active[index];ring.visible=!!event;if(!event)return;const progress=(timeS-event.timeS)/.55;ring.position.set(event.x,.055,event.z);ring.scale.setScalar(1+progress*2);ring.material.opacity=(1-progress)*.8;});
  }
  function layout(){
    stacked=window.matchMedia('(max-width: 680px)').matches;for(let i=0;i<branches.length;i++){
      const view=branches[i],vw=stacked?width:width/2,vh=stacked?height/2:height,aspect=vw/vh;
      // Reserve upper room for branch labels while keeping the complete arena visible.
      const halfHeight=Math.max(view.depth*.56,(view.width+1.5)/(2*aspect));view.camera.left=-halfHeight*aspect;view.camera.right=halfHeight*aspect;view.camera.top=halfHeight*1.17;view.camera.bottom=-halfHeight*.83;view.camera.updateProjectionMatrix();
      view.viewport=stacked?{x:0,y:i===0?height/2:0,w:width,h:height/2}:{x:i*width/2,y:0,w:width/2,h:height};
    }
  }
  function draw(){if(disposed)return;renderer.setScissorTest(true);for(const view of branches){const v=view.viewport;if(!v)continue;renderer.setViewport(v.x,v.y,v.w,v.h);renderer.setScissor(v.x,v.y,v.w,v.h);renderer.render(view.scene,view.camera);}renderer.setScissorTest(false);}
  function resize(){if(disposed)return;const rect=container.getBoundingClientRect();if(rect.width<1||rect.height<1)return;width=rect.width;height=rect.height;renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,width<620?1.5:2));renderer.setSize(width,height,false);layout();draw();}
  function render(input={}){
    if(disposed)return;last=input;const scenario=input.scenario;if(!scenario?.bodies||!scenario?.arena)return;configure(scenario);const timeS=finite(input.timeS)?input.timeS:0;
    updateBranch(branches[0],input.baseline,input.baselinePrediction??input.plan?.baseline?.paths,input.baselineEvents??input.plan?.baseline?.events,scenario,timeS,input.showPredictions!==false);
    updateBranch(branches[1],input.intervention,input.interventionPrediction??input.plan?.best?.paths,input.interventionEvents??input.plan?.best?.events,scenario,timeS,input.showPredictions!==false);
    renderer.domElement.setAttribute('aria-label',`Two branches of ${SCENARIO_COPY[scenario.id]?.title||scenario.id}, at ${timeS.toFixed(2)} seconds. Baseline ${stacked?'above':'on the left'}, intervention ${stacked?'below':'on the right'}.`);draw();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);
  const contextLost=event=>{event.preventDefault();container.dispatchEvent(new CustomEvent('causal-context-lost',{bubbles:true}));};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  const contextRestored=()=>{if(last)render(last);};renderer.domElement.addEventListener('webglcontextrestored',contextRestored);resize();
  return {render,resize,canvas:renderer.domElement,dispose(){if(disposed)return;disposed=true;observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',contextLost);renderer.domElement.removeEventListener('webglcontextrestored',contextRestored);for(const view of branches)view.key.shadow.map?.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();renderer.dispose();renderer.domElement.remove();}};
}
