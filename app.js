import { copy } from './app-config.js';
import { dataMethods } from './app-data.js';
import { viewMethods } from './app-views.js';
import { actionMethods } from './app-actions.js';
import { routerMethods } from './app-router.js';
import { themeMethods } from './app-theme.js';
import { eventMethods } from './app-events.js';
import { notificationMethods } from './app-notifications.js';
import { supportMethods } from './app-support.js';
import { learningPassportActionMethods } from './learning-passport-actions.js';
import { createLearningPassportService } from './learning-passport-service.js';
import { learningRecordActionMethods } from './learning-records-actions.js';
import { createLearningRecordsService } from './learning-records-service.js';
import { defineComponents } from './components.js';


class EduApp extends HTMLElement {
  constructor() {
    super();
    this.lang = ['vi', 'en', 'jp'].includes(localStorage.getItem('paradox-lang')) ? localStorage.getItem('paradox-lang') : 'vi';
    this.step = 0;
    this.files = { problem: [], work: [] };
    this.authMode = 'login';
    this.pendingSignup = null;
    this.pendingPasswordReset = null;
    this.authOtpChallenge = '';
    this.authDemoCode = '';
    this.authProvider = 'local';
    this.adminAccounts = null;
    this.user = this.readSession();
    this.view = 'dashboard';
    this.pendingView = null;
    this.practiceIndex = null;
    this.practiceSolved = this.readJSON(this.userStorageKey('practice'), []);
    this.practiceActivity = this.readJSON(this.userStorageKey('practice-activity'), []);
    this.settings = this.readJSON('paradox-settings', { reminder: true, digest: true, sound: false, subject: 'math', hint: 2 });
    this.auditMessages = [];
    this.auditProblemText = '';
    this.auditText = '';
    this.auditResult = null;
    this.debateSession = { revisionCount: 0, hintLevel: 0, hints: [], attempts: [], conversation: [] };
    this.isAnalyzing = false;
    this.auditStorageReady = false;
    this.filePreviewUrls = {};
    this.historyPage = 1;
    this.historyPageSize = 5;
    this.toastTimer = null;
    this.supportMessages = [];
    this.supportOpen = false;
    this.supportLoading = false;
    this.learningPassportService = createLearningPassportService({ mode: 'mock', apiBaseUrl: '/api' });
    this.passportSnapshot = null;
    this.passportLoading = false;
    this.passportLoadAttempted = false;
    this.passportError = '';
    this.learningRecordsService = createLearningRecordsService({ enabled: false, apiBaseUrl: '/api' });
    this.learningRecordSessionId = '';
    this.learningRecordSubmissionId = '';
    this.remoteLearningSessions = [];
    this.learningRecordsLoaded = false;
    this.learningRecordsLoading = false;
    this.learningRecordSyncError = '';
    this.passportSelectedCredentialCode = '';
    this.passportVerificationQuery = '';
    this.passportVerificationResult = null;
    this.passportVerificationSearched = false;
    this.onHashChange = this.onHashChange.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.updateBackToTop = this.updateBackToTop.bind(this);
    this.onSessionVisibilityChange = () => { if (document.visibilityState === 'visible') this.checkRemoteSession(); };
    this.onSessionWindowFocus = () => this.checkRemoteSession();
  }
  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('change', this.onChange);
    this.addEventListener('input', this.onInput);
    this.addEventListener('submit', this.onSubmit);
    window.addEventListener('keydown', this.onKeydown);
    window.addEventListener('hashchange', this.onHashChange);
    window.addEventListener('scroll', this.updateBackToTop, { passive: true });
    document.addEventListener('visibilitychange', this.onSessionVisibilityChange);
    window.addEventListener('focus', this.onSessionWindowFocus);
    this.authSessionTimer = window.setInterval(() => this.checkRemoteSession(), 15000);
    this.restoreAuthentication().finally(() => {
      this.configureLearningPassportService();
      this.configureLearningRecordsService();
      this.handleRoute();
      this.loadAuditState().then(() => {
        this.auditStorageReady = true;
        if (this.user && ['audit', 'dashboard'].includes(this.view)) this.render();
      });
    });
  }
  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('change', this.onChange);
    this.removeEventListener('input', this.onInput);
    this.removeEventListener('submit', this.onSubmit);
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('hashchange', this.onHashChange);
    window.removeEventListener('scroll', this.updateBackToTop);
    document.removeEventListener('visibilitychange', this.onSessionVisibilityChange);
    window.removeEventListener('focus', this.onSessionWindowFocus);
    window.clearInterval(this.authSessionTimer);
  }
  saveSettings() { localStorage.setItem('paradox-settings', JSON.stringify(this.settings)); }
  readSession() {
    try {
      const session = JSON.parse(localStorage.getItem('paradox-session') || 'null');
      if (!session?.email) return null;
      const accounts = JSON.parse(localStorage.getItem('paradox-accounts') || '[]');
      const account = Array.isArray(accounts) ? accounts.find(item => String(item.email).toLowerCase() === String(session.email).toLowerCase()) : null;
      if (account?.status === 'suspended') { localStorage.removeItem('paradox-session'); return null; }
      return account ? { id: account.id, name: account.name, email: account.email, role: account.role || 'user', status: account.status || 'active', createdAt: account.createdAt, verifiedAt: account.verifiedAt, lastLoginAt: account.lastLoginAt || null } : session;
    } catch { return null; }
  }
  t(key) { return copy[this.lang][key] || copy.vi[key] || key; }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
}

Object.assign(EduApp.prototype, dataMethods, viewMethods, actionMethods, routerMethods, themeMethods, eventMethods, notificationMethods, supportMethods, learningPassportActionMethods, learningRecordActionMethods);

defineComponents(EduApp);
