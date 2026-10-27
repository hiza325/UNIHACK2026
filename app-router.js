import { APP_VIEWS } from './demo.js';

export const routerMethods = {
  onHashChange() {
    if (!location.hash || location.hash.startsWith('#/')) this.handleRoute();
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
    this.view = APP_VIEWS.includes(raw) ? raw : 'dashboard';
    this.render();
  },
  navigate(view) {
    const target = `#/${view}`;
    if (location.hash === target) this.handleRoute();
    else location.hash = target;
  },
  logout() {
    localStorage.removeItem('paradox-session');
    this.resetInMemoryUserData();
    this.user = null;
    this.view = 'landing';
    this.pendingView = null;
    document.body.classList.remove('sitemap-mode');
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
    this.renderLanding();
  },
};
