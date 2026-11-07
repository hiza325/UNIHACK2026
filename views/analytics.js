/* Analytics reports measured values only; it does not infer rankings, strengths, or weaknesses. */
import { svgIcon } from '../icons.js';

export const analyticsViews = {
  analyticsNextStepsMarkup() {
    const text = this.lang === 'en'
      ? ['What can you do next?', 'Start a learning session', 'Submit your work for detailed feedback', 'Practice by topic', 'Build knowledge through practice', 'View learning history', 'Review your previous sessions']
      : this.lang === 'jp'
        ? ['次にできること', '学習セッションを開始', '解答を提出して詳しいフィードバックを受ける', 'テーマ別に練習', '練習を通じて知識を深める', '学習履歴を見る', 'これまでのセッションを振り返る']
        : ['Bạn có thể làm gì tiếp theo?', 'Thực hiện một phiên học', 'Gửi bài để nhận phân tích chi tiết', 'Luyện tập theo chủ đề', 'Củng cố kiến thức qua luyện tập', 'Xem lịch sử học tập', 'Xem lại các phiên học trước đây'];
    return `<section class="history-suggestions analytics-next"><h2>${svgIcon('spark')} ${text[0]}</h2><div>${[['audit', 'chart'], ['practice', 'spark'], ['history', 'clock']].map(([route, icon], i) => `<button type="button" class="history-suggestion" data-route="${route}"><span class="suggestion-icon">${svgIcon(icon)}</span><span><strong>${text[i * 2 + 1]}</strong><small>${text[i * 2 + 2]}</small></span>${svgIcon('arrow')}</button>`).join('')}</div></section>`;
  },
  viewAnalytics() {
    const t = key => this.t(key);
    const state = this.learningDataState();
    const head = this.viewHead(t('pageAnalytics'), 'anaSub');
    if (state === 'loading') return `<div class="page analytics-page" data-analytics-state="loading">${head}${this.dataStatePanel('loading')}</div>`;
    if (state === 'error') return `<div class="page analytics-page" data-analytics-state="error">${head}${this.dataStatePanel('error', { retry: 'data-retry-learning-records' })}</div>`;
    if (state === 'empty') return `<div class="page analytics-page" data-analytics-state="empty">${head}<section class="card history-welcome analytics-welcome" data-data-state="empty" role="status"><div class="history-illustration" aria-hidden="true">${svgIcon('chart')}${svgIcon('arrow')}</div><h2>${t('anaEmptyTitle')}</h2><p>${t('anaEmptyDesc')}</p><button class="primary-button" type="button" data-route="audit">▷ ${t('dashNew')}</button></section>${this.analyticsNextStepsMarkup()}</div>`;

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
      ${this.analyticsNextStepsMarkup()}
    </div>`;
  },
};
