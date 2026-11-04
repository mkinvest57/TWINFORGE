/** Deterministic, parameter-only dynamics. No evaluator, DOM, or network access. */
export const PHYSICS_DT = 1 / 240;
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const add = (a, b, k = 1) => { a.x += b.x * k; a.y += b.y * k; a.z += b.z * k; return a; };
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = a => Math.hypot(a.x, a.y, a.z);
const scale = (a, k) => v3(a.x * k, a.y * k, a.z * k);
const unit = a => scale(a, 1 / (norm(a) || 1));
export const cloneModel = p => structuredClone(p);
export function cloneBody(s) {
  return { p: { ...s.p }, v: { ...s.v }, spin: { ...(s.spin || v3()) },
    orientation: { ...(s.orientation || { x: 0, y: 0, z: 0, w: 1 }) },
    net: s.net ? structuredClone(s.net) : null, lastContacts: [] };
}
export function validateModel(p) {
  const errors = [];
  const required=p?.collisionEnabled===false?['g','drag','magnusCoefficient']:['g','drag','friction','restGround','restBoard','restRim','windX','magnusCoefficient'];
  for (const k of required)
    if (!Number.isFinite(p?.[k])) errors.push(`Missing finite ${k}`);
  if(p?.collisionEnabled===false&&(!Array.isArray(p.windAcceleration)||p.windAcceleration.length!==3||!p.windAcceleration.every(Number.isFinite)))errors.push('Missing wind acceleration vector');
  if (!(p?.geometry?.ballRadius > 0)) errors.push('Missing ball radius');
  if (!Number.isFinite(p?.geometry?.floorY)) errors.push('Missing floor height');
  const h = p?.geometry?.hoop;
  if (!h || ![h.center?.x, h.center?.y, h.center?.z, h.radius, h.tubeRadius].every(Number.isFinite)) errors.push('Missing hoop geometry');
  if (p?.g < 0 || p?.drag < 0 || p?.friction < 0) errors.push('Negative force parameter');
  for (const k of ['restGround', 'restBoard', 'restRim']) if (p?.[k] < 0 || p?.[k] > 1) errors.push(`Invalid ${k}`);
  return errors;
}
function impact(s, n, e, friction, radius) {
  const vn = dot(s.v, n);
  if (vn >= 0) return;
  const j = -(1 + e) * vn;
  add(s.v, n, j);
  const arm=scale(n,-radius),w=s.spin||v3(),rotational=v3(w.y*arm.z-w.z*arm.y,w.z*arm.x-w.x*arm.z,w.x*arm.y-w.y*arm.x),contact=add({...s.v},rotational);
  const tangent=sub(contact,scale(n,dot(contact,n))),speed=norm(tangent);
  if(speed>1e-9){
    const impulse=scale(tangent,-Math.min(speed/3.5,friction*j)/speed);add(s.v,impulse);
    s.spin||=v3();const torque=v3(arm.y*impulse.z-arm.z*impulse.y,arm.z*impulse.x-arm.x*impulse.z,arm.x*impulse.y-arm.y*impulse.x);add(s.spin,torque,1/(0.4*radius*radius));
  }
}
function sphereBox(s, box, radius, restitution, friction) {
  const c = box.center, z = box.size;
  const q = v3(Math.max(c.x-z.x/2, Math.min(c.x+z.x/2, s.p.x)), Math.max(c.y-z.y/2, Math.min(c.y+z.y/2, s.p.y)), Math.max(c.z-z.z/2, Math.min(c.z+z.z/2, s.p.z)));
  let d = sub(s.p, q), length = norm(d);
  if (length >= radius) return false;
  if (length < 1e-9) {
    const faces = ['x','y','z'].map(axis => ({ axis, distance: z[axis]/2 - Math.abs(s.p[axis]-c[axis]) })).sort((a,b)=>a.distance-b.distance);
    d = v3(); d[faces[0].axis] = s.p[faces[0].axis] >= c[faces[0].axis] ? 1 : -1;
    length = -faces[0].distance;
  }
  const n = unit(d); add(s.p, n, radius-length); impact(s,n,restitution,friction,radius); return true;
}
export function createNet(geometry) {
  const h = geometry.hoop, rows = 5, cols = 12, height = geometry.netHeight ?? 0.4;
  const nodes = [], edges = [];
  for (let r=0;r<=rows;r++) for(let c=0;c<cols;c++) {
    const a = c/cols*Math.PI*2 + (r%2)*Math.PI/cols;
    const rad = h.radius*0.96 + (h.radius*0.42-h.radius*0.96)*r/rows;
    const p = v3(h.center.x + Math.cos(a)*rad,h.center.y-0.025-height*r/rows,h.center.z+Math.sin(a)*rad);
    nodes.push({p, v:v3(), anchor:r===0, rest:{...p}});
  }
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) for(const shift of [0, r%2 ? 1 : -1]) {
    const a=r*cols+c,b=(r+1)*cols+(c+shift+cols)%cols;
    edges.push({a,b,length:norm(sub(nodes[a].p,nodes[b].p))});
  }
  // Circumferential strands keep the opening size constrained under gravity.
  for(let r=1;r<=rows;r++)for(let c=0;c<cols;c++){
    const a=r*cols+c,b=r*cols+(c+1)%cols;edges.push({a,b,length:norm(sub(nodes[a].p,nodes[b].p))});
  }
  return {nodes,edges,contactCount:0,maxDisplacement:0};
}
function stepNet(s,p,dt,contacts) {
  const h=p.geometry.hoop,r=p.geometry.ballRadius;
  const near=Math.hypot(s.p.x-h.center.x,s.p.z-h.center.z)<h.radius+r+0.15 && s.p.y<h.center.y+r+0.1 && s.p.y>h.center.y-(p.geometry.netHeight??0.4)-r;
  if(!s.net && !near) return;
  s.net ||= createNet(p.geometry);
  const net=s.net,previous=net.nodes.map(n=>({...n.p}));
  for(const n of net.nodes) if(!n.anchor) { n.v.y-=p.g*dt; const damping=Math.exp(-2.5*dt); n.v=scale(n.v,damping); add(n.p,n.v,dt); }
  // Position constraints represent inextensible braided strands, anchored at the ring.
  for(let pass=0;pass<4;pass++) for(const e of net.edges) {
    const a=net.nodes[e.a],b=net.nodes[e.b],d=sub(b.p,a.p),l=norm(d),w=Number(!a.anchor)+Number(!b.anchor);
    if(l<1e-9||!w) continue;
    const correction=scale(d,(l-e.length)/l*0.92/w);
    if(!a.anchor)add(a.p,correction); if(!b.anchor)add(b.p,correction,-1);
  }
  if(near) for(const e of net.edges) {
    const a=net.nodes[e.a],b=net.nodes[e.b],ab=sub(b.p,a.p),len2=dot(ab,ab);
    const t=Math.max(0,Math.min(1,dot(sub(s.p,a.p),ab)/(len2||1))),q=add({...a.p},ab,t),delta=sub(s.p,q),d=norm(delta);
    const strandRadius=p.netStrandRadius??0.002;
    if(d>=r+strandRadius||d<1e-8)continue;
    const n=scale(delta,1/d),penetration=r+strandRadius-d,nodeMass=0.0015,ballMass=p.mass??0.62;
    const movable=Number(!a.anchor)+Number(!b.anchor);
    const ballFraction=movable ? Math.min(0.12,nodeMass*2/(ballMass+nodeMass*2)) : 1;
    add(s.p,n,penetration*ballFraction);
    if(!a.anchor)add(a.p,n,-penetration*(1-ballFraction)*(1-t));
    if(!b.anchor)add(b.p,n,-penetration*(1-ballFraction)*t);
    const strandV=add(scale(a.v,1-t),b.v,t),relative=dot(sub(s.v,strandV),n);
    if(relative<0)add(s.v,n,-relative*ballFraction);
    net.contactCount++; contacts.push('net');
  }
  for(let i=0;i<net.nodes.length;i++) {
    const n=net.nodes[i]; if(n.anchor){n.p={...n.rest};n.v=v3();}else n.v=scale(sub(n.p,previous[i]),1/dt);
    net.maxDisplacement=Math.max(net.maxDisplacement,norm(sub(n.p,n.rest)));
  }
}
export function relaxNet(net,p,dt=PHYSICS_DT){if(!net)return;stepNet({p:v3(1e6,1e6,1e6),v:v3(),spin:v3(),net},p,dt,[]);}
export function stepPhysics(s,p,dt=PHYSICS_DT) {
  const v=s.v,spin=s.spin||(s.spin=v3()),speed=norm(v),m=p.magnusCoefficient;
  const wind=p.windAcceleration||[p.windX*0.12,0,0];
  const a=v3(-p.drag*speed*v.x+wind[0]+(spin.y*v.z-spin.z*v.y)*m,-p.g-p.drag*speed*v.y+wind[1]+(spin.z*v.x-spin.x*v.z)*m,-p.drag*speed*v.z+wind[2]+(spin.x*v.y-spin.y*v.x)*m);
  add(v,a,dt);add(s.p,v,dt); const contacts=[],geo=p.geometry,r=geo.ballRadius;
  if(p.collisionEnabled!==false){
  if(s.p.y<geo.floorY+r){s.p.y=geo.floorY+r;impact(s,v3(0,1,0),Math.abs(v.y)>0.3?p.restGround:0,p.friction,r);contacts.push('ground');}
  if(geo.board&&sphereBox(s,geo.board,r,p.restBoard,p.friction))contacts.push('board');
  const h=geo.hoop,dx=s.p.x-h.center.x,dz=s.p.z-h.center.z,rad=Math.hypot(dx,dz);
  const q=v3(h.center.x+(rad>1e-9?dx/rad:1)*h.radius,h.center.y,h.center.z+(rad>1e-9?dz/rad:0)*h.radius),delta=sub(s.p,q),distance=norm(delta);
  if(distance<r+h.tubeRadius&&distance>1e-9){const n=scale(delta,1/distance);add(s.p,n,r+h.tubeRadius-distance);impact(s,n,p.restRim,p.friction,r);contacts.push('rim');}
  for(const obstacle of geo.obstacles||[]) if(sphereBox(s,obstacle,r,p.restBoard,p.friction))contacts.push(`obstacle:${obstacle.id||'box'}`);
  stepNet(s,p,dt,contacts);
  const b=geo.bounds;
  if(b)for(const axis of ['x','z']){if(s.p[axis]<b[axis][0]+r){s.p[axis]=b[axis][0]+r;v[axis]=Math.abs(v[axis])*p.restGround;contacts.push('wall');}if(s.p[axis]>b[axis][1]-r){s.p[axis]=b[axis][1]-r;v[axis]=-Math.abs(v[axis])*p.restGround;contacts.push('wall');}}
  }
  const o=s.orientation||(s.orientation={x:0,y:0,z:0,w:1}),old={...o};
  o.x+=0.5*dt*(spin.x*old.w+spin.y*old.z-spin.z*old.y);o.y+=0.5*dt*(-spin.x*old.z+spin.y*old.w+spin.z*old.x);o.z+=0.5*dt*(spin.x*old.y-spin.y*old.x+spin.z*old.w);o.w+=-0.5*dt*(spin.x*old.x+spin.y*old.y+spin.z*old.z);
  const qn=Math.hypot(o.x,o.y,o.z,o.w);for(const k of ['x','y','z','w'])o[k]/=qn;
  s.lastContacts=[...new Set(contacts)];return s.lastContacts[0]||null;
}
export function crossingBetween(before,after,p) {
  const h=p.geometry.hoop;
  if(before.y<=h.center.y||after.y>h.center.y)return null;
  const f=(before.y-h.center.y)/(before.y-after.y),point=v3(before.x+(after.x-before.x)*f,h.center.y,before.z+(after.z-before.z)*f);
  const error=Math.hypot(point.x-h.center.x,point.z-h.center.z);
  return {point,error,scored:error<=h.radius-h.tubeRadius-p.geometry.ballRadius};
}
export function rollout(initial,p,{duration=4.5,dt=PHYSICS_DT,stopAtCrossing=false,stopOnForbiddenContact=false,commands=[],commandInterval=0.12,retainPath=true}={}) {
  if(!Number.isFinite(duration)||duration<0||!Number.isFinite(dt)||dt<=0||(commands.length&&(!Number.isFinite(commandInterval)||commandInterval<=0)))throw new Error('Rollout duration, step and command interval must define a finite positive clock.');
  const state=cloneBody(initial),path=retainPath?[{...state.p}]:[],contacts=[],controls=[];
  let t=0,next=0,crossing=null,cost=0,proximityCost=0;
  for(let i=0;t<duration-1e-12;i++){
    if(next<commands.length&&t+1e-8>=next*commandInterval){const u=commands[next++];add(state.v,u);controls.push({t,u:{...u}});}
    // Commands are defined in physical time, not rounded to the next 1/240s tick.
    // This is the same boundary split used by the live plant's 120ms controller.
    let step=duration-t<dt-1e-12?duration-t:dt;
    const untilCommand=next<commands.length?next*commandInterval-t:Infinity;
    if(untilCommand>1e-12&&untilCommand<step-1e-12)step=untilCommand;
    const prev={...state.p};stepPhysics(state,p,step);t+=step;
    const h=p.geometry.hoop.center;cost+=((state.p.x-h.x)**2+(state.p.y-h.y)**2+(state.p.z-h.z)**2)*step;
    for(const obstacle of p.geometry.obstacles||[]){
      const clearance=Math.hypot(...['x','y','z'].map(axis=>Math.max(0,Math.abs(state.p[axis]-obstacle.center[axis])-obstacle.size[axis]/2)))-p.geometry.ballRadius;
      proximityCost+=0.02/Math.max(0.02,clearance)**2*step;
    }
    for(const type of state.lastContacts)contacts.push({t,type});
    if(retainPath&&i%8===0)path.push({...state.p});
    crossing ||= crossingBetween(prev,state.p,p);
    // An infeasible MPC candidate cannot become feasible again later. Stop only
    // that evaluation; forces and the complete path of feasible candidates are unchanged.
    if(stopOnForbiddenContact&&state.lastContacts.some(type=>type!=='net'))break;
    if(crossing&&stopAtCrossing)break;
    if(t>0.4&&state.p.y<=p.geometry.floorY+p.geometry.ballRadius+1e-5&&norm(state.v)<0.2)break;
  }
  if(retainPath)path.push({...state.p});
  return {state,path,contacts,controls,t,crossing,scored:!!crossing?.scored,cost,proximityCost};
}
