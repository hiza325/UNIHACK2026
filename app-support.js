import { requestSupportReply } from './support-ai.js';

export const supportMethods = {
  supportStarterSuggestions() {
    return ({
      vi: [
        'Tôi không nhận được mã OTP thì sao?',
        'Quên mật khẩu thì làm gì?',
        'Dữ liệu học tập của tôi được lưu ở đâu?',
        'Làm sao xác minh một credential?',
        'PARADOX có đưa đáp án ngay không?',
        'Một phiên học gồm mấy bước?',
      ],
      en: [
        'What if I do not receive my OTP code?',
        'What do I do if I forgot my password?',
        'Where is my learning data stored?',
        'How do I verify a credential?',
        'Does PARADOX give the answer right away?',
        'How many steps are in a study session?',
      ],
      jp: [
        'OTPコードが届かない場合は？',
        'パスワードを忘れた場合は？',
        '学習データはどこに保存されますか？',
        '資格情報を確認するには？',
        'PARADOXはすぐに答えを教えますか？',
        '学習セッションは何ステップありますか？',
      ],
    })[this.lang] || [];
  },
  activeSupportSuggestions() {
    if (this.supportMessages.length === 0) return this.supportStarterSuggestions();
    return Array.isArray(this.supportSuggestions) ? this.supportSuggestions.slice(0, 4) : [];
  },
  supportSuggestionsMarkup() {
    const suggestions = this.activeSupportSuggestions();
    if (!suggestions.length) return '<div class="support-suggestions" id="support-suggestions" hidden></div>';
    const chips = suggestions
      .map((item, index) => `<button type="button" class="suggestion-chip" data-support-suggestion="${index}">${this.escape(item)}</button>`)
      .join('');
    return `<div class="support-suggestions" id="support-suggestions"><span class="support-suggestions-label">${this.t('supportSuggestions')}</span>${chips}</div>`;
  },
  supportWidgetMarkup() {
    const messages = this.supportMessages.length
      ? this.supportMessages
      : [{ role: 'assistant', text: this.t('supportWelcome') }];
    return `<aside class="support-widget" aria-label="${this.t('supportTitle')}">
      <button class="back-to-top" type="button" data-back-to-top aria-label="${this.t('backToTop')}" title="${this.t('backToTop')}" ${window.scrollY < 360 ? 'hidden' : ''}><span aria-hidden="true">↑</span></button>
      <button class="support-launcher" type="button" data-support-toggle aria-label="${this.t('supportOpen')}" aria-expanded="${this.supportOpen}" aria-controls="support-panel"><img src="chatbot-avatar.png" alt="" aria-hidden="true"></button>
      <section class="support-panel" id="support-panel" role="dialog" aria-modal="false" aria-labelledby="support-title" ${this.supportOpen ? '' : 'hidden'}>
        <header class="support-head"><div><span class="support-kicker">PARADOX AI</span><h2 id="support-title">${this.t('supportTitle')}</h2></div><button type="button" data-support-close aria-label="${this.t('close')}"><span aria-hidden="true">×</span></button></header>
        <div class="support-messages" id="support-messages" aria-live="polite">${messages.map(item => this.supportMessageMarkup(item)).join('')}${this.supportLoading ? this.supportTypingMarkup() : ''}</div>
        ${this.supportSuggestionsMarkup()}
        <form class="support-form" id="support-form"><label class="sr-only" for="support-input">${this.t('supportPlaceholder')}</label><input id="support-input" name="message" maxlength="600" autocomplete="off" placeholder="${this.t('supportPlaceholder')}" ${this.supportLoading ? 'disabled' : ''}><button type="submit" aria-label="${this.t('send')}" ${this.supportLoading ? 'disabled' : ''}><span aria-hidden="true">↑</span></button></form>
        <p class="support-note">${this.t('supportScope')}</p>
      </section>
    </aside>`;
  },
  formatSupportText(text) {
    // Escape first so no model output can become markup, then restore a tiny safe subset:
    // **bold**, __bold__, *italic*, _italic_, `inline code` and line breaks.
    const escaped = this.escape(String(text ?? ''));
    const codeTokens = [];
    let safe = escaped.replace(/`([^`\n]+)`/g, (_, code) => `\uE000${codeTokens.push(`<code>${code}</code>`) - 1}\uE000`);
    safe = safe
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^_\w])__([^_\n]+?)__(?![\w_])/g, '$1<strong>$2</strong>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+?)_(?![\w_])/g, '$1<em>$2</em>');
    safe = safe.replace(/\uE000(\d+)\uE000/g, (_, index) => codeTokens[Number(index)]);
    return safe.replace(/\n/g, '<br>');
  },
  supportMessageMarkup(message) {
    const text = String(message.text ?? '');
    const safe = message.role === 'user'
      ? this.escape(text).replace(/\n/g, '<br>')
      : this.formatSupportText(text);
    return `<div class="support-message ${message.role === 'user' ? 'user' : 'assistant'}"><span>${safe}</span></div>`;
  },
  updateBackToTop() {
    const button = this.querySelector('[data-back-to-top]');
    if (button) button.hidden = window.scrollY < 360;
  },
  supportTypingMarkup() {
    return `<div class="support-message assistant support-typing" role="status"><span>${this.t('supportThinking')}</span></div>`;
  },
  supportErrorText(error) {
    if (error?.code === 'NOT_CONFIGURED') return this.t('supportNotConfigured');
    if (error?.code === 'RATE_LIMITED') return this.t('supportRateLimited');
    if (error?.code === 'TIMEOUT') return this.t('supportTimeout');
    return this.t('supportError');
  },
  toggleSupport(force) {
    this.supportOpen = typeof force === 'boolean' ? force : !this.supportOpen;
    const panel = this.querySelector('#support-panel');
    const launcher = this.querySelector('[data-support-toggle]');
    if (panel) panel.hidden = !this.supportOpen;
    launcher?.setAttribute('aria-expanded', String(this.supportOpen));
    launcher?.setAttribute('aria-label', this.t(this.supportOpen ? 'supportClose' : 'supportOpen'));
    if (this.supportOpen) requestAnimationFrame(() => this.querySelector('#support-input')?.focus());
  },
  renderSupportConversation() {
    const root = this.querySelector('#support-messages');
    if (!root) return;
    const messages = this.supportMessages.length
      ? this.supportMessages
      : [{ role: 'assistant', text: this.t('supportWelcome') }];
    root.innerHTML = messages.map(item => this.supportMessageMarkup(item)).join('') + (this.supportLoading ? this.supportTypingMarkup() : '');
    root.scrollTop = root.scrollHeight;
    const suggestionsRoot = this.querySelector('#support-suggestions');
    if (suggestionsRoot) suggestionsRoot.outerHTML = this.supportSuggestionsMarkup();
    const input = this.querySelector('#support-input');
    const submit = this.querySelector('#support-form button[type="submit"]');
    if (input) input.disabled = this.supportLoading;
    if (submit) submit.disabled = this.supportLoading;
  },
  async sendSupportMessage(text) {
    const value = String(text || '').trim().slice(0, 600);
    if (!value || this.supportLoading) return;
    this.supportMessages.push({ role: 'user', text: value });
    this.supportMessages = this.supportMessages.slice(-20);
    this.supportLoading = true;
    this.supportSuggestions = [];
    this.renderSupportConversation();
    try {
      const reply = await requestSupportReply(this.supportMessages, this.lang, this.view || 'landing');
      const resolved = typeof reply === 'string' ? { text: reply, suggestions: [] } : reply;
      this.supportMessages.push({ role: 'assistant', text: resolved.text });
      this.supportSuggestions = Array.isArray(resolved.suggestions) ? resolved.suggestions.slice(0, 4) : [];
    } catch (error) {
      this.supportMessages.push({ role: 'assistant', text: this.supportErrorText(error) });
    } finally {
      this.supportLoading = false;
      this.supportMessages = this.supportMessages.slice(-20);
      this.renderSupportConversation();
      this.querySelector('#support-input')?.focus();
    }
  },
};
