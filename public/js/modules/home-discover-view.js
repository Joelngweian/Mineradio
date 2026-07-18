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

  function buildFallbackTiles(fallbackHomeTiles) {
    return typeof fallbackHomeTiles === 'function' ? fallbackHomeTiles() : [];
  }

  function buildHomeTiles(input, helpers) {
    input = input || {};
    helpers = helpers || {};
    var summary = input.summary || {};
    var discoverState = input.discoverState || {};
    var loggedOutHome = !!input.loggedOutHome;
    var weatherSongs = Array.isArray(input.weatherSongs) ? input.weatherSongs : [];
    var songSourceLabel = helperFn(helpers, 'songSourceLabel', function() { return ''; });
    var compactHomeCount = helperFn(helpers, 'compactHomeCount', function(value) { return String(value || 0); });
    var tiles = [];

    if (summary.recent && tiles.length < 5) {
      tiles.push({ kind: 'recent', title: summary.recent.name || '继续听', sub: summary.recent.artist || summary.recent.source || '', cover: summary.recent.cover, record: summary.recent });
    }
    if (summary.topArtist && tiles.length < 5) {
      tiles.push({ kind: 'profile', title: summary.topArtist.name, sub: '常听歌手 · ' + summary.topArtist.plays + ' 次', query: summary.topArtist.name });
    }
    if (!loggedOutHome) {
      (discoverState.songs || []).slice(0, Math.max(0, 4 - tiles.length)).forEach(function(song, i) {
        tiles.push({ kind: 'song', index: i, song: song, title: song.name || '今日歌曲', sub: song.artist || songSourceLabel(song) });
      });
      (discoverState.playlists || []).slice(0, Math.max(0, 5 - tiles.length)).forEach(function(pl, i) {
        tiles.push({ kind: 'playlist', index: i, title: pl.name || '推荐歌单', sub: (pl.trackCount ? pl.trackCount + ' 首' : 'Playlist') + (pl.playCount ? ' · ' + compactHomeCount(pl.playCount) + ' 播放' : ''), cover: pl.cover });
      });
      if (tiles.length < 5) {
        (discoverState.podcasts || []).slice(0, 5 - tiles.length).forEach(function(p, i) {
          tiles.push({ kind: 'podcast', index: i, title: p.name || '热门播客', sub: p.djName || p.category || 'Podcast', cover: p.cover });
        });
      }
    }
    if (tiles.length < 5) {
      weatherSongs.slice(0, 5 - tiles.length).forEach(function(song, i) {
        tiles.push({ kind: 'weatherSong', index: i, song: song, title: song.name || '天气电台歌曲', sub: song.artist || songSourceLabel(song) });
      });
    }
    if (!tiles.length) tiles = buildFallbackTiles(helpers.fallbackHomeTiles);
    return tiles.slice(0, 5);
  }

  function homeRailCopy(summary, loggedOutHome, discoverState, weatherSongs) {
    summary = summary || {};
    discoverState = discoverState || {};
    weatherSongs = Array.isArray(weatherSongs) ? weatherSongs : [];
    var liveNote = discoverState.updatedAt ? '刚刚更新 · 点击即可播放' : '点击即可播放';
    return {
      title: summary.recent ? '接着听' : (loggedOutHome ? '先从这里开始' : '你的歌单与推荐'),
      note: discoverState.loading
        ? '正在整理推荐'
        : (loggedOutHome && !weatherSongs.length ? '不会自动拉取外部推荐' : (discoverState.error ? '离线精选' : liveNote))
    };
  }

  function renderHomeTilesHtml(tiles, helpers) {
    helpers = helpers || {};
    var esc = helperFn(helpers, 'escHtml', fallbackEscHtml);
    var cssImageUrl = helperFn(helpers, 'cssImageUrl', function(value) { return String(value || '').replace(/"/g, '\\"'); });
    var homeTileCover = helperFn(helpers, 'homeTileCover', function(item) {
      return item && (item.cover || item.song && item.song.cover || '');
    });
    var homeToneForItem = helperFn(helpers, 'homeToneForItem', function() { return 'default'; });
    var loading = !!helpers.loading;
    return (Array.isArray(tiles) ? tiles : []).map(function(item, i) {
      var cover = homeTileCover(item);
      var tone = homeToneForItem(item, i);
      var coverClass = 'home-tile-cover' + (cover ? ' has-cover' : '');
      return '<button class="home-tile' + (!cover && loading ? ' home-skeleton' : '') + '" data-home-tone="' + esc(tone) + '" type="button" onclick="handleHomeTileClick(' + i + ')">' +
        '<div class="' + coverClass + '" style="' + (cover ? 'background-image:url(&quot;' + esc(cssImageUrl(cover)) + '&quot;)' : '') + '"></div>' +
        '<div class="home-tile-title">' + esc(item && item.title || '') + '</div>' +
        '<div class="home-tile-sub">' + esc(item && item.sub || '') + '</div>' +
      '</button>';
    }).join('');
  }

  global.MineradioModules.homeDiscoverView = {
    buildHomeTiles: buildHomeTiles,
    homeRailCopy: homeRailCopy,
    renderHomeTilesHtml: renderHomeTilesHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
