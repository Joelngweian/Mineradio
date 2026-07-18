(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function fallbackEscHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function helperFn(helpers, name, fallback) {
    return helpers && typeof helpers[name] === 'function' ? helpers[name] : fallback;
  }

  function renderPlaylistDetailHtml(state, helpers) {
    state = state || {};
    helpers = helpers || {};
    var esc = helperFn(helpers, 'escHtml', fallbackEscHtml);
    var songCoverSrc = helperFn(helpers, 'songCoverSrc', function(song) {
      return song && (song.cover || song.pic || song.albumCover || song.customCover) || '';
    });
    var key = state.key || '';
    var pl = state.playlist || {};
    var tracks = Array.isArray(state.tracks) ? state.tracks : [];
    var loading = !!state.loading;
    var initialRender = Math.max(1, Number(state.initialRender) || 20);
    var cover = pl && pl.cover ? (pl.cover + '?param=96y96') : '';
    var img = cover ? '<img class="pl-detail-cover" src="' + esc(cover) + '" alt="" decoding="async" onerror="this.style.opacity=0.2">' : '<div class="pl-detail-cover"></div>';
    var renderLimit = loading ? 0 : Math.max(initialRender, Number(state.renderLimit) || initialRender);
    renderLimit = Math.min(tracks.length, renderLimit);
    var visibleTracks = loading ? [] : tracks.slice(0, renderLimit);
    var rows = loading
      ? '<div class="pl-detail-row"><div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06)"></div><div style="flex:1;min-width:0"><div class="pl-detail-row-title">正在载入歌单</div><div class="pl-detail-row-artist">请稍候</div></div></div>'
      : visibleTracks.map(function(song, i) {
          var thumb = songCoverSrc(song, 60);
          var imgTag = thumb ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.2">' : '<div style="width:34px;height:34px;border-radius:7px;background:rgba(255,255,255,.06);flex:0 0 auto"></div>';
          return '<div class="pl-detail-row" data-pl-detail-row="' + i + '">' +
            imgTag +
            '<div style="flex:1;min-width:0"><div class="pl-detail-row-title">' + esc(song.name || '') + '</div>' +
            '<button type="button" class="pl-detail-row-artist" data-pl-detail-artist="' + i + '">' + esc(song.artist || '未知歌手') + '</button></div>' +
          '</div>';
        }).join('');
    if (!loading && !rows) rows = '<div style="text-align:center;padding:14px 0;color:rgba(255,255,255,.30);font-size:11.5px">歌单暂无可播放歌曲</div>';
    if (!loading && tracks.length > renderLimit) {
      rows += '<button type="button" class="fx-mini-btn ghost pl-detail-load-more" data-pl-detail-load-more="1">加载更多 ' + renderLimit + '/' + tracks.length + '</button>';
    } else if (!loading && tracks.length > initialRender) {
      rows += '<div class="pl-detail-progress">已显示全部 ' + tracks.length + ' 首</div>';
    }
    return '<div class="pl-inline-detail" data-pl-detail="' + esc(key) + '">' +
      '<div class="pl-detail-sticky">' +
        '<div class="pl-detail-head">' + img + '<div style="flex:1;min-width:0"><div class="pl-detail-title">' + esc(pl.name || '歌单详情') + '</div><div class="pl-detail-sub">' + esc((pl.trackCount || tracks.length || 0) + ' 首 · ' + (pl.creator || 'YouTube Music')) + '</div></div><div class="pl-detail-count">' + (loading ? '载入中' : (renderLimit + '/' + tracks.length)) + '</div></div>' +
        '<div class="pl-detail-actions"><button class="pl-detail-play" type="button" data-pl-detail-play="' + esc(key) + '"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>播放歌单</button><button class="fx-mini-btn ghost pl-detail-top-btn" type="button" data-pl-detail-top="1">回到顶部</button></div>' +
      '</div>' +
      '<div class="pl-detail-list">' + rows + '</div>' +
    '</div>';
  }

  global.MineradioModules.playlistDetailView = {
    renderPlaylistDetailHtml: renderPlaylistDetailHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
