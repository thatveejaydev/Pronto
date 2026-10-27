/*
 * PRONTO Launcher & Shortcut Recorder Controller
 * Clean state management without hidden DOM elements.
 */
(function () {
    'use strict';

    var cepBridge = window.__adobe_cep__ || null;
    var daemonProc = null;
    var isTransitioning = false;
    var activeRecordTarget = null; // 'open' | 'preview' | null

    var OPEN_STORAGE_KEY = 'pronto.openShortcut';
    var PREVIEW_STORAGE_KEY = 'pronto.previewShortcut';
    var AUTO_PREVIEW_KEY = 'pronto.autoPreview';

    var btnOpenPalette = document.getElementById('open-palette');
    var btnOpenShortcut = document.getElementById('btn-open-shortcut');
    var btnPreviewShortcut = document.getElementById('btn-preview-shortcut');
    var btnAutoPreview = document.getElementById('btn-auto-preview');
    var openStatusEl = document.getElementById('open-shortcut-status');
    var previewStatusEl = document.getElementById('preview-shortcut-status');

    function setOpenStatus(msg) { openStatusEl.textContent = msg || ''; }
    function setPreviewStatus(msg) { previewStatusEl.textContent = msg || ''; }

    function readOpenConfig() {
        try {
            var raw = JSON.parse(localStorage.getItem(OPEN_STORAGE_KEY) || 'null');
            if (raw && raw.enabled && raw.value) {
                return ProntoKeys.parse(raw.value);
            }
        } catch (ignored) {}
        return null;
    }

    function readPreviewLabel() {
        try {
            var saved = localStorage.getItem(PREVIEW_STORAGE_KEY);
            if (saved === 'disabled') { return 'disabled'; }
            return ProntoKeys.preview(saved || 'Ctrl+Space').label;
        } catch (ignored) {}
        return 'Ctrl+Space';
    }

    function readAutoPreview() {
        try {
            return localStorage.getItem(AUTO_PREVIEW_KEY) === 'true';
        } catch (ignored) {}
        return false;
    }

    function broadcastSettings() {
        if (cepBridge && cepBridge.dispatchEvent) {
            cepBridge.dispatchEvent({
                type: 'com.pronto.ppro.previewShortcut',
                scope: 'APPLICATION',
                appId: 'PPRO',
                extensionId: 'com.pronto.ppro.launcher',
                data: readPreviewLabel()
            });
            cepBridge.dispatchEvent({
                type: 'com.pronto.ppro.autoPreview',
                scope: 'APPLICATION',
                appId: 'PPRO',
                extensionId: 'com.pronto.ppro.launcher',
                data: String(readAutoPreview())
            });
        }
    }

    function launchSearchPalette() {
        if (!cepBridge) { return; }
        if (cepBridge.dispatchEvent) {
            cepBridge.dispatchEvent({
                type: 'com.pronto.ppro.open',
                scope: 'APPLICATION',
                appId: 'PPRO',
                extensionId: 'com.pronto.ppro.launcher',
                data: ''
            });
        }
        cepBridge.requestOpenExtension('com.pronto.ppro.palette', '');
    }

    function updateBadgeUI() {
        var openCfg = readOpenConfig();
        var previewLabel = readPreviewLabel();
        var autoOn = readAutoPreview();

        btnOpenShortcut.textContent = (activeRecordTarget === 'open')
            ? 'Press keys…'
            : (openCfg ? openCfg.label : 'disabled');
        btnPreviewShortcut.textContent = (activeRecordTarget === 'preview')
            ? 'Press keys…'
            : previewLabel;

        btnOpenShortcut.disabled = isTransitioning && activeRecordTarget !== 'open';
        btnPreviewShortcut.disabled = isTransitioning && activeRecordTarget !== 'preview';

        if (btnAutoPreview) {
            btnAutoPreview.textContent = autoOn ? 'On' : 'Off';
            btnAutoPreview.setAttribute('aria-pressed', String(autoOn));
        }
    }

    function stopDaemon(callback) {
        var prev = daemonProc;
        daemonProc = null;
        if (!prev) {
            callback();
            return;
        }
        prev.once('exit', callback);
        try { prev.stdin.end(); } catch (ignored) { callback(); }
    }

    function startDaemon(recordMode) {
        try {
            if (!window.cep_node || window.cep_node.process.platform !== 'win32') {
                throw new Error('Windows shortcut daemon requires Windows.');
            }
            var node = window.cep_node;
            var pathMod = node.require('path');
            var extRoot = decodeURI(cepBridge.getSystemPath('extension')).replace(/^file:\/\/\//, '');
            var psExe = pathMod.join(node.process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

            var openCfg = readOpenConfig() || { modifiers: 0, key: 0, label: '' };
            var psArgs = [
                '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
                '-File', pathMod.join(extRoot, 'hotkey-daemon.ps1'),
                '-Modifiers', String(openCfg.modifiers),
                '-KeyCode', String(openCfg.key),
                '-OwnerPid', String(node.process.pid)
            ];

            if (recordMode) {
                psArgs.push('-Record');
            } else {
                var prevLabel = readPreviewLabel();
                if (prevLabel !== 'disabled') {
                    var prevCfg = ProntoKeys.preview(prevLabel);
                    psArgs.push('-PreviewModifiers', String(prevCfg.modifiers), '-PreviewKey', String(prevCfg.key));
                }
            }

            var child = node.require('child_process').spawn(psExe, psArgs, {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            daemonProc = child;

            var outBuffer = '';
            var errBuffer = '';
            child.stdout.setEncoding('utf8');
            child.stderr.setEncoding('utf8');

            child.stdout.on('data', function (chunk) {
                outBuffer += chunk;
                var lines = outBuffer.split(/\r?\n/);
                outBuffer = lines.pop();
                lines.forEach(function (line) {
                    if (daemonProc !== child) { return; }
                    if (line === 'LISTENING') {
                        setOpenStatus('Listening… press and release your shortcut. Esc cancels.');
                    } else if (line.indexOf('CAPTURE:') === 0) {
                        var parts = line.split(':');
                        try {
                            completeRecording(ProntoKeys.captured(Number(parts[1]), Number(parts[2])));
                        } catch (e) {
                            completeRecording(null);
                        }
                    } else if (line === 'CANCEL') {
                        completeRecording(null);
                    } else if (line === 'OPEN') {
                        launchSearchPalette();
                    } else if (line === 'PREVIEW' && cepBridge && cepBridge.dispatchEvent) {
                        cepBridge.dispatchEvent({
                            type: 'com.pronto.ppro.previewToggle',
                            scope: 'APPLICATION',
                            appId: 'PPRO',
                            extensionId: 'com.pronto.ppro.launcher',
                            data: ''
                        });
                    } else if (line === 'PREVIEW_CONFLICT') {
                        setPreviewStatus('Audio preview shortcut is in use by another app.');
                    } else if (line === 'STARTED') {
                        isTransitioning = false;
                        updateBadgeUI();
                        setOpenStatus(openCfg.key ? (openCfg.label + ' enabled. Focus Premiere to use it.') : '');
                    } else if (line === 'READY') {
                        setOpenStatus(openCfg.label + ' active in Premiere.');
                    } else if (line === 'CONFLICT') {
                        isTransitioning = false;
                        updateBadgeUI();
                        setOpenStatus('Shortcut already registered by another app. Choose a different key.');
                    }
                });
            });

            child.stderr.on('data', function (chunk) {
                errBuffer = (errBuffer + chunk).slice(-1200);
            });

            child.on('error', function (err) {
                if (daemonProc === child) {
                    daemonProc = null;
                    activeRecordTarget = null;
                    isTransitioning = false;
                    updateBadgeUI();
                    setOpenStatus('Failed to start shortcut daemon: ' + err.message);
                }
            });

            child.on('exit', function () {
                if (daemonProc === child) {
                    daemonProc = null;
                    activeRecordTarget = null;
                    isTransitioning = false;
                    updateBadgeUI();
                    if (errBuffer) { setOpenStatus('Shortcut helper exited: ' + errBuffer); }
                }
            });

            child.stdin.on('error', function () {});
        } catch (e) {
            activeRecordTarget = null;
            isTransitioning = false;
            updateBadgeUI();
            setOpenStatus(e.message || String(e));
        }
    }

    function restartNormalDaemon() {
        isTransitioning = true;
        updateBadgeUI();
        stopDaemon(function () {
            startDaemon(false);
        });
    }

    function completeRecording(capturedConfig) {
        var target = activeRecordTarget;
        activeRecordTarget = null;
        isTransitioning = false;

        if (!capturedConfig) {
            setOpenStatus(target === 'open' ? 'Shortcut recording cancelled.' : '');
            setPreviewStatus(target === 'preview' ? 'Shortcut recording cancelled.' : '');
            restartNormalDaemon();
            return;
        }

        try {
            if (target === 'open') {
                var prevLabel = readPreviewLabel();
                if (prevLabel !== 'disabled' && capturedConfig.label === prevLabel) {
                    throw new Error('Already used by Audio preview. Pick a different shortcut.');
                }
                localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify({ enabled: true, value: capturedConfig.label }));
                setOpenStatus('');
            } else if (target === 'preview') {
                var validated = ProntoKeys.preview(capturedConfig.label);
                var openCfg = readOpenConfig();
                if (openCfg && openCfg.label === validated.label) {
                    throw new Error('Already used by Open PRONTO. Pick a different shortcut.');
                }
                localStorage.setItem(PREVIEW_STORAGE_KEY, validated.label);
                setPreviewStatus('');
                broadcastSettings();
            }
        } catch (err) {
            if (target === 'preview') { setPreviewStatus(err.message); }
            else { setOpenStatus(err.message); }
        }

        restartNormalDaemon();
    }

    function beginRecordFor(target) {
        if (activeRecordTarget === target) {
            completeRecording(null);
            return;
        }
        if (isTransitioning) { return; }
        activeRecordTarget = target;
        isTransitioning = true;
        setOpenStatus('Preparing shortcut recorder…');
        setPreviewStatus('');
        updateBadgeUI();
        stopDaemon(function () {
            if (activeRecordTarget) {
                startDaemon(true);
            }
        });
    }

    btnOpenPalette.addEventListener('click', launchSearchPalette);

    btnOpenShortcut.addEventListener('click', function () {
        beginRecordFor('open');
    });

    btnOpenShortcut.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        if (isTransitioning) { return; }
        localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify({ enabled: false, value: '' }));
        setOpenStatus('Open shortcut disabled.');
        restartNormalDaemon();
    });

    btnPreviewShortcut.addEventListener('click', function () {
        beginRecordFor('preview');
    });

    btnPreviewShortcut.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        if (isTransitioning) { return; }
        localStorage.setItem(PREVIEW_STORAGE_KEY, 'disabled');
        setPreviewStatus('Audio preview shortcut disabled.');
        broadcastSettings();
        restartNormalDaemon();
    });

    if (btnAutoPreview) {
        btnAutoPreview.addEventListener('click', function () {
            var nextState = !readAutoPreview();
            try {
                localStorage.setItem(AUTO_PREVIEW_KEY, String(nextState));
            } catch (ignored) {}
            updateBadgeUI();
            broadcastSettings();
        });
    }

    if (cepBridge && cepBridge.addEventListener) {
        cepBridge.addEventListener('com.pronto.ppro.getPreviewShortcut', broadcastSettings);
        cepBridge.addEventListener('com.pronto.ppro.open', broadcastSettings);
    }

    window.addEventListener('beforeunload', function () {
        if (daemonProc) {
            try { daemonProc.stdin.end(); } catch (ignored) {}
        }
    });

    if (cepBridge && cepBridge.evalScript) {
        cepBridge.evalScript(
            'app.setExtensionPersistent("com.pronto.ppro.launcher", 1); app.setExtensionPersistent("com.pronto.ppro.palette", 1);',
            function () {}
        );
    }

    updateBadgeUI();
    broadcastSettings();
    restartNormalDaemon();
}());
