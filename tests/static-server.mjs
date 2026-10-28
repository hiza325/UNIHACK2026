/* Zero-dependency static file server for local dev and Playwright's webServer. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnyRouterSupportReply } from '../api/support.js';
import { processOtpRequest } from '../api/auth/otp.js';
import signupHandler from '../api/auth/signup.js';
import verifyHandler from '../api/auth/verify.js';
import loginHandler from '../api/auth/login.js';
import resendHandler from '../api/auth/resend.js';
import sessionHandler from '../api/auth/session.js';
import logoutHandler from '../api/auth/logout.js';
import adminUsersHandler from '../api/admin/users.js';
import debateHandler from '../api/debate.js';
import credentialsHandler from '../api/credentials/index.js';
import learningRecordsHandler from '../api/learning-records/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT || 8173);

// Local development only. Production platforms inject these values directly.
try {
  const envFile = await readFile(join(root, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {
  // .env is optional; the support endpoint reports missing configuration.
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2'
};

const API_HANDLERS = new Map([
  ['/api/auth/signup', signupHandler], ['/api/auth/verify', verifyHandler],
  ['/api/auth/login', loginHandler], ['/api/auth/resend', resendHandler],
  ['/api/auth/session', sessionHandler], ['/api/auth/logout', logoutHandler],
  ['/api/admin/users', adminUsersHandler],
  ['/api/debate', debateHandler],
  ['/api/credentials', credentialsHandler],
  ['/api/learning-records', learningRecordsHandler],
]);

async function runApiHandler(handler, req, res) {
  let rawBody = '';
  if (!['GET', 'HEAD'].includes(req.method)) {
    for await (const chunk of req) {
      rawBody += chunk;
      if (rawBody.length > 65536) throw Object.assign(new Error('Request too large'), { status: 413 });
    }
  }
  const headers = {};
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(payload)); return this; },
  };
  const url = new URL(req.url, `http://${req.headers.host}`);
  await handler({ method: req.method, headers: req.headers, body: rawBody || undefined, query: Object.fromEntries(url.searchParams) }, response);
}

export function createStaticServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (API_HANDLERS.has(url.pathname)) {
        await runApiHandler(API_HANDLERS.get(url.pathname), req, res);
        return;
      }
      if (url.pathname === '/api/auth/otp') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        let rawBody = '';
        for await (const chunk of req) {
          rawBody += chunk;
          if (rawBody.length > 16384) throw Object.assign(new Error('Request too large'), { status: 413 });
        }
        const result = await processOtpRequest(JSON.parse(rawBody));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
        return;
      }
      if (url.pathname === '/api/support') {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'POST' });
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        let rawBody = '';
        for await (const chunk of req) {
          rawBody += chunk;
          if (rawBody.length > 65536) throw Object.assign(new Error('Request too large'), { status: 413 });
        }
        const text = await createAnyRouterSupportReply(JSON.parse(rawBody));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ text }));
        return;
      }
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const filePath = normalize(join(root, pathname));
      if (!filePath.startsWith(normalize(root))) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      const status = Number(error.status) || (error instanceof SyntaxError ? 400 : 404);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status >= 500 ? 'Support AI is temporarily unavailable' : error.message }));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  createStaticServer().listen(port, () => console.log(`Serving ${root} at http://127.0.0.1:${port}`));
}
