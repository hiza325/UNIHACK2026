/* Remote achievements come from backend-derived evidence; issued credentials still require on-chain evidence. */
import { issuedCredentials } from '../learning-data.js';
import { svgIcon } from '../icons.js';

export const profileViews = {
  profileIdentityMarkup() {
    const t = key => this.t(key);
    const memberSince = this.user.createdAt
      ? t('profSinceDate').replace('{date}', this.formatDisplayDate(this.user.createdAt, { month: 'long', year: 'numeric' }))
      : t('profSinceUnknown');
    return `<section class="card profile-hero"><div class="profile-avatar-control"><div class="profile-avatar-wrap">${this.avatarMarkup('profile-avatar-lg')}<button class="avatar-camera" type="button" data-avatar-change aria-label="${this.avatarText('change')}" title="${this.avatarText('change')}">${svgIcon('camera')}</button></div><input type="file" data-avatar-file accept="image/jpeg,image/png,image/webp" hidden><button type="button" class="avatar-remove" data-avatar-remove ${this.avatarUrl ? '' : 'hidden'}>${this.avatarText('remove')}</button></div><div class="profile-hero-copy"><h2>${this.escape(this.user.name || this.user.email)}</h2><p>${this.escape(this.user.email)}</p><span class="profile-since">${svgIcon('calendar')}${this.escape(memberSince)}</span><span class="avatar-status" data-avatar-status role="status" aria-live="polite">${this.escape(this.avatarLoadError || '')}</span>${this.avatarLoadError ? `<button class="avatar-remove" type="button" data-avatar-reload>${this.avatarText('retry')}</button>` : ''}</div><div class="profile-id-art" aria-hidden="true">${svgIcon('user')}<i></i><i></i></div><div class="profile-plan"><span class="plan-tag">${svgIcon('user')} ${this.authProvider === 'remote' || localStorage.getItem('paradox-local-server') === '1' ? t('dataStateReal') : t('dataStateDemo')}</span><strong>${t('planDataUnavailable')}</strong></div></section>`;
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
    const head = this.viewHead(t('pageProfile'), 'profSub').replace(`<span class="live-dot"></span> ${t('workspace')}`, `${svgIcon('user')} ${t('pageProfile')}`);
    const identity = this.profileIdentityMarkup();
    const form = `<section class="card form-card"><div class="panel-head"><h2 class="panel-title">${svgIcon('edit')} ${t('profInfo')}</h2></div><form id="profile-form" class="profile-form"><label>${t('profName')}<span class="profile-input">${svgIcon('user')}<input name="name" autocomplete="name" maxlength="80" value="${this.escape(this.user.name || '')}" required></span></label><label>${t('profEmail')}<span class="profile-input">${svgIcon('mail')}<input type="email" value="${this.escape(this.user.email)}" disabled></span></label><button class="primary-button" type="submit">${t('profSave')} ${svgIcon('check')}</button><p data-profile-status role="status" aria-live="polite"></p></form></section>`;
    if (state === 'loading') return `<div class="page profile-page" data-achievement-page-state="loading">${head}${identity}${this.dataStatePanel('loading', { title: t('achievementLoadingTitle'), message: t('achievementLoadingDesc') })}${form}</div>`;
    if (state === 'error') return `<div class="page profile-page" data-achievement-page-state="error">${head}${identity}${this.dataStatePanel('error', { title: t('achievementErrorTitle'), message: t('achievementErrorDesc'), retry: 'data-retry-learning-data' })}${form}</div>`;
    if (state === 'empty') return `<div class="page profile-page" data-achievement-page-state="empty">${head}${identity}<section class="card profile-achievement-empty data-state-panel empty" data-data-state="empty" role="status"><span class="profile-trophy">${svgIcon('trophy')}</span><div><h2>${t('achievementEmptyTitle')}</h2><p>${t('achievementEmptyDesc')}</p></div><img class="profile-medal" src="assets/profile-medal.svg" alt="" aria-hidden="true"></section>${form}</div>`;

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
