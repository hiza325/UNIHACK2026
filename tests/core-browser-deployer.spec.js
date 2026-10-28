import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCoreDeployerServer } from '../scripts/serve-core-browser-deployer.mjs';
import { createFujiGuardedProvider } from '../internal/core-browser-deployer/provider-guard.js';

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890';
const TEST_ARTIFACT = {
  contractName: 'LearningCredentialRegistry',
  sourceName: 'contracts/LearningCredentialRegistry.sol',
  abi: [
    { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
    { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
    { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'authorizedIssuers', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  ],
  bytecode: '0x600060005560016000f3',
  deployedBytecode: '0x60016000f3',
};

let server;
let baseURL;
let temporaryDirectory;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'paradox-core-deployer-'));
  const artifactPath = join(temporaryDirectory, 'LearningCredentialRegistry.json');
  await writeFile(artifactPath, JSON.stringify(TEST_ARTIFACT), 'utf8');
  server = createCoreDeployerServer({ artifactPath });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseURL = `http://127.0.0.1:${server.address().port}/`;
});

test.afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test('provider guard reads chain ID immediately before forwarding a mock send request', async () => {
  const calls = [];
  const core = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_chainId') return '0xa869';
      if (payload.method === 'wallet_getEthereumChain') return { chainId: '0xa869', chainName: 'Avalanche Fuji C-Chain', isTestnet: true };
      if (payload.method === 'eth_sendTransaction') return '0xmock-transaction-hash';
      throw new Error(`Unexpected method: ${payload.method}`);
    },
  };
  const guarded = createFujiGuardedProvider(core, { getExpectedAddress: () => TEST_ADDRESS });
  const result = await guarded.request({
    method: 'eth_sendTransaction',
    params: [{ from: TEST_ADDRESS, chainId: '0xa869', data: '0x00' }],
  });
  expect(result).toBe('0xmock-transaction-hash');
  expect(calls).toEqual(['eth_chainId', 'wallet_getEthereumChain', 'eth_sendTransaction']);
});

test('provider guard blocks a mock send request when Core reports Mainnet', async () => {
  const calls = [];
  const core = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_chainId') return '0xa86a';
      if (payload.method === 'wallet_getEthereumChain') return { chainId: '0xa86a', chainName: 'Avalanche C-Chain', isTestnet: false };
      throw new Error('Mock send must not be forwarded');
    },
  };
  const guarded = createFujiGuardedProvider(core, { getExpectedAddress: () => TEST_ADDRESS });
  await expect(guarded.request({
    method: 'eth_sendTransaction',
    params: [{ from: TEST_ADDRESS, chainId: '0xa869', data: '0x00' }],
  })).rejects.toThrow('EVM chain and Core signing network');
  expect(calls).toEqual(['eth_chainId', 'wallet_getEthereumChain']);
});

test('provider guard blocks when eth_chainId is Fuji but Core signing mode is Mainnet', async () => {
  const calls = [];
  const core = {
    async request(payload) {
      calls.push(payload.method);
      if (payload.method === 'eth_chainId') return '0xa869';
      if (payload.method === 'wallet_getEthereumChain') return { chainId: '0xa86a', chainName: 'Avalanche C-Chain', isTestnet: false };
      throw new Error('Mock send must not be forwarded');
    },
  };
  const guarded = createFujiGuardedProvider(core, { getExpectedAddress: () => TEST_ADDRESS });
  await expect(guarded.request({
    method: 'eth_sendTransaction',
    params: [{ from: TEST_ADDRESS, chainId: '0xa869', data: '0x00' }],
  })).rejects.toThrow('Core chainId=43114');
  expect(calls).toEqual(['eth_chainId', 'wallet_getEthereumChain']);
});

async function installCoreProvider(page, chainId = '0xa869') {
  await page.addInitScript(({ address, initialChainId }) => {
    const listeners = new Map();
    let currentChainId = initialChainId;
    window.__coreSendTransactionCalls = 0;
    window.__coreRequestAccountsCalls = 0;
    window.__coreSwitchChainCalls = 0;
    window.__setCoreChainForTest = value => { currentChainId = value; };
    const provider = {
      isAvalanche: true,
      async request({ method, params }) {
        if (method === 'eth_requestAccounts') {
          window.__coreRequestAccountsCalls += 1;
          return [address];
        }
        if (method === 'eth_accounts') return [address];
        if (method === 'eth_chainId') return currentChainId;
        if (method === 'wallet_getEthereumChain') {
          const isFuji = currentChainId === '0xa869';
          return {
            chainId: currentChainId,
            chainName: isFuji ? 'Avalanche Fuji C-Chain' : 'Avalanche C-Chain',
            isTestnet: isFuji,
          };
        }
        if (method === 'wallet_switchEthereumChain') {
          window.__coreSwitchChainCalls += 1;
          currentChainId = params?.[0]?.chainId || currentChainId;
          return null;
        }
        if (method === 'eth_getBalance') return '0x8ac7230489e80000';
        if (method === 'eth_estimateGas') return '0x3d090';
        if (method === 'eth_gasPrice') return '0x5d21dba00';
        if (method === 'eth_maxPriorityFeePerGas') return '0x9502f900';
        if (method === 'eth_getBlockByNumber') return { baseFeePerGas: '0x5d21dba00' };
        if (method === 'eth_sendTransaction') {
          window.__coreSendTransactionCalls += 1;
          throw Object.assign(new Error('Test must not send transactions'), { code: 4001 });
        }
        throw new Error(`Unexpected Core RPC method in test: ${method}`);
      },
      on(event, listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(listener);
        return provider;
      },
      removeListener(event, listener) {
        listeners.get(event)?.delete(listener);
        return provider;
      },
    };
    Object.defineProperty(window, 'avalanche', { configurable: true, value: provider });
  }, { address: TEST_ADDRESS, initialChainId: chainId });
}

