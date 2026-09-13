// Vite plugin: spawns server/devServer.js and proxies /api/* → it, so
// `npm run dev` behaves like `vercel dev` (API + SPA on one origin).

import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Finds a free local port (starting at the default) so a stray prior dev API
// process can never block `npm run dev`.
function nextFreePort(start = 8787) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.unref();
      srv.once('error', () => tryPort(port + 1));
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address();
        const portUsed = typeof addr === 'object' && addr ? addr.port : port;
        srv.close(() => resolve(portUsed));
      });
    };
    tryPort(start);
  });
}

export default function vercelDevApi() {
  let child = null;
  let apiPort = null;
  return {
    name: 'vercel-dev-api',
    async configureServer(server) {
      apiPort = await nextFreePort();
      child = spawn(process.execPath, [path.join(rootDir, 'server', 'devServer.js')], {
        cwd: rootDir,
        env: { ...process.env, NEON_DEV_API_PORT: String(apiPort) },
        stdio: 'inherit',
      });
      server.httpServer?.once('listening', () => {
        console.log(`[vercel-dev-api] proxying /api → http://127.0.0.1:${apiPort}`);
      });

      server.middlewares.use('/api', (req, res) => {
        if (!apiPort) {
          res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Dev API server is still starting — try again in a second.' }));
          return;
        }
        let pathname = req.url || '/';
        if (!pathname.startsWith('/api')) {
          pathname = '/api' + (pathname.startsWith('/') ? pathname : '/' + pathname);
        }
        const proxyReq = http.request(
          { host: '127.0.0.1', port: apiPort, path: pathname, method: req.method, headers: req.headers },
          (proxyRes) => {
            if (!res.headersSent) res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );
        proxyReq.on('error', (err) => {
          console.error('[vercel-dev-api] proxy error:', err.message);
          if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Dev API server unavailable. Restart `npm run dev`.' }));
        });
        req.pipe(proxyReq);
      });
    },
    closeBundle() {
      if (child) child.kill();
    },
  };
}