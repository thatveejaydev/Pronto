/* ES3-compatible host code. No QE APIs, filesystem access, or external dependencies. */
var BinSearchHost = (function () {
    function quote(s) {
        return '"' + String(s).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
            if (c === '"') { return '\\"'; }
            if (c === '\\') { return '\\\\'; }
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
    }
    // ExtendScript does not guarantee a built-in JSON object.
    function json(v) {
        var parts = [], k;
        if (v === null || v === undefined) { return 'null'; }
        if (typeof v === 'string') { return quote(v); }
        if (typeof v === 'number' || typeof v === 'boolean') { return String(v); }
        if (v instanceof Array) {
            for (k = 0; k < v.length; k++) { parts.push(json(v[k])); }
            return '[' + parts.join(',') + ']';
        }
        for (k in v) { if (v.hasOwnProperty(k)) { parts.push(quote(k) + ':' + json(v[k])); } }
        return '{' + parts.join(',') + '}';
    }
    function project() {
        var p = app.project;
        if (!p || !p.rootItem || !p.documentID) { throw new Error('Open a project first.'); }
        return p;
    }
    function walk(parent, path, visit) {
        var i, item, next;
        for (i = 0; i < parent.children.numItems; i++) {
            item = parent.children[i];
            if (!item) { continue; }
            next = path ? path + ' / ' + item.name : String(item.name);
            if (visit(item, next) === false) { return false; }
            if (item.type === ProjectItemType.BIN && walk(item, next, visit) === false) { return false; }
        }
        return true;
    }
    function tracks(collection, prefix) {
        var out = [], i;
        for (i = 0; i < collection.numTracks; i++) {
            out.push({ index: i, name: prefix + (i + 1) + ' · ' + collection[i].name });
        }
        return out;
    }
    function context(p) {
        var s = p.activeSequence;
        return s ? { id: String(s.sequenceID), name: String(s.name), video: tracks(s.videoTracks, 'V'), audio: tracks(s.audioTracks, 'A') } : null;
    }
    function mediaKind(item) {
        // Use the source path so renamed project items retain their media icon.
        var source = '';
        try { if (item.getMediaPath) { source = item.getMediaPath() || ''; } } catch (e) {}
        var match = /\.([^.\\\/]+)$/.exec(String(source || item.name).toLowerCase());
        var ext = match ? match[1] : '';
        if (/^(png|jpe?g|tiff?|psd|psb|bmp|gif|webp|heic|heif|exr|dpx|tga|ai|eps|svg|ico|cin)$/.test(ext)) { return 'Image'; }
        if (/^(wav|wave|mp3|aiff?|aifc|aac|m4a|flac|ogg|oga|opus|wma|ac3|caf|bwf)$/.test(ext)) { return 'Audio'; }
        if (/^(mov|mp4|m4v|mxf|avi|mkv|webm|mts|m2ts|ts|mpeg|mpg|m2v|vob|r3d|braw|ari|crm|wmv|flv|3gp|mpe|m2t)$/.test(ext)) { return 'Video'; }
        if (/^(mogrt|prtl|aep|aepx)$/.test(ext)) { return 'Graphic'; }
        return 'Media';
    }
    function index() {
        try {
            var p = project(), items = [];
            walk(p.rootItem, '', function (item, path) {
                var bin = item.type === ProjectItemType.BIN;
                var sequence = !bin && item.isSequence && item.isSequence();
                var offline = !bin && !sequence && item.isOffline && item.isOffline();
                items.push({ id: String(item.nodeId), name: String(item.name), path: path,
                    kind: bin ? 'Bin' : sequence ? 'Sequence' : mediaKind(item), offline: !!offline,
                    insertable: !bin && !sequence && (item.type === ProjectItemType.CLIP || item.type === ProjectItemType.FILE) });
            });
            return json({ ok: true, project: String(p.documentID), name: String(p.name), version: String(app.version), items: items, sequence: context(p) });
        } catch (e) { return json({ ok: false, error: String(e.message || e) }); }
    }
    function duration(item, sequence) {
        var longest = 0, types = [4, 1, 2], i, a, b;
        for (i = 0; i < types.length; i++) {
            try {
                a = Number(item.getInPoint(types[i]).seconds);
                b = Number(item.getOutPoint(types[i]).seconds);
                if (isFinite(a) && isFinite(b) && a >= 0 && b > a) { longest = Math.max(longest, b - a); }
            } catch (ignored) {}
        }
        if (!longest) { throw new Error('Cannot determine source duration safely. Set source In/Out points and retry.'); }
        var frame = Number(sequence.timebase) / 254016000000;
        if (!(frame > 0)) { throw new Error('Cannot read timeline frame duration.'); }
        return Math.ceil(longest / frame - 0.0000001) * frame;
    }
    function clear(track, start, end) {
        var collections = [track.clips, track.transitions], i, j, c, a, b;
        for (i = 0; i < collections.length; i++) {
            c = collections[i];
            if (!c) { throw new Error('Cannot inspect timeline clips/transitions safely.'); }
            for (j = 0; j < c.numItems; j++) {
                a = Number(c[j].start.seconds); b = Number(c[j].end.seconds);
                if (!isFinite(a) || !isFinite(b)) { throw new Error('Cannot read timeline item bounds.'); }
                if (a < end - 0.00000001 && b > start + 0.00000001) { return false; }
            }
        }
        return true;
    }
    function firstFree(tracks, width, start, end) {
        var i, j, count, available, candidates = [], targeted = {}, first = -1, c;
        // Prefer enabled targets, in track-number order, then later unselected tracks.
        // Read targeting at insertion time, so changes made while searching take effect.
        for (i = 0; i < tracks.numTracks; i++) {
            if (tracks[i].isTargeted && tracks[i].isTargeted()) {
                if (first < 0) { first = i; }
                targeted[i] = true; candidates.push(i);
            }
        }
        for (i = first < 0 ? 0 : first; i < tracks.numTracks; i++) {
            if (!targeted[i]) { candidates.push(i); }
        }
        for (c = 0; c < candidates.length; c++) {
            i = candidates[c];
            // Unknown audio mapping: reserve all existing tracks at and above this index.
            count = width === null ? tracks.numTracks - i : width;
            if (i + count > tracks.numTracks) { continue; }
            available = true;
            for (j = i; j < i + count; j++) {
                if (!clear(tracks[j], start, end)) { available = false; break; }
            }
            if (available) { return i; }
        }
        return -1;
    }
    function timelineItems(sequence) {
        var out = [], groups = [sequence.videoTracks, sequence.audioTracks], g, t, i, clip;
        for (g = 0; g < groups.length; g++) {
            for (t = 0; t < groups[g].numTracks; t++) {
                for (i = 0; i < groups[g][t].clips.numItems; i++) {
                    clip = groups[g][t].clips[i];
                    out.push({ id: String(clip.nodeId), source: clip.projectItem ? String(clip.projectItem.nodeId) : '',
                        kind: g, track: t, start: Number(clip.start.seconds), end: Number(clip.end.seconds) });
                }
            }
        }
        return out;
    }
    function verifyPlacement(before, after, source, start, video, audio, width, tolerance) {
        var old = {}, i, clip, added = 0, wrong = 0;
        for (i = 0; i < before.length; i++) { old['n' + before[i].id] = true; }
        for (i = 0; i < after.length; i++) {
            clip = after[i];
            if (old['n' + clip.id]) { continue; }
            added++;
            if (clip.source !== source || Math.abs(clip.start - start) > tolerance || !(clip.end > clip.start) ||
                (clip.kind === 0 && clip.track !== video) ||
                (clip.kind === 1 && (clip.track < audio || (width !== null && clip.track >= audio + width)))) { wrong++; }
        }
        if (!added) { throw new Error('Premiere created no timeline clip. Check that the destination tracks are unlocked and compatible with this media. The search stays open; no automatic retry was made.'); }
        if (wrong) { throw new Error('Premiere changed the timeline, but placement did not match the playhead/tracks. Inspect the edit and use Undo before retrying.'); }
        // An overwrite must never trim, remove or shift a pre-existing item.
        var current = {};
        for (i = 0; i < after.length; i++) { current['n' + after[i].id] = after[i]; }
        for (i = 0; i < before.length; i++) {
            clip = current['n' + before[i].id];
            if (!clip || clip.start !== before[i].start || clip.end !== before[i].end || clip.track !== before[i].track || clip.kind !== before[i].kind) {
                throw new Error('Premiere changed an existing timeline clip. Use Undo and inspect the timeline before retrying.');
            }
        }
    }
    function insert(projectID, sequenceID, nodeID) {
        try {
            var p = project(), s = p.activeSequence, found = null;
            if (String(p.documentID) !== projectID) { throw new Error('Active project changed. Refresh before inserting.'); }
            if (!s) { throw new Error('Open a timeline first, then refresh.'); }
            if (String(s.sequenceID) !== sequenceID) { throw new Error('Active timeline changed. Refresh before inserting.'); }
            walk(p.rootItem, '', function (item) {
                if (String(item.nodeId) === nodeID) { found = item; return false; }
            });
            if (!found) { throw new Error('Item was removed. Refresh the search.'); }
            if (found.type === ProjectItemType.BIN || (found.isSequence && found.isSequence()) ||
                (found.type !== ProjectItemType.CLIP && found.type !== ProjectItemType.FILE)) {
                throw new Error('Select project media. Bins and sequences cannot be inserted by this prototype.');
            }
            if (found.isOffline && found.isOffline()) { throw new Error('Relink this offline media before inserting.'); }
            var time = s.getPlayerPosition();
            var start = Number(time.seconds), end = start + duration(found, s), width = null, mapping;
            if (!isFinite(start) || start < 0) { throw new Error('Cannot read the playhead position.'); }
            try {
                // Adobe exposes this as a property; tolerate callable host variants too.
                mapping = found.getAudioChannelMapping;
                if (typeof mapping === 'function') { mapping = found.getAudioChannelMapping(); }
                if (mapping && typeof mapping.audioClipsNumber === 'number' && mapping.audioClipsNumber >= 0 && mapping.audioClipsNumber === Math.floor(mapping.audioClipsNumber)) {
                    width = Math.max(1, mapping.audioClipsNumber);
                }
            } catch (ignored) {}
            var audioOnly = mediaKind(found) === 'Audio';
            var video = audioOnly ? -1 : firstFree(s.videoTracks, 1, start, end);
            var audio = firstFree(s.audioTracks, width, start, end);
            if ((!audioOnly && video < 0) || audio < 0) { throw new Error('No free track space for the full clip. Add an empty ' + (audioOnly ? 'audio' : 'video/audio') + ' track and retry. Nothing was changed.'); }
            // Sequence methods accept the native Time object. Avoid ambiguous string coercion.
            var before = timelineItems(s);
            // Audio-only sources create no video; pass a valid placeholder video index.
            s.overwriteClip(found, time, audioOnly ? 0 : video, audio);
            verifyPlacement(before, timelineItems(s), String(found.nodeId), start, video, audio, width,
                Number(s.timebase) / 254016000000 / 2);
            return json({ ok: true, message: 'Placed ' + found.name + ' on ' + (audioOnly ? '' : 'V' + (video + 1) + '/') + 'A' + (audio + 1) + '.', video: video, audio: audio });
        } catch (e) { return json({ ok: false, error: String(e.message || e) }); }
    }
    function openSource(projectID, nodeID) {
        try {
            var p = project(), found = null;
            if (String(p.documentID) !== projectID) { throw new Error('Active project changed. Refresh the search.'); }
            walk(p.rootItem, '', function (item) {
                if (String(item.nodeId) === nodeID) { found = item; return false; }
            });
            if (!found) { throw new Error('Item was removed. Refresh the search.'); }
            if (found.type === ProjectItemType.BIN) { throw new Error('Choose media or a sequence to open in the Source Monitor.'); }
            if (found.isOffline && found.isOffline()) { throw new Error('Relink this offline media before opening it.'); }
            var result = app.sourceMonitor.openProjectItem(found), current = null, checked = false;
            // Host versions differ in the return value. Prefer the actual opened item.
            try {
                current = app.sourceMonitor.getProjectItem();
                checked = true;
            } catch (ignored) {}
            var opened = checked ? current && String(current.nodeId) === String(found.nodeId) : result === 0 || result === true;
            if (!opened) { throw new Error('Premiere could not open this item in the Source Monitor.'); }
            return json({ ok: true, message: 'Opened ' + found.name + ' in the Source Monitor.' });
        } catch (e) { return json({ ok: false, error: String(e.message || e) }); }
    }
    return { index: index, insert: insert, openSource: openSource };
}());
