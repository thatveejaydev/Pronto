(function (root) {
  'use strict';
  function fileURL(path) {
    path = path.replace(/\\/g, '/');
    if (!/^[A-Za-z]:\//.test(path) && path.indexOf('//') !== 0 && path.charAt(0) !== '/') throw Error('Preview requires a local media file.');
    var parts = path.split('/').map(function (part) { return encodeURIComponent(part); });
    if (/^[A-Za-z]:\//.test(path)) { parts[0] = path.slice(0, 2); return 'file:///' + parts.join('/'); }
    return (path.indexOf('//') === 0 ? 'file:' : 'file://') + parts.join('/');
  }
  function create(call, changed, failed, makeAudio) {
    var audio = null, id = null, revision = 0, loading = false;
    function update(state) { changed(id, state); }
    function stop() {
      revision++; loading = false;
      if (audio) { audio.onended = audio.onerror = audio.onplaying = null; audio.pause(); audio.removeAttribute('src'); audio.load(); audio = null; }
      id = null; update('stopped');
    }
    function error(token, message) { if (token !== revision) return; stop(); failed(message); }
    function play(player, token) {
      try {
        var promise = player.play();
        if (promise && promise.catch) promise.catch(function () { error(token, 'Cannot play this audio format here. Use Shift+Enter to open it in the Source Monitor.'); });
      } catch (e) { error(token, e.message); }
    }
    function toggle(project, item) {
      if (id === item.id) {
        if (loading) { stop(); return; }
        if (audio) {
          if (audio.paused) { update('loading'); play(audio, revision); }
          else { audio.pause(); update('paused'); }
          return;
        }
      }
      stop(); id = item.id; loading = true; update('loading');
      var token = revision;
      call('previewSource', [project, item.id], function (err, result) {
        if (token !== revision) return;
        if (err) { error(token, err.message); return; }
        try {
          audio = makeAudio(); var player = audio;
          player.preload = 'none';
          player.onplaying = function () { if (token === revision) { loading = false; update('playing'); } };
          player.onended = function () { if (token === revision) stop(); };
          player.onerror = function () { error(token, 'Audio preview unavailable. Use Shift+Enter to open it in the Source Monitor.'); };
          player.src = fileURL(result.path);
          play(player, token);
        } catch (e) { error(token, e.message); }
      });
    }
    return { toggle: toggle, stop: stop };
  }
  root.ProntoPreview = { create: create, fileURL: fileURL };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ProntoPreview;
}(this));
