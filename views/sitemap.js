/* sitemap views — extracted from app-views.js. Methods are merged into viewMethods. */
import { svgIcon } from '../icons.js';
export const sitemapViews = {
  renderSitemap() {
    document.body.classList.add('sitemap-mode');
    document.documentElement.lang = this.lang === 'jp' ? 'ja' : this.lang;
    document.body.style.overflow = '';
    window.scrollTo(0, 0);
    const t = k => this.t(k);
    const cards = [
      ['audit', 'smAudit', 'smAuditDesc', 'shield'],
      ['dashboard', 'smDashboard', 'smDashboardDesc', 'grid'],
      ['history', 'smHistory', 'smHistoryDesc', 'clock'],
      ['analytics', 'smAnalytics', 'smAnalyticsDesc', 'chart'],
      ['practice', 'smPractice', 'smPracticeDesc', 'book'],
      ['profile', 'smProfile', 'smProfileDesc', 'user'],
      ['about', 'smAbout', 'smAboutDesc', 'help'],
      ['settings', 'smSettings', 'smSettingsDesc', 'settings']
    ].map(([route, title, desc, ic]) => `<a class="sitemap-card" href="#/${route}"><span class="sitemap-card-title">${svgIcon(ic)}<b>${t(title)}</b></span><span class="sitemap-card-desc">${t(desc)}</span></a>`).join('');
    this.innerHTML = `<main class="sitemap-page">
      <header class="sitemap-header">
        <a class="sitemap-brand" href="#/" aria-label="PARADOX AI"><img src="logo-mark.svg" alt=""><b>PARADOX AI</b></a>
        <span class="sitemap-badge">${t('smBadge')}</span>
      </header>
      <section class="sitemap-hero"><h1>${t('smTitle')}</h1><p>${t('smSub')}</p></section>
      <nav class="sitemap-grid" aria-label="${t('smBadge')}">${cards}</nav>
      <p class="sitemap-hint">${t('smHint')}</p>
      <footer class="sitemap-footer"><a href="#/">← ${t('smHome')}</a><span>PARADOX AI © 2026</span><span>NEXUS ACADEMY ANALYTICS</span></footer>
    </main>`;
  },
};
