const test = require('node:test');
const assert = require('node:assert/strict');

const { createLoginService } = require('../server/services/login-service');

function parseCookieString(cookie) {
  return String(cookie || '').split(';').reduce((values, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return values;
    values[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
    return values;
  }, {});
}

test('login status returns immediately and profile hydration is coalesced', async () => {
  let accountRequests = 0;
  const service = createLoginService({
    getCookie: () => 'SID=profile-test-cookie',
    parseCookieString,
    logger: { warn() {} },
    getYTMusic: async () => {
      accountRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return {
        account: {
          getInfo: async () => ({
            contents: {
              contents: [{
                type: 'AccountItem',
                is_selected: true,
                account_name: { text: 'Mineradio Test' },
                account_byline: { text: 'test@example.com' },
                channel_handle: { text: '@mineradio-test' },
                account_photo: [{ url: 'https://example.com/avatar.jpg' }],
              }],
            },
          }),
        },
      };
    },
  });

  const fastInfo = await service.getInfo({ hydrate: false });
  assert.equal(fastInfo.loggedIn, true);
  assert.equal(fastInfo.profilePending, true);
  assert.equal(accountRequests, 0);

  const [firstProfile, secondProfile] = await Promise.all([service.getInfo(), service.getInfo()]);
  assert.equal(accountRequests, 1);
  assert.equal(firstProfile.nickname, 'Mineradio Test');
  assert.equal(firstProfile.email, 'test@example.com');
  assert.equal(firstProfile.avatar, 'https://example.com/avatar.jpg');
  assert.equal(firstProfile.profilePending, false);
  assert.deepEqual(secondProfile, firstProfile);

  const cachedProfile = await service.getInfo({ hydrate: false });
  assert.equal(accountRequests, 1);
  assert.equal(cachedProfile.profilePending, false);
  assert.equal(cachedProfile.nickname, 'Mineradio Test');
});

test('reset prevents an old cookie profile from being retained', async () => {
  let cookie = 'SID=old-cookie';
  let releaseOldRequest;
  const oldRequest = new Promise(resolve => { releaseOldRequest = resolve; });
  const service = createLoginService({
    getCookie: () => cookie,
    parseCookieString,
    logger: { warn() {} },
    getYTMusic: async () => ({
      account: {
        getInfo: async () => {
          if (cookie.includes('old-cookie')) await oldRequest;
          return {
            contents: {
              contents: [{
                type: 'AccountItem',
                is_selected: true,
                account_name: { text: cookie.includes('new-cookie') ? 'New Account' : 'Old Account' },
              }],
            },
          };
        },
      },
    }),
  });

  const oldProfile = service.getInfo();
  cookie = 'SID=new-cookie';
  service.reset();
  releaseOldRequest();
  await oldProfile;

  const newProfile = await service.getInfo();
  assert.equal(newProfile.nickname, 'New Account');
});
