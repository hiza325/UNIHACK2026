import { APP_VIEWS } from './demo.js';
import { copy } from './app-config.js';
import { dataMethods } from './app-data.js';
import { viewMethods } from './app-views.js';
import { actionMethods } from './app-actions.js';
import { svgIcon } from './icons.js';


class EduApp extends HTMLElement {
  constructor() {
    super();
    this.lang = ['vi', 'en', 'jp'].includes(localStorage.getItem('paradox-lang')) ? localStorage.getItem('paradox-lang') : 'vi';
    this.step = 0;
    this.files = { problem: [], work: [] };
    this.authMode = 'login';
    this.user = this.readSession();
    this.view = 'dashboard';
    this.pendingView = null;
    this.practiceIndex = null;
    this.practiceSolved = this.readJSON('paradox-practice', []);
    this.practiceActivity = this.readJSON('paradox-practice-activity', []);
    this.settings = this.readJSON('paradox-settings', { reminder: true, digest: true, sound: false, subject: 'math', hint: 2 });
    this.auditMessages = [];
    this.auditText = '';
    this.isAnalyzing = false;
    this.auditStorageReady = false;
    this.filePreviewUrls = {};
    this.historyPage = 1;
    this.historyPageSize = 5;
    this.toastTimer = null;
  }
  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('change', this.onChange);
    this.addEventListener('input', this.onInput);
    this.addEventListener('submit', this.onSubmit);
    window.addEventListener('keydown', this.onKeydown);
    window.addEventListener('hashchange', this.onHashChange);
    this.handleRoute();
    this.loadAuditState().then(() => {
      this.auditStorageReady = true;
      if (this.user && this.view === 'audit') this.render();
    });
  }
  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('change', this.onChange);
    this.removeEventListener('input', this.onInput);
    this.removeEventListener('submit', this.onSubmit);
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('hashchange', this.onHashChange);
  }
  onHashChange = () => { if (!location.hash || location.hash.startsWith('#/')) this.handleRoute(); };
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
  }
  navigate(view) {
    const target = `#/${view}`;
    if (location.hash === target) this.handleRoute();
    else location.hash = target;
  }
  logout() {
    localStorage.removeItem('paradox-session');
    this.user = null;
    this.view = 'landing';
    this.pendingView = null;
    document.body.classList.remove('sitemap-mode');
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
    this.renderLanding();
  }
  themeToggleMarkup(extraClass = '') {
    const dark = document.body.classList.contains('dark');
    const label = this.t(dark ? 'themeToLight' : 'themeToDark');
    return `<button class="icon-button theme-toggle ${extraClass}" type="button" data-theme-toggle aria-label="${label}" title="${label}" aria-pressed="${dark}">${svgIcon(dark ? 'sun' : 'moon')}</button>`;
  }
  applyTheme(dark, persist = true) {
    document.body.classList.toggle('dark', dark);
    if (persist) localStorage.setItem('paradox-theme', dark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151b18' : '#f6f7f3');
    this.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      const label = this.t(dark ? 'themeToLight' : 'themeToDark');
      btn.innerHTML = svgIcon(dark ? 'sun' : 'moon');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-pressed', String(dark));
    });
    this.querySelectorAll('[data-set-theme]').forEach(btn => {
      const active = btn.dataset.setTheme === (dark ? 'dark' : 'light');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  toggleTheme() { this.applyTheme(!document.body.classList.contains('dark')); }
  saveSettings() { localStorage.setItem('paradox-settings', JSON.stringify(this.settings)); }
  applyStoredTheme() { this.applyTheme(localStorage.getItem('paradox-theme') === 'dark', false); }
  readSession() { try { return JSON.parse(localStorage.getItem('paradox-session') || 'null'); } catch { return null; } }
  t(key) { return copy[this.lang][key] || copy.vi[key] || key; }
  onClick = (event) => {
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
    if (event.target.closest?.('#export-data')) { this.exportData(); return; }
    if (event.target.closest?.('#export-history')) { this.exportHistory(); return; }
    if (event.target.closest?.('#reset-data')) { this.openResetModal(); return; }
    if (event.target.closest?.('[data-confirm-reset]')) { this.resetPractice(); return; }
    if (event.target.closest?.('[data-cancel-reset]') || event.target.id === 'reset-modal') { this.closeResetModal(); return; }
    if (event.target.closest?.('#delete-account')) { this.logout(); }
  };
  onChange = (event) => {
    const setting = event.target.closest?.('[data-setting]');
    if (setting) { this.settings[setting.dataset.setting] = setting.checked; this.saveSettings(); this.showToast(this.t('setSaved')); return; }
    if (event.target.id === 'default-subject') { this.settings.subject = event.target.value; this.saveSettings(); this.showToast(this.t('setSaved')); return; }
    if (event.target.id === 'hint-level') { this.settings.hint = Number(event.target.value); this.saveSettings(); this.showToast(this.t('setSaved')); }
    if (event.target.id === 'history-subject' || event.target.id === 'history-date') { this.historyPage = 1; this.filterHistory(); return; }
    if (event.target.id === 'import-history') this.importHistory(event.target.files?.[0]);
  };
  onInput = (event) => {
    if (event.target.id === 'history-search') { this.historyPage = 1; this.filterHistory(); }
    if (event.target.id === 'work-text') { this.auditText = event.target.value; this.saveAuditState(); }
    if (event.target.id === 'hint-level') {
      const label = this.querySelector('#hint-value');
      const value = Number(event.target.value);
      if (label) label.textContent = [this.t('setHintLow'), this.t('setHintMed'), this.t('setHintHigh')][value - 1];
    }
  };
  onSubmit = (event) => {
    if (event.target.id !== 'profile-form') return;
    event.preventDefault();
    const name = String(new FormData(event.target).get('name') || '').trim();
    if (!name) return;
    this.user.name = name;
    localStorage.setItem('paradox-session', JSON.stringify(this.user));
    this.render();
    this.showToast(this.t('profSaved'));
  };
  onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const modal = this.querySelector('#practice-modal');
    if (modal && !modal.hidden) { this.closePractice(); return; }
    const reset = this.querySelector('#reset-modal');
    if (reset && !reset.hidden) { this.closeResetModal(); return; }
    const more = this.querySelector('#mobile-more-menu');
    if (more && !more.hidden) { more.hidden = true; this.querySelector('[data-mobile-more]')?.setAttribute('aria-expanded', 'false'); return; }
    const auth = this.querySelector('#auth-backdrop');
    if (auth && !auth.hidden) { auth.hidden = true; return; }
    if (location.hash === '#/sitemap') this.navigate('');
  };
  showToast(text) {
    const toast = this.querySelector('#toast');
    if (!toast) return;
    toast.textContent = text; toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
}

Object.assign(EduApp.prototype, dataMethods, viewMethods, actionMethods);

customElements.define('edu-app', EduApp);
customElements.define('audit-stepper', class extends HTMLElement {});
customElements.define('audit-message', class extends HTMLElement {});
