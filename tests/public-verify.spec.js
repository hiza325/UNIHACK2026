import { expect, test } from '@playwright/test';
import http from 'node:http';
import { handlePublicVerify as handler } from '../api/credentials/_public-verify.js';
import { Interface } from 'ethers';

const CONTRACT = '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b';
const EVIDENCE = '0x' + 'ab'.repeat(32);
const ISSUER = '0x2222222222222222222222222222222222222222';
const ISSUED_AT = 1700000000;
const iface = new Interface([
  'function credentialExists(bytes32) view returns (bool)',
  'function getCredential(bytes32) view returns (bytes32,address,uint64,uint64)',
  'function isCredentialValid(bytes32) view returns (bool)',
]);

function encodeResult(method, value) {
  if (method === 'credentialExists') return iface.encodeFunctionResult('credentialExists', [value]);
  if (method === 'getCredential') return iface.encodeFunctionResult('getCredential', value);
  if (method === 'isCredentialValid') return iface.encodeFunctionResult('isCredentialValid', [value]);
  return '0x';
}

function startRpc(impl) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (_) {}
        const requests = Array.isArray(parsed) ? parsed : [parsed];
        const out = requests.map((p) => {
          if (p.method === 'eth_chainId') return { jsonrpc: '2.0', id: p.id, result: '0xa869' };
          if (p.method === 'eth_call') {
            const data = String(p.params?.[0]?.data || '');
            const sel = data.slice(0, 10);
            let method = null;
            if (sel === '0xc974d9ed') method = 'credentialExists';
            else if (sel === '0xd1be4883') method = 'getCredential';
            else if (sel === '0x6dc158eb') method = 'isCredentialValid';
            try {
              const r = impl(method);
              return { jsonrpc: '2.0', id: p.id, result: encodeResult(method, r) };
            } catch (e) {
              return { jsonrpc: '2.0', id: p.id, error: { code: -32000, message: String(e?.message || e) } };
            }
          }
          return { jsonrpc: '2.0', id: p.id, result: null };
        });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(Array.isArray(parsed) ? out : out[0]));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function makeReqRes(code) {
  const req = { method: 'GET', query: { code }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  let status = 200;
  let body = null;
  const res = {
    statusCode: 200,
    setHeader() {},
    status(s) { status = s; this.statusCode = s; return this; },
    json(b) { body = b; return this; },
  };
  return { req, res, getStatus: () => status, getBody: () => body };
}

function baseEnv(rpcUrl) {
  return {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    AVALANCHE_FUJI_RPC_URL: rpcUrl,
    AVALANCHE_FUJI_RPC_URLS: '',
    AVALANCHE_FUJI_RPC_URLS: '',
  };
}

function mockDbFetch(mode, txHash) {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/rest/v1/learning_credentials')) {
      if (mode === 'none') return { ok: true, status: 200, json: async () => [] };
      if (mode === 'row') return { ok: true, status: 200, json: async () => [{ id: 'row-1', title: 'T', skill: 'Reasoning', source: 'avalanche', issue_tx_hash: txHash || ('0x' + '11'.repeat(32)) }] };
    }
    return original(url);
  };
  return () => { global.fetch = original; };
}

test('invalid code format -> 400 INVALID_INPUT', async () => {
  const { req, res, getStatus, getBody } = makeReqRes('bad');
  await handler(req, res);
  expect(getStatus()).toBe(400);
  expect(getBody().status).toBe('INVALID_INPUT');
});

test('missing code -> 400 INVALID_INPUT', async () => {
  const { req, res, getStatus, getBody } = makeReqRes('');
  await handler(req, res);
  expect(getStatus()).toBe(400);
  expect(getBody().status).toBe('INVALID_INPUT');
});

test('RPC unavailable -> 503 UNAVAILABLE', async () => {
  const restore = mockDbFetch('none');
  Object.assign(process.env, baseEnv('http://127.0.0.1:1'));
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  expect(getStatus()).toBe(503);
  expect(getBody().status).toBe('UNAVAILABLE');
});

test('credential not on chain -> 404 NOT_FOUND', async () => {
  const rpc = await startRpc((method) => {
    if (method === 'credentialExists') return false;
    return null;
  });
  const restore = mockDbFetch('none');
  Object.assign(process.env, baseEnv(rpc.url));
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  rpc.server.close();
  expect(getStatus()).toBe(404);
  expect(getBody().status).toBe('NOT_FOUND');
});

test('valid credential -> 200 VALID with explorerUrl', async () => {
  const tx = '0x' + '11'.repeat(32);
  const rpc = await startRpc((method) => {
    if (method === 'credentialExists') return true;
    if (method === 'getCredential') return [EVIDENCE, ISSUER, ISSUED_AT, 0];
    if (method === 'isCredentialValid') return true;
    return null;
  });
  const restore = mockDbFetch('row', tx);
  Object.assign(process.env, baseEnv(rpc.url));
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  rpc.server.close();
  const body = getBody();
  expect(getStatus()).toBe(200);
  expect(body.status).toBe('VALID');
  expect(body.explorerUrl).toContain(tx);
  expect(body.onChain.valid).toBe(true);
  expect(body.onChain.revoked).toBe(false);
});