test('localhost deployer loads only the expected Hardhat artifact and never asks for a private key', async ({ page }) => {
  const response = await page.goto(baseURL);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Core Browser Deployer' })).toBeVisible();
  await expect(page.locator('#artifact-status')).toHaveText('ARTIFACT PASS');
  await expect(page.locator('#contract-name')).toHaveText('LearningCredentialRegistry');
  await expect(page.locator('#constructor-arguments')).toContainText('không có tham số');
  await expect(page.locator('input')).toHaveCount(2);
  await expect(page.getByText('LOCALHOST ONLY')).toBeVisible();
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
});

test('Core Fuji connection and preflight do not sign or send a transaction', async ({ page }) => {
  await installCoreProvider(page);
  await page.goto(baseURL);
  expect(await page.evaluate(() => window.__coreRequestAccountsCalls)).toBe(0);
  expect(await page.evaluate(() => window.__coreSendTransactionCalls)).toBe(0);
  await page.getByRole('button', { name: 'Đồng bộ Core sang Fuji' }).click();
  expect(await page.evaluate(() => window.__coreSwitchChainCalls)).toBe(1);
  await page.getByRole('button', { name: 'Connect Core Wallet' }).click();

  await expect(page.locator('#wallet-address')).toHaveText(TEST_ADDRESS);
  await expect(page.locator('#chain-id')).toHaveText('43113');
  await expect(page.locator('#expected-owner')).toHaveText(TEST_ADDRESS);
  await expect(page.locator('#expected-issuer')).toContainText('authorized = true');
  await expect(page.locator('#provider-session')).toContainText('PASS');
  await expect(page.locator('#core-signing-network')).toContainText('Avalanche Fuji C-Chain');

  await page.getByRole('button', { name: 'Chạy preflight (không ký)' }).click();
  await expect(page.locator('#preflight-status')).toHaveText('PREFLIGHT PASS');
  await expect(page.locator('#preflight-output')).toContainText('PREFLIGHT_READY');
  await expect(page.locator('#preflight-output')).toContainText('"transactionSigned": false');
  await expect(page.locator('#preflight-output')).toContainText('"transactionSent": false');
  await expect(page.locator('#network-diagnostics')).toContainText('"isTestnet": true');
  expect(await page.evaluate(() => window.__coreSendTransactionCalls)).toBe(0);

  await page.locator('#confirm-checkbox').check();
  await page.locator('#confirm-text').fill('DEPLOY TO FUJI');
  await expect(page.locator('#deploy-contract')).toBeEnabled();
  expect(await page.evaluate(() => window.__coreSendTransactionCalls)).toBe(0);
});

test('deploy is blocked if Core changes away from Fuji after preflight', async ({ page }) => {
  await installCoreProvider(page);
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'Đồng bộ Core sang Fuji' }).click();
  await page.getByRole('button', { name: 'Connect Core Wallet' }).click();
  await page.getByRole('button', { name: 'Chạy preflight (không ký)' }).click();
  await expect(page.locator('#preflight-status')).toHaveText('PREFLIGHT PASS');
  await page.locator('#confirm-checkbox').check();
  await page.locator('#confirm-text').fill('DEPLOY TO FUJI');

  await page.evaluate(() => window.__setCoreChainForTest('0xa86a'));
  await page.locator('#deploy-contract').click();

  await expect(page.locator('#deployment-result')).toContainText('Core chainId=43114');
  expect(await page.evaluate(() => window.__coreSendTransactionCalls)).toBe(0);
});

test('wrong Core chain is displayed and blocks preflight and deployment', async ({ page }) => {
  await installCoreProvider(page, '0x1');
  await page.goto(baseURL);
  await page.getByRole('button', { name: 'Connect Core Wallet' }).click();

  await expect(page.locator('#chain-id')).toHaveText('1');
  await expect(page.locator('#status-message')).toContainText('required Fuji chainId=43113');
  await expect(page.locator('#run-preflight')).toBeDisabled();
  await expect(page.locator('#deploy-contract')).toBeDisabled();
  expect(await page.evaluate(() => window.__coreSendTransactionCalls)).toBe(0);
});
