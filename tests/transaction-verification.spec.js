import { test, expect } from '@playwright/test';
import { Interface } from 'ethers';
import http from 'node:http';
import { verifyIssueTransaction } from '../api/credentials/_transaction-verify.js';
import { handlePublicVerify } from '../api/credentials/_public-verify.js';
import { credentialIdFromCode, LEARNING_CREDENTIAL_REGISTRY_ABI } from '../api/credentials/_avalanche.js';
import { AVALANCHE_FUJI_CONFIG as config } from '../avalanche-config.js';

const abi = new Interface(LEARNING_CREDENTIAL_REGISTRY_ABI);
const hash = `0x${'11'.repeat(32)}`;
const blockHash = `0x${'22'.repeat(32)}`;
const evidenceHash = `0x${'33'.repeat(32)}`;
const issuer = `0x${'44'.repeat(20)}`;
const code = 'PXP-TX-TEST-001';
const credentialId = credentialIdFromCode(code);
const onchain = { exists: true, valid: true, revoked: false, evidenceHash, issuer, issuedAt: 1700000000 };
function fixture() {
  const event = abi.encodeEventLog(abi.getEvent('CredentialIssued'), [credentialId, evidenceHash, issuer, onchain.issuedAt]);
  return {
    eth_chainId: '0xa869',
    eth_getTransactionByHash: { hash, to: config.contractAddress, chainId: '0xa869', blockNumber: '0x10', blockHash },
    eth_getTransactionReceipt: { transactionHash: hash, to: config.contractAddress, status: '0x1', blockNumber: '0x10', blockHash, logs: [{ ...event, address: config.contractAddress, transactionHash: hash, blockHash, blockNumber: '0x10', removed: false }] },
    eth_getBlockByNumber: { hash: blockHash, number: '0x10', timestamp: `0x${onchain.issuedAt.toString(16)}` },
  };
}
function mock(data, calls = []) {
  return async (url, options) => {
    const req = JSON.parse(options.body);
    calls.push(req.method);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: req.id, result: data[req.method] }) };
  };
}
const input = { transactionHash: hash, credentialId, onchain, rpcUrls: ['http://fixture'] };

const cases = [
  ['valid', () => {}, 'VERIFIED'],
  ['wrong chain', d => { d.eth_chainId = '0x1'; }, 'UNAVAILABLE'],
  ['wrong transaction chain', d => { d.eth_getTransactionByHash.chainId = '0x1'; }, 'INVALID'],
  ['wrong destination', d => { d.eth_getTransactionByHash.to = issuer; }, 'INVALID'],
  ['wrong receipt contract', d => { d.eth_getTransactionReceipt.to = issuer; }, 'INVALID'],
  ['wrong receipt hash', d => { d.eth_getTransactionReceipt.transactionHash = blockHash; }, 'INVALID'],
  ['failed transaction', d => { d.eth_getTransactionReceipt.status = '0x0'; }, 'INVALID'],
  ['fake event emitter', d => { d.eth_getTransactionReceipt.logs[0].address = issuer; }, 'INVALID'],
  ['missing event', d => { d.eth_getTransactionReceipt.logs = []; }, 'INVALID'],
  ['malformed event', d => { d.eth_getTransactionReceipt.logs[0].data = '0x'; }, 'INVALID'],
  ['wrong credential', d => { d.eth_getTransactionReceipt.logs[0].topics[1] = blockHash; }, 'INVALID'],
  ['wrong evidence', d => { d.eth_getTransactionReceipt.logs[0].topics[2] = blockHash; }, 'INVALID'],
  ['wrong issuer', d => { d.eth_getTransactionReceipt.logs[0].topics[3] = blockHash; }, 'INVALID'],
  ['different valid issuer', d => { Object.assign(d.eth_getTransactionReceipt.logs[0], abi.encodeEventLog(abi.getEvent('CredentialIssued'), [credentialId, evidenceHash, config.contractAddress, onchain.issuedAt])); }, 'INVALID'],
  ['wrong issuedAt', d => { d.eth_getTransactionReceipt.logs[0].data = abi.encodeEventLog(abi.getEvent('CredentialIssued'), [credentialId, evidenceHash, issuer, 1]).data; }, 'INVALID'],
  ['removed event', d => { d.eth_getTransactionReceipt.logs[0].removed = true; }, 'INVALID'],
  ['reorg', d => { d.eth_getBlockByNumber.hash = hash; }, 'UNAVAILABLE'],
  ['missing block', d => { d.eth_getBlockByNumber = null; }, 'UNAVAILABLE'],
  ['missing receipt for mined tx', d => { d.eth_getTransactionReceipt = null; }, 'UNAVAILABLE'],
  ['unknown transaction', d => { d.eth_getTransactionByHash = null; d.eth_getTransactionReceipt = null; }, 'UNAVAILABLE'],
  ['pending', d => { d.eth_getTransactionReceipt = null; d.eth_getTransactionByHash.blockHash = null; d.eth_getTransactionByHash.blockNumber = null; }, 'PENDING'],
];
for (const [name, mutate, expected] of cases) test(name, async () => {
  const data = fixture(); mutate(data);
  expect(await verifyIssueTransaction({ ...input, fetcher: mock(data) })).toBe(expected);
});

