/** Simulation-only plant. Hidden coefficients never enter the predictor API. */
import {stepPhysics, cloneModel, relaxNet} from './model.mjs';
import {stepSpheres,pendulumAcceleration,stepPendulumRK4,stepOrbitState} from './alt-models.mjs';
export function createEvaluator(){
  const plant={g:9.81,drag:0.012,restGround:0.62,restBoard:0.55,restRim:0.48,friction:0.18,windX:0,magnusCoefficient:0.002,mass:0.62,
    geometry:{ballRadius:0.12,floorY:0,netHeight:0.4,hoop:{center:{x:0,y:3.05,z:-0.039},radius:0.2286,tubeRadius:0.021},board:{center:{x:0,y:3.45,z:-0.42},size:{x:1.83,y:1.07,z:0.045}},bounds:{x:[-5.5,5.5],z:[-1.1,6.8]},obstacles:[]}};
  return Object.freeze({
    advance(state,dt,{wind=0}={}){return stepPhysics(state,{...plant,windX:wind},dt);},
    relaxNet(net,dt){relaxNet(net,plant,dt);},
    advanceSpheres(bodies,dt){return stepSpheres(bodies,{g:9.81,restitution:0.58,friction:0.1},dt);},
    pendulumAcceleration(th1,th2,w1,w2,L1,L2){return pendulumAcceleration(th1,th2,w1,w2,L1,L2,{g:9.81});},
    advancePendulum(state,{L1,L2},dt){return stepPendulumRK4(state,{g:9.81,L1,L2},dt);},
    advanceOrbit(state,center,dt){stepOrbitState(state,center,2.6,dt);},
    // Geometry is a declared scene prior, not an inferred real-world reconstruction.
    renderingGeometry(){return cloneModel(plant.geometry);},
    evaluateAfterRun(estimate){const result={};for(const key of ['g','drag','restGround','restBoard','restRim','friction'])result[key]={estimated:estimate[key],evaluation:plant[key],error:estimate[key]-plant[key]};return result;},
  });
}
