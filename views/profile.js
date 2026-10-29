/* Remote achievements come from backend-derived evidence; issued credentials still require on-chain evidence. */
import { issuedCredentials } from '../learning-data.js';
import { svgIcon } from '../icons.js';

export const profileViews = {
  profileIdentityMarkup() {
    const t = key => this.t(key);
    const initials = (this.user.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const memberSince = this.user.createdAt
      ? t('profSinceDate').replace('{date}', this.formatDisplayDate(this.user.createdAt, { month: 'long', year: 'numeric' }))
      : t('profSinceUnknown');
    return `<section class="card profile-hero"><div class="avatar profile-avatar-lg">${this.escape(initials)}</div><div class="profile-hero-copy"><h2>${this.escape(this.user.name || this.user.email)}</h2><p>${this.escape(this.user.email)}</p><span class="profile-since">${this.escape(memberSince)}</span></div><div class="profile-plan"><span class="plan-tag">${t('dataUnavailable')}</span><strong>${t('planDataUnavailable')}</strong></div></section>`;
  },
  achievementCardMarkup(achievement) {
    const t = key => this.t(key);
    const statusKey = achievement.status === 'earned' ? 'achievementEarned' : achievement.status === 'unavailable' ? 'achievementUnavailable' : 'achievementLocked';
    const safeTarget = Number.isFinite(achievement?.target) && achievement.target > 0 ? achievement.target : 1;
    const safeCurrent = Number.isFinite(achievement?.current) && achievement.current >= 0 ? achievement.current : 0;
    const displayCurrent = Math.min(safeCurrent, safeTarget);
    const displayPercent = Math.min(100, Math.round((displayCurrent / safeTarget) * 100));
    const progress = achievement.available
      ? `<div class="achievement-progress" role="progressbar" aria-label="${this.escape(t(achievement.key))}" aria-valuemin="0" aria-valuemax="${safeTarget}" aria-valuenow="${displayCurrent}"><span style="width:${displayPercent}%"></span></div><small>${t('achievementProgress').replace('{current}', String(displayCurrent)).replace('{target}', String(safeTarget))}</small>`
      : `<small>${t('achievementMissingEvidence')}</small>`;
    return `<article class="badge-tile achievement-tile ${achievement.status}" data-achievement-status="${achievement.status}"><span class="badge-icon">${svgIcon(achievement.status === 'earned' ? 'spark' : 'clock')}</span><strong>${t(achievement.key)}</strong><span class="achievement-status">${t(statusKey)}</span>${progress}</article>`;
  },
  issuedCredentialMarkup(credential) {
    return `<article class="issued-credential" data-credential-state="issued"><span class="credential-mark">${svgIcon('award')}</span><div><strong>${this.escape(credential.name)}</strong><code>${this.escape(credential.code)}</code><small>${this.t('achievementIssuedAt').replace('{date}', this.passportDate(credential.issuedAt))}</small></div>${this.passportStatusMarkup(credential)}</article>`;
  },
  viewProfile() {
    const t = key => this.t(key);
    const state = this.dashboardDataState();
    const head = this.viewHead(t('pageProfile'), 'profSub');
    const identity = this.profileIdentityMarkup();
    const form = `<section class="card form-card"><div class="panel-head"><h3 class="panel-title">${t('profInfo')}</h3></div><form id="profile-form" class="profile-form"><label>${t('profName')}<input name="name" value="${this.escape(this.user.name || '')}" required></label><label>${t('profEmail')}<input value="${this.escape(this.user.email)}" disabled></label><button class="primary-button" type="submit">${t('profSave')} ↗</button></form></section>`;
    if (state === 'loading') return `<div class="page profile-page" data-achievement-page-state="loading">${head}${identity}${this.dataStatePanel('loading', { title: t('achievementLoadingTitle'), message: t('achievementLoadingDesc') })}${form}</div>`;
    if (state === 'error') return `<div class="page profile-page" data-achievement-page-state="error">${head}${identity}${this.dataStatePanel('error', { title: t('achievementErrorTitle'), message: t('achievementErrorDesc'), retry: 'data-retry-learning-data' })}${form}</div>`;
    if (state === 'empty') return `<div class="page profile-page" data-achievement-page-state="empty">${head}${identity}${this.dataStatePanel('empty', { title: t('achievementEmptyTitle'), message: t('achievementEmptyDesc') })}${form}</div>`;

    const metrics = this.learningMetrics();
    const achievements = this.learningAchievements();
    const earned = achievements.filter(item => item.status === 'earned').length;
    const passport = this.learningPassportDataState() === 'real' ? this.getLearningPassportSnapshot() : null;
    const credentials = issuedCredentials(passport);
    return `<div class="page profile-page" data-achievement-page-state="${state}">
      ${head}${identity}
      <div class="data-view-heading">${this.dataSourceBadge(state)}<span>${state === 'demo' ? t('dataDemoNotice') : t('dataRealNotice')}</span></div>
      <div class="stat-grid three">${this.statCard(t('profSessions'), metrics.sessions.length)}${this.statCard(t('profAchievementsEarned'), earned, `/${achievements.length}`)}${this.statCard(t('dashCredentialsIssued'), credentials.length)}</div>
      <div class="profile-grid">
        ${form}
        <section class="card profile-badges"><div class="panel-head"><div><h3 class="panel-title">${t('profBadges')}</h3><p class="panel-sub">${t('achievementStoredDataNotice')}</p></div></div><div class="badge-grid">${achievements.map(item => this.achievementCardMarkup(item)).join('')}</div></section>
        <section class="card issued-credentials-card"><div class="panel-head"><div><h3 class="panel-title">${t('achievementIssuedCredentials')}</h3><p class="panel-sub">${t('achievementIssuedCredentialsDesc')}</p></div></div><div class="issued-credential-list">${credentials.length ? credentials.map(item => this.issuedCredentialMarkup(item)).join('') : `<p class="empty-note">${t('achievementNoIssuedCredentials')}</p>`}</div></section>
      </div>
    </div>`;
  },
};
