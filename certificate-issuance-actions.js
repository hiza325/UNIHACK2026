const CERT_ISSUANCE_STORAGE_KEY = 'paradox-cert-issuance';

function readStoredIssuance() {
  try {
    const raw = sessionStorage.getItem(CERT_ISSUANCE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function writeStoredIssuance(state) {
  try {
    if (!state) sessionStorage.removeItem(CERT_ISSUANCE_STORAGE_KEY);
    else sessionStorage.setItem(CERT_ISSUANCE_STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

async function readIssuerAuthorization(address) {
  if (!address) return false;
  try {
    const selector = '0xf731fa0f';
    const padded = address.slice(2).toLowerCase().padStart(64, '0');
    const data = selector + padded;
    const res = await fetch('https://api.avax-test.network/ext/bc/C/rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: '0xa0c69eE573cdA8d1d08B46f81AbfA0A15A45CF2b', data }, 'latest'] }),
    });
    const json = await res.json();
    return json && json.result === '0x0000000000000000000000000000000000000000000000000000000000000001';
  } catch (_) { return false; }
}

export const certificateIssuanceMethods = {
  restoreCertificateIssuance() {
    const stored = readStoredIssuance();
    if (!stored) return;
    this.certificateIssuance = {
      status: stored.status || 'idle',
      learnerId: stored.learnerId || '',
      evaluationId: stored.evaluationId || '',
      credentialCode: stored.credentialCode || '',
      title: stored.title || '',
      prepared: stored.credentialCode ? { credential: { code: stored.credentialCode } } : null,
      txHash: stored.txHash || null,
      error: '',
      busy: false,
    };
    if (stored.prepared) this.certificateIssuance.prepared = stored.prepared;
    this.render();
  },
  async connectCertificateWallet() {
    if (!window.ethereum) { this.showToast(this.t('walletNotFound') || 'Core Wallet not found'); return; }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts && accounts[0];
      if (!address) throw new Error('No account returned');
      const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      const chainId = Number(chainIdHex);
      this.certificateWallet = { address, chainId };
      await this.refreshCertificateWalletState();
      this.render();
    } catch (error) {
      this.certificateWallet = null;
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
      this.showToast(this.certificateIssuance.error);
      this.render();
    }
  },
  async refreshCertificateWalletState() {
    if (!this.certificateWallet) return;
    try {
      const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      this.certificateWallet.chainId = Number(chainIdHex);
      const authorized = await readIssuerAuthorization(this.certificateWallet.address);
      this.certificateWallet.authorized = authorized;
      this.certificateIssuance.error = '';
    } catch (error) {
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
    }
    this.render();
  },
  async prepareCertificateIssuance() {
    if (this.certificateIssuance.busy) return;
    const learnerId = (this.querySelector('#cert-learner-id')?.value || '').trim();
    const evaluationId = (this.querySelector('#cert-evaluation-id')?.value || '').trim();
    const credentialCode = (this.querySelector('#cert-code')?.value || '').trim().toUpperCase();
    const title = (this.querySelector('#cert-title')?.value || '').trim();
    if (!learnerId || !evaluationId || !credentialCode || !title) {
      this.certificateIssuance.error = 'All fields are required';
      this.render();
      return;
    }
    this.certificateIssuance.busy = true;
    this.certificateIssuance.error = '';
    this.certificateIssuance.status = 'preparing';
    this.render();
    try {
      const response = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'prepare-issue', credentialCode, learnerId, evaluationId, title, source: 'ai-evaluation', issuerAddress: this.certificateWallet ? this.certificateWallet.address : undefined }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Prepare failed');
      if (!result) throw new Error('Prepare failed');
      this.certificateIssuance.learnerId = learnerId;
      this.certificateIssuance.evaluationId = evaluationId;
      this.certificateIssuance.credentialCode = credentialCode;
      this.certificateIssuance.title = title;
      this.certificateIssuance.prepared = result;
      this.certificateIssuance.status = 'prepared';
      this.certificateIssuance.txHash = null;
      writeStoredIssuance({ status: 'prepared', learnerId, evaluationId, credentialCode, title, prepared: result, txHash: null });
    } catch (error) {
      this.certificateIssuance.status = 'failed';
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
    } finally {
      this.certificateIssuance.busy = false;
      this.render();
    }
  },
  async confirmCertificateIssuance() {
    if (this.certificateIssuance.busy || !this.certificateIssuance.prepared) return;
    if (!window.ethereum || !this.certificateWallet) {
      this.certificateIssuance.error = 'Connect Core Wallet first';
      this.render();
      return;
    }
    const chainId = await window.ethereum.request({ method: 'eth_chainId' }).then(Number);
    if (chainId !== 43113) {
      this.certificateIssuance.error = 'Wrong network: need Avalanche Fuji (43113)';
      this.render();
      return;
    }
    if (this.certificateWallet.address.toLowerCase() !== '0xa906c19de177ccdac0b092560fcda7296165c396') {
      this.certificateIssuance.error = 'Connected wallet is not the authorized issuer';
      this.render();
      return;
    }
    this.certificateIssuance.busy = true;
    this.certificateIssuance.status = 'awaiting-signature';
    this.certificateIssuance.error = '';
    this.render();
    try {
      const tx = this.certificateIssuance.prepared.unsignedTransaction;
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ to: tx.to, from: this.certificateWallet.address, data: tx.data, value: '0x0', gas: tx.gasEstimate ? '0x' + Number(tx.gasEstimate).toString(16) : undefined }],
      });
      this.certificateIssuance.txHash = txHash;
      this.certificateIssuance.status = 'pending';
      writeStoredIssuance({ status: 'pending', learnerId: this.certificateIssuance.learnerId, evaluationId: this.certificateIssuance.evaluationId, credentialCode: this.certificateIssuance.credentialCode, title: this.certificateIssuance.title, prepared: this.certificateIssuance.prepared, txHash });
      this.render();
      const response = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'confirm-issue', credentialCode: this.certificateIssuance.prepared.credential.code, txHash }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Confirm failed');
      this.certificateIssuance.prepared = result.credential ? { credential: result.credential } : this.certificateIssuance.prepared;
      this.certificateIssuance.status = result.status || 'confirmed';
      this.certificateIssuance.error = '';
      writeStoredIssuance({ status: this.certificateIssuance.status, learnerId: this.certificateIssuance.learnerId, evaluationId: this.certificateIssuance.evaluationId, credentialCode: this.certificateIssuance.credentialCode, title: this.certificateIssuance.title, prepared: this.certificateIssuance.prepared, txHash: this.certificateIssuance.txHash });
    } catch (error) {
      this.certificateIssuance.status = 'failed';
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
    } finally {
      this.certificateIssuance.busy = false;
      this.render();
    }
  },
  resetCertificateIssuance() {
    this.certificateIssuance = { status: 'idle', learnerId: '', evaluationId: '', credentialCode: '', title: '', prepared: null, txHash: null, error: '', busy: false };
    writeStoredIssuance(null);
    this.render();
  },
};
