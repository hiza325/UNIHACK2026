import { requestSupportReply } from './support-ai.js';

export const supportMethods = {
  supportWidgetMarkup() {
    const messages = this.supportMessages.length
      ? this.supportMessages
      : [{ role: 'assistant', text: this.t('supportWelcome') }];
    return `<aside class="support-widget" aria-label="${this.t('supportTitle')}">
      <button class="support-launcher" type="button" data-support-toggle aria-label="${this.t('supportOpen')}" aria-expanded="${this.supportOpen}" aria-controls="support-panel"><span aria-hidden="true">?</span></button>
      <section class="support-panel" id="support-panel" role="dialog" aria-modal="false" aria-labelledby="support-title" ${this.supportOpen ? '' : 'hidden'}>
        <header class="support-head"><div><span class="support-kicker">PARADOX AI</span><h2 id="support-title">${this.t('supportTitle')}</h2></div><button type="button" data-support-close aria-label="${this.t('close')}"><span aria-hidden="true">×</span></button></header>
        <div class="support-messages" id="support-messages" aria-live="polite">${messages.map(item => this.supportMessageMarkup(item)).join('')}${this.supportLoading ? this.supportTypingMarkup() : ''}</div>
        <form class="support-form" id="support-form"><label class="sr-only" for="support-input">${this.t('supportPlaceholder')}</label><input id="support-input" name="message" maxlength="600" autocomplete="off" placeholder="${this.t('supportPlaceholder')}" ${this.supportLoading ? 'disabled' : ''}><button type="submit" aria-label="${this.t('send')}" ${this.supportLoading ? 'disabled' : ''}><span aria-hidden="true">↑</span></button></form>
        <p class="support-note">${this.t('supportScope')}</p>
      </section>
    </aside>`;
  },
  supportMessageMarkup(message) {
    const safe = this.escape(message.text).replace(/\n/g, '<br>');
    return `<div class="support-message ${message.role === 'user' ? 'user' : 'assistant'}"><span>${safe}</span></div>`;
  },
  supportTypingMarkup() {
    return `<div class="support-message assistant support-typing" role="status"><span>${this.t('supportThinking')}</span></div>`;
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
    this.renderSupportConversation();
    try {
      const reply = await requestSupportReply(this.supportMessages, this.lang, this.view || 'landing');
      this.supportMessages.push({ role: 'assistant', text: reply });
    } catch (error) {
      this.supportMessages.push({ role: 'assistant', text: this.t(error.code === 'NOT_CONFIGURED' ? 'supportNotConfigured' : 'supportError') });
    } finally {
      this.supportLoading = false;
      this.supportMessages = this.supportMessages.slice(-20);
      this.renderSupportConversation();
      this.querySelector('#support-input')?.focus();
    }
  },
};
