const assert=require('node:assert/strict'), preview=require('../preview.js');
assert.equal(preview.fileURL('C:\\SFX\\bell #1%.mp3'),'file:///C:/SFX/bell%20%231%25.mp3');
assert.equal(preview.fileURL('\\\\server\\share\\sound.wav'),'file://server/share/sound.wav');
assert.throws(()=>preview.fileURL('https://example.com/sound.mp3'));
function fixture(){
 const pending=[],players=[],states=[],errors=[];
 const controller=preview.create((method,args,cb)=>pending.push(cb),(id,state)=>states.push({id,state}),msg=>errors.push(msg),()=>{
  const a={paused:true,src:'',play(){this.paused=false;this.onplaying();return {catch:fn=>{this.reject=fn;}};},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){this.released=true;}};
  players.push(a);return a;
 });return {controller,pending,players,states,errors};
}
const item={id:'1'};
let f=fixture();f.controller.toggle('p',item);f.pending.shift()(null,{path:'C:/sound.mp3'});
assert.equal(f.states.at(-1).state,'playing');f.controller.toggle('p',item);assert.equal(f.players[0].paused,true);
f.controller.toggle('p',item);assert.equal(f.players.length,1);assert.equal(f.players[0].paused,false);
f.controller.stop();assert.equal(f.players[0].released,true);assert.equal(f.players[0].src,'');
f=fixture();f.controller.toggle('p',item);f.controller.stop();f.pending.shift()(null,{path:'C:/sound.mp3'});assert.equal(f.players.length,0);
f=fixture();f.controller.toggle('p',item);f.controller.toggle('p',{id:'2'});f.pending.shift()(null,{path:'C:/old.mp3'});f.pending.shift()(null,{path:'C:/new.mp3'});assert.equal(f.players.length,1);assert.equal(f.players[0].src,'file:///C:/new.mp3');
f.players[0].onerror();assert.equal(f.errors.length,1);assert.equal(f.players[0].released,true);
f=fixture();f.controller.toggle('p',item);f.pending.shift()(null,{path:'C:/sound.mp3'});f.players[0].onended();assert.equal(f.players[0].released,true);
f=fixture();f.controller.toggle('p',item);f.pending.shift()(null,{path:'C:/sound.mp3'});f.players[0].reject();assert.equal(f.errors.length,1);
console.log('PASS preview URLs, pause/resume, stop/release, cancelled lookup, rapid switching, decoder failure, end cleanup and rejected playback');
