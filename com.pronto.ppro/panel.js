(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var data = null, matches = [], selected = 0, busy = false, indexing = false, lastHeight = 0, generation = 0, prepared = null, indexedAt = 0, checking = false;
  var previewId = null, previewState = 'stopped';
  var previewShortcut = BinSearchShortcut.preview('Ctrl+Space');
  function registerPreviewKey() {
    var bridge = window.__adobe_cep__;
    if (!previewShortcut) { if (bridge && bridge.registerKeyEventsInterest) bridge.registerKeyEventsInterest(''); return; }
    if (bridge && bridge.registerKeyEventsInterest) bridge.registerKeyEventsInterest(JSON.stringify([{
      keyCode: previewShortcut.key, ctrlKey: !!(previewShortcut.modifiers & 2),
      altKey: !!(previewShortcut.modifiers & 1), shiftKey: !!(previewShortcut.modifiers & 4), metaKey: false
    }]));
  }
  registerPreviewKey();
  var preview = ProntoPreview.create(call, function (id, state) {
    previewId = id; previewState = state;
    matches.forEach(function (item, i) {
      var button = $('preview-' + i); if (!button) return;
      var active = item.id === id && (state === 'playing' || state === 'loading');
      button.textContent = active ? (state === 'loading' ? '…' : 'Ⅱ') : '▶';
      button.setAttribute('aria-label', (active ? 'Pause ' : 'Preview ') + item.name);
      button.setAttribute('aria-pressed', String(active));
    });
  }, function (message) { status(message, true); resize(); }, function () { return new Audio(); });
  function togglePreview() {
    if (busy || checking || !data) return;
    var item = matches[selected];
    if (!item || item.kind !== 'Audio' || item.offline) return;
    status('', false); resize(); preview.toggle(data.project, item);
  }
  function resize() {
    var height = !$('status').hidden ? 160 : !$('query').value.trim() ? 58 : 90 + Math.min(Math.max(matches.length, 1), 7) * 52;
    if (height === lastHeight && Math.abs(window.innerHeight - height) < 3) return;
    // Native window sizing must never prevent the search/index request from running.
    try {
      if (window.__adobe_cep__ && window.__adobe_cep__.resizeContent) window.__adobe_cep__.resizeContent(420, height);
      lastHeight = height;
    } catch (e) { lastHeight = 0; }
  }
  function status(message, error) { $('status').textContent = error ? message : ''; $('status').className = error ? 'error' : ''; $('status').hidden = !error; }
  function literal(value) { return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }
  function call(method, args, done) {
    if (!window.__adobe_cep__) { done(new Error('Open this panel inside Premiere Pro. Browser preview cannot access your project.')); return; }
    // CEP native bridge; equivalent to CSInterface.evalScript without a bundled SDK library.
    try {
      window.__adobe_cep__.evalScript('BinSearchHost.' + method + '(' + args.map(literal).join(',') + ')', function (raw) {
        var response;
        try { response = JSON.parse(raw); if (!response.ok) throw new Error(response.error); }
        catch (e) { done(new Error(e.message + (raw === 'EvalScript error.' ? ' Reopen the panel to reload host.jsx.' : ''))); return; }
        done(null, response);
      });
    } catch (e) { done(e); }
  }
  function setBusy(value) {
    busy = value; $('results').setAttribute('aria-busy', String(value || indexing));
  }
  function draw() {
    var list = $('results'); list.textContent = '';
    var hasQuery = !!$('query').value.trim();
    list.hidden = !hasQuery || !matches.length;
    $('count').hidden = !hasQuery;
    $('query').setAttribute('aria-expanded', String(hasQuery && matches.length > 0));
    matches.forEach(function (item, i) {
      var row = document.createElement('li'), title = document.createElement('strong'), detail = document.createElement('span'), icon = document.createElement('span');
      var iconTypes = { Bin: 'bin', Sequence: 'sequence', Image: 'image', Video: 'video', Audio: 'audio', Graphic: 'graphic' };
      icon.className = 'result-icon ' + (iconTypes[item.kind] || 'media') + '-icon';
      icon.setAttribute('aria-hidden', 'true');
      detail.className = 'result-detail';
      row.id = 'result-' + i; row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(i === selected));
      title.textContent = item.name;
      detail.textContent = item.kind + (item.offline ? ' · OFFLINE' : '') + ' · ' + item.path;
      row.title = item.path;
      row.appendChild(icon); row.appendChild(title); row.appendChild(detail);
      if (item.kind === 'Audio' && !item.offline) {
        var button = document.createElement('button');
        button.id = 'preview-' + i; button.className = 'preview-button'; button.type = 'button';
        var playing = previewId === item.id && (previewState === 'playing' || previewState === 'loading');
        button.textContent = playing ? (previewState === 'loading' ? '…' : 'Ⅱ') : '▶';
        button.setAttribute('aria-pressed', String(playing)); button.title = 'Preview audio' + (previewShortcut ? ' (' + previewShortcut.label + ')' : '');
        button.setAttribute('aria-label', (playing ? 'Pause ' : 'Preview ') + item.name);
        button.addEventListener('click', function (e) {
          e.stopPropagation(); e.preventDefault(); if (busy || checking || e.detail > 1) return;
          select(i); $('query').focus(); togglePreview();
        });
        row.appendChild(button);
      }
      row.addEventListener('click', function (e) {
        if (busy || e.detail > 1) return;
        select(i); $('query').focus(); if (e.shiftKey) openSource(); else insert();
      });
      list.appendChild(row);
    });
    if (matches.length) $('query').setAttribute('aria-activedescendant', 'result-' + selected);
    else $('query').removeAttribute('aria-activedescendant');
    resize();
  }
  function select(next) {
    if (next !== selected) preview.stop();
    var oldRow = $('result-' + selected); if (oldRow) oldRow.setAttribute('aria-selected', 'false');
    selected = next;
    var row = $('result-' + selected);
    if (row) { row.setAttribute('aria-selected', 'true'); $('query').setAttribute('aria-activedescendant', 'result-' + selected); }
  }
  function reset() {
    preview.stop();
    if (busy) return;
    matches = []; selected = 0;
    $('query').value = ''; status('', false); setBusy(false); filter(); $('query').focus();
  }
  function filter(preserveSelection) {
    var previous = preserveSelection && matches[selected] ? matches[selected].id : null;
    if (!preserveSelection) preview.stop();
    var query = $('query').value.trim();
    var all = query && data ? BinSearch.filter(data.items, query, prepared) : [];
    matches = all.slice(0, 100); selected = 0;
    if (previous) {
      for (var i = 0; i < matches.length; i++) { if (matches[i].id === previous) { selected = i; break; } }
      if (!matches[selected] || matches[selected].id !== previous || matches[selected].offline) preview.stop();
    }
    $('count').textContent = indexing && !data ? 'Searching…' : all.length ? all.length + ' matches' + (all.length > 100 ? ' · showing first 100' : '') : 'No matches'; draw();
  }
  function refresh(background) {
    if (busy || indexing) return;
    var requestGeneration = generation;
    indexing = true;
    if (!background) status('', false);
    if (!data) filter();
    setTimeout(function () {
      if (requestGeneration !== generation) return;
      call('index', [], function (error, result) {
        if (requestGeneration !== generation) return;
        indexing = false;
        if (!error) {
          prepared = BinSearch.prepare(result.items); data = result; indexedAt = Date.now();
        }
        setBusy(busy);
        if (!background || !data) status(error ? error.message : '', !!error);
        // A closed popup stays empty. The completed index is retained for next time.
        if (!busy) filter(true);
      });
    }, 0);
  }
  function checkContext() {
    if (busy || checking || indexing) return;
    checking = true;
    call('state', [], function (error, result) {
      checking = false;
      if (error || (data && data.project !== result.project)) {
        generation++; data = null; prepared = null; indexedAt = 0;
        preview.stop(); filter();
      }
      if (error) { status(error.message, !!$('query').value.trim()); resize(); return; }
      if (data) data.sequence = result.sequence;
      if (!data || Date.now() - indexedAt >= 30000) refresh(true);
    });
  }
  function reopen() { reset(); checkContext(); }
  function openSource() {
    preview.stop();
    if (busy || checking || !$('query').value.trim()) return;
    var item = matches[selected];
    if (!item || !data) return;
    setBusy(true); status('');
    call('openSource', [data.project, item.id], function (error) {
      setBusy(false);
      if (error) { status(error.message, true); resize(); $('query').focus(); }
      else close();
    });
  }
  function insert() {
    preview.stop();
    if (busy || checking || !$('query').value.trim()) return;
    var item = matches[selected];
    if (item && data && item.kind === 'Bin') { openSource(); return; }
    if (!item || !data || !data.sequence) { status('Select media and open a timeline, then press Ctrl+R to refresh.', true); resize(); return; }
    if (!item.insertable || item.offline) { status('Choose online media or a sequence. Choose a bin to highlight it in the Project panel.', true); resize(); return; }
    setBusy(true); status('Inserting…');
    call('insert', [data.project, data.sequence.id, item.id], function (error, result) {
      setBusy(false); status(error ? error.message : result.message, !!error); resize(); $('query').focus(); if (!error) close();
    });
  }
  $('query').addEventListener('input', function () {
    status('', false); filter();
    if ($('query').value.trim() && !data && !indexing) refresh();
  });
  $('query').addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (previewShortcut && BinSearchShortcut.matches(e, previewShortcut)) { e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); if (!e.repeat) togglePreview(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); select(Math.max(0, Math.min(matches.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1))));
      var row = $('result-' + selected); if (row) row.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) { if (e.shiftKey) openSource(); else insert(); } }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('query').focus(); $('query').select(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); refresh(); }
  });
  function close() {
    if (!busy && window.__adobe_cep__) { reset(); window.__adobe_cep__.closeExtension(); }
  }
  if (window.__adobe_cep__ && window.__adobe_cep__.addEventListener) {
    window.__adobe_cep__.addEventListener('local.binsearch.open', reopen);
    window.__adobe_cep__.addEventListener('local.binsearch.previewToggle', function () { if (previewShortcut && previewShortcut.key === 32 && !document.hidden) togglePreview(); });
    window.__adobe_cep__.addEventListener('local.binsearch.previewShortcut', function (event) {
      try {
        previewShortcut = event.data === 'disabled' ? null : BinSearchShortcut.preview(event.data);
        registerPreviewKey();
        matches.forEach(function (item, i) { var button = $('preview-' + i); if (button) button.title = 'Preview audio' + (previewShortcut ? ' (' + previewShortcut.label + ')' : ''); });
      } catch (ignored) {}
    });
    if (window.__adobe_cep__.dispatchEvent) window.__adobe_cep__.dispatchEvent({type:'local.binsearch.getPreviewShortcut',scope:'APPLICATION',appId:'PPRO',extensionId:'local.binsearch.popup',data:''});
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) reset(); else checkContext(); });
  if (window.addEventListener) {
    window.addEventListener('pagehide', function () { preview.stop(); });
    window.addEventListener('beforeunload', function () { preview.stop(); });
    window.addEventListener('blur', function () { preview.stop(); });
  }
  $('query').focus(); filter();
  refresh(true);
  if (window.setInterval) window.setInterval(checkContext, 30000);
}());

