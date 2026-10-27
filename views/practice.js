/* practice views — extracted from app-views.js. Methods are merged into viewMethods. */
import { demo } from '../demo.js';
export const practiceViews = {
  viewPractice() {
    const t = k => this.t(k);
    const list = demo[this.lang].challenges;
    const topics = [...new Set(list.map(item => item.subject))];
    const topicProgress = topics.map(subject => {
      const indexes = list.map((item, index) => item.subject === subject ? index : -1).filter(index => index >= 0);
      const solved = indexes.filter(index => this.practiceSolved.includes(index)).length;
      const percent = Math.round(solved / indexes.length * 100);
      return `<article class="topic-progress-card"><div class="skill-top"><span>${this.escape(subject)}</span><span>${solved}/${indexes.length}</span></div><div class="skill-track" role="progressbar" aria-label="${this.escape(subject)}" aria-valuemin="0" aria-valuemax="${indexes.length}" aria-valuenow="${solved}" aria-valuetext="${solved} / ${indexes.length}"><span style="width:${percent}%"></span></div><small>${solved} ${t('pracSolvedCount')}</small></article>`;
    }).join('');
    const cards = list.map((c, i) => {
      const done = this.practiceSolved.includes(i);
      return `<article class="challenge-card ${done ? 'solved' : ''}">
        <div class="challenge-top"><span class="eyebrow">${this.escape(c.subject)}</span><span class="challenge-badge">${done ? t('pracSolved') : `${c.mins} ${t('pracMinutes')}`}</span></div>
        <h3>${this.escape(c.title)}</h3>
        <p>${this.escape(c.question)}</p>
        <div class="challenge-meta"><span>${t('pracLevel')} · ${this.escape(c.level)}</span><span>${done ? '✓' : `${c.mins} ${t('pracMinutes')}`}</span></div>
        <button class="ghost-button" data-challenge="${i}">${done ? t('pracSolved') : t('pracStart')} ↗</button>
      </article>`;
    }).join('');
    return `<div class="page">
      ${this.viewHead(t('pagePractice'), 'pracSub')}
      <section class="card daily-card">
        <div><span class="eyebrow">${t('pracDaily')}</span><h2>${t('pracDailyTitle')}</h2><p>${t('pracDailyDesc')}</p></div>
        <div class="daily-side"><span class="difficulty">${t('difficulty')}</span><button class="primary-button" data-challenge="0">${t('pracStart')} ↗</button></div>
      </section>
      <section class="topic-progress-section"><h2 class="section-title">${t('pracTopicProgress')}</h2><div class="topic-progress-grid">${topicProgress}</div></section>
      <div class="challenge-grid">${cards}</div>
      <p class="practice-count">${t('pracSolved')}: ${this.practiceSolved.length} / ${list.length}</p>
      <div class="practice-backdrop" id="practice-modal" hidden></div>
    </div>`;
  },
};
