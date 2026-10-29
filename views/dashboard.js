/* Dashboard values come only from the active learning-record and credential sources. */
import { svgIcon } from '../icons.js';
import { issuedCredentials } from '../learning-data.js';

export const dashboardViews = {
  dashboardDataState() {
    const learningState = this.learningDataState();
    const passportState = this.learningPassportDataState();
    const passportIsApi = this.learningPassportService?.mode === 'api';
    if (learningState === 'loading' || (passportIsApi && passportState === 'loading')) return 'loading';
    if (learningState === 'error' || (passportIsApi && passportState === 'error')) return 'error';
    if (learningState === 'demo') return 'demo';
    if (learningState === 'real' || (passportIsApi && passportState === 'real')) return 'real';
    return 'empty';
  },
  dashboardContinueMarkup(metrics) {
    const active = metrics.sessions.find(session => ['in_progress', 'analysis_unavailable'].includes(
      session.recordStatus || (session.status === 'progress' ? 'in_progress' : ''),
    ));
    if (!active) {
      return `<section class="card continue-empty" data-continue-state="empty"><span class="continue-empty-icon">${svgIcon('book')}</span><div><span class="eyebrow">${this.t('dashFirstSessionEyebrow')}</span><h2>${this.t('dashFirstSessionTitle')}</h2><p>${this.t('dashFirstSessionDesc')}</p><button class="primary-button" data-route="audit">${this.t('dashNew')} ↗</button></div></section>`;
    }
    const status = active.recordStatus === 'analysis_unavailable' ? this.t('dashSessionNeedsRetry') : this.t('dashSessionInProgress');
    return `<section class="card continue-card" data-continue-state="real" data-session-id="${this.escape(active.id)}">
      <div class="continue-top"><span class="eyebrow">${this.t('dashContinue')}</span><span class="continue-step">${status}</span></div>
      <h2>${this.escape(active.title)}</h2>
      <p>${this.escape(active.skill)} · ${this.escape(this.sessionDisplayDate(active))}</p>
      <div class="continue-foot"><span class="difficulty">${this.t('dashSavedSession')}</span><button class="primary-button" type="button" data-resume-session="${this.escape(active.id)}">${this.t('dashResume')} ↗</button></div>
    </section>`;
  },
  viewDashboard() {
    const t = key => this.t(key);
    const name = this.escape(this.user.name || this.user.email);
    const greeting = t('dashWelcome').replace('{name}', name);
    const state = this.dashboardDataState();
    const head = `${this.viewHead(greeting, 'subtitle')}`;
    if (state === 'loading') return `<div class="page dashboard-page" data-dashboard-state="loading">${head}${this.dataStatePanel('loading', { title: t('dashLoadingTitle'), message: t('dashLoadingDesc') })}</div>`;
    if (state === 'error') return `<div class="page dashboard-page" data-dashboard-state="error">${head}${this.dataStatePanel('error', { title: t('dashErrorTitle'), message: t('dashErrorDesc'), retry: 'data-retry-learning-data' })}</div>`;
    if (state === 'empty') {
      return `<div class="page dashboard-page" data-dashboard-state="empty">${head}${this.dataStatePanel('empty', { title: t('dashEmptyTitle'), message: t('dashEmptyDesc') })}${this.dashboardContinueMarkup({ sessions: [] })}</div>`;
    }

    const metrics = this.learningMetrics();
    const achievements = this.learningAchievements();
    const earnedAchievements = achievements.filter(item => item.status === 'earned').length;
    const passportState = this.learningPassportDataState();
    const passport = passportState === 'real' ? this.getLearningPassportSnapshot() : null;
    const credentialCount = passportState === 'real' || passportState === 'empty' ? issuedCredentials(passport).length : null;
    const recent = metrics.sessions.slice(0, 3).map(session => this.sessionRow(session, true)).join('');
    return `<div class="page dashboard-page" data-dashboard-state="${state}">
      ${head}
      <div class="data-view-heading">${this.dataSourceBadge(state)}<span>${state === 'demo' ? t('dataDemoNotice') : t('dataRealNotice')}</span></div>
      <div class="quick-actions"><button class="primary-button" data-route="audit">${t('dashNew')} <span class="button-arrow">↗</span></button><button class="ghost-button" data-route="practice">${svgIcon('spark')} ${t('navPractice')}</button></div>
      <div class="stat-grid four dashboard-stats">
        ${this.statCard(t('dashSessions'), metrics.sessions.length)}
        ${this.statCard(t('dashAchievements'), earnedAchievements, `/${achievements.length}`)}
        ${this.statCard(t('dashCredentialsIssued'), credentialCount)}
        ${this.statCard(t('dashCompletionProgress'), metrics.completionRate, '%')}
      </div>
      <div class="content-grid">
        <div class="left-stack">
          ${this.dashboardContinueMarkup(metrics)}
          <section class="card recent-card"><div class="panel-head"><div><h3 class="panel-title">${t('dashRecent')}</h3><p class="panel-sub">${t('dashRecentSub')}</p></div><button class="panel-link" data-route="history">${t('viewAll')}</button></div><div class="recent-list">${recent || `<p class="empty-note">${t('dashNoRecent')}</p>`}</div></section>
        </div>
        <div class="right-stack">${this.learningMetricCards(metrics)}${this.activityCard()}${this.sourceCard()}</div>
      </div>
    </div>`;
  },
};
