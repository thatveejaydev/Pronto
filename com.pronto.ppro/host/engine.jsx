/*
 * PRONTO Host Engine (ES3 / ExtendScript for Adobe Premiere Pro)
 * Built from scratch with enhanced stream detection, sequence duration fallback,
 * label colors, bin/item reveal, and trimmed audio preview metadata.
 */
var ProntoHost = (function () {
    var TICKS_PER_SECOND = 254016000000;

    function escapeString(str) {
        return '"' + String(str).replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (ch) {
            if (ch === '"') { return '\\"'; }
            if (ch === '\\') { return '\\\\'; }
            if (ch === '\n') { return '\\n'; }
            if (ch === '\r') { return '\\r'; }
            if (ch === '\t') { return '\\t'; }
            var hex = ch.charCodeAt(0).toString(16);
            return '\\u' + ('0000' + hex).slice(-4);
        }) + '"';
    }

    function encodeJson(val) {
        if (val === null || val === undefined) { return 'null'; }
        var t = typeof val;
        if (t === 'string') { return escapeString(val); }
        if (t === 'number') { return isFinite(val) ? String(val) : 'null'; }
        if (t === 'boolean') { return val ? 'true' : 'false'; }
        var out = [], i, k;
        if (val instanceof Array) {
            for (i = 0; i < val.length; i++) {
                out.push(encodeJson(val[i]));
            }
            return '[' + out.join(',') + ']';
        }
        for (k in val) {
            if (val.hasOwnProperty(k) && val[k] !== undefined) {
                out.push(escapeString(k) + ':' + encodeJson(val[k]));
            }
        }
        return '{' + out.join(',') + '}';
    }

    function okResponse(payload) {
        payload.ok = true;
        return encodeJson(payload);
    }

    function errResponse(err) {
        var msg = (err && err.message) ? err.message : String(err);
        return encodeJson({ ok: false, error: msg });
    }

    function requireProject() {
        var proj = app ? app.project : null;
        if (!proj || !proj.rootItem || !proj.documentID) {
            throw new Error('No active Premiere Pro project found. Open a project first.');
        }
        return proj;
    }

    function isBinItem(item) {
        if (!item || item.type === undefined || item.type === null) { return false; }
        if (Number(item.type) === 2) { return true; }
        if (typeof ProjectItemType !== 'undefined' && ProjectItemType.BIN !== undefined) {
            return String(item.type) === String(ProjectItemType.BIN);
        }
        return false;
    }

    function isSequenceProjectItem(item) {
        if (!item || isBinItem(item) || typeof item.isSequence !== 'function') { return false; }
        var flag = item.isSequence();
        return flag === true || flag === 1 || flag === 'true' || flag === '1';
    }

    function isClipOrFileItem(item) {
        if (!item || isBinItem(item)) { return false; }
        var n = Number(item.type);
        if (n === 1 || n === 4) { return true; }
        if (typeof ProjectItemType !== 'undefined') {
            return String(item.type) === String(ProjectItemType.CLIP) ||
                   String(item.type) === String(ProjectItemType.FILE);
        }
        return false;
    }

    function getSourceFilePath(item) {
        try {
            if (item && typeof item.getMediaPath === 'function') {
                return String(item.getMediaPath() || '');
            }
        } catch (ignored) {}
        return '';
    }

    function detectCategory(item) {
        if (isBinItem(item)) { return 'Bin'; }
        if (isSequenceProjectItem(item)) { return 'Sequence'; }
        var diskPath = getSourceFilePath(item);
        var targetName = diskPath || String(item.name || '');
        var extMatch = /\.([^.\\\/]+)$/.exec(targetName.toLowerCase());
        var ext = extMatch ? extMatch[1] : '';
        if (/^(png|jpe?g|tiff?|psd|psb|bmp|gif|webp|heic|heif|exr|dpx|tga|ai|eps|svg|ico|cin)$/.test(ext)) {
            return 'Image';
        }
        if (/^(wav|wave|mp3|aiff?|aifc|aac|m4a|flac|ogg|oga|opus|wma|ac3|caf|bwf)$/.test(ext)) {
            return 'Audio';
        }
        if (/^(mov|mp4|m4v|mxf|avi|mkv|webm|mts|m2ts|ts|mpeg|mpg|m2v|vob|r3d|braw|ari|crm|wmv|flv|3gp|mpe|m2t)$/.test(ext)) {
            return 'Video';
        }
        if (/^(mogrt|prtl|aep|aepx)$/.test(ext)) {
            return 'Graphic';
        }
        return 'Media';
    }

    function readColorLabel(item) {
        try {
            if (item && typeof item.getColorLabel === 'function') {
                var c = Number(item.getColorLabel());
                if (isFinite(c) && c >= 0 && c <= 15) { return Math.floor(c); }
            }
        } catch (ignored) {}
        return -1;
    }

    function traverseTree(container, parentTrail, callback) {
        if (!container || !container.children) { return true; }
        var total = container.children.numItems, i, child, trail;
        for (i = 0; i < total; i++) {
            child = container.children[i];
            if (!child) { continue; }
            trail = parentTrail ? (parentTrail + ' / ' + String(child.name)) : String(child.name);
            if (callback(child, parentTrail, trail) === false) { return false; }
            if (isBinItem(child)) {
                if (traverseTree(child, trail, callback) === false) { return false; }
            }
        }
        return true;
    }

    function findItemByNodeId(root, nodeId) {
        var matched = null;
        traverseTree(root, '', function (item) {
            if (String(item.nodeId) === String(nodeId)) {
                matched = item;
                return false;
            }
        });
        return matched;
    }

    function summarizeSequence(seq) {
        if (!seq) { return null; }
        return {
            id: String(seq.sequenceID),
            name: String(seq.name),
            videoTracks: seq.videoTracks ? Number(seq.videoTracks.numTracks) : 0,
            audioTracks: seq.audioTracks ? Number(seq.audioTracks.numTracks) : 0
        };
    }

    function ping() {
        try {
            var proj = requireProject();
            return okResponse({
                project: String(proj.documentID),
                projectName: String(proj.name),
                sequence: summarizeSequence(proj.activeSequence)
            });
        } catch (e) {
            return errResponse(e);
        }
    }

    function scanProject() {
        try {
            var proj = requireProject();
            var catalog = [];
            traverseTree(proj.rootItem, '', function (item, folderTrail, fullTrail) {
                var kind = detectCategory(item);
                var isBin = kind === 'Bin';
                var isSeq = kind === 'Sequence';
                var isOffline = !isBin && !isSeq && typeof item.isOffline === 'function' && !!item.isOffline();
                catalog.push({
                    id: String(item.nodeId),
                    name: String(item.name),
                    folder: folderTrail,
                    path: fullTrail,
                    kind: kind,
                    offline: isOffline,
                    color: readColorLabel(item),
                    insertable: !isBin && (isSeq || isClipOrFileItem(item))
                });
            });
            return okResponse({
                project: String(proj.documentID),
                projectName: String(proj.name),
                version: app && app.version ? String(app.version) : '',
                sequence: summarizeSequence(proj.activeSequence),
                items: catalog
            });
        } catch (e) {
            return errResponse(e);
        }
    }

    function resolveSequenceObject(proj, seqProjectItem) {
        var list = proj.sequences, i, s;
        if (list) {
            for (i = 0; i < list.numSequences; i++) {
                s = list[i];
                if (s && s.projectItem && String(s.projectItem.nodeId) === String(seqProjectItem.nodeId)) {
                    return s;
                }
            }
        }
        throw new Error('Sequence is no longer available in this project. Refresh the search.');
    }

    function assertNoCircularNesting(proj, candidateSeq, targetSeq, seenMap) {
        var key = 'seq_' + String(candidateSeq.sequenceID);
        if (String(candidateSeq.sequenceID) === String(targetSeq.sequenceID)) {
            throw new Error('Cannot nest a sequence inside itself (direct or indirect circular nesting).');
        }
        if (seenMap[key]) { return; }
        seenMap[key] = true;
        var groups = [candidateSeq.videoTracks, candidateSeq.audioTracks], g, t, c, clipItem;
        for (g = 0; g < groups.length; g++) {
            if (!groups[g]) { continue; }
            for (t = 0; t < groups[g].numTracks; t++) {
                for (c = 0; c < groups[g][t].clips.numItems; c++) {
                    clipItem = groups[g][t].clips[c].projectItem;
                    if (isSequenceProjectItem(clipItem)) {
                        assertNoCircularNesting(proj, resolveSequenceObject(proj, clipItem), targetSeq, seenMap);
                    }
                }
            }
        }
    }

    function computeSpanSeconds(proj, item, destSequence, category) {
        var longest = 0, streamTypes = [4, 1, 2], i, inSec, outSec;
        for (i = 0; i < streamTypes.length; i++) {
            try {
                inSec = Number(item.getInPoint(streamTypes[i]).seconds);
                outSec = Number(item.getOutPoint(streamTypes[i]).seconds);
                if (isFinite(inSec) && isFinite(outSec) && inSec >= 0 && outSec > inSec) {
                    if (outSec - inSec > longest) { longest = outSec - inSec; }
                }
            } catch (ignored) {}
        }
        if (!(longest > 0) && category === 'Sequence') {
            try {
                var seqObj = resolveSequenceObject(proj, item);
                var endTicks = Number(seqObj.end);
                var zeroTicks = Number(seqObj.zeroPoint || 0);
                if (isFinite(endTicks) && endTicks > zeroTicks) {
                    longest = (endTicks - zeroTicks) / TICKS_PER_SECOND;
                }
            } catch (ignoredSeq) {}
        }
        if (!(longest > 0) && category === 'Image') {
            try {
                if (app.properties && typeof app.properties.getProperty === 'function') {
                    var prefTicks = Number(app.properties.getProperty('BE.Prefs.StillImages.DefaultDuration'));
                    if (isFinite(prefTicks) && prefTicks > 0) {
                        longest = prefTicks / TICKS_PER_SECOND;
                    }
                }
            } catch (ignoredPref) {}
        }
        if (!(longest > 0)) {
            throw new Error('Cannot determine source duration safely. Set source In/Out points and retry.');
        }
        var frameSec = Number(destSequence.timebase) / TICKS_PER_SECOND;
        if (!(frameSec > 0)) {
            throw new Error('Cannot read active timeline frame rate.');
        }
        return Math.ceil(longest / frameSec - 1e-7) * frameSec;
    }

    function isTrackIntervalEmpty(track, startSec, endSec) {
        var lists = [track.clips, track.transitions], l, i, collection, s, e;
        for (l = 0; l < lists.length; l++) {
            collection = lists[l];
            if (!collection) {
                throw new Error('Cannot inspect timeline track items safely.');
            }
            for (i = 0; i < collection.numItems; i++) {
                s = Number(collection[i].start.seconds);
                e = Number(collection[i].end.seconds);
                if (!isFinite(s) || !isFinite(e)) {
                    throw new Error('Cannot read timeline clip bounds.');
                }
                if (s < endSec - 1e-8 && e > startSec + 1e-8) {
                    return false;
                }
            }
        }
        return true;
    }

    function locateFreeTrack(trackCollection, spanTracks, startSec, endSec) {
        var total = trackCollection.numTracks, order = [], isTargetedMap = {}, lowestTarget = -1, i, j, idx, requiredWidth, allClear;
        for (i = 0; i < total; i++) {
            if (trackCollection[i].isTargeted && trackCollection[i].isTargeted()) {
                if (lowestTarget < 0) { lowestTarget = i; }
                isTargetedMap[i] = true;
                order.push(i);
            }
        }
        for (i = (lowestTarget < 0 ? 0 : lowestTarget); i < total; i++) {
            if (!isTargetedMap[i]) {
                order.push(i);
            }
        }
        for (i = 0; i < order.length; i++) {
            idx = order[i];
            requiredWidth = (spanTracks === null) ? (total - idx) : spanTracks;
            if (idx + requiredWidth > total) { continue; }
            allClear = true;
            for (j = idx; j < idx + requiredWidth; j++) {
                if (!isTrackIntervalEmpty(trackCollection[j], startSec, endSec)) {
                    allClear = false;
                    break;
                }
            }
            if (allClear) { return idx; }
        }
        return -1;
    }

    function isTargetTrack(group, trackIndex, videoTrack, audioTrack, audioWidth) {
        if (group === 0) {
            return videoTrack >= 0 && trackIndex === videoTrack;
        }
        if (audioTrack < 0 || trackIndex < audioTrack) {
            return false;
        }
        return audioWidth === null || trackIndex < audioTrack + audioWidth;
    }

    function captureTimelineSnapshot(sequence, videoTrack, audioTrack, audioWidth) {
        var clips = [], trackCounts = {}, groups = [sequence.videoTracks, sequence.audioTracks], g, t, c, trackClips, clip;
        for (g = 0; g < groups.length; g++) {
            for (t = 0; t < groups[g].numTracks; t++) {
                trackClips = groups[g][t].clips;
                if (!isTargetTrack(g, t, videoTrack, audioTrack, audioWidth)) {
                    trackCounts[g + ':' + t] = trackClips ? trackClips.numItems : 0;
                    continue;
                }
                for (c = 0; c < trackClips.numItems; c++) {
                    clip = trackClips[c];
                    clips.push({
                        id: String(clip.nodeId),
                        sourceId: clip.projectItem ? String(clip.projectItem.nodeId) : '',
                        group: g,
                        track: t,
                        start: Number(clip.start.seconds),
                        end: Number(clip.end.seconds)
                    });
                }
            }
        }
        return { clips: clips, trackCounts: trackCounts };
    }

    function auditTimelineEdit(beforeSnap, afterSnap, itemNodeId, expectedStart, videoTrack, audioTrack, audioWidth, toleranceSec) {
        var existingById = {}, afterById = {}, beforeClips = beforeSnap.clips, afterClips = afterSnap.clips, key, i, item, addedCount = 0, misplacedCount = 0;
        for (key in beforeSnap.trackCounts) {
            if (beforeSnap.trackCounts.hasOwnProperty(key)) {
                if (afterSnap.trackCounts[key] !== beforeSnap.trackCounts[key]) {
                    misplacedCount++;
                }
            }
        }
        for (i = 0; i < beforeClips.length; i++) {
            existingById['k_' + beforeClips[i].id] = beforeClips[i];
        }
        for (i = 0; i < afterClips.length; i++) {
            item = afterClips[i];
            afterById['k_' + item.id] = item;
            if (existingById['k_' + item.id]) { continue; }
            addedCount++;
            var badSource = item.sourceId !== itemNodeId;
            var badStart = Math.abs(item.start - expectedStart) > toleranceSec || !(item.end > item.start);
            var badVideo = item.group === 0 && item.track !== videoTrack;
            var badAudio = item.group === 1 && (audioTrack < 0 || item.track < audioTrack || (audioWidth !== null && item.track >= audioTrack + audioWidth));
            if (badSource || badStart || badVideo || badAudio) {
                misplacedCount++;
            }
        }
        if (addedCount === 0) {
            throw new Error('Premiere created no timeline clip. Ensure the destination tracks are unlocked and compatible with this media.');
        }
        if (misplacedCount > 0) {
            throw new Error('Premiere placed the clip on unexpected tracks or timecode. Use Undo (Ctrl+Z) and inspect the timeline.');
        }
        for (i = 0; i < beforeClips.length; i++) {
            var prev = beforeClips[i];
            var curr = afterById['k_' + prev.id];
            if (!curr || curr.start !== prev.start || curr.end !== prev.end || curr.track !== prev.track || curr.group !== prev.group) {
                throw new Error('An existing timeline clip was modified during placement. Use Undo (Ctrl+Z) and inspect the timeline.');
            }
        }
    }

    function resolveStreamRequirements(item, category) {
        var isSeq = category === 'Sequence';
        var audioWidth = null, mapping;
        try {
            mapping = item.getAudioChannelMapping;
            if (typeof mapping === 'function') { mapping = mapping.call(item); }
            if (mapping && typeof mapping.audioClipsNumber === 'number' &&
                isFinite(mapping.audioClipsNumber) &&
                mapping.audioClipsNumber >= 0 &&
                mapping.audioClipsNumber === Math.floor(mapping.audioClipsNumber)) {
                audioWidth = mapping.audioClipsNumber;
            }
        } catch (ignored) {}

        var diskPath = getSourceFilePath(item);
        if (!isSeq && audioWidth === null && /\.(png|jpe?g|tiff?|psd|psb|bmp|gif|webp|heic|heif|exr|dpx|tga|ai|eps|svg|ico|cin|prtl)$/i.test(diskPath)) {
            audioWidth = 0;
        }
        var audioOnly = !isSeq && category === 'Audio';
        if (audioOnly && audioWidth === 0) {
            audioWidth = null;
        }
        return {
            needsVideo: !audioOnly,
            needsAudio: audioWidth !== 0,
            audioWidth: audioWidth
        };
    }

    function selectInProjectPanel(projectId, nodeId) {
        try {
            var proj = requireProject();
            if (String(proj.documentID) !== String(projectId)) {
                throw new Error('Active project changed. Refresh the search.');
            }
            var target = findItemByNodeId(proj.rootItem, nodeId);
            if (!target) {
                throw new Error('This item is no longer in the project. Refresh the search.');
            }
            if (!app.getProjectViewIDs || !app.getProjectFromViewID || !app.setProjectViewSelection || !app.getProjectViewSelection) {
                throw new Error('Project panel selection API is unavailable in this Premiere version.');
            }
            var viewIds = app.getProjectViewIDs(), i, j, viewProj, currentSel, verified;
            for (i = 0; viewIds && i < viewIds.length; i++) {
                viewProj = app.getProjectFromViewID(viewIds[i]);
                if (!viewProj || String(viewProj.documentID) !== String(projectId)) { continue; }
                app.setProjectViewSelection([target], viewIds[i]);
                currentSel = app.getProjectViewSelection(viewIds[i]);
                verified = false;
                for (j = 0; currentSel && j < currentSel.length; j++) {
                    if (String(currentSel[j].nodeId) === String(nodeId)) {
                        verified = true;
                        break;
                    }
                }
                if (verified) {
                    return okResponse({
                        action: 'revealed',
                        message: 'Highlighted "' + target.name + '" in the Project panel.'
                    });
                }
            }
            throw new Error('Open the Project panel for this project first, then retry.');
        } catch (e) {
            return errResponse(e);
        }
    }

    function placeItem(projectId, sequenceId, nodeId) {
        try {
            var proj = requireProject();
            if (String(proj.documentID) !== String(projectId)) {
                throw new Error('Active project changed. Refresh before placing media.');
            }
            var targetItem = findItemByNodeId(proj.rootItem, nodeId);
            if (!targetItem) {
                throw new Error('Item was removed from the project. Refresh the search.');
            }
            var category = detectCategory(targetItem);
            if (category === 'Bin') {
                return selectInProjectPanel(projectId, nodeId);
            }
            var seq = proj.activeSequence;
            if (!seq) {
                throw new Error('Open a timeline sequence first, then retry.');
            }
            if (String(seq.sequenceID) !== String(sequenceId)) {
                throw new Error('Active timeline changed. Refresh before placing media.');
            }
            var isSeq = category === 'Sequence';
            if (!isSeq && !isClipOrFileItem(targetItem)) {
                throw new Error('Only media clips and sequences can be placed on the timeline.');
            }
            if (isSeq) {
                assertNoCircularNesting(proj, resolveSequenceObject(proj, targetItem), seq, {});
            }
            if (!isSeq && typeof targetItem.isOffline === 'function' && targetItem.isOffline()) {
                throw new Error('Media is offline. Relink the file before placing it.');
            }

            var playhead = seq.getPlayerPosition();
            var startSec = Number(playhead.seconds);
            if (!isFinite(startSec) || startSec < 0) {
                throw new Error('Cannot read the playhead position.');
            }
            var clipSpan = computeSpanSeconds(proj, targetItem, seq, category);
            var endSec = startSec + clipSpan;
            var streams = resolveStreamRequirements(targetItem, category);

            var vTrack = streams.needsVideo ? locateFreeTrack(seq.videoTracks, 1, startSec, endSec) : -1;
            var aTrack = streams.needsAudio ? locateFreeTrack(seq.audioTracks, streams.audioWidth, startSec, endSec) : -1;

            if ((streams.needsVideo && vTrack < 0) || (streams.needsAudio && aTrack < 0)) {
                var neededKind = !streams.needsVideo ? 'audio' : (!streams.needsAudio ? 'video' : 'video/audio');
                throw new Error('No free track space for the full clip duration. Add an empty ' + neededKind + ' track and retry.');
            }

            var beforeSnap = captureTimelineSnapshot(seq, vTrack, aTrack, streams.audioWidth);
            seq.overwriteClip(targetItem, playhead, streams.needsVideo ? vTrack : 0, streams.needsAudio ? aTrack : 0);
            var halfFrameTolerance = (Number(seq.timebase) / TICKS_PER_SECOND) / 2;
            auditTimelineEdit(beforeSnap, captureTimelineSnapshot(seq, vTrack, aTrack, streams.audioWidth), String(targetItem.nodeId), startSec, vTrack, aTrack, streams.audioWidth, halfFrameTolerance);

            var trackSummary = (streams.needsVideo ? ('V' + (vTrack + 1)) : '') +
                               (streams.needsAudio ? ((streams.needsVideo ? '/' : '') + 'A' + (aTrack + 1)) : '');
            return okResponse({
                action: 'placed',
                video: vTrack,
                audio: aTrack,
                message: 'Placed ' + targetItem.name + ' on ' + trackSummary + '.'
            });
        } catch (e) {
            return errResponse(e);
        }
    }

    function openItem(projectId, nodeId, mode) {
        try {
            var proj = requireProject();
            if (String(proj.documentID) !== String(projectId)) {
                throw new Error('Active project changed. Refresh the search.');
            }
            var found = findItemByNodeId(proj.rootItem, nodeId);
            if (!found) {
                throw new Error('Item was removed from the project. Refresh the search.');
            }
            if (isBinItem(found) || mode === 'reveal') {
                return selectInProjectPanel(projectId, nodeId);
            }
            if (isSequenceProjectItem(found) && mode !== 'source') {
                var targetSeq = resolveSequenceObject(proj, found);
                proj.openSequence(String(targetSeq.sequenceID));
                if (!proj.activeSequence || String(proj.activeSequence.sequenceID) !== String(targetSeq.sequenceID)) {
                    throw new Error('Premiere could not switch to this sequence in the timeline.');
                }
                return okResponse({
                    action: 'openedSequence',
                    message: 'Opened sequence "' + found.name + '" in the timeline.'
                });
            }
            if (typeof found.isOffline === 'function' && found.isOffline()) {
                throw new Error('Relink this offline media before opening it.');
            }
            var rawResult = app.sourceMonitor.openProjectItem(found);
            var currentItem = null, verifiedReadback = false;
            try {
                currentItem = app.sourceMonitor.getProjectItem();
                verifiedReadback = true;
            } catch (ignored) {}
            var success = verifiedReadback
                ? (currentItem && String(currentItem.nodeId) === String(found.nodeId))
                : (rawResult === 0 || rawResult === true);
            if (!success) {
                throw new Error('Premiere could not open this item in the Source Monitor.');
            }
            return okResponse({
                action: 'openedSource',
                message: 'Opened "' + found.name + '" in the Source Monitor.'
            });
        } catch (e) {
            return errResponse(e);
        }
    }

    function resolveAudio(projectId, nodeId) {
        try {
            var proj = requireProject();
            if (String(proj.documentID) !== String(projectId)) {
                throw new Error('Active project changed. Refresh the search.');
            }
            var found = findItemByNodeId(proj.rootItem, nodeId);
            if (!found) {
                throw new Error('Audio item was removed from the project. Refresh the search.');
            }
            if (detectCategory(found) !== 'Audio' || (typeof found.isOffline === 'function' && found.isOffline())) {
                throw new Error('Select an online audio clip to preview.');
            }
            var filePath = getSourceFilePath(found);
            if (!filePath) {
                throw new Error('No local audio file path available. Use Shift+Enter to open in the Source Monitor.');
            }
            var startSec = 0, endSec = 0;
            try {
                var aIn = Number(found.getInPoint(2).seconds);
                if (isFinite(aIn) && aIn > 0) { startSec = aIn; }
            } catch (ignoredIn) {}
            try {
                var aOut = Number(found.getOutPoint(2).seconds);
                if (isFinite(aOut) && aOut > startSec) { endSec = aOut; }
            } catch (ignoredOut) {}
            return okResponse({
                path: filePath,
                inPoint: startSec,
                outPoint: endSec
            });
        } catch (e) {
            return errResponse(e);
        }
    }

    return {
        ping: ping,
        scanProject: scanProject,
        placeItem: placeItem,
        openItem: openItem,
        selectInProjectPanel: selectInProjectPanel,
        resolveAudio: resolveAudio
    };
}());
