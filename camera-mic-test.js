(()=>{
'use strict';
const $=id=>document.getElementById(id);
let camera=null,mic=null,ctx=null,analyser=null,source=null,raf=0;
let recorder=null,recordStream=null,recordTimer=null,recordingUrl=null,recordingChunks=[];
let recording=false,recordToken=0;
const status=t=>{$('status').textContent=t};
function stopTracks(stream){if(stream)stream.getTracks().forEach(t=>t.stop())}
function stopCamera(){stopTracks(camera);camera=null;$('preview').srcObject=null}
function stopMic(){cancelAnimationFrame(raf);raf=0;if(source){source.disconnect();source=null}stopTracks(mic);mic=null;if(ctx){ctx.close().catch(()=>{});ctx=null}analyser=null;$('level').style.width='0%';$('meter').setAttribute('aria-valuenow','0')}
function clearPlayback(){const audio=$('recording-playback');audio.pause();audio.removeAttribute('src');audio.load();if(recordingUrl){URL.revokeObjectURL(recordingUrl);recordingUrl=null}audio.hidden=true;$('delete-recording').disabled=true}
function updateRecordingButtons(){ $('record-five').disabled=recording;$('delete-recording').disabled=recording||!recordingUrl; }
function stopRecording(discard=false){
 clearTimeout(recordTimer);recordTimer=null;
 if(discard)recordToken++;
 if(recorder&&recorder.state!=='inactive'){
   try{recorder.stop()}catch(e){}
 }
 if(discard){stopTracks(recordStream);recordStream=null;recordingChunks=[];recorder=null;recording=false;clearPlayback();updateRecordingButtons()}
}
async function recordFiveSeconds(){
 if(recording)return;
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){status('Recording requires HTTPS and a browser with MediaRecorder support.');return}
 clearPlayback();recording=true;updateRecordingButtons();const token=++recordToken;
 try{
  const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
  if(token!==recordToken){stopTracks(stream);return}
  recordStream=stream;recordingChunks=[];
  const options={};
  for(const type of ['audio/webm;codecs=opus','audio/mp4','audio/webm']){
   if(MediaRecorder.isTypeSupported(type)){options.mimeType=type;break}
  }
  recorder=new MediaRecorder(stream,options);
  const currentRecorder=recorder;
  currentRecorder.ondataavailable=e=>{if(token===recordToken&&e.data.size)recordingChunks.push(e.data)};
  currentRecorder.onerror=()=>{if(token===recordToken){stopRecording(true);status('Recording failed. Please try again.')}};
  currentRecorder.onstop=()=>{
   stopTracks(stream);if(recordStream===stream)recordStream=null;
   if(token!==recordToken)return;
   recording=false;recorder=null;
   if(recordingChunks.length){const blob=new Blob(recordingChunks,{type:currentRecorder.mimeType||recordingChunks[0].type||'audio/webm'});recordingUrl=URL.createObjectURL(blob);const audio=$('recording-playback');audio.src=recordingUrl;audio.hidden=false;status('Five-second recording ready. Press Play to listen.')}else status('No audio was captured. Please try again.');
   recordingChunks=[];updateRecordingButtons();
  };
  currentRecorder.start();
  status('Recording microphone for 5 seconds…');
  recordTimer=setTimeout(()=>{if(token===recordToken)stopRecording(false)},5000);
 }catch(e){if(token===recordToken){stopRecording(true);status('Microphone recording: '+e.message)}}
}
async function startCamera(){stopCamera();try{if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser requires HTTPS and camera support');camera=await navigator.mediaDevices.getUserMedia({video:true,audio:false});$('preview').srcObject=camera;status('Camera preview active (local only).')}catch(e){status('Camera: '+e.message)}}
async function startMic(){stopMic();try{if(!navigator.mediaDevices?.getUserMedia)throw Error('This browser requires HTTPS and microphone support');mic=await navigator.mediaDevices.getUserMedia({audio:true,video:false});ctx=new (window.AudioContext||window.webkitAudioContext)();analyser=ctx.createAnalyser();analyser.fftSize=2048;source=ctx.createMediaStreamSource(mic);source.connect(analyser);const data=new Uint8Array(analyser.fftSize);function update(){if(!analyser)return;analyser.getByteTimeDomainData(data);let sum=0;for(const n of data){const v=(n-128)/128;sum+=v*v}const rms=Math.sqrt(sum/data.length);const pct=Math.min(100,Math.round(rms*300));$('level').style.width=pct+'%';$('meter').setAttribute('aria-valuenow',String(pct));raf=requestAnimationFrame(update)}update();status('Microphone level test active (local only).')}catch(e){status('Microphone: '+e.message)}}
$('start-camera').onclick=startCamera;
$('stop-camera').onclick=()=>{stopCamera();status('Camera stopped.')};
$('start-mic').onclick=startMic;
$('stop-mic').onclick=()=>{stopMic();status('Microphone level test stopped.')};
$('record-five').onclick=recordFiveSeconds;
$('delete-recording').onclick=()=>{stopRecording(true);status('Recording deleted from this page.')};
window.addEventListener('pagehide',()=>{stopCamera();stopMic();stopRecording(true)});
})();
