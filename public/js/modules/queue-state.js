(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function queueTextKey(text) {
    return String(text || '').trim().toLowerCase().replace(/[\s._()[\]{}'"|/\\:-]+/g, '');
  }

  function isPlaceholderQueueText(text) {
    var key = queueTextKey(text);
    return key === 'unknown'
      || key === 'unknownartist'
      || key === 'variousartists'
      || key === 'artist'
      || key === 'loading'
      || key === '加载中'
      || key === '正在载入'
      || key === '未知'
      || key === '未知歌曲'
      || key === '未知歌手'
      || key === '未知艺术家'
      || key === '群星';
  }

  function isValidQueueSong(song) {
    if (!song || typeof song !== 'object') return false;
    var name = String(song.name || song.title || '').trim();
    if (!name || isPlaceholderQueueText(name)) return false;
    if (song.type === 'local' || song.source === 'local') return !!(song.localKey || song.url || song.filePath || song.path);
    if (song.type === 'podcast' || song.source === 'podcast') return !!(song.programId || song.id);
    var artist = String(song.artist || '').trim();
    if (!artist || isPlaceholderQueueText(artist)) return false;
    if (!(song.id || song.mid || song.videoId)) return false;
    if (!(song.cover || song.pic || song.albumCover || song.customCover)) return false;
    return true;
  }

  function isUsefulRadioSong(song) {
    if (!song || !song.id || !song.name || !song.artist || !song.cover) return false;
    var name = String(song.name || '').trim().toLowerCase();
    var artist = String(song.artist || '').trim().toLowerCase();
    return !/^(unknown|未知|未知歌曲)$/.test(name) && !/^(unknown artist|unknown|未知|未知歌手)$/.test(artist);
  }

  global.MineradioModules.queueState = {
    queueTextKey: queueTextKey,
    isPlaceholderQueueText: isPlaceholderQueueText,
    isValidQueueSong: isValidQueueSong,
    isUsefulRadioSong: isUsefulRadioSong
  };
})(typeof window !== 'undefined' ? window : globalThis);
