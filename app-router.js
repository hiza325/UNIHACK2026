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
    if (this.view === 'admin') this.loadAdminAccounts();
  },
  navigate(view) {
    const target = `#/${view}`;
    if (location.hash === target) this.handleRoute();
    else location.hash = target;
  },
  async logout() {
    try { await this.requestServerAuth('logout', {}); } catch { /* Always clear the browser session. */ }
    localStorage.removeItem('paradox-session');
    this.resetInMemoryUserData();
    this.user = null;
    this.view = 'landing';
    this.pendingView = null;
    this.adminAccounts = null;
    document.body.classList.remove('sitemap-mode');
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
    this.transitionPage(() => this.renderLanding());
  },
};
