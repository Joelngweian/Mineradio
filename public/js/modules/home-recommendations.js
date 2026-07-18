(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function normalizeArtistNameForMatch(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[\s·・,，、/\\|&＋+_-]+/g, '')
      .replace(/[()（）\[\]【】"'“”‘’]/g, '');
  }

  function artistMatchScore(artist, topArtists) {
    var actual = normalizeArtistNameForMatch(artist);
    if (!actual || !Array.isArray(topArtists)) return 0;
    return topArtists.some(function(name) {
      return name && (actual.indexOf(name) >= 0 || name.indexOf(actual) >= 0);
    }) ? 1 : 0;
  }

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

  function renderRecommendationCard(song, index, helpers) {
    helpers = helpers || {};
    song = song || {};
    var esc = helperFn(helpers, 'escHtml', fallbackEscHtml);
    var coverSrc = helperFn(helpers, 'songCoverSrc', function(item) {
      return item && (item.cover || item.pic || item.albumCover || item.customCover) || '';
    });
    var sourceLabel = helperFn(helpers, 'songSourceLabel', function() { return ''; });
    var cssImageUrl = helperFn(helpers, 'cssImageUrl', function(value) { return String(value || '').replace(/'/g, "\\'"); });
    var cover = coverSrc(song, 220);
    var sub = song.artist || sourceLabel(song) || '推荐歌曲';
    return '<button class="home-pl-card home-rec-card" type="button" onclick="playHomeRecommendation(' + index + ')" title="' + esc(song.name || '') + '">' +
      '<div class="home-pl-cover' + (cover ? ' has-cover' : '') + '"' + (cover ? ' style="background-image:url(\'' + cssImageUrl(cover) + '\')"' : '') + '></div>' +
      '<div class="home-pl-name">' + esc(song.name || '推荐歌曲') + '</div>' +
      '<div class="home-pl-sub">' + esc(sub) + '</div>' +
    '</button>';
  }

  function renderRecommendationCards(recommendations, helpers) {
    if (!Array.isArray(recommendations) || !recommendations.length) {
      return '<div class="home-pl-empty">播放几首歌后生成推荐</div>';
    }
    return recommendations.map(function(song, index) {
      return renderRecommendationCard(song, index, helpers);
    }).join('');
  }

  global.MineradioModules.homeRecommendations = {
    normalizeArtistNameForMatch: normalizeArtistNameForMatch,
    artistMatchScore: artistMatchScore,
    renderRecommendationCard: renderRecommendationCard,
    renderRecommendationCards: renderRecommendationCards
  };
})(typeof window !== 'undefined' ? window : globalThis);
