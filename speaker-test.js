(()=>{'use strict';
let ctx=null, active=[];const status=document.getElementById('audio-status');const vol=document.getElementById('volume');
function stop(){for(const osc of active){try{osc.stop()}catch{}try{osc.disconnect()}catch{}}active=[];status.textContent='Ready — select a channel to play the chime.';}
async function play(channel){try{stop();ctx??=new (window.AudioContext||window.webkitAudioContext)();await ctx.resume();const start=ctx.currentTime+0.02;const volume=Number(vol.value)/100;
const pan=ctx.createStereoPanner();pan.pan.value=channel==='left'?-1:channel==='right'?1:0;pan.connect(ctx.destination);
const notes=[{f:523.25,t:0},{f:659.25,t:0.16},{f:783.99,t:0.32}];
for(const note of notes){const osc=ctx.createOscillator(),env=ctx.createGain();osc.type='sine';osc.frequency.value=note.f;const at=start+note.t;env.gain.setValueAtTime(0,at);env.gain.linearRampToValueAtTime(volume*.45,at+.012);env.gain.exponentialRampToValueAtTime(.0001,at+.28);osc.connect(env).connect(pan);osc.start(at);osc.stop(at+.3);active.push(osc);osc.onended=()=>{active=active.filter(o=>o!==osc);if(!active.length)status.textContent='Chime finished — ready to test again.';};}
status.textContent='Playing short chime: '+(channel==='both'?'both speakers':channel+' speaker');
}catch(err){status.textContent='Audio unavailable: '+err.message;}}
document.querySelectorAll('[data-channel]').forEach(b=>b.addEventListener('click',()=>play(b.dataset.channel)));
document.getElementById('stop').addEventListener('click',stop);
vol.addEventListener('input',()=>{document.getElementById('vol-label').textContent=vol.value+'%';});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});window.addEventListener('pagehide',stop);
})();