function learningSessionDefault() {
  return { revisionCount: 0, hintLevel: 0, hints: [], attempts: [], conversation: [], questions: [] };
}

export const learningSessionActionMethods = {
  learningSessionStorageKey() {
    return this.userStorageKey('active-learning-session');
  },
  learningSessionById(id) {
    return (this.learningSessionList || []).find(session => session.id === id) || null;
  },
  touchLearningSessionActivity(sessionId = this.learningRecordSessionId) {
    if (!sessionId) return;
    const at = new Date().toISOString();
    this.learningSessionList = (this.learningSessionList || []).map(session => session.id === sessionId
      ? { ...session, lastActivityAt: at }
      : session);
  },
  async loadLearningSessions({ force = false, search = this.learningSessionSearch, restore = true, append = false } = {}) {
    if (!this.learningRecordsService?.enabled || !this.user?.id) {
      this.learningSessionList = [];
      this.learningSessionHasMore = false;
      this.learningSessionListError = '';
      return;
    }
    if (this.learningSessionListLoading && !force) return;
    this.learningSessionListLoading = true;
    this.learningSessionListError = '';
    if (this.view === 'audit') this.render();
    try {
      const sessions = await this.learningRecordsService.listSessions({ limit: 50, offset: append ? this.learningSessionList.length : 0, search });
      if (!Array.isArray(sessions)) throw new Error('Invalid learning session list');
      const mapped = sessions.map(session => ({
        id: session.id,
        title: session.title,
        subject: session.subject,
        status: session.status,
        startedAt: session.startedAt,
        completedAt: session.completedAt || null,
        updatedAt: session.updatedAt || null,
        lastActivityAt: session.lastActivityAt || session.updatedAt || session.startedAt,
        latestScore: Number.isFinite(session.latestScore) ? session.latestScore : null,
      }));
      const unique = mapped.filter(session => !append || !this.learningSessionList.some(item => item.id === session.id));
      this.learningSessionList = append ? [...this.learningSessionList, ...unique] : mapped;
      this.learningSessionHasMore = sessions.length === 50;
      if (this.learningSessionSelectedId && !this.learningSessionList.some(session => session.id === this.learningSessionSelectedId)) {
        this.learningSessionSelectedId = '';
      }
      if (restore && this.auditStorageReady && !this.learningSessionInitialized) {
        const savedId = localStorage.getItem(this.learningSessionStorageKey());
        if (savedId && this.learningSessionList.some(session => session.id === savedId)) {
          await this.openLearningSession(savedId, { silent: true });
        } else if (!this.learningRecordSessionId && !this.auditProblemText && !this.auditText) {
          this.resetLearningSessionState();
        }
        this.learningSessionInitialized = true;
      }
    } catch (error) {
      this.learningSessionListError = error?.code || 'LEARNING_SESSION_LIST_FAILED';
    } finally {
      this.learningSessionListLoading = false;
      if (this.view === 'audit') this.render();
    }
  },
  resetLearningSessionState() {
    this.learningRecordSessionId = '';
    this.learningRecordSubmissionId = '';
    this.learningRecordPendingRevision = null;
    this.auditProblemText = '';
    this.auditText = '';
    this.auditResult = null;
    this.debateSession = learningSessionDefault();
    this.auditMessages = [];
    this.step = 0;
    this.learningSessionSelectedId = '';
    this.learningSessionMenuId = '';
    this.learningSessionRenamingId = '';
    this.learningSessionDeleteId = '';
    this.learningSessionLoadingId = '';
  },
  newLearningSession({ silent = false } = {}) {
    if (this.isAnalyzing) return;
    this.resetLearningSessionState();
    localStorage.removeItem(this.learningSessionStorageKey());
    this.saveAuditState();
    if (!silent && this.view === 'audit') {
      this.render();
      requestAnimationFrame(() => this.querySelector('#problem-text')?.focus());
    }
  },
  learningSessionMessages(detail) {
    const interactions = Array.isArray(detail?.interactions) ? detail.interactions : [];
    return interactions
      .filter(item => item.mode !== 'analysis')
      .map(item => {
        const content = String(item.content || '');
        const hint = item.mode === 'hint' && item.role === 'assistant'
          ? `<span class="hint-level-tag">${this.escape(this.t('debateHintLevel').replace('{level}', String(item.hintLevel || '')))}</span>`
          : '';
        return {
          html: `${hint}${this.escape(content)}`,
          user: item.role === 'user',
          at: item.createdAt || new Date().toISOString(),
        };
      })
      .filter(item => item.html);
  },
  applyLearningSessionDetail(detail) {
    if (!detail || !detail.id) throw new Error('Invalid learning session response');
    const submissions = Array.isArray(detail.submissions) ? detail.submissions : [];
    const interactions = Array.isArray(detail.interactions) ? detail.interactions : [];
    const latest = submissions.at(-1);
    this.learningRecordSessionId = detail.id;
    this.learningRecordSubmissionId = latest?.id || '';
    const latestNeedsRetry = latest?.type === 'revision' && (
      ['pending_analysis', 'analysis_failed'].includes(latest.analysisState)
      || (detail.status !== 'completed'
        && latest.analysis?.status === 'correct'
        && latest.analysis?.evaluation?.status === 'pass')
    );
    this.learningRecordPendingRevision = latestNeedsRetry ? {
      sessionId: detail.id,
      submissionId: latest.id,
      solution: String(latest.solution || ''),
      attemptNumber: latest.attemptNumber,
    } : null;
    this.auditProblemText = String(detail.problem || '');
    this.auditText = String(latest?.solution || '');
    const analyzed = [...submissions].reverse().find(item => item.analysis)?.analysis || null;
    this.auditResult = analyzed;
    this.debateSession = {
      revisionCount: Math.max(0, submissions.length - 1),
      hintLevel: Math.max(0, ...interactions.filter(item => item.mode === 'hint').map(item => Number(item.hintLevel) || 0)),
      hints: interactions.filter(item => item.mode === 'hint' && item.role === 'assistant').slice(-3).map(item => ({ level: item.hintLevel, content: item.content })),
      attempts: submissions.filter(item => item.analysis).slice(-10).map(item => ({ solution: item.solution, analysis: item.analysis, at: item.analysisCompletedAt || item.submittedAt })),
      conversation: interactions.filter(item => item.mode === 'discussion').slice(-40).map(item => ({ role: item.role, text: item.content })),
      questions: [],
    };
    this.auditMessages = this.learningSessionMessages(detail);
    this.step = analyzed?.status === 'correct' ? 5 : analyzed?.status === 'incorrect' ? 2 : analyzed?.status === 'insufficient' ? 1 : 0;
    this.learningSessionSelectedId = detail.id;
    this.learningSessionMenuId = '';
    this.learningSessionRenamingId = '';
    this.learningSessionDeleteId = '';
    localStorage.setItem(this.learningSessionStorageKey(), detail.id);
  },
  async openLearningSession(sessionId, { silent = false } = {}) {
    if (!sessionId || this.isAnalyzing || this.learningSessionLoadingId === sessionId) return;
    if (!this.learningRecordsService?.enabled) {
      if (!silent) this.showToast(this.t('sessionUnavailable'));
      return;
    }
    this.learningSessionLoadingId = sessionId;
    this.learningSessionMenuId = '';
    if (this.view === 'audit') this.render();
    try {
      const detail = await this.learningRecordsService.getSession(sessionId);
      this.applyLearningSessionDetail(detail);
      this.learningSessionDrawerOpen = false;
      this.saveAuditState();
      if (!silent) this.render();
      requestAnimationFrame(() => {
        const messages = this.querySelector('#messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
      });
    } catch {
      if (!silent) this.showToast(this.t('sessionLoadError'));
    } finally {
      this.learningSessionLoadingId = '';
      if (this.view === 'audit') this.render();
    }
  },
  async saveLearningSessionRename(sessionId, value) {
    const title = String(value || '').trim();
    if (!title || title.length > 160) {
      this.showToast(this.t('sessionTitleInvalid'));
      return;
    }
    try {
      const updated = await this.learningRecordsService.renameSession(sessionId, title);
      this.learningSessionList = this.learningSessionList.map(session => session.id === sessionId
        ? { ...session, title: updated.title, updatedAt: updated.updatedAt || session.updatedAt, lastActivityAt: updated.lastActivityAt || session.lastActivityAt }
        : session);
      this.learningSessionRenamingId = '';
      this.learningSessionRenameDraft = '';
      this.learningSessionMenuId = '';
      this.render();
      this.showToast(this.t('sessionRenamed'));
    } catch {
      this.showToast(this.t('sessionRenameError'));
    }
  },
  cancelLearningSessionRename() {
    this.learningSessionRenamingId = '';
    this.learningSessionRenameDraft = '';
    this.render();
  },
  beginLearningSessionRename(sessionId) {
    const session = this.learningSessionById(sessionId);
    if (!session) return;
    this.learningSessionRenamingId = sessionId;
    this.learningSessionRenameDraft = session.title;
    this.learningSessionMenuId = '';
    this.learningSessionDeleteId = '';
    this.render();
    requestAnimationFrame(() => this.querySelector('[data-session-rename-input]')?.focus());
  },
  confirmLearningSessionDelete(sessionId) {
    this.learningSessionDeleteId = sessionId;
    this.learningSessionMenuId = '';
    this.learningSessionRenamingId = '';
    this.render();
  },
  cancelLearningSessionDelete() {
    this.learningSessionDeleteId = '';
    this.render();
  },
  async archiveLearningSession(sessionId) {
    if (!sessionId || this.isAnalyzing) return;
    try {
      await this.learningRecordsService.archiveSession(sessionId);
      this.learningSessionList = this.learningSessionList.filter(session => session.id !== sessionId);
      this.learningSessionDeleteId = '';
      if (this.learningSessionSelectedId === sessionId) this.newLearningSession({ silent: true });
      this.render();
      this.showToast(this.t('sessionArchived'));
    } catch {
      this.showToast(this.t('sessionDeleteError'));
    }
  },
  loadMoreLearningSessions() {
    if (this.learningSessionListLoading || !this.learningSessionHasMore) return;
    this.loadLearningSessions({ force: true, restore: false, append: true });
  },
  scheduleLearningSessionSearch(value) {
    this.learningSessionSearch = String(value || '');
    if (this.learningSessionSearchTimer) window.clearTimeout(this.learningSessionSearchTimer);
    this.learningSessionSearchTimer = window.setTimeout(() => {
      this.learningSessionSearchTimer = null;
      this.loadLearningSessions({ force: true, search: this.learningSessionSearch, restore: false });
    }, 250);
  },
  toggleLearningSessionDrawer(open) {
    this.learningSessionDrawerOpen = typeof open === 'boolean' ? open : !this.learningSessionDrawerOpen;
    const panel = this.querySelector('#learning-session-panel');
    const backdrop = this.querySelector('[data-session-backdrop]');
    if (panel) panel.classList.toggle('open', this.learningSessionDrawerOpen);
    if (backdrop) backdrop.hidden = !this.learningSessionDrawerOpen;
    this.querySelector('[data-session-drawer]')?.setAttribute('aria-expanded', String(this.learningSessionDrawerOpen));
  },
};
