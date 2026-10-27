/* history views — extracted from app-views.js. Methods are merged into viewMethods. */
import { svgIcon } from '../icons.js';
export const historyViews = {
  viewHistory() {
    const t = k => this.t(k);
    const sessions = this.getSessions();
    const avg = sessions.length ? Math.round(sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length) : 0;
    const mastered = sessions.filter(s => s.status === 'mastered').length;
    const filters = [['all', 'histAll'], ['needs', 'histNeeds'], ['mastered', 'histMastered'], ['progress', 'histProgress']]
      .map(([value, key], i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-history-filter="${value}" aria-pressed="${i === 0}">${t(key)}</button>`).join('');
    const subjects = [...new Set(sessions.map(item => item.skill))].map(subject => `<option value="${this.escape(subject)}">${this.escape(subject)}</option>`).join('');
    return `<div class="page">
      ${this.viewHead(t('pageHistory'), 'histSub')}
      <div class="stat-grid three">
        ${this.statCard(t('histTotal'), sessions.length, '')}
        ${this.statCard(t('histAvg'), avg, '/100')}
        ${this.statCard(t('histMasteredCount'), mastered, `/${sessions.length}`)}
      </div>
      <section class="card history-card">
        <div class="filter-row"><div class="chip-row">${filters}</div><label class="search-field">${svgIcon('search')}<input id="history-search" placeholder="${t('histSearch')}" aria-label="${t('histSearch')}" autocomplete="off"></label></div>
        <div class="history-tools"><select id="history-subject" aria-label="${t('histSubjectFilter')}"><option value="all">${t('histSubjectFilter')}</option>${subjects}</select><select id="history-date" aria-label="${t('histDateFilter')}"><option value="all">${t('histDateFilter')}</option><option value="7">${t('histLast7')}</option><option value="30">${t('histLast30')}</option><option value="90">${t('histLast90')}</option></select><div class="history-data-actions"><button class="ghost-button" id="export-history">${svgIcon('download')} ${t('histExport')}</button><label class="ghost-button import-button" for="import-history">${t('histImport')}<input id="import-history" type="file" accept="application/json,.json"></label></div></div>
        <div class="session-table">
          <div class="session-head"><span>${t('histSession')}</span><span>${t('histSkill')}</span><span>${t('histScore')}</span><span>${t('histStatus')}</span><span></span></div>
          ${sessions.map(s => this.sessionRow(s)).join('')}
        </div>
        <p class="empty-note" id="history-empty" hidden>${t('histEmpty')}</p>
        <div class="history-pagination"><button class="ghost-button" data-history-page="prev" aria-label="${t('back')}"><span aria-hidden="true">←</span></button><span id="history-page-label">${t('histPage')} 1 / 1</span><button class="ghost-button" data-history-page="next" aria-label="${t('dashOpen')}"><span aria-hidden="true">→</span></button></div>
      </section>
    </div>`;
  },
};
