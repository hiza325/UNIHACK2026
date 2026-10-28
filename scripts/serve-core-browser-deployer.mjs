import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const uiRoot = join(root, 'internal', 'core-browser-deployer');
const defaultArtifactPath = join(root, 'artifacts', 'contracts', 'LearningCredentialRegistry.sol', 'LearningCredentialRegistry.json');
const ethersBundlePath = join(root, 'node_modules', 'ethers', 'dist', 'ethers.min.js');

const ROUTES = new Map([
  ['/', { path: join(uiRoot, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/app.js', { path: join(uiRoot, 'app.js'), type: 'text/javascript; charset=utf-8' }],
  ['/provider-guard.js', { path: join(uiRoot, 'provider-guard.js'), type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { path: join(uiRoot, 'styles.css'), type: 'text/css; charset=utf-8' }],
  ['/vendor/ethers.min.js', { path: ethersBundlePath, type: 'text/javascript; charset=utf-8' }],
]);

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

function send(res, status, type, body, method = 'GET') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
  res.end(method === 'HEAD' ? undefined : body);
}

async function validatedArtifact(artifactPath) {
  const body = await readFile(artifactPath);
  const artifact = JSON.parse(body.toString('utf8'));
  if (artifact.contractName !== 'LearningCredentialRegistry') throw new Error('Unexpected Hardhat artifact contract name');
  if (!Array.isArray(artifact.abi)) throw new Error('Hardhat artifact ABI is missing');
  if (!/^0x[0-9a-fA-F]+$/.test(artifact.bytecode || '') || artifact.bytecode === '0x') throw new Error('Hardhat deployment bytecode is missing');
  if (!/^0x[0-9a-fA-F]+$/.test(artifact.deployedBytecode || '') || artifact.deployedBytecode === '0x') throw new Error('Hardhat runtime bytecode is missing');
  return body;
}

export function createCoreDeployerServer({ artifactPath = defaultArtifactPath } = {}) {
  return createServer(async (req, res) => {
    try {
      const host = String(req.headers.host || '');
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) {
        send(res, 403, 'text/plain; charset=utf-8', 'Loopback host required', req.method);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method || '')) {
        res.setHeader('Allow', 'GET, HEAD');
        send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed', req.method);
        return;
      }

      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/artifact.json') {
        send(res, 200, 'application/json; charset=utf-8', await validatedArtifact(artifactPath), req.method);
        return;
      }

      const route = ROUTES.get(url.pathname);
      if (!route || !normalize(route.path).startsWith(normalize(root))) {
        send(res, 404, 'text/plain; charset=utf-8', 'Not found', req.method);
        return;
      }
      send(res, 200, route.type, await readFile(route.path), req.method);
    } catch (error) {
      send(res, 500, 'text/plain; charset=utf-8', `Core deployer unavailable: ${error.message}`, req.method);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Core Browser Deployer is localhost-only and cannot run with NODE_ENV=production');
  }
  const port = Number(process.env.CORE_DEPLOYER_PORT || 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CORE_DEPLOYER_PORT must be an integer from 1024 to 65535');

  const server = createCoreDeployerServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`PARADOX Core Browser Deployer: http://127.0.0.1:${port}/`);
    console.log('Localhost only. Opening the page does not connect a wallet or send a transaction.');
  });
}
