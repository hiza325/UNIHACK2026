export const eventMethods = {
  onClick(event) {
    if (event.target.closest?.('[data-back-to-top]')) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      return;
    }
    if (event.target.closest?.('[data-support-toggle]')) { this.toggleSupport(); return; }
    if (event.target.closest?.('[data-support-close]')) { this.toggleSupport(false); return; }
    if (event.target.closest?.('[data-theme-toggle]')) { this.toggleTheme(); return; }
    const more = event.target.closest?.('[data-mobile-more]');
    if (more) { const menu = this.querySelector('#mobile-more-menu'); const open = menu?.hidden; if (menu) menu.hidden = !open; more.setAttribute('aria-expanded', String(open)); return; }
    const route = event.target.closest?.('[data-route]');
    if (route) { event.preventDefault(); this.navigate(route.dataset.route); return; }
    const removeFile = event.target.closest?.('[data-remove-file]');
    if (removeFile) { this.removeFile(removeFile.dataset.removeFile); return; }
    const filter = event.target.closest?.('[data-history-filter]');
    if (filter) { this.historyPage = 1; this.querySelectorAll('[data-history-filter]').forEach(b => { b.classList.toggle('active', b === filter); b.setAttribute('aria-pressed', String(b === filter)); }); this.filterHistory(); return; }
    const historyPage = event.target.closest?.('[data-history-page]');
    if (historyPage) { this.historyPage += historyPage.dataset.historyPage === 'next' ? 1 : -1; this.filterHistory(); return; }
    const period = event.target.closest?.('[data-chart-period]');
    if (period) { this.chartPeriod = Number(period.dataset.chartPeriod); this.render(); return; }
    const challenge = event.target.closest?.('[data-challenge]');
    if (challenge) { this.openPractice(Number(challenge.dataset.challenge)); return; }
    const option = event.target.closest?.('[data-option]');
    if (option) { this.answerPractice(Number(option.dataset.option)); return; }
    if (event.target.closest?.('[data-retry-practice]')) { this.retryPractice(); return; }
    if (event.target.closest?.('[data-close-practice]') || event.target.id === 'practice-modal') { this.closePractice(); return; }
    const langBtn = event.target.closest?.('[data-set-lang]');
    if (langBtn) { this.lang = langBtn.dataset.setLang; localStorage.setItem('paradox-lang', this.lang); this.render(); return; }
    const themeBtn = event.target.closest?.('[data-set-theme]');
    if (themeBtn) { this.applyTheme(themeBtn.dataset.setTheme === 'dark'); return; }
    if (event.target.closest?.('[data-upgrade]')) { this.showToast(this.t('profUpgradeToast')); return; }
    if (event.target.closest?.('[data-test-notification]')) { this.testNotification(); return; }
    if (event.target.closest?.('[data-request-hint]')) { this.requestDebateHint(); return; }
    if (event.target.closest?.('[data-resubmit]')) { this.resubmitAudit(); return; }
    const credentialDetails = event.target.closest?.('[data-certificate-details]');
    if (credentialDetails) { this.openPassportCredential(credentialDetails.dataset.certificateDetails); return; }
    if (event.target.closest?.('[data-open-passport-verify]')) { this.openPassportVerification(); return; }
    const verifyCredential = event.target.closest?.('[data-verify-certificate]');
    if (verifyCredential) { this.openPassportVerification(verifyCredential.dataset.verifyCertificate); return; }
    if (event.target.closest?.('[data-close-passport-detail]') || event.target.id === 'passport-detail-modal') { this.closePassportCredential(); return; }
    const accountStatus = event.target.closest?.('[data-account-status]');
    if (accountStatus && this.user?.role === 'admin') {
      const reason = this.querySelector(`[data-ban-reason-for="${CSS.escape(accountStatus.dataset.accountId)}"]`)?.value || '';
      this.updateAccountStatus(accountStatus.dataset.accountId, accountStatus.dataset.accountStatus, reason);
      return;
    }
    if (event.target.closest?.('#export-data')) { this.exportData(); return; }
    if (event.target.closest?.('#export-history')) { this.exportHistory(); return; }
    if (event.target.closest?.('#reset-data')) { this.openResetModal(); return; }
    if (event.target.closest?.('[data-confirm-reset]')) { this.resetPractice(); return; }
    if (event.target.closest?.('[data-cancel-reset]') || event.target.id === 'reset-modal') { this.closeResetModal(); return; }
    if (event.target.closest?.('#delete-account')) this.logout();
  },
  onChange(event) {
    const setting = event.target.closest?.('[data-setting]');
    if (setting) { this.settings[setting.dataset.setting] = setting.checked; this.saveSettings(); this.showToast(this.t('setSaved')); return; }
    if (event.target.id === 'default-subject') { this.settings.subject = event.target.value; this.saveSettings(); this.showToast(this.t('setSaved')); return; }
    if (event.target.id === 'hint-level') { this.settings.hint = Number(event.target.value); this.saveSettings(); this.showToast(this.t('setSaved')); }
    if (event.target.id === 'history-subject' || event.target.id === 'history-date') { this.historyPage = 1; this.filterHistory(); return; }
    if (event.target.id === 'import-history') this.importHistory(event.target.files?.[0]);
  },
  onInput(event) {
    if (event.target.id === 'history-search') { this.historyPage = 1; this.filterHistory(); }
    if (event.target.id === 'work-text') { this.auditText = event.target.value; this.saveAuditState(); }
    if (event.target.id === 'problem-text') { this.auditProblemText = event.target.value; this.saveAuditState(); }
    if (event.target.id === 'admin-search') { this.filterAdminUsers(event.target.value); return; }
    if (event.target.id === 'hint-level') {
      const label = this.querySelector('#hint-value');
      const value = Number(event.target.value);
      if (label) label.textContent = [this.t('setHintLow'), this.t('setHintMed'), this.t('setHintHigh')][value - 1];
    }
  },
  onSubmit(event) {
    if (event.target.id === 'passport-verify-form') {
      event.preventDefault();
      this.searchPassportCredential(event.target);
      return;
    }
    if (event.target.id === 'support-form') {
      event.preventDefault();
      const input = event.target.elements.message;
      const value = input?.value || '';
      if (input) input.value = '';
      this.sendSupportMessage(value);
      return;
    }
    if (event.target.id !== 'profile-form') return;
    event.preventDefault();
    const name = String(new FormData(event.target).get('name') || '').trim();
    if (!name) return;
    this.user.name = name;
    localStorage.setItem('paradox-session', JSON.stringify(this.user));
    this.render();
    this.showToast(this.t('profSaved'));
  },
  onKeydown(event) {
    if (event.key !== 'Escape') return;
    const modal = this.querySelector('#practice-modal');
    if (modal && !modal.hidden) { this.closePractice(); return; }
    const reset = this.querySelector('#reset-modal');
    if (reset && !reset.hidden) { this.closeResetModal(); return; }
    const passportDetail = this.querySelector('#passport-detail-modal');
    if (passportDetail && !passportDetail.hidden) { this.closePassportCredential(); return; }
    const more = this.querySelector('#mobile-more-menu');
    if (more && !more.hidden) { more.hidden = true; this.querySelector('[data-mobile-more]')?.setAttribute('aria-expanded', 'false'); return; }
    const auth = this.querySelector('#auth-backdrop');
    if (auth && !auth.hidden) { auth.hidden = true; return; }
    if (this.supportOpen) { this.toggleSupport(false); return; }
    if (location.hash === '#/sitemap') this.navigate('');
  },
  showToast(text) {
    const toast = this.querySelector('#toast');
    if (!toast) return;
    toast.textContent = text; toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  },
};
