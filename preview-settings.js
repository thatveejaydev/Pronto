(function () {
  'use strict';
  var bridge = window.__adobe_cep__, key = 'pronto.previewShortcut.v1';
  var button = document.getElementById('record-preview-shortcut'), status = document.getElementById('preview-shortcut-status');
  var value = 'Ctrl+Space';
  try { var saved = localStorage.getItem(key); value = saved === 'disabled' ? saved : BinSearchShortcut.preview(saved || value).label; } catch (ignored) {}
  button.textContent = value;
  function send() {
    if (bridge && bridge.dispatchEvent) bridge.dispatchEvent({type:'local.binsearch.previewShortcut',scope:'APPLICATION',appId:'PPRO',extensionId:'local.binsearch.panel',data:value});
  }
  button.addEventListener('click', function () {
    if (button.disabled) return;
    var finished = false;
    var accepted = window.ProntoRecordShortcut(function (config) {
      finished = true; button.disabled = false; button.textContent = value;
      if (!config) { status.textContent = ''; return; }
      try {
        config = BinSearchShortcut.preview(config.label);
        var opening = JSON.parse(localStorage.getItem('binsearch.shortcut.v1') || 'null');
        if (opening && opening.enabled && BinSearchShortcut.parse(opening.value).label === config.label) throw Error('Choose a different shortcut from Open PRONTO.');
        localStorage.setItem(key, config.label); value = config.label; button.textContent = value;
        send(); status.textContent = '';
      } catch (e) { status.textContent = e.message; }
    });
    if (accepted && !finished) { button.textContent = 'Press keys…'; button.disabled = true; status.textContent = ''; }
  });
  button.addEventListener('contextmenu', function (e) {
    e.preventDefault(); if (button.disabled) return;
    localStorage.setItem(key, 'disabled'); value = 'disabled'; button.textContent = value; status.textContent = ''; send(); if (window.ProntoRefreshShortcuts) window.ProntoRefreshShortcuts();
  });
  if (bridge && bridge.addEventListener) {
    bridge.addEventListener('local.binsearch.getPreviewShortcut', send);
    bridge.addEventListener('local.binsearch.open', send);
  }
  send();
}());
