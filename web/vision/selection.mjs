/** UI coordinates only. No simulator state or model output is fabricated. */
export function imagePoint(clientX,clientY,rect,width,height){
  if(!rect||rect.width<=0||rect.height<=0||width<1||height<1)return null;
  const scale=Math.min(rect.width/width,rect.height/height);
  const left=rect.left+(rect.width-width*scale)/2,top=rect.top+(rect.height-height*scale)/2;
  const x=(clientX-left)/scale,y=(clientY-top)/scale;
  if(x<0||y<0||x>=width||y>=height)return null;
  return {x:Math.min(width-1,Math.floor(x)),y:Math.min(height-1,Math.floor(y))};
}
export function selectionFromGesture(a,b,width,height){
  if(!a||!b)return null;
  const clamp=(v,max)=>Math.max(0,Math.min(max-1,Math.floor(v)));
  const first={x:clamp(a.x,width),y:clamp(a.y,height)},last={x:clamp(b.x,width),y:clamp(b.y,height)};
  if(Math.hypot(first.x-last.x,first.y-last.y)<9)return {type:'point',...last};
  const x=Math.min(first.x,last.x),y=Math.min(first.y,last.y);
  return {type:'box',x,y,width:Math.max(1,Math.abs(first.x-last.x)+1),height:Math.max(1,Math.abs(first.y-last.y)+1)};
}
export function selectionLabel(selection,concept){
  return selection?.type==='box'?'Selected region':selection?.type==='point'?'Selected object':concept==='hand'?'Hands':concept;
}
