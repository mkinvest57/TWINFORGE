/** Synthetic laboratory only. Latent parameters stay in this closure until reveal().
 * Calibration consumers receive observations, measured geometry and split IDs;
 * they never receive the simulator state or its parameter object.
 * The plant intentionally uses the application's known family: this evaluates L3
 * parameter identification/generalisation, not discovery of unknown physics.
 */
import {stepPhysics, v3, cloneBody, PHYSICS_DT} from '../../web/physics/model.mjs';
import {seededRandom} from '../../web/physics/control.mjs';
import {stepPendulumState,stepLiquidState,stepOrbitState,stepSpheres} from '../../web/physics/alt-models.mjs';
const copy=x=>structuredClone(x), axes=['x','y','z'];
export const SPLIT_OFFSETS={train:10000,validation:20000,test:30000};
export function geometry(kind='normal') {
  const g={ballRadius:.12,floorY:0,netHeight:.4,hoop:{center:v3(0,3.05,0),radius:.23,tubeRadius:.018},board:{center:v3(0,3.4,-.42),size:v3(1.8,1.05,.05)},obstacles:[{id:'forbidden-box',center:v3(2.8,1.1,0),size:v3(.5,2.2,.5)}]};
  if(['free','ground','board'].includes(kind)){g.hoop.center=v3(30,30,30);g.netHeight=.4;}
  if(kind==='free'){g.floorY=-100;g.board=null;g.obstacles=[];}
  if(kind==='ground'){g.board=null;g.obstacles=[];}
  if(kind==='board'){g.board={center:v3(0,2,-.5),size:v3(8,8,.05)};g.floorY=-100;g.obstacles=[];}
  if(kind==='rim'){g.board=null;g.obstacles=[];}
  return g;
}
const body=(p,v,spin=v3())=>({p,v,spin,orientation:{x:0,y:0,z:0,w:1}});
export function createPlant(seed=20261104){
  const r=seededRandom(seed), latent={
    hoop:{g:9.2+r()*1.2,drag:.012+r()*.016,windAcceleration:[.03+r()*.07,0,-.04+r()*.08],windX:0,magnusCoefficient:.001+r()*.002,friction:.025+r()*.025,restGround:.68+r()*.12,restBoard:.64+r()*.13,restRim:.58+r()*.14,mass:.62},
    multi:{g:9+r()*1.5,restitution:.66+r()*.16,friction:.06+r()*.08},
    chaos:{g:9+r()*1.5,m1:1,m2:.7+r()*.6,L1:1.35,L2:1.1},
    liquid:{rate:.13+r()*.08,brim:1.4,bottom:0,area:1.6},
    orbit:{mu:14+r()*5,center:v3(),planetRadius:.95}
  };
  function observe(scene,split,index=0,kind='default',duration,intervention=null){
    if(!(split in SPLIT_OFFSETS))throw Error('Unknown split');
    const episodeSeed=(seed+SPLIT_OFFSETS[split]+index*997+scene.length*71)>>>0,rng=seededRandom(episodeSeed),dt=PHYSICS_DT;
    const info={id:`${scene}-${split}-${episodeSeed}-${kind}`,scene,split,seed:episodeSeed,dt,source_kind:'synthetic',observations:[],contacts:[],geometry:null};
    let state,params,step,observeState;
    if(scene==='hoop'){
      let g=geometry(kind==='default'?'normal':kind);
      if(kind==='control_obstacle')g.obstacles=[{id:'intercepting-box',center:v3(.32,3.8,.12),size:v3(.12,.12,.12)}];
      params={...copy(latent.hoop),geometry:g};info.geometry=copy(g);
      if(kind==='free')state=body(v3(-1+rng(),2+rng(),2+rng()),v3(2+rng()*3,3+rng()*3,-2-rng()*2),v3(.4+index*.3,2+index,1-index*.2));
      else if(kind==='ground')state=body(v3(0,.75,0),v3(5,-2,1));
      else if(kind==='board')state=body(v3(0,2.5,.5),v3(.3,.4,-4));
      else if(kind==='rim')state=body(v3(.23,3.65,0),v3(0,-1,0));
      else if(kind==='net')state=body(v3(.025,3.65,.01),v3(0,-1,0));
      else if(kind==='obstacle')state=body(v3(2,1.2,0),v3(3,0,0));
      else if(kind.startsWith('control'))state=body(v3((index%3-1)*.10+.32,4.5,.12),v3(.1,-.3,0));
      else state=body(v3(index%2===0?.015:.52,4.3+rng()*.2,.015),v3(.01,-.3,0));
      info.observed_spin=copy(state.spin);info.observation_method='Exact sampled synthetic positions and optical orientation-derived spin; no sensor noise in identification baseline.';
      step=()=>{stepPhysics(state,params,dt);return state.lastContacts.map(type=>({type}));};
      observeState=()=>({p:axes.map(a=>state.p[a])});duration??=(kind==='free'?.6:1.4);
    }else if(scene==='multi'){
      params=copy(latent.multi);info.geometry={radii:[.18,.18],equal_mass_assumption:true};
      if(kind==='free')state=[{p:v3(-1-rng(),3+rng(),0),v:v3(1+rng(),2+rng(),0),r:.18},{p:v3(1+rng(),4+rng(),0),v:v3(-.3-rng(),1+rng(),0),r:.18}];
      else state=[{p:v3(-.7-rng()*.1,.9+rng()*.15,0),v:v3(1.5,0,0),r:.18},{p:v3(.7+rng()*.1,.9+rng()*.15,0),v:v3(-1.5,0,0),r:.18}];
      step=()=>stepSpheres(state,params,dt);observeState=()=>({positions:state.map(b=>axes.map(a=>b.p[a]))});duration??=kind==='free'?.5:1.5;
    }else if(scene==='chaos'){
      params=copy(latent.chaos);info.geometry={L1:params.L1,L2:params.L2,m1:1};
      state={th1:.8+rng()*1.2,th2:-.8+rng()*1.4,w1:-.3+rng()*.6,w2:-.3+rng()*.6};
      step=()=>{stepPendulumState(state,params,dt);return[];};observeState=()=>({angles:[state.th1,state.th2]});duration??=.95;
    }else if(scene==='liquid'){
      params=copy(latent.liquid);info.geometry={brim:params.brim,bottom:params.bottom,area:params.area};
      state={level:kind==='overflow'?1.35:.15+rng()*.8,spilled:0};
      step=()=>{stepLiquidState(state,params,dt);return[];};observeState=()=>({level:state.level,volume:(state.level-params.bottom)*params.area,spilled:state.spilled});duration??=kind==='overflow'?2:.95;
    }else if(scene==='orbit'){
      params=copy(latent.orbit);info.geometry={center:copy(params.center),planetRadius:params.planetRadius};
      const radius=2.4+rng()*.8,angle=rng()*Math.PI*2,speed=Math.sqrt(params.mu/radius)*(1+(rng()-.5)*.08);
      state=body(v3(radius*Math.cos(angle),radius*Math.sin(angle),0),v3(-speed*Math.sin(angle),speed*Math.cos(angle),0));
      step=()=>{stepOrbitState(state,params.center,params.mu,dt);return Math.hypot(state.p.x,state.p.y,state.p.z)<params.planetRadius?[{type:'planet'}]:[];};observeState=()=>({p:axes.map(a=>state.p[a])});duration??=1.05;
    }else throw Error('Unknown scene');
    if(intervention){if(!['g','rate','mu'].includes(intervention.parameter)||!(intervention.factor>0))throw Error('Unsupported intervention');params[intervention.parameter]*=intervention.factor;info.intervention=copy(intervention);}
    const steps=Math.round(duration/dt);info.observations.push({t:0,...observeState()});
    for(let n=1;n<=steps;n++){const contacts=step();info.observations.push({t:n*dt,...observeState()});for(const c of contacts)info.contacts.push({t:n*dt,...c});}
    return info;
  }
  return {observe,reveal:()=>copy(latent)};
}
