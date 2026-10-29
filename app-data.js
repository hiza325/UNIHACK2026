import { ADMIN_EMAILS } from './app-config.js';
import { DISPLAY_TIME_ZONE, deriveAchievements, learningRecordDataState, passportDataState, summarizeLearningData } from './learning-data.js';

const ACCOUNT_KEY = 'paradox-accounts';

export const dataMethods = {
  readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } },
  normalizeEmail(value) { return String(value || '').trim().toLowerCase(); },
  getAccounts() {
    const accounts = this.readJSON(ACCOUNT_KEY, []);
    return Array.isArray(accounts) ? accounts.filter(account => account && account.email) : [];
  },
  saveAccounts(accounts) { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(accounts)); },
  async hashPassword(password, salt) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(atob(salt), char => char.charCodeAt(0)), iterations: 120000 }, material, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits)));
  },
  createSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...bytes));
  },
  publicAccount(account) {
    const email = this.normalizeEmail(account.email);
    return { id: account.id, name: account.name, email, role: ADMIN_EMAILS.includes(email) ? 'admin' : (account.role || 'user'), status: account.status || 'active', createdAt: account.createdAt, verifiedAt: account.verifiedAt, lastLoginAt: account.lastLoginAt || null };
  },
  async registerAccount({ name, email, password }) {
    const normalizedEmail = this.normalizeEmail(email);
    const accounts = this.getAccounts();
    if (accounts.some(account => this.normalizeEmail(account.email) === normalizedEmail)) throw new Error(this.t('authAccountExists'));
    const salt = this.createSalt();
    const now = new Date().toISOString();
    const account = {
      id: crypto.randomUUID?.() || `account-${Date.now()}`,
      name: String(name || normalizedEmail.split('@')[0]).trim(),
      email: normalizedEmail,
      passwordHash: await this.hashPassword(password, salt),
      salt,
      role: ADMIN_EMAILS.includes(normalizedEmail) ? 'admin' : 'user',
      status: 'active',
      createdAt: now,
      verifiedAt: now,
      lastLoginAt: now,
    };
    accounts.push(account);
    this.saveAccounts(accounts);
    return this.publicAccount(account);
  },
  async loginAccount(email, password) {
    const normalizedEmail = this.normalizeEmail(email);
    const accounts = this.getAccounts();
    const account = accounts.find(item => this.normalizeEmail(item.email) === normalizedEmail);
    if (!account || !account.salt || !account.passwordHash) throw new Error(this.t('authInvalidCredentials'));
    const passwordHash = await this.hashPassword(password, account.salt);
    if (passwordHash !== account.passwordHash) throw new Error(this.t('authInvalidCredentials'));
    if (account.status === 'suspended') throw new Error(this.t('authAccountSuspended'));
    account.lastLoginAt = new Date().toISOString();
    this.saveAccounts(accounts);
    return this.publicAccount(account);
  },
  setAccountStatus(accountId, status) {
    if (!['active', 'suspended'].includes(status)) return;
    const accounts = this.getAccounts();
    const account = accounts.find(item => item.id === accountId);
    if (!account || account.email === this.user?.email) return;
    account.status = status;
    this.saveAccounts(accounts);
  },
  userStorageKey(name, email = this.user?.email) {
    const owner = encodeURIComponent(String(email || 'guest').trim().toLowerCase());
    return `paradox-user:${owner}:${name}`;
  },
  initializeUserData(email) {
    ['audit-sessions', 'practice', 'practice-activity'].forEach(name => {
      const key = this.userStorageKey(name, email);
      if (localStorage.getItem(key) === null) localStorage.setItem(key, '[]');
    });
  },
  resetInMemoryUserData() {
    Object.values(this.filePreviewUrls || {}).forEach(url => URL.revokeObjectURL(url));
    this.step = 0;
    this.files = { problem: [], work: [] };
    this.filePreviewUrls = {};
    this.auditMessages = [];
    this.auditProblemText = '';
    this.auditText = '';
    this.auditResult = null;
    this.debateSession = { revisionCount: 0, hintLevel: 0, hints: [], attempts: [], conversation: [] };
    this.practiceSolved = [];
    this.practiceActivity = [];
    this.passportSelectedCredentialCode = '';
    this.passportVerificationQuery = '';
    this.passportVerificationResult = null;
    this.passportVerificationSearched = false;
    this.passportVerificationState = 'idle';
    this.passportVerificationErrorCode = '';
    this.passportSnapshot = null;
    this.passportLoading = false;
    this.passportLoadAttempted = false;
    this.passportError = '';
    this.learningRecordSessionId = '';
    this.learningRecordSubmissionId = '';
    this.activeLocalSessionId = '';
    this.remoteLearningSessions = [];
    this.remoteAchievementSummary = null;
    this.learningRecordsLoaded = false;
    this.learningRecordsLoading = false;
    this.learningRecordsLoadAttempted = false;
    this.learningRecordSyncError = '';
    this.learningRecordsRefreshQueued = false;
  },
  async loadUserData() {
    this.resetInMemoryUserData();
    this.practiceSolved = this.readJSON(this.userStorageKey('practice'), []);
    this.practiceActivity = this.readJSON(this.userStorageKey('practice-activity'), []);
    await this.loadAuditState();
  },
  openAuditDB() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = indexedDB.open('paradox-learning', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  },
  async loadAuditState() {
    this.auditDB = await this.openAuditDB();
    if (!this.auditDB) return;
    const state = await new Promise(resolve => {
      const request = this.auditDB.transaction('state', 'readonly').objectStore('state').get(this.userStorageKey('audit-state'));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    if (!state) return;
    this.step = Number.isInteger(state.step) ? Math.max(0, Math.min(6, state.step)) : 0;
    this.auditMessages = Array.isArray(state.messages) ? state.messages.slice(-60) : [];
    this.auditProblemText = typeof state.problemText === 'string' ? state.problemText : '';
    this.auditText = typeof state.text === 'string' ? state.text : '';
    this.auditResult = state.result && typeof state.result === 'object' ? state.result : null;
    const savedSession = state.debateSession && typeof state.debateSession === 'object' ? state.debateSession : {};
    this.debateSession = {
      revisionCount: Math.max(0, Number(savedSession.revisionCount) || 0),
      hintLevel: Math.max(0, Math.min(3, Number(savedSession.hintLevel) || 0)),
      hints: Array.isArray(savedSession.hints) ? savedSession.hints.slice(0, 3) : [],
      attempts: Array.isArray(savedSession.attempts) ? savedSession.attempts.slice(-10) : [],
      conversation: Array.isArray(savedSession.conversation) ? savedSession.conversation.slice(-40) : [],
    };
    this.learningRecordSessionId = typeof state.learningRecordSessionId === 'string' ? state.learningRecordSessionId : '';
    this.learningRecordSubmissionId = typeof state.learningRecordSubmissionId === 'string' ? state.learningRecordSubmissionId : '';
    this.activeLocalSessionId = typeof state.activeLocalSessionId === 'string' ? state.activeLocalSessionId : '';
    if (this.auditResult && this.auditText && !this.debateSession.attempts.length) {
      this.debateSession.attempts.push({ solution: this.auditText, analysis: this.auditResult, at: new Date().toISOString() });
    }
    this.files = {
      problem: state.files?.problem ? [state.files.problem] : [],
      work: state.files?.work ? [state.files.work] : []
    };
  },
  saveAuditState() {
    if (!this.auditDB) return;
    const state = {
      step: this.step,
      problemText: this.auditProblemText,
      text: this.auditText,
      result: this.auditResult,
      debateSession: this.debateSession,
      messages: this.auditMessages.slice(-60),
      learningRecordSessionId: this.learningRecordSessionId,
      learningRecordSubmissionId: this.learningRecordSubmissionId,
      activeLocalSessionId: this.activeLocalSessionId,
      files: { problem: this.files.problem[0] || null, work: this.files.work[0] || null }
    };
    try { this.auditDB.transaction('state', 'readwrite').objectStore('state').put(state, this.userStorageKey('audit-state')); } catch { /* IndexedDB may be unavailable in private mode. */ }
  },
  getSessions() {
    if (this.learningRecordsService?.enabled) return this.remoteLearningSessions;
    const saved = this.readJSON(this.userStorageKey('audit-sessions'), []);
    const seen = new Set();
    return saved.filter(item => {
      const key = item.id || `${item.date}|${item.title}|${item.skill}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  learningDataState() {
    return learningRecordDataState({
      enabled: Boolean(this.learningRecordsService?.enabled),
      loading: this.learningRecordsLoading,
      attempted: this.learningRecordsLoadAttempted,
      loaded: this.learningRecordsLoaded,
      error: this.learningRecordSyncError,
      sessions: this.getSessions(),
    });
  },
  learningPassportDataState() {
    return passportDataState({
      mode: this.learningPassportService?.mode || 'mock',
      loading: this.passportLoading,
      attempted: this.passportLoadAttempted,
      error: this.passportError,
      snapshot: this.passportSnapshot,
    });
  },
  displayTimeZone() { return DISPLAY_TIME_ZONE; },
  localDateKey(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: DISPLAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  },
  formatDisplayDate(value, options = {}) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const locale = this.lang === 'jp' ? 'ja-JP' : this.lang === 'en' ? 'en-GB' : 'vi-VN';
    return new Intl.DateTimeFormat(locale, { timeZone: DISPLAY_TIME_ZONE, ...options }).format(date);
  },
  currentDateLabel() {
    return this.formatDisplayDate(new Date(), { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  },
  sessionDisplayDate(session) {
    if (session?.startedAt) return this.formatDisplayDate(session.startedAt, { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (session?.isoDate) return this.formatDisplayDate(`${session.isoDate}T12:00:00Z`, { day: '2-digit', month: '2-digit', year: 'numeric' });
    return String(session?.date || '—');
  },
  sessionISODate(session) {
    if (session.isoDate) return session.isoDate;
    if (session.startedAt) {
      const date = new Date(session.startedAt);
      if (!Number.isNaN(date.getTime())) return this.localDateKey(date);
    }
    const [day, month] = String(session.date || '').split('/').map(Number);
    if (!day || !month) return '';
    return `${this.localDateKey().slice(0, 4)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },
  learningMetrics() {
    const demoMode = !this.learningRecordsService?.enabled;
    return summarizeLearningData(this.getSessions(), {
      practiceActivity: this.practiceActivity,
      includePractice: demoMode,
      todayKey: this.localDateKey(),
      sessionDateKey: session => this.sessionISODate(session),
    });
  },
  learningAchievements() {
    if (this.learningRecordsService?.enabled) return this.remoteAchievementSummary?.achievements || [];
    return deriveAchievements(this.learningMetrics());
  },
  activitySeries(period) {
    const slots = period === 7 ? 7 : 12;
    const values = Array(slots).fill(0);
    const now = Date.parse(`${this.localDateKey()}T00:00:00Z`);
    const activities = [
      ...this.getSessions().map(item => ({ isoDate: this.sessionISODate(item), minutes: Number.isFinite(item.minutes) ? item.minutes : 0 })),
      ...(!this.learningRecordsService?.enabled ? this.practiceActivity : [])
    ];
    activities.forEach(item => {
      const date = Date.parse(`${item.isoDate}T00:00:00Z`);
      if (!Number.isFinite(date)) return;
      const daysAgo = Math.floor((now - date) / 86400000);
      if (daysAgo < 0 || daysAgo >= period) return;
      const chronologicalDay = period - 1 - daysAgo;
      const index = Math.min(slots - 1, Math.floor(chronologicalDay / (period / slots)));
      values[index] += Number.isFinite(item.minutes) ? item.minutes : 0;
    });
    const max = Math.max(...values, 1);
    const locale = this.lang === 'jp' ? 'ja-JP' : this.lang === 'en' ? 'en-GB' : 'vi-VN';
    const labels = values.map((_, index) => {
      const chronologicalDay = Math.floor(index * (period / slots));
      const date = new Date(now - (period - 1 - chronologicalDay) * 86_400_000);
      return new Intl.DateTimeFormat(locale, period === 7
        ? { timeZone: 'UTC', weekday: 'short' }
        : { timeZone: 'UTC', day: '2-digit', month: '2-digit' }).format(date);
    });
    return { values, labels, heights: values.map(value => value ? Math.max(12, Math.round(value / max * 100)) : 4) };
  },
  recordAuditSession(text) {
    const subjectKeys = { math: 'setSubjectMath', algebra: 'setSubjectAlgebra', code: 'setSubjectCode' };
    const source = this.files.problem[0]?.name || String(text || '').split(/\r?\n/)[0].slice(0, 54) || this.t('sessionTitle');
    const now = new Date();
    const sessions = this.readJSON(this.userStorageKey('audit-sessions'), []);
    const id = `audit-${now.getTime()}`;
    sessions.unshift({
      id,
      date: `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`,
      isoDate: this.localDateKey(now),
      title: source,
      skill: this.t(subjectKeys[this.settings.subject] || 'setSubjectMath'),
      status: 'progress',
      recordStatus: 'in_progress',
      score: null,
      selfDetected: null,
      problemText: this.auditProblemText,
      solutionText: this.auditText,
      startedAt: now.toISOString(),
      minutes: 0
    });
    this.activeLocalSessionId = id;
    localStorage.setItem(this.userStorageKey('audit-sessions'), JSON.stringify(sessions.slice(0, 100)));
  },
  updateAuditProgress(step) {
    const sessions = this.readJSON(this.userStorageKey('audit-sessions'), []);
    if (!sessions.length) return;
    const session = sessions.find(item => item.id === this.activeLocalSessionId) || sessions[0];
    const startedAt = new Date(session.startedAt || Date.now()).getTime();
    session.minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
    session.lastStep = Number.isInteger(step) ? Math.max(0, Math.min(6, step)) : null;
    localStorage.setItem(this.userStorageKey('audit-sessions'), JSON.stringify(sessions));
  },
  updateLocalSessionFromAnalysis(result) {
    if (this.learningRecordsService?.enabled) return;
    const sessions = this.readJSON(this.userStorageKey('audit-sessions'), []);
    const session = sessions.find(item => item.id === this.activeLocalSessionId) || sessions[0];
    if (!session) return;
    const completed = result?.status === 'correct';
    session.analysisStatus = result?.status || null;
    session.problemText = this.auditProblemText;
    session.solutionText = this.auditText;
    session.status = completed ? 'completed' : 'progress';
    session.recordStatus = completed ? 'completed' : 'in_progress';
    session.score = Number.isFinite(result?.evaluation?.score) ? result.evaluation.score : null;
    session.completedAt = completed ? new Date().toISOString() : null;
    const startedAt = new Date(session.startedAt || Date.now()).getTime();
    session.minutes = Math.max(0, Math.round((Date.now() - startedAt) / 60000));
    localStorage.setItem(this.userStorageKey('audit-sessions'), JSON.stringify(sessions));
  },
  markCurrentSessionSelfDetected() {
    const key = this.userStorageKey('audit-sessions');
    const sessions = this.readJSON(key, []);
    if (!sessions.length) return;
    const session = sessions.find(item => item.id === this.activeLocalSessionId) || sessions[0];
    session.selfDetected = true;
    localStorage.setItem(key, JSON.stringify(sessions));
  },
  filterHistory() {
    const active = this.querySelector('[data-history-filter].active')?.dataset.historyFilter || 'all';
    const query = (this.querySelector('#history-search')?.value || '').trim().toLowerCase();
    const subject = this.querySelector('#history-subject')?.value || 'all';
    const dateRange = this.querySelector('#history-date')?.value || 'all';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const rows = [...this.querySelectorAll('[data-session-status]')];
    const matches = rows.filter(row => {
      const statusOk = active === 'all' || row.dataset.sessionStatus === active;
      const queryOk = !query || (row.dataset.search || row.textContent.toLowerCase()).includes(query);
      const subjectOk = subject === 'all' || row.dataset.sessionSubject === subject;
      const sessionDate = new Date(`${row.dataset.sessionDate}T00:00:00`);
      const daysAgo = Math.floor((now - sessionDate) / 86400000);
      const dateOk = dateRange === 'all' || (!Number.isNaN(daysAgo) && daysAgo >= 0 && daysAgo < Number(dateRange));
      return statusOk && queryOk && subjectOk && dateOk;
    });
    const pages = Math.max(1, Math.ceil(matches.length / this.historyPageSize));
    this.historyPage = Math.max(1, Math.min(pages, this.historyPage));
    const start = (this.historyPage - 1) * this.historyPageSize;
    rows.forEach(row => { row.hidden = true; });
    matches.slice(start, start + this.historyPageSize).forEach(row => { row.hidden = false; });
    const empty = this.querySelector('#history-empty');
    if (empty) empty.hidden = matches.length > 0;
    const label = this.querySelector('#history-page-label');
    if (label) label.textContent = `${this.t('histPage')} ${this.historyPage} / ${pages}`;
    const previous = this.querySelector('[data-history-page="prev"]');
    const next = this.querySelector('[data-history-page="next"]');
    if (previous) previous.disabled = this.historyPage === 1;
    if (next) next.disabled = this.historyPage === pages;
  },
  exportHistory() {
    if (['loading', 'error'].includes(this.learningDataState())) { this.showToast(this.t('dataExportUnavailable')); return; }
    const payload = { sessions: this.getSessions(), exportedAt: new Date().toISOString(), version: 1 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paradox-learning-history.json';
    link.click();
    URL.revokeObjectURL(url);
  },
  async importHistory(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = Array.isArray(parsed) ? parsed : parsed.sessions;
      if (!Array.isArray(source)) throw new Error('Invalid sessions');
      const sessions = source.map((item, index) => {
        const validStatuses = ['needs', 'mastered', 'progress', 'completed', 'error', 'abandoned'];
        const score = item?.score === null || item?.score === undefined ? null : Number(item.score);
        if (!item || typeof item.title !== 'string' || !validStatuses.includes(item.status) || (score !== null && !Number.isFinite(score))) throw new Error('Invalid session');
        return {
          id: item.id || `import-${Date.now()}-${index}`,
          date: String(item.date || ''),
          isoDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.isoDate || '')) ? item.isoDate : '',
          title: item.title.slice(0, 160),
          skill: String(item.skill || this.t('setSubjectMath')).slice(0, 80),
          status: item.status,
          recordStatus: typeof item.recordStatus === 'string' ? item.recordStatus : null,
          score: score === null ? null : Math.max(0, Math.min(100, Math.round(score)))
        };
      });
      localStorage.setItem(this.userStorageKey('audit-sessions'), JSON.stringify(sessions.slice(0, 100)));
      this.historyPage = 1;
      this.render();
      this.showToast(this.t('histImportDone'));
    } catch {
      this.showToast(this.t('histImportError'));
    }
  },
  exportData() {
    if (['loading', 'error'].includes(this.learningDataState())) { this.showToast(this.t('dataExportUnavailable')); return; }
    const payload = { user: this.user, settings: this.settings, practice: this.practiceSolved, sessions: this.getSessions(), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paradox-demo-data.json';
    link.click();
    URL.revokeObjectURL(url);
    this.showToast(this.t('setExportDone'));
  },
  resetPractice() {
    localStorage.setItem(this.userStorageKey('practice'), '[]');
    localStorage.setItem(this.userStorageKey('practice-activity'), '[]');
    this.practiceSolved = [];
    this.practiceActivity = [];
    this.render();
    this.showToast(this.t('setResetDone'));
  },
};
