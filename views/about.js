/* About / Guide explains the learning model, evidence boundaries, and public verification flow. */
import { AVALANCHE_FUJI_CONFIG, AVALANCHE_FUJI_CONTRACT_URL, AVALANCHE_FUJI_DEPLOYMENT_URL } from '../avalanche-config.js';
import { svgIcon } from '../icons.js';

export const aboutViews = {
  viewAbout() {
    const t = key => this.t(key);
    const learningSteps = t('stepLabels').map((label, index) => `<div class="guide-step"><span class="guide-num">${String(index + 1).padStart(2, '0')}</span><div><h3>${label}</h3><p>${t(`guide${index + 1}`)}</p></div></div>`).join('');
    const featureStatuses = [
      ['active', 'aboutStatusActive', 'aboutStatusActiveDesc'],
      ['developing', 'aboutStatusDeveloping', 'aboutStatusDevelopingDesc'],
      ['demo', 'aboutStatusDemo', 'aboutStatusDemoDesc'],
    ].map(([status, title, description]) => `<article class="feature-status ${status}"><span>${t(title)}</span><p>${t(description)}</p></article>`).join('');
    const verificationSteps = [1, 2, 3, 4].map(index => `<li><span>${index}</span><p>${t(`aboutVerifyStep${index}`)}</p></li>`).join('');
    const faqs = [1, 2, 3, 4].map(index => `<details><summary>${t(`faq${index}Q`)}</summary><p>${t(`faq${index}A`)}</p></details>`).join('');
    return `<div class="page about-page">
      ${this.viewHead(t('aboutHeading'), 'aboutSub')}
      <section class="card about-intro"><span class="eyebrow">PARADOX AI · EDUDEFEND.OS</span><h2>${t('aboutPlatformTitle')}</h2><p>${t('aboutPlatformDesc')}</p><div><button class="primary-button" data-route="audit">${t('aboutCta')} ↗</button><button class="ghost-button" data-route="verify">${t('passportVerify')}</button></div></section>
      <div class="about-grid">
        <section class="card method-card"><div class="panel-head"><div><h2 class="panel-title">${t('aboutMethod')}</h2><p class="panel-sub">${t('aboutMethodSub')}</p></div></div><div class="guide-list">${learningSteps}</div></section>
        <div class="about-side">
          <section class="card concept-card"><div class="panel-head"><h2 class="panel-title">${t('aboutEvidenceTitle')}</h2></div><div class="concept-list"><article><span>${svgIcon('spark')}</span><div><h3>${t('aboutAchievementTitle')}</h3><p>${t('aboutAchievementDesc')}</p></div></article><article><span>${svgIcon('award')}</span><div><h3>${t('aboutCertificateTitle')}</h3><p>${t('aboutCertificateDesc')}</p></div></article></div></section>
          <section class="card feature-status-card"><div class="panel-head"><h2 class="panel-title">${t('aboutFeatureStatus')}</h2></div><div class="feature-status-list">${featureStatuses}</div></section>
        </div>
      </div>
      <section class="card avalanche-guide"><div class="avalanche-guide-copy"><span class="eyebrow">AVALANCHE FUJI TESTNET</span><h2>${t('aboutAvalancheTitle')}</h2><p>${t('aboutAvalancheDesc')}</p><p class="deployment-boundary">${t('aboutDeploymentBoundary')}</p></div><dl class="avalanche-metadata"><div><dt>${t('passportNetwork')}</dt><dd>${AVALANCHE_FUJI_CONFIG.networkName}</dd></div><div><dt>Chain ID</dt><dd><code>${AVALANCHE_FUJI_CONFIG.chainId}</code></dd></div><div><dt>${t('passportContract')}</dt><dd><a href="${AVALANCHE_FUJI_CONTRACT_URL}" target="_blank" rel="noopener noreferrer"><code>${AVALANCHE_FUJI_CONFIG.contractAddress}</code></a></dd></div><div><dt>${t('aboutDeploymentTransaction')}</dt><dd><a href="${AVALANCHE_FUJI_DEPLOYMENT_URL}" target="_blank" rel="noopener noreferrer"><code>${AVALANCHE_FUJI_CONFIG.deploymentTransactionHash}</code></a></dd></div></dl></section>
      <section class="card public-verify-guide"><div class="panel-head"><div><h2 class="panel-title">${t('aboutPublicVerifyTitle')}</h2><p class="panel-sub">${t('aboutPublicVerifyDesc')}</p></div><button class="ghost-button" data-route="verify">${t('passportVerify')} ↗</button></div><ol>${verificationSteps}</ol><p class="verification-interpretation">${t('aboutVerifyInterpretation')}</p></section>
      <section class="card faq-card"><div class="panel-head"><h2 class="panel-title">${t('faqTitle')}</h2></div><div class="faq-list">${faqs}</div></section>
    </div>`;
  },
};
