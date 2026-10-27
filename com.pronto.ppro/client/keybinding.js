/*
 * PRONTO Shortcut Parser & Matcher
 */
(function (globalScope) {
    'use strict';

    var MOD_ALT = 1;
    var MOD_CTRL = 2;
    var MOD_SHIFT = 4;

    function parseShortcut(inputString) {
        var tokens = String(inputString || '').toUpperCase().replace(/\s+/g, '').split('+').filter(Boolean);
        var modifiers = 0;
        var keyCode = null;

        for (var i = 0; i < tokens.length; i++) {
            var part = tokens[i];
            var modBit = (part === 'CTRL' || part === 'CONTROL') ? MOD_CTRL
                       : (part === 'ALT') ? MOD_ALT
                       : (part === 'SHIFT') ? MOD_SHIFT : 0;
            if (modBit) {
                if (modifiers & modBit) {
                    throw new Error('Duplicate modifier key in shortcut.');
                }
                modifiers |= modBit;
            } else {
                if (keyCode !== null) {
                    throw new Error('Specify only one main key (A–Z, 0–9, Space, or F1–F11).');
                }
                if (/^[A-Z0-9]$/.test(part)) {
                    keyCode = part.charCodeAt(0);
                } else if (part === 'SPACE' || part === 'SPACEBAR') {
                    keyCode = 32;
                } else if (/^F([1-9]|10|11)$/.test(part)) {
                    keyCode = 111 + Number(part.slice(1));
                } else {
                    throw new Error('Unsupported key. Use Ctrl or Alt with A–Z, 0–9, Space, or F1–F11.');
                }
            }
        }

        if ((modifiers & (MOD_CTRL | MOD_ALT)) === 0 || keyCode === null) {
            throw new Error('Shortcut must include Ctrl or Alt plus one key.');
        }

        var keyLabel = (keyCode === 32) ? 'Space'
                     : (keyCode >= 112) ? ('F' + (keyCode - 111))
                     : String.fromCharCode(keyCode);

        var formatted = (modifiers & MOD_CTRL ? 'Ctrl+' : '') +
                        (modifiers & MOD_ALT ? 'Alt+' : '') +
                        (modifiers & MOD_SHIFT ? 'Shift+' : '') +
                        keyLabel;

        return {
            modifiers: modifiers,
            key: keyCode,
            label: formatted
        };
    }

    function fromCapturedCodes(modifiers, keyCode) {
        if (!Number.isInteger(modifiers) || modifiers < 1 || modifiers > 7 || !Number.isInteger(keyCode)) {
            throw new Error('Invalid captured key combination.');
        }
        var keyName = (keyCode === 32) ? 'Space'
                    : (keyCode >= 112 && keyCode <= 122) ? ('F' + (keyCode - 111))
                    : String.fromCharCode(keyCode);
        var text = (modifiers & MOD_CTRL ? 'Ctrl+' : '') +
                   (modifiers & MOD_ALT ? 'Alt+' : '') +
                   (modifiers & MOD_SHIFT ? 'Shift+' : '') +
                   keyName;
        return parseShortcut(text);
    }

    function parsePreviewShortcut(inputString) {
        var parsed = parseShortcut(inputString);
        if ((parsed.modifiers & MOD_CTRL) && (parsed.key === 70 || parsed.key === 82)) {
            throw new Error('Ctrl+F and Ctrl+R are reserved for Search and Refresh.');
        }
        return parsed;
    }

    function matchesEvent(ev, shortcutObj) {
        if (!ev || !shortcutObj || ev.metaKey) { return false; }
        var evMods = (ev.ctrlKey ? MOD_CTRL : 0) | (ev.altKey ? MOD_ALT : 0) | (ev.shiftKey ? MOD_SHIFT : 0);
        if (evMods !== shortcutObj.modifiers) { return false; }

        var rawKey = ev.key || '';
        var code = 0;
        if (rawKey === ' ' || rawKey === 'Spacebar' || rawKey === 'Space' || ev.code === 'Space' || ev.keyCode === 32 || ev.which === 32) {
            code = 32;
        } else if (/^F([1-9]|10|11)$/i.test(rawKey)) {
            code = 111 + Number(rawKey.slice(1));
        } else if (rawKey.length === 1) {
            code = rawKey.toUpperCase().charCodeAt(0);
        }
        return code === shortcutObj.key;
    }

    var api = {
        parse: parseShortcut,
        captured: fromCapturedCodes,
        preview: parsePreviewShortcut,
        matches: matchesEvent
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    globalScope.ProntoKeys = api;
}(typeof window !== 'undefined' ? window : globalThis));
