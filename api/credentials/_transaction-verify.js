import { Interface } from 'ethers';
import { LEARNING_CREDENTIAL_REGISTRY_ABI } from './_avalanche.js';
import { AVALANCHE_FUJI_CONFIG } from '../../avalanche-config.js';

const abi = new Interface(LEARNING_CREDENTIAL_REGISTRY_ABI);
const HASH = /^0x[0-9a-fA-F]{64}$/;
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const quantity = value => typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : null;

// Independent read-only check. A DB hash is only a lookup hint, never proof.
// Unknown transactions and incomplete RPC data are UNAVAILABLE, not INVALID.
export async function verifyIssueTransaction({ transactionHash, credentialId, onchain, rpcUrls = [], fetcher = globalThis.fetch, attemptMs = 4000, budgetMs = 8000, reportReason = () => {} }) {
  if (!transactionHash) return 'NOT_PROVIDED';
  if (!HASH.test(transactionHash)) return 'INVALID';
  const deadline = Date.now() + budgetMs;
  const address = AVALANCHE_FUJI_CONFIG.contractAddress;
  for (const url of [...new Set(rpcUrls)].slice(0, 2)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    let timer;
    const run = async () => {
      let id = 0;
      const rpc = async (method, params) => {
        const requestId = ++id;
        const response = await fetcher(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) });
        if (!response.ok) throw new Error('RPC unavailable');
        const payload = await response.json();
        if (payload.error || payload.id !== requestId || !('result' in payload)) throw new Error('RPC invalid response');
        return payload.result;
      };
      if (quantity(await rpc('eth_chainId', [])) !== 43113n) throw new Error('Wrong RPC chain');
      const [tx, receipt] = await Promise.all([
        rpc('eth_getTransactionByHash', [transactionHash]),
        rpc('eth_getTransactionReceipt', [transactionHash]),
      ]);
      if (!tx) { reportReason('TRANSACTION_NOT_FOUND'); return 'UNAVAILABLE'; }
      if (!same(tx.hash, transactionHash) || !same(tx.to, address) || quantity(tx.chainId) !== 43113n) return 'INVALID';
      if (!receipt) return tx.blockNumber == null && tx.blockHash == null ? 'PENDING' : 'UNAVAILABLE';
      if (!same(receipt.transactionHash, transactionHash) || !same(receipt.to, address)) return 'INVALID';
      const blockNumber = quantity(receipt.blockNumber);
      if (blockNumber === null || blockNumber <= 0n || !HASH.test(receipt.blockHash || '')) return 'UNAVAILABLE';
      if (!same(tx.blockHash, receipt.blockHash) || quantity(tx.blockNumber) !== blockNumber) return 'UNAVAILABLE';
      const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
      if (!block || !same(block.hash, receipt.blockHash) || quantity(block.number) !== blockNumber) return 'UNAVAILABLE';
      if (quantity(receipt.status) === 0n) return 'INVALID';
      if (quantity(receipt.status) !== 1n || !Array.isArray(receipt.logs)) return 'UNAVAILABLE';
      if (!onchain?.exists) return 'INVALID';
      const events = receipt.logs.filter(log => same(log.address, address) && same(log.topics?.[0], abi.getEvent('CredentialIssued').topicHash));
      if (events.length !== 1) return 'INVALID';
      const log = events[0];
      if (log.removed || !same(log.transactionHash, transactionHash) || !same(log.blockHash, receipt.blockHash) || quantity(log.blockNumber) !== blockNumber) return 'INVALID';
      try {
        const event = abi.parseLog(log);
        return event && same(event.args.credentialId, credentialId)
        && same(event.args.evidenceHash, onchain.evidenceHash)
        && same(event.args.issuer, onchain.issuer)
        && event.args.issuedAt === BigInt(onchain.issuedAt)
        && event.args.issuedAt === quantity(block.timestamp)
          ? 'VERIFIED' : 'INVALID';
      } catch {
        // ethers may defer ABI decoding errors until an argument is accessed.
        return 'INVALID';
      }
    };
    try {
      return await Promise.race([run(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('RPC timeout')); }, Math.min(attemptMs, remaining));
      })]);
    } catch {
      // Retry only transport/protocol failures, never a definitive mismatch.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  reportReason('TRANSACTION_RPC_UNAVAILABLE');
  return 'UNAVAILABLE';
}
