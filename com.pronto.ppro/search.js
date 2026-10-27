(function (root) {
  'use strict';
  function score(text, query) {
    return scoreLower(text.toLowerCase(), query.toLowerCase());
  }
  function scoreLower(text, query) {
    if (!query) return 0;
    if (text === query) return 10000;
    var direct = text.indexOf(query);
    if (direct !== -1) return 5000 - direct * 2 - text.length;
    var pos = -1, total = 0, previous = -2;
    for (var i = 0; i < query.length; i++) {
      pos = text.indexOf(query[i], pos + 1);
      if (pos === -1) return -Infinity;
      total += 20 + (pos === previous + 1 ? 25 : 0) + (pos === 0 || /[\s_./-]/.test(text[pos - 1]) ? 15 : 0);
      previous = pos;
    }
    return total - text.length;
  }
  function prepare(items) {
    return items.map(function (item) { return { name: item.name.toLowerCase(), path: item.path.toLowerCase() }; });
  }
  function filter(items, query, prepared) {
    var tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean), ranked = [];
    prepared = prepared || prepare(items);
    for (var i = 0; i < items.length; i++) {
      var rank = 0, text = prepared[i];
      for (var t = 0; t < tokens.length; t++) {
        var part = Math.max(scoreLower(text.name, tokens[t]) + 100, scoreLower(text.path, tokens[t]));
        if (part === -Infinity) { rank = -Infinity; break; }
        rank += part;
      }
      if (rank !== -Infinity) ranked.push({ item: items[i], score: rank, order: i });
    }
    ranked.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return ranked.map(function (r) { return r.item; });
  }
  var api = { score: score, filter: filter, prepare: prepare };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BinSearch = api;
}(this));
