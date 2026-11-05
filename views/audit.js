/* audit views — extracted from app-views.js. Methods are merged into viewMethods. */
export const auditViews = {
  learningSessionActivityLabel(session) {
    const value = session?.lastActivityAt || session?.updatedAt || session?.startedAt;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    if (this.localDateKey(date) === this.localDateKey()) {
      return this.formatDisplayDate(date, { hour: '2-digit', minute: '2-digit' });
    }
    return this.formatDisplayDate(date, { day: '2-digit', month: '2-digit' });
  },
  learningSessionStatusLabel(status) {
    if (status === 'completed') return this.t('statusCompleted');
    if (status === 'abandoned') return this.t('statusAbandoned');
    if (status === 'analysis_unavailable') return this.t('statusError');
    return this.t('histProgress');
  },
  learningSessionGroups() {
    const groups = { today: [], yesterday: [], week: [], older: [] };
    const todayKey = this.localDateKey();
    const today = Date.parse(`${todayKey}T00:00:00Z`);
    for (const session of this.learningSessionList || []) {
      const value = session.lastActivityAt || session.updatedAt || session.startedAt;
      const date = new Date(value);
      const key = Number.isNaN(date.getTime()) ? '' : this.localDateKey(date);
      const day = key ? Math.round((today - Date.parse(`${key}T00:00:00Z`)) / 86_400_000) : 999;
      if (day <= 0) groups.today.push(session);
      else if (day === 1) groups.yesterday.push(session);
      else if (day <= 7) groups.week.push(session);
      else groups.older.push(session);
    }
    return [
      ['today', this.t('sessionToday'), groups.today],
      ['yesterday', this.t('sessionYesterday'), groups.yesterday],
      ['week', this.t('sessionLast7'), groups.week],
      ['older', this.t('sessionOlder'), groups.older],
    ].filter(([, , sessions]) => sessions.length);
  },
  learningSessionItemMarkup(session) {
    const id = this.escape(session.id);
    const selected = this.learningSessionSelectedId === session.id;
    const loading = this.learningSessionLoadingId === session.id;
    const renaming = this.learningSessionRenamingId === session.id;
    const deleting = this.learningSessionDeleteId === session.id;
    const menu = this.learningSessionMenuId === session.id;
    const title = this.escape(session.title || this.t('sessionUntitled'));
    const activity = this.escape(this.learningSessionActivityLabel(session));
    const status = this.escape(this.learningSessionStatusLabel(session.status));
    const renameForm = renaming ? `<form class="ls-rename" data-session-rename-form="${id}">
      <input class="ls-rename-input" data-session-rename-input name="title" maxlength="160" value="${this.escape(session.title || '')}" aria-label="${this.t('sessionRename')}">
      <div class="ls-rename-actions"><button class="ghost-button" type="submit">${this.t('sessionSave')}</button><button class="ghost-button" type="button" data-session-cancel-rename>${this.t('sessionCancel')}</button></div>
    </form>` : '';
    const deleteConfirm = deleting ? `<div class="ls-confirm" role="alert">
      <strong>${this.t('sessionDeleteConfirm')}</strong>
      <small>${this.t('sessionDeleteNote')}</small>
      <div class="ls-confirm-actions"><button class="ghost-button danger" type="button" data-session-confirm-delete="${id}">${this.t('sessionDelete')}</button><button class="ghost-button" type="button" data-session-cancel-delete>${this.t('sessionCancel')}</button></div>
    </div>` : '';
    const popover = menu ? `<div class="ls-menu" role="menu">
      <button type="button" role="menuitem" data-session-rename="${id}">${this.t('sessionRename')}</button>
      <button type="button" role="menuitem" data-session-ask-delete="${id}">${this.t('sessionDelete')}</button>
    </div>` : '';
    return `<article class="ls-session ${selected ? 'active' : ''}" data-session-id="${id}">
      <button type="button" class="ls-session-open" data-session-open="${id}" aria-current="${selected ? 'true' : 'false'}" ${loading ? 'disabled' : ''}>
        <span class="ls-title">${loading ? this.t('sessionLoading') : title}</span>
        <span class="ls-meta">${activity}${activity ? ' · ' : ''}${status}</span>
      </button>
      <button type="button" class="ls-more" data-session-menu="${id}" aria-label="${this.t('sessionMenu')}" aria-expanded="${menu}">⋯</button>
      ${popover}${renameForm}${deleteConfirm}
    </article>`;
  },
  learningSessionSidebarMarkup() {
    const groups = this.learningSessionGroups();
    const list = groups.map(([key, label, sessions]) => `<section class="ls-group" data-session-group="${key}"><h3>${this.escape(label)}</h3>${sessions.map(session => this.learningSessionItemMarkup(session)).join('')}</section>`).join('');
    const unavailable = !this.learningRecordsService?.enabled;
    const empty = !this.learningSessionListLoading && !unavailable && !this.learningSessionList.length;
    return `<aside class="learning-sessions ${this.learningSessionDrawerOpen ? 'open' : ''}" id="learning-session-panel" aria-label="${this.t('sessionHistory')}">
      <div class="ls-head"><div><span class="ls-kicker">PARADOX AI</span><h2>${this.t('sessionHistory')}</h2></div><button type="button" class="ls-close" data-session-close aria-label="${this.t('sessionClose')}">×</button></div>
      <button type="button" class="ls-new" data-session-new><span aria-hidden="true">＋</span> ${this.t('sessionNew')}</button>
      <label class="ls-search"><span class="sr-only">${this.t('sessionSearch')}</span><input id="learning-session-search" type="search" autocomplete="off" placeholder="${this.t('sessionSearch')}" value="${this.escape(this.learningSessionSearch)}"></label>
      <div class="ls-list" aria-live="polite">
        ${unavailable ? `<p class="ls-note">${this.t('sessionUnavailable')}</p>` : ''}
        ${this.learningSessionListError ? `<p class="ls-note error">${this.t('sessionLoadError')} <button type="button" class="ls-retry" data-session-retry>↻</button></p>` : ''}
        ${empty && !this.learningSessionListError ? `<p class="ls-note">${this.learningSessionSearch ? this.t('sessionNoResults') : this.t('sessionEmpty')}</p>` : ''}
        ${list}
        ${this.learningSessionHasMore ? `<button type="button" class="ls-more-sessions" data-session-more>${this.t('sessionLoadMore')}</button>` : ''}
      </div>
    </aside>
    <div class="learning-session-backdrop" data-session-backdrop data-session-close ${this.learningSessionDrawerOpen ? '' : 'hidden'}></div>`;
  },
  learningSessionCurrentHeaderMarkup() {
    const selected = this.learningSessionById(this.learningSessionSelectedId);
    const title = selected?.title || (this.learningRecordSessionId ? this.t('sessionUntitled') : this.t('sessionDraftTitle'));
    const activity = selected ? this.learningSessionActivityLabel(selected) : '';
    const status = selected ? this.learningSessionStatusLabel(selected.status) : '';
    return `<div class="learning-current-head">
      <div><span class="ls-kicker">${this.t('sessionCurrent')}</span><h2>${this.escape(title)}</h2><p>${activity ? `${this.t('sessionLastActive')} ${this.escape(activity)} · ${this.escape(status)}` : this.t('sessionWelcome')}</p></div>
      <button type="button" class="ghost-button" data-session-new>＋ ${this.t('sessionNew')}</button>
    </div>`;
  },
  learningSessionMobileBarMarkup() {
    const selected = this.learningSessionById(this.learningSessionSelectedId);
    const title = selected?.title || this.t('sessionDraftTitle');
    return `<div class="learning-session-mobilebar">
      <button type="button" class="ghost-button" data-session-drawer aria-expanded="${this.learningSessionDrawerOpen}" aria-controls="learning-session-panel">☰ ${this.t('sessionHistory')}</button>
      <strong>${this.escape(title)}</strong>
    </div>`;
  },
  viewAudit() {
    const t = k => this.t(k);
    const name = this.escape(this.user.name || this.user.email);
    const greeting = t('welcome').replace('Minh Anh', name).replace('ミン・アイン', name);
    const metrics = this.learningMetrics();
    return `<div class="page">
      ${this.viewHead(greeting, 'subtitle')}
      <div class="learning-workspace">
        ${this.learningSessionSidebarMarkup()}
        <div class="learning-main">
          ${this.learningSessionMobileBarMarkup()}
          ${this.learningSessionCurrentHeaderMarkup()}
      <div class="content-grid"><div class="left-stack">
        <section class="card audit-card"><div class="card-heading"><div><h2 class="card-title">${t('sessionTitle')}</h2><p class="card-caption">${t('sessionCaption')}</p></div><span class="session-id">SESSION #${new Date().getFullYear()}-014</span></div>
          <audit-stepper class="stepper" role="list" aria-label="${t('sessionTitle')}">${this.auditStepsMarkup()}</audit-stepper>
          <div class="upload-zone" id="drop-zone"><span class="upload-label">${t('problem')} + ${t('yourWork')}</span><div class="upload-fields">
            ${this.fileControl('problem', t('addProblem'), t('fileTypes'))}${this.fileControl('work', t('addWork'), t('fileTypes'))}
          </div></div>
          <div class="debate-input-grid">
            <div class="text-entry debate-field"><div class="text-entry-head"><label class="upload-label" for="problem-text" style="margin:0">${t('debateProblemLabel')}</label><span class="file-meta">PROMPT</span></div><textarea id="problem-text" maxlength="12000" placeholder="${t('debateProblemPlaceholder')}">${this.escape(this.auditProblemText)}</textarea></div>
            <div class="text-entry debate-field"><div class="text-entry-head"><label class="upload-label" for="work-text" style="margin:0">${t('debateSolutionLabel')}</label><span class="file-meta">SOLUTION / CODE</span></div><textarea id="work-text" maxlength="16000" placeholder="${t('placeholder')}">${this.escape(this.auditText)}</textarea></div>
          </div>
          <div class="debate-submit-row"><span class="hint">♧ &nbsp;${t('privacy')}</span><button class="primary-button" id="start-audit" ${this.auditResult ? 'hidden' : ''} ${this.isAnalyzing ? 'disabled' : ''}>${this.isAnalyzing ? t('debateAnalyzing') : t('debateAnalyze')} <span class="button-arrow">↗</span></button></div>
          <div id="debate-result-slot" aria-live="polite">${this.debateResultMarkup()}</div>
          <div class="divider"></div><div class="chat-area"><div class="chat-top"><span class="agent-label"><span class="agent-orb">✳</span>${t('agent')}</span><span class="secure-tag">${t('secure')}</span></div><div id="messages">${this.auditMessagesMarkup()}</div>
            <div class="quick-replies"><button class="reply-chip" data-reply="upload">＋ ${t('reply1')}</button><button class="reply-chip" data-reply="how">✳ ${t('reply2')}</button></div>
            <form class="chat-input" id="chat-form"><input id="chat-message" maxlength="1800" placeholder="${t('chatPlaceholder')}" autocomplete="off" ${this.isAnalyzing ? 'disabled' : ''}/><button class="send-button" aria-label="${t('send')}" ${this.isAnalyzing ? 'disabled' : ''}><span aria-hidden="true">↑</span></button></form>
          </div>
        </section>
      </div><div class="right-stack">
        ${this.learningMetricCards(metrics)}
        <section class="card practice-card"><div class="eyebrow"><span class="live-dot"></span>${t('daily')}</div><h3>${t('practiceTitle')}</h3><p>${t('practiceDesc')}</p><div class="practice-bottom"><button class="practice-button" id="practice-button">${t('challenge')} ↗</button><span class="difficulty">${t('difficulty')}</span></div></section>
        ${this.sourceCard()}
        ${this.activityCard()}
      </div></div>
        </div>
      </div>
    </div>`;
  },
  debateResultMarkup() {
    const result = this.auditResult;
    if (!result) return '';
    const statusKey = { correct: 'debateCorrect', incorrect: 'debateIncorrect', insufficient: 'debateInsufficient' }[result.status];
    const categoryKey = { knowledge: 'debateKnowledge', logic: 'debateLogic', method: 'debateMethod' };
    const issues = result.issues?.length ? `<div class="debate-issues"><h4>${this.t('debateIssues')}</h4>${result.issues.map((issue, index) => `<article class="debate-issue"><div class="debate-issue-top"><span>${String(index + 1).padStart(2, '0')}</span><strong>${this.t(categoryKey[issue.category] || 'debateLogic')}</strong></div><p class="debate-step"><b>${this.t('debateStep')}:</b> ${this.escape(issue.step)}</p><p>${this.escape(issue.explanation)}</p><p class="debate-suggestion"><b>${this.t('debateSuggestion')}:</b> ${this.escape(issue.suggestion)}</p></article>`).join('')}</div>` : '';
    const strengths = result.strengths?.length ? `<div class="debate-strengths"><h4>${this.t('debateStrengths')}</h4><ul>${result.strengths.map(item => `<li>${this.escape(item)}</li>`).join('')}</ul></div>` : '';
    const evaluation = this.debateEvaluationMarkup(result.evaluation, result.proofRecord);
    const nextQuestion = result.nextQuestion ? `<p class="debate-next"><b>${this.t('debateNextQuestion')}:</b> ${this.escape(result.nextQuestion)}</p>` : '';
    const session = this.debateSession || { revisionCount: 0, hintLevel: 0, hints: [] };
    const hintHistory = session.hints?.length ? `<div class="debate-hint-history"><h4>${this.t('debateHintHistory')}</h4>${session.hints.map(hint => `<article><span>${this.escape(this.t('debateHintLevel').replace('{level}', String(hint.level)))}</span><p>${this.escape(hint.content)}</p></article>`).join('')}</div>` : '';
    const comparison = result.comparison ? `<section class="debate-comparison"><h4>${this.t('debateComparison')}</h4><p>${this.escape(result.comparison.summary)}</p>${result.comparison.improvements?.length ? `<div><b>${this.t('debateImprovements')}</b><ul>${result.comparison.improvements.map(item => `<li>${this.escape(item)}</li>`).join('')}</ul></div>` : ''}${result.comparison.remainingIssues?.length ? `<div><b>${this.t('debateRemaining')}</b><ul>${result.comparison.remainingIssues.map(item => `<li>${this.escape(item)}</li>`).join('')}</ul></div>` : ''}<details><summary>${this.t('debateCompareSolutions')}</summary><div class="debate-solution-compare"><div><b>${this.t('debateBefore')}</b><pre>${this.escape(String(result.comparison.previousSolution || '').slice(0, 1600))}</pre></div><div><b>${this.t('debateAfter')}</b><pre>${this.escape(String(result.comparison.currentSolution || '').slice(0, 1600))}</pre></div></div></details></section>` : '';
    const nextHint = Math.min(3, Number(session.hintLevel || 0) + 1);
    const hintButton = result.status === 'incorrect' ? `<button class="ghost-button" type="button" data-request-hint ${session.hintLevel >= 3 ? 'disabled' : ''}>${session.hintLevel >= 3 ? this.t('debateHintMax') : this.t('debateRequestHint').replace('{level}', String(nextHint))}</button>` : '';
    const tools = `<footer class="debate-session-tools"><div><span>${this.t('debateHintProgress').replace('{level}', String(session.hintLevel || 0))}</span><span>${this.t('debateRevisionCount').replace('{count}', String(session.revisionCount || 0))}</span></div><div>${hintButton}<button class="primary-button" type="button" data-resubmit>${this.t('debateResubmit')} ↗</button></div></footer>`;
    return `<section class="debate-result ${result.status}" aria-labelledby="debate-result-title"><header><div><span class="debate-status">${this.t(statusKey)}</span><h3 id="debate-result-title">${this.t('debateResultTitle')}</h3></div><span class="debate-confidence">${this.t('debateConfidence')} ${Math.round(Number(result.confidence || 0) * 100)}%</span></header><p class="debate-summary">${this.escape(result.summary)}</p>${evaluation}${issues}${strengths}${comparison}${hintHistory}${nextQuestion}${tools}</section>`;
  },
  debateEvaluationMarkup(evaluation, proofRecord) {
    if (!evaluation) return '';
    const statusKey = { pass: 'debateEvalPass', needs_improvement: 'debateEvalNeeds', insufficient: 'debateEvalInsufficient' }[evaluation.status];
    const criterionKeys = {
      knowledgeAccuracy: 'debateCriterionKnowledge',
      reasoningLogic: 'debateCriterionLogic',
      solutionCompleteness: 'debateCriterionCompleteness',
      errorRemediation: 'debateCriterionRemediation',
    };
    const criteria = Object.entries(criterionKeys).map(([key, label]) => {
      const criterion = evaluation.criteria?.[key];
      if (!criterion) return '';
      return `<article><div><strong>${this.t(label)}</strong><span>${this.escape(criterion.score)} / 25</span></div><p>${this.escape(criterion.evidence)}</p></article>`;
    }).join('');
    const corrected = evaluation.correctedIssues?.length ? `<div class="evaluation-list fixed"><b>${this.t('debateCorrectedIssues')}</b><ul>${evaluation.correctedIssues.map(item => `<li>${this.escape(item)}</li>`).join('')}</ul></div>` : '';
    const remaining = evaluation.remainingIssues?.length ? `<div class="evaluation-list remaining"><b>${this.t('debateEvaluationRemaining')}</b><ul>${evaluation.remainingIssues.map(item => `<li>${this.escape(item)}</li>`).join('')}</ul></div>` : '';
    const score = evaluation.score === null ? '—' : String(evaluation.score);
    return `<section class="debate-evaluation ${evaluation.status}" aria-label="${this.t('debateEvaluationTitle')}"><header><div><span>${this.t('debateEvaluationTitle')}</span><strong>${score}<small>/100</small></strong></div><span class="evaluation-status">${this.t(statusKey)}</span></header><p>${this.escape(evaluation.comment)}</p><div class="evaluation-criteria">${criteria}</div><div class="evaluation-lists">${corrected}${remaining}</div><footer><span>${this.escape(evaluation.rubricVersion || 'paradox-rubric-v1')}</span>${proofRecord ? `<span>✓ ${this.t('debateProofReady')}</span>` : ''}</footer></section>`;
  },
};
