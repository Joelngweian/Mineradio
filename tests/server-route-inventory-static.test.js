const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server-app.js'), 'utf8');

function uniqueSorted(list) {
  return Array.from(new Set(list)).sort();
}

test('server keeps an explicit inventory for every raw API route branch', () => {
  const branchRoutes = uniqueSorted(Array.from(serverSource.matchAll(/pn === '([^']+)'/g)).map(match => match[1]).filter(route => route.startsWith('/api/')));
  const inventoryMatch = serverSource.match(/const API_ROUTE_PATHS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(inventoryMatch, 'server-app.js should define API_ROUTE_PATHS near the raw http route handler');
  const inventoryRoutes = uniqueSorted(Array.from(inventoryMatch[1].matchAll(/'([^']+)'/g)).map(match => match[1]));

  assert.deepEqual(inventoryRoutes, branchRoutes);
  assert.equal(inventoryRoutes.length, 41);
});

test('unknown api paths return json 404 before static fallback', () => {
  assert.match(serverSource, /pn\.startsWith\('\/api\/'\) && !API_ROUTE_SET\.has\(pn\)/);
  assert.match(serverSource, /API_ROUTE_NOT_FOUND/);
  assert.ok(serverSource.indexOf('API_ROUTE_NOT_FOUND') < serverSource.indexOf("pn === '/favicon.ico'"));
});
