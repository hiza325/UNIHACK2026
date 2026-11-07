import { createPracticeService } from './practice-service.js';

function randomAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const practiceActionMethods = {
  newPracticeAttemptId() {
    return randomAttemptId();
  },
  configurePracticeService() {
    const runtime = globalThis.PARADOX_PRACTICE_CONFIG || {};
    const localServer = this.authProvider === 'local' && typeof localStorage !== 'undefined' && localStorage.getItem('paradox-local-server') === '1';
    const enabled = runtime.enabled === true || (runtime.enabled !== false && (this.authProvider === 'remote' || localServer));
    this.practiceService = createPracticeService({ enabled, apiBaseUrl: runtime.apiBaseUrl || '/api' });
    this.practiceChallenges = [];
    this.practiceProgress = null;
    this.practiceState = enabled ? 'loading' : 'demo';
    this.practiceError = '';
    this.practiceLoadAttempted = false;
    this.practiceLoading = false;
    this.practiceCurrent = null;
    this.practiceAttemptId = '';
    this.practiceSubmitting = false;
    this.practiceOpenerKey = null;
  },
  async loadPracticeData({ force = false } = {}) {
    if (!this.practiceService?.enabled) {
      this.practiceState = 'demo';
      return;
    }
    if (this.practiceLoading) return;
    if (this.practiceLoadAttempted && !force) return;
    this.practiceLoading = true;
    this.practiceState = 'loading';
    this.practiceError = '';
    if (this.view === 'practice') this.render();
    try {
      const data = await this.practiceService.getOverview(this.lang);
      this.practiceChallenges = Array.isArray(data.challenges) ? data.challenges : [];
      this.practiceProgress = data.progress || null;
      this.practiceState = this.practiceChallenges.length ? 'ready' : 'empty';
      this.practiceLoadAttempted = true;
    } catch (error) {
      this.practiceState = 'error';
      this.practiceError = error && error.message ? error.message : String(error);
      this.practiceChallenges = [];
      this.practiceProgress = null;
      this.practiceLoadAttempted = true;
    } finally {
      this.practiceLoading = false;
      if (this.view === 'practice') this.render();
    }
  },
  practiceIsSolved(key) {
    if (!this.practiceService?.enabled || this.practiceState !== 'ready') {
      return this.practiceSolved.includes(Number(key));
    }
    const slug = typeof key === 'string' ? key : this.practiceChallenges?.[Number(key)]?.slug;
    return Boolean(this.practiceProgress?.solvedChallengeSlugs?.includes(slug));
  },
  async retryPracticeLoad() {
    await this.loadPracticeData({ force: true });
  },
  async submitPracticeAttempt(selectedOption) {
    if (!this.practiceCurrent || this.practiceCurrent.mode !== 'server' || this.practiceSubmitting) return;
    this.practiceSubmitting = true;
    const modal = this.querySelector('#practice-modal');
    const result = modal?.querySelector('#practice-result');
    if (result) {
      result.hidden = false;
      result.className = 'practice-result';
      result.innerHTML = `<strong>${this.t('pracChecking')}</strong>`;
    }
    const buttons = [...(modal?.querySelectorAll('[data-option]') || [])];
    buttons.forEach(button => { button.disabled = true; });
    try {
      const response = await this.practiceService.submitAttempt({
        challengeSlug: this.practiceCurrent.challenge.slug,
        selectedOption,
        clientAttemptId: this.practiceAttemptId,
        lang: this.lang,
      });
      const attempt = response.attempt;
      buttons.forEach((button, index) => {
        button.disabled = true;
        if (index === attempt.correctOption) button.classList.add('correct');
        if (index === selectedOption && !attempt.isCorrect) button.classList.add('wrong');
      });
      if (result) {
        result.hidden = false;
        result.className = `practice-result ${attempt.isCorrect ? 'ok' : 'no'}`;
        result.innerHTML = `<strong>${attempt.isCorrect ? this.t('pracCorrect') : this.t('pracWrong')}</strong><p>${this.escape(attempt.explanation)}</p>${attempt.isCorrect ? '' : `<button class="ghost-button" type="button" data-retry-practice>${this.t('pracRetry')}</button>`}`;
      }
      this.practiceProgress = response.progress || this.practiceProgress;
      this.syncPracticeProgressDom(this.practiceCurrent.challenge.slug);
    } catch (error) {
      buttons.forEach(button => { button.disabled = false; });
      if (result) {
        result.hidden = false;
        result.className = 'practice-result no';
        result.innerHTML = `<strong>${this.t('pracSubmitError')}</strong><p>${this.escape(error?.message || String(error))}</p><button class="ghost-button" type="button" data-retry-practice>${this.t('pracRetry')}</button>`;
      }
    } finally {
      this.practiceSubmitting = false;
    }
  },
  syncPracticeProgressDom(challengeSlug) {
    const progress = this.practiceProgress;
    if (!progress) return;
    const challenge = (this.practiceChallenges || []).find(item => item.slug === challengeSlug);
    const card = this.querySelector(`.challenge-card[data-challenge="${challengeSlug}"]`);
    if (card && this.practiceIsSolved(challengeSlug)) {
      card.classList.add('solved');
      const badge = card.querySelector('.challenge-badge');
      if (badge) badge.textContent = `✓ ${this.t('pracSolved')}`;
      const button = card.querySelector('[data-challenge]');
      if (button) button.textContent = `${this.t('pracSolved')} →`;
    }
    const subjectCard = challenge ? this.querySelector(`.topic-progress-card[data-topic-key="${challenge.subjectKey}"]`) : null;
    if (subjectCard && progress.subjects) {
      const subject = progress.subjects.find(item => item.subjectKey === challenge.subjectKey);
      if (subject) {
        const total = subject.total || 1;
        const solved = subject.solved || 0;
        const percent = Math.round((solved / total) * 100);
        const count = subjectCard.querySelector('.skill-top span:last-child');
        if (count) count.textContent = `${solved}/${total}`;
        const bar = subjectCard.querySelector('.skill-track > span');
        if (bar) bar.style.width = `${percent}%`;
        const small = subjectCard.querySelector('small');
        if (small) small.textContent = `${solved} ${this.t('pracSolvedCount')}`;
      }
    }
    const count = this.querySelector('.practice-count');
    if (count) count.textContent = `${this.t('pracSolved')}: ${progress.solvedChallenges} / ${progress.totalChallenges}`;
  },
};
