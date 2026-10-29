/* Learning history renders explicit data states instead of treating request failures as an empty list. */
import { svgIcon } from '../icons.js';

export const historyViews = {
  viewHistory() {
    const t = key => this.t(key);
    const state = this.learningDataState();
    const head = this.viewHead(t('pageHistory'), 'histSub');
    if (state === 'loading') return `<div class="page history-page" data-history-state="loading">${head}${this.dataStatePanel('loading')}</div>`;
    if (state === 'error') return `<div class="page history-page" data-history-state="error">${head}${this.dataStatePanel('error', { retry: 'data-retry-learning-records' })}</div>`;
    if (state === 'empty') return `<div class="page history-page" data-history-state="empty">${head}${this.dataStatePanel('empty', { title: t('histEmptyTitle'), message: t('histEmptyDesc') })}</div>`;

    const metrics = this.learningMetrics();
    const sessions = metrics.sessions;
    const filters = [
      ['all', 'histAll'], ['progress', 'histProgress'], ['completed', 'statusCompleted'],
      ['error', 'statusError'], ['abandoned', 'statusAbandoned'], ['needs', 'histNeeds'], ['mastered', 'histMastered'],
    ].map(([value, key], index) => `<button class="chip ${index === 0 ? 'active' : ''}" data-history-filter="${value}" aria-pressed="${index === 0}">${t(key)}</button>`).join('');
    const subjects = [...new Set(sessions.map(item => item.skill).filter(Boolean))].map(subject => `<option value="${this.escape(subject)}">${this.escape(subject)}</option>`).join('');
    return `<div class="page history-page" data-history-state="${state}">
      ${head}
      <div class="data-view-heading">${this.dataSourceBadge(state)}<span>${state === 'demo' ? t('dataDemoNotice') : t('dataRealNotice')}</span></div>
      <div class="stat-grid three">${this.statCard(t('histTotal'), sessions.length)}${this.statCard(t('histAvg'), metrics.average, '/100')}${this.statCard(t('histCompletedCount'), metrics.completed, `/${sessions.length}`)}</div>
      <section class="card history-card">
        <div class="filter-row"><div class="chip-row">${filters}</div><label class="search-field">${svgIcon('search')}<input id="history-search" placeholder="${t('histSearch')}" aria-label="${t('histSearch')}" autocomplete="off"></label></div>
        <div class="history-tools"><select id="history-subject" aria-label="${t('histSubjectFilter')}"><option value="all">${t('histSubjectFilter')}</option>${subjects}</select><select id="history-date" aria-label="${t('histDateFilter')}"><option value="all">${t('histDateFilter')}</option><option value="7">${t('histLast7')}</option><option value="30">${t('histLast30')}</option><option value="90">${t('histLast90')}</option></select><div class="history-data-actions"><button class="ghost-button" id="export-history">${svgIcon('download')} ${t('histExport')}</button><label class="ghost-button import-button" for="import-history">${t('histImport')}<input id="import-history" type="file" accept="application/json,.json"></label></div></div>
        <div class="session-table"><div class="session-head"><span>${t('histSession')}</span><span>${t('histSkill')}</span><span>${t('histScore')}</span><span>${t('histStatus')}</span><span></span></div>${sessions.map(session => this.sessionRow(session)).join('')}</div>
        <p class="empty-note" id="history-empty" hidden>${t('histEmpty')}</p>
        <div class="history-pagination"><button class="ghost-button" data-history-page="prev" aria-label="${t('back')}"><span aria-hidden="true">←</span></button><span id="history-page-label">${t('histPage')} 1 / 1</span><button class="ghost-button" data-history-page="next" aria-label="${t('dashOpen')}"><span aria-hidden="true">→</span></button></div>
      </section>
    </div>`;
  },
};
