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
          <div class="text-entry"><div class="text-entry-head"><label class="upload-label" for="work-text" style="margin:0">${t('pasteLabel')}</label><span class="file-meta">TEXT / CODE</span></div><textarea id="work-text" placeholder="${t('placeholder')}">${this.escape(this.auditText)}</textarea><div class="text-actions"><span class="hint">♧ &nbsp;${t('privacy')}</span><button class="primary-button" id="start-audit" ${this.isAnalyzing ? 'disabled' : ''}>${t('start')} <span class="button-arrow">↗</span></button></div></div>
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
};
