const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const workflow = require('./api/roboflow-workflow');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  response.status = code => { response.statusCode = code; return response; };
  response.json = body => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
  };
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/api/roboflow-workflow') {
      if (request.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 12 * 1024 * 1024) {
            response.status(413).json({ error: 'Receipt image is too large. Upload a smaller image.' });
            return;
          }
          chunks.push(chunk);
        }
        try { request.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { response.status(400).json({ error: 'Invalid JSON request' }); return; }
      }
      await workflow(request, response);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    // Only public frontend files are served; never expose keys or backend code.
    const extension = path.extname(name).toLowerCase();
    if (name.includes('/') || name.includes('\\') || name.startsWith('.') ||
        name === 'local-server.js' || !types[extension]) {
      response.status(404).end(); return;
    }
    const file = path.join(root, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.status(404).end(); return;
    }
    response.setHeader('Content-Type', types[extension]);
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
  } catch {
    if (!response.headersSent) response.status(500).json({ error: 'Local server request failed' });
    else response.end();
  }
});

const port = Number(process.env.PORT || 8001);
server.listen(port, '127.0.0.1', () => {
  console.log('GCord is running at http://localhost:' + server.address().port + '/scan.html');
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
