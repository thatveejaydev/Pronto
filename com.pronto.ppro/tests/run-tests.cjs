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

function buildLauncherUI(saved = {}) {
    const { EventEmitter } = require('node:events');
    const storage = { ...saved }, nodes = {}, children = [], events = [];
    for (const id of ['open-palette', 'launch-shortcut', 'btn-open-shortcut', 'btn-preview-shortcut', 'btn-auto-preview', 'open-shortcut-status', 'preview-shortcut-status']) {
        nodes[id] = { textContent: '', hidden: false, checked: false, listeners: {},
            addEventListener(type, fn) { this.listeners[type] = fn; } };
    }
    function spawn() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdout.setEncoding = child.stderr.setEncoding = () => {};
        child.stdin = new EventEmitter();
        child.stdin.end = () => child.emit('exit');
        children.push(child);
        return child;
    }
    const ctx = vm.createContext({
        document: { getElementById: id => nodes[id] },
        localStorage: { getItem: k => storage[k] || null, setItem: (k, v) => { storage[k] = v; } },
        ProntoKeys: keys,
        window: { addEventListener() {}, cep_node: {
            process: { platform: 'win32', pid: 123, env: {} },
            require: name => name === 'path' ? path : { spawn }
        }, __adobe_cep__: { getSystemPath: () => 'C:/PRONTO', dispatchEvent: ev => events.push(ev),
            addEventListener() {}, evalScript() {}, requestOpenExtension() {} } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../client/launcher.js'), 'utf8'), ctx);
    return { nodes, storage, children, events, emit: token => children[children.length - 1].stdout.emit('data', token + '\n') };
}

check('Launcher checkbox restores, persists and broadcasts auto-preview settings', () => {
    const ui = buildLauncherUI({ 'pronto.autoPreview': 'true' });
    const checkbox = ui.nodes['btn-auto-preview'];
    assert.equal(checkbox.checked, true);
    checkbox.checked = false;
    checkbox.listeners.change();
    assert.equal(ui.storage['pronto.autoPreview'], 'false');
    assert.equal(ui.events.filter(ev => ev.type === 'com.pronto.ppro.autoPreview').pop().data, 'false');
    assert.equal(buildLauncherUI(ui.storage).nodes['btn-auto-preview'].checked, false);
});

check('Launcher shortcut labels track recording and disabling; only READY shows active status', () => {
    const ui = buildLauncherUI({ 'pronto.openShortcut': JSON.stringify({ enabled: true, value: 'Alt+Q' }) });
    const label = ui.nodes['launch-shortcut'], status = ui.nodes['open-shortcut-status'];
    assert.equal(label.textContent, 'Alt+Q');
    assert.equal(label.hidden, false);
    ui.emit('STARTED');
    assert.equal(status.className, 'shortcut-status');
    ui.emit('READY');
    assert.equal(status.className, 'shortcut-status is-active');
    ui.emit('CONFLICT');
    assert.equal(status.className, 'shortcut-status');
    assert.match(status.textContent, /another app/);
    ui.nodes['btn-open-shortcut'].listeners.click();
    assert.equal(ui.nodes['btn-open-shortcut'].textContent, 'Press keys…');
    ui.emit('LISTENING');
    assert.match(status.textContent, /Listening/);
    ui.emit('CAPTURE:1:69');
    assert.equal(label.textContent, 'Alt+E');
    ui.emit('STARTED');
    ui.nodes['btn-open-shortcut'].listeners.contextmenu({ preventDefault() {} });
    assert.equal(label.hidden, true);
    ui.emit('STARTED');
    assert.match(status.textContent, /disabled/);
    assert.equal(status.className, 'shortcut-status');
    ui.emit('READY');
    ui.children[ui.children.length - 1].emit('exit');
    assert.equal(status.className, 'shortcut-status');
});

check('Bounded search matches full ranking and preserves counts, ties, filters and recents', () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({ id: String(i),
        name: ['Impact', 'Whoosh', 'Room tone'][i % 3] + ' ' + (i % 37),
        path: 'SFX / ' + (i % 7), kind: i % 2 ? 'Audio' : 'Video' }));
    const index = matcher.compileIndex(items);
    for (const query of ['a:', 'impact', 'wh', 'room 2', 'no-match', '']) {
        for (const options of [{}, { category: 'Video' }, { recentsMeta: { '4000': { count: 8, rank: 0 } } },
            { category: 'Recent', recentIds: ['4000', '2', '99'] }]) {
            const full = matcher.queryItems(items, query, index, options);
            for (const limit of [0, 1, 100]) {
                const page = matcher.queryResults(items, query, index, { ...options, limit });
                assert.equal(page.total, full.length);
                assert.deepEqual(page.items, full.slice(0, limit));
            }
        }
    }
});

