const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');

const activeFiles = [
  'server.js',
  'desktop/main.js',
  'desktop/preload.js',
  'public/index.html',
  'README.md',
  'PRIVACY.md',
  'NOTICE.md',
  'SECURITY.md',
  'RELEASE.md',
  'CLAUDE.md',
  '.gitignore',
];

test('active app code and public docs contain no removed provider residue', () => {
  const removedProviderPattern = new RegExp(['s', 'pot', 'ify'].join(''), 'i');
  const offenders = activeFiles
    .map((file) => {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      const lines = source.split(/\r?\n/);
      const matches = lines
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => removedProviderPattern.test(entry.line));
      return { file, matches };
    })
    .filter((entry) => entry.matches.length);

  assert.deepEqual(
    offenders,
    [],
    offenders.map((entry) => (
      entry.file + ': ' + entry.matches.slice(0, 5).map((match) => match.number).join(', ')
    )).join('\n')
  );
});

test('account and login UI does not ship placeholder question-mark copy', () => {
  const source = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const start = source.indexOf('function renderUserBtn');
  const end = source.indexOf('var startupLoginGuideShown');

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.ok(end > start);

  const accountSource = source.slice(start, end);
  assert.doesNotMatch(accountSource, /\?{3,}/);
  assert.doesNotMatch(accountSource, /  \?  /);
  assert.match(accountSource, /YouTube Music/);
  assert.match(accountSource, /Google/);
});
