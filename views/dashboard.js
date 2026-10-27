/* dashboard views — extracted from app-views.js. Methods are merged into viewMethods. */
import { svgIcon } from '../icons.js';
export const dashboardViews = {
  viewDashboard() {
    const t = k => this.t(k);
    const name = this.escape(this.user.name || this.user.email);
    const greeting = t('welcome').replace('Minh Anh', name).replace('ミン・アイン', name);
    const metrics = this.learningMetrics();
    const recent = metrics.sessions.slice(0, 3).map(s => this.sessionRow(s, true)).join('');
    const currentStep = Math.max(1, Math.min(7, this.step + 1));
    const progressPercent = Math.round(currentStep / 7 * 100);
    return `<div class="page">
      ${this.viewHead(greeting, 'subtitle')}
      <div class="quick-actions">
        <button class="primary-button" data-route="audit">${t('dashNew')} <span class="button-arrow">↗</span></button>
        <button class="ghost-button" data-route="practice">${svgIcon('spark')} ${t('navPractice')}</button>
      </div>
      <div class="content-grid">
        <div class="left-stack">
          <section class="card continue-card">
            <div class="continue-top"><span class="eyebrow">${t('dashContinue')}</span><span class="continue-step">${String(currentStep).padStart(2, '0')} / 07</span></div>
            <h2>${t('dashContinueTitle')}</h2>
            <p>${t('dashContinueDesc')}</p>
            <div class="continue-progress" role="progressbar" aria-label="${t('dashContinueTitle')}" aria-valuemin="1" aria-valuemax="7" aria-valuenow="${currentStep}" aria-valuetext="${currentStep} / 7"><span style="width:${progressPercent}%"></span></div>
            <div class="continue-foot"><span class="difficulty">${t('difficulty')}</span><button class="primary-button" data-route="audit">${t('dashResume')} ↗</button></div>
          </section>
          <section class="card recent-card">
            <div class="panel-head"><div><h3 class="panel-title">${t('dashRecent')}</h3><p class="panel-sub">${t('dashRecentSub')}</p></div><button class="panel-link" data-route="history">${t('viewAll')}</button></div>
            <div class="recent-list">${recent}</div>
          </section>
        </div>
        <div class="right-stack">
          ${this.learningMetricCards(metrics)}
          ${this.activityCard()}
          ${this.sourceCard()}
        </div>
      </div>
    </div>`;
  },
};
