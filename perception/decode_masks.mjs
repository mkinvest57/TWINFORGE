#!/usr/bin/env node
/** Decode actual SAM rasters. stdin or filename -> deterministic JSON masks. */
import {readFileSync} from 'node:fs';
import {parseImageStream, decodeMaskToRaster, decodeMaskToSVGPath, recordsOfKind} from '@meta-sam/parser';
const text=readFileSync(process.argv[2] && process.argv[2]!=='-' ? process.argv[2] : 0,'utf8');
async function* events(){
  yield {type:'response.output_text.done',item_id:'m1',output_index:0,content_index:0,text};
  yield {type:'response.completed'};
}
const parsed=parseImageStream(events());
for await(const _snapshot of parsed){} // consume before finalResult
const result=await parsed.finalResult;
if(result.diagnostics.some(d=>d.severity==='error')) throw new Error(JSON.stringify(result.diagnostics));
const masks=recordsOfKind(result.records,'mask').map(rec=>{
  const raster=decodeMaskToRaster(rec.mask), polygons=[];
  let polygon=[];
  for(const token of decodeMaskToSVGPath(rec.mask).matchAll(/([MLZ])([^MLZ]*)/g)){
    if(token[1]==='Z'){if(polygon.length)polygons.push(polygon);polygon=[];}
    else{const n=token[2].trim().split(/[ ,]+/).map(Number);polygon.push([n[0]+rec.bounds.left,n[1]+rec.bounds.top]);}
  }
  return {object_id:String(rec.objectId),bounds:rec.bounds,width:rec.mask.width,height:rec.mask.height,
    raster_base64:Buffer.from(raster).toString('base64'),polygons};
});
process.stdout.write(JSON.stringify({masks,diagnostics:result.diagnostics,outcome:result.outcome}));