test('missing/malformed hashes do not make RPC calls; revoked remains independently verified', async () => {
  const calls = [];
  expect(await verifyIssueTransaction({ ...input, transactionHash: null, fetcher: mock(fixture(), calls) })).toBe('NOT_PROVIDED');
  expect(await verifyIssueTransaction({ ...input, transactionHash: 'bad', fetcher: mock(fixture(), calls) })).toBe('INVALID');
  expect(calls).toEqual([]);
  expect(await verifyIssueTransaction({ ...input, onchain: { ...onchain, revoked: true, valid: false }, fetcher: mock(fixture()) })).toBe('VERIFIED');
});

test('transport failures retry at most twice, timeout is bounded, mismatch does not retry', async () => {
  let calls = 0;
  const urls = ['http://first', 'http://second', 'http://unused'];
  const fetcher = async (url, options) => { calls++; if (url.endsWith('first')) throw new Error('offline'); return mock(fixture())(url, options); };
  expect(await verifyIssueTransaction({ ...input, rpcUrls: urls, fetcher })).toBe('VERIFIED');
  expect(calls).toBe(5);
  calls = 0;
  expect(await verifyIssueTransaction({ ...input, rpcUrls: urls, attemptMs: 10, budgetMs: 30, fetcher: () => { calls++; return new Promise(() => {}); } })).toBe('UNAVAILABLE');
  expect(calls).toBe(2);
  const data = fixture(); data.eth_getTransactionReceipt.status = '0x0';
  const used = [];
  expect(await verifyIssueTransaction({ ...input, rpcUrls: urls, fetcher: async (url, options) => { used.push(url); return mock(data)(url, options); } })).toBe('INVALID');
  expect(new Set(used)).toEqual(new Set(['http://first']));
});

test('unknown transaction and RPC failures have distinct safe warnings', async () => {
  const reasons = [];
  const data = fixture(); data.eth_getTransactionByHash = null;
  expect(await verifyIssueTransaction({ ...input, fetcher: mock(data), reportReason: r => reasons.push(r) })).toBe('UNAVAILABLE');
  expect(reasons).toEqual(['TRANSACTION_NOT_FOUND']);
  reasons.length = 0;
  expect(await verifyIssueTransaction({ ...input, fetcher: async () => { throw new Error('offline'); }, reportReason: r => reasons.push(r) })).toBe('UNAVAILABLE');
  expect(reasons).toEqual(['TRANSACTION_RPC_UNAVAILABLE']);
});

test('public handler integrates with HTTP mock RPC, ignores client hash, and preserves revocation/privacy', async () => {
  const data = fixture(); const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const rpc = JSON.parse(text); requests.push(rpc);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: data[rpc.method] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let body;
    await handlePublicVerify({ method: 'GET', query: { code, transactionHash: blockHash, status: 'VALID' }, headers: {}, socket: { remoteAddress: 'tx-integration' } }, {
      setHeader() {}, status() { return this; }, json(value) { body = value; },
    }, {
      storeFactory: () => ({ findByCode: async () => ({ issue_tx_hash: hash, recipient_name: 'PRIVATE' }) }),
      avalancheFactory: async () => ({ rpcUrls: [`http://127.0.0.1:${server.address().port}`], verifyCredential: async id => { expect(id).toBe(credentialId); return { ...onchain, valid: false, revoked: true }; } }),
    });
    expect(body.status).toBe('REVOKED');
    expect(body.transactionVerification).toBe('VERIFIED');
    expect(requests.find(r => r.method === 'eth_getTransactionReceipt').params).toEqual([hash]);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE|topics|calldata|logs/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

for (const state of ['VERIFIED', 'PENDING', 'INVALID', 'UNAVAILABLE', 'NOT_PROVIDED', 'DEMO']) test(`UI transaction ${state}`, async ({ page }) => {
  await page.route('**/api/verify?**', route => route.fulfill({ json: { status: 'REVOKED', transactionVerification: state } }));
  await page.goto(`/verify.html?code=${code}`);
  await expect(page.locator('.status')).toHaveText('REVOKED');
  if (state === 'VERIFIED') await expect(page.locator('#transaction-verification')).toHaveText('Verified Transaction');
  else await expect(page.locator('#transaction-verification')).not.toHaveText('Verified Transaction');
});
