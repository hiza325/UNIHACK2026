/* practice views — extracted from app-views.js. Methods are merged into viewMethods. */
import { demo } from '../demo.js';
import { svgIcon } from '../icons.js';

const topicGlyphs = ['∫', 'Σ', '</>', '∴', '▥', '⚛'];

function practiceHead(t, view) {
  return `<section class="view-head practice-head"><div><div class="eyebrow"><span class="eyebrow-icon" aria-hidden="true">${svgIcon('flask')}</span> PRACTICE LAB</div><h1>${t('pagePractice')}</h1><p class="view-sub">${t('pracSub')}</p></div><time class="date-chip" datetime="${view.localDateKey()}" title="${t('timeZoneLabel')}: ${view.displayTimeZone()}">◷ &nbsp;${view.escape(view.currentDateLabel())} · ${view.displayTimeZone()}</time></section>`;
}

export const practiceViews = {
  viewPractice() {
    const t = k => this.t(k);
    const serviceEnabled = this.practiceService?.enabled;
    const head = practiceHead(t, this);

    if (serviceEnabled && this.practiceState === 'loading') {
      return `<div class="page practice-page" data-practice-state="loading">${head}${this.dataStatePanel('loading', { title: t('dataLoadingTitle'), message: t('dataLoadingMessage') })}</div>`;
    }
    if (serviceEnabled && this.practiceState === 'error') {
      return `<div class="page practice-page" data-practice-state="error">${head}<div class="data-view-heading">${this.dataSourceBadge('real')}</div>${this.dataStatePanel('error', { title: t('dataErrorTitle'), message: this.practiceError || t('dataErrorMessage'), retry: 'data-retry-practice-load' })}</div>`;
    }
    if (serviceEnabled && this.practiceState === 'empty') {
      return `<div class="page practice-page" data-practice-state="empty">${head}<div class="data-view-heading">${this.dataSourceBadge('real')}</div>${this.dataStatePanel('empty', { title: t('pracEmptyTitle'), message: t('pracEmptyDesc') })}</div>`;
    }

    const demoMode = !serviceEnabled || this.practiceState !== 'ready';
    let challenges = [];
    if (demoMode) {
      challenges = (demo[this.lang].challenges || []).map((item, index) => ({
        key: String(index),
        subject: item.subject,
        subjectKey: item.subject,
        title: item.title,
        question: item.question,
        level: item.level,
        mins: item.mins,
        source: item.source,
        solved: this.practiceSolved.includes(index),
      }));
    } else {
      challenges = (this.practiceChallenges || []).map(item => ({
        key: item.slug,
        subject: item.subject,
        subjectKey: item.subjectKey,
        title: item.title,
        question: item.question,
        level: item.level,
        mins: item.minutes,
        source: item.source,
        solved: this.practiceIsSolved(item.slug),
      }));
    }

    const subjects = [];
    const subjectMap = new Map();
    for (const challenge of challenges) {
      const key = challenge.subjectKey || challenge.subject;
      if (!subjectMap.has(key)) {
        subjectMap.set(key, { key, label: challenge.subject, total: 0, solved: 0 });
        subjects.push(subjectMap.get(key));
      }
      const entry = subjectMap.get(key);
      entry.total += 1;
      if (challenge.solved) entry.solved += 1;
    }

    const solvedCount = demoMode
      ? this.practiceSolved.length
      : (this.practiceProgress?.solvedChallenges ?? challenges.filter(item => item.solved).length);
    const totalCount = demoMode
      ? challenges.length
      : (this.practiceProgress?.totalChallenges ?? challenges.length);

    const topicProgress = subjects.map((subject, index) => {
      const percent = subject.total ? Math.round((subject.solved / subject.total) * 100) : 0;
      return `<article class="topic-progress-card" data-topic-key="${this.escape(subject.key)}"><span class="topic-icon" aria-hidden="true">${topicGlyphs[index % topicGlyphs.length]}</span><div class="topic-copy"><div class="skill-top"><span>${this.escape(subject.label)}</span><span>${subject.solved}/${subject.total}</span></div><div class="skill-track" role="progressbar" aria-label="${this.escape(subject.label)}" aria-valuemin="0" aria-valuemax="${subject.total}" aria-valuenow="${subject.solved}" aria-valuetext="${subject.solved} / ${subject.total}"><span style="width:${percent}%"></span></div><small>${subject.solved} ${t('pracSolvedCount')}</small></div></article>`;
    }).join('');

    const cards = challenges.map(challenge => {
      const solved = challenge.solved;
      const index = subjects.findIndex(subject => (subject.key || subject.label) === (challenge.subjectKey || challenge.subject));
      return `<article class="challenge-card ${solved ? 'solved' : ''}" data-challenge="${this.escape(challenge.key)}">
        <div class="challenge-top"><span class="challenge-icon" aria-hidden="true">${topicGlyphs[Math.max(index, 0) % topicGlyphs.length]}</span><span class="challenge-badge">${solved ? `✓ ${t('pracSolved')}` : `${challenge.mins} ${t('pracMinutes')}`}</span></div>
        <span class="eyebrow">${this.escape(challenge.subject)}</span>
        <h3>${this.escape(challenge.title)}</h3>
        <p>${this.escape(challenge.question)}</p>
        <div class="challenge-meta"><span class="challenge-level">${t('pracLevel')} · ${this.escape(challenge.level)}</span><button class="ghost-button" data-challenge="${this.escape(challenge.key)}">${solved ? t('pracSolved') : t('pracStart')} <span class="button-arrow" aria-hidden="true">→</span></button></div>
      </article>`;
    }).join('');

    const heading = demoMode
      ? `<div class="data-view-heading">${this.dataSourceBadge('demo')}<span>${t('practiceDemoNotice')}</span></div>`
      : `<div class="data-view-heading">${this.dataSourceBadge('real')}<span>${t('practiceRealNotice')}</span></div>`;

    return `<div class="page practice-page" data-practice-state="${demoMode ? 'demo' : 'ready'}">
      ${head}
      ${heading}
      <section class="card daily-card practice-daily">
        <div class="practice-daily-copy"><span class="eyebrow">${t('pracDaily')}</span><h2>${t('pracDailyTitle')}</h2><p>${t('pracDailyDesc')}</p></div>
        <div class="practice-daily-art" aria-hidden="true"><span class="daily-art-frame">${svgIcon('spark')}</span><span class="daily-art-dot">${svgIcon('check')}</span></div>
        <div class="daily-side"><span class="daily-time">◷ ${challenges[0]?.mins || 3} ${t('pracMinutes')}</span><button class="primary-button" data-challenge="${this.escape(challenges[0]?.key || '0')}">${t('pracStart')} <span class="button-arrow" aria-hidden="true">→</span></button></div>
      </section>
      <section class="topic-progress-section"><h2 class="section-title"><span class="section-icon" aria-hidden="true">${svgIcon('chart')}</span> ${t('pracTopicProgress')}</h2><div class="topic-progress-grid">${topicProgress}</div></section>
      <div class="challenge-grid">${cards}</div>
      <p class="practice-count">${t('pracSolved')}: ${solvedCount} / ${totalCount}</p>
      <div class="practice-backdrop" id="practice-modal" hidden></div>
    </div>`;
  },
};
