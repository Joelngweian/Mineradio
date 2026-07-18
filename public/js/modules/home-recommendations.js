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

  global.MineradioModules.homeRecommendations = {
    normalizeArtistNameForMatch: normalizeArtistNameForMatch,
    artistMatchScore: artistMatchScore
  };
})(typeof window !== 'undefined' ? window : globalThis);
