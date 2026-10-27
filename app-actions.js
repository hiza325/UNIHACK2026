import { demo } from './demo.js';
import { MAX_FILE_SIZE, ALLOWED_FILE_EXTENSIONS } from './app-config.js';

export const actionMethods = {
  openAuth(mode) { this.authMode=mode; this.querySelector('#auth-error').textContent=''; this.querySelector('#auth-backdrop').hidden=false; this.updateAuthText(({vi:{loginTitle:'Chào mừng trở lại',signupTitle:'Tạo tài khoản PARADOX',name:'Tên của bạn',email:'Địa chỉ email',password:'Mật khẩu',confirm:'Nhập lại mật khẩu',submitLogin:'Đăng nhập',submitSignup:'Tạo tài khoản',switchLogin:'Đã có tài khoản? Đăng nhập',switchSignup:'Chưa dùng PARADOX? Tạo tài khoản'},en:{loginTitle:'Welcome back',signupTitle:'Create your PARADOX account',name:'Your name',email:'Email address',password:'Password',confirm:'Confirm password',submitLogin:'Log in',submitSignup:'Create account',switchLogin:'Already have an account? Log in',switchSignup:'New to PARADOX? Sign up'},jp:{loginTitle:'おかえりなさい',signupTitle:'アカウントを作成',name:'お名前',email:'メールアドレス',password:'パスワード',confirm:'パスワードの確認',submitLogin:'ログイン',submitSignup:'登録する',switchLogin:'アカウントをお持ちですか？ログイン',switchSignup:'初めての方はこちら'}})[this.lang]); },
  authenticate(event, text) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    if (this.authMode === 'signup' && password !== String(data.get('confirm') || '')) {
      this.querySelector('#auth-error').textContent = text.mismatch;
      return;
    }
    const email = String(data.get('email') || '').trim();
    const name = String(data.get('name') || '').trim() || email.split('@')[0];
    this.user = { name, email };
    localStorage.setItem('paradox-session', JSON.stringify(this.user));
    const target = this.pendingView || 'dashboard';
    this.pendingView = null;
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
      <button class="practice-close" data-close-practice aria-label="${t('pracClose')}">×</button>
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
      localStorage.setItem('paradox-practice', JSON.stringify(this.practiceSolved));
      this.practiceActivity.push({ isoDate: this.localDateKey(), minutes: ch.mins, subject: ch.subject, challenge: this.practiceIndex });
      localStorage.setItem('paradox-practice-activity', JSON.stringify(this.practiceActivity.slice(-200)));
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
  startAudit() {
    if (this.isAnalyzing) return;
    const field = this.querySelector('#work-text');
    const text = field ? field.value.trim() : '';
    if (!text && !this.files.work.length) { this.showToast(this.t('feedback')); field?.focus(); return; }
    this.auditText = text;
    this.recordAuditSession(text);
    this.advance(1); this.appendMessage(this.t('submitted'));
    this.runAnalysis(() => { this.advance(2); this.appendMessage(`${this.t('incorrect')}<div style="margin-top:7px"><span class="prompt">${this.t('greetingPrompt')}</span></div>`); this.addReplies(); }, 700);
  },
  sendMessage() {
    if (this.isAnalyzing) return;
    const input = this.querySelector('#chat-message');
    if (!input) return;
    const value = input.value.trim(); if (!value) return;
    this.appendMessage(this.escape(value), true); input.value = '';
    const normalized = value.toLowerCase();
    this.runAnalysis(() => {
      if (/gợi ý|hint|ヒント|không tìm|can't|cant|không biết/.test(normalized)) { this.advance(3); this.appendMessage(this.t('hint')); this.addReplies(); }
      else if (/sửa|fixed|chỉnh|修正|đổi/.test(normalized)) { this.advance(5); this.appendMessage(this.t('correct')); this.addReplies(); }
      else if (/đáp án|cứu|answer|解答|rescue/.test(normalized)) { this.advance(5); this.appendMessage(this.t('rescue')); this.addReplies(); }
      else { if (this.step < 4) this.advance(this.step + 1); this.appendMessage(this.t('incorrect')); this.addReplies(); }
    }, 650);
  },
  setAnalyzing(active) {
    this.isAnalyzing = active;
    this.querySelectorAll('#start-audit, #chat-message, .send-button, .reply-chip').forEach(element => { element.disabled = active; });
    const existing = this.querySelector('#typing-indicator');
    if (active && !existing) this.querySelector('#messages')?.insertAdjacentHTML('beforeend', this.typingMarkup());
    if (!active) existing?.remove();
  },
  runAnalysis(callback, delay = 650) {
    this.setAnalyzing(true);
    window.setTimeout(() => { this.setAnalyzing(false); callback(); }, delay);
  },
  addReplies() {
    const messages = this.querySelector('#messages');
    if (!messages) return;
    messages.querySelectorAll('.quick-replies').forEach(el => el.remove());
    const wrap = document.createElement('div'); wrap.className = 'quick-replies'; wrap.innerHTML = `<button class="reply-chip" data-action="hint">${this.lang === 'en' ? 'I need a hint' : this.lang === 'jp' ? 'ヒントがほしい' : 'Mình cần gợi ý'}</button><button class="reply-chip" data-action="rescue">${this.lang === 'en' ? 'Show the full solution' : this.lang === 'jp' ? '解説を見る' : 'Xem lời giải'}</button><button class="reply-chip" data-action="practice">${this.lang === 'en' ? 'Give me a similar problem' : this.lang === 'jp' ? '似た問題を出して' : 'Cho bài tương tự'}</button>`;
    wrap.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => { const action = btn.dataset.action; wrap.remove(); this.runAnalysis(() => { if (action === 'hint') { this.advance(3); this.appendMessage(this.t('hint')); } if (action === 'rescue') { this.advance(5); this.appendMessage(this.t('rescue')); } if (action === 'practice') { this.advance(6); this.appendMessage(this.t('practiceFeedback')); } this.addReplies(); }); }));
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
    this.step = Math.max(0, Math.min(6, step));
    this.updateAuditProgress(this.step);
    this.saveAuditState();
    const root = this.querySelector('audit-stepper');
    if (!root) return;
    root.innerHTML = this.t('stepLabels').map((s, i) => `<div class="step ${i < this.step ? 'done' : ''} ${i === this.step ? 'active' : ''}"><span class="step-num">${i < this.step ? '✓' : i + 1}</span><span class="step-name">${s}</span></div>`).join('');
  },
};
