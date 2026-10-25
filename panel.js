(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var data = null, matches = [], selected = 0, busy = false, indexing = false, lastHeight = 0, generation = 0, prepared = null;
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
    var oldRow = $('result-' + selected); if (oldRow) oldRow.setAttribute('aria-selected', 'false');
    selected = next;
    var row = $('result-' + selected);
    if (row) { row.setAttribute('aria-selected', 'true'); $('query').setAttribute('aria-activedescendant', 'result-' + selected); }
  }
  function reset() {
    if (busy) return;
    generation++; data = null; prepared = null; matches = []; selected = 0; indexing = false;
    $('query').value = ''; status('', false); setBusy(false); filter(); $('query').focus();
  }
  function filter() {
    var query = $('query').value.trim();
    var all = query && data ? BinSearch.filter(data.items, query, prepared) : [];
    matches = all.slice(0, 100); selected = 0;
    $('count').textContent = indexing ? 'Searching…' : all.length ? all.length + ' matches' + (all.length > 100 ? ' · showing first 100' : '') : 'No matches'; draw();
  }
  function refresh() {
    if (busy || indexing) return;
    var requestGeneration = generation;
    indexing = true; status('', false); filter();
    // CEP can throttle animation frames in modeless windows. Use a timer, not a
    // rendering callback, to start the host request after the input event returns.
    setTimeout(function () {
    if (requestGeneration !== generation) return;
    call('index', [], function (error, result) {
      if (requestGeneration !== generation) return;
      prepared = error ? null : BinSearch.prepare(result.items);
      data = error ? null : result;
      indexing = false; setBusy(false); status(error ? error.message : '', !!error); filter();
    });
    }, 0);
  }
  function openSource() {
    if (busy || indexing || !$('query').value.trim()) return;
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
    if (busy || indexing || !$('query').value.trim()) return;
    var item = matches[selected];
    if (!item || !data || !data.sequence) { status('Select media and open a timeline, then press Ctrl+R to refresh.', true); resize(); return; }
    if (!item.insertable || item.offline) { status('Choose online project media. Bins and sequences are search-only.', true); resize(); return; }
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
    window.__adobe_cep__.addEventListener('local.binsearch.open', reset);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) reset(); });
  $('query').focus(); filter();
}());
