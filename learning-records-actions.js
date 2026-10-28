import { createLearningRecordsService } from './learning-records-service.js';

export const learningRecordActionMethods = {
  configureLearningRecordsService() {
    const runtime = globalThis.PARADOX_LEARNING_RECORDS_CONFIG || {};
    const enabled = runtime.enabled === true || (runtime.enabled !== false && this.authProvider === 'remote');
    this.learningRecordsService = createLearningRecordsService({ enabled, apiBaseUrl: runtime.apiBaseUrl || '/api' });
    this.remoteLearningSessions = [];
    this.learningRecordsLoaded = false;
    this.learningRecordsLoading = false;
  },
  currentLearningRecordContext() {
    if (!this.learningRecordsService?.enabled || !this.learningRecordSessionId || !this.learningRecordSubmissionId) return null;
    return { sessionId: this.learningRecordSessionId, submissionId: this.learningRecordSubmissionId };
  },
  async prepareLearningRecord(mode, problem, solution, previousAttempt) {
    if (!this.learningRecordsService?.enabled) return null;
    try {
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
        }
      } else if (mode === 'resubmit') {
        const revision = await this.learningRecordsService.createSubmission(this.learningRecordSessionId, solution);
        this.learningRecordSubmissionId = revision.id;
      }
      this.saveAuditState();
      return this.currentLearningRecordContext();
    } catch (error) {
      this.learningRecordSyncError = error.code || 'LEARNING_RECORD_SYNC_FAILED';
      throw error;
    }
  },
  async loadLearningRecordHistory({ force = false } = {}) {
    if (!this.learningRecordsService?.enabled || this.learningRecordsLoading || (this.learningRecordsLoaded && !force)) return;
    this.learningRecordsLoading = true;
    try {
      const sessions = await this.learningRecordsService.listSessions({ limit: 100 });
      this.remoteLearningSessions = sessions.map(session => {
        const date = new Date(session.startedAt);
        const isoDate = Number.isNaN(date.getTime()) ? '' : this.localDateKey(date);
        const mastered = session.latestEvaluationStatus === 'pass' || (session.status === 'completed' && session.latestAnalysisStatus === 'correct');
        const needs = session.status === 'analysis_unavailable' || session.latestAnalysisStatus === 'incorrect' || session.latestEvaluationStatus === 'needs_improvement';
        return {
          id: session.id,
          date: Number.isNaN(date.getTime()) ? '' : `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
          isoDate,
          title: session.title,
          skill: session.subject,
          status: mastered ? 'mastered' : needs ? 'needs' : 'progress',
          score: Number.isFinite(session.latestScore) ? session.latestScore : mastered ? 85 : 50,
          selfDetected: false,
          startedAt: session.startedAt,
          minutes: Math.max(0, Math.round(Number(session.durationSeconds || 0) / 60)),
          source: 'supabase',
        };
      });
      this.learningRecordsLoaded = true;
      this.learningRecordSyncError = '';
      if (['dashboard', 'history', 'analytics', 'profile'].includes(this.view)) this.render();
    } catch (error) {
      this.learningRecordSyncError = error.code || 'LEARNING_RECORD_SYNC_FAILED';
    } finally {
      this.learningRecordsLoading = false;
    }
  },
};
