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
        <form class="support-form" id="support-form"><label class="sr-only" for="support-input">${this.t('supportPlaceholder')}</label><input id="support-input" name="message" maxlength="1200" autocomplete="off" placeholder="${this.t('supportPlaceholder')}" ${this.supportLoading ? 'disabled' : ''}><button type="submit" aria-label="${this.t('send')}" ${this.supportLoading ? 'disabled' : ''}><span aria-hidden="true">↑</span></button></form>
        <p class="support-note">${this.t('supportScope')}</p>
      </section>
    </aside>`;
  },
  formatSupportText(text) {
    const inline = value => value.split(/(`[^`\n]+`)/g).map(part => {
      const escaped = this.escape(part);
      if (part.startsWith('`') && part.endsWith('`')) return `<code>${this.escape(part.slice(1, -1))}</code>`;
      return escaped
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^_\w])__([^_\n]+?)__(?![\w_])/g, '$1<strong>$2</strong>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
       .replace(/(^|[^_\w])_([^_\n]+?)_(?![\w_])/g, '$1<em>$2</em>');
    }).join('');
    // Split before escaping: code contents never pass through Markdown rules.
    return String(text ?? '').split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g).map(part => {
      if (part.startsWith('```')) return `<pre class="support-code"><code>${this.escape(part.replace(/^```[^\n]*\n/, '').replace(/```$/, ''))}</code></pre>`;
      let list = '';
      const lines = part.split('\n').map(line => {
        const match = line.match(/^\s*(?:(\d+)\.\s+|[-*]\s+)(.*)$/);
        const type = match ? (match[1] ? 'ol' : 'ul') : '';
        const transition = (list && list !== type ? `</${list}>` : '') + (type && list !== type ? `<${type}>` : '');
        list = type;
        if (match) return `${transition}<li${match[1] ? ` value="${Number(match[1])}"` : ''}>${inline(match[2])}</li>`;
        return transition + (/^#{1,6}\s+/.test(line) ? `<strong>${inline(line.replace(/^#{1,6}\s+/, ''))}</strong>` : inline(line)) + '<br>';
      });
      return lines.join('') + (list ? `</${list}>` : '');
    }).join('');
  },
  supportStatusText() {
    const labels = {
      vi: { incomplete: 'Phản hồi chưa hoàn tất. Bạn có thể thử lại với từng ý riêng.', degraded: 'AI đang gián đoạn; dưới đây chỉ là hướng dẫn tham khảo từ tài liệu, có thể chưa đủ cho mọi ý.', retry: 'Thử lại', complete: 'Đã trả lời xong' },
      en: { incomplete: 'The reply is incomplete. Try again with one question at a time.', degraded: 'AI is unavailable; this documentation fallback may not cover every part.', retry: 'Retry', complete: 'Reply complete' },
      jp: { incomplete: '回答が完了していません。質問を分けて再試行できます。', degraded: 'AIに接続できません。以下は資料からの参考情報で、すべての質問を網羅しない場合があります。', retry: '再試行', complete: '回答完了' },
    };
    return labels[this.lang] || labels.en;
  },
  supportMessageMarkup(message) {
    const text = String(message.text ?? '');
    const safe = message.role === 'user'
      ? this.escape(text).replace(/\n/g, '<br>')
      : this.formatSupportText(text);
    const labels = this.supportStatusText();
    const interrupted = ['incomplete', 'degraded', 'error'].includes(message.status);
    const latest = message === this.supportMessages.at(-1);
    const notice = message.role === 'assistant' && message.status
      ? `<small class="support-status" role="status">${this.escape(message.status === 'error' ? '' : labels[message.status] || labels.incomplete)}${message.code === 'TIMEOUT' || message.code === 'RATE_LIMITED' ? ` ${this.escape(this.supportErrorText(message))}` : ''}</small>${interrupted && latest ? `<button type="button" data-support-retry ${this.supportLoading ? 'disabled' : ''}>${labels.retry}</button>` : ''}` : '';
    return `<div class="support-message ${message.role === 'user' ? 'user' : 'assistant'}"><div class="support-bubble">${safe}${notice}</div></div>`;
  },
  updateBackToTop() {
    const button = this.querySelector('[data-back-to-top]');
    if (button) button.hidden = window.scrollY < 360;
  },
  supportTypingMarkup() {
    return `<div class="support-message assistant support-typing" role="status"><span>${this.t('supportThinking')}</span></div>`;
  },
  supportErrorText(error) {
    if (error?.code === 'INTERRUPTED_RESPONSE') return ({ vi: 'Phản hồi bị gián đoạn. Vui lòng thử lại.', en: 'The response was interrupted. Please retry.', jp: '応答が中断されました。再試行してください。' })[this.lang] || this.t('supportError');
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
  async sendSupportMessage(text, retry = false) {
    const value = String(text || '').trim();
    if (!value || this.supportLoading) return;
    if (value.length > 1200) return;
    if (retry) this.supportMessages.pop(); // Replace the interrupted reply, never append a continuation guess.
    else this.supportMessages.push({ role: 'user', text: value });
    this.supportMessages = this.supportMessages.slice(-20);
    this.supportLoading = true;
    this.supportSuggestions = [];
    this.renderSupportConversation();
    try {
      const reply = await requestSupportReply(this.supportMessages, this.lang, this.view || 'landing');
      const resolved = typeof reply === 'string' ? { text: reply, suggestions: [] } : reply;
      this.supportMessages.push({ role: 'assistant', text: resolved.text, status: resolved.status || 'incomplete', code: resolved.code });
      this.supportSuggestions = Array.isArray(resolved.suggestions) ? resolved.suggestions.slice(0, 4) : [];
    } catch (error) {
      this.supportMessages.push({ role: 'assistant', text: this.supportErrorText(error), status: 'error', code: error.code });
    } finally {
      this.supportLoading = false;
      this.supportMessages = this.supportMessages.slice(-20);
      this.renderSupportConversation();
      this.querySelector('#support-input')?.focus();
    }
  },
  retrySupportMessage() {
    if (this.supportLoading || !['incomplete', 'degraded', 'error'].includes(this.supportMessages.at(-1)?.status)) return;
    const question = this.supportMessages.at(-2);
    if (question?.role === 'user') return this.sendSupportMessage(question.text, true);
  },
};
