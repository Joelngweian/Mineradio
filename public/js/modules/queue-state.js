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

  function renderQueueItemHtml(song, index, currentIndex, helpers) {
    helpers = helpers || {};
    song = song || {};
    var esc = helperFn(helpers, 'escHtml', fallbackEscHtml);
    var coverSrc = helperFn(helpers, 'songCoverSrc', function(item) {
      return item && (item.cover || item.pic || item.albumCover || item.customCover) || '';
    });
    var isLiked = helperFn(helpers, 'isSongLiked', function() { return false; });
    var heartIcon = helperFn(helpers, 'heartIconSvg', function() { return '♡'; });
    var plusIcon = helperFn(helpers, 'playlistPlusIconSvg', function() { return '+'; });
    var thumb = coverSrc(song, 60);
    var imgTag = thumb
      ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async" onerror="this.style.opacity=0.2">'
      : '<div style="width:38px;height:38px;border-radius:6px;background:rgba(255,255,255,.06);flex-shrink:0"></div>';
    var liked = !!isLiked(song);
    return '<div class="queue-item' + (index === currentIndex ? ' now' : '') + '" onclick="playQueueAt(' + index + ')">' +
      imgTag +
      '<div class="qi-info"><div class="qi-name">' + esc(song.name) + '</div><div class="qi-sub"><button class="queue-artist-link" type="button" onclick="event.stopPropagation();openQueueArtist(' + index + ')">' + esc(song.artist || '未知歌手') + '</button></div></div>' +
      '<div class="qi-act">' +
        '<button class="' + (liked ? 'liked' : '') + '" onclick="event.stopPropagation();toggleLikeQueueIndex(' + index + ')" title="' + (liked ? '取消红心' : '红心喜欢') + '">' + heartIcon() + '</button>' +
        '<button class="queue-next" onclick="event.stopPropagation();queueIndexNext(' + index + ')" title="下一首播放">下</button>' +
        '<button onclick="event.stopPropagation();collectQueueIndex(' + index + ')" title="收藏到歌单">' + plusIcon() + '</button>' +
        '<button onclick="event.stopPropagation();removeFromQueue(' + index + ')" title="移除">×</button>' +
      '</div>' +
    '</div>';
  }

  function renderQueueItemsHtml(queue, currentIndex, helpers) {
    if (!Array.isArray(queue) || !queue.length) return '';
    return queue.map(function(song, index) {
      return renderQueueItemHtml(song, index, currentIndex, helpers);
    }).join('');
  }

  global.MineradioModules.queueState = {
    queueTextKey: queueTextKey,
    isPlaceholderQueueText: isPlaceholderQueueText,
    isValidQueueSong: isValidQueueSong,
    isUsefulRadioSong: isUsefulRadioSong,
    renderQueueItemHtml: renderQueueItemHtml,
    renderQueueItemsHtml: renderQueueItemsHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
