const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const publicRoot = path.resolve(__dirname, '..', '..', 'public');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function resolvePublicFile(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(publicRoot, relativePath);
  return target.startsWith(`${publicRoot}${path.sep}`) || target === publicRoot ? target : null;
}

http.createServer((request, response) => {
  const target = resolvePublicFile(request.url);
  if (!target) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(target, (error, body) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
    });
    response.end(body);
  });
}).listen(4310, '127.0.0.1', () => {
  console.log('Mineradio E2E static server listening on http://127.0.0.1:4310');
});
