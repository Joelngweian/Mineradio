'use strict';

function createRadioService(options) {
  const {
    getYTMusic,
    handleSearch,
    mapPanelVideo,
    logger = console,
  } = options || {};
  if (typeof getYTMusic !== 'function' || typeof handleSearch !== 'function' || typeof mapPanelVideo !== 'function') {
    throw new Error('RADIO_SERVICE_DEPENDENCIES_MISSING');
  }

  function songKey(song) {
    return song && (song.id || ((song.name || '') + '|' + (song.artist || '')));
  }

  function normText(text) {
    return String(text || '').toLowerCase().replace(/[\s._()[\]{}'"|/\\:-]+/g, '');
  }

  function isPlaceholder(text) {
    return /^(unknown|unknownartist|未知|未知歌手|variousartists)$/i.test(normText(text));
  }

  function isValidSong(song) {
    return !!(song && song.id && song.name && song.artist && song.cover &&
      !isPlaceholder(song.name) && !isPlaceholder(song.artist));
  }

  function seedMatches(song, title, artist) {
    const seedTitle = normText(title);
    if (!song || !seedTitle) return false;
    if (normText(song.name) !== seedTitle) return false;
    const seedArtist = normText(artist);
    const songArtist = normText(song.artist);
    return !seedArtist || !songArtist || songArtist.includes(seedArtist) || seedArtist.includes(songArtist);
  }

  async function findSeedBySearch(title, artist) {
    const query = [title, artist].filter(Boolean).join(' ');
    if (!query) return null;
    const found = await handleSearch(query, 8);
    return found.find(song => seedMatches(song, title, artist)) || found[0] || null;
  }

  async function fillSearchFallback(songs, seen, seed, title, artist, limit) {
    const target = Math.max(6, Math.min(Number(limit) || 18, 30));
    if (songs.length >= target) return songs;
    const exactQueries = [
      [title, artist].filter(Boolean).join(' '),
      artist ? `${artist} songs` : '',
      title || '',
    ].filter(Boolean);
    const artistQueries = [
      artist ? `${artist} songs` : '',
      [title, artist].filter(Boolean).join(' '),
      title || '',
    ].filter(Boolean);
    for (const query of (seed ? exactQueries : artistQueries)) {
      if (songs.length >= target) break;
      const found = await handleSearch(query, target + 6);
      for (const song of found) {
        const key = songKey(song);
        if (!isValidSong(song) || song.id === seed || seedMatches(song, title, artist) || seen.has(key) || seen.has(song.id)) continue;
        seen.add(song.id);
        seen.add(key);
        songs.push(song);
        if (songs.length >= target) break;
      }
    }
    return songs;
  }

  async function getRadioSongs(input) {
    let id = String(input && input.id || '').trim();
    const title = String(input && input.title || '').trim();
    const artist = String(input && input.artist || '').trim();
    const limit = Math.max(6, Math.min(Number(input && input.limit) || 18, 30));
    if (!id && !title && !artist) return { songs: [] };
    if (!id && title) {
      const seedMatch = await findSeedBySearch(title, artist);
      if (seedMatch && seedMatch.id) id = seedMatch.id;
    }

    let items = [];
    if (id) {
      try {
        const yt = await getYTMusic();
        const panel = await yt.music.getUpNext(id, true);
        items = (panel && panel.contents) || [];
      } catch (error) {
        logger.warn('[RadioUpNext]', id, error && error.message || error);
      }
    }

    const seen = new Set(id ? [id] : []);
    const songs = [];
    for (const item of items) {
      const song = mapPanelVideo(item);
      if (!song || !isValidSong(song) || seen.has(song.id)) continue;
      seen.add(song.id);
      songs.push(song);
    }
    if (songs.length < Math.min(6, limit)) await fillSearchFallback(songs, seen, id, title, artist, limit);
    logger.log('[Radio]', id || '-', title || '-', '/', artist || '-', 'upNext:', items.length, 'songs:', songs.length);
    return { seed: id, songs: songs.filter(isValidSong).slice(0, limit) };
  }

  return { getRadioSongs };
}

module.exports = { createRadioService };