check('Source metadata is reused for previews while timing and insertion layout stay fresh', () => {
    const env = buildHostEnv();
    let mappingReads = 0, width = 1;
    env.clipItem.getAudioChannelMapping = () => { mappingReads++; return { audioClipsNumber: width }; };
    let preview = JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip'));
    assert.equal(preview.audio, 0);
    assert.equal(mappingReads, 1);
    env.clipItem.getOutPoint = () => ({ seconds: 8 });
    env.activeSeq.getPlayerPosition = () => ({ seconds: 20, ticks: '5080320000000' });
    preview = JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip'));
    assert.equal(mappingReads, 1);
    assert.equal(preview.duration, 8);
    assert.equal(preview.start, 20);
    width = 0;
    const placed = JSON.parse(env.host.placeItem('doc-1', 'seq-main', 'node-clip'));
    assert.equal(placed.ok, true);
    assert.equal(placed.audio, -1);
    // Planner refresh plus the mock overwrite's own mapping read.
    assert.equal(mappingReads, 3);
    env.host.scanProject();
    env.host.previewPlacement('doc-1', 'seq-main', 'node-clip');
    assert.equal(mappingReads, 4);
    env.clipItem.getMediaPath = () => 'C:/Media/Relinked.mov';
    env.host.previewPlacement('doc-1', 'seq-main', 'node-clip');
    assert.equal(mappingReads, 5);
});

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

check('Placement preview is read-only and agrees with video/audio insertion destinations', () => {
    const env = buildHostEnv();
    env.activeSeq.videoTracks = Object.assign([env.makeTrack([[0, 100]]), env.makeTrack()], { numTracks: 2 });
    env.activeSeq.audioTracks = Object.assign([env.makeTrack([[0, 100]]), env.makeTrack([[0, 100]]), env.makeTrack()], { numTracks: 3 });
    const preview = JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip'));
    assert.equal(preview.ok, true);
    assert.equal(preview.video, 1);
    assert.equal(preview.audio, 2);
    assert.equal(preview.start, 10);
    assert.equal(preview.duration, 4);
    assert.equal(env.edits.length, 0);
    const placed = JSON.parse(env.host.placeItem('doc-1', 'seq-main', 'node-clip'));
    assert.equal(placed.ok, true);
    assert.equal(placed.video, preview.video);
    assert.equal(placed.audio, preview.audio);
});

