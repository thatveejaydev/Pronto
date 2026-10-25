const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const search = require('../search.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
const item = (id, name, folder = '') => ({ id, name, path: folder + '/' + name });
const items = [item('1', 'Beach Sunrise.mov', 'B-roll/Travel'), item('2', 'Interview.wav', 'Audio'), item('3', 'Beach Sunrise.mov', 'Archive')];
test('Fuzzy subsequence and case-insensitive search', () => assert.equal(search.filter(items, 'bchs')[0].id, '1'));
test('Nested path plus filename tokens', () => assert.deepEqual(search.filter(items, 'travel sunrise').map(x => x.id), ['1']));
test('Duplicate names retain identity', () => assert.equal(search.filter(items, 'beach').length, 2));
test('Empty and unmatched queries', () => { assert.equal(search.filter(items, '').length, 3); assert.equal(search.filter(items, 'xyz').length, 0); });
test('Unicode literal search', () => assert.equal(search.filter([item('4', '台北夜景.mov')], '台北').length, 1));
test('Exact name ranks above fuzzy name', () => assert.equal(search.filter([item('1', 'abc more'), item('2', 'abc')], 'abc')[0].id, '2'));
function fixture() {
  const children = values => Object.assign(values, { numItems: values.length });
  const media = { nodeId: 'clip-1', name: 'Quote " \\ newline\n台北', type: 1, isSequence: () => false, isOffline: () => false, getInPoint: () => ({ seconds: 0 }), getOutPoint: () => ({ seconds: 5 }), getAudioChannelMapping: () => ({ audioClipsNumber: 1 }) };
  const nested = { nodeId: 'nested', name: 'Deep', type: 2, children: children([media]) };
  const bin = { nodeId: 'bin', name: 'Footage', type: 2, children: children([nested]) };
  const calls = [], time = { ticks: '2540160000000', seconds: 10 };
  const tracks = () => Object.assign([{ name: 'Track 1', clips: children([]), transitions: children([]) }], { numTracks: 1 });
  const seq = { sequenceID: 's1', name: 'Edit', videoTracks: tracks(), audioTracks: tracks(), timebase: '10160640000', getPlayerPosition: () => time,
    overwriteClip: (...args) => {
      calls.push(args);
      assert.equal(args[1], time, 'Sequence overwrite must receive the native Time object');
      const clips = seq.videoTracks[args[2]].clips;
      clips.push({ nodeId: 'added-' + calls.length, projectItem: media, start: {seconds:time.seconds}, end:{seconds:time.seconds+5} });
      clips.numItems=clips.length;
      return true;
    } };
  const project = { documentID: 'p1', name: 'Test', rootItem: { children: children([bin]) }, activeSequence: seq };
  const ctx = vm.createContext({ app: { project, version: '26.0' }, ProjectItemType: { BIN: 2, CLIP: 1, FILE: 4 } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../host.jsx'), 'utf8'), ctx);
  return { host: ctx.BinSearchHost, project, seq, calls, time, media, bin, ctx };
}
const insert = f => JSON.parse(f.host.insert('p1', 's1', 'clip-1', 0, 0));
test('Nested indexing and JSON round trip without native JSON use', () => {
  const f = fixture(); vm.runInContext('JSON = undefined', f.ctx);
  const index = JSON.parse(f.host.index()); assert.equal(index.items.length, 3);
  assert.equal(index.items[2].name, f.media.name); assert.ok(index.items[2].path.startsWith('Footage / Deep /'));
});
test('Renamed media retains its source type, including uppercase extensions', () => {
  const f = fixture();
  for (const [extension, kind] of [['PNG','Image'], ['MOV','Video'], ['WAV','Audio'], ['mogrt','Graphic'], ['unknown','Media']]) {
    f.media.getMediaPath = () => 'C:\\Sources\\original.' + extension;
    assert.equal(JSON.parse(f.host.index()).items[2].kind, kind);
  }
});
test('Unavailable media path falls back safely without breaking indexing', () => {
  const f = fixture();
  f.media.getMediaPath = () => { throw Error('Unavailable'); };
  f.media.name = 'sound.mp3';
  assert.equal(JSON.parse(f.host.index()).items[2].kind, 'Audio');
  f.media.name = 'Adjustment Layer';
  assert.equal(JSON.parse(f.host.index()).items[2].kind, 'Media');
});
test('Placement passes native playhead Time and automatically chosen tracks', () => {
  const f = fixture(); assert.equal(insert(f).ok, true); assert.equal(f.calls[0][0], f.media); assert.equal(f.calls[0][1], f.time); assert.deepEqual(f.calls[0].slice(2), [0, 0]);
});
test('Project switch blocks stale results', () => { const f = fixture(); f.project.documentID = 'p2'; assert.equal(insert(f).ok, false); assert.equal(f.calls.length, 0); });
test('Timeline switch blocks stale track choices', () => { const f = fixture(); f.seq.sequenceID = 's2'; assert.equal(insert(f).ok, false); assert.equal(f.calls.length, 0); });
test('No active timeline handled', () => { const f = fixture(); f.project.activeSequence = null; assert.equal(insert(f).ok, false); });
test('Removed item handled', () => { const f = fixture(); f.media.nodeId = 'gone'; assert.equal(insert(f).ok, false); });
test('Offline media blocked', () => { const f = fixture(); f.media.isOffline = () => true; assert.equal(insert(f).ok, false); assert.equal(f.calls.length, 0); });
test('Bins and sequences rejected', () => { const f = fixture(); assert.equal(JSON.parse(f.host.insert('p1', 's1', 'bin', 0, 0)).ok, false); f.media.isSequence = () => true; assert.equal(insert(f).ok, false); });
test('Host insertion failure and exception are reported', () => { const f = fixture(); f.seq.overwriteClip = () => false; assert.equal(insert(f).ok, false); f.seq.overwriteClip = () => { throw Error('Locked'); }; assert.equal(insert(f).error, 'Locked'); });
function panelFixture(initialQuery = 'Footage', failResize = false, audioMedia = false) {
  const f = fixture(), elements = {}, pending = [], events = {}, players = [], registeredKeys = [];
  if(audioMedia) f.media.getMediaPath=()=> 'C:/audio.mp3';
  function FakeAudio(){this.paused=true;players.push(this);}
  FakeAudio.prototype.play=function(){this.paused=false;this.onplaying();};
  FakeAudio.prototype.pause=function(){this.paused=true;};
  FakeAudio.prototype.removeAttribute=function(){this.src='';};
  FakeAudio.prototype.load=function(){};
  function element(tag, id) {
    return {
      tag, id, value: '', children: [], attrs: {}, listeners: {}, disabled: false,
      set textContent(v) { this.text = v; this.children = []; if (this.tag === 'select') this.value = ''; },
      get textContent() { return this.text; },
      get options() { return this.children; },
      appendChild(child) { this.children.push(child); if (child.id) elements[child.id] = child; if (this.tag === 'select' && !this.value) this.value = child.value; },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(k, fn) { this.listeners[k] = fn; }, focus() {}, select() {}, scrollIntoView() {}
    };
  }
  for (const id of ['status', 'refresh', 'close', 'insert', 'results', 'query', 'count', 'context']) elements[id] = element(['video','audio'].includes(id) ? 'select' : 'div', id);
  const document = { getElementById: id => elements[id], createElement: tag => element(tag), addEventListener() {} };
  const ctx = vm.createContext({ document, BinSearchShortcut: require('../shortcut.js'), Audio: FakeAudio, ProntoPreview: require('../preview.js'), BinSearch: search, setTimeout: fn => fn(), window: { requestAnimationFrame: () => { throw Error('Rendering callbacks unavailable'); }, __adobe_cep__: { registerKeyEventsInterest: value => registeredKeys.push(JSON.parse(value)), dispatchEvent: event => { assert.equal(typeof event,'object'); assert.equal(event.extensionId,'local.binsearch.popup'); }, addEventListener: (name, fn) => { events[name] = fn; }, resizeContent: () => { if (failResize) throw Error('Native resize failed'); }, closeExtension: () => { f.closed = true; }, evalScript: (script, cb) => pending.push(() => cb(vm.runInContext(script, f.ctx))) } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../panel.js'), 'utf8'), ctx);
  if (initialQuery) { elements.query.value = initialQuery; elements.query.listeners.input(); pending.shift()(); }
  const key = (value, extra = {}) => elements.query.listeners.keydown({ key: value, preventDefault() {}, ...extra });
  return Object.assign(f, { elements, pending, key, events, players, registeredKeys });
}
test('Keyboard navigation, Enter and in-flight duplicate protection', () => {
  const f = panelFixture(); f.key('ArrowDown'); f.key('ArrowDown');
  assert.equal(f.elements.query.attrs['aria-activedescendant'], 'result-2');
  f.key('Enter'); f.key('Enter'); assert.equal(f.pending.length, 1);
  f.pending.shift()(); assert.equal(f.calls.length, 1); assert.equal(f.closed, true);
  f.key('Enter', { repeat: true }); assert.equal(f.pending.length, 0);
});
test('Shift+Enter opens source without an active timeline and suppresses duplicates', () => {
  const f = panelFixture('台北'); let opened = null;
  f.project.activeSequence = null;
  f.ctx.app.sourceMonitor = { openProjectItem: item => { opened = item; return 0; } };
  f.key('Enter', {shiftKey:true}); f.key('Enter', {shiftKey:true});
  assert.equal(f.pending.length, 1); f.pending.shift()();
  assert.equal(opened, f.media); assert.equal(f.calls.length, 0); assert.equal(f.closed, true);
});
test('Shift+click opens the clicked item in Source Monitor', () => {
  const f = panelFixture('台北'); let opened = null;
  f.ctx.app.sourceMonitor = { openProjectItem: item => { opened = item; return 0; } };
  f.elements.results.children[0].listeners.click({shiftKey:true, detail:1}); f.pending.shift()();
  assert.equal(opened, f.media); assert.equal(f.calls.length, 0); assert.equal(f.closed, true);
});
test('Source open failure stays visible and never inserts', () => {
  const f = panelFixture('台北'); f.ctx.app.sourceMonitor = {openProjectItem: () => 1};
  f.key('Enter', {shiftKey:true}); f.pending.shift()();
  assert.match(f.elements.status.textContent, /could not open/); assert.ok(!f.closed); assert.equal(f.calls.length, 0);
});
test('Successful Source Monitor readback overrides inconsistent native return values', () => {
  for (const result of [undefined, true, false, 1, '0', 0]) {
    const f = panelFixture('台北');
    f.ctx.app.sourceMonitor = {openProjectItem: () => result, getProjectItem: () => f.media};
    f.key('Enter', {shiftKey:true}); f.pending.shift()();
    assert.equal(f.closed, true); assert.equal(f.elements.status.hidden, true); assert.equal(f.calls.length, 0);
  }
});
test('A success return cannot hide a different or missing Source Monitor item', () => {
  for (const current of [null, {nodeId:'other'}]) {
    const f = fixture();
    f.ctx.app.sourceMonitor = {openProjectItem: () => 0, getProjectItem: () => current};
    assert.equal(JSON.parse(f.host.openSource('p1','clip-1')).ok, false);
  }
});
test('Source open supports boolean success when readback is unavailable', () => {
  const f = fixture();
  f.ctx.app.sourceMonitor = {openProjectItem: () => true, getProjectItem: () => { throw Error('Unavailable'); }};
  assert.equal(JSON.parse(f.host.openSource('p1','clip-1')).ok, true);
});
test('Source open guards against stale, removed, bin and offline items', () => {
  const f = fixture(); let opens = 0;
  f.ctx.app.sourceMonitor = {openProjectItem: () => { opens++; return 0; }};
  const open = (project, id) => JSON.parse(f.host.openSource(project, id));
  assert.equal(open('other','clip-1').ok, false);
  assert.equal(open('p1','missing').ok, false);
  assert.equal(open('p1','bin').ok, false);
  f.media.isOffline = () => true;
  assert.equal(open('p1','clip-1').ok, false); assert.equal(opens, 0);
});
test('Source Monitor supports sequences without timeline insertion', () => {
  const f = fixture(); f.media.isSequence = () => true;
  f.ctx.app.sourceMonitor = {openProjectItem: item => { assert.equal(item, f.media); return 0; }};
  assert.equal(JSON.parse(f.host.openSource('p1','clip-1')).ok, true); assert.equal(f.calls.length, 0);
});
test('IME Enter is ignored and Escape closes popup', () => {
  const f = panelFixture(); f.elements.query.value = '台北'; f.elements.query.listeners.input();
  assert.equal(f.elements.results.children.length, 1);
  f.key('Enter', { isComposing: true }); assert.equal(f.pending.length, 0);
  f.key('Escape'); assert.equal(f.closed, true);
});
test('Panel reports stale timeline error through actual bridge serialization', () => {
  const f = panelFixture(); f.key('ArrowDown'); f.key('ArrowDown'); f.seq.sequenceID = 'other';
  f.key('Enter'); f.pending.shift()(); assert.match(f.elements.status.textContent, /timeline changed/); assert.equal(f.calls.length, 0);
});
const collection = arr => Object.assign(arr, { numItems: arr.length });
let existingId=0;
const track = (ranges = [], transitions = []) => ({ clips: collection(ranges.map(([a,b]) => ({nodeId:'existing-'+(++existingId),start:{seconds:a},end:{seconds:b}}))), transitions: collection(transitions.map(([a,b]) => ({start:{seconds:a},end:{seconds:b}}))) });
const tracks = arr => Object.assign(arr, {numTracks: arr.length});
test('Chooses first video gap with enough room for entire source', () => { const f=fixture(); f.seq.videoTracks=tracks([track([[12,20]]),track([[0,10],[15,20]])]); assert.equal(insert(f).video,1); });
test('Touching boundaries are allowed', () => { const f=fixture(); f.seq.videoTracks=tracks([track([[0,10],[15,20]])]); assert.equal(insert(f).video,0); });
test('Audio and video gaps selected independently', () => { const f=fixture(); f.seq.audioTracks=tracks([track([[9,16]]),track()]); assert.equal(insert(f).audio,1); assert.equal(f.calls[0][2],0); });
test('Insufficient space does not call editing API', () => { const f=fixture(); f.seq.videoTracks=tracks([track([[10,15]])]); assert.equal(insert(f).ok,false); assert.equal(f.calls.length,0); });
test('Transitions also block placement', () => { const f=fixture(); f.seq.videoTracks=tracks([track([],[[9,11]]),track()]); assert.equal(insert(f).video,1); });
test('Multichannel audio requires contiguous free tracks', () => { const f=fixture(); f.media.getAudioChannelMapping=()=>({audioClipsNumber:2}); f.seq.audioTracks=tracks([track(),track([[10,15]]),track(),track()]); assert.equal(insert(f).audio,2); });
test('Unknown audio mapping protects all tracks above destination', () => { const f=fixture(); f.media.getAudioChannelMapping=()=>({}); f.seq.audioTracks=tracks([track(),track([[10,15]]),track()]); assert.equal(insert(f).audio,2); });
test('Unknown duration fails before edit', () => { const f=fixture(); f.media.getOutPoint=()=>({seconds:0}); assert.equal(insert(f).ok,false); assert.equal(f.calls.length,0); });
test('Source trim controls collision range', () => { const f=fixture(); f.media.getInPoint=()=>({seconds:2}); f.seq.videoTracks=tracks([track([[13,20]])]); assert.equal(insert(f).ok,true); });
test('Longest stream duration is reserved', () => { const f=fixture(); f.media.getOutPoint=type=>({seconds:type===2?8:5}); f.seq.videoTracks=tracks([track([[16,20]]),track()]); assert.equal(insert(f).video,1); });
test('Popup stays open on failure', () => { const f=panelFixture(); f.key('ArrowDown'); f.key('ArrowDown'); f.seq.videoTracks=tracks([track([[10,15]])]); f.key('Enter'); f.pending.shift()(); assert.equal(f.closed,undefined); assert.match(f.elements.status.textContent,/No free track/); });
test('A true return with no new clip is failure', () => { const f=fixture(); f.seq.overwriteClip=()=>true; assert.match(insert(f).error,/created no timeline clip/); });
test('Popup stays open for silent host no-op', () => { const f=panelFixture(); f.seq.overwriteClip=()=>true; f.key('ArrowDown'); f.key('ArrowDown'); f.key('Enter'); f.pending.shift()(); assert.equal(f.closed,undefined); assert.match(f.elements.status.textContent,/created no timeline clip/); });
test('Wrong playhead placement is failure', () => { const f=fixture(); const original=f.seq.overwriteClip; f.seq.overwriteClip=(...a)=>{ original(...a); f.seq.videoTracks[0].clips[0].start.seconds=0; return true; }; assert.match(insert(f).error,/did not match/); });
test('A native false return with verified new clip is accepted', () => { const f=fixture(); const original=f.seq.overwriteClip; f.seq.overwriteClip=(...a)=>{ original(...a); return false; }; assert.equal(insert(f).ok,true); });
test('Existing clip mutation is detected', () => { const f=fixture(); f.seq.videoTracks=tracks([track([[0,5]])]); const original=f.seq.overwriteClip; f.seq.overwriteClip=(...a)=>{ original(...a); f.seq.videoTracks[0].clips[0].end.seconds=4; return true; }; assert.match(insert(f).error,/existing timeline clip/); });
test('Empty popup does not index or render project results', () => { const f=panelFixture(''); assert.equal(f.pending.length,0); assert.equal(f.elements.results.children.length,0); assert.equal(f.elements.results.hidden,true); assert.equal(f.elements.count.hidden,true); assert.equal(f.elements.query.attrs['aria-expanded'],'false'); });
test('First typing indexes once and preserves subsequent typing', () => { const f=panelFixture(''); f.elements.query.value='Footage'; f.elements.query.listeners.input(); assert.equal(f.pending.length,1); f.elements.query.value='台北'; f.elements.query.listeners.input(); assert.equal(f.pending.length,1); f.pending.shift()(); assert.equal(f.elements.results.children.length,1); assert.equal(f.elements.query.value,'台北'); });
test('Clearing search hides all results without reindexing', () => { const f=panelFixture(); f.elements.query.value='  '; f.elements.query.listeners.input(); assert.equal(f.elements.results.hidden,true); assert.equal(f.elements.count.hidden,true); assert.equal(f.pending.length,0); f.key('Enter'); assert.equal(f.pending.length,0); });
test('Resize exception cannot stop project indexing or filtering', () => { const f=panelFixture('台北',true); assert.equal(f.elements.results.children.length,1); assert.equal(f.elements.results.hidden,false); });
test('Search library is available with CEP CommonJS globals present', () => { const ctx=vm.createContext({module:{exports:{}}}); vm.runInContext(fs.readFileSync(path.join(__dirname,'../search.js'),'utf8'),ctx); assert.equal(typeof ctx.BinSearch.filter,'function'); assert.equal(ctx.BinSearch,ctx.module.exports); });
test('Arrow navigation keeps existing result rows', () => {
  const f=panelFixture(); const row=f.elements.results.children[0];
  f.key('ArrowDown'); assert.equal(f.elements.results.children[0],row);
  assert.equal(row.attrs['aria-selected'],'false');
  assert.equal(f.elements.results.children[1].attrs['aria-selected'],'true');
});
test('Warm reopen clears old results and indexes the current project on typing', () => {
  const f=panelFixture('台北'); f.events['local.binsearch.open']();
  assert.equal(f.elements.query.value,''); assert.equal(f.elements.results.hidden,true); assert.equal(f.pending.length,0);
  f.project.documentID='p2'; f.media.name='New clip';
  f.elements.query.value='New clip'; f.elements.query.listeners.input(); f.pending.shift()();
  assert.equal(f.elements.results.children.length,1);
  f.key('Enter'); f.pending.shift()(); assert.equal(f.calls.length,1);
});
test('Late index response cannot repopulate a dismissed popup', () => {
  const f=panelFixture(''); f.elements.query.value='Footage'; f.elements.query.listeners.input();
  f.key('Escape'); f.pending.shift()();
  assert.equal(f.elements.query.value,''); assert.equal(f.elements.results.hidden,true);
});
test('Property-based stereo mapping selects A1 even when A2 is occupied', () => {
  const f=fixture(); f.media.getAudioChannelMapping={audioClipsNumber:1};
  f.seq.audioTracks=tracks([track(),track([[10,20]]),track()]);
  assert.equal(insert(f).audio,0);
});
test('Property-based multichannel mapping still reserves its full track width', () => {
  const f=fixture(); f.media.getAudioChannelMapping={audioClipsNumber:2};
  f.seq.audioTracks=tracks([track(),track([[10,20]]),track(),track()]);
  assert.equal(insert(f).audio,2);
});
function audioFixture() {
  const f=fixture(); f.media.getMediaPath=()=> 'C:/media/sound.wav';
  f.media.getAudioChannelMapping={audioClipsNumber:1};
  f.seq.videoTracks=tracks([track([[0,100]])]);
  f.seq.overwriteClip=(item,time,video,audio)=>{
    f.calls.push([item,time,video,audio]);
    const clips=f.seq.audioTracks[audio].clips;
    clips.push({nodeId:'added-audio',projectItem:item,start:{seconds:time.seconds},end:{seconds:time.seconds+5}});
    clips.numItems=clips.length;
    return true;
  };
  return f;
}
test('Audio-only insertion ignores occupied video and unrelated higher audio tracks', () => {
  const f=audioFixture(); f.seq.audioTracks=tracks([track(),track([[10,20]])]);
  const result=insert(f); assert.equal(result.ok,true); assert.equal(result.audio,0); assert.equal(result.video,-1);
  assert.equal(f.seq.videoTracks[0].clips.length,1);
});
test('Audio-only insertion chooses the first gap fitting the entire clip', () => {
  const f=audioFixture(); f.seq.audioTracks=tracks([track([[12,20]]),track([[0,10],[15,20]]),track()]);
  assert.equal(insert(f).audio,1);
});
function target(t) { t.isTargeted=()=>true; return t; }
test('Enabled audio target wins over an empty A1',()=>{
 const f=audioFixture(); f.seq.audioTracks=tracks([track(),target(track()),track()]);
 assert.equal(insert(f).audio,1);
});
test('Occupied target falls forward to the next available audio track',()=>{
 const f=audioFixture(); f.seq.audioTracks=tracks([track(),target(track([[10,20]])),track()]);
 assert.equal(insert(f).audio,2);
});
test('Multiple enabled targets take priority over untargeted tracks',()=>{
 const f=audioFixture(); f.seq.audioTracks=tracks([track(),target(track([[10,20]])),track(),target(track())]);
 assert.equal(insert(f).audio,3);
});
test('With no targets, selection starts at A1',()=>{
 const f=audioFixture(); f.seq.audioTracks=tracks([track(),track()]);
 f.seq.audioTracks.forEach(t=>t.isTargeted=()=>false);
 assert.equal(insert(f).audio,0);
});
test('Video and audio targets are selected independently',()=>{
 const f=fixture(); f.seq.videoTracks=tracks([track(),target(track())]);
 f.seq.audioTracks=tracks([track(),track(),target(track())]);
 const result=insert(f); assert.equal(result.video,1); assert.equal(result.audio,2);
});
test('Targeting does not bypass full-duration collision checks',()=>{
 const f=audioFixture(); f.seq.audioTracks=tracks([target(track([[12,20]])),track()]);
 assert.equal(insert(f).audio,1);
});
test('No free track after target fails without editing earlier tracks',()=>{
 const f=audioFixture(); f.seq.audioTracks=tracks([track(),target(track([[10,20]]))]);
 assert.equal(insert(f).ok,false); assert.equal(f.calls.length,0);
});
test('Multichannel target fallback checks the complete destination span',()=>{
 const f=fixture(); f.media.getAudioChannelMapping={audioClipsNumber:2};
 f.seq.audioTracks=tracks([track(),target(track()),track([[10,20]]),track(),track()]);
 assert.equal(insert(f).audio,3);
});
test('Preview resolves an online audio path without touching the timeline',()=>{
 const f=audioFixture(); const r=JSON.parse(f.host.previewSource('p1','clip-1'));
 assert.equal(r.ok,true); assert.equal(r.path,'C:/media/sound.wav'); assert.equal(f.calls.length,0);
});
test('Preview rejects stale project, removed item, offline media and non-audio',()=>{
 const f=audioFixture();
 assert.equal(JSON.parse(f.host.previewSource('other','clip-1')).ok,false);
 assert.equal(JSON.parse(f.host.previewSource('p1','missing')).ok,false);
 f.media.isOffline=()=>true; assert.equal(JSON.parse(f.host.previewSource('p1','clip-1')).ok,false);
 f.media.isOffline=()=>false; f.media.getMediaPath=()=> 'C:/video.mov';
 assert.equal(JSON.parse(f.host.previewSource('p1','clip-1')).ok,false); assert.equal(f.calls.length,0);
});
test('Ctrl+Space previews without inserting; Escape releases audio',()=>{
 const f=panelFixture('台北',false,true);
 f.key(' ',{ctrlKey:true}); assert.equal(f.pending.length,1); f.pending.shift()();
 assert.equal(f.players.length,1);assert.equal(f.calls.length,0);assert.equal(f.players[0].paused,false);
 f.key('Escape');assert.equal(f.players[0].paused,true);assert.equal(f.players[0].src,'');
});
test('Preview button stops propagation and does not insert',()=>{
 const f=panelFixture('台北',false,true);let stopped=false;
 f.elements['preview-0'].listeners.click({detail:1,stopPropagation(){stopped=true;},preventDefault(){}});
 f.pending.shift()();assert.equal(stopped,true);assert.equal(f.players.length,1);assert.equal(f.calls.length,0);
 f.elements.query.value='other';f.elements.query.listeners.input();assert.equal(f.players[0].paused,true);
});
test('Preview shortcut updates in the retained popup and requires exact modifiers',()=>{
 const f=panelFixture('台北',false,true);
 f.events['local.binsearch.previewShortcut']({data:'Alt+P'});
 f.key(' ',{ctrlKey:true});assert.equal(f.pending.length,0);
 f.key('p',{altKey:true,shiftKey:true});assert.equal(f.pending.length,0);
 f.key('p',{altKey:true});assert.equal(f.pending.length,1);f.pending.shift()();
 assert.equal(f.players[0].paused,false);
 assert.match(f.elements['preview-0'].title,/Alt\+P/);
});
test('Saved Ctrl+W replaces Ctrl+Space and registers with CEP',()=>{
 const f=panelFixture('台北',false,true);
 f.events['local.binsearch.previewShortcut']({data:'Ctrl+W'});
 assert.equal(f.registeredKeys.at(-1)[0].keyCode,87);
 assert.equal(f.registeredKeys.at(-1)[0].ctrlKey,true);
 f.key(' ',{ctrlKey:true}); assert.equal(f.pending.length,0);
 f.key('w',{ctrlKey:true}); assert.equal(f.pending.length,1);f.pending.shift()();
 assert.equal(f.players[0].paused,false);assert.match(f.elements['preview-0'].title,/Ctrl\+W/);
});
test('Native Space preview event plays without inserting',()=>{
 const f=panelFixture('台北',false,true);
 f.events['local.binsearch.previewToggle']();assert.equal(f.pending.length,1);f.pending.shift()();
 assert.equal(f.players[0].paused,false);assert.equal(f.calls.length,0);
 f.events['local.binsearch.previewToggle']();assert.equal(f.players[0].paused,true);
 f.events['local.binsearch.previewShortcut']({data:'disabled'});
 f.events['local.binsearch.previewToggle']();assert.equal(f.players[0].paused,true);
});
test('Space key aliases match with exact modifiers',()=>{
 const shortcut=require('../shortcut.js'); const config=shortcut.parse('Alt+Space');
 for(const event of [{key:'Spacebar'},{key:'Space'},{keyCode:32},{which:32},{code:'Space'}]) {
   assert.equal(shortcut.matches({...event,altKey:true},config),true);
   assert.equal(shortcut.matches({...event,ctrlKey:true},config),false);
 }
});
console.log(`${passed} tests passed. These are mock-host tests, not Premiere integration tests.`);
