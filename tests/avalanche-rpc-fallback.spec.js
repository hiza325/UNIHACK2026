import { expect, test } from '@playwright/test';
import http from 'node:http';
import { avalancheConfig, createAvalancheGateway } from '../api/credentials/_avalanche.js';
import { JsonRpcProvider } from 'ethers';

function makeHandler(resultFn) {
  return (parsed) => {
    const requests = Array.isArray(parsed) ? parsed : [parsed];
    const responses = requests.map((p) => ({ jsonrpc: '2.0', id: p.id, result: resultFn(p) }));
    return Array.isArray(parsed) ? responses : responses[0];
  };
}

function startMockRpc(resultFn) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body || '{}'); } catch (_) {}
        const out = makeHandler(resultFn)(parsed);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test('avalancheConfig treats empty RPC_URLS as unset (uses default fallback)', () => {
  const config = avalancheConfig({
    AVALANCHE_FUJI_RPC_URL: 'https://primary.example/rpc',
    AVALANCHE_FUJI_RPC_URLS: '',
    AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  });
  expect(config.rpcUrls).toEqual([
    'https://primary.example/rpc',
    'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  ]);
});

test('avalancheConfig treats null and whitespace-only RPC_URLS as unset', () => {
  for (const val of [null, '   ', '\t\n']) {
    const config = avalancheConfig({
      AVALANCHE_FUJI_RPC_URL: 'https://primary.example/rpc',
      AVALANCHE_FUJI_RPC_URLS: val,
      AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
    });
    expect(config.rpcUrls).toEqual([
      'https://primary.example/rpc',
      'https://avalanche-fuji-c-chain-rpc.publicnode.com',
    ]);
  }
});

test('avalancheConfig treats undefined RPC_URLS as unset', () => {
  const config = avalancheConfig({
    AVALANCHE_FUJI_RPC_URL: 'https://primary.example/rpc',
    AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  });
  expect(config.rpcUrls).toEqual([
    'https://primary.example/rpc',
    'https://avalanche-fuji-c-chain-rpc.publicnode.com',
  ]);
});

test('avalancheConfig parses primary and fallback URLs', () => {
  const config = avalancheConfig({
    AVALANCHE_FUJI_RPC_URL: 'https://primary.example/rpc',
    AVALANCHE_FUJI_RPC_URLS: 'https://fallback1.example/rpc, https://fallback2.example/rpc',
    AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  });
  expect(config.rpcUrl).toBe('https://primary.example/rpc');
  expect(config.rpcUrls).toEqual([
    'https://primary.example/rpc',
    'https://fallback1.example/rpc',
    'https://fallback2.example/rpc',
  ]);
});

test('avalancheConfig deduplicates URLs', () => {
  const config = avalancheConfig({
    AVALANCHE_FUJI_RPC_URL: 'https://primary.example/rpc',
    AVALANCHE_FUJI_RPC_URLS: 'https://primary.example/rpc,https://fallback.example/rpc',
    AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  });
  expect(config.rpcUrls).toEqual(['https://primary.example/rpc', 'https://fallback.example/rpc']);
});

test('avalancheConfig rejects invalid fallback URL', () => {
  expect(() => avalancheConfig({
    AVALANCHE_FUJI_RPC_URL: 'https://primary.example/rpc',
    AVALANCHE_FUJI_RPC_URLS: 'not-a-url',
    AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  })).toThrow();
});

test('primary RPC unavailable, fallback succeeds', async () => {
  const badServer = http.createServer((req, res) => { res.statusCode = 500; res.end(''); });
  await new Promise((r) => badServer.listen(0, '127.0.0.1', r));
  const badUrl = `http://127.0.0.1:${badServer.address().port}`;
  const good = await startMockRpc(() => '0xa869');

  const gw = await createAvalancheGateway({
    env: { AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b' },
    write: false,
    providers: [new JsonRpcProvider(badUrl, undefined, { timeout: 1000 }), new JsonRpcProvider(good.url, undefined, { timeout: 1000 })],
  });
  expect(gw).toBeDefined();
  badServer.close();
  good.server.close();
});

test('primary wrong chain, fallback correct chain', async () => {
  const wrong = await startMockRpc(() => '0x1');
  const good = await startMockRpc(() => '0xa869');
  const gw = await createAvalancheGateway({
    env: { AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b' },
    write: false,
    providers: [new JsonRpcProvider(wrong.url, undefined, { timeout: 1000 }), new JsonRpcProvider(good.url, undefined, { timeout: 1000 })],
  });
  expect(gw).toBeDefined();
  wrong.server.close();
  good.server.close();
});

test('all RPCs unavailable throws AVALANCHE_RPC_UNAVAILABLE', async () => {
  const bad1 = http.createServer((req, res) => { res.statusCode = 500; res.end(''); });
  const bad2 = http.createServer((req, res) => { res.statusCode = 500; res.end(''); });
  await new Promise((r) => bad1.listen(0, '127.0.0.1', r));
  await new Promise((r) => bad2.listen(0, '127.0.0.1', r));
  const url1 = `http://127.0.0.1:${bad1.address().port}`;
  const url2 = `http://127.0.0.1:${bad2.address().port}`;
  await expect(createAvalancheGateway({
    env: { AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b' },
    write: false,
    providers: [new JsonRpcProvider(url1, undefined, { timeout: 1000 }), new JsonRpcProvider(url2, undefined, { timeout: 1000 })],
  })).rejects.toMatchObject({ code: 'AVALANCHE_RPC_UNAVAILABLE' });
  bad1.close();
  bad2.close();
});

test('fallback wrong chain only, gateway still works if another valid', async () => {
  const wrong = await startMockRpc(() => '0x1');
  const good = await startMockRpc(() => '0xa869');
  const gw = await createAvalancheGateway({
    env: { AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b' },
    write: false,
    providers: [new JsonRpcProvider(wrong.url, undefined, { timeout: 1000 }), new JsonRpcProvider(good.url, undefined, { timeout: 1000 })],
  });
  expect(gw).toBeDefined();
  wrong.server.close();
  good.server.close();
});

test('duplicate endpoints are deduplicated in config', () => {
  const config = avalancheConfig({
    AVALANCHE_FUJI_RPC_URL: 'https://a.example/rpc',
    AVALANCHE_FUJI_RPC_URLS: 'https://a.example/rpc,https://b.example/rpc',
    AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
  });
  expect(config.rpcUrls).toEqual(['https://a.example/rpc', 'https://b.example/rpc']);
});
test('write mode fails when primary RPC is unavailable (no fallback for writes)', async () => {
  const badServer = http.createServer((req, res) => { res.statusCode = 500; res.end(''); });
  await new Promise((r) => badServer.listen(0, '127.0.0.1', r));
  const badUrl = `http://127.0.0.1:${badServer.address().port}`;
  const good = await startMockRpc(() => '0xa869');

  await expect(createAvalancheGateway({
    env: {
      AVALANCHE_FUJI_RPC_URL: badUrl,
      AVALANCHE_FUJI_RPC_URLS: good.url,
      AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b',
      AVALANCHE_ISSUER_PRIVATE_KEY: '0x' + '11'.repeat(32),
    },
    write: true,
  })).rejects.toMatchObject({ code: 'AVALANCHE_RPC_UNAVAILABLE' });

  badServer.close();
  good.server.close();
});

test('slow RPC times out within limit', async () => {
  const slowServer = http.createServer((req, res) => {
    // never respond within timeout
    setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xa869' })); }, 10000);
  });
  await new Promise((r) => slowServer.listen(0, '127.0.0.1', r));
  const slowUrl = `http://127.0.0.1:${slowServer.address().port}`;

  const start = Date.now();
  await expect(createAvalancheGateway({
    env: { AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b' },
    write: false,
    providers: [new JsonRpcProvider(slowUrl, undefined, { timeout: 1000 })],
  })).rejects.toMatchObject({ code: 'AVALANCHE_RPC_UNAVAILABLE' });
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(8000);
  slowServer.close();
});
