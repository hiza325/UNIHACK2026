import { copy } from './app-config.js';
import { dataMethods } from './app-data.js';
import { viewMethods } from './app-views.js';
import { actionMethods } from './app-actions.js';
import { routerMethods } from './app-router.js';
import { themeMethods } from './app-theme.js';
import { eventMethods } from './app-events.js';
import { defineComponents } from './components.js';


class EduApp extends HTMLElement {
  constructor() {
    super();
    this.lang = ['vi', 'en', 'jp'].includes(localStorage.getItem('paradox-lang')) ? localStorage.getItem('paradox-lang') : 'vi';
    this.step = 0;
    this.files = { problem: [], work: [] };
    this.authMode = 'login';
    this.user = this.readSession();
    this.view = 'dashboard';
    this.pendingView = null;
    this.practiceIndex = null;
    this.practiceSolved = this.readJSON('paradox-practice', []);
    this.practiceActivity = this.readJSON('paradox-practice-activity', []);
    this.settings = this.readJSON('paradox-settings', { reminder: true, digest: true, sound: false, subject: 'math', hint: 2 });
    this.auditMessages = [];
    this.auditText = '';
    this.isAnalyzing = false;
    this.auditStorageReady = false;
    this.filePreviewUrls = {};
    this.historyPage = 1;
    this.historyPageSize = 5;
    this.toastTimer = null;
    this.onHashChange = this.onHashChange.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
  }
  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('change', this.onChange);
    this.addEventListener('input', this.onInput);
    this.addEventListener('submit', this.onSubmit);
    window.addEventListener('keydown', this.onKeydown);
    window.addEventListener('hashchange', this.onHashChange);
    this.handleRoute();
    this.loadAuditState().then(() => {
      this.auditStorageReady = true;
      if (this.user && this.view === 'audit') this.render();
    });
  }
  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('change', this.onChange);
    this.removeEventListener('input', this.onInput);
    this.removeEventListener('submit', this.onSubmit);
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('hashchange', this.onHashChange);
  }
  saveSettings() { localStorage.setItem('paradox-settings', JSON.stringify(this.settings)); }
  readSession() { try { return JSON.parse(localStorage.getItem('paradox-session') || 'null'); } catch { return null; } }
  t(key) { return copy[this.lang][key] || copy.vi[key] || key; }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
}

Object.assign(EduApp.prototype, dataMethods, viewMethods, actionMethods, routerMethods, themeMethods, eventMethods);

defineComponents(EduApp);
