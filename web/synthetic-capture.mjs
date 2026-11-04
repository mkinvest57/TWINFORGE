/** Synthetic pixels at exact simulated times. Evaluation truth is never an observation. */
import * as THREE from 'three';
import {stepPhysics,cloneBody} from './physics/model.mjs';
const vector=a=>({x:a[0],y:a[1],z:a[2]});
function rowMajor(matrix){const a=matrix.elements;return [0,1,2,3].flatMap(r=>[0,1,2,3].map(c=>a[c*4+r]));}
function seeded(seed){let x=(Number(seed)>>>0)||1;return ()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296;};}
export async function generateCapture({seed=20261104,onProgress=()=>{}}={}){
  const fps=12,width=640,height=480,frameCount=36,random=seeded(seed),capture_id=`synthetic-${Date.now()}-${Number(seed)>>>0}`;
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,alpha:false});
  renderer.setPixelRatio(1);renderer.setSize(width,height,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#202934');
  const camera=new THREE.PerspectiveCamera(43,width/height,.05,50);camera.position.set(2.8,2.7,4.3);camera.lookAt(0,1.4,0);camera.updateMatrixWorld(true);camera.updateProjectionMatrix();
  const hemi=new THREE.HemisphereLight(0xf6fbff,0x86929f,2.2);scene.add(hemi);
  const light=new THREE.DirectionalLight(0xffffff,2.4);light.position.set(-3,7,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-5;light.shadow.camera.right=5;light.shadow.camera.top=6;light.shadow.camera.bottom=-3;scene.add(light);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,12),new THREE.MeshStandardMaterial({color:0x596775,roughness:.9}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const grid=new THREE.GridHelper(12,12,0x8292a2,0x697987);grid.position.y=.001;scene.add(grid);
  const radius=.12,hoop={center:{x:1.1,y:1.85,z:-.8},radius:.23,tubeRadius:.018};
  const ring=new THREE.Mesh(new THREE.TorusGeometry(hoop.radius,hoop.tubeRadius,12,64),new THREE.MeshStandardMaterial({color:0xd8e4ef,metalness:.55,roughness:.35}));ring.rotation.x=Math.PI/2;ring.position.set(hoop.center.x,hoop.center.y,hoop.center.z);ring.castShadow=true;scene.add(ring);
  const board=new THREE.Mesh(new THREE.BoxGeometry(1.1,.7,.05),new THREE.MeshStandardMaterial({color:0xe5e9ed,roughness:.7}));board.position.set(1.1,2.15,-1.08);board.castShadow=true;scene.add(board);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.2,12),new THREE.MeshStandardMaterial({color:0x94a3b5,metalness:.6,roughness:.5}));pole.position.set(1.1,1.1,-1.15);scene.add(pole);
  const ball=new THREE.Mesh(new THREE.SphereGeometry(radius,48,32),new THREE.MeshStandardMaterial({color:0xff6315,roughness:.68,metalness:0}));ball.castShadow=true;scene.add(ball);
  // A gray foreground panel creates two known visual occlusions; it exerts no force.
  const occluder=new THREE.Mesh(new THREE.PlaneGeometry(.16,.36),new THREE.MeshStandardMaterial({color:0x45576b,roughness:.8,side:THREE.DoubleSide}));occluder.quaternion.copy(camera.quaternion);scene.add(occluder);
  const model={g:9.81,drag:.035,windAcceleration:[.12,0,.08],windX:0,friction:.16,restGround:.72,restBoard:.64,restRim:.58,magnusCoefficient:0,mass:.62,geometry:{ballRadius:radius,floorY:0,netHeight:.4,hoop,board:{center:{x:1.1,y:2.15,z:-1.08},size:{x:1.1,y:.7,z:.05}},obstacles:[]}};
  const state={p:vector([-1.4,.7,.8]),v:vector([1.1+(random()-.5)*.15,5.8+(random()-.5)*.15,-.6+(random()-.5)*.12]),spin:vector([0,0,0])},initial=cloneBody(state);
  const conversion=new THREE.Matrix4().makeScale(1,-1,-1),cameraToWorld=camera.matrixWorld.clone().multiply(conversion),worldToCamera=cameraToWorld.clone().invert(),ctw=rowMajor(cameraToWorld);
  const focal=height/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))),calibration={schema_version:'twinforge.calibration.v1',mode:'sphere_size',source:'declared synthetic fixture camera and ball geometry; not fitted physics',camera_matrix:[[focal,0,width/2],[0,focal,height/2],[0,0,1]],camera_to_world_rotation:[ctw.slice(0,3),ctw.slice(4,7),ctw.slice(8,11)],camera_to_world_translation_m:[ctw[3],ctw[7],ctw[11]],ball_diameter_m:radius*2,diameter_uncertainty_m:0,pixel_uncertainty:.5,pixel_center_offset_px:.5,pixel_coordinate_convention:'camera intrinsics and projected truth use image edges; raster integer indices are pixel centres and require +0.5',distortion_coefficients:[0,0,0,0,0],image_width:width,image_height:height,world_to_camera_cv:rowMajor(worldToCamera),camera_to_world_cv:ctw,coordinate_convention:'OpenCV camera x right, y down, z forward; world x right, y up, z toward default viewer',timestamps:'frame_index / fps, fixed physical integration; no wall-clock resampling'};
  const frames=[],truth=[],cameraRight=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);let simulated=0;
  try{
    onProgress({phase:'render',completed:0,total:frameCount,fraction:0,capture_id});
    for(let frame_index=0;frame_index<frameCount;frame_index++){
      const t=frame_index/fps,contacts=new Set();
      while(simulated<t-1e-12){const dt=Math.min(1/240,t-simulated);stepPhysics(state,model,dt);simulated+=dt;for(const contact of state.lastContacts||[])contacts.add(contact);}
      ball.position.set(state.p.x,state.p.y,state.p.z);
      const occluded=frame_index===12||frame_index===13;occluder.visible=occluded;
      if(occluded){const towardCamera=camera.position.clone().sub(ball.position).normalize();occluder.position.copy(ball.position).addScaledVector(towardCamera,.3).addScaledVector(cameraRight,.1);}
      renderer.render(scene,camera);
      frames.push({frame_index,t,png:renderer.domElement.toDataURL('image/png')});
      const projected=ball.position.clone().project(camera);
      truth.push({frame_index,t,position_m:[state.p.x,state.p.y,state.p.z],velocity_m_s:[state.v.x,state.v.y,state.v.z],contacts:[...contacts],occlusion:occluded?'partial_gray_foreground_panel':'none',center_px:[(projected.x+1)*width/2,(1-projected.y)*height/2]});
      onProgress({phase:'render',completed:frame_index+1,total:frameCount,fraction:(frame_index+1)/frameCount,capture_id});
      await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    const payload={schema_version:'twinforge.synthetic-capture.v1',capture_id,seed:Number(seed)>>>0,fps,width,height,frames,calibration,evaluation_truth:{schema_version:'twinforge.evaluation-truth.v1',access:'evaluation only; exclude from perception/model fitting inputs',source_kind:'synthetic',integration_step_s:1/240,parameters:model,initial_state:initial,frames:truth}};
    onProgress({phase:'encode',completed:frameCount,total:frameCount,fraction:1,capture_id});
    const response=await fetch('/api/synthetic/build',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),result=await response.json();
    if(!response.ok)throw new Error(result.error||`Synthetic capture failed (HTTP ${response.status}).`);
    onProgress({phase:'complete',completed:frameCount,total:frameCount,fraction:1,capture_id});return result;
  }finally{scene.traverse(object=>{object.geometry?.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m?.dispose());});renderer.dispose();renderer.forceContextLoss();}
}
