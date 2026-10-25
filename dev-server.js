/**
 * Lightweight dev server for AI Studio Web Preview.
 * Serves the NetMod UI renderer on port 3000.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const RENDERER_DIR = path.join(__dirname, 'renderer');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let targetFile;

  if (urlPath === '/' || urlPath === '/index.html') {
    targetFile = path.join(RENDERER_DIR, 'index.html');
  } else if (urlPath.startsWith('/renderer/')) {
    targetFile = path.join(ROOT_DIR, urlPath);
  } else if (urlPath === '/styles.css' || urlPath === '/app.js') {
    targetFile = path.join(RENDERER_DIR, urlPath);
  } else {
    // Check if file exists in renderer, otherwise root
    const inRenderer = path.join(RENDERER_DIR, urlPath);
    const inRoot = path.join(ROOT_DIR, urlPath);
    if (fs.existsSync(inRenderer) && fs.statSync(inRenderer).isFile()) {
      targetFile = inRenderer;
    } else {
      targetFile = inRoot;
    }
  }

  // Ensure file is inside ROOT_DIR to prevent directory traversal
  const resolved = path.resolve(targetFile);
  if (!resolved.startsWith(ROOT_DIR) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    // Fallback to renderer index.html for SPA-style routing
    targetFile = path.join(RENDERER_DIR, 'index.html');
  }

  const ext = path.extname(targetFile).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(targetFile, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Wi-Fi OFF Scheduler Dev Server running at http://0.0.0.0:${PORT}`);
});