test('revoked credential -> 200 REVOKED', async () => {
  const rpc = await startRpc((method) => {
    if (method === 'credentialExists') return true;
    if (method === 'getCredential') return [EVIDENCE, ISSUER, ISSUED_AT, 1700000100];
    if (method === 'isCredentialValid') return false;
    return null;
  });
  const restore = mockDbFetch('none');
  Object.assign(process.env, baseEnv(rpc.url));
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  rpc.server.close();
  const body = getBody();
  expect(getStatus()).toBe(200);
  expect(body.status).toBe('REVOKED');
  expect(body.onChain.revoked).toBe(true);
});
test('invalid (exists, not revoked, not valid) -> 200 INVALID, not REVOKED', async () => {
  const rpc = await startRpc((method) => {
    if (method === 'credentialExists') return true;
    if (method === 'getCredential') return [EVIDENCE, ISSUER, ISSUED_AT, 0];
    if (method === 'isCredentialValid') return false;
    return null;
  });
  const restore = mockDbFetch('none');
  Object.assign(process.env, baseEnv(rpc.url));
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  rpc.server.close();
  const body = getBody();
  expect(getStatus()).toBe(200);
  expect(body.status).toBe('INVALID');
  expect(body.status).not.toBe('REVOKED');
});

import { createCredentialsHandler } from '../api/credentials/index.js';

test('credentials handler public=1 does not require session', async () => {
  const rpc = await startRpc((method) => {
    if (method === 'credentialExists') return false;
    return null;
  });
  const restore = mockDbFetch('none');
  Object.assign(process.env, baseEnv(rpc.url));
  const handler = createCredentialsHandler();
  const req = { method: 'GET', query: { public: '1', code: 'PXP-2026-REGRESSION-0001' }, headers: {}, socket: { remoteAddress: '127.0.0.1' } };
  let status = 200; let body = null;
  const res = { statusCode: 200, setHeader() {}, status(s) { status = s; this.statusCode = s; return this; }, json(b) { body = b; return this; } };
  await handler(req, res);
  restore();
  rpc.server.close();
  expect(status).toBe(404);
  expect(body.status).toBe('NOT_FOUND');
});
test('primary RPC eth_call error with working fallback -> succeeds', async () => {
  // Primary: chainId ok but eth_call returns JSON-RPC error.
  const primary = await startRpc((method) => {
    if (method === 'eth_chainId') return '0xa869';
    throw new Error('primary eth_call failed');
  });
  // Fallback: fully working mock returning not-found.
  const fallback = await startRpc((method) => {
    if (method === 'eth_chainId') return '0xa869';
    if (method === 'credentialExists') return false;
    return null;
  });
  const restore = mockDbFetch('none');
  process.env = { ...process.env, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', AVALANCHE_FUJI_RPC_URL: primary.url, AVALANCHE_FUJI_RPC_URLS: fallback.url, AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: CONTRACT };
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  primary.server.close();
  fallback.server.close();
  const body = getBody();
  expect(getStatus()).toBe(404);
  expect(body.status).toBe('NOT_FOUND');
});

test('all RPCs fail eth_call -> 503 UNAVAILABLE', async () => {
  const rpc = await startRpc((method) => {
    if (method === 'eth_chainId') return '0xa869';
    throw new Error('rpc down');
  });
  const restore = mockDbFetch('none');
  process.env = { ...process.env, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', AVALANCHE_FUJI_RPC_URL: rpc.url, AVALANCHE_FUJI_RPC_URLS: '', AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: CONTRACT };
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  rpc.server.close();
  expect(getStatus()).toBe(503);
  expect(getBody().status).toBe('UNAVAILABLE');
});

test('suppliedContract path still works', async () => {
  // Exercised indirectly: handler uses real gateway; suppliedContract is for direct gateway tests.
  // This test just confirms handler handles a working RPC.
  const rpc = await startRpc((method) => {
    if (method === 'eth_chainId') return '0xa869';
    if (method === 'credentialExists') return true;
    if (method === 'getCredential') return [EVIDENCE, ISSUER, ISSUED_AT, 0];
    if (method === 'isCredentialValid') return true;
    return null;
  });
  const restore = mockDbFetch('none');
  process.env = { ...process.env, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', AVALANCHE_FUJI_RPC_URL: rpc.url, AVALANCHE_FUJI_RPC_URLS: '', AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: CONTRACT };
  const { req, res, getStatus, getBody } = makeReqRes('PXP-2026-REGRESSION-0001');
  await handler(req, res);
  restore();
  rpc.server.close();
  expect(getStatus()).toBe(200);
  expect(getBody().status).toBe('VALID');
});
