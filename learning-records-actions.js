import { createLearningRecordsService } from './learning-records-service.js';
import { normalizeAchievementSummary } from './learning-data.js';

export const learningRecordActionMethods = {
  configureLearningRecordsService() {
    const runtime = globalThis.PARADOX_LEARNING_RECORDS_CONFIG || {};
    const enabled = runtime.enabled === true || (runtime.enabled !== false && this.authProvider === 'remote');
    this.learningRecordsService = createLearningRecordsService({ enabled, apiBaseUrl: runtime.apiBaseUrl || '/api' });
    this.remoteLearningSessions = [];
    this.remoteAchievementSummary = null;
    this.learningRecordsLoaded = false;
    this.learningRecordsLoading = false;
    this.learningRecordsLoadAttempted = false;
    this.learningRecordSyncError = '';
    this.learningRecordsRefreshQueued = false;
    this.learningRecordPendingRevision = null;
  },
  async loadPassportEligibleEvaluations() {
    if (!this.learningRecordsService?.enabled || !this.user?.id) { this.passportEligibleEvaluations = []; return; }
    if (this.passportEligibleLoading) return;
    this.passportEligibleLoading = true;
    this.passportEligibleError = '';
    try {
      const evaluations = await this.learningRecordsService.listEligibleEvaluations({ limit: 50 });
      this.passportEligibleEvaluations = Array.isArray(evaluations) ? evaluations : [];
    } catch (error) {
      this.passportEligibleEvaluations = [];
      this.passportEligibleError = error && error.message ? error.message : String(error);
    } finally {
      this.passportEligibleLoading = false;
      if (this.view === 'passport') this.render();
    }
  },
  currentLearningRecordContext() {
    if (!this.learningRecordsService?.enabled || !this.learningRecordSessionId || !this.learningRecordSubmissionId) return null;
    return { sessionId: this.learningRecordSessionId, submissionId: this.learningRecordSubmissionId };
  },
  async prepareLearningRecord(mode, problem, solution, previousAttempt) {
    if (!this.learningRecordsService?.enabled) return null;
    try {
      if (mode === 'analyze') this.learningRecordPendingRevision = null;
      const pending = this.learningRecordPendingRevision;
      if (mode === 'resubmit'
        && pending?.sessionId === this.learningRecordSessionId
        && pending.solution.trim() === solution.trim()) {
        this.learningRecordSubmissionId = pending.submissionId;
        this.saveAuditState();
        return this.currentLearningRecordContext();
      }
      if (mode === 'analyze' || !this.learningRecordSessionId) {
        const initialSolution = mode === 'resubmit' && previousAttempt ? previousAttempt.solution : solution;
        const created = await this.learningRecordsService.createSession({
          title: String(problem).split(/\r?\n/)[0].slice(0, 160),
          subject: this.t(({ math: 'setSubjectMath', algebra: 'setSubjectAlgebra', code: 'setSubjectCode' })[this.settings.subject] || 'setSubjectMath'),
          problem,
          initialSolution,
        });
        this.learningRecordSessionId = created.session.id;
        this.learningRecordSubmissionId = created.submission.id;
        if (mode === 'resubmit') {
          const revision = await this.learningRecordsService.createSubmission(created.session.id, solution);
          this.learningRecordSubmissionId = revision.id;
          this.learningRecordPendingRevision = {
            sessionId: created.session.id,
            submissionId: revision.id,
            solution,
            attemptNumber: revision.attemptNumber,
          };
        }
      } else if (mode === 'resubmit') {
        const revision = await this.learningRecordsService.createSubmission(this.learningRecordSessionId, solution);
        this.learningRecordSubmissionId = revision.id;
        this.learningRecordPendingRevision = {
          sessionId: this.learningRecordSessionId,
          submissionId: revision.id,
          solution,
          attemptNumber: revision.attemptNumber,
        };
      }
      this.saveAuditState();
      return this.currentLearningRecordContext();
    } catch (error) {
      if (mode === 'resubmit' && this.learningRecordSessionId) {
        try {
          const detail = await this.learningRecordsService.getSession(this.learningRecordSessionId);
          const latest = Array.isArray(detail?.submissions) ? detail.submissions.at(-1) : null;
          const recoverable = latest?.type === 'revision'
            && String(latest.solution || '').trim() === solution.trim()
            && (['pending_analysis', 'analysis_failed'].includes(latest.analysisState)
              || (detail.status !== 'completed'
                && latest.analysis?.status === 'correct'
                && latest.analysis?.evaluation?.status === 'pass'));
          if (recoverable) {
            this.learningRecordSubmissionId = latest.id;
            this.learningRecordPendingRevision = {
              sessionId: detail.id,
              submissionId: latest.id,
              solution,
              attemptNumber: latest.attemptNumber,
            };
            this.saveAuditState();
            return this.currentLearningRecordContext();
          }
        } catch {
          // Preserve the original submission creation error below.
        }
      }
      this.learningRecordSyncError = error.code || 'LEARNING_RECORD_SYNC_FAILED';
      throw error;
    }
  },
  async loadLearningRecordHistory({ force = false } = {}) {
    if (!this.learningRecordsService?.enabled || (this.learningRecordsLoaded && !force)) return;
    if (this.learningRecordsLoading) {
      if (force) this.learningRecordsRefreshQueued = true;
      return;
    }
    this.learningRecordsLoading = true;
    this.learningRecordsLoadAttempted = true;
    this.learningRecordSyncError = '';
    if (['dashboard', 'history', 'analytics', 'profile'].includes(this.view)) this.render();
    try {
      const overview = await this.learningRecordsService.getOverview({ limit: 100 });
      const sessions = overview?.sessions;
      const achievementSummary = normalizeAchievementSummary(overview?.achievementSummary);
      if (!Array.isArray(sessions)) throw Object.assign(new Error('Invalid learning record response'), { code: 'LEARNING_RECORD_INVALID_RESPONSE' });
      if (!achievementSummary) throw Object.assign(new Error('Invalid achievement summary response'), { code: 'LEARNING_RECORD_INVALID_RESPONSE' });
      this.remoteLearningSessions = sessions.map(session => {
        const date = new Date(session.startedAt);
        const isoDate = Number.isNaN(date.getTime()) ? '' : this.localDateKey(date);
        const status = session.status === 'completed'
          ? 'completed'
          : session.status === 'abandoned'
            ? 'abandoned'
            : session.status === 'analysis_unavailable'
              ? 'error'
              : 'progress';
        return {
          id: session.id,
          date: Number.isNaN(date.getTime()) ? '' : this.formatDisplayDate(date, { day: '2-digit', month: '2-digit', year: 'numeric' }),
          isoDate,
          title: session.title,
          skill: session.subject,
          status,
          recordStatus: session.status,
          score: Number.isFinite(session.latestScore) ? session.latestScore : null,
          analysisStatus: session.latestAnalysisStatus || null,
          evaluationStatus: session.latestEvaluationStatus || null,
          startedAt: session.startedAt,
          completedAt: session.completedAt || null,
          updatedAt: session.updatedAt || null,
          minutes: Math.max(0, Math.round(Number(session.durationSeconds || 0) / 60)),
          source: 'backend',
          isReal: true,
        };
      });
      this.remoteAchievementSummary = achievementSummary;
      this.learningRecordsLoaded = true;
      this.learningRecordSyncError = '';
    } catch (error) {
      this.learningRecordSyncError = error.code || 'LEARNING_RECORD_SYNC_FAILED';
    } finally {
      this.learningRecordsLoading = false;
      if (['dashboard', 'history', 'analytics', 'profile'].includes(this.view)) this.render();
      if (this.learningRecordsRefreshQueued) {
        this.learningRecordsRefreshQueued = false;
        this.loadLearningRecordHistory({ force: true });
      }
    }
  },
  async resumeLearningSession(sessionId) {
    const session = this.getSessions().find(item => item.id === sessionId);
    if (!session || !['in_progress', 'analysis_unavailable'].includes(session.recordStatus || (session.status === 'progress' ? 'in_progress' : ''))) {
      this.showToast(this.t('dashResumeUnavailable'));
      return;
    }
    try {
      if (this.learningRecordsService?.enabled) {
        const detail = await this.learningRecordsService.getSession(sessionId);
        if (!detail || !Array.isArray(detail.submissions)) throw new Error('Invalid learning session response');
        const latest = detail.submissions.at(-1);
        const latestNeedsRetry = latest?.type === 'revision' && (
          ['pending_analysis', 'analysis_failed'].includes(latest.analysisState)
          || (detail.status !== 'completed'
            && latest.analysis?.status === 'correct'
            && latest.analysis?.evaluation?.status === 'pass')
        );
        this.learningRecordSessionId = detail.id;
        this.learningRecordSubmissionId = latest?.id || '';
        this.learningRecordPendingRevision = latestNeedsRetry ? {
          sessionId: detail.id,
          submissionId: latest.id,
          solution: String(latest.solution || ''),
          attemptNumber: latest.attemptNumber,
        } : null;
        this.auditProblemText = String(detail.problem || '');
        this.auditText = String(latest?.solution || '');
        const analyzed = [...detail.submissions].reverse().find(item => item.analysis)?.analysis || null;
        this.auditResult = analyzed;
        this.debateSession = {
          revisionCount: Math.max(0, detail.submissions.length - 1),
          hintLevel: Math.max(0, ...((detail.interactions || []).filter(item => item.mode === 'hint').map(item => Number(item.hintLevel) || 0))),
          hints: (detail.interactions || []).filter(item => item.mode === 'hint' && item.role === 'assistant').slice(-3).map(item => ({ level: item.hintLevel, content: item.content })),
          attempts: detail.submissions.filter(item => item.analysis && item.id !== this.learningRecordPendingRevision?.submissionId).slice(-10).map(item => ({ solution: item.solution, analysis: item.analysis, at: item.analysisCompletedAt || item.submittedAt })),
          conversation: (detail.interactions || []).filter(item => item.mode === 'discussion').slice(-40).map(item => ({ role: item.role, text: item.content })),
        };
        this.auditMessages = [];
        this.step = 0;
      } else {
        this.activeLocalSessionId = session.id;
        if (typeof session.problemText === 'string') this.auditProblemText = session.problemText;
        if (typeof session.solutionText === 'string') this.auditText = session.solutionText;
        if (!this.auditProblemText && !this.auditText) throw new Error('Local session detail is unavailable');
      }
      this.saveAuditState();
      this.navigate('audit');
    } catch {
      this.showToast(this.t('dashResumeError'));
    }
  },
};
