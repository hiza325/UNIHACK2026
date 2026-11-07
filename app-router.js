import { APP_VIEWS } from './demo.js';

export const routerMethods = {
  onHashChange() {
    if (!location.hash || location.hash.startsWith('#/')) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.transitionPage(() => this.handleRoute(), reduceMotion);
    }
  },
  transitionPage(update, reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (document.startViewTransition && !reduceMotion) return document.startViewTransition(update);
    update();
  },
  handleRoute() {
    const raw = location.hash.startsWith('#/') ? location.hash.slice(2).replace(/\/+$/, '') : '';
    if (this.user && this.view === 'audit' && raw !== 'audit' && this.hasUnsavedLearningChanges() && !this.allowUnsavedNavigation) {
      history.replaceState(null, '', `${location.pathname}${location.search}#/audit`);
      this.requestUnsavedSessionAction({ type: 'navigate', view: APP_VIEWS.includes(raw) ? raw : 'dashboard' });
      return;
    }
    this.allowUnsavedNavigation = false;
    document.body.classList.remove('sitemap-mode');
    if (raw === 'sitemap') { this.view = 'sitemap'; this.renderSitemap(); return; }
    window.scrollTo(0, 0);
    if (!this.user) {
      this.view = 'landing';
      this.renderLanding();
      if (APP_VIEWS.includes(raw)) { this.pendingView = raw; this.openAuth('login'); }
      else this.pendingView = null;
      return;
    }
    if (raw === 'admin' && this.user.role !== 'admin') {
      this.view = 'dashboard';
      this.render();
      history.replaceState(null, '', `${location.pathname}${location.search}#/dashboard`);
      requestAnimationFrame(() => this.showToast(this.t('adminForbidden')));
      return;
    }
    this.view = APP_VIEWS.includes(raw) ? raw : 'dashboard';
    this.render();
    if (this.view === 'admin') { this.loadAdminAccounts(); if (typeof this.restoreCertificateIssuance === 'function') this.restoreCertificateIssuance(); if (typeof this.loadCertificateTestPermission === 'function') this.loadCertificateTestPermission(); }
    if (this.view === 'passport' && typeof this.loadPassportEligibleEvaluations === 'function') this.loadPassportEligibleEvaluations();
    if (this.view === 'practice' && typeof this.loadPracticeData === 'function') this.loadPracticeData();
    if (this.view === 'audit') {
      // Lazy-load editorial.css for audit view
      if (!document.querySelector('link[href="editorial.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'editorial.css';
        document.head.appendChild(link);
      }
      this.loadLearningSessions();
      if (typeof ensureAIRenderer === 'function') ensureAIRenderer().then(() => { if (this.view === 'audit') this.render(); }).catch(() => {});
    }
    if (['dashboard', 'profile', 'passport'].includes(this.view)) this.loadLearningPassportSnapshot();
    if (['dashboard', 'history', 'analytics', 'profile'].includes(this.view)) this.loadLearningRecordHistory();
  },
  navigate(view) {
    const target = `#/${view}`;
    if (location.hash === target) this.handleRoute();
    else location.hash = target;
  },
  async logout() {
    try { await this.requestServerAuth('logout', {}); } catch { /* Always clear the browser session. */ }
    if (localStorage.getItem('paradox-local-server') === '1') {
      localStorage.removeItem('paradox-local-server');
      try { await fetch('/api/auth/local', { method: 'DELETE', credentials: 'same-origin' }); } catch { /* Always clear the browser session. */ }
    }
    localStorage.removeItem('paradox-session');
    this.resetInMemoryUserData();
    this.authProvider = 'local';
    this.configurePracticeService();
    this.user = null;
    this.view = 'landing';
    this.pendingView = null;
    this.adminAccounts = null;
    document.body.classList.remove('sitemap-mode');
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
    const transition = this.transitionPage(() => this.renderLanding());
    if (transition?.updateCallbackDone) await transition.updateCallbackDone;
  },
};
