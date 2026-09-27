'use strict';

function createLoginService(options) {
  const {
    getCookie = () => '',
    parseCookieString,
    getYTMusic = async () => { throw new Error('YTM_UNAVAILABLE'); },
    now = () => Date.now(),
    logger = console,
    cacheMs = 15 * 60 * 1000,
  } = options || {};
  if (typeof parseCookieString !== 'function') throw new Error('LOGIN_SERVICE_COOKIE_PARSER_REQUIRED');

  let cached = null;
  let pending = null;
  let revision = 0;

  function loggedOutInfo(cookie) {
    return {
      loggedIn: false,
      provider: 'youtube',
      hasCookie: !!cookie,
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: '无VIP',
      profilePending: false,
    };
  }

  function fastInfo(cookie) {
    if (!cookie) return loggedOutInfo(cookie);
    const values = parseCookieString(cookie);
    return {
      loggedIn: true,
      provider: 'youtube',
      userId: values.SID ? ('ytm_' + String(values.SID).slice(0, 8)) : 'ytm_user',
      nickname: 'YouTube Music 会员',
      email: '',
      handle: '',
      avatar: '',
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: 'YouTube Music',
      hasCookie: true,
      profilePending: true,
    };
  }

  function cachedInfo(cookie) {
    if (!cached || cached.cookie !== cookie || now() - cached.at >= cacheMs) return null;
    return { ...cached.info, profilePending: false };
  }

  async function hydrate(cookie, base) {
    if (pending && pending.cookie === cookie) return pending.promise;
    const requestRevision = revision;
    const promise = (async () => {
      const profile = { nickname: base.nickname, email: '', handle: '', avatar: '' };
      try {
        const yt = await getYTMusic();
        if (yt && yt.account) {
          const account = await yt.account.getInfo();
          const entries = account && account.contents && account.contents.contents ? account.contents.contents : [];
          const selected = entries.find(item => item.type === 'AccountItem' && item.is_selected)
            || entries.find(item => item.type === 'AccountItem') || {};
          profile.nickname = (selected.account_name && selected.account_name.text)
            || (selected.channel_handle && selected.channel_handle.text) || profile.nickname;
          profile.email = (selected.account_byline && selected.account_byline.text) || '';
          profile.handle = (selected.channel_handle && selected.channel_handle.text) || '';
          profile.avatar = selected.account_photo && selected.account_photo.length ? (selected.account_photo[0].url || '') : '';
        }
      } catch (error) {
        logger.warn('[LoginProfile]', error && error.message || error);
      }
      const info = {
        ...base,
        userId: profile.handle || profile.email || base.userId,
        nickname: profile.nickname,
        email: profile.email,
        handle: profile.handle,
        avatar: profile.avatar,
        profilePending: false,
      };
      if (requestRevision === revision && getCookie() === cookie) cached = { cookie, info, at: now() };
      return info;
    })();
    pending = { cookie, promise };
    try {
      return await promise;
    } finally {
      if (pending && pending.promise === promise) pending = null;
    }
  }

  async function getInfo(requestOptions) {
    requestOptions = requestOptions || {};
    const cookie = String(getCookie() || '').trim();
    const base = fastInfo(cookie);
    if (!base.loggedIn) return base;
    const hit = cachedInfo(cookie);
    if (hit) return hit;
    if (requestOptions.hydrate === false) return base;
    return hydrate(cookie, base);
  }

  function reset() {
    revision += 1;
    cached = null;
    pending = null;
  }

  return { getInfo, reset };
}

module.exports = { createLoginService };
