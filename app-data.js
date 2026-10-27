import { demo } from './demo.js';

export const dataMethods = {
  readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } },
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
      const request = this.auditDB.transaction('state', 'readonly').objectStore('state').get('audit');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    if (!state) return;
    this.step = Number.isInteger(state.step) ? Math.max(0, Math.min(6, state.step)) : 0;
    this.auditMessages = Array.isArray(state.messages) ? state.messages.slice(-60) : [];
    this.auditText = typeof state.text === 'string' ? state.text : '';
    this.files = {
      problem: state.files?.problem ? [state.files.problem] : [],
      work: state.files?.work ? [state.files.work] : []
    };
  },
  saveAuditState() {
    if (!this.auditDB) return;
    const state = {
      step: this.step,
      text: this.auditText,
      messages: this.auditMessages.slice(-60),
      files: { problem: this.files.problem[0] || null, work: this.files.work[0] || null }
    };
    try { this.auditDB.transaction('state', 'readwrite').objectStore('state').put(state, 'audit'); } catch { /* IndexedDB may be unavailable in private mode. */ }
  },
  getSessions() {
    const saved = this.readJSON('paradox-audit-sessions', []);
    const seen = new Set();
    return [...saved, ...demo[this.lang].sessions].filter(item => {
      const key = item.id || `${item.date}|${item.title}|${item.skill}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
  sessionISODate(session) {
    if (session.isoDate) return session.isoDate;
    const [day, month] = String(session.date || '').split('/').map(Number);
    if (!day || !month) return '';
    return `${new Date().getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  },
  learningMetrics() {
    const sessions = this.getSessions();
    const average = sessions.length ? Math.round(sessions.reduce((sum, item) => sum + Number(item.score || 0), 0) / sessions.length) : 0;
    const mastered = sessions.filter(item => item.status === 'mastered').length;
    const accuracy = sessions.length ? Math.round(mastered / sessions.length * 100) : 0;
    const dates = new Set([
      ...sessions.map(item => this.sessionISODate(item)),
      ...this.practiceActivity.map(item => item.isoDate)
    ].filter(Boolean));
    let cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    const todayKey = this.localDateKey(cursor);
    if (!dates.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dates.has(this.localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return { sessions, average, mastered, accuracy, streak };
  },
  activitySeries(period) {
    const slots = period === 7 ? 7 : 12;
    const values = Array(slots).fill(0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const activities = [
      ...this.getSessions().map(item => ({ isoDate: this.sessionISODate(item), minutes: 6 + Math.round(Number(item.score || 0) / 20) })),
      ...this.practiceActivity
    ];
    activities.forEach(item => {
      const date = new Date(`${item.isoDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) return;
      const daysAgo = Math.floor((now - date) / 86400000);
      if (daysAgo < 0 || daysAgo >= period) return;
      const chronologicalDay = period - 1 - daysAgo;
      const index = Math.min(slots - 1, Math.floor(chronologicalDay / (period / slots)));
      values[index] += Number(item.minutes || 3);
    });
    const max = Math.max(...values, 1);
    return { values, heights: values.map(value => value ? Math.max(12, Math.round(value / max * 100)) : 4) };
  },
  recordAuditSession(text) {
    const subjectKeys = { math: 'setSubjectMath', algebra: 'setSubjectAlgebra', code: 'setSubjectCode' };
    const source = this.files.problem[0]?.name || String(text || '').split(/\r?\n/)[0].slice(0, 54) || this.t('sessionTitle');
    const now = new Date();
    const sessions = this.readJSON('paradox-audit-sessions', []);
    sessions.unshift({
      id: `audit-${now.getTime()}`,
      date: `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`,
      isoDate: this.localDateKey(now),
      title: source,
      skill: this.t(subjectKeys[this.settings.subject] || 'setSubjectMath'),
      status: 'progress',
      score: 50
    });
    localStorage.setItem('paradox-audit-sessions', JSON.stringify(sessions.slice(0, 100)));
  },
  updateAuditProgress(step) {
    const sessions = this.readJSON('paradox-audit-sessions', []);
    if (!sessions.length) return;
    sessions[0].score = Math.min(95, 50 + step * 8);
    sessions[0].status = step >= 5 ? 'mastered' : 'progress';
    localStorage.setItem('paradox-audit-sessions', JSON.stringify(sessions));
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
        if (!item || typeof item.title !== 'string' || !Number.isFinite(Number(item.score))) throw new Error('Invalid session');
        return {
          id: item.id || `import-${Date.now()}-${index}`,
          date: String(item.date || ''),
          isoDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.isoDate || '')) ? item.isoDate : '',
          title: item.title.slice(0, 160),
          skill: String(item.skill || this.t('setSubjectMath')).slice(0, 80),
          status: ['needs', 'mastered', 'progress'].includes(item.status) ? item.status : 'progress',
          score: Math.max(0, Math.min(100, Math.round(Number(item.score))))
        };
      });
      localStorage.setItem('paradox-audit-sessions', JSON.stringify(sessions.slice(0, 100)));
      this.historyPage = 1;
      this.render();
      this.showToast(this.t('histImportDone'));
    } catch {
      this.showToast(this.t('histImportError'));
    }
  },
  exportData() {
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
    localStorage.removeItem('paradox-practice');
    localStorage.removeItem('paradox-practice-activity');
    this.practiceSolved = [];
    this.practiceActivity = [];
    this.render();
    this.showToast(this.t('setResetDone'));
  },
};
