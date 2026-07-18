(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function getHotkeyDefaults(actions) {
    var defaults = { local: {}, global: {} };
    (Array.isArray(actions) ? actions : []).forEach(function(action){
      defaults.local[action.key] = action.local || '';
      defaults.global[action.key] = action.global || '';
    });
    return defaults;
  }

  function hotkeyActionMeta(actions, actionKey) {
    actions = Array.isArray(actions) ? actions : [];
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].key === actionKey) return actions[i];
    }
    return null;
  }

  function isModifierKeyCode(code) {
    return /^(ControlLeft|ControlRight|ShiftLeft|ShiftRight|AltLeft|AltRight|MetaLeft|MetaRight)$/i.test(String(code || ''));
  }

  function normalizeHotkeyEvent(e) {
    if (!e || isModifierKeyCode(e.code)) return '';
    var mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Meta');
    var code = e.code || '';
    if (!code && e.key) code = String(e.key).length === 1 ? 'Key' + String(e.key).toUpperCase() : String(e.key);
    if (!code) return '';
    return mods.concat([code]).join('+');
  }

  function hotkeyDisplayPart(part) {
    if (part === 'Ctrl') return 'Ctrl';
    if (part === 'Alt') return 'Alt';
    if (part === 'Shift') return 'Shift';
    if (part === 'Meta') return 'Win';
    if (part === 'Space') return 'Space';
    if (part === 'ArrowLeft') return 'Left';
    if (part === 'ArrowRight') return 'Right';
    if (part === 'ArrowUp') return 'Up';
    if (part === 'ArrowDown') return 'Down';
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit[0-9]$/.test(part)) return part.slice(5);
    if (/^Numpad[0-9]$/.test(part)) return 'Num' + part.slice(6);
    return part.replace(/^Equal$/, '=').replace(/^Minus$/, '-');
  }

  function formatHotkey(hotkey) {
    hotkey = String(hotkey || '').trim();
    if (!hotkey) return '未设置';
    return hotkey.split('+').map(hotkeyDisplayPart).join(' + ');
  }

  function hotkeyToAccelerator(hotkey) {
    var parts = String(hotkey || '').split('+').filter(Boolean);
    if (!parts.length) return '';
    return parts.map(function(part){
      if (part === 'Ctrl') return 'Control';
      if (part === 'Alt') return 'Alt';
      if (part === 'Shift') return 'Shift';
      if (part === 'Meta') return 'Super';
      if (part === 'Space') return 'Space';
      if (part === 'ArrowLeft') return 'Left';
      if (part === 'ArrowRight') return 'Right';
      if (part === 'ArrowUp') return 'Up';
      if (part === 'ArrowDown') return 'Down';
      if (/^Key[A-Z]$/.test(part)) return part.slice(3);
      if (/^Digit[0-9]$/.test(part)) return part.slice(5);
      return part;
    }).join('+');
  }

  function hotkeyDuplicateMap(settings, scope) {
    var map = {};
    var source = (settings && settings[scope]) || {};
    Object.keys(source).forEach(function(action){
      var key = String(source[action] || '').trim();
      if (!key) return;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }

  global.MineradioModules.hotkeyState = {
    getHotkeyDefaults: getHotkeyDefaults,
    hotkeyActionMeta: hotkeyActionMeta,
    isModifierKeyCode: isModifierKeyCode,
    normalizeHotkeyEvent: normalizeHotkeyEvent,
    hotkeyDisplayPart: hotkeyDisplayPart,
    formatHotkey: formatHotkey,
    hotkeyToAccelerator: hotkeyToAccelerator,
    hotkeyDuplicateMap: hotkeyDuplicateMap
  };
})(typeof window !== 'undefined' ? window : globalThis);
