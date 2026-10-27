/* analytics views — extracted from app-views.js. Methods are merged into viewMethods. */
export const analyticsViews = {
  viewAnalytics() {
    const t = k => this.t(k);
    const period = this.chartPeriod || 30;
    const metrics = this.learningMetrics();
    const series = this.activitySeries(period);
    const labels = period === 7 ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : series.values.map((_, i) => String(i + 1));
    const chart = this.barChartMarkup(series, labels, { title: t('anaWeekly'), chartClass: 'big-chart', labelsClass: 'big-chart-labels' });
    const skillValues = [metrics.accuracy, metrics.average, Math.min(100, 45 + this.practiceSolved.length * 8), Math.min(100, 40 + metrics.mastered * 10)];
    const skillRows = skillValues.map((value, i) => `<div class="skill-row"><div class="skill-top"><span>${t('skill' + (i + 1))}</span><span>${value}%</span></div><div class="skill-track" role="progressbar" aria-label="${t('skill' + (i + 1))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><span style="width:${value}%"></span></div></div>`).join('');
    return `<div class="page">
      ${this.viewHead(t('pageAnalytics'), 'anaSub')}
      <div class="period-row">${[[7, 'ana7'], [30, 'ana30'], [90, 'ana90']].map(([p, k]) => `<button class="chip ${period === p ? 'active' : ''}" data-chart-period="${p}" aria-pressed="${period === p}">${t(k)}</button>`).join('')}</div>
      <div class="stat-grid">
        ${this.statCard(t('accuracy'), `${metrics.accuracy}%`)}
        ${this.statCard(t('anaScore'), metrics.average, '/100')}
        ${this.statCard(t('anaSessions'), metrics.sessions.length, '')}
        ${this.statCard(t('streak'), metrics.streak, this.lang === 'en' ? 'days' : this.lang === 'jp' ? '日' : 'ngày')}
      </div>
      <div class="analytics-grid">
        <section class="card chart-card"><div class="panel-head"><div><h2 class="panel-title">${t('anaWeekly')}</h2><p class="panel-sub">${t('anaWeeklySub')}</p></div><span class="plan-tag">${t('thisWeek')}</span></div>${chart}</section>
        <section class="card skills-card"><div class="panel-head"><div><h2 class="panel-title">${t('anaSkills')}</h2><p class="panel-sub">${t('anaSkillsSub')}</p></div></div><div class="skill-list">${skillRows}</div></section>
      </div>
      <h2 class="section-title">${t('anaInsights')}</h2>
      <div class="insight-grid">
        <article class="card insight-card strong"><span class="eyebrow">${t('anaStrength')}</span><p>${t('anaStrengthDesc').replace('{value}', String(metrics.accuracy))}</p></article>
        <article class="card insight-card focus"><span class="eyebrow">${t('anaFocus')}</span><p>${t('anaFocusDesc')}</p></article>
        <article class="card insight-card tip"><span class="eyebrow">${t('anaTip')}</span><p>${t('anaTipDesc')}</p></article>
      </div>
    </div>`;
  },
};
