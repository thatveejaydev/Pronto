(function () {
  'use strict';
  var bridge = window.__adobe_cep__, helper = null, changing = false, recording = false, previousValue = '';
  var field = document.getElementById('shortcut'), message = document.getElementById('shortcut-status');
  var storageKey = 'binsearch.shortcut.v1';
  function status(text) { message.textContent = text; }
  function open() {
    if (!bridge) return;
    // Reset a retained popup before showing it; a cold popup initializes itself.
    if (bridge.dispatchEvent) bridge.dispatchEvent(JSON.stringify({ type: 'local.binsearch.open', scope: 'APPLICATION', appId: 'PPRO', extensionId: 'local.binsearch.popup', data: '' }));
    bridge.requestOpenExtension('local.binsearch.popup', '');
  }
  document.getElementById('open').addEventListener('click', open);
  function controls(disabled) {
    changing = disabled;
    document.getElementById('save-shortcut').disabled = disabled;
    document.getElementById('disable-shortcut').disabled = disabled;
    document.getElementById('record-shortcut').disabled = disabled && !recording;
    document.getElementById('record-shortcut').textContent = recording ? 'Cancel recording' : 'Record shortcut';
    field.readOnly = recording;
  }
  function stop(done) {
    var old = helper; helper = null;
    if (!old) { done(); return; }
    old.once('exit', done);
    old.stdin.end(); // EOF makes the helper unregister the key and exit.
  }
  function start(config, record) {
    try {
      if (!window.cep_node || window.cep_node.process.platform !== 'win32') throw Error('Shortcut support requires Windows. Restart Premiere after this update.');
      var node = window.cep_node, path = node.require('path');
      var extension = decodeURI(bridge.getSystemPath('extension')).replace(/^file:\/\/\//, '');
      var executable = path.join(node.process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      var args = [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(extension, 'hotkey.ps1'), '-Modifiers', String(config.modifiers),
        '-KeyCode', String(config.key), '-OwnerPid', String(node.process.pid)
      ];
      if (record) args.push('-Record');
      var child = node.require('child_process').spawn(executable, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      helper = child;
      var buffer = '', errors = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', function (chunk) {
        buffer += chunk;
        var lines = buffer.split(/\r?\n/); buffer = lines.pop();
        lines.forEach(function (line) {
          if (helper !== child) return;
          if (line === 'LISTENING') status('Listening… press and release your shortcut. Esc cancels.');
          else if (line.indexOf('CAPTURE:') === 0) {
            var values = line.split(':');
            try { finishRecording(BinSearchShortcut.captured(Number(values[1]), Number(values[2]))); }
            catch (e) { finishRecording(null); }
          }
          else if (line === 'CANCEL') finishRecording(null);
          else if (line === 'OPEN') open();
          else if (line === 'STARTED') { controls(false); status(config.label + ' enabled. Activate Premiere to use it.'); }
          else if (line === 'READY') status(config.label + ' ready in Premiere.');
          else if (line === 'CONFLICT') { controls(false); status('That shortcut is already registered by another app. Choose a different combination.'); }
        });
      });
      child.stderr.on('data', function (chunk) { errors = (errors + chunk).slice(-1500); });
      child.on('error', function (e) { if (helper === child) { helper = null; recording = false; controls(false); status('Could not start shortcut: ' + e.message); } });
      child.on('exit', function () { if (helper === child) { helper = null; recording = false; controls(false); status('Shortcut stopped. ' + (errors || 'Click Save to restart.')); } });
      child.stdin.on('error', function () {});
    } catch (e) { recording = false; controls(false); status(e.message); }
  }
  function apply() {
    if (changing) return;
    var config;
    try { config = BinSearchShortcut.parse(field.value); }
    catch (e) { status(e.message); return; }
    field.value = config.label;
    localStorage.setItem(storageKey, JSON.stringify({ enabled: true, value: config.label }));
    controls(true); status('Starting shortcut…'); stop(function () { start(config); });
  }
  document.getElementById('save-shortcut').addEventListener('click', apply);
  function finishRecording(config) {
    recording = false; controls(false);
    if (config) { field.value = config.label; apply(); return; }
    field.value = previousValue;
    controls(true);
    stop(function () {
      controls(false); status('Recording cancelled.');
      try {
        var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && saved.enabled) { controls(true); start(BinSearchShortcut.parse(saved.value)); }
      } catch (e) { controls(false); status(e.message); }
    });
  }
  document.getElementById('record-shortcut').addEventListener('click', function () {
    if (recording) { finishRecording(null); return; }
    if (changing) return;
    previousValue = field.value; recording = true; controls(true);
    status('Preparing recorder… wait for Listening, then press your shortcut.');
    stop(function () { if (recording) start({ modifiers: 3, key: 66, label: '' }, true); });
  });
  document.getElementById('disable-shortcut').addEventListener('click', function () {
    if (changing) return;
    localStorage.setItem(storageKey, JSON.stringify({ enabled: false, value: field.value }));
    controls(true); stop(function () { controls(false); status('Shortcut disabled.'); });
  });
  field.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  window.addEventListener('beforeunload', function () { if (helper) helper.stdin.end(); });
  // Keep the launcher running when switching to another panel in Premiere.
  if (bridge) bridge.evalScript('app.setExtensionPersistent("local.binsearch.panel", 1); app.setExtensionPersistent("local.binsearch.popup", 1)', function () {});
  try {
    var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) { field.value = saved.value; if (saved.enabled) apply(); }
  } catch (e) { status('Saved shortcut could not be read. Enter a new combination.'); }
}());
