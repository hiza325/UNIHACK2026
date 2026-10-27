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
    const sessionCount = this.getSessions().length;
    const count = String(sessionCount).padStart(2, '0');
    const auditLimit = 10;
    const auditsRemaining = Math.max(0, auditLimit - Math.min(auditLimit, sessionCount));
    const remainingPercent = Math.round(auditsRemaining / auditLimit * 100);
    const adminItem = this.user.role === 'admin' ? [['admin', 'navAdmin', 'shield']] : [];
    const nav = [...NAV_ITEMS, ...adminItem].map(([view, key, ic]) => `<button class="nav-item ${this.view === view ? 'active' : ''}" data-route="${view}" ${this.view === view ? 'aria-current="page"' : ''}><span class="nav-icon">${svgIcon(ic)}</span><span class="nav-text">${t(key)}</span>${view === 'history' ? `<span class="nav-count">${count}</span>` : ''}</button>`).join('');
    return `<aside class="sidebar">
      <a class="brand brand-link" href="#/dashboard">
        <img class="brand-mark" src="logo-mark.svg" alt="" />
        <div class="brand-copy"><div class="brand-name">PARADOX<span class="brand-ai"> AI</span></div><div class="brand-sub">NEXUS ACADEMY ANALYTICS</div></div>
      </a>
      <div style="width:100%"><div class="workspace-label">${t('workspace')}</div><nav class="nav-group">${nav}<button class="nav-item mobile-more ${['about', 'settings'].includes(this.view) ? 'active' : ''}" type="button" data-mobile-more aria-expanded="false" ${['about', 'settings'].includes(this.view) ? 'aria-current="page"' : ''}><span class="nav-icon">•••</span><span class="nav-text">${t('more')}</span></button></nav></div>
      <div class="mobile-more-menu" id="mobile-more-menu" hidden><button data-route="about">${svgIcon('help')} ${t('navAbout')}</button><button data-route="settings">${svgIcon('settings')} ${t('navSettings')}</button></div>
      <div class="sidebar-spacer"></div>
      <div class="plan-card"><div class="plan-top"><span>${t('plan')}</span><span class="plan-tag">FREE</span></div><p>${t('remaining')}</p><div class="progress-track" role="progressbar" aria-label="${t('remaining')}" aria-valuemin="0" aria-valuemax="${auditLimit}" aria-valuenow="${auditsRemaining}" aria-valuetext="${auditsRemaining} / ${auditLimit}"><div class="progress-fill" style="width:${remainingPercent}%"></div></div><div class="plan-foot"><span>${String(auditsRemaining).padStart(2, '0')} / ${auditLimit}</span><span>${remainingPercent}%</span></div></div>
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
      case 'about': return this.viewAbout();
      case 'settings': return this.viewSettings();
      case 'admin': return this.viewAdmin();
      default: return this.viewDashboard();
    }
  },
  viewHead(title, subKey) {
    return `<section class="view-head"><div><div class="eyebrow"><span class="live-dot"></span> ${this.t('workspace')}</div><h1>${title}</h1><p class="view-sub">${this.t(subKey)}</p></div><div class="date-chip">◷ &nbsp;${this.t('today')}</div></section>`;
  },
  statCard(label, value, suffix = '', trend = '') {
    return `<section class="stat-card" aria-label="${this.escape(`${label}: ${value}${suffix}`)}"><span class="stat-label">${label}</span><div class="stat-value">${value}<small>${suffix}</small>${trend ? `<span class="stat-trend">${trend}</span>` : ''}</div></section>`;
  },
  metricCard(label, value, unit, description, icon) {
    const separator = unit === '%' ? '' : ' ';
    const unitClass = unit === '%' ? ' percentage' : '';
    return `<section class="card metric-card" aria-label="${this.escape(`${label}: ${value}${separator}${unit}`)}"><div class="metric-header"><span class="metric-title">${label}</span><span class="metric-icon">${svgIcon(icon)}</span></div><div class="metric-value">${value}${unit ? `${separator}<span class="metric-unit${unitClass}">${unit}</span>` : ''}</div><div class="metric-sub">${description}</div></section>`;
  },
};
