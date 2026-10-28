/* Account administration. Supabase is used in deployed multi-user mode. */
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
        <div class="admin-user"><span class="avatar">${this.escape((account.name || account.email)[0].toUpperCase())}</span><span><strong>${this.escape(account.name)}</strong><small>${this.escape(account.email)}</small>${suspensionDetails}</span></div>
        <span class="admin-role">${account.role === 'admin' ? this.t('adminRoleAdmin') : this.t('adminRoleUser')}</span>
        <span class="status ${suspended ? 'needs' : 'mastered'}">${suspended ? this.t('adminSuspended') : this.t('adminActive')}</span>
        <span class="admin-created">${this.escape(new Date(account.createdAt).toLocaleDateString(this.lang === 'jp' ? 'ja-JP' : this.lang))}</span>
        <div class="admin-account-action">${suspended ? '' : `<select data-ban-reason-for="${this.escape(account.id)}" aria-label="${this.t('adminBanReason')}">${reasonOptions}</select>`}<button class="ghost-button" type="button" data-account-id="${this.escape(account.id)}" data-account-status="${suspended ? 'active' : 'suspended'}" ${ownAccount ? 'disabled' : ''}>${suspended ? this.t('adminActivate') : this.t('adminSuspend')}</button></div>
      </div>`;
    }).join('');
    return `<div class="page admin-page">
      ${this.viewHead(this.t('adminTitle'), 'adminSubtitle')}
      <div class="stat-grid three">${this.statCard(this.t('adminTotal'), accounts.length)}${this.statCard(this.t('adminActiveUsers'), active)}${this.statCard(this.t('adminAdmins'), admins)}</div>
      <section class="card admin-users-card">
        <div class="panel-head"><div><h2 class="panel-title">${this.t('adminUsers')}</h2><p class="panel-sub">${this.t('adminLocalNotice')}</p></div><label class="search-field"><span aria-hidden="true">⌕</span><input id="admin-search" type="search" placeholder="${this.t('adminSearch')}" aria-label="${this.t('adminSearch')}"></label></div>
        <div class="admin-user-head"><span>${this.t('adminAccount')}</span><span>${this.t('adminRole')}</span><span>${this.t('adminStatus')}</span><span>${this.t('adminCreated')}</span><span></span></div>
        <div id="admin-users">${rows || `<p class="empty-note">${this.t('adminEmpty')}</p>`}</div>
        <p class="empty-note" id="admin-search-empty" hidden>${this.t('adminNoResults')}</p>
      </section>
    </div>`;
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
};
