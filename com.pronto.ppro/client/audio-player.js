/*
 * PRONTO Audio Preview Controller
 * Supports local & UNC file URLs, trimmed In/Out point playback, and live progress bar updates.
 */
(function (globalScope) {
    'use strict';

    function toLocalFileUrl(diskPath) {
        var normalized = String(diskPath || '').replace(/\\/g, '/');
        var isDrive = /^[A-Za-z]:\//.test(normalized);
        var isUnc = normalized.indexOf('//') === 0;
        var isPosix = normalized.charAt(0) === '/' && !isUnc;
        if (!isDrive && !isUnc && !isPosix) {
            throw new Error('Audio preview requires a local or network drive file path.');
        }
        var segments = normalized.split('/').map(function (seg) {
            return encodeURIComponent(seg);
        });
        if (isDrive) {
            segments[0] = normalized.slice(0, 2);
            return 'file:///' + segments.join('/');
        }
        return (isUnc ? 'file:' : 'file://') + segments.join('/');
    }

    function createController(hostBridge, onStateChange, onError, audioFactory) {
        var player = null;
        var activeItemId = null;
        var sessionToken = 0;
        var isFetching = false;
        var clipInPoint = 0;
        var clipOutPoint = 0;

        function notify(state, progress) {
            onStateChange(activeItemId, state, typeof progress === 'number' ? progress : 0);
        }

        function stop() {
            sessionToken++;
            isFetching = false;
            clipInPoint = 0;
            clipOutPoint = 0;
            if (player) {
                player.onloadedmetadata = null;
                player.onplaying = null;
                player.onended = null;
                player.onerror = null;
                player.ontimeupdate = null;
                player.pause();
                player.removeAttribute('src');
                player.load();
                player = null;
            }
            activeItemId = null;
            notify('stopped', 0);
        }

        function fail(token, msg) {
            if (token !== sessionToken) { return; }
            stop();
            onError(msg);
        }

        function startPlay(el, token) {
            try {
                var p = el.play();
                if (p && typeof p.catch === 'function') {
                    p.catch(function () {
                        fail(token, 'Codec not supported by CEP preview. Press Shift+Enter to audition in Source Monitor.');
                    });
                }
            } catch (err) {
                fail(token, err.message || String(err));
            }
        }

        function computeProgress(el) {
            var start = clipInPoint > 0 ? clipInPoint : 0;
            var end = (clipOutPoint > start) ? clipOutPoint : (Number(el.duration) || 0);
            if (!(end > start)) { return 0; }
            var current = Math.max(start, Number(el.currentTime) || 0);
            return Math.min(1, Math.max(0, (current - start) / (end - start)));
        }

        function playItem(projectId, item) {
            if (!item) { return; }
            if (activeItemId === item.id && (isFetching || (player && !player.paused))) {
                return;
            }
            toggle(projectId, item);
        }

        function toggle(projectId, item) {
            if (!item) { return; }
            if (activeItemId === item.id) {
                if (isFetching) {
                    stop();
                    return;
                }
                if (player) {
                    if (player.paused) {
                        notify('loading', computeProgress(player));
                        startPlay(player, sessionToken);
                    } else {
                        player.pause();
                        notify('paused', computeProgress(player));
                    }
                    return;
                }
            }

            stop();
            activeItemId = item.id;
            isFetching = true;
            notify('loading', 0);
            var token = sessionToken;

            hostBridge('resolveAudio', [projectId, item.id], function (err, info) {
                if (token !== sessionToken) { return; }
                if (err) {
                    fail(token, err.message || String(err));
                    return;
                }
                try {
                    clipInPoint = Number(info.inPoint) > 0 ? Number(info.inPoint) : 0;
                    clipOutPoint = Number(info.outPoint) > clipInPoint ? Number(info.outPoint) : 0;
                    player = audioFactory();
                    var el = player;
                    el.preload = 'auto';
                    var seeked = false;
                    function applyInPoint() {
                        if (!seeked && clipInPoint > 0) {
                            seeked = true;
                            try { el.currentTime = clipInPoint; } catch (ignoredSeek) {}
                        }
                    }
                    el.onloadedmetadata = function () {
                        if (token === sessionToken) { applyInPoint(); }
                    };
                    el.onplaying = function () {
                        if (token === sessionToken) {
                            isFetching = false;
                            applyInPoint();
                            notify('playing', computeProgress(el));
                        }
                    };
                    el.ontimeupdate = function () {
                        if (token !== sessionToken) { return; }
                        if (clipOutPoint > 0 && Number(el.currentTime) >= clipOutPoint) {
                            stop();
                            return;
                        }
                        notify(el.paused ? 'paused' : 'playing', computeProgress(el));
                    };
                    el.onended = function () {
                        if (token === sessionToken) { stop(); }
                    };
                    el.onerror = function () {
                        fail(token, 'Audio preview unavailable for this file. Press Shift+Enter to open in Source Monitor.');
                    };
                    el.src = toLocalFileUrl(info.path);
                    applyInPoint();
                    startPlay(el, token);
                } catch (e) {
                    fail(token, e.message || String(e));
                }
            });
        }

        return {
            toggle: toggle,
            play: playItem,
            stop: stop
        };
    }

    var api = {
        toLocalFileUrl: toLocalFileUrl,
        create: createController
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    globalScope.ProntoAudioPlayer = api;
}(typeof window !== 'undefined' ? window : globalThis));
