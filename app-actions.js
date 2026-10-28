import { demo } from './demo.js';
import { MAX_FILE_SIZE, ALLOWED_FILE_EXTENSIONS } from './app-config.js';
import { requestDebateAnalysis } from './debate-ai.js';

export const actionMethods = {
  authText() {
    return ({vi:{loginTitle:'Chào mừng trở lại',signupTitle:'Tạo tài khoản PARADOX',name:'Tên của bạn',email:'Địa chỉ email',password:'Mật khẩu',confirm:'Nhập lại mật khẩu',submitLogin:'Đăng nhập',submitSignup:'Gửi mã xác nhận',switchLogin:'Đã có tài khoản? Đăng nhập',switchSignup:'Chưa dùng PARADOX? Tạo tài khoản'},en:{loginTitle:'Welcome back',signupTitle:'Create your PARADOX account',name:'Your name',email:'Email address',password:'Password',confirm:'Confirm password',submitLogin:'Log in',submitSignup:'Send verification code',switchLogin:'Already have an account? Log in',switchSignup:'New to PARADOX? Sign up'},jp:{loginTitle:'おかえりなさい',signupTitle:'アカウントを作成',name:'お名前',email:'メールアドレス',password:'パスワード',confirm:'パスワードの確認',submitLogin:'ログイン',submitSignup:'認証コードを送信',switchLogin:'アカウントをお持ちですか？ログイン',switchSignup:'初めての方はこちら'}})[this.lang];
  },
  openAuth(mode) {
    this.authMode = mode;
    if (mode !== 'otp') this.pendingSignup = null;
    if (mode !== 'reset') this.pendingPasswordReset = null;
    if (!['otp', 'reset'].includes(mode)) { this.authOtpChallenge = ''; this.authDemoCode = ''; }
    this.querySelector('#auth-error').textContent = '';
    this.querySelector('#auth-backdrop').hidden = false;
    this.updateAuthText(this.authText());
  },
  setAuthLoading(loading) {
    const submit = this.querySelector('.auth-submit');
    if (submit) submit.disabled = loading;
    this.querySelectorAll('#auth-form input, #auth-resend, #auth-forgot').forEach(element => { element.disabled = loading; });
  },
  rateLimitMessage(data) {
    if (data?.code !== 'RATE_LIMITED') return '';
    const seconds = Math.max(1, Number(data.retryAfter) || 60);
    return String(this.t('authRateLimited')).replace('{seconds}', String(seconds));
  },
  async requestOtp(payload) {
    const response = await fetch('/api/auth/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(this.rateLimitMessage(data) || data.error || this.t('authOtpError'));
    return data;
  },
  async requestServerAuth(action, payload, method = 'POST') {
    let response;
    try {
      response = await fetch(`/api/auth/${action}`, {
        method,
        headers: payload ? { 'Content-Type': 'application/json' } : {},
        credentials: 'same-origin',
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch (requestError) {
      if (['localhost', '127.0.0.1'].includes(location.hostname)) return null;
      throw requestError;
    }
    const result = await response.json().catch(() => ({}));
    const localDevelopment = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (localDevelopment && (response.status === 404 || result.code === 'AUTH_NOT_CONFIGURED')) return null;
    if (!response.ok) {
      const error = new Error(this.rateLimitMessage(result) || (response.status >= 500 ? this.t('authServiceError') : (result.error || this.t('authServiceError'))));
      error.status = response.status;
      throw error;
    }
    return result;
  },
  async restoreAuthentication() {
    try {
      const result = await this.requestServerAuth('session', null, 'GET');
      if (!result) return;
      this.authProvider = 'remote';
      this.user = result.user;
      localStorage.setItem('paradox-session', JSON.stringify(this.user));
    } catch (error) {
      if (error.status === 401) {
        this.user = null;
        localStorage.removeItem('paradox-session');
      }
    }
  },
  async authenticate(event, text) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const error = this.querySelector('#auth-error');
    error.textContent = '';
    if (this.authMode === 'forgot') {
      this.setAuthLoading(true);
      try {
        const email = this.normalizeEmail(data.get('email'));
        const result = await this.requestServerAuth('password-reset', { action: 'request', email, language: this.lang });
        if (!result) throw new Error(this.t('authServiceError'));
        this.authProvider = 'remote';
        this.pendingPasswordReset = { email };
        this.authOtpChallenge = result.challenge;
        this.authDemoCode = result.developmentCode || '';
        this.authMode = 'reset';
        this.updateAuthText(text);
        event.currentTarget.reset();
        this.querySelector('input[name="otp"]')?.focus();
      } catch (requestError) {
        error.textContent = requestError.message || this.t('authOtpError');
      } finally {
        this.setAuthLoading(false);
      }
      return;
    }
    if (this.authMode === 'reset') {
      const password = String(data.get('password') || '');
      if (password !== String(data.get('confirm') || '')) {
        error.textContent = text.mismatch;
        return;
      }
      this.setAuthLoading(true);
      try {
        const result = await this.requestServerAuth('password-reset', {
          action: 'confirm', email: this.pendingPasswordReset?.email, code: data.get('otp'),
          password, challenge: this.authOtpChallenge,
        });
        if (!result?.reset) throw new Error(this.t('authOtpInvalid'));
        const email = this.pendingPasswordReset?.email || '';
        this.openAuth('login');
        this.querySelector('input[name="email"]').value = email;
        this.querySelector('input[name="password"]')?.focus();
        this.showToast(this.t('authResetSuccess'));
      } catch (requestError) {
        error.textContent = requestError.message || this.t('authOtpInvalid');
      } finally {
        this.setAuthLoading(false);
      }
      return;
    }
    if (this.authMode === 'otp') {
      this.setAuthLoading(true);
      try {
        const result = this.authProvider === 'remote'
          ? await this.requestServerAuth('verify', { email: this.pendingSignup?.email, code: data.get('otp'), password: this.pendingSignup?.password, userId: this.pendingSignup?.userId, challenge: this.authOtpChallenge })
          : await this.requestOtp({ action: 'verify', email: this.pendingSignup?.email, code: data.get('otp'), challenge: this.authOtpChallenge });
        if (!result.verified) throw new Error(this.t('authOtpInvalid'));
        const account = result.user || await this.registerAccount(this.pendingSignup);
        await this.completeAuthentication(account);
      } catch (requestError) {
        error.textContent = requestError.message || this.t('authOtpInvalid');
      } finally {
        this.setAuthLoading(false);
      }
      return;
    }
    const password = String(data.get('password') || '');
    if (this.authMode === 'signup' && password !== String(data.get('confirm') || '')) {
      error.textContent = text.mismatch;
      return;
    }
    const email = String(data.get('email') || '').trim();
    const name = String(data.get('name') || '').trim() || email.split('@')[0];
    if (this.authMode === 'signup') {
      this.setAuthLoading(true);
      try {
        const normalizedEmail = this.normalizeEmail(email);
        const remote = await this.requestServerAuth('signup', { name, email: normalizedEmail, password, language: this.lang });
        if (!remote && this.getAccounts().some(account => this.normalizeEmail(account.email) === normalizedEmail)) throw new Error(this.t('authAccountExists'));
        this.authProvider = remote ? 'remote' : 'local';
        this.pendingSignup = { name, email: normalizedEmail, password, userId: remote?.userId || '' };
        if (remote?.user) { await this.completeAuthentication(remote.user); return; }
        const result = remote || await this.requestOtp({ action: 'send', email: normalizedEmail, language: this.lang });
        this.authOtpChallenge = result.challenge;
        this.authDemoCode = result.developmentCode || '';
        this.authMode = 'otp';
        this.updateAuthText(text);
        this.querySelector('input[name="otp"]')?.focus();
      } catch (requestError) {
        error.textContent = requestError.message || this.t('authOtpError');
      } finally {
        this.setAuthLoading(false);
      }
      return;
    }
    this.setAuthLoading(true);
    try {
      const remote = await this.requestServerAuth('login', { email: this.normalizeEmail(email), password });
      this.authProvider = remote ? 'remote' : 'local';
      const account = remote?.user || await this.loginAccount(email, password);
      await this.completeAuthentication(account);
    } catch (loginError) {
      error.textContent = loginError.message || this.t('authInvalidCredentials');
    } finally {
      this.setAuthLoading(false);
    }
  },
  async resendAuthOtp() {
    if (!['otp', 'reset'].includes(this.authMode)) return;
    const resetting = this.authMode === 'reset';
    const pending = resetting ? this.pendingPasswordReset : this.pendingSignup;
    if (!pending) return;
    const error = this.querySelector('#auth-error');
    error.textContent = '';
    this.setAuthLoading(true);
    try {
      const result = resetting
        ? await this.requestServerAuth('password-reset', { action: 'request', email: pending.email, language: this.lang })
        : this.authProvider === 'remote'
          ? await this.requestServerAuth('resend', { email: pending.email, language: this.lang })
          : await this.requestOtp({ action: 'send', email: pending.email, language: this.lang });
      this.authOtpChallenge = result.challenge;
      this.authDemoCode = result.developmentCode || '';
      this.updateAuthText(this.authText());
      this.showToast(this.t('authOtpResent'));
    } catch (requestError) {
      error.textContent = requestError.message || this.t('authOtpError');
    } finally {
      this.setAuthLoading(false);
    }
  },
  async completeAuthentication(account) {
    this.configureLearningPassportService();
    this.configureLearningRecordsService();
    this.user = account;
    this.initializeUserData(account.email);
    localStorage.setItem('paradox-session', JSON.stringify(this.user));
    await this.loadUserData();
    const target = this.pendingView || 'dashboard';
    this.pendingView = null;
    this.pendingSignup = null;
    this.pendingPasswordReset = null;
    this.authOtpChallenge = '';
    this.authDemoCode = '';
    this.navigate(target);
  },
  hydrateFilePreviews() {
    ['problem', 'work'].forEach(async type => {
      const file = this.files[type][0];
      const target = this.querySelector(`[data-file-preview="${type}"]`);
      if (!file || !target) return;
      if (file.type.startsWith('image/')) {
        if (this.filePreviewUrls[type]) URL.revokeObjectURL(this.filePreviewUrls[type]);
        const url = URL.createObjectURL(file);
        this.filePreviewUrls[type] = url;
        target.innerHTML = `<img src="${url}" alt="${this.escape(file.name)}">`;
        return;
      }
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (['txt', 'js', 'py'].includes(extension)) {
        const content = await file.slice(0, 1400).text();
        if (target.isConnected) target.innerHTML = `<pre>${this.escape(content)}</pre>`;
        return;
      }
      target.innerHTML = `<span class="file-preview-generic">${this.escape((extension || 'FILE').toUpperCase())}</span>`;
    });
  },
  bind() {
    this.querySelector('#logout-button')?.addEventListener('click', () => this.logout());
    this.applyStoredTheme();
    if (window.matchMedia('(max-width: 540px)').matches) {
      requestAnimationFrame(() => this.querySelector('.nav-item.active')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    }
    this.querySelector('#lang-toggle')?.addEventListener('click', () => {
      const langs = ['vi', 'en', 'jp'];
      this.lang = langs[(langs.indexOf(this.lang) + 1) % langs.length];
      localStorage.setItem('paradox-lang', this.lang);
      this.render();
    });
    this.querySelectorAll('[data-file]').forEach(input => input.addEventListener('change', e => this.setFile(e.target.dataset.file, e.target.files)));
    this.hydrateFilePreviews();
    if (this.view === 'history') requestAnimationFrame(() => this.filterHistory());
    const zone = this.querySelector('#drop-zone');
    if (zone) {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); const files = [...e.dataTransfer.files]; if (files.length) this.setFile('problem', [files[0]]); if (files.length > 1) this.setFile('work', [files[1]]); });
    }
    this.querySelector('#start-audit')?.addEventListener('click', () => this.startAudit());
    this.querySelector('#chat-form')?.addEventListener('submit', e => { e.preventDefault(); this.sendMessage(); });
    this.querySelectorAll('[data-reply]').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.reply === 'upload') this.querySelector('#file-work')?.click(); else this.showToast(this.t('feedback')); }));
    this.querySelector('#practice-button')?.addEventListener('click', () => this.navigate('practice'));
  },
  openResetModal() {
    const modal = this.querySelector('#reset-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('[data-cancel-reset]')?.focus();
  },
  closeResetModal() {
    const modal = this.querySelector('#reset-modal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    this.querySelector('#reset-data')?.focus();
  },
  setFile(type, files) {
    if (!files?.length) return;
    const file = files[0];
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) { this.showToast(this.t('fileInvalid')); return; }
    if (file.size > MAX_FILE_SIZE) { this.showToast(this.t('fileTooLarge')); return; }
    this.files[type] = [file];
    this.saveAuditState();
    this.render();
  },
  removeFile(type) {
    if (!['problem', 'work'].includes(type)) return;
    if (this.filePreviewUrls[type]) URL.revokeObjectURL(this.filePreviewUrls[type]);
    delete this.filePreviewUrls[type];
    this.files[type] = [];
    this.saveAuditState();
    this.render();
  },
  openPractice(index) {
    const ch = demo[this.lang].challenges[index];
    const modal = this.querySelector('#practice-modal');
    if (!ch || !modal) return;
    this.practiceIndex = index;
    const t = k => this.t(k);
    modal.innerHTML = `<section class="practice-panel" role="dialog" aria-modal="true" aria-labelledby="practice-title">
      <button class="practice-close" data-close-practice aria-label="${t('pracClose')}"><span aria-hidden="true">×</span></button>
      <span class="eyebrow">${this.escape(ch.subject)} · ${t('pracLevel')} ${this.escape(ch.level)}</span>
      <h2 id="practice-title">${this.escape(ch.title)}</h2>
      <p class="practice-question">${this.escape(ch.question)}</p>
      <div class="practice-options">${ch.options.map((opt, i) => `<button class="option-btn" data-option="${i}"><span>${String.fromCharCode(65 + i)}</span>${this.escape(opt)}</button>`).join('')}</div>
      <div class="practice-result" id="practice-result" hidden></div>
      <div class="practice-foot"><span class="practice-source">${t('pracSource')}: ${this.escape(ch.source)}</span><button class="ghost-button" data-close-practice>${t('pracClose')}</button></div>
    </section>`;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.practice-close')?.focus();
  },
  answerPractice(index) {
    const modal = this.querySelector('#practice-modal');
    const ch = demo[this.lang].challenges[this.practiceIndex];
    if (!modal || !ch) return;
    const buttons = [...modal.querySelectorAll('[data-option]')];
    if (buttons.some(btn => btn.classList.contains('correct') || btn.classList.contains('wrong'))) return;
    const correct = index === ch.answer;
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === ch.answer) btn.classList.add('correct');
      if (i === index && !correct) btn.classList.add('wrong');
    });
    const result = modal.querySelector('#practice-result');
    result.hidden = false;
    result.className = `practice-result ${correct ? 'ok' : 'no'}`;
    result.innerHTML = `<strong>${correct ? this.t('pracCorrect') : this.t('pracWrong')}</strong><p>${this.escape(ch.explanation)}</p>${correct ? '' : `<button class="ghost-button" type="button" data-retry-practice>${this.t('pracRetry')}</button>`}`;
    if (correct && !this.practiceSolved.includes(this.practiceIndex)) {
      this.practiceSolved.push(this.practiceIndex);
      localStorage.setItem(this.userStorageKey('practice'), JSON.stringify(this.practiceSolved));
      this.practiceActivity.push({ isoDate: this.localDateKey(), minutes: ch.mins, subject: ch.subject, challenge: this.practiceIndex });
      localStorage.setItem(this.userStorageKey('practice-activity'), JSON.stringify(this.practiceActivity.slice(-200)));
      this.querySelectorAll(`[data-challenge="${this.practiceIndex}"]`).forEach(btn => {
        btn.textContent = `${this.t('pracSolved')} ↗`;
        btn.closest('.challenge-card')?.classList.add('solved');
      });
      const count = this.querySelector('.practice-count');
      if (count) count.textContent = `${this.t('pracSolved')}: ${this.practiceSolved.length} / ${demo[this.lang].challenges.length}`;
    }
  },
  retryPractice() {
    const modal = this.querySelector('#practice-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-option]').forEach(button => { button.disabled = false; button.classList.remove('correct', 'wrong'); });
    const result = modal.querySelector('#practice-result');
    if (result) { result.hidden = true; result.className = 'practice-result'; result.innerHTML = ''; }
    modal.querySelector('[data-option]')?.focus();
  },
  closePractice() {
    const modal = this.querySelector('#practice-modal');
    const index = this.practiceIndex;
    if (modal) { modal.hidden = true; modal.innerHTML = ''; }
    document.body.style.overflow = '';
    if (index !== null) this.querySelector(`[data-challenge="${index}"]`)?.focus();
    this.practiceIndex = null;
  },
  async auditInputText(type, value) {
    const text = String(value || '').trim();
    if (text) return text;
    const file = this.files[type]?.[0];
    const extension = file?.name?.split('.').pop()?.toLowerCase();
    if (file && ['txt', 'js', 'py'].includes(extension)) return (await file.slice(0, 16000).text()).trim();
    return '';
  },
  debateErrorText(error) {
    if (error?.code === 'NOT_CONFIGURED') return this.t('debateNotConfigured');
    if (error?.code === 'TIMEOUT') return this.t('debateTimeout');
    if (error?.code === 'INVALID_INPUT') return this.t('debateInvalidInput');
    if (error?.code === 'INVALID_OUTPUT') return this.t('debateInvalidOutput');
    if (error?.code === 'RATE_LIMIT') return this.t('debateRateLimit');
    return this.t('debateApiError');
  },
  updateDebateResult() {
    const slot = this.querySelector('#debate-result-slot');
    if (slot) slot.innerHTML = this.debateResultMarkup();
    const initialSubmit = this.querySelector('#start-audit');
    if (initialSubmit) initialSubmit.hidden = Boolean(this.auditResult);
  },
  ensureDebateSession() {
    if (!this.debateSession || typeof this.debateSession !== 'object') this.debateSession = { revisionCount: 0, hintLevel: 0, hints: [], attempts: [], conversation: [] };
    return this.debateSession;
  },
  async startAudit() {
    return this.submitAuditAttempt('analyze');
  },
  async resubmitAudit() {
    return this.submitAuditAttempt('resubmit');
  },
  async submitAuditAttempt(mode) {
    if (this.isAnalyzing) return;
    const problemField = this.querySelector('#problem-text');
    const solutionField = this.querySelector('#work-text');
    const problem = await this.auditInputText('problem', problemField?.value);
    const solution = await this.auditInputText('work', solutionField?.value);
    if (!problem) { this.showToast(this.t('debateProblemRequired')); problemField?.focus(); return; }
    if (!solution) { this.showToast(this.t('debateSolutionRequired')); solutionField?.focus(); return; }
    const session = this.ensureDebateSession();
    const previousAttempt = session.attempts.at(-1);
    if (mode === 'resubmit' && !previousAttempt) return;
    if (mode === 'resubmit' && previousAttempt.solution.trim() === solution.trim()) { this.showToast(this.t('debateNoChanges')); solutionField?.focus(); return; }
    this.auditProblemText = problem;
    this.auditText = solution;
    if (mode === 'analyze') {
      this.auditResult = null;
      this.debateSession = { revisionCount: 0, hintLevel: 0, hints: [], attempts: [], conversation: [] };
      this.recordAuditSession(`${problem}\n${solution}`);
    }
    const activeSession = this.ensureDebateSession();
    this.saveAuditState();
    this.advance(1);
    this.appendMessage(this.escape(mode === 'resubmit' ? this.t('debateResubmitted') : this.t('submitted')), mode === 'resubmit');
    this.setAnalyzing(true);
    try {
      const learningRecord = await this.prepareLearningRecord(mode, problem, solution, previousAttempt);
      const result = await requestDebateAnalysis({
        mode,
        problem,
        solution,
        language: this.lang,
        previousSolution: mode === 'resubmit' ? previousAttempt.solution : '',
        previousAnalysis: mode === 'resubmit' ? previousAttempt.analysis : null,
        conversation: activeSession.conversation,
        previousHints: activeSession.hints,
        attemptNumber: mode === 'resubmit' ? activeSession.revisionCount + 2 : 1,
        ...(learningRecord ? { learningRecord } : {}),
      });
      if (mode === 'resubmit') {
        activeSession.revisionCount += 1;
        result.comparison = { ...result.comparison, previousSolution: previousAttempt.solution, currentSolution: solution };
      }
      this.auditResult = result;
      activeSession.attempts.push({ solution, analysis: result, at: new Date().toISOString() });
      activeSession.attempts = activeSession.attempts.slice(-10);
      activeSession.conversation.push({ role: 'assistant', text: result.summary });
      activeSession.conversation = activeSession.conversation.slice(-40);
      this.advance(result.status === 'correct' ? 5 : result.status === 'incorrect' ? 2 : 1);
      this.appendMessage(this.escape(result.summary));
      this.updateDebateResult();
      this.addReplies();
    } catch (error) {
      const message = this.debateErrorText(error);
      this.appendMessage(`<span class="message-error">${this.escape(message)}</span>`);
      this.showToast(message);
    } finally {
      this.setAnalyzing(false);
      this.saveAuditState();
      this.loadLearningRecordHistory({ force: true });
    }
  },
  async sendMessage(quickQuestion = '') {
    if (this.isAnalyzing) return;
    const input = this.querySelector('#chat-message');
    const value = String(quickQuestion || input?.value || '').trim();
    if (!value || !this.auditProblemText || !this.auditText) return;
    const session = this.ensureDebateSession();
    this.appendMessage(this.escape(value), true);
    session.conversation.push({ role: 'user', text: value });
    session.conversation = session.conversation.slice(-40);
    if (input) input.value = '';
    this.setAnalyzing(true);
    try {
      const learningRecord = this.currentLearningRecordContext();
      const result = await requestDebateAnalysis({ mode: 'discuss', problem: this.auditProblemText, solution: this.auditText, language: this.lang, question: value, previousAnalysis: this.auditResult, conversation: session.conversation.slice(0, -1), previousHints: session.hints, ...(learningRecord ? { learningRecord } : {}) });
      this.auditResult = { ...result, comparison: this.auditResult?.comparison || result.comparison };
      const reply = result.reply || result.summary;
      session.conversation.push({ role: 'assistant', text: reply });
      session.conversation = session.conversation.slice(-40);
      this.appendMessage(this.escape(reply));
      this.updateDebateResult();
      this.addReplies();
    } catch (error) {
      const message = this.debateErrorText(error);
      this.appendMessage(`<span class="message-error">${this.escape(message)}</span>`);
      this.showToast(message);
    } finally {
      this.setAnalyzing(false);
      this.saveAuditState();
    }
  },
  async requestDebateHint() {
    if (this.isAnalyzing || !this.auditResult) return;
    const session = this.ensureDebateSession();
    const nextLevel = session.hintLevel + 1;
    if (nextLevel > 3) { this.showToast(this.t('debateHintMax')); return; }
    const requestText = this.t('debateHintRequest').replace('{level}', String(nextLevel));
    this.appendMessage(this.escape(requestText), true);
    session.conversation.push({ role: 'user', text: requestText });
    this.setAnalyzing(true);
    try {
      const learningRecord = this.currentLearningRecordContext();
      const result = await requestDebateAnalysis({ mode: 'hint', problem: this.auditProblemText, solution: this.auditText, language: this.lang, question: requestText, hintLevel: nextLevel, previousAnalysis: this.auditResult, conversation: session.conversation.slice(0, -1), previousHints: session.hints, ...(learningRecord ? { learningRecord } : {}) });
      const hint = result.hint;
      if (!hint || hint.level !== nextLevel) throw Object.assign(new Error('Invalid hint'), { code: 'INVALID_OUTPUT' });
      session.hintLevel = nextLevel;
      session.hints.push(hint);
      session.hints = session.hints.slice(0, 3);
      const reply = hint.content;
      session.conversation.push({ role: 'assistant', text: reply });
      session.conversation = session.conversation.slice(-40);
      this.auditResult = { ...result, comparison: this.auditResult.comparison || result.comparison };
      this.appendMessage(`<span class="hint-level-tag">${this.escape(this.t('debateHintLevel').replace('{level}', String(nextLevel)))}</span>${this.escape(reply)}`);
      this.updateDebateResult();
    } catch (error) {
      const message = this.debateErrorText(error);
      this.appendMessage(`<span class="message-error">${this.escape(message)}</span>`);
      this.showToast(message);
    } finally {
      this.setAnalyzing(false);
      this.saveAuditState();
    }
  },
  setAnalyzing(active) {
    this.isAnalyzing = active;
    this.querySelectorAll('#start-audit, #problem-text, #work-text, #chat-message, .send-button, .reply-chip, [data-request-hint], [data-resubmit]').forEach(element => {
      element.disabled = active || (element.hasAttribute('data-request-hint') && this.ensureDebateSession().hintLevel >= 3);
    });
    const submit = this.querySelector('#start-audit');
    if (submit) submit.innerHTML = `${this.t(active ? 'debateAnalyzing' : 'debateAnalyze')} <span class="button-arrow">↗</span>`;
    const existing = this.querySelector('#typing-indicator');
    if (active && !existing) this.querySelector('#messages')?.insertAdjacentHTML('beforeend', this.typingMarkup());
    if (!active) existing?.remove();
  },
  addReplies() {
    const messages = this.querySelector('#messages');
    if (!messages) return;
    messages.querySelectorAll('.quick-replies').forEach(el => el.remove());
    const wrap = document.createElement('div'); wrap.className = 'quick-replies'; wrap.innerHTML = `<button class="reply-chip" data-action="hint">${this.lang === 'en' ? 'I need a hint' : this.lang === 'jp' ? 'ヒントがほしい' : 'Mình cần gợi ý'}</button><button class="reply-chip" data-action="explain">${this.lang === 'en' ? 'Explain the next step' : this.lang === 'jp' ? '次のステップを説明して' : 'Giải thích bước tiếp theo'}</button><button class="reply-chip" data-action="practice">${this.lang === 'en' ? 'Give me a similar problem' : this.lang === 'jp' ? '似た問題を出して' : 'Cho bài tương tự'}</button>`;
    const questions = {
      hint: this.lang === 'en' ? 'Give me one hint without revealing the answer.' : this.lang === 'jp' ? '答えを明かさずにヒントを一つください。' : 'Cho mình một gợi ý nhưng chưa tiết lộ đáp án.',
      explain: this.lang === 'en' ? 'Ask me a question that helps me find the next step without giving the complete answer.' : this.lang === 'jp' ? '完全な答えを出さず、次のステップを見つける質問をしてください。' : 'Hãy hỏi để giúp mình tìm bước tiếp theo mà chưa đưa đáp án hoàn chỉnh.',
      practice: this.lang === 'en' ? 'Suggest one similar practice problem.' : this.lang === 'jp' ? '似た練習問題を一つ提案してください。' : 'Gợi ý một bài luyện tập tương tự.',
    };
    wrap.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => { const action = btn.dataset.action; wrap.remove(); if (action === 'hint') this.requestDebateHint(); else this.sendMessage(questions[action]); }));
    messages.append(wrap);
  },
  appendMessage(html, user = false) {
    const messages = this.querySelector('#messages');
    this.auditMessages.push({ html, user, at: new Date().toISOString() });
    this.auditMessages = this.auditMessages.slice(-60);
    this.saveAuditState();
    if (!messages) return;
    const initials = (this.user?.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const item = document.createElement('audit-message'); item.className = `message ${user ? 'user' : ''}`;
    item.innerHTML = `<span class="message-icon">${user ? this.escape(initials) : '✳'}</span><div class="bubble">${html}<div class="message-time">${this.t('timeNow')}</div></div>`;
    messages.append(item); item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },
  advance(step) {
    const previousStep = this.step;
    this.step = Math.max(0, Math.min(6, step));
    if (this.settings.sound && previousStep < 5 && this.step >= 5) this.playCompletionSound();
    this.updateAuditProgress(this.step);
    this.saveAuditState();
    const root = this.querySelector('audit-stepper');
    if (!root) return;
    root.innerHTML = this.auditStepsMarkup();
  },
};
