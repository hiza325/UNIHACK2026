/* audit views — extracted from app-views.js. Methods are merged into viewMethods. */
export const auditViews = {
  viewAudit() {
    const t = k => this.t(k);
    const name = this.escape(this.user.name || this.user.email);
    const greeting = t('welcome').replace('Minh Anh', name).replace('ミン・アイン', name);
    const metrics = this.learningMetrics();
    return `<div class="page">
      ${this.viewHead(greeting, 'subtitle')}
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
            <form class="chat-input" id="chat-form"><input id="chat-message" placeholder="${t('chatPlaceholder')}" autocomplete="off" ${this.isAnalyzing ? 'disabled' : ''}/><button class="send-button" aria-label="${t('send')}" ${this.isAnalyzing ? 'disabled' : ''}><span aria-hidden="true">↑</span></button></form>
          </div>
        </section>
      </div><div class="right-stack">
        ${this.learningMetricCards(metrics)}
        <section class="card practice-card"><div class="eyebrow"><span class="live-dot"></span>${t('daily')}</div><h3>${t('practiceTitle')}</h3><p>${t('practiceDesc')}</p><div class="practice-bottom"><button class="practice-button" id="practice-button">${t('challenge')} ↗</button><span class="difficulty">${t('difficulty')}</span></div></section>
        ${this.sourceCard()}
        ${this.activityCard()}
      </div></div>
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
