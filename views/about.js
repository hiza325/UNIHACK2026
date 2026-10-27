/* about views — extracted from app-views.js. Methods are merged into viewMethods. */
import { svgIcon } from '../icons.js';
export const aboutViews = {
  viewAbout() {
    const t = k => this.t(k);
    const steps = t('stepLabels').map((label, i) => `<div class="guide-step"><span class="guide-num">${String(i + 1).padStart(2, '0')}</span><div><h3>${label}</h3><p>${t('guide' + (i + 1))}</p></div></div>`).join('');
    const principles = [1, 2, 3].map(i => `<article class="principle"><span>${svgIcon(i === 1 ? 'shield' : i === 2 ? 'spark' : 'book')}</span><h3>${t('aboutP' + i)}</h3><p>${t('aboutP' + i + 'Desc')}</p></article>`).join('');
    const faqs = [1, 2, 3].map(i => `<details><summary>${t('faq' + i + 'Q')}</summary><p>${t('faq' + i + 'A')}</p></details>`).join('');
    return `<div class="page">
      ${this.viewHead(t('aboutHeading'), 'aboutSub')}
      <div class="about-grid">
        <section class="card method-card"><div class="panel-head"><div><h2 class="panel-title">${t('aboutMethod')}</h2><p class="panel-sub">${t('aboutMethodSub')}</p></div></div><div class="guide-list">${steps}</div></section>
        <div class="about-side">
          <section class="card cta-card"><span class="eyebrow">${t('workspace')}</span><h3>${t('aboutHeading')}</h3><p>${t('aboutSub')}</p><button class="primary-button" data-route="audit">${t('aboutCta')} ↗</button><button class="ghost-button" data-route="sitemap">${t('setOpenSitemap')}</button></section>
          <section class="card"><div class="panel-head"><h2 class="panel-title">${t('aboutPrinciples')}</h2></div><div class="principles">${principles}</div></section>
        </div>
      </div>
      <section class="card faq-card"><div class="panel-head"><h2 class="panel-title">${t('faqTitle')}</h2></div><div class="faq-list">${faqs}</div></section>
    </div>`;
  },
};
