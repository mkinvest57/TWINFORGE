/** Known families for the exploratory scenes. Parameters must be supplied. */
export function pendulumAcceleration(th1,th2,w1,w2,L1,L2,{g,m1=1,m2=1}){
  const d=th1-th2,den=2*m1+m2-m2*Math.cos(2*d);
  return [(-g*(2*m1+m2)*Math.sin(th1)-m2*g*Math.sin(th1-2*th2)-2*Math.sin(d)*m2*(w2*w2*L2+w1*w1*L1*Math.cos(d)))/(L1*den),(2*Math.sin(d)*(w1*w1*L1*(m1+m2)+g*(m1+m2)*Math.cos(th1)+w2*w2*L2*m2*Math.cos(d)))/(L2*den)];
}
export function stepPendulumState(state,params,dt){
  const [a1,a2]=pendulumAcceleration(state.th1,state.th2,state.w1,state.w2,params.L1,params.L2,params);
  state.w1+=a1*dt;state.w2+=a2*dt;state.th1+=state.w1*dt;state.th2+=state.w2*dt;
  return state;
}
/** Fourth-order Runge–Kutta for the interactive pendulum, with supplied coefficients. */
export function stepPendulumRK4(state,params,dt){
  if(![state.th1,state.th2,state.w1,state.w2,params.L1,params.L2,params.g,dt].every(Number.isFinite)||params.L1<=0||params.L2<=0||dt<0)throw new Error('Invalid pendulum state, geometry or step.');
  const y=[state.th1,state.th2,state.w1,state.w2];
  const derivative=v=>{const a=pendulumAcceleration(...v,params.L1,params.L2,params);return [v[2],v[3],...a];};
  const add=(a,b,h)=>a.map((x,i)=>x+b[i]*h);
  const k1=derivative(y),k2=derivative(add(y,k1,dt/2)),k3=derivative(add(y,k2,dt/2)),k4=derivative(add(y,k3,dt));
  const next=y.map((x,i)=>x+dt*(k1[i]+2*k2[i]+2*k3[i]+k4[i])/6);
  [state.th1,state.th2,state.w1,state.w2]=next;
  return state;
}
/** Immutable future from the CURRENT observed state; path[0] is its exact source. */
export function forecastPendulum(state,params,{horizon=.5,dt=1/240}={}){
  if(!Number.isFinite(horizon)||horizon<0||horizon>10||!Number.isFinite(dt)||dt<=0)throw new Error('Invalid pendulum forecast horizon.');
  const current={th1:state.th1,th2:state.th2,w1:state.w1,w2:state.w2},model={...params};
  const path=[{t:0,...current}];
  let t=0;
  while(t<horizon-1e-12){const h=Math.min(dt,horizon-t);stepPendulumRK4(current,model,h);t+=h;path.push({t,...current});}
  return {state:{...current},path,model,horizon};
}
/** Mechanical energy is useful for checking numerical stability, not a fitted parameter. */
export function pendulumEnergy(state,{g,L1,L2,m1=1,m2=1}){
  const {th1,th2,w1,w2}=state;
  return .5*(m1+m2)*L1*L1*w1*w1+.5*m2*L2*L2*w2*w2+m2*L1*L2*w1*w2*Math.cos(th1-th2)-(m1+m2)*g*L1*Math.cos(th1)-m2*g*L2*Math.cos(th2);
}
/** Uniform tank balance; no wave or general fluid-dynamics claim. Rate is m/s. */
export function stepLiquidState(state,{rate,brim,bottom=0,area=1},dt){
  if(![state.level,rate,brim,bottom,area,dt].every(Number.isFinite)||area<=0||brim<bottom||dt<0)throw new Error('Invalid tank geometry/rate/time.');
  const requested=state.level+rate*dt;
  state.level=Math.max(bottom,Math.min(brim,requested));state.volume=(state.level-bottom)*area;
  state.spilled=(state.spilled||0)+Math.max(0,requested-brim)*area;
  return state;
}
export function stepOrbitState(st,center,mu,dt){const x=st.p.x-center.x,y=st.p.y-center.y,z=st.p.z-center.z,d=Math.max(Math.hypot(x,y,z),0.95),k=-mu/(d*d*d);st.v.x+=x*k*dt;st.v.y+=y*k*dt;st.v.z+=z*k*dt;st.p.x+=st.v.x*dt;st.p.y+=st.v.y*dt;st.p.z+=st.v.z*dt;}
export function stepSpheres(bodies,{g,restitution,friction=0.1},dt){
  const contacts=[];
  for(let i=0;i<bodies.length;i++){
    const b=bodies[i];b.v.y-=g*dt;for(const a of ['x','y','z'])b.p[a]+=b.v[a]*dt;
    if(b.p.y<b.r){b.p.y=b.r;const vy=b.v.y;b.v.y=Math.abs(vy)>0.25?-vy*restitution:0;const tangent=Math.hypot(b.v.x,b.v.z),drop=Math.min(tangent,friction*(1+restitution)*Math.abs(vy)),f=tangent?1-drop/tangent:1;b.v.x*=f;b.v.z*=f;contacts.push({type:'ground',body:i});}
  }
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
    const a=bodies[i],b=bodies[j],dx=b.p.x-a.p.x,dy=b.p.y-a.p.y,dz=b.p.z-a.p.z,d=Math.hypot(dx,dy,dz),r=a.r+b.r;
    if(d>=r||d<1e-8)continue;const n={x:dx/d,y:dy/d,z:dz/d};for(const k of ['x','y','z']){a.p[k]-=n[k]*(r-d)/2;b.p[k]+=n[k]*(r-d)/2;}
    const rel=(b.v.x-a.v.x)*n.x+(b.v.y-a.v.y)*n.y+(b.v.z-a.v.z)*n.z;if(rel<0)for(const k of ['x','y','z']){const impulse=-(1+restitution)*rel/2*n[k];b.v[k]+=impulse;a.v[k]-=impulse;}
    contacts.push({type:'sphere',bodies:[i,j]});
  }
  return contacts;
}
export function accelerationFromPositions(a,b,c){const h1=b.t-a.t,h2=c.t-b.t;if(!(h1>0&&h2>0))return null;return a.p.map((_,i)=>2*((c.p[i]-b.p[i])/h2-(b.p[i]-a.p[i])/h1)/(h1+h2));}
export function estimateOrbitMu(a,b,c,center){const accel=accelerationFromPositions(a,b,c);if(!accel)return null;const r=b.p.map((x,i)=>x-center[i]),d=Math.hypot(...r),mu=-r.reduce((sum,x,i)=>sum+x*accel[i],0)*d;return Number.isFinite(mu)&&mu>0?mu:null;}
export function median(values){if(!values.length)return null;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}

/** Declared seven-sphere drop: vertical spacing creates actual sphere contacts after impact. */
export function multiBodyFixture(){
  return Array.from({length:7},(_,i)=>({p:{x:i%2?.02:-.02,y:.7+i*.32,z:1.6},v:{x:0,y:0,z:0},r:.14}));
}

/** Estimate gravity from three collision-free position samples; body geometry is observed. */
export function estimateMultiGravity(samples,bodies){
  if(samples.length!==3)return null;
  const [a,b,c]=samples,values=[];
  for(let i=0;i<bodies.length;i++){
    if(samples.some(o=>o.positions[i][1]<bodies[i].r+.12))continue;
    if(samples.some(o=>o.positions.some((p,j)=>j!==i&&Math.hypot(...p.map((v,k)=>v-o.positions[i][k]))<bodies[i].r+bodies[j].r+.02)))continue;
    const acc=accelerationFromPositions({t:a.t,p:a.positions[i]},{t:b.t,p:b.positions[i]},{t:c.t,p:c.positions[i]});
    if(acc&&acc[1]<0)values.push(-acc[1]);
  }
  return median(values);
}
