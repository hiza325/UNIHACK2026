/* profile views — extracted from app-views.js. Methods are merged into viewMethods. */
import { demo } from '../demo.js';
import { svgIcon } from '../icons.js';
export const profileViews = {
  viewProfile() {
    const t = k => this.t(k);
    const initials = (this.user.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const goals = [['profGoal1', 70], ['profGoal2', 55], ['profGoal3', 40]].map(([key, value]) => `<div class="goal-row"><div class="skill-top"><span>${t(key)}</span><span>${value}%</span></div><div class="skill-track" role="progressbar" aria-label="${t(key)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div></div>`).join('');
    const badges = [1, 2, 3, 4].map(i => `<div class="badge-tile ${i === 4 ? 'locked' : ''}"><span class="badge-icon">${svgIcon(i === 4 ? 'clock' : 'spark')}</span><strong>${t('badge' + i)}</strong><small>${t('badge' + i + 'Desc')}</small></div>`).join('');
    return `<div class="page">
      ${this.viewHead(t('pageProfile'), 'profSub')}
      <section class="card profile-hero">
        <div class="avatar profile-avatar-lg">${this.escape(initials)}</div>
        <div class="profile-hero-copy"><h2>${this.escape(this.user.name || this.user.email)}</h2><p>${this.escape(this.user.email)}</p><span class="profile-since">${t('profSince')}</span></div>
        <div class="profile-plan"><span class="plan-tag">FREE</span><strong>${t('profPlanName')}</strong><button class="ghost-button" data-upgrade>${t('profUpgrade')} ↗</button></div>
      </section>
      <div class="stat-grid three">
        ${this.statCard(t('profSessions'), demo[this.lang].sessions.length, '')}
        ${this.statCard(t('accuracy'), '72%', '', '↗ 8%')}
        ${this.statCard(t('streak'), 6, this.lang === 'en' ? 'days' : this.lang === 'jp' ? '日' : 'ngày')}
      </div>
      <div class="profile-grid">
        <section class="card form-card"><div class="panel-head"><h3 class="panel-title">${t('profInfo')}</h3></div><form id="profile-form" class="profile-form"><label>${t('profName')}<input name="name" value="${this.escape(this.user.name || '')}" required></label><label>${t('profEmail')}<input value="${this.escape(this.user.email)}" disabled></label><button class="primary-button" type="submit">${t('profSave')} ↗</button></form></section>
        <section class="card"><div class="panel-head"><h3 class="panel-title">${t('profGoals')}</h3></div><div class="goal-list">${goals}</div></section>
        <section class="card profile-badges"><div class="panel-head"><h3 class="panel-title">${t('profBadges')}</h3></div><div class="badge-grid">${badges}</div></section>
      </div>
    </div>`;
  },
};
