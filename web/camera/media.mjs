/** Browser capture primitives: no microphone, upload, or credential access. */
export function cameraErrorMessage(error){
  const messages={
    NotAllowedError:'Accès caméra refusé. Autorisez la caméra dans les réglages du site, puis réessayez.',
    NotFoundError:'Aucune caméra disponible. Vous pouvez importer une vidéo.',
    NotReadableError:'La caméra est déjà utilisée ou indisponible. Fermez les autres applications caméra.',
    OverconstrainedError:'Cette caméra ne prend pas en charge les réglages demandés.',
    SecurityError:'Le navigateur bloque la caméra. Ouvrez cette page en HTTPS.',
  };
  return messages[error?.name] || 'Impossible de lire la caméra. Réessayez ou importez une vidéo.';
}
export function recordingMime(Recorder){
  if(!Recorder)return null;
  return ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp8','video/webm'].find(type=>Recorder.isTypeSupported?.(type)) || '';
}
export function imageRect(containerWidth,containerHeight,width,height){
  const scale=Math.min(containerWidth/width,containerHeight/height);
  return {x:(containerWidth-width*scale)/2,y:(containerHeight-height*scale)/2,width:width*scale,height:height*scale,scale};
}
export function pointInImage(clientX,clientY,bounds,width,height){
  const r=imageRect(bounds.width,bounds.height,width,height);
  const x=(clientX-bounds.left-r.x)/r.scale,y=(clientY-bounds.top-r.y)/r.scale;
  return x<0||y<0||x>width||y>height?null:{x,y};
}
export class CameraSession{
  constructor(mediaDevices){this.mediaDevices=mediaDevices;this.stream=null;this.generation=0;}
  stop(){this.generation++;for(const track of this.stream?.getTracks()||[])track.stop();this.stream=null;}
  async start(facingMode='environment'){
    this.stop();const generation=this.generation;
    if(!this.mediaDevices?.getUserMedia)throw Object.assign(new Error('Camera API unavailable'),{name:'SecurityError'});
    const constraints={audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:24,max:30}}};
    let stream;
    try{stream=await this.mediaDevices.getUserMedia(constraints);}
    catch(error){
      if(generation!==this.generation)return null;
      if(error.name!=='OverconstrainedError')throw error;
      stream=await this.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode}}});
    }
    if(generation!==this.generation){for(const track of stream.getTracks())track.stop();return null;}
    this.stream=stream;return stream;
  }
}

