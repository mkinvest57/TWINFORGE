import {cloneModel} from './model.mjs';
const NUMBER='[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const finiteVector=a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite);
const normalize=text=>String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/(\d),(\d)/g,'$1.$2').replace(/²/g,'2').replace(/−/g,'-');
function factorOf(clause){
  const percent=clause.match(new RegExp(`(${NUMBER})\\s*%`)),multiple=clause.match(new RegExp(`(?:\\bfois\\b|\\btimes\\b|\\bx|\\*)\\s*(${NUMBER})\\b`));
  const double=/\b(?:double\w*|doubl\w*)\b/.test(clause),half=/\b(?:half|halve\w*|moitie)\b/.test(clause);
  if([Boolean(percent),Boolean(multiple),double,half].filter(Boolean).length>1)throw new Error('Ambiguous multiplier: use one change per entity and clause.');
  if(double)return 2;if(half)return .5;if(multiple)return Number(multiple[1]);
  if(percent){
    const raw=percent[1],amount=Number(raw)/100;
    const down=/\b(?:decrease\w*|reduce\w*|lower|less|slower|weaker|diminue\w*|redui\w*|baisse\w*|moins|faible\w*)\b/.test(clause),up=/\b(?:increase\w*|raise\w*|higher|more|harder|stronger|faster|augmente\w*|plus|fort\w*|vite)\b/.test(clause)&&!/plus\s+faible/.test(clause);
    if(raw.startsWith('+')||raw.startsWith('-')){if((amount<0&&up&&!down)||(amount>0&&down))throw new Error('Conflicting percentage sign and direction.');return 1+amount;}
    if(down&&up&&!/moins\s+(?:fort|vite)/.test(clause))throw new Error('Conflicting percentage directions.');
    if(!down&&!up)throw new Error('Specify whether the percentage increases or decreases the named quantity.');
    return 1+(down?-amount:amount);
  }
  return null;
}
function absoluteOf(clause){const match=clause.match(new RegExp(`(${NUMBER})(?![\\d.])`));return match?Number(match[1]):null;}
function inRange(value,min,max,label){if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${label} must be between ${min} and ${max}.`);return value;}
/** Explicit entity-scoped clauses. Nothing is inferred from a celestial body's name. */
export function parseCounterfactual(text,model,velocity){
  const t=normalize(text).trim(),after=cloneModel(model),v={...velocity},diff=[];
  const clauses=t.split(/\s*(?:;|,|\band\b|\bet\b|\bthen\b|\bpuis\b|\bwith\b|\bavec\b)\s*/).filter(Boolean);
  if(!clauses.length)return {recognized:false,model:after,velocity:v,diff};
  const parsed=clauses.map(clause=>{
    const wind=/\b(?:wind|vent)\b/.test(clause),gravity=/\b(?:gravit\w*|g)\b/.test(clause),hoop=/\b(?:hoop|cerceau|panier)\b/.test(clause),launch=/\b(?:shoot\w*|launch\w*|throw\w*|tir\w*|lanc\w*|puissance|power|ball)\b/.test(clause)||(!wind&&!gravity&&!hoop&&/\b(?:speed|vitesse)\b/.test(clause));
    const entities=[wind&&'wind',gravity&&'gravity',hoop&&'hoop',launch&&'launch'].filter(Boolean);
    if(/\b(?:moon|lune|lunar|lunaire)\b/.test(clause)&&(!gravity||absoluteOf(clause)===null))throw new Error('Lunar gravity is not inferred. Specify a numerical value, for example “gravity 1.62 m/s2”.');
    if(entities.length>1)throw new Error('Ambiguous clause: separate launch, wind, gravity and hoop changes with “and” / “et”.');
    return {clause,entity:entities[0]};
  });
  if(parsed.every(p=>!p.entity))return {recognized:false,model:after,velocity:v,diff};
  if(parsed.some(p=>!p.entity))throw new Error('Unsupported clause: specify launch, wind, gravity or hoop; no partial counterfactual was applied.');
  const seen=new Set();
  for(const {clause,entity} of parsed){
    if(seen.has(entity))throw new Error(`Repeated ${entity} change: combine it into one explicit clause.`);seen.add(entity);
    if(entity==='hoop'){
      const negative=/\b(?:left|gauche|down|bas|back|backward|arriere)\b/.test(clause),positive=/\b(?:right|droite|up|haut|forward|avant)\b/.test(clause);
      const axis=/\b(?:left|gauche|right|droite)\b/.test(clause)?'x':/\b(?:up|haut|down|bas)\b/.test(clause)?'y':/\b(?:forward|avant|back|backward|arriere)\b/.test(clause)?'z':null;
      if(!axis||negative===positive)throw new Error('Hoop displacement needs one direction: left/right, up/down or forward/back.');
      const raw=clause.match(new RegExp(`(${NUMBER})\\s*(cm|metres?|meters?|m)\\b`));
      if(!raw&&/\d/.test(clause))throw new Error('Hoop displacement needs an explicit cm or m unit.');
      const distance=raw?Number(raw[1])*(raw[2]==='cm'?.01:1):.3;inRange(distance,0,5,'Hoop displacement (m)');
      const shift=(negative?-1:1)*distance,before=after.geometry?.hoop?.center?.[axis];if(!Number.isFinite(before))throw new Error('The model has no measured hoop geometry.');
      after.geometry.hoop.center[axis]+=shift;
      diff.push({path:`geometry.hoop.center.${axis}`,before,after:after.geometry.hoop.center[axis],operation:'add',value:shift,...(!raw?{assumption:'declared default UI displacement: 0.30 m'}:{})});
      if(after.geometry.board){const boardBefore=after.geometry.board.center[axis];after.geometry.board.center[axis]+=shift;diff.push({path:`geometry.board.center.${axis}`,before:boardBefore,after:after.geometry.board.center[axis],operation:'add',value:shift});}
      continue;
    }
    const factor=factorOf(clause),absolute=factor===null?absoluteOf(clause):null;
    if(entity==='gravity'&&/\b(?:moon|lune|lunar|lunaire)\b/.test(clause)&&factor!==null)throw new Error('Lunar gravity needs an absolute numerical value in m/s2; a planet name does not define a multiplier.');
    if(factor===null&&absolute===null)throw new Error(`Specify a numerical ${entity} value or a percentage/multiplier.`);
    if(entity==='launch'){
      const oldSpeed=Math.hypot(v.x,v.y,v.z);if(!Number.isFinite(oldSpeed)||oldSpeed<=0)throw new Error('Launch direction requires a non-zero finite velocity.');
      let multiplier=factor;
      if(multiplier===null){if(!/m\s*\/\s*s(?!\s*\^?2)/.test(clause))throw new Error('An absolute launch speed needs m/s units.');inRange(absolute,.001,50,'Launch speed (m/s)');multiplier=absolute/oldSpeed;}
      inRange(multiplier,Number.EPSILON,5,'Launch multiplier');for(const axis of ['x','y','z'])v[axis]*=multiplier;
      diff.push({path:'initial.velocity',before:{...velocity},after:{...v},operation:'multiply',value:multiplier});
    }else if(entity==='gravity'){
      if(factor!==null)inRange(factor,0,5,'Gravity multiplier');const before=after.g,value=inRange(factor===null?absolute:before*factor,0,100,'Gravity (m/s2)');if(!Number.isFinite(before))throw new Error('The model has no finite gravity.');after.g=value;
      diff.push({path:'parameters.g',before,after:value,operation:factor===null?'set':'multiply',value:factor===null?value:factor});
    }else{
      const vector=finiteVector(after.windAcceleration),scalar=Number.isFinite(after.windX);if(!vector&&!scalar)throw new Error('The model has no explicit wind parameter.');
      if(factor!==null){
        inRange(factor,0,5,'Wind multiplier');
        if(vector){const before=[...after.windAcceleration];after.windAcceleration=before.map(x=>x*factor);diff.push({path:'parameters.windAcceleration',before,after:[...after.windAcceleration],operation:'multiply',value:factor});}
        if(scalar){const before=after.windX;after.windX*=factor;diff.push({path:'parameters.windX',before,after:after.windX,operation:'multiply',value:factor});}
      }else{
        inRange(absolute,-100,100,vector?'Wind acceleration x (m/s2)':'Wind speed x (m/s)');
        if(vector){if(!/m\s*\/\s*s\s*(?:\^?2)/.test(clause))throw new Error('This model uses wind acceleration; specify m/s2.');const before=[...after.windAcceleration];after.windAcceleration[0]=absolute;diff.push({path:'parameters.windAcceleration',before,after:[...after.windAcceleration],operation:'set x',value:absolute});}
        else{if(!/m\s*\/\s*s(?!\s*\^?2)/.test(clause))throw new Error('An absolute wind speed needs m/s units.');const before=after.windX;after.windX=absolute;diff.push({path:'parameters.windX',before,after:absolute,operation:'set',value:absolute});}
      }
    }
  }
  return {recognized:diff.length>0,model:after,velocity:v,diff};
}
