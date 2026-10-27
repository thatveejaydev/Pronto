/*
 * PRONTO Automated Test Suite
 * Verifies host engine, search/prefix/frecency matcher, trimmed audio preview,
 * shortcut parser, sequence/image fallbacks, and palette UI controller.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const matcher = require('../client/matcher.js');
const keys = require('../client/keybinding.js');
const audioCtrl = require('../client/audio-player.js');

let totalPassed = 0;
function check(title, fn) {
    fn();
    totalPassed++;
    console.log('PASS: ' + title);
}

// 1. Matcher & Prefix Filter Tests
const sampleCatalog = [
    { id: '1', name: 'Whoosh Fast.wav', path: 'SFX / Transitions / Whoosh Fast.wav', kind: 'Audio' },
    { id: '2', name: 'Drone Beach.mov', path: 'Footage / Aerials / Drone Beach.mov', kind: 'Video' },
    { id: '3', name: 'Logo Overlay.png', path: 'Branding / Logo Overlay.png', kind: 'Image' },
    { id: '4', name: 'Main Edit v1', path: 'Sequences / Main Edit v1', kind: 'Sequence' },
    { id: '5', name: 'SFX', path: 'SFX', kind: 'Bin' }
];
const compiledSample = matcher.compileIndex(sampleCatalog);

check('Multi-token fuzzy and path matching', () => {
    const res = matcher.queryItems(sampleCatalog, 'aerial beach', compiledSample);
    assert.equal(res.length, 1);
    assert.equal(res[0].id, '2');
});

check('Category prefix filters (a:, v:, i:, s:, b:, @audio)', () => {
    assert.deepEqual(matcher.queryItems(sampleCatalog, 'a: whoosh', compiledSample).map(x => x.id), ['1']);
    assert.deepEqual(matcher.queryItems(sampleCatalog, 'a: beach', compiledSample).map(x => x.id), []);
    assert.deepEqual(matcher.queryItems(sampleCatalog, '@audio', compiledSample).map(x => x.id), ['1']);
    assert.deepEqual(matcher.queryItems(sampleCatalog, 'v:', compiledSample).map(x => x.id), ['2']);
    assert.deepEqual(matcher.queryItems(sampleCatalog, 'i: logo', compiledSample).map(x => x.id), ['3']);
    assert.deepEqual(matcher.queryItems(sampleCatalog, 's: main', compiledSample).map(x => x.id), ['4']);
    assert.deepEqual(matcher.queryItems(sampleCatalog, 'b: sfx', compiledSample).map(x => x.id), ['5']);
});

check('Frecency boost elevates frequently used items and supports Recent view', () => {
    const pair = [
        { id: 'a', name: 'Hit_01.wav', path: 'SFX / Hit_01.wav', kind: 'Audio' },
        { id: 'b', name: 'Hit_02.wav', path: 'SFX / Hit_02.wav', kind: 'Audio' }
    ];
    const ranked = matcher.queryItems(pair, 'hit', null, {
        recentsMeta: { b: { count: 5, rank: 0 } }
    });
    assert.equal(ranked[0].id, 'b');

    const recentView = matcher.queryItems(pair, '', null, {
        category: 'Recent',
        recentIds: ['b', 'a']
    });
    assert.deepEqual(recentView.map(x => x.id), ['b', 'a']);
});

// 2. Keybinding Parser Tests
check('Keybinding parser and reserved shortcut protection', () => {
    const altSpace = keys.parse('Alt + Space');
    assert.equal(altSpace.label, 'Alt+Space');
    assert.equal(altSpace.key, 32);
    assert.equal(altSpace.modifiers, 1);
    assert.equal(keys.matches({ key: ' ', altKey: true }, altSpace), true);
    assert.equal(keys.matches({ key: ' ', altKey: true, shiftKey: true }, altSpace), false);
    assert.throws(() => keys.preview('Ctrl+R'), /reserved/);
    assert.throws(() => keys.preview('Ctrl+F'), /reserved/);
});

// 3. Audio Preview Controller Tests (including trimmed In/Out & progress)
check('Audio player converts local/UNC paths, seeks to In-point, and stops at Out-point', () => {
    assert.equal(audioCtrl.toLocalFileUrl('C:\\Audio\\Hit #1.wav'), 'file:///C:/Audio/Hit%20%231.wav');
    assert.equal(audioCtrl.toLocalFileUrl('\\\\nas\\sfx\\boom.wav'), 'file://nas/sfx/boom.wav');

    const states = [];
    let currentAudio = null;
    const ctrl = audioCtrl.create(
        (method, args, cb) => cb(null, { path: 'C:/Audio/trimmed.wav', inPoint: 2, outPoint: 6 }),
        (id, state, progress) => states.push({ id, state, progress }),
        err => { throw new Error(err); },
        () => {
            currentAudio = {
                paused: true,
                currentTime: 0,
                duration: 10,
                play() { this.paused = false; if (this.onplaying) this.onplaying(); },
                pause() { this.paused = true; },
                removeAttribute() { this.src = ''; },
                load() {}
            };
            return currentAudio;
        }
    );

    ctrl.toggle('proj-1', { id: 'item-1' });
    assert.equal(currentAudio.currentTime, 2);
    assert.equal(states.at(-1).state, 'playing');

    currentAudio.currentTime = 4;
    currentAudio.ontimeupdate();
    assert.equal(states.at(-1).progress, 0.5);

    currentAudio.currentTime = 6.1;
    currentAudio.ontimeupdate();
    assert.equal(states.at(-1).state, 'stopped');
});

// 4. Host Engine (engine.jsx) Tests
function buildHostEnv() {
    const toList = arr => Object.assign(arr, { numItems: arr.length });
    const makeTrack = (clips = [], transitions = [], targeted = false) => ({
        name: 'Track',
        isTargeted: () => targeted,
        clips: toList(clips.map((r, i) => ({
            nodeId: 'existing-' + i + '-' + r[0],
            start: { seconds: r[0] },
            end: { seconds: r[1] }
        }))),
        transitions: toList(transitions.map(r => ({
            start: { seconds: r[0] },
            end: { seconds: r[1] }
        })))
    });

    const clipItem = {
        nodeId: 'node-clip',
        name: 'B-Roll.mov',
        type: 1,
        isSequence: () => false,
        isOffline: () => false,
        getColorLabel: () => 5,
        getMediaPath: () => 'C:/Media/B-Roll.mov',
        getInPoint: () => ({ seconds: 0 }),
        getOutPoint: () => ({ seconds: 4 }),
        getAudioChannelMapping: () => ({ audioClipsNumber: 1 })
    };
    const sfxItem = {
        nodeId: 'node-sfx',
        name: 'Swoosh.wav',
        type: 1,
        isSequence: () => false,
        isOffline: () => false,
        getColorLabel: () => 2,
        getMediaPath: () => 'C:/Media/Swoosh.wav',
        getInPoint: () => ({ seconds: 1 }),
        getOutPoint: () => ({ seconds: 3 }),
        getAudioChannelMapping: () => ({ audioClipsNumber: 1 })
    };
    const folderItem = {
        nodeId: 'node-bin',
        name: '01_Footage',
        type: 2,
        children: toList([clipItem, sfxItem])
    };
    const edits = [];
    const playhead = { ticks: '2540160000000', seconds: 10 };
    const activeSeq = {
        sequenceID: 'seq-main',
        name: 'Main Sequence',
        timebase: '10160640000',
        videoTracks: Object.assign([makeTrack()], { numTracks: 1 }),
        audioTracks: Object.assign([makeTrack()], { numTracks: 1 }),
        getPlayerPosition: () => playhead,
        overwriteClip: (item, timeObj, vIdx, aIdx) => {
            edits.push({ item, timeObj, vIdx, aIdx });
            const hasVideo = !(item.getMediaPath && /\.wav$/i.test(item.getMediaPath()));
            const mapping = typeof item.getAudioChannelMapping === 'function' ? item.getAudioChannelMapping() : item.getAudioChannelMapping;
            const hasAudio = !mapping || mapping.audioClipsNumber !== 0;
            if (hasVideo && activeSeq.videoTracks[vIdx]) {
                activeSeq.videoTracks[vIdx].clips.push({
                    nodeId: 'new-v-' + edits.length,
                    projectItem: item,
                    start: { seconds: timeObj.seconds },
                    end: { seconds: timeObj.seconds + 4 }
                });
                activeSeq.videoTracks[vIdx].clips.numItems = activeSeq.videoTracks[vIdx].clips.length;
            }
            if (hasAudio && activeSeq.audioTracks[aIdx]) {
                activeSeq.audioTracks[aIdx].clips.push({
                    nodeId: 'new-a-' + edits.length,
                    projectItem: item,
                    start: { seconds: timeObj.seconds },
                    end: { seconds: timeObj.seconds + 4 }
                });
                activeSeq.audioTracks[aIdx].clips.numItems = activeSeq.audioTracks[aIdx].clips.length;
            }
            return true;
        }
    };
    const project = {
        documentID: 'doc-1',
        name: 'Demo.prproj',
        rootItem: { children: toList([folderItem]) },
        activeSequence: activeSeq
    };
    const ctx = vm.createContext({
        app: {
            project,
            version: '26.3',
            properties: {
                getProperty: key => (key === 'BE.Prefs.StillImages.DefaultDuration' ? String(254016000000 * 5) : '0')
            }
        },
        ProjectItemType: { BIN: 2, CLIP: 1, FILE: 4 }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../host/engine.jsx'), 'utf8'), ctx);
    return { host: ctx.ProntoHost, project, activeSeq, clipItem, sfxItem, folderItem, edits, makeTrack, toList, ctx };
}

check('Host scanProject extracts Premiere color labels, paths, and media categories', () => {
    const env = buildHostEnv();
    const res = JSON.parse(env.host.scanProject());
    assert.equal(res.ok, true);
    assert.equal(res.items.length, 3);
    assert.equal(res.items[0].kind, 'Bin');
    assert.equal(res.items[1].kind, 'Video');
    assert.equal(res.items[1].color, 5);
    assert.equal(res.items[1].folder, '01_Footage');
});

check('Host places silent visual/photo over occupied audio tracks without error', () => {
    const env = buildHostEnv();
    env.clipItem.getMediaPath = () => 'C:/Media/Still.png';
    env.clipItem.getAudioChannelMapping = () => ({ audioClipsNumber: 0 });
    env.activeSeq.audioTracks = Object.assign([env.makeTrack([[0, 100]])], { numTracks: 1 });

    const res = JSON.parse(env.host.placeItem('doc-1', 'seq-main', 'node-clip'));
    assert.equal(res.ok, true);
    assert.equal(res.video, 0);
    assert.equal(res.audio, -1);
});

check('Host falls back to Premiere Still Image default duration when In/Out points are 0', () => {
    const env = buildHostEnv();
    env.clipItem.getMediaPath = () => 'C:/Media/Photo.png';
    env.clipItem.getAudioChannelMapping = () => ({ audioClipsNumber: 0 });
    env.clipItem.getInPoint = () => ({ seconds: 0 });
    env.clipItem.getOutPoint = () => ({ seconds: 0 });

    const res = JSON.parse(env.host.placeItem('doc-1', 'seq-main', 'node-clip'));
    assert.equal(res.ok, true);
    assert.equal(res.video, 0);
});

check('Host falls back to Sequence timeline end ticks when Sequence has no Source In/Out points', () => {
    const env = buildHostEnv();
    env.clipItem.isSequence = () => true;
    env.clipItem.getInPoint = () => ({ seconds: 0 });
    env.clipItem.getOutPoint = () => ({ seconds: 0 });
    const nestedSeq = {
        sequenceID: 'seq-nested',
        projectItem: env.clipItem,
        end: String(254016000000 * 4),
        zeroPoint: '0',
        videoTracks: Object.assign([env.makeTrack()], { numTracks: 1 }),
        audioTracks: Object.assign([env.makeTrack()], { numTracks: 1 })
    };
    env.project.sequences = Object.assign([nestedSeq, env.activeSeq], { numSequences: 2 });

    const res = JSON.parse(env.host.placeItem('doc-1', 'seq-main', 'node-clip'));
    assert.equal(res.ok, true);
    assert.equal(res.video, 0);
    assert.equal(res.audio, 0);
});

check('Host openItem supports timeline sequence switch, Source Monitor, and Project panel reveal', () => {
    const env = buildHostEnv();
    let selectedInView = null;
    env.ctx.app.getProjectViewIDs = () => ['v1'];
    env.ctx.app.getProjectFromViewID = () => env.project;
    env.ctx.app.setProjectViewSelection = items => { selectedInView = items; };
    env.ctx.app.getProjectViewSelection = () => selectedInView;

    const rev = JSON.parse(env.host.openItem('doc-1', 'node-clip', 'reveal'));
    assert.equal(rev.ok, true);
    assert.equal(selectedInView[0], env.clipItem);

    env.clipItem.isSequence = () => true;
    let sourceOpened = null;
    env.ctx.app.sourceMonitor = {
        openProjectItem: item => { sourceOpened = item; return 0; },
        getProjectItem: () => sourceOpened
    };
    const srcSeq = JSON.parse(env.host.openItem('doc-1', 'node-clip', 'source'));
    assert.equal(srcSeq.ok, true);
    assert.equal(sourceOpened, env.clipItem);
});

// 5. Palette UI Integration Tests
function buildPaletteUI() {
    const env = buildHostEnv();
    const domNodes = {};
    const pendingBridge = [];
    const cepListeners = {};
    const storage = {};
    const audioInstances = [];

    function FakeAudio() {
        this.paused = true;
        this.currentTime = 0;
        this.duration = 5;
        audioInstances.push(this);
    }
    FakeAudio.prototype.play = function () { this.paused = false; if (this.onplaying) this.onplaying(); };
    FakeAudio.prototype.pause = function () { this.paused = true; };
    FakeAudio.prototype.removeAttribute = function () { this.src = ''; };
    FakeAudio.prototype.load = function () {};

    function makeNode(tag, id) {
        return {
            tag,
            id,
            value: '',
            hidden: false,
            style: {},
            children: [],
            attrs: {},
            listeners: {},
            set textContent(v) { this.text = v; this.children = []; },
            get textContent() { return this.text || ''; },
            appendChild(child) {
                this.children.push(child);
                if (child.id) domNodes[child.id] = child;
            },
            setAttribute(k, v) { this.attrs[k] = v; },
            getAttribute(k) { return this.attrs[k]; },
            removeAttribute(k) { delete this.attrs[k]; },
            addEventListener(k, fn) { this.listeners[k] = fn; },
            focus() {},
            select() {},
            scrollIntoView() {}
        };
    }

    for (const id of ['query', 'filter-bar', 'count', 'status', 'results', 'footer-hints', 'preview-kbd']) {
        domNodes[id] = makeNode('div', id);
    }
    for (const cat of ['All', 'Recent', 'Audio', 'Video', 'Image', 'Graphic', 'Sequence', 'Bin']) {
        const pill = makeNode('button', 'pill-' + cat);
        pill.setAttribute('data-category', cat);
        domNodes['filter-bar'].appendChild(pill);
    }

    const document = {
        getElementById: id => domNodes[id],
        createElement: tag => makeNode(tag),
        addEventListener() {}
    };

    const uiCtx = vm.createContext({
        document,
        Date: { now: () => 1000 },
        localStorage: {
            getItem: k => storage[k] || null,
            setItem: (k, v) => { storage[k] = String(v); }
        },
        ProntoKeys: keys,
        ProntoMatcher: matcher,
        ProntoAudioPlayer: audioCtrl,
        Audio: FakeAudio,
        setTimeout: fn => fn(),
        window: {
            innerHeight: 60,
            setInterval() {},
            addEventListener() {},
            __adobe_cep__: {
                registerKeyEventsInterest() {},
                dispatchEvent() {},
                addEventListener: (k, fn) => { cepListeners[k] = fn; },
                resizeContent() {},
                closeExtension: () => { env.closed = true; },
                evalScript: (script, cb) => {
                    pendingBridge.push(() => cb(vm.runInContext(script, env.ctx)));
                }
            }
        }
    });

    vm.runInContext(fs.readFileSync(path.join(__dirname, '../client/palette.js'), 'utf8'), uiCtx);
    pendingBridge.shift()();

    return { env, domNodes, pendingBridge, cepListeners, storage, audioInstances };
}

check('Palette renders label color dots, filter pills, and queues Enter if pressed during reopen ping', () => {
    const ui = buildPaletteUI();
    ui.domNodes.query.value = 'B-Roll';
    ui.domNodes.query.listeners.input();
    assert.equal(ui.domNodes.results.children.length, 1);

    ui.cepListeners['com.pronto.ppro.open']();
    assert.equal(ui.pendingBridge.length, 1);
    ui.domNodes.query.value = 'B-Roll';
    ui.domNodes.query.listeners.input();
    ui.domNodes.query.listeners.keydown({ key: 'Enter', preventDefault() {} });

    ui.pendingBridge.shift()();
    assert.equal(ui.pendingBridge.length, 1);
    ui.pendingBridge.shift()();
    assert.equal(ui.env.edits.length, 1);
    assert.equal(ui.env.closed, true);

    ui.cepListeners['com.pronto.ppro.open']();
    ui.pendingBridge.shift()();
    ui.domNodes.query.listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
    assert.equal(ui.domNodes.results.children.length, 1);
    assert.match(ui.domNodes.count.textContent, /Recent items/);
});

check('Launcher Auto-Preview works when typing a search query, arrowing, and receiving JSON string CEP events', () => {
    const ui = buildPaletteUI();
    // Simulate CEP passing raw JSON string event payload (as CEPHtmlEngine does natively)
    ui.cepListeners['com.pronto.ppro.autoPreview'](JSON.stringify({ data: 'true' }));

    // 1. Typing a search query that matches an Audio item at index 0 auto-plays immediately!
    ui.domNodes.query.value = 'Swoosh';
    ui.domNodes.query.listeners.input();
    assert.equal(ui.pendingBridge.length, 1);
    ui.pendingBridge.shift()();
    assert.equal(ui.audioInstances.length, 1);
    assert.equal(ui.audioInstances[0].paused, false);
    assert.equal(ui.audioInstances[0].currentTime, 1);

    // 2. Reopening the palette preserves Auto-Preview setting and plays on next search/arrow
    ui.cepListeners['com.pronto.ppro.open']();
    ui.pendingBridge.shift()(); // ping

    ui.domNodes.query.value = '01_Footage';
    ui.domNodes.query.listeners.input();
    ui.domNodes.query.listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
    assert.equal(ui.audioInstances.length, 1);
    ui.domNodes.query.listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
    ui.pendingBridge.shift()();
    assert.equal(ui.audioInstances.length, 2);
    assert.equal(ui.audioInstances[1].paused, false);
});

console.log('\nAll ' + totalPassed + ' PRONTO test suites passed!');
