/**
 * The visual plant lives behind a pixel-only message boundary.
 * No hidden simulator quantity is posted to the observer or SAM.
 */
import * as THREE from '../../assets/vendor/three/build/three.module.js';
import {createHiddenWorld,stepHiddenWorld,applyHiddenImpulse,FIXED_STEP,FAMILIES} from './random-dynamics.mjs';

const WIDTH=640,HEIGHT=400,allowedOrigin=location.origin;
const respond=message=>parent.postMessage(message,allowedOrigin);
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
  renderer.setPixelRatio(1);renderer.setSize(WIDTH,HEIGHT,false);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.02;
  renderer.domElement.setAttribute('aria-label','Random 3D experiment observed through rendered images only');
  document.body.append(renderer.domElement);
}catch{
  document.querySelector('#error').hidden=false;
  respond({type:'tf-world-error',message:'WebGL is unavailable.'});
}

if(renderer){
  const scene=new THREE.Scene();
  const camera=new THREE.OrthographicCamera(-4.9,4.9,3.0625,-3.0625,.1,60);

  // Neutral studio reflections make the moving objects legible without adding
  // colored backgrounds that could be confused with a segmented object.
  const environmentCanvas=document.createElement('canvas');environmentCanvas.width=1024;environmentCanvas.height=512;
  const ec=environmentCanvas.getContext('2d');
  const environmentGradient=ec.createLinearGradient(0,0,0,512);
  environmentGradient.addColorStop(0,'#536071');environmentGradient.addColorStop(.42,'#202c39');environmentGradient.addColorStop(1,'#060b13');
  ec.fillStyle=environmentGradient;ec.fillRect(0,0,1024,512);
  ec.fillStyle='#e6effa';ec.fillRect(90,95,280,50);ec.fillStyle='#8eabca';ec.fillRect(640,90,130,135);
  const environmentTexture=new THREE.CanvasTexture(environmentCanvas);environmentTexture.colorSpace=THREE.SRGBColorSpace;
  environmentTexture.mapping=THREE.EquirectangularReflectionMapping;
  const environmentGenerator=new THREE.PMREMGenerator(renderer);
  const environmentMap=environmentGenerator.fromEquirectangular(environmentTexture);
  scene.environment=environmentMap.texture;scene.environmentIntensity=.62;
  environmentTexture.dispose();environmentGenerator.dispose();
  const backgroundCanvas=document.createElement('canvas');backgroundCanvas.width=32;backgroundCanvas.height=400;
  const bc=backgroundCanvas.getContext('2d'),backgroundGradient=bc.createLinearGradient(0,0,0,400);
  backgroundGradient.addColorStop(0,'#080d14');backgroundGradient.addColorStop(.63,'#111a25');backgroundGradient.addColorStop(1,'#090f17');
  bc.fillStyle=backgroundGradient;bc.fillRect(0,0,32,400);
  const backgroundTexture=new THREE.CanvasTexture(backgroundCanvas);backgroundTexture.colorSpace=THREE.SRGBColorSpace;scene.background=backgroundTexture;

  scene.add(new THREE.HemisphereLight('#d7e5f6','#172033',1.5));
  const keyLight=new THREE.DirectionalLight('#edf4ff',3.0);
  keyLight.position.set(-4,8,6);keyLight.castShadow=true;keyLight.shadow.mapSize.set(1024,1024);
  Object.assign(keyLight.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:30});
  keyLight.shadow.bias=-.0003;keyLight.shadow.normalBias=.015;scene.add(keyLight);
  const rimLight=new THREE.DirectionalLight('#8cb0d5',2.0);rimLight.position.set(5,5,-5);scene.add(rimLight);
  const frontLight=new THREE.DirectionalLight('#ffffff',.6);frontLight.position.set(0,3,10);scene.add(frontLight);

  const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:'#05090e',roughness:.94,metalness:.03}));
  ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;ground.position.y=-.31;scene.add(ground);
  const group=new THREE.Group();scene.add(group);
  let world,runId='',running=false,lastWall=0,accumulator=0,lastCapture=-Infinity;
  let sphereMeshes=[],rods=[];
  const trialGeometries=new Set(),trialMaterials=new Set();
  const ownGeometry=g=>(trialGeometries.add(g),g),ownMaterial=m=>(trialMaterials.add(m),m);
  const sphereGeometry=new THREE.SphereGeometry(1,48,32);
  const rodGeometry=new THREE.CylinderGeometry(.035,.035,1,18);
  const boxGeometry=new THREE.BoxGeometry(1,1,1);
  const pinGeometry=new THREE.CylinderGeometry(.075,.075,.035,18);
  const metal=new THREE.MeshStandardMaterial({color:'#718192',metalness:.72,roughness:.29});
  const graphite=new THREE.MeshStandardMaterial({color:'#253140',metalness:.64,roughness:.42});
  const edgeMetal=new THREE.MeshStandardMaterial({color:'#536171',metalness:.72,roughness:.34});
  const ceramic=new THREE.MeshStandardMaterial({color:'#d3dfe9',emissive:'#9eacbb',emissiveIntensity:.35,roughness:.4});
  const up=new THREE.Vector3(0,1,0),a=new THREE.Vector3(),b=new THREE.Vector3(),direction=new THREE.Vector3();

  function placeRod(mesh,from,to){
    a.set(from.x,from.y,from.z);b.set(to.x,to.y,to.z);direction.subVectors(b,a);
    mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.y=direction.length();
    mesh.quaternion.setFromUnitVectors(up,direction.normalize());
  }
  function box(x,y,z,sx,sy,sz,material=graphite){
    const mesh=new THREE.Mesh(boxGeometry,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
  }
  function roundedPlate(width,depth){
    const x=-width/2,y=-depth/2,r=.23,shape=new THREE.Shape();
    shape.moveTo(x+r,y);shape.lineTo(x+width-r,y);shape.quadraticCurveTo(x+width,y,x+width,y+r);
    shape.lineTo(x+width,y+depth-r);shape.quadraticCurveTo(x+width,y+depth,x+width-r,y+depth);
    shape.lineTo(x+r,y+depth);shape.quadraticCurveTo(x,y+depth,x,y+depth-r);
    shape.lineTo(x,y+r);shape.quadraticCurveTo(x,y,x+r,y);
    const geometry=ownGeometry(new THREE.ExtrudeGeometry(shape,{depth:.19,steps:1,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:3,curveSegments:8}));
    geometry.rotateX(-Math.PI/2);
    const material=ownMaterial(new THREE.MeshStandardMaterial({color:'#202c38',metalness:.3,roughness:.58}));
    const plate=new THREE.Mesh(geometry,material);plate.position.y=-.23;plate.receiveShadow=true;plate.castShadow=true;group.add(plate);
  }
  function markings(width,depth){
    const positions=[];
    for(let x=-width/2+.5;x<width/2-.2;x+=.5)positions.push(x,.004,-depth/2+.12,x,.004,depth/2-.12);
    for(let z=-depth/2+.5;z<depth/2-.2;z+=.5)positions.push(-width/2+.12,.004,z,width/2-.12,.004,z);
    const geometry=ownGeometry(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const gridMaterial=ownMaterial(new THREE.LineBasicMaterial({color:'#435263',transparent:true,opacity:.24}));
    group.add(new THREE.LineSegments(geometry,gridMaterial));
  }
  function feet(width,depth){
    for(const x of [-width/2+.25,width/2-.25])for(const z of [-depth/2+.25,depth/2-.25]){
      box(x,-.26,z,.3,.13,.3,graphite);
      const pin=new THREE.Mesh(pinGeometry,metal);pin.position.set(x,.015,z);group.add(pin);
    }
  }
  function floorChamber(width,depth){
    roundedPlate(width+.42,depth+.42);markings(width,depth);feet(width+.2,depth+.2);
    for(const z of [-depth/2,depth/2]){
      box(0,.10,z,width+.08,.20,.1,edgeMetal);
      box(0,.205,z,width-.30,.014,.028,ceramic);
    }
    for(const x of [-width/2,width/2]){
      box(x,.1,0,.1,.20,depth+.08,edgeMetal);
      box(x,.205,0,.028,.014,depth-.3,ceramic);
    }
  }
  function backPanel(width,height,z){
    const panel=ownMaterial(new THREE.MeshStandardMaterial({color:'#14202c',metalness:.12,roughness:.75}));
    box(0,height/2,z,width,height,.08,panel);
    const positions=[];
    for(let y=.5;y<height;y+=.5)positions.push(-width/2+.25,y,z+.045,width/2-.25,y,z+.045);
    for(let x=-width/2+.5;x<width/2;x+=.5)positions.push(x,.25,z+.045,x,height-.25,z+.045);
    const geometry=ownGeometry(new THREE.BufferGeometry());geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    group.add(new THREE.LineSegments(geometry,ownMaterial(new THREE.LineBasicMaterial({color:'#374756',transparent:true,opacity:.22}))));
  }
  function disposeTrial(){
    group.clear();sphereMeshes=[];rods=[];
    for(const material of trialMaterials)material.dispose();trialMaterials.clear();
    for(const geometry of trialGeometries)geometry.dispose();trialGeometries.clear();
  }
  function reset(family){
    const seed=new Uint32Array(1);crypto.getRandomValues(seed);
    world=createHiddenWorld(seed[0],family);runId=crypto.randomUUID();
    running=false;accumulator=0;lastWall=performance.now();lastCapture=-Infinity;
    disposeTrial();
    sphereMeshes=world.bodies.map(body=>{
      const material=ownMaterial(new THREE.MeshPhysicalMaterial({color:body.color,roughness:.30,metalness:.06,clearcoat:.75,clearcoatRoughness:.27,envMapIntensity:.65}));
      const mesh=new THREE.Mesh(sphereGeometry,material);mesh.scale.setScalar(body.radius);
      mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
    });
    if(world.family==='pendulum'){
      camera.position.set(0,3.4,15);camera.lookAt(0,2.8,0);
      camera.left=-4.8;camera.right=4.8;camera.top=3;camera.bottom=-3;
      roundedPlate(6.4,2.5);markings(6.1,2.2);feet(6.2,2.3);
      backPanel(6.35,5.8,-1.05);
      for(const x of [-3.05,3.05]){
        box(x,2.92,-.65,.16,5.85,.2,graphite);
        box(x,2.92,-.53,.026,5.3,.018,ceramic);
      }
      box(0,5.82,-.65,6.25,.15,.2,graphite);
      const pivot=world.pivot;
      box(pivot.x,pivot.y,-.5,.55,.55,.5,graphite);
      const hub=new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(.18,.18,.28,32)),metal);
      hub.rotation.x=Math.PI/2;hub.position.set(pivot.x,pivot.y,-.11);hub.castShadow=true;group.add(hub);
      for(let i=0;i<2;i++){const rod=new THREE.Mesh(rodGeometry,metal);rod.castShadow=true;group.add(rod);rods.push(rod);}
      const pivotCap=new THREE.Mesh(ownGeometry(new THREE.CylinderGeometry(.072,.072,.055,24)),ceramic);
      pivotCap.rotation.x=Math.PI/2;pivotCap.position.set(pivot.x,pivot.y,.065);group.add(pivotCap);
    }else if(world.family==='collisions'){
      camera.position.set(0,10.2,9.2);camera.lookAt(0,0,0);
      camera.left=-4.7;camera.right=4.7;camera.top=2.9375;camera.bottom=-2.9375;
      floorChamber(world.bounds.x*2,world.bounds.z*2);
    }else{
      camera.position.set(0,4.45,16);camera.lookAt(0,2.48,0);
      camera.left=-4.9;camera.right=4.9;camera.top=3.0625;camera.bottom=-3.0625;
      floorChamber(world.bounds.x*2,world.bounds.z*2);
      backPanel(world.bounds.x*2+.1,world.bounds.y,-world.bounds.z-.1);
      for(const x of [-world.bounds.x,world.bounds.x]){
        box(x,world.bounds.y/2,-world.bounds.z,.13,world.bounds.y,.13,edgeMetal);
        box(x,world.bounds.y/2,-world.bounds.z+.075,.018,world.bounds.y-.4,.018,ceramic);
      }
      box(0,world.bounds.y,-world.bounds.z,world.bounds.x*2,.13,.13,edgeMetal);
      // Ceiling and side rails mark the actual collision boundaries. The open
      // front keeps every moving object visible to the image-only observer.
      for(const x of [-world.bounds.x,world.bounds.x])box(x,world.bounds.y,0,.08,.08,world.bounds.z*2,graphite);
      box(0,world.bounds.y,world.bounds.z,world.bounds.x*2,.08,.08,graphite);
    }
    camera.updateProjectionMatrix();paint();
    respond({type:'tf-world-reset',run_id:runId,family:world.family});
  }
  function paint(){
    if(!world)return;
    for(let i=0;i<sphereMeshes.length;i++){const p=world.bodies[i].p;sphereMeshes[i].position.set(p.x,p.y,p.z);}
    if(rods.length){placeRod(rods[0],world.pivot,world.bodies[0].p);placeRod(rods[1],world.bodies[0].p,world.bodies[1].p);}
    renderer.render(scene,camera);
  }
  function capture(){
    const now=performance.now();
    if(!world||now-lastCapture<1000/15)return;
    lastCapture=now;paint();
    const image=renderer.domElement.toDataURL('image/jpeg',.86);
    respond({type:'tf-frame',run_id:runId,t:world.time,width:WIDTH,height:HEIGHT,image_base64:image.slice(image.indexOf(',')+1)});
  }
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==allowedOrigin)return;
    const value=event.data;
    if(!value||value.type!=='tf-world'||typeof value.command!=='string')return;
    if(value.command==='reset'){
      if(value.family!==undefined&&!['random',...FAMILIES].includes(value.family))return;
      reset(value.family||'random');
    }else if(value.command==='play'){running=true;lastWall=performance.now();}
    else if(value.command==='pause'){running=false;accumulator=0;paint();}
    else if(value.command==='capture')capture();
    else if(value.command==='impulse'&&running&&world){
      const seed=new Uint32Array(1);crypto.getRandomValues(seed);
      applyHiddenImpulse(world,seed[0]);
      respond({type:'tf-world-intervention',run_id:runId,t:world.time});
    }
  });
  function frame(now){
    const elapsed=Math.max(0,Math.min(.1,(now-lastWall)/1000));lastWall=now;
    if(running&&world){accumulator+=elapsed;while(accumulator>=FIXED_STEP){stepHiddenWorld(world,FIXED_STEP);accumulator-=FIXED_STEP;}paint();}
    requestAnimationFrame(frame);
  }
  reset('random');respond({type:'tf-world-ready'});requestAnimationFrame(frame);
}
