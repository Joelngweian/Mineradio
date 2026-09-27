function readIndex(target) {
  var value = target && target.dataset ? target.dataset.index : '';
  if (value === '' || value == null) return null;
  var index = Number(value);
  return Number.isInteger(index) ? index : null;
}

function createDynamicActionDelegator(options) {
  options = options || {};
  var documentRef = options.document || document;
  var actions = options.actions || {};
  var bound = false;

  function onClick(event) {
    var origin = event.target;
    var target = origin && origin.closest ? origin.closest('[data-action]') : null;
    if (!target) return;
    var action = target.dataset.action;
    var handler = actions[action];
    if (typeof handler !== 'function') return;
    if (target.dataset.stopPropagation === 'true') event.stopPropagation();
    event.preventDefault();
    handler({
      event: event,
      target: target,
      index: readIndex(target),
      value: target.dataset.value || '',
      source: target.dataset.source || '',
      playlistId: target.dataset.playlistId || ''
    });
  }

  function bind() {
    if (bound || !documentRef) return;
    documentRef.addEventListener('click', onClick);
    bound = true;
  }

  function unbind() {
    if (!bound || !documentRef) return;
    documentRef.removeEventListener('click', onClick);
    bound = false;
  }

  return { bind: bind, unbind: unbind };
}

export { createDynamicActionDelegator };
