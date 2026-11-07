const CERT_ISSUANCE_STORAGE_KEY = 'paradox-cert-issuance';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

async function credentialRequest(body) {
  const response = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: AbortSignal.timeout(15000), body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Certificate service unavailable');
  return result;
}

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
    return true;
  } catch (_) { return false; }
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
  persistCertificateIssuance() {
    const { status, learnerId, evaluationId, credentialCode, title, txHash, broadcastAttempted } = this.certificateIssuance;
    const saved = writeStoredIssuance({ status, learnerId, evaluationId, credentialCode, title, txHash, broadcastAttempted, ownerId: this.user?.id });
    if (TX_HASH.test(txHash || '')) {
      try {
        const key = 'paradox-cert-history:' + this.user.id;
        const history = JSON.parse(sessionStorage.getItem(key) || '[]');
        const entries = Array.isArray(history) ? history : [];
        sessionStorage.setItem(key, JSON.stringify([{ credentialCode, title, txHash, status }, ...entries.filter(item => item.credentialCode !== credentialCode)].slice(0, 20)));
      } catch { /* History is advisory; backend remains authoritative. */ }
    }
    return saved;
  },
  certificateIssuanceHistory() {
    try { const rows = JSON.parse(sessionStorage.getItem('paradox-cert-history:' + this.user?.id) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; }
  },
  restoreCertificateIssuance() {
    if (this.user?.role !== 'admin' || this.certificateIssuance?.busy) return;
    const stored = readStoredIssuance();
    if (!stored) return;
    if (stored.ownerId && stored.ownerId !== this.user.id) return;
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
      broadcastAttempted: Boolean(stored.broadcastAttempted || stored.txHash || stored.status === 'awaiting-signature'),
      recoveryRequired: true,
    };
    // Never reuse a cached unsigned transaction after reload.
    this.certificateIssuance.polling = false;
    this.render();
    void this.recoverCertificateIssuance();
  },
  async recoverCertificateIssuance() {
    if (this.user?.role !== 'admin' || this.certificateIssuance.busy) return;
    const ci = this.certificateIssuance;
    ci.busy = true;
    this.render();
    try {
      const response = await fetch('/api/credentials?code=' + encodeURIComponent(ci.credentialCode), { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.credential) throw new Error('Unable to recover issuance. No transaction will be sent.');
      const record = data.credential;
      const verificationResponse = await fetch('/api/verify?code=' + encodeURIComponent(ci.credentialCode), { signal: AbortSignal.timeout(30000) });
      const verification = await verificationResponse.json();
      if (!['VALID', 'REVOKED', 'INVALID', 'PENDING', 'NOT_FOUND'].includes(verification.status)) throw new Error('Blockchain status unavailable. Recovery remains locked; retry later.');
      ci.publicVerification = verification;
      if (['confirmed', 'revoked', 'revoke_pending'].includes(record.transactionStatus)) ci.broadcastAttempted = true;
      if (TX_HASH.test(record.issueTransactionHash || '')) ci.txHash = record.issueTransactionHash;
      ci.prepared = { credential: record };
      if (ci.txHash) {
        ci.broadcastAttempted = true;
        ci.status = 'pending';
      } else {
        ci.prepared = null;
        ci.status = ci.broadcastAttempted ? 'recovery-required' : 'idle';
        ci.error = ci.broadcastAttempted ? 'Wallet outcome unknown. Recover the existing transaction before issuing again.' : 'Prepare again to revalidate eligibility and issuer.';
      }
      ci.recoveryRequired = Boolean(ci.broadcastAttempted && !ci.txHash);
      if (verification.status === 'REVOKED') ci.status = 'revoked';
      this.persistCertificateIssuance();
    } catch (error) {
      ci.recoveryRequired = true;
      ci.error = error.message;
    } finally { ci.busy = false; this.render(); }
    if (!ci.recoveryRequired && ci.txHash && ci.status !== 'revoked') await this.checkCertificateIssuance();
  },
  async connectCertificateWallet() {
    if (this.user?.role !== 'admin') return;
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
    if (this.user?.role !== 'admin' || this.certificateIssuance.busy || this.certificateIssuance.txHash || this.certificateIssuance.broadcastAttempted || this.certificateIssuance.recoveryRequired) return;
    if (!this.certificateWallet?.authorized || this.certificateWallet.chainId !== 43113) { this.showToast('Connect an authorized issuer on Avalanche Fuji'); return; }
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
    this.certificateIssuance.prepared = null;
    this.render();
    try {
      const response = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: AbortSignal.timeout(15000), body: JSON.stringify({ action: 'prepare-issue', credentialCode, learnerId, evaluationId, title, source: 'ai-evaluation', issuerAddress: this.certificateWallet ? this.certificateWallet.address : undefined }) });
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
      if (TX_HASH.test(result.credential?.issueTransactionHash || '')) {
        this.certificateIssuance.txHash = result.credential.issueTransactionHash;
        this.certificateIssuance.broadcastAttempted = true;
        this.certificateIssuance.status = 'pending';
      }
      this.persistCertificateIssuance();
    } catch (error) {
      this.certificateIssuance.status = 'failed';
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
    } finally {
      this.certificateIssuance.busy = false;
      this.certificateIssuance.polling = false;
      this.render();
    }
  },
  async confirmCertificateIssuance() {
    if (this.user?.role !== 'admin' || this.certificateIssuance.busy || this.certificateIssuance.polling || this.certificateIssuance.txHash || this.certificateIssuance.broadcastAttempted || this.certificateIssuance.recoveryRequired || this.certificateIssuance.status !== 'prepared' || !this.certificateIssuance.prepared?.unsignedTransaction) return;
    if (!window.ethereum || !this.certificateWallet?.authorized) {
      this.certificateIssuance.error = 'Connect Core Wallet first';
      this.render();
      return;
    }
    this.certificateIssuance.busy = true;
    try {
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
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    if (accounts?.[0]?.toLowerCase() !== this.certificateWallet.address.toLowerCase()) throw new Error('Wallet account changed. Reconnect and prepare again.');
    // Recheck backend state before any wallet send; local storage is not authority.
    const lookup = await fetch('/api/credentials?code=' + encodeURIComponent(this.certificateIssuance.credentialCode), { credentials: 'same-origin', signal: AbortSignal.timeout(15000) });
    const latest = await lookup.json();
    if (!lookup.ok || !latest.credential) throw new Error('Cannot verify issuance state. Retry later.');
    if (latest.credential.issueTransactionHash || ['confirmed', 'revoked', 'revoke_pending'].includes(latest.credential.transactionStatus)) {
      this.certificateIssuance.txHash = latest.credential.issueTransactionHash || null;
      this.certificateIssuance.broadcastAttempted = true;
      this.certificateIssuance.status = 'recovery-required';
      this.certificateIssuance.recoveryRequired = true;
      this.persistCertificateIssuance();
      throw new Error('Existing issuance detected. Recover/check it instead of sending again.');
    }
    const verification = await fetch('/api/verify?code=' + encodeURIComponent(this.certificateIssuance.credentialCode), { signal: AbortSignal.timeout(30000) });
    const evidence = await verification.json();
    if (evidence.onChain?.exists === true || ['VALID', 'REVOKED', 'INVALID'].includes(evidence.status)) {
      this.certificateIssuance.broadcastAttempted = true;
      throw new Error('Credential already exists on-chain. Recover its issuance instead of sending again.');
    }
    if (!['NOT_FOUND', 'PENDING'].includes(evidence.status) || !['NOT_PROVIDED'].includes(evidence.transactionVerification)) throw new Error('On-chain preflight unavailable or a transaction already exists. No transaction sent.');
    this.certificateIssuance.busy = true;
    this.certificateIssuance.polling = true;
    this.certificateIssuance.status = 'awaiting-signature';
    this.certificateIssuance.error = '';
    this.render();
      const tx = this.certificateIssuance.prepared.unsignedTransaction;
      this.certificateIssuance.broadcastAttempted = true;
      if (!this.persistCertificateIssuance()) { this.certificateIssuance.broadcastAttempted = false; throw new Error('Cannot save recovery state. Transaction was not sent.'); }
      const txHash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ to: tx.to, from: this.certificateWallet.address, data: tx.data, value: '0x0', gas: tx.gasEstimate ? '0x' + Number(tx.gasEstimate).toString(16) : undefined }],
      });
      this.certificateIssuance.txHash = txHash;
      if (!TX_HASH.test(txHash || '')) { this.certificateIssuance.txHash = null; throw new Error('Wallet returned no valid hash. Recover wallet activity before retrying.'); }
      this.certificateIssuance.status = 'pending';
      this.persistCertificateIssuance();
      this.render();

      // Bounded polling: receipt may arrive late. Retry with exponential backoff up to 2 minutes.
      const started = Date.now();
      const maxMs = 120000;
      let delay = 1000;
      let result = null;
      while (Date.now() - started < maxMs) {
        const response = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', signal: AbortSignal.timeout(15000), body: JSON.stringify({ action: 'confirm-issue', credentialCode: this.certificateIssuance.prepared.credential.code, txHash }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = String(payload.code || '');
          if (/INVALID_|DUPLICATE_|EVIDENCE_HASH_MISMATCH|AVALANCHE_TRANSACTION_REVERTED|CREDENTIAL_NOT_FOUND/i.test(code)) {
            throw new Error(payload.error || 'Confirm failed');
          }
          // Transient (RPC/timeout): keep pending and retry.
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 15000);
          continue;
        }
        result = payload;
        if (result.status === 'confirmed' || result.status === 'failed' || result.alreadyConfirmed) break;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 15000);
      }

      if (result && (result.status === 'confirmed' || result.alreadyConfirmed)) {
        this.certificateIssuance.prepared = result.credential ? { credential: result.credential } : this.certificateIssuance.prepared;
        this.certificateIssuance.status = 'confirmed';
        this.certificateIssuance.error = '';
      } else if (result && result.status === 'failed') {
        this.certificateIssuance.status = 'failed';
        this.certificateIssuance.error = result.error || 'Avalanche transaction failed';
      } else {
        this.certificateIssuance.status = 'pending';
        this.certificateIssuance.error = 'Avalanche confirmation is still pending. Use "Check again" to retry.';
      }
      this.persistCertificateIssuance();
      if (this.certificateIssuance.status === 'confirmed') { this.showToast('Certificate confirmed'); void this.loadLearningPassportSnapshot?.({ force: true }); }
    } catch (error) {
      if (error?.code === 4001 && !this.certificateIssuance.txHash) this.certificateIssuance.broadcastAttempted = false;
      this.certificateIssuance.status = this.certificateIssuance.txHash ? 'pending' : this.certificateIssuance.broadcastAttempted ? 'recovery-required' : 'prepared';
      this.certificateIssuance.recoveryRequired = Boolean(this.certificateIssuance.broadcastAttempted && !this.certificateIssuance.txHash);
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
      this.persistCertificateIssuance();
    } finally {
      this.certificateIssuance.busy = false;
      this.certificateIssuance.polling = false;
      this.render();
    }
  },
  async checkCertificateIssuance() {
    if (this.user?.role !== 'admin' || this.certificateIssuance.busy || this.certificateIssuance.polling || !this.certificateIssuance.txHash || !this.certificateIssuance.prepared) return;
    this.certificateIssuance.polling = true;
    this.certificateIssuance.busy = true;
    this.certificateIssuance.error = '';
    this.render();
    try {
      const result = await credentialRequest({ action: 'confirm-issue', credentialCode: this.certificateIssuance.prepared.credential.code, txHash: this.certificateIssuance.txHash });
      if (result.status === 'confirmed' || result.alreadyConfirmed) {
        this.certificateIssuance.prepared = result.credential ? { credential: result.credential } : this.certificateIssuance.prepared;
        this.certificateIssuance.status = 'confirmed';
        this.certificateIssuance.error = '';
      } else if (result.status === 'revoked') {
        this.certificateIssuance.status = 'revoked';
      } else if (result.status === 'failed') {
        this.certificateIssuance.status = 'failed';
        this.certificateIssuance.error = result.error || 'Avalanche transaction failed';
      } else {
        this.certificateIssuance.status = 'pending';
        this.certificateIssuance.error = 'Avalanche confirmation is still pending. Try again later.';
      }
      this.persistCertificateIssuance();
      if (this.certificateIssuance.status === 'confirmed') { this.showToast('Certificate confirmed'); void this.loadLearningPassportSnapshot?.({ force: true }); }
    } catch (error) {
      this.certificateIssuance.status = 'pending';
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
      this.persistCertificateIssuance();
    } finally {
      this.certificateIssuance.busy = false;
      this.certificateIssuance.polling = false;
      this.render();
    }
  },
  async loadEligibleEvaluations() {
    if (this.user?.role !== 'admin' || this.certificateIssuance.busy) return;
    const learnerId = (this.querySelector('#cert-learner-id')?.value || '').trim();
    if (!learnerId) { this.certificateIssuance.error = 'Learner ID is required'; this.render(); return; }
    this.certificateIssuance.busy = true;
    this.certificateIssuance.error = '';
    this.render();
    try {
      const response = await fetch('/api/credentials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ action: 'list-eligible-evaluations', learnerId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Failed to load evaluations');
      this.certificateIssuance.eligibleEvaluations = result.evaluations || [];
      this.certificateIssuance.learnerId = learnerId;
      if (!this.certificateIssuance.eligibleEvaluations.length) this.certificateIssuance.error = 'No eligible evaluations found';
    } catch (error) {
      this.certificateIssuance.error = error && error.message ? error.message : String(error);
    } finally {
      this.certificateIssuance.busy = false;
      this.certificateIssuance.polling = false;
      this.render();
    }
  },
  selectCertificateEvaluation(value) {
    const select = this.querySelector('#cert-evaluation-select');
    const option = select && select.selectedOptions && select.selectedOptions[0];
    if (!value) return;
    this.certificateIssuance.evaluationId = value;
    // auto-fill credential code from evaluation? We don't have code in evaluation; leave manual or generate.
    const learnerInput = this.querySelector('#cert-learner-id');
    if (learnerInput && !learnerInput.value) learnerInput.value = this.certificateIssuance.learnerId;
    this.render();
  },
  resetCertificateIssuance() {
    if (this.user?.role !== 'admin' || this.certificateIssuance.busy || this.certificateIssuance.recoveryRequired || (this.certificateIssuance.broadcastAttempted && this.certificateIssuance.status !== 'confirmed') || (this.certificateIssuance.txHash && this.certificateIssuance.status !== 'confirmed')) return;
    this.certificateIssuance = { status: 'idle', learnerId: '', evaluationId: '', credentialCode: '', title: '', prepared: null, txHash: null, error: '', busy: false, polling: false, eligibleEvaluations: [] };
    writeStoredIssuance(null);
    this.render();
  },
};
