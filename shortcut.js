(function (root) {
  function parse(value) {
    var parts = value.toUpperCase().replace(/\s/g, '').split('+'), mods = 0, key = null;
    parts.forEach(function (part) {
      var bit = part === 'CTRL' || part === 'CONTROL' ? 2 : part === 'ALT' ? 1 : part === 'SHIFT' ? 4 : 0;
      if (bit) { if (mods & bit) throw Error('Duplicate modifier.'); mods |= bit; }
      else {
        if (key !== null) throw Error('Choose one letter, number, Space, or F1–F11.');
        if (/^[A-Z0-9]$/.test(part)) key = part.charCodeAt(0);
        else if (part === 'SPACE' || part === 'SPACEBAR') key = 32;
        else if (/^F([1-9]|10|11)$/.test(part)) key = 111 + Number(part.slice(1));
        else throw Error('Use Ctrl or Alt plus a letter, number, Space, or F1–F11.');
      }
    });
    if (!(mods & 3) || key === null) throw Error('Include Ctrl or Alt and one key.');
    var label = (mods & 2 ? 'Ctrl+' : '') + (mods & 1 ? 'Alt+' : '') + (mods & 4 ? 'Shift+' : '') + (key === 32 ? 'Space' : key >= 112 ? 'F' + (key - 111) : String.fromCharCode(key));
    return { modifiers: mods, key: key, label: label };
  }
  function captured(mods, key) {
    if (!Number.isInteger(mods) || mods < 1 || mods > 7 || !Number.isInteger(key)) throw Error('Invalid captured shortcut.');
    return parse((mods & 2 ? 'Ctrl+' : '') + (mods & 1 ? 'Alt+' : '') + (mods & 4 ? 'Shift+' : '') + (key === 32 ? 'Space' : key >= 112 && key <= 122 ? 'F' + (key - 111) : String.fromCharCode(key)));
  }
  function preview(value) {
    var config = parse(value);
    if ((config.modifiers & 2) && (config.key === 70 || config.key === 82)) throw Error('Ctrl+F and Ctrl+R are reserved for search and refresh.');
    return config;
  }
  function matches(event, config) {
    var mods = (event.ctrlKey ? 2 : 0) | (event.altKey ? 1 : 0) | (event.shiftKey ? 4 : 0);
    var name = event.key || '';
    var key = name === ' ' || name === 'Spacebar' || name === 'Space' || event.code === 'Space' || event.keyCode === 32 || event.which === 32 ? 32 : /^F([1-9]|10|11)$/.test(event.key) ? 111 + Number(event.key.slice(1)) : name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0;
    return !event.metaKey && mods === config.modifiers && key === config.key;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { parse: parse, captured: captured, preview: preview, matches: matches };
  root.BinSearchShortcut = { parse: parse, captured: captured, preview: preview, matches: matches };
}(this));
