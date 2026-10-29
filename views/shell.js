/* shell views — extracted from app-views.js. Methods are merged into viewMethods. */
import { svgIcon } from '../icons.js';
import { NAV_ITEMS, PAGE_KEYS } from '../app-config.js';
export const shellViews = {
  render() {
    if (!this.user) { this.renderLanding(); return; }
    document.body.classList.remove('sitemap-mode');
    document.documentElement.lang = this.lang === 'jp' ? 'ja' : this.lang;
    document.body.style.overflow = '';
    this.applyStoredTheme();
    const pageTitle = this.t(PAGE_KEYS[this.view] || 'page');
    this.innerHTML = `<div class="app-shell">
      ${this.sidebar()}
      <main class="main">
        ${this.topbar(pageTitle)}
        ${this.viewMarkup()}
      </main>
    </div><footer class="app-footer">${this.t('contestFooter')}</footer><div class="toast" id="toast" role="status"></div>${this.supportWidgetMarkup()}`;
    this.bind();
  },
  sidebar() {
    const t = k => this.t(k);
    const learningState = this.learningDataState();
    const sessionCount = ['real', 'demo', 'empty'].includes(learningState) ? this.getSessions().length : null;
    const count = sessionCount === null ? '—' : String(sessionCount).padStart(2, '0');
    const adminItem = this.user.role === 'admin' ? [['admin', 'navAdmin', 'shield']] : [];
    const nav = [...NAV_ITEMS, ...adminItem].map(([view, key, ic]) => {
      const active = this.view === view || (this.view === 'verify' && view === 'passport');
      return `<button class="nav-item ${active ? 'active' : ''}" data-route="${view}" ${active ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${svgIcon(ic)}</span><span class="nav-text">${t(key)}</span>${view === 'history' ? `<span class="nav-count">${count}</span>` : ''}</button>`;
    }).join('');
    return `<aside class="sidebar">
      <a class="brand brand-link" href="#/dashboard">
        <img class="brand-mark" src="logo-mark.svg" alt="" />
        <div class="brand-copy"><div class="brand-name">PARADOX<span class="brand-ai"> AI</span></div><div class="brand-sub">NEXUS ACADEMY ANALYTICS</div></div>
      </a>
      <div style="width:100%"><div class="workspace-label">${t('workspace')}</div><nav class="nav-group">${nav}<button class="nav-item mobile-more ${['about', 'settings'].includes(this.view) ? 'active' : ''}" type="button" data-mobile-more aria-expanded="false" ${['about', 'settings'].includes(this.view) ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">•••</span><span class="nav-text">${t('more')}</span></button></nav></div>
      <div class="mobile-more-menu" id="mobile-more-menu" hidden><button data-route="about">${svgIcon('help')} ${t('navAbout')}</button><button data-route="settings">${svgIcon('settings')} ${t('navSettings')}</button></div>
      <div class="sidebar-spacer"></div>
      <div class="plan-card"><div class="plan-top"><span>${t('plan')}</span></div><p>${t('remaining')}</p><div class="plan-data-unavailable">${t('planDataUnavailable')}</div></div>
      <div class="profile"><div class="avatar">${this.escape((this.user.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase())}</div><div class="profile-copy"><div class="profile-name">${this.escape(this.user.name || this.user.email)}</div><div class="profile-role">${this.escape(this.user.email)}</div></div></div>
    </aside>`;
  },
  topbar(title) {
    const t = k => this.t(k);
    return `<header class="topbar">
      <div class="crumb">${t('crumb')}<span>/</span><strong>${title}</strong></div>
      <div class="top-actions">
        <button class="icon-button" data-route="sitemap" aria-label="${t('smBadge')}" title="${t('smBadge')}">${svgIcon('grid')}</button>
        <button class="lang-button" id="lang-toggle" aria-label="${t('selectLang')}: ${this.lang.toUpperCase()}"><span aria-hidden="true">◎ </span><span>${this.lang.toUpperCase()}</span><span aria-hidden="true">⌄</span></button>
        ${this.themeToggleMarkup()}
        <button class="logout-button" id="logout-button">${this.lang === 'en' ? 'Log out' : this.lang === 'jp' ? 'ログアウト' : 'Đăng xuất'} ↗</button>
      </div>
    </header>`;
  },
  viewMarkup() {
    switch (this.view) {
      case 'audit': return this.viewAudit();
      case 'history': return this.viewHistory();
      case 'analytics': return this.viewAnalytics();
      case 'practice': return this.viewPractice();
      case 'profile': return this.viewProfile();
      case 'passport': return this.viewPassport();
      case 'verify': return this.viewPassportVerify();
      case 'about': return this.viewAbout();
      case 'settings': return this.viewSettings();
      case 'admin': return this.viewAdmin();
      default: return this.viewDashboard();
    }
  },
  viewHead(title, subKey) {
    const date = this.currentDateLabel();
    return `<section class="view-head"><div><div class="eyebrow"><span class="live-dot"></span> ${this.t('workspace')}</div><h1>${title}</h1><p class="view-sub">${this.t(subKey)}</p></div><time class="date-chip" datetime="${this.localDateKey()}" title="${this.t('timeZoneLabel')}: ${this.displayTimeZone()}">◷ &nbsp;${this.escape(date)} · ${this.displayTimeZone()}</time></section>`;
  },
  statCard(label, value, suffix = '', trend = '') {
    const displayValue = value === null || value === undefined ? '—' : value;
    const displaySuffix = displayValue === '—' ? '' : suffix;
    return `<section class="stat-card" aria-label="${this.escape(`${label}: ${displayValue}${displaySuffix}`)}"><span class="stat-label">${label}</span><div class="stat-value">${displayValue}<small>${displaySuffix}</small>${trend ? `<span class="stat-trend">${trend}</span>` : ''}</div></section>`;
  },
  metricCard(label, value, unit, description, icon) {
    const displayValue = value === null || value === undefined ? '—' : value;
    const displayUnit = displayValue === '—' ? '' : unit;
    const separator = displayUnit === '%' ? '' : ' ';
    const unitClass = displayUnit === '%' ? ' percentage' : '';
    return `<section class="card metric-card" aria-label="${this.escape(`${label}: ${displayValue}${separator}${displayUnit}`)}"><div class="metric-header"><span class="metric-title">${label}</span><span class="metric-icon">${svgIcon(icon)}</span></div><div class="metric-value">${displayValue}${displayUnit ? `${separator}<span class="metric-unit${unitClass}">${displayUnit}</span>` : ''}</div><div class="metric-sub">${description}</div></section>`;
  },
  dataSourceBadge(state) {
    if (state === 'real') return `<span class="data-source-badge real">${this.t('dataStateReal')}</span>`;
    if (state === 'demo') return `<span class="data-source-badge demo">${this.t('dataStateDemo')}</span>`;
    return '';
  },
  dataStatePanel(state, { title, message, retry = '' } = {}) {
    const defaults = {
      loading: ['dataLoadingTitle', 'dataLoadingMessage'],
      empty: ['dataEmptyTitle', 'dataEmptyMessage'],
      error: ['dataErrorTitle', 'dataErrorMessage'],
    };
    const [titleKey, messageKey] = defaults[state] || defaults.empty;
    return `<section class="card data-state-panel ${state}" data-data-state="${state}" role="${state === 'error' ? 'alert' : 'status'}"><span class="data-state-icon" aria-hidden="true">${svgIcon(state === 'error' ? 'shield' : state === 'loading' ? 'clock' : 'book')}</span><div><h2>${title || this.t(titleKey)}</h2><p>${message || this.t(messageKey)}</p>${retry ? `<button class="ghost-button" type="button" ${retry}>${this.t('dataRetry')} ↗</button>` : ''}</div></section>`;
  },
};
