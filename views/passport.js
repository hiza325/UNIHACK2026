/* Phase 5 Learning Passport views. Mock data is visibly labelled until integrations are configured. */
import { svgIcon } from '../icons.js';
import { getCredentialDisplayStatus, getAvalancheExplorerUrl, hasActualAvalancheVerification } from '../learning-passport-service.js';

export const passportViews = {
  passportDate(value) {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return this.escape(value || '—');
    return new Intl.DateTimeFormat(this.lang === 'jp' ? 'ja-JP' : this.lang === 'en' ? 'en-GB' : 'vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  },
  passportStatusMarkup(credential) {
    const status = getCredentialDisplayStatus(credential);
    const labels = { unverified: 'passportStatusUnverified', pending: 'passportStatusPending', verified: 'passportStatusVerified', revoked: 'passportStatusRevoked' };
    return `<span class="credential-status ${status}">${this.t(labels[status])}</span>`;
  },
  passportMockNotice() {
    return `<section class="passport-data-notice" role="note"><span>${this.t('passportMockBadge')}</span><div><strong>${this.t('passportMockTitle')}</strong><p>${this.t('passportMockDesc')}</p></div></section>`;
  },
  viewPassport() {
    const t = key => this.t(key);
    const passport = this.getLearningPassportSnapshot();
    const initials = passport.learner.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const achieved = passport.skills.filter(skill => skill.achieved).length;
    const skills = passport.skills.map(skill => `<article class="passport-skill ${skill.achieved ? 'achieved' : ''}"><div class="passport-skill-head"><span class="passport-skill-icon">${svgIcon(skill.achieved ? 'check' : 'clock')}</span><div><h3>${this.escape(skill.name)}</h3><p>${this.escape(skill.description)}</p></div><strong>${skill.score}<small>/100</small></strong></div><div class="skill-track" role="progressbar" aria-label="${this.escape(skill.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${skill.progress}"><span style="width:${skill.progress}%"></span></div><footer><span>${skill.achieved ? t('passportAchieved') : t('passportInProgress')}</span><span>${t('passportEvidence').replace('{count}', String(skill.evidenceCount))}</span></footer></article>`).join('');
    const assessments = passport.assessments.map(item => `<article class="passport-assessment"><div><span>${this.escape(item.skill)}</span><h3>${this.escape(item.name)}</h3><time datetime="${this.escape(item.completedAt)}">${this.passportDate(item.completedAt)}</time></div><strong>${item.score}<small>/100</small></strong><span class="mock-inline">${t('passportMockBadge')}</span></article>`).join('');
    const credentials = passport.credentials.map(credential => `<article class="credential-row"><div class="credential-mark">${svgIcon('award')}</div><div class="credential-main"><span class="credential-code">${this.escape(credential.code)}</span><h3>${this.escape(credential.name)}</h3><p>${this.escape(credential.skill)} · ${this.passportDate(credential.issuedAt)}</p></div>${this.passportStatusMarkup(credential)}<button class="row-action" type="button" data-certificate-details="${this.escape(credential.code)}">${t('passportViewDetails')} ↗</button></article>`).join('');
    return `<div class="page passport-page">
      ${this.viewHead(t('pagePassport'), 'passportSub')}
      ${this.passportMockNotice()}
      <section class="card passport-hero"><div class="avatar passport-avatar">${this.escape(initials)}</div><div class="passport-identity"><span>${t('passportLabel')}</span><h2>${this.escape(passport.learner.displayName)}</h2><p>${this.escape(passport.learner.email)}</p><small>${this.escape(passport.learner.level)} · ${this.escape(passport.learner.cohort)}</small></div><div class="passport-id"><span>${t('passportId')}</span><strong>${this.escape(passport.passportId)}</strong><small>${passport.schemaVersion}</small></div></section>
      <div class="stat-grid four passport-stats">${this.statCard(t('passportSkillsAchieved'), achieved, `/${passport.skills.length}`)}${this.statCard(t('passportOverallScore'), passport.summary.overallScore, '/100')}${this.statCard(t('passportProgress'), passport.summary.progress, '%')}${this.statCard(t('passportCredentials'), passport.credentials.length, '')}</div>
      <div class="passport-grid"><section class="card passport-skills-card"><div class="panel-head"><div><h2 class="panel-title">${t('passportSkills')}</h2><p class="panel-sub">${t('passportSkillsSub')}</p></div></div><div class="passport-skill-list">${skills}</div></section><section class="card passport-assessments-card"><div class="panel-head"><div><h2 class="panel-title">${t('passportAssessments')}</h2><p class="panel-sub">${t('passportAssessmentsSub')}</p></div></div><div class="passport-assessment-list">${assessments}</div></section></div>
      <section class="card credentials-card"><div class="panel-head"><div><h2 class="panel-title">${t('passportCertificateList')}</h2><p class="panel-sub">${t('passportCertificateSub')}</p></div><button class="ghost-button" type="button" data-open-passport-verify>${svgIcon('search')} ${t('passportVerify')}</button></div><div class="credential-list">${credentials}</div></section>
      <div class="practice-backdrop passport-detail-backdrop" id="passport-detail-modal" hidden></div>
    </div>`;
  },
  passportCredentialDetailMarkup(credential) {
    const t = key => this.t(key);
    return `<section class="passport-detail-panel" role="dialog" aria-modal="true" aria-labelledby="passport-detail-title"><button class="practice-close" type="button" data-close-passport-detail aria-label="${t('close')}"><span aria-hidden="true">×</span></button><span class="eyebrow">${t('passportCertificate')}</span><h2 id="passport-detail-title">${this.escape(credential.name)}</h2><div class="passport-detail-status">${this.passportStatusMarkup(credential)}<span class="mock-inline">${t('passportMockBadge')}</span></div><dl class="passport-detail-list"><div><dt>${t('passportCertificateCode')}</dt><dd><code>${this.escape(credential.code)}</code></dd></div><div><dt>${t('passportSkill')}</dt><dd>${this.escape(credential.skill)}</dd></div><div><dt>${t('passportIssuedAt')}</dt><dd>${this.passportDate(credential.issuedAt)}</dd></div><div><dt>${t('passportIssuer')}</dt><dd>${this.escape(credential.issuer)}</dd></div><div><dt>${t('passportAssessmentScore')}</dt><dd>${credential.assessmentScore}/100</dd></div><div><dt>${t('passportEvidenceHash')}</dt><dd><code>${this.escape(credential.evidenceHash)}</code></dd></div><div><dt>${t('passportTransactionHash')}</dt><dd><code>${this.escape(credential.transactionHash || t('passportNotAvailable'))}</code></dd></div></dl><p class="passport-verification-caution">${t('passportNotLive')}</p><div class="passport-detail-actions"><button class="ghost-button" type="button" data-close-passport-detail>${t('close')}</button><button class="primary-button" type="button" data-verify-certificate="${this.escape(credential.code)}">${t('passportVerify')} ↗</button></div></section>`;
  },
  passportVerificationResultMarkup(credential) {
    const t = key => this.t(key);
    if (!credential) return `<section class="card passport-verify-empty" id="passport-verify-empty" tabindex="-1"><span>${svgIcon('search')}</span><h2>${t('passportNotFound')}</h2><p>${t('passportNotFoundDesc')}</p></section>`;
    const explorerUrl = getAvalancheExplorerUrl(credential);
    const actualVerification = hasActualAvalancheVerification(credential);
    return `<section class="card passport-verification-result" id="passport-verification-result" tabindex="-1"><header><div><span>${t('passportVerificationResult')}</span><h2>${this.escape(credential.name)}</h2><code>${this.escape(credential.code)}</code></div>${this.passportStatusMarkup(credential)}</header><div class="verification-grid"><div><span>${t('passportSkill')}</span><strong>${this.escape(credential.skill)}</strong></div><div><span>${t('passportIssuedAt')}</span><strong>${this.passportDate(credential.issuedAt)}</strong></div><div><span>${t('passportAssessmentScore')}</span><strong>${credential.assessmentScore}/100</strong></div><div><span>${t('passportVerificationSource')}</span><strong>${actualVerification ? 'Avalanche C-Chain' : t('passportNotConnected')}</strong></div></div><div class="transaction-box"><span>${t('passportTransactionHash')}</span><code>${this.escape(credential.transactionHash || t('passportNotAvailable'))}</code></div><p class="passport-verification-caution">${actualVerification ? t('passportVerifiedOnChain') : t('passportNotLive')}</p><footer>${explorerUrl ? `<a class="primary-button explorer-button" href="${explorerUrl}" target="_blank" rel="noopener noreferrer">${t('passportExplorer')} ↗</a>` : `<button class="primary-button explorer-button" type="button" disabled>${t('passportExplorer')} ↗</button>`}</footer></section>`;
  },
  viewPassportVerify() {
    const t = key => this.t(key);
    this.getLearningPassportSnapshot();
    const result = this.passportVerificationSearched || this.passportVerificationResult
      ? this.passportVerificationResultMarkup(this.passportVerificationResult)
      : `<section class="card passport-verify-intro"><span>${svgIcon('shield')}</span><h2>${t('passportVerifyIntro')}</h2><p>${t('passportVerifyIntroDesc')}</p></section>`;
    return `<div class="page passport-verify-page">${this.viewHead(t('pagePassportVerify'), 'passportVerifySub')}${this.passportMockNotice()}<section class="card passport-verify-search"><form id="passport-verify-form"><label for="passport-code">${t('passportCertificateCode')}</label><div><input id="passport-code" name="certificateCode" value="${this.escape(this.passportVerificationQuery || '')}" placeholder="PXP-2026-ALG-0001" autocomplete="off" maxlength="64" required><button class="primary-button" type="submit">${svgIcon('search')} ${t('passportLookup')}</button></div><small>${t('passportLookupHint')}</small></form></section>${result}<p class="passport-integration-note">${t('passportIntegrationNote')}</p></div>`;
  },
};
