/*
 * PRONTO Search Palette Controller
 */
(function () {
    'use strict';

    var byId = function (id) { return document.getElementById(id); };
    var cepBridge = window.__adobe_cep__ || null;

    var catalogData = null;
    var compiledCatalog = null;
    var visibleMatches = [];
    var activeIndex = 0;
    var isActionBusy = false;
    var isScanning = false;
    var isPinging = false;
    var queuedAction = null;
    var pendingAutoPreview = false;
    var lastScannedAt = 0;
    var sessionGen = 0;
    var lastWindowHeight = 0;

    var activeCategory = 'All';
    var browseRecentsOnEmpty = false;
    var autoPreviewEnabled = false;
    var previewItemId = null;
    var previewPlayState = 'stopped';
    var previewProgress = 0;
    var previewKeyConfig = ProntoKeys.preview('Ctrl+Space');

    var AUTO_PREVIEW_KEY = 'pronto.autoPreview';
    var RECENTS_PREFIX = 'pronto.recents.';

    function parseCepEvent(raw) {
        if (!raw) { return {}; }
        if (typeof raw === 'string') {
            try { return JSON.parse(raw); } catch (ignored) { return { data: raw }; }
        }
        return raw;
    }

    function isAutoPreviewActive() {
        try {
            if (typeof localStorage !== 'undefined') {
                var val = localStorage.getItem(AUTO_PREVIEW_KEY);
                if (val === 'true' || val === 'false') {
                    autoPreviewEnabled = (val === 'true');
                }
            }
        } catch (ignored) {}
        return autoPreviewEnabled;
    }
    isAutoPreviewActive();

    function registerPreviewKeyInterest() {
        if (!cepBridge || !cepBridge.registerKeyEventsInterest) { return; }
        if (!previewKeyConfig) {
            cepBridge.registerKeyEventsInterest('');
            return;
        }
        cepBridge.registerKeyEventsInterest(JSON.stringify([{
            keyCode: previewKeyConfig.key,
            ctrlKey: !!(previewKeyConfig.modifiers & 2),
            altKey: !!(previewKeyConfig.modifiers & 1),
            shiftKey: !!(previewKeyConfig.modifiers & 4),
            metaKey: false
        }]));
        var kbd = byId('preview-kbd');
        if (kbd) { kbd.textContent = previewKeyConfig.label; }
    }
    registerPreviewKeyInterest();

    function loadRecents(projectId) {
        if (!projectId || typeof localStorage === 'undefined') {
            return { ids: [], meta: {} };
        }
        try {
            var raw = JSON.parse(localStorage.getItem(RECENTS_PREFIX + projectId) || 'null');
            if (raw && Array.isArray(raw.ids) && raw.counts) {
                var meta = {};
                for (var i = 0; i < raw.ids.length; i++) {
                    var id = raw.ids[i];
                    meta[id] = { count: raw.counts[id] || 1, rank: i };
                }
                return { ids: raw.ids, counts: raw.counts, meta: meta };
            }
        } catch (ignored) {}
        return { ids: [], counts: {}, meta: {} };
    }

    function recordRecentItem(projectId, itemId) {
        if (!projectId || !itemId || typeof localStorage === 'undefined') { return; }
        try {
            var store = loadRecents(projectId);
            var counts = store.counts || {};
            counts[itemId] = (counts[itemId] || 0) + 1;
            var ids = [itemId];
            for (var i = 0; i < store.ids.length && ids.length < 15; i++) {
                if (store.ids[i] !== itemId) { ids.push(store.ids[i]); }
            }
            localStorage.setItem(RECENTS_PREFIX + projectId, JSON.stringify({ ids: ids, counts: counts }));
        } catch (ignored) {}
    }

    function serializeArg(val) {
        return JSON.stringify(val).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    }

    function invokeHost(method, args, callback) {
        if (!cepBridge) {
            callback(new Error('Open PRONTO inside Adobe Premiere Pro.'));
            return;
        }
        try {
            var expr = 'ProntoHost.' + method + '(' + (args || []).map(serializeArg).join(',') + ')';
            cepBridge.evalScript(expr, function (rawOutput) {
                var parsed;
                try {
                    parsed = JSON.parse(rawOutput);
                    if (!parsed.ok) { throw new Error(parsed.error); }
                } catch (err) {
                    var extra = rawOutput === 'EvalScript error.' ? ' Reopen the extension to reload engine.jsx.' : '';
                    callback(new Error((err.message || String(err)) + extra));
                    return;
                }
                callback(null, parsed);
            });
        } catch (e) {
            callback(e);
        }
    }

    var audioPlayer = ProntoAudioPlayer.create(
        invokeHost,
        function (id, state, progress) {
            previewItemId = id;
            previewPlayState = state;
            previewProgress = progress || 0;
            visibleMatches.forEach(function (item, idx) {
                var btn = byId('preview-' + idx);
                var bar = byId('progress-' + idx);
                var isActive = item.id === id && (state === 'playing' || state === 'loading' || state === 'paused');
                var isRunning = item.id === id && (state === 'playing' || state === 'loading');
                if (btn) {
                    btn.textContent = isRunning ? (state === 'loading' ? '…' : 'Ⅱ') : '▶';
                    btn.setAttribute('aria-label', (isRunning ? 'Pause ' : 'Preview ') + item.name);
                    btn.setAttribute('aria-pressed', String(isRunning));
                }
                if (bar) {
                    bar.style.width = isActive ? Math.round(previewProgress * 100) + '%' : '0%';
                    bar.hidden = !isActive;
                }
            });
        },
        function (errMsg) {
            showStatus(errMsg, true);
            adjustWindowSize();
        },
        function () { return new Audio(); }
    );

    function toggleAudioPreview() {
        if (isActionBusy || !catalogData) { return; }
        if (isPinging) {
            queuedAction = toggleAudioPreview;
            return;
        }
        var current = visibleMatches[activeIndex];
        if (!current || current.kind !== 'Audio' || current.offline) { return; }
        showStatus('', false);
        adjustWindowSize();
        audioPlayer.toggle(catalogData.project, current);
    }

    function maybeAutoPreviewSelected() {
        if (!isAutoPreviewActive() || !isExpandedState() || isActionBusy) { return; }
        if (document.hidden) { return; }
        var current = visibleMatches[activeIndex];
        if (!current || current.kind !== 'Audio' || current.offline) { return; }
        if (!catalogData) { return; }
        if (isPinging) {
            pendingAutoPreview = true;
            return;
        }
        pendingAutoPreview = false;
        showStatus('', false);
        adjustWindowSize();
        if (audioPlayer.play) {
            audioPlayer.play(catalogData.project, current);
        } else {
            audioPlayer.toggle(catalogData.project, current);
        }
    }

    function showStatus(msg, isError) {
        var el = byId('status');
        if (!el) { return; }
        el.textContent = isError ? msg : '';
        el.className = isError ? 'status-banner error' : 'status-banner';
        el.hidden = !isError;
    }

    function setBusyFlag(val) {
        isActionBusy = val;
        var list = byId('results');
        if (list) { list.setAttribute('aria-busy', String(val || isScanning)); }
    }

    function isExpandedState() {
        var hasText = !!byId('query').value.trim();
        return hasText || activeCategory !== 'All' || browseRecentsOnEmpty;
    }

    function adjustWindowSize() {
        var expanded = isExpandedState();
        var hasError = !byId('status').hidden;
        var targetHeight = 60;
        if (hasError && !expanded) {
            targetHeight = 165;
        } else if (expanded) {
            var rows = Math.min(Math.max(visibleMatches.length, 1), 7);
            targetHeight = 148 + (rows * 52) + (hasError ? 42 : 0);
        }
        if (targetHeight === lastWindowHeight && Math.abs(window.innerHeight - targetHeight) < 3) {
            return;
        }
        try {
            if (cepBridge && cepBridge.resizeContent) {
                cepBridge.resizeContent(460, targetHeight);
            }
            lastWindowHeight = targetHeight;
        } catch (ignored) {
            lastWindowHeight = 0;
        }
    }

    function renderFilterPills() {
        var bar = byId('filter-bar');
        if (!bar || !bar.children) { return; }
        for (var i = 0; i < bar.children.length; i++) {
            var btn = bar.children[i];
            var cat = btn.getAttribute && btn.getAttribute('data-category');
            btn.setAttribute('aria-pressed', String(cat === activeCategory));
        }
    }

    function renderResults() {
        var list = byId('results');
        var expanded = isExpandedState();
        list.textContent = '';
        list.hidden = !expanded || visibleMatches.length === 0;
        byId('count').hidden = !expanded;
        if (byId('filter-bar')) { byId('filter-bar').hidden = !expanded; }
        if (byId('footer-hints')) { byId('footer-hints').hidden = !expanded || visibleMatches.length === 0; }
        byId('query').setAttribute('aria-expanded', String(expanded && visibleMatches.length > 0));

        var iconMap = {
            Bin: 'bin',
            Sequence: 'sequence',
            Image: 'image',
            Video: 'video',
            Audio: 'audio',
            Graphic: 'graphic'
        };

        visibleMatches.forEach(function (item, idx) {
            var li = document.createElement('li');
            var icon = document.createElement('span');
            var titleWrap = document.createElement('div');
            var title = document.createElement('strong');
            var detail = document.createElement('span');

            icon.className = 'result-icon ' + (iconMap[item.kind] || 'media') + '-icon';
            icon.setAttribute('aria-hidden', 'true');

            titleWrap.className = 'result-title-row';
            if (typeof item.color === 'number' && item.color >= 0 && item.color <= 15) {
                var dot = document.createElement('span');
                dot.className = 'label-dot';
                dot.style.background = 'var(--label-' + item.color + ')';
                dot.setAttribute('aria-hidden', 'true');
                titleWrap.appendChild(dot);
            }
            title.textContent = item.name;
            titleWrap.appendChild(title);

            detail.className = 'result-detail';
            detail.textContent = item.kind + (item.offline ? ' · OFFLINE' : '') + ' · ' + item.path;

            li.id = 'result-' + idx;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-selected', String(idx === activeIndex));
            li.title = item.path;

            li.appendChild(icon);
            li.appendChild(titleWrap);
            li.appendChild(detail);

            if (item.kind === 'Audio' && !item.offline) {
                var playBtn = document.createElement('button');
                playBtn.id = 'preview-' + idx;
                playBtn.className = 'preview-button';
                playBtn.type = 'button';
                var isPlaying = previewItemId === item.id && (previewPlayState === 'playing' || previewPlayState === 'loading');
                playBtn.textContent = isPlaying ? (previewPlayState === 'loading' ? '…' : 'Ⅱ') : '▶';
                playBtn.setAttribute('aria-pressed', String(isPlaying));
                playBtn.title = 'Preview audio' + (previewKeyConfig ? ' (' + previewKeyConfig.label + ')' : '');
                playBtn.setAttribute('aria-label', (isPlaying ? 'Pause ' : 'Preview ') + item.name);
                playBtn.addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                    if (isActionBusy || ev.detail > 1) { return; }
                    selectRow(idx, true);
                    byId('query').focus();
                    toggleAudioPreview();
                });
                li.appendChild(playBtn);

                var progress = document.createElement('div');
                progress.id = 'progress-' + idx;
                progress.className = 'preview-progress';
                var showBar = previewItemId === item.id && previewPlayState !== 'stopped';
                progress.style.width = showBar ? Math.round(previewProgress * 100) + '%' : '0%';
                progress.hidden = !showBar;
                li.appendChild(progress);
            }

            li.addEventListener('click', function (ev) {
                if (isActionBusy || ev.detail > 1) { return; }
                selectRow(idx, true);
                byId('query').focus();
                if (ev.altKey) {
                    executeOpen('reveal');
                } else if (ev.shiftKey) {
                    executeOpen(ev.ctrlKey ? 'source' : 'default');
                } else {
                    executePlace();
                }
            });

            list.appendChild(li);
        });

        if (visibleMatches.length > 0) {
            byId('query').setAttribute('aria-activedescendant', 'result-' + activeIndex);
        } else {
            byId('query').removeAttribute('aria-activedescendant');
        }
        adjustWindowSize();
    }

    function selectRow(nextIndex, suppressAutoPreview) {
        if (nextIndex !== activeIndex) {
            audioPlayer.stop();
        }
        var prevEl = byId('result-' + activeIndex);
        if (prevEl) { prevEl.setAttribute('aria-selected', 'false'); }
        activeIndex = nextIndex;
        var nextEl = byId('result-' + activeIndex);
        if (nextEl) {
            nextEl.setAttribute('aria-selected', 'true');
            byId('query').setAttribute('aria-activedescendant', 'result-' + activeIndex);
        }
        if (!suppressAutoPreview) {
            maybeAutoPreviewSelected();
        }
    }

    function runFilter(preserveSelection) {
        var prevSelectedId = preserveSelection && visibleMatches[activeIndex] ? visibleMatches[activeIndex].id : null;
        if (!preserveSelection) {
            audioPlayer.stop();
        }
        var rawQuery = byId('query').value;
        var expanded = isExpandedState();
        var recents = catalogData ? loadRecents(catalogData.project) : { ids: [], meta: {} };

        var allFiltered = (expanded && catalogData)
            ? ProntoMatcher.queryItems(catalogData.items, rawQuery, compiledCatalog, {
                category: activeCategory,
                showRecentsWhenEmpty: browseRecentsOnEmpty,
                recentIds: recents.ids,
                recentsMeta: recents.meta
            })
            : [];

        visibleMatches = allFiltered.slice(0, 100);
        activeIndex = 0;

        if (prevSelectedId) {
            for (var i = 0; i < visibleMatches.length; i++) {
                if (visibleMatches[i].id === prevSelectedId) {
                    activeIndex = i;
                    break;
                }
            }
            if (!visibleMatches[activeIndex] || visibleMatches[activeIndex].id !== prevSelectedId || visibleMatches[activeIndex].offline) {
                audioPlayer.stop();
            }
        }

        var countText = '';
        if (isScanning && !catalogData) {
            countText = 'Scanning project…';
        } else if (activeCategory === 'Recent' || (browseRecentsOnEmpty && !rawQuery.trim())) {
            countText = allFiltered.length ? ('Recent items (' + allFiltered.length + ')') : 'No recent items in this project yet';
        } else if (allFiltered.length > 0) {
            countText = allFiltered.length + (allFiltered.length === 1 ? ' match' : ' matches') +
                        (allFiltered.length > 100 ? ' · showing top 100' : '');
        } else {
            countText = 'No matches';
        }
        byId('count').textContent = countText;
        renderFilterPills();
        renderResults();
        maybeAutoPreviewSelected();
    }

    function resetSessionUI() {
        audioPlayer.stop();
        if (isActionBusy) { return; }
        isAutoPreviewActive();
        queuedAction = null;
        pendingAutoPreview = false;
        visibleMatches = [];
        activeIndex = 0;
        activeCategory = 'All';
        browseRecentsOnEmpty = false;
        byId('query').value = '';
        showStatus('', false);
        setBusyFlag(false);
        runFilter(false);
        byId('query').focus();
    }

    function scanCatalog(inBackground) {
        if (isActionBusy || isScanning) { return; }
        var reqGen = sessionGen;
        isScanning = true;
        if (!inBackground) { showStatus('', false); }
        if (!catalogData) { runFilter(false); }

        setTimeout(function () {
            if (reqGen !== sessionGen) { return; }
            invokeHost('scanProject', [], function (err, res) {
                if (reqGen !== sessionGen) { return; }
                isScanning = false;
                if (!err && res) {
                    compiledCatalog = ProntoMatcher.compileIndex(res.items);
                    catalogData = res;
                    lastScannedAt = Date.now();
                }
                setBusyFlag(isActionBusy);
                if (!inBackground || !catalogData) {
                    showStatus(err ? err.message : '', !!err);
                }
                if (!isActionBusy) {
                    runFilter(true);
                }
            });
        }, 0);
    }

    function verifyHostContext() {
        if (isActionBusy || isPinging || isScanning) { return; }
        isPinging = true;
        invokeHost('ping', [], function (err, stateInfo) {
            isPinging = false;
            if (err || (catalogData && catalogData.project !== stateInfo.project)) {
                sessionGen++;
                catalogData = null;
                compiledCatalog = null;
                lastScannedAt = 0;
                queuedAction = null;
                pendingAutoPreview = false;
                audioPlayer.stop();
                runFilter(false);
            }
            if (err) {
                showStatus(err.message, isExpandedState());
                adjustWindowSize();
                return;
            }
            if (catalogData) {
                catalogData.sequence = stateInfo.sequence;
            }
            if (queuedAction) {
                var pendingFn = queuedAction;
                queuedAction = null;
                pendingAutoPreview = false;
                pendingFn();
            } else if (pendingAutoPreview) {
                pendingAutoPreview = false;
                maybeAutoPreviewSelected();
            }
            if (!catalogData || (Date.now() - lastScannedAt >= 30000)) {
                scanCatalog(true);
            }
        });
    }

    function handleReopen() {
        resetSessionUI();
        verifyHostContext();
    }

    function dismissPalette() {
        if (!isActionBusy && cepBridge) {
            resetSessionUI();
            cepBridge.closeExtension();
        }
    }

    function executeOpen(mode) {
        audioPlayer.stop();
        if (isActionBusy || !isExpandedState()) { return; }
        if (isPinging) {
            queuedAction = function () { executeOpen(mode); };
            return;
        }
        var target = visibleMatches[activeIndex];
        if (!target || !catalogData) { return; }
        setBusyFlag(true);
        showStatus('', false);
        invokeHost('openItem', [catalogData.project, target.id, mode || 'default'], function (err) {
            setBusyFlag(false);
            if (err) {
                showStatus(err.message, true);
                adjustWindowSize();
                byId('query').focus();
            } else {
                recordRecentItem(catalogData.project, target.id);
                dismissPalette();
            }
        });
    }

    function executePlace() {
        audioPlayer.stop();
        if (isActionBusy || !isExpandedState()) { return; }
        if (isPinging) {
            queuedAction = executePlace;
            return;
        }
        var target = visibleMatches[activeIndex];
        if (target && catalogData && target.kind === 'Bin') {
            executeOpen('reveal');
            return;
        }
        if (!target || !catalogData || !catalogData.sequence) {
            showStatus('Select an item and open a timeline sequence, then press Ctrl+R to refresh.', true);
            adjustWindowSize();
            return;
        }
        if (!target.insertable || target.offline) {
            showStatus('Select online media or a sequence to place on the timeline.', true);
            adjustWindowSize();
            return;
        }
        setBusyFlag(true);
        showStatus('Placing…', false);
        invokeHost('placeItem', [catalogData.project, catalogData.sequence.id, target.id], function (err, res) {
            setBusyFlag(false);
            showStatus(err ? err.message : res.message, !!err);
            adjustWindowSize();
            byId('query').focus();
            if (!err) {
                recordRecentItem(catalogData.project, target.id);
                dismissPalette();
            }
        });
    }

    // Bind UI events
    byId('query').addEventListener('input', function () {
        if (byId('query').value.trim()) {
            browseRecentsOnEmpty = false;
            if (activeCategory === 'Recent') { activeCategory = 'All'; }
        }
        showStatus('', false);
        runFilter(false);
        if (isExpandedState() && !catalogData && !isScanning) {
            scanCatalog(false);
        }
    });

    byId('query').addEventListener('keydown', function (ev) {
        if (ev.isComposing || ev.keyCode === 229) { return; }
        if (previewKeyConfig && ProntoKeys.matches(ev, previewKeyConfig)) {
            ev.preventDefault();
            if (ev.stopPropagation) { ev.stopPropagation(); }
            if (!ev.repeat) { toggleAudioPreview(); }
            return;
        }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            if (!isExpandedState() && ev.key === 'ArrowDown' && catalogData) {
                browseRecentsOnEmpty = true;
                runFilter(false);
                return;
            }
            if (visibleMatches.length > 0) {
                var delta = ev.key === 'ArrowDown' ? 1 : -1;
                var next = Math.max(0, Math.min(visibleMatches.length - 1, activeIndex + delta));
                selectRow(next, false);
                var rowEl = byId('result-' + activeIndex);
                if (rowEl && rowEl.scrollIntoView) { rowEl.scrollIntoView({ block: 'nearest' }); }
            }
        } else if (ev.key === 'Enter') {
            ev.preventDefault();
            if (!ev.repeat) {
                if (ev.altKey) {
                    executeOpen('reveal');
                } else if (ev.shiftKey) {
                    executeOpen(ev.ctrlKey ? 'source' : 'default');
                } else {
                    executePlace();
                }
            }
        } else if (ev.key === 'Escape') {
            ev.preventDefault();
            dismissPalette();
        }
    });

    if (byId('filter-bar') && byId('filter-bar').children) {
        var pills = byId('filter-bar').children;
        for (var p = 0; p < pills.length; p++) {
            (function (pillBtn) {
                pillBtn.addEventListener('click', function () {
                    var chosen = pillBtn.getAttribute('data-category') || 'All';
                    activeCategory = (activeCategory === chosen && chosen !== 'All') ? 'All' : chosen;
                    browseRecentsOnEmpty = activeCategory === 'Recent';
                    showStatus('', false);
                    runFilter(false);
                    if (isExpandedState() && !catalogData && !isScanning) {
                        scanCatalog(false);
                    }
                    byId('query').focus();
                });
            }(pills[p]));
        }
    }

    document.addEventListener('keydown', function (ev) {
        if ((ev.ctrlKey || ev.metaKey) && ev.key && ev.key.toLowerCase() === 'f') {
            ev.preventDefault();
            byId('query').focus();
            byId('query').select();
        }
        if ((ev.ctrlKey || ev.metaKey) && ev.key && ev.key.toLowerCase() === 'r') {
            ev.preventDefault();
            scanCatalog(false);
        }
    });

    if (cepBridge && cepBridge.addEventListener) {
        cepBridge.addEventListener('com.pronto.ppro.open', handleReopen);
        cepBridge.addEventListener('com.pronto.ppro.previewToggle', function () {
            if (previewKeyConfig && previewKeyConfig.key === 32 && !document.hidden) {
                toggleAudioPreview();
            }
        });
        cepBridge.addEventListener('com.pronto.ppro.previewShortcut', function (rawEv) {
            try {
                var ev = parseCepEvent(rawEv);
                previewKeyConfig = ev.data === 'disabled' ? null : ProntoKeys.preview(ev.data);
                registerPreviewKeyInterest();
                visibleMatches.forEach(function (item, idx) {
                    var btn = byId('preview-' + idx);
                    if (btn) {
                        btn.title = 'Preview audio' + (previewKeyConfig ? ' (' + previewKeyConfig.label + ')' : '');
                    }
                });
            } catch (ignored) {}
        });
        cepBridge.addEventListener('com.pronto.ppro.autoPreview', function (rawEv) {
            var ev = parseCepEvent(rawEv);
            if (ev && (ev.data === 'true' || ev.data === true)) {
                autoPreviewEnabled = true;
            } else if (ev && (ev.data === 'false' || ev.data === false)) {
                autoPreviewEnabled = false;
            } else {
                isAutoPreviewActive();
            }
            try {
                if (typeof localStorage !== 'undefined') {
                    localStorage.setItem(AUTO_PREVIEW_KEY, String(autoPreviewEnabled));
                }
            } catch (ignored) {}
            if (autoPreviewEnabled) {
                maybeAutoPreviewSelected();
            } else {
                audioPlayer.stop();
            }
        });
        if (cepBridge.dispatchEvent) {
            cepBridge.dispatchEvent({
                type: 'com.pronto.ppro.getPreviewShortcut',
                scope: 'APPLICATION',
                appId: 'PPRO',
                extensionId: 'com.pronto.ppro.palette',
                data: ''
            });
        }
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { resetSessionUI(); }
        else { isAutoPreviewActive(); verifyHostContext(); }
    });

    if (window.addEventListener) {
        window.addEventListener('pagehide', function () { audioPlayer.stop(); });
        window.addEventListener('beforeunload', function () { audioPlayer.stop(); });
        window.addEventListener('blur', function () { audioPlayer.stop(); });
        window.addEventListener('focus', function () { isAutoPreviewActive(); });
        window.addEventListener('storage', function (ev) {
            if (!ev || ev.key === AUTO_PREVIEW_KEY) {
                isAutoPreviewActive();
            }
        });
    }

    byId('query').focus();
    runFilter(false);
    scanCatalog(true);
    if (window.setInterval) {
        window.setInterval(verifyHostContext, 30000);
    }
}());
