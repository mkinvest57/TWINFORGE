/**
 * The visual plant lives behind a pixel-only message boundary.
 * No hidden simulator quantity is posted to the observer or SAM.
 */
import * as THREE from '../../assets/vendor/three/build/three.module.js';
import {createHiddenWorld,stepHiddenWorld,FIXED_STEP,FAMILIES} from './random-dynamics.mjs';

const WIDTH=640,HEIGHT=400,allowedOrigin=location.origin;
const respond=message=>parent.postMessage(message,allowedOrigin);
let renderer;
try{
  renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
  renderer.setPixelRatio(1);renderer.setSize(WIDTH,HEIGHT,false);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.domElement.setAttribute('aria-label','Random 3D scene observed through pixels');
  document.body.append(renderer.domElement);
}catch{
  document.querySelector('#error').hidden=false;
  respond({type:'tf-world-error',message:'WebGL is unavailable.'});
}

if(renderer){
  const scene=new THREE.Scene();scene.background=new THREE.Color('#d9e1e8');
  const camera=new THREE.OrthographicCamera(-5.76,5.76,3.6,-3.6,.1,60);
  scene.add(new THREE.HemisphereLight('#ffffff','#596777',2.3));
  const light=new THREE.DirectionalLight('#fff4df',3.0);
  light.position.set(-3,8,6);light.castShadow=true;light.shadow.mapSize.set(1024,1024);
  Object.assign(light.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:30});
  light.shadow.bias=-.0008;light.shadow.normalBias=.02;scene.add(light);
  const fill=new THREE.DirectionalLight('#d7e8ff',1.4);fill.position.set(5,4,-3);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:'#c3ced8',roughness:.88}));
  floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.025;scene.add(floor);
  const groundGrid=new THREE.GridHelper(12,24,'#9daebd','#b8c5d0');
  groundGrid.position.y=.002;groundGrid.material.transparent=true;groundGrid.material.opacity=.32;scene.add(groundGrid);
  const group=new THREE.Group();scene.add(group);
  let world,runId='',running=false,lastWall=0,accumulator=0,lastCapture=-Infinity;
  let sphereMeshes=[],rods=[];
  const geometries=new Set(),materials=new Set();
  const ownGeometry=g=>(geometries.add(g),g),ownMaterial=m=>(materials.add(m),m);
  const sphereGeometry=ownGeometry(new THREE.SphereGeometry(1,40,28));
  const rodGeometry=ownGeometry(new THREE.CylinderGeometry(.038,.038,1,14));
  const boxGeometry=ownGeometry(new THREE.BoxGeometry(1,1,1));
  const rodMaterial=ownMaterial(new THREE.MeshStandardMaterial({color:'#4e6070',metalness:.55,roughness:.35}));
  const up=new THREE.Vector3(0,1,0),a=new THREE.Vector3(),b=new THREE.Vector3(),direction=new THREE.Vector3();
  function placeRod(mesh,from,to){
    a.set(from.x,from.y,from.z);b.set(to.x,to.y,to.z);direction.subVectors(b,a);
    mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.scale.y=direction.length();
    mesh.quaternion.setFromUnitVectors(up,direction.normalize());
  }
  function disposeTrial(){
    group.clear();sphereMeshes=[];rods=[];
    for(const material of [...materials])if(material!==rodMaterial){material.dispose();materials.delete(material);}
  }
  function reset(family){
    const seed=new Uint32Array(1);crypto.getRandomValues(seed);
    world=createHiddenWorld(seed[0],family);runId=crypto.randomUUID();
    running=false;accumulator=0;lastWall=performance.now();lastCapture=-Infinity;
    disposeTrial();
    sphereMeshes=world.bodies.map(body=>{
      const material=ownMaterial(new THREE.MeshStandardMaterial({color:body.color,roughness:.24,metalness:.12}));
      const mesh=new THREE.Mesh(sphereGeometry,material);mesh.scale.setScalar(body.radius);
      mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;
    });
    if(world.family==='pendulum'){
      camera.position.set(0,3.0,15);camera.lookAt(0,3.0,0);
      camera.left=-5.2;camera.right=5.2;camera.top=3.25;camera.bottom=-3.25;
      for(let i=0;i<2;i++){const rod=new THREE.Mesh(rodGeometry,rodMaterial);rod.castShadow=true;group.add(rod);rods.push(rod);}
      const pivotMesh=new THREE.Mesh(sphereGeometry,rodMaterial);pivotMesh.scale.setScalar(.11);
      pivotMesh.position.set(world.pivot.x,world.pivot.y,world.pivot.z);group.add(pivotMesh);
      // A visible mechanical support makes the pivot understandable; it is not a detector prompt.
      const support=new THREE.Mesh(boxGeometry,rodMaterial);support.scale.set(2.5,.14,.35);
      support.position.set(world.pivot.x,world.pivot.y+.17,-.17);support.castShadow=true;group.add(support);
    }else if(world.family==='collisions'){
      camera.position.set(0,9.6,8.3);camera.lookAt(0,0,0);
      camera.left=-5.7;camera.right=5.7;camera.top=3.5625;camera.bottom=-3.5625;
      const borderMaterial=ownMaterial(new THREE.MeshStandardMaterial({color:'#889bad',roughness:.8}));
      for(const z of [-world.bounds.z,world.bounds.z]){
        const mesh=new THREE.Mesh(boxGeometry,borderMaterial);mesh.scale.set(world.bounds.x*2,.15,.06);mesh.position.set(0,.055,z);group.add(mesh);
      }
      for(const x of [-world.bounds.x,world.bounds.x]){
        const mesh=new THREE.Mesh(boxGeometry,borderMaterial);mesh.scale.set(.06,.15,world.bounds.z*2);mesh.position.set(x,.055,0);group.add(mesh);
      }
    }else{
      camera.position.set(0,4,14);camera.lookAt(0,2.2,0);
      camera.left=-5.7;camera.right=5.7;camera.top=3.5625;camera.bottom=-3.5625;
      const wallMaterial=ownMaterial(new THREE.MeshStandardMaterial({color:'#9ab0c0',transparent:true,opacity:.15,roughness:.2,depthWrite:false}));
      for(const x of [-world.bounds.x,world.bounds.x]){
        const wall=new THREE.Mesh(boxGeometry,wallMaterial);wall.scale.set(.05,6,world.bounds.z*2);wall.position.set(x,3,0);group.add(wall);
        const edge=new THREE.Mesh(boxGeometry,rodMaterial);edge.scale.set(.04,6,.04);edge.position.set(x,3,-world.bounds.z);group.add(edge);
      }
      for(const z of [-world.bounds.z,world.bounds.z]){
        const wall=new THREE.Mesh(boxGeometry,wallMaterial);wall.scale.set(world.bounds.x*2,6,.03);wall.position.set(0,3,z);group.add(wall);
      }
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
    const image=renderer.domElement.toDataURL('image/jpeg',.84);
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
  });
  function frame(now){
    const elapsed=Math.max(0,Math.min(.1,(now-lastWall)/1000));lastWall=now;
    if(running&&world){accumulator+=elapsed;while(accumulator>=FIXED_STEP){stepHiddenWorld(world,FIXED_STEP);accumulator-=FIXED_STEP;}paint();}
    requestAnimationFrame(frame);
  }
  reset('random');respond({type:'tf-world-ready'});requestAnimationFrame(frame);
}
