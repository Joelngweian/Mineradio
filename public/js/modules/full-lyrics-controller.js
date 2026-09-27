function createFullLyricsController(options) {
  options = options || {};

  function getDocument() {
    return options.document || globalThis.document;
  }

  function getState() {
    return typeof options.getState === 'function' ? options.getState() || {} : {};
  }

  function setState(patch) {
    if (typeof options.setState === 'function') options.setState(patch || {});
  }

  function now() {
    return typeof options.now === 'function' ? options.now() : Date.now();
  }

  function defer(callback, delay) {
    var schedule = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout;
    return schedule(callback, delay);
  }

  function currentMeta() {
    var song = typeof options.currentLyricSong === 'function' ? options.currentLyricSong() : null;
    song = song || {};
    return {
      title: song.name || song.title || '歌词',
      artist: song.artist || song.ar || song.author || ''
    };
  }

  function buildState() {
    var state = getState();
    var meta = currentMeta();
    var audio = state.audio;
    var currentTime = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
    var view = options.fullLyricsView;
    if (!view || typeof view.buildFullLyricsViewState !== 'function') return null;
    return view.buildFullLyricsViewState({
      lines: state.lyricsLines,
      currentTime: currentTime,
      visible: state.fullLyricsVisible,
      title: meta.title,
      artist: meta.artist,
      timingSource: state.lyricsTimingSource
    });
  }

  function seekLine(index) {
    var state = getState();
    var audio = state.audio;
    var lines = state.lyricsLines;
    if (!audio || !Array.isArray(lines) || index < 0 || !lines[index]) return;
    var time = Number(lines[index].t);
    if (!isFinite(time)) return;
    audio.currentTime = Math.max(0, time);
    setState({ fullLyricsUserScrollUntil: 0 });
    syncActiveLine(true);
  }

  function bindListEvents(list) {
    if (!list || list._mineradioFullLyricsBound) return;
    list._mineradioFullLyricsBound = true;
    list.addEventListener('scroll', function() {
      if (getState().fullLyricsProgrammaticScroll) return;
      setState({ fullLyricsUserScrollUntil: now() + 4500 });
    }, { passive: true });
    list.addEventListener('click', function(event) {
      var row = event.target && event.target.closest ? event.target.closest('.full-lyric-line') : null;
      if (!row || !list.contains(row)) return;
      seekLine(parseInt(row.getAttribute('data-lyric-index') || '-1', 10));
    });
  }

  function updateToggleButton() {
    var documentRef = getDocument();
    var button = documentRef && documentRef.querySelector('.lyrics-toggle-btn');
    if (!button) return;
    var visible = !!getState().fullLyricsVisible;
    button.classList.toggle('active', visible);
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    button.title = visible ? '关闭全文歌词' : '全文歌词';
  }

  function render(forceScroll) {
    var documentRef = getDocument();
    var panel = documentRef && documentRef.getElementById('full-lyrics-panel');
    var list = documentRef && documentRef.getElementById('full-lyrics-list');
    var view = options.fullLyricsView;
    if (!panel || !list || !view || typeof view.renderFullLyricsHtml !== 'function') return;
    bindListEvents(list);
    var viewState = buildState();
    if (!viewState) return;
    var title = documentRef.getElementById('full-lyrics-title');
    var artist = documentRef.getElementById('full-lyrics-artist');
    if (title) title.textContent = viewState.title || '歌词';
    if (artist) artist.textContent = viewState.artist || '';
    var visible = !!getState().fullLyricsVisible;
    panel.classList.toggle('show', visible);
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true');
    list.innerHTML = view.renderFullLyricsHtml(viewState, { escHtml: options.escHtml });
    setState({ fullLyricsActiveIndex: -9999 });
    syncActiveLine(forceScroll);
    updateToggleButton();
  }

  function syncActiveLine(forceScroll) {
    var state = getState();
    var view = options.fullLyricsView;
    if (!state.fullLyricsVisible || !view) return;
    var documentRef = getDocument();
    var list = documentRef && documentRef.getElementById('full-lyrics-list');
    if (!list) return;
    var viewState = buildState();
    if (!viewState || (viewState.activeIndex === state.fullLyricsActiveIndex && !forceScroll)) return;
    setState({ fullLyricsActiveIndex: viewState.activeIndex });
    var rows = list.querySelectorAll('.full-lyric-line');
    var activeRow = null;
    rows.forEach(function(row) {
      var index = parseInt(row.getAttribute('data-lyric-index') || '-1', 10);
      var active = index === viewState.activeIndex;
      row.classList.toggle('active', active);
      row.classList.toggle('passed', viewState.activeIndex >= 0 && index < viewState.activeIndex);
      if (active) activeRow = row;
    });
    if (activeRow && (forceScroll || now() > state.fullLyricsUserScrollUntil)) {
      setState({ fullLyricsProgrammaticScroll: true });
      if (typeof activeRow.scrollIntoView === 'function') {
        activeRow.scrollIntoView({ block: 'center', behavior: forceScroll ? 'auto' : 'smooth' });
      }
      defer(function() {
        setState({ fullLyricsProgrammaticScroll: false });
      }, forceScroll ? 180 : 900);
    }
  }

  function toggle(force) {
    var visible = getState().fullLyricsVisible;
    if (force === false) visible = false;
    else if (force === true) visible = true;
    else visible = !visible;
    setState({ fullLyricsVisible: visible, lyricsVisible: visible });
    render(true);
    if (typeof options.showToast === 'function') options.showToast(visible ? '全文歌词已打开' : '全文歌词已关闭');
  }

  function updateHighlight() {
    if (getState().fullLyricsVisible) syncActiveLine(false);
  }

  return {
    render: render,
    seekLine: seekLine,
    syncActiveLine: syncActiveLine,
    toggle: toggle,
    updateHighlight: updateHighlight
  };
}

export {
  createFullLyricsController,
};