check('Placement preview handles audio-only, silent video, blocked space and stale context without editing', () => {
    const env = buildHostEnv();
    const audio = JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-sfx'));
    assert.equal(audio.video, -1);
    assert.equal(audio.audio, 0);
    env.clipItem.getAudioChannelMapping = () => ({ audioClipsNumber: 0 });
    const silent = JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip'));
    assert.equal(silent.video, 0);
    assert.equal(silent.audio, -1);
    env.activeSeq.videoTracks = Object.assign([env.makeTrack([[0, 100]])], { numTracks: 1 });
    assert.equal(JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip')).ok, false);
    assert.equal(JSON.parse(env.host.previewPlacement('other', 'seq-main', 'node-clip')).ok, false);
    assert.equal(JSON.parse(env.host.previewPlacement('doc-1', 'other', 'node-clip')).ok, false);
    assert.equal(env.edits.length, 0);
});

check('Item cache skips unrelated bins and refreshes removed, moved and switched-project references', () => {
    const env = buildHostEnv();
    let unrelatedReads = 0;
    const other = { nodeId: 'other-bin', name: 'Other', type: 2,
        get children() { unrelatedReads++; return env.toList([]); } };
    env.project.rootItem.children = env.toList([env.folderItem, other]);
    env.host.scanProject();
    unrelatedReads = 0;
    assert.equal(JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip')).ok, true);
    assert.equal(unrelatedReads, 0);
    env.folderItem.children = env.toList([env.sfxItem]);
    assert.equal(JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip')).ok, false);
    const moved = { nodeId: 'moved-bin', name: 'Moved', type: 2, children: env.toList([env.clipItem]) };
    env.project.rootItem.children = env.toList([env.folderItem, moved]);
    assert.equal(JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip')).ok, true);
    env.project.rootItem.children = env.toList([env.folderItem]);
    assert.equal(JSON.parse(env.host.previewPlacement('doc-1', 'seq-main', 'node-clip')).ok, false);
    env.ctx.app.project = { documentID: 'doc-2', name: 'New', rootItem: { children: env.toList([]) }, activeSequence: env.activeSeq };
    assert.equal(JSON.parse(env.host.previewPlacement('doc-2', 'seq-main', 'node-clip')).ok, false);
});

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
function buildPaletteUI(withPlacement = false) {
    const env = buildHostEnv();
    const domNodes = {};
    const pendingBridge = [];
    const cepListeners = {};
    const storage = {};
    const audioInstances = [];
    const timers = new Map();
    let timerId = 0;

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
            removeChild(child) {
                this.children.splice(this.children.indexOf(child), 1);
            },
            insertBefore(child, reference) {
                const existing = this.children.indexOf(child);
                if (existing >= 0) this.children.splice(existing, 1);
                const index = reference ? this.children.indexOf(reference) : this.children.length;
                this.children.splice(index, 0, child);
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
    if (withPlacement) {
        for (const id of ['placement', 'placement-state', 'placement-video', 'placement-audio', 'placement-time', 'placement-detail']) {
            domNodes[id] = makeNode('span', id);
        }
    }
    for (const cat of ['All', 'Recent', 'Audio', 'Video', 'Image', 'Graphic', 'Sequence', 'Bin']) {
        const pill = makeNode('button', 'pill-' + cat);
        pill.setAttribute('data-category', cat);
        domNodes['filter-bar'].appendChild(pill);
    }

    const documentListeners = {};
    const document = {
        getElementById: id => {
            if (/^(result-|preview-\d|progress-)/.test(id)) {
                function find(node) {
                    if (node.id === id) return node;
                    for (const child of node.children) { const match = find(child); if (match) return match; }
                    return null;
                }
                return find(domNodes.results);
            }
            return domNodes[id];
        },
        createElement: tag => makeNode(tag),
        addEventListener(k, fn) { documentListeners[k] = fn; }
    };

    const registeredIntervals = [];
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
        setTimeout: (fn, delay) => {
            if (!withPlacement || delay !== 150) { fn(); return; }
            timers.set(++timerId, fn);
            return timerId;
        },
        clearTimeout: id => timers.delete(id),
        window: {
            innerHeight: 60,
            setInterval: (fn, ms) => { registeredIntervals.push({ fn, ms }); },
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

    return { env, domNodes, pendingBridge, cepListeners, storage, audioInstances, registeredIntervals, documentListeners,
        flushPreviewTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); } };
}

check('Preview requests stay single-flight and coalesce to the latest selection across dismissal', () => {
    const ui = buildPaletteUI(true);
    function search(query) {
        ui.domNodes.query.value = query;
        ui.domNodes.query.listeners.input();
        ui.flushPreviewTimers();
    }
    search('B-Roll');
    assert.equal(ui.pendingBridge.length, 1);
    search('Swoosh');
    search('B-Roll');
    search('Swoosh');
    assert.equal(ui.pendingBridge.length, 1);
    ui.pendingBridge.shift()();
    assert.equal(ui.pendingBridge.length, 1);
    assert.equal(ui.domNodes['placement-state'].textContent, 'Checking…');
    ui.pendingBridge.shift()();
    assert.equal(ui.domNodes['placement-video'].hidden, true);
    assert.equal(ui.domNodes['placement-audio'].textContent, 'A1');
    search('B-Roll');
    search('Swoosh');
    ui.domNodes.query.listeners.keydown({ key: 'Escape', preventDefault() {} });
    ui.pendingBridge.shift()();
    assert.equal(ui.pendingBridge.length, 0);
    assert.equal(ui.domNodes.placement.hidden, true);
});

check('Palette reuses rows across filtering, updates metadata and keeps reordered audio actions correct', () => {
    const ui = buildPaletteUI();
    function search(value) { ui.domNodes.query.value = value; ui.domNodes.query.listeners.input(); }
    search('01_Footage');
    const original = [...ui.domNodes.results.children];
    search('01_Footage');
    original.forEach((row, i) => assert.equal(ui.domNodes.results.children[i], row));
    const audioRow = original.find(row => row.children[1].children[1].textContent === 'Swoosh.wav');
    assert.ok(audioRow);
    search('Swoosh');
    assert.equal(ui.domNodes.results.children.length, 1);
    assert.equal(ui.domNodes.results.children[0], audioRow);
    assert.equal(audioRow.id, 'result-0');
    const play = audioRow.children.find(node => node.className === 'preview-button');
    assert.equal(play.id, 'preview-0');
    play.listeners.click({ preventDefault() {}, stopPropagation() {} });
    ui.pendingBridge.shift()();
    assert.match(ui.audioInstances[0].src, /Swoosh.wav$/);
    assert.equal(ui.domNodes.results.children[0], audioRow);
    ui.env.sfxItem.name = 'Swoosh updated.wav';
    ui.env.sfxItem.isOffline = () => true;
    ui.documentListeners.keydown({ key: 'r', ctrlKey: true, preventDefault() {} });
    ui.pendingBridge.shift()();
    assert.equal(ui.domNodes.results.children[0], audioRow);
    assert.equal(audioRow.children[1].children[1].textContent, 'Swoosh updated.wav');
    assert.match(audioRow.children[2].textContent, /OFFLINE/);
    assert.equal(play.hidden, true);
    search('no results');
    assert.equal(ui.domNodes.results.children.length, 0);
    assert.equal(ui.domNodes.query.attrs['aria-activedescendant'], undefined);
});

check('Tab applies each category in order, wraps, and Shift+Tab reverses without changing the query', () => {
    const ui = buildPaletteUI();
    ui.domNodes.query.value = 'Swoosh';
    ui.domNodes.query.listeners.input();
    const selected = () => ui.domNodes['filter-bar'].children.find(p => p.attrs['aria-pressed'] === 'true').getAttribute('data-category');
    let prevented = 0;
    const tab = shiftKey => ui.documentListeners.keydown({ key: 'Tab', shiftKey, preventDefault() { prevented++; } });
    for (const category of ['Recent', 'Audio', 'Video', 'Image', 'Graphic', 'Sequence', 'Bin', 'All']) {
        tab(false);
        assert.equal(selected(), category);
    }
    tab(true);
    assert.equal(selected(), 'Bin');
    assert.equal(ui.domNodes.query.value, 'Swoosh');
    assert.equal(prevented, 9);
    ui.documentListeners.keydown({ key: 'Tab', ctrlKey: true, preventDefault() { throw new Error('Modified Tab intercepted'); } });
    assert.equal(selected(), 'Bin');
});

check('Palette renders label color dots, filter pills, and immediately closes window on Enter before host finishes', () => {
    const ui = buildPaletteUI();
    ui.domNodes.query.value = 'B-Roll';
    ui.domNodes.query.listeners.input();
    assert.equal(ui.domNodes.results.children.length, 1);

    // Pressing Enter immediately closes the floating window while host placement is still in flight
    ui.domNodes.query.listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(ui.env.closed, true);
    assert.equal(ui.env.edits.length, 0);
    assert.equal(ui.pendingBridge.length, 1);
    ui.pendingBridge.shift()();
    assert.equal(ui.env.edits.length, 1);

    ui.env.closed = false;
    ui.env.activeSeq.getPlayerPosition = () => ({ ticks: '5080320000000', seconds: 20 });
    ui.cepListeners['com.pronto.ppro.open']();
    assert.equal(ui.pendingBridge.length, 1);
    ui.domNodes.query.value = 'B-Roll';
    ui.domNodes.query.listeners.input();
    ui.domNodes.query.listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(ui.env.closed, true);

    ui.pendingBridge.shift()();
    assert.equal(ui.pendingBridge.length, 1);
    ui.pendingBridge.shift()();
    assert.equal(ui.env.edits.length, 2);

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

check('Timeline placement check only inspects clips on destination tracks, skipping non-destination tracks', () => {
    const env = buildHostEnv();
    let nonTargetClipReads = 0;
    const heavyTrack = {
        isTargeted: () => false,
        clips: Object.assign([
            {
                get nodeId() { nonTargetClipReads++; return 'heavy-1'; },
                projectItem: { nodeId: 'other' },
                start: { seconds: 0 },
                end: { seconds: 5 }
            }
        ], { numItems: 1 }),
        transitions: Object.assign([], { numItems: 0 })
    };
    const destVideoTrack = env.makeTrack([], [], true);
    const destAudioTrack = env.makeTrack([], [], true);
    env.activeSeq.videoTracks = Object.assign([heavyTrack, destVideoTrack], { numTracks: 2 });
    env.activeSeq.audioTracks = Object.assign([heavyTrack, destAudioTrack], { numTracks: 2 });
    env.clipItem.getAudioChannelMapping = () => ({ audioClipsNumber: 1 });

    const res = JSON.parse(env.host.placeItem('doc-1', 'seq-main', 'node-clip'));
    assert.equal(res.ok, true);
    assert.equal(res.video, 1);
    assert.equal(res.audio, 1);
    assert.equal(nonTargetClipReads, 0);
});

check('Palette registers no background setInterval timer to prevent dropped frames during playback', () => {
    const ui = buildPaletteUI();
    assert.equal(ui.registeredIntervals.length, 0);
});

console.log('\nAll ' + totalPassed + ' PRONTO test suites passed!');
