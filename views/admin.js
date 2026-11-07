/* Account administration. Supabase is used in deployed multi-user mode. */
import { svgIcon } from '../icons.js';
import { mountCertificatePreview } from '../certificate-renderer.js';
export const adminViews = {
  viewAdmin() {
    if (this.user?.role !== 'admin') return '';
    const accounts = this.adminAccounts || (this.authProvider === 'remote' ? [] : this.getAccounts());
    const active = accounts.filter(account => account.status !== 'suspended').length;
    const admins = accounts.filter(account => account.role === 'admin').length;
    const rows = accounts.map(account => {
      const suspended = account.status === 'suspended';
      const ownAccount = account.email === this.user.email;
      const reasonOptions = ['account_sharing', 'account_information_dispute', 'policy_violation', 'abusive_behavior', 'other'].map(reason => `<option value="${reason}">${this.escape(this.suspensionReasonLabel(reason))}</option>`).join('');
      const suspensionDetails = suspended ? `<div class="admin-suspension-details"><strong>${this.t('appealReason')}:</strong> ${this.escape(this.suspensionReasonLabel(account.suspensionReason))}${account.suspensionAppeal?.message ? `<br><strong>${this.t('adminAppeal')}:</strong> ${this.escape(account.suspensionAppeal.message)} <small>(${this.escape(account.suspensionAppeal.status || 'pending')})</small>` : `<br><small>${this.t('adminNoAppeal')}</small>`}</div>` : '';
      return `<div class="admin-user-row" data-admin-user data-search="${this.escape(`${account.name} ${account.email}`.toLowerCase())}">
        <div class="admin-user">${ownAccount ? this.avatarMarkup() : `<span class="avatar">${this.escape((account.name || account.email)[0].toUpperCase())}</span>`}<span><strong>${this.escape(account.name)}</strong><small>${this.escape(account.email)}</small>${suspensionDetails}</span></div>
        <span class="admin-role">${account.role === 'admin' ? this.t('adminRoleAdmin') : this.t('adminRoleUser')}</span>
        <span class="status ${suspended ? 'needs' : 'mastered'}">${suspended ? this.t('adminSuspended') : this.t('adminActive')}</span>
        <span class="admin-created">${this.escape(new Date(account.createdAt).toLocaleDateString(this.lang === 'jp' ? 'ja-JP' : this.lang))}</span>
        <div class="admin-account-action">${suspended ? '' : `<select data-ban-reason-for="${this.escape(account.id)}" aria-label="${this.t('adminBanReason')}">${reasonOptions}</select>`}<button class="ghost-button" type="button" data-account-id="${this.escape(account.id)}" data-account-status="${suspended ? 'active' : 'suspended'}" ${ownAccount ? 'disabled' : ''}>${suspended ? this.t('adminActivate') : this.t('adminSuspend')}</button></div>
      </div>`;
    }).join('');
    return `<div class="page admin-page">
      ${this.viewHead(this.t('adminTitle'), 'adminSubtitle')}
      <div class="stat-grid admin-stats">${this.statCard(this.t('adminTotal'), accounts.length)}${this.statCard(this.t('adminActiveUsers'), active)}${this.statCard(this.t('adminAdmins'), admins)}${this.statCard(this.t('adminSuspended'), accounts.length - active)}</div>
      <div class="admin-workspace">
      <section class="card admin-users-card">
        <div class="panel-head"><div><h2 class="panel-title">${this.t('adminUsers')}</h2><p class="panel-sub">${this.t('adminLocalNotice')}</p></div><label class="search-field"><span aria-hidden="true">⌕</span><input id="admin-search" type="search" placeholder="${this.t('adminSearch')}" aria-label="${this.t('adminSearch')}"></label></div>
        <div class="admin-user-head"><span>${this.t('adminAccount')}</span><span>${this.t('adminRole')}</span><span>${this.t('adminStatus')}</span><span>${this.t('adminCreated')}</span><span></span></div>
        <div id="admin-users">${rows || `<p class="empty-note">${this.t('adminEmpty')}</p>`}</div>
        <p class="empty-note" id="admin-search-empty" hidden>${this.t('adminNoResults')}</p>
      </section>
      ${this.viewCertificateIssuance()}
      <section class="card admin-cert-test-card" ${this.certificateTestAllowed ? '' : 'hidden'}>
        <div class="panel-head"><div><h2 class="panel-title">${svgIcon('award')} Certificate Test Mode</h2><p class="panel-sub">Preview and export a demo certificate. This mode does not create a real credential, database record, or blockchain transaction.</p></div><button class="ghost-button" type="button" data-cert-test>Test Certificate</button></div>
        <div id="certificate-test-preview" hidden></div>
      </section>
      </div>
    </div>`;
  },
  viewCertificateIssuance() {
    const ci = this.certificateIssuance || { status: 'idle', error: '', busy: false, prepared: null, txHash: null };
    const wallet = this.certificateWallet;
    const walletStatus = wallet ? `${wallet.address} · chainId ${wallet.chainId} · ${wallet.authorized ? 'Issuer authorized' : 'Not authorized'}` : 'Not connected';
    const prepared = ci.prepared;
    const preview = prepared && prepared.unsignedTransaction ? `
      <dl class="passport-detail-list">
        <div><dt>Learner</dt><dd>${this.escape(ci.learnerId)}</dd></div>
        <div><dt>Certificate</dt><dd>${this.escape(ci.credentialCode)}</dd></div>
        <div><dt>Title</dt><dd>${this.escape(ci.title)}</dd></div>
        <div><dt>Contract</dt><dd><code>${this.escape(prepared.unsignedTransaction.to)}</code></dd></div>
        <div><dt>Network</dt><dd>Avalanche Fuji (43113)</dd></div>
        <div><dt>Issuer</dt><dd><code>${this.escape(prepared.unsignedTransaction.issuerAddress || '')}</code></dd></div>
        <div><dt>Gas estimate</dt><dd>${this.escape(String(prepared.unsignedTransaction.gasEstimate || 'N/A'))}</dd></div>
      </dl>
      <pre>${this.escape(JSON.stringify(prepared.unsignedTransaction, null, 2))}</pre>
    ` : '';
    const explorer = ci.txHash ? `<a href="https://explorer-test.avax.network/c-chain/tx/${this.escape(ci.txHash)}" target="_blank" rel="noopener noreferrer">View on Avalanche Explorer</a>` : '';
    return `<section class="card admin-cert-card">
      <div class="panel-head"><div><h2 class="panel-title">${svgIcon('award')} Certificate Issuance (Avalanche Fuji)</h2><p class="panel-sub">Prepare on backend, sign with Core Wallet, confirm on-chain.</p></div></div>
      <div class="row">
        <button class="ghost-button" type="button" data-cert-connect-wallet ${ci.busy ? 'disabled' : ''}>Connect Core Wallet</button>
        <button class="ghost-button" type="button" data-cert-reset ${ci.busy ? 'disabled' : ''}>Reset</button>
      </div>
      <p><strong>Wallet:</strong> ${this.escape(walletStatus)}</p>
      <div class="row">
        <input id="cert-learner-id" placeholder="Learner ID (UUID)" value="${this.escape(ci.learnerId)}" />
        <button class="ghost-button" type="button" data-cert-load-evaluations ${ci.busy ? 'disabled' : ''}>Load eligible evaluations</button>
      </div>
      <div class="row">
        <select id="cert-evaluation-select" aria-label="Eligible evaluation"><option value="">Select eligible evaluation</option>${(ci.eligibleEvaluations || []).map(ev => `<option value="${this.escape(ev.id)}" data-learner="${this.escape(ev.sessionId)}">${this.escape(ev.id)} · score ${ev.score} · ${ev.status}</option>`).join('')}</select>
      </div>
      <div class="row">
        <input id="cert-evaluation-id" placeholder="Evaluation ID (UUID)" value="${this.escape(ci.evaluationId)}" />
        <input id="cert-code" placeholder="Credential code (PXP-...)" value="${this.escape(ci.credentialCode)}" />
        <input id="cert-title" placeholder="Title" value="${this.escape(ci.title)}" />
      </div>
      <div class="row">
        <button class="primary-button" type="button" data-cert-prepare ${ci.busy || !wallet || wallet.chainId !== 43113 || !wallet.authorized ? 'disabled' : ''}>Prepare</button>
        <button class="primary-button" type="button" data-cert-confirm ${ci.busy || !ci.prepared ? 'disabled' : ''}>Sign &amp; Send</button>
        <button class="ghost-button" type="button" data-cert-check ${ci.busy || !ci.txHash ? 'disabled' : ''}>Check again</button>
      </div>
      <p><strong>Status:</strong> ${ci.busy ? `<span class="loading-inline"><span class="loading-spinner" data-size="sm" role="status" aria-label="Loading"><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span><span class="bar"></span></span></span> ` : ''}${this.escape(ci.status)} ${ci.error ? `— ${this.escape(ci.error)}` : ''}</p>
      ${preview}
      ${ci.txHash ? `<p><strong>Tx:</strong> <code>${this.escape(ci.txHash)}</code> ${explorer}</p>` : ''}
    </section>`;
  },
  filterAdminUsers(value) {
    const query = String(value || '').trim().toLowerCase();
    const rows = [...this.querySelectorAll('[data-admin-user]')];
    let visible = 0;
    rows.forEach(row => { row.hidden = Boolean(query) && !row.dataset.search.includes(query); if (!row.hidden) visible += 1; });
    const empty = this.querySelector('#admin-search-empty');
    if (empty) empty.hidden = visible > 0;
  },
  async loadAdminAccounts() {
    if (this.user?.role !== 'admin') return;
    try {
      const response = await fetch('/api/admin/users', { credentials: 'same-origin' });
      if ([404, 503].includes(response.status) && ['localhost', '127.0.0.1'].includes(location.hostname)) return;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || this.t('authServiceError'));
      this.adminAccounts = data.users || [];
      if (this.view === 'admin') this.render();
    } catch (error) {
      if (!['localhost', '127.0.0.1'].includes(location.hostname)) this.showToast(error.message);
    }
  },
  async updateAccountStatus(accountId, status, reason = '') {
    try {
      const response = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ id: accountId, status, ...(status === 'suspended' ? { reason } : {}) }) });
      if ([404, 503].includes(response.status) && ['localhost', '127.0.0.1'].includes(location.hostname)) {
        this.setAccountStatus(accountId, status);
      } else {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || this.t('authServiceError'));
        this.adminAccounts = (this.adminAccounts || []).map(account => account.id === accountId ? data.user : account);
      }
      this.render();
      this.showToast(this.t('adminStatusSaved'));
    } catch (error) { this.showToast(error.message); }
  },
  async loadCertificateTestPermission() {
    if (this.user?.role !== 'admin') { this.certificateTestAllowed = false; return; }
    try {
      const response = await fetch('/api/admin/users?testCertificate=1', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      const allowed = response.ok && data.allowed === true;
      if (this.certificateTestAllowed !== allowed) {
        this.certificateTestAllowed = allowed;
        if (this.view === 'admin') this.render();
      }
    } catch {
      if (this.certificateTestAllowed) {
        this.certificateTestAllowed = false;
        if (this.view === 'admin') this.render();
      }
    }
  },
  async openCertificateTestMode() {
    const container = this.querySelector('#certificate-test-preview');
    if (!container) return;
    const profile = { name: 'Demo Student' };
    const credential = {
      source: 'demo',
      status: 'preview',
      isDemo: true,
      code: 'DEMO-TEST-001',
      skill: 'Mathematics',
      issuedAt: new Date().toISOString().slice(0, 10),
      metadataIntegrity: 'UNVERIFIED',
    };
    container.hidden = false;
    container.replaceChildren();
    await mountCertificatePreview(container, profile, credential);
  },
};
