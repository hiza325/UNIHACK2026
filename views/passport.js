/* Phase 5 Learning Passport views. Mock data is visibly labelled until integrations are configured. */
import { svgIcon } from '../icons.js';
import { AVALANCHE_FUJI_CONFIG, AVALANCHE_FUJI_CONTRACT_URL } from '../avalanche-config.js';
import { CERTIFICATE_CODE_HTML_PATTERN, getCredentialDisplayStatus, getAvalancheExplorerUrl, getCredentialVerificationState, hasActualAvalancheVerification } from '../learning-passport-service.js';

export const passportViews = {
  passportDate(value) {
    const date = new Date(String(value || '').includes('T') ? value : `${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return this.escape(value || '—');
    return this.formatDisplayDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' });
  },
  passportStatusMarkup(credential) {
    const revoked = credential.status === 'revoked' || ['revoked', 'revoke_pending'].includes(credential.transactionStatus) || credential.revokedAt || credential.verification?.revoked;
    const displayStatus = getCredentialDisplayStatus(credential);
    const status = revoked ? 'revoked' : (credential.isTest || credential.source === 'mock') && displayStatus === 'verified' ? 'unverified' : displayStatus;
    const labels = { unverified: 'passportStatusUnverified', pending: 'passportStatusPending', verified: 'passportStatusVerified', revoked: 'passportStatusRevoked' };
    return `<span class="credential-status ${status}">${this.t(labels[status])}</span>`;
  },
  passportDataNotice(passport) {
    if (passport?.source?.isReal) {
      return `<section class="passport-data-notice live" role="status"><span>${this.t('passportLiveBadge')}</span><div><strong>${this.t('passportLiveTitle')}</strong><p>${this.t('passportLiveDesc')}</p><small>${AVALANCHE_FUJI_CONFIG.networkName} · Chain ID ${AVALANCHE_FUJI_CONFIG.chainId}</small></div></section>`;
    }
    return `<section class="passport-data-notice" role="note"><span>${this.t('passportMockBadge')}</span><div><strong>${this.t('passportMockTitle')}</strong><p>${this.t('passportMockDesc')}</p></div></section>`;
  },
  passportAsyncNotice() {
    if (this.passportLoading) return `<p class="passport-api-state" role="status">${this.t('passportLoading')}</p>`;
    if (this.passportError) return `<div class="passport-api-state error" role="alert"><p>${this.t('passportLoadError')}</p><button class="ghost-button" type="button" data-retry-passport>${this.t('dataRetry')} ↗</button></div>`;
    return '';
  },
  viewPassport() {
    const t = key => this.t(key);
    const state = this.learningPassportDataState();
    const head = this.viewHead(t('pagePassport'), 'passportSub');
    if (state === 'loading') return `<div class="page passport-page" data-passport-state="loading">${head}${this.dataStatePanel('loading', { title: t('passportLoading'), message: t('passportLoadingDesc') })}</div>`;
    if (state === 'error') return `<div class="page passport-page" data-passport-state="error">${head}${this.dataStatePanel('error', { title: t('passportLoadErrorTitle'), message: t('passportLoadError'), retry: 'data-retry-passport' })}</div>`;
    const passport = this.getLearningPassportSnapshot();
    if (state === 'empty' || !passport) return `<div class="page passport-page" data-passport-state="empty">${head}${passport ? this.passportDataNotice(passport) : ''}${this.dataStatePanel('empty', { title: t('passportEmptyTitle'), message: t('passportEmptyDesc') })}</div>`;
    const initials = passport.learner.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const achieved = passport.skills.filter(skill => skill.achieved).length;
    const skills = passport.skills.map(skill => `<article class="passport-skill ${skill.achieved ? 'achieved' : ''}"><div class="passport-skill-head"><span class="passport-skill-icon">${svgIcon(skill.achieved ? 'check' : 'clock')}</span><div><h3>${this.escape(skill.name)}</h3><p>${this.escape(skill.description)}</p></div><strong>${Number.isFinite(skill.score) ? `${skill.score}<small>/100</small>` : '—'}</strong></div>${Number.isFinite(skill.progress) ? `<div class="skill-track" role="progressbar" aria-label="${this.escape(skill.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${skill.progress}"><span style="width:${skill.progress}%"></span></div>` : ''}<footer><span>${skill.achieved ? t('passportAchieved') : t('passportInProgress')}</span><span>${t('passportEvidence').replace('{count}', String(skill.evidenceCount))}</span></footer></article>`).join('') || `<p class="passport-empty-list">${t('passportNoVerifiedSkills')}</p>`;
    const assessments = passport.assessments.map(item => `<article class="passport-assessment"><div><span>${this.escape(item.skill)}</span><h3>${this.escape(item.name)}</h3><time datetime="${this.escape(item.completedAt)}">${this.passportDate(item.completedAt)}</time></div><strong>${Number.isFinite(item.score) ? `${item.score}<small>/100</small>` : '—'}</strong>${item.source === 'mock' ? `<span class="mock-inline">${t('passportMockBadge')}</span>` : ''}</article>`).join('') || `<p class="passport-empty-list">${t('passportNoVerifiedAssessments')}</p>`;
    const credentials = passport.credentials.map(credential => `<article class="credential-row"><div class="credential-mark">${svgIcon('award')}</div><div class="credential-main"><span class="credential-code">${this.escape(credential.code)}</span><h3>${this.escape(credential.name)}</h3><p>${this.escape(credential.skill)} · ${this.passportDate(credential.issuedAt)} ${credential.isTest ? `· ${t('passportTestBadge')}` : credential.source === 'mock' ? `· ${t('passportMockBadge')}` : ''}</p></div>${this.passportStatusMarkup(credential)}<button class="row-action" type="button" data-certificate-details="${this.escape(credential.code)}">${t('passportViewDetails')} ↗</button></article>`).join('') || `<p class="passport-empty-list">${t('passportNoCredentials')}</p>`;
    return `<div class="page passport-page" data-passport-state="${state}">
      ${head}
      ${this.passportDataNotice(passport)}
      ${this.passportAsyncNotice()}
      <section class="card passport-hero"><div class="avatar passport-avatar">${this.escape(initials)}</div><div class="passport-identity"><span>${t('passportLabel')}</span><h2>${this.escape(passport.learner.displayName)}</h2><p>${this.escape(passport.learner.email)}</p><small>${this.escape(passport.learner.level)} · ${this.escape(passport.learner.cohort)}</small></div><div class="passport-id"><span>${t('passportId')}</span><strong>${this.escape(passport.passportId)}</strong><small>${passport.schemaVersion}</small></div></section>
      <div class="stat-grid four passport-stats">${this.statCard(t('passportSkillsAchieved'), achieved, `/${passport.skills.length}`)}${this.statCard(t('passportOverallScore'), passport.summary.overallScore, '/100')}${this.statCard(t('passportProgress'), passport.summary.progress, '%')}${this.statCard(t('passportCredentials'), passport.credentials.length, '')}</div>
      <div class="passport-grid"><section class="card passport-skills-card"><div class="panel-head"><div><h2 class="panel-title">${t('passportSkills')}</h2><p class="panel-sub">${t('passportSkillsSub')}</p></div></div><div class="passport-skill-list">${skills}</div></section><section class="card passport-assessments-card"><div class="panel-head"><div><h2 class="panel-title">${t('passportAssessments')}</h2><p class="panel-sub">${t('passportAssessmentsSub')}</p></div></div><div class="passport-assessment-list">${assessments}</div></section></div>
      <section class="card credentials-card"><div class="panel-head"><div><h2 class="panel-title">${t('passportCertificateList')}</h2><p class="panel-sub">${t('passportCertificateSub')}</p></div><button class="ghost-button" type="button" data-open-passport-verify>${svgIcon('search')} ${t('passportVerify')}</button></div><div class="credential-list">${credentials}</div></section>
      <div class="practice-backdrop passport-detail-backdrop" id="passport-detail-modal" hidden></div>
    </div>`;
  },
  passportCredentialDetailMarkup(credential) {
    if (credential.source === 'avalanche' && !credential.isTest && credential.snapshot?.version === 1) {
      credential = { ...credential, skill: credential.snapshot.subject, issuedAt: credential.snapshot.issuedAt };
    }
    const t = key => this.t(key);
    const actualVerification = hasActualAvalancheVerification(credential);
    const dataBadge = credential.isTest ? t('passportTestBadge') : credential.source === 'mock' ? t('passportMockBadge') : '';
    const caution = credential.isTest ? t('passportTestWarning') : actualVerification ? t('passportVerifiedOnChain') : t('passportNotLive');
    const transactionUrl = getAvalancheExplorerUrl(credential);
    return `<section class="passport-detail-panel" role="dialog" aria-modal="true" aria-labelledby="passport-detail-title"><button class="practice-close" type="button" data-close-passport-detail aria-label="${t('close')}"><span aria-hidden="true">×</span></button><span class="eyebrow">${t('passportCertificate')}</span><h2 id="passport-detail-title">${this.escape(credential.name)}</h2><div class="passport-detail-status">${this.passportStatusMarkup(credential)}${dataBadge ? `<span class="mock-inline">${dataBadge}</span>` : ''}</div><dl class="passport-detail-list"><div><dt>${t('passportCertificateCode')}</dt><dd><code>${this.escape(credential.code)}</code></dd></div><div><dt>${t('passportSkill')}</dt><dd>${this.escape(credential.skill)}</dd></div><div><dt>${t('passportIssuedAt')}</dt><dd>${this.passportDate(credential.issuedAt)}</dd></div><div><dt>${t('passportIssuer')}</dt><dd>${this.escape(credential.issuer || t('passportNotAvailable'))}</dd></div><div><dt>${t('passportAssessmentScore')}</dt><dd>${credential.assessmentScore ?? '—'}${Number.isFinite(credential.assessmentScore) ? '/100' : ''}</dd></div><div><dt>${t('passportEvidenceHash')}</dt><dd><code>${this.escape(credential.evidenceHash || t('passportNotAvailable'))}</code></dd></div><div><dt>${t('passportNetwork')}</dt><dd>${credential.network === AVALANCHE_FUJI_CONFIG.network ? `${AVALANCHE_FUJI_CONFIG.networkName} (${AVALANCHE_FUJI_CONFIG.chainId})` : t('passportNotAvailable')}</dd></div><div><dt>${t('passportTransactionHash')}</dt><dd><code>${transactionUrl ? this.escape(credential.transactionHash) : t('passportNotAvailable')}</code></dd></div></dl><p class="passport-verification-caution">${caution}</p><div class="passport-detail-actions"><button class="ghost-button" type="button" data-close-passport-detail>${t('close')}</button><button class="primary-button" type="button" data-verify-certificate="${this.escape(credential.code)}">${t('passportVerify')} ↗</button></div></section>`;
  },
  passportVerificationStateMarkup(state) {
    const t = key => this.t(key);
    const states = {
      checking: ['clock', 'passportCheckingTitle', 'passportCheckingDesc'],
      'not-found': ['search', 'passportNotFound', 'passportNotFoundDesc'],
      'network-error': ['shield', 'passportNetworkErrorTitle', 'passportNetworkErrorDesc'],
    };
    const [icon, title, description] = states[state] || states['not-found'];
    const retry = state === 'network-error' ? `<button class="ghost-button" type="button" data-retry-verification>${t('dataRetry')} ↗</button>` : '';
    return `<section class="card passport-verify-empty ${state}" id="passport-verification-state" data-verification-state="${state}" tabindex="-1" role="${state === 'network-error' ? 'alert' : 'status'}"><span>${svgIcon(icon)}</span><h2>${t(title)}</h2><p>${t(description)}</p>${retry}</section>`;
  },
  passportVerificationResultMarkup(credential, state = getCredentialVerificationState(credential)) {
    const t = key => this.t(key);
    if (!credential) return this.passportVerificationStateMarkup('not-found');
    const explorerUrl = getAvalancheExplorerUrl(credential);
    const actualVerification = hasActualAvalancheVerification(credential);
    const stateCopy = {
      valid: ['passportVerifiedOnAvalanche', 'passportVerifiedOnChain'],
      unissued: ['passportUnissuedTitle', 'passportUnissuedDesc'],
      revoked: ['passportRevokedTitle', 'passportRevokedDesc'],
      demo: ['passportDemoVerifyTitle', 'passportDemoVerifyDesc'],
      unavailable: ['passportUnavailableTitle', 'passportNotLive'],
    }[state] || ['passportUnavailableTitle', 'passportNotLive'];
    const transaction = explorerUrl
      ? `<div class="transaction-box"><span>${t('passportTransactionHash')}</span><code>${this.escape(credential.transactionHash)}</code></div>`
      : '';
    return `<section class="card passport-verification-result ${state}" id="passport-verification-result" data-verification-state="${state}" tabindex="-1"><header><div><span>${t('passportVerificationResult')}</span><h2>${this.escape(credential.name || t('passportCertificate'))}</h2><code>${this.escape(credential.code)}</code>${credential.isTest ? `<span class="mock-inline">${t('passportTestBadge')}</span>` : credential.source === 'mock' ? `<span class="mock-inline">${t('passportMockBadge')}</span>` : ''}</div><span class="verification-state-badge ${state}">${t(stateCopy[0])}</span></header><div class="verification-grid"><div><span>${t('passportSkill')}</span><strong>${this.escape(credential.skill || '—')}</strong></div><div><span>${t('passportIssuedAt')}</span><strong>${credential.issuedAt ? this.passportDate(credential.issuedAt) : '—'}</strong></div><div><span>${t('passportNetwork')}</span><strong>${credential.network === AVALANCHE_FUJI_CONFIG.network ? `${AVALANCHE_FUJI_CONFIG.networkName} · ${AVALANCHE_FUJI_CONFIG.chainId}` : '—'}</strong></div><div><span>${t('passportVerificationSource')}</span><strong>${actualVerification ? AVALANCHE_FUJI_CONFIG.contractName : t('passportNotConnected')}</strong></div></div>${transaction}<p class="passport-verification-caution ${state}">${t(stateCopy[1])}</p><footer>${explorerUrl ? `<a class="primary-button explorer-button" href="${explorerUrl}" target="_blank" rel="noopener noreferrer">${t('passportExplorer')} ↗</a>` : ''}</footer></section>`;
  },
  viewPassportVerify() {
    const t = key => this.t(key);
    const basePassport = this.getLearningPassportSnapshot();
    const passport = this.passportVerificationResult?.source === 'avalanche' && basePassport
      ? { ...basePassport, source: { type: 'avalanche', isReal: true, label: 'AVALANCHE FUJI TESTNET' } }
      : basePassport;
    const state = this.passportVerificationState || 'idle';
    const result = ['checking', 'not-found', 'network-error'].includes(state)
      ? this.passportVerificationStateMarkup(state)
      : this.passportVerificationSearched || this.passportVerificationResult
      ? this.passportVerificationResultMarkup(this.passportVerificationResult, state)
      : `<section class="card passport-verify-intro"><span>${svgIcon('shield')}</span><h2>${t('passportVerifyIntro')}</h2><p>${t('passportVerifyIntroDesc')}</p></section>`;
    const notice = passport ? this.passportDataNotice(passport) : '';
    return `<div class="page passport-verify-page" data-verification-page-state="${state}">${this.viewHead(t('pagePassportVerify'), 'passportVerifySub')}${notice}<section class="card passport-network-summary" aria-label="${t('passportNetworkDetails')}"><div><span>${t('passportNetwork')}</span><strong>${AVALANCHE_FUJI_CONFIG.networkName}</strong></div><div><span>Chain ID</span><strong>${AVALANCHE_FUJI_CONFIG.chainId}</strong></div><div><span>${t('passportContract')}</span><a href="${AVALANCHE_FUJI_CONTRACT_URL}" target="_blank" rel="noopener noreferrer"><code>${AVALANCHE_FUJI_CONFIG.contractAddress}</code></a></div></section><section class="card passport-verify-search"><form id="passport-verify-form"><label for="passport-code">${t('passportCertificateCode')}</label><div><input id="passport-code" name="certificateCode" value="${this.escape(this.passportVerificationQuery || '')}" placeholder="PXP-…" autocomplete="off" minlength="8" maxlength="80" pattern="${this.escape(CERTIFICATE_CODE_HTML_PATTERN)}" aria-describedby="passport-code-hint" required><button class="primary-button" type="submit" ${state === 'checking' ? 'disabled aria-busy="true"' : ''}>${svgIcon('search')} ${t('passportLookup')}</button></div><small id="passport-code-hint">${t('passportLookupHint')}</small></form></section><div aria-live="polite">${result}</div><p class="passport-integration-note">${t('passportIntegrationNote')}</p></div>`;
  },
};
