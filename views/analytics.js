/* Analytics reports measured values only; it does not infer rankings, strengths, or weaknesses. */
export const analyticsViews = {
  viewAnalytics() {
    const t = key => this.t(key);
    const state = this.learningDataState();
    const head = this.viewHead(t('pageAnalytics'), 'anaSub');
    if (state === 'loading') return `<div class="page analytics-page" data-analytics-state="loading">${head}${this.dataStatePanel('loading')}</div>`;
    if (state === 'error') return `<div class="page analytics-page" data-analytics-state="error">${head}${this.dataStatePanel('error', { retry: 'data-retry-learning-records' })}</div>`;
    if (state === 'empty') return `<div class="page analytics-page" data-analytics-state="empty">${head}${this.dataStatePanel('empty', { title: t('anaEmptyTitle'), message: t('anaEmptyDesc') })}</div>`;

    const period = this.chartPeriod || 30;
    const metrics = this.learningMetrics();
    const series = this.activitySeries(period);
    const chart = this.barChartMarkup(series, series.labels, { title: t('anaWeekly'), chartClass: 'big-chart', labelsClass: 'big-chart-labels' });
    return `<div class="page analytics-page" data-analytics-state="${state}">
      ${head}
      <div class="data-view-heading">${this.dataSourceBadge(state)}<span>${state === 'demo' ? t('dataDemoNotice') : t('dataRealNotice')}</span></div>
      <div class="period-row">${[[7, 'ana7'], [30, 'ana30'], [90, 'ana90']].map(([value, key]) => `<button class="chip ${period === value ? 'active' : ''}" data-chart-period="${value}" aria-pressed="${period === value}">${t(key)}</button>`).join('')}</div>
      <div class="stat-grid">
        ${this.statCard(t('anaScore'), metrics.average, '/100')}
        ${this.statCard(t('anaSessions'), metrics.sessions.length)}
        ${this.statCard(t('histCompletedCount'), metrics.completed, `/${metrics.sessions.length}`)}
        ${this.statCard(t('streak'), metrics.streak, this.lang === 'en' ? ' days' : this.lang === 'jp' ? '日' : ' ngày')}
      </div>
      <section class="card chart-card"><div class="panel-head"><div><h2 class="panel-title">${t('anaWeekly')}</h2><p class="panel-sub">${t('anaWeeklySub')}</p></div><span class="plan-tag">${t('dataMeasured')}</span></div>${chart}</section>
      <section class="card analytics-coverage"><h2>${t('anaCoverageTitle')}</h2><p>${t('anaCoverageDesc').replace('{scored}', String(metrics.scoredSessionCount)).replace('{total}', String(metrics.sessions.length))}</p>${metrics.accuracy === null ? `<p>${t('anaNoSelfDetection')}</p>` : `<p>${t('accuracy')}: <strong>${metrics.accuracy}%</strong></p>`}</section>
    </div>`;
  },
};
