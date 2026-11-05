// Unified loading system for PARADOX AI — EduDefend.OS
// Uses CSS-animated 12-bar spinner (vendor/loading.css).
// API: showLoading(options) / hideLoading() / setLoadingText(text)
// Modes: 'inline', 'section', 'fullscreen', 'chat'

(function (global) {
  'use strict';

  const SPINNER_CLASS = 'loading-spinner';
  let fullscreenEl = null;
  let fullscreenCount = 0;

  function createSpinner(size = 'md') {
    const spinner = document.createElement('div');
    spinner.className = SPINNER_CLASS;
    spinner.dataset.size = size;
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Loading');
    spinner.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 12; i++) {
      const bar = document.createElement('span');
      bar.className = 'bar';
      spinner.appendChild(bar);
    }
    return spinner;
  }

  function createTextEl(text) {
    const el = document.createElement('span');
    el.className = 'loading-text';
    el.textContent = text || 'Đang tải…';
    return el;
  }

  // Inline loading (next to button or text)
  function showInline(container, text, opts = {}) {
    if (!container) return null;
    const existing = container.querySelector('.loading-inline');
    if (existing) { setLoadingText(existing.querySelector('.loading-text'), text); return existing; }
    const size = opts.size || 'sm';
    const wrap = document.createElement('span');
    wrap.className = 'loading-inline';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Loading');
    wrap.appendChild(createSpinner(size));
    wrap.appendChild(createTextEl(text));
    container.appendChild(wrap);
    return wrap;
  }

  function hideInline(container) {
    if (!container) return;
    const el = container.querySelector('.loading-inline');
    if (el) el.remove();
  }

  // Section loading (center of a content area)
  function showSection(container, text, opts = {}) {
    if (!container) return null;
    const existing = container.querySelector('.loading-section');
    if (existing) { setLoadingText(existing.querySelector('.loading-text'), text); return existing; }
    const size = opts.size || 'lg';
    const wrap = document.createElement('div');
    wrap.className = 'loading-section';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Loading');
    wrap.appendChild(createSpinner(size));
    wrap.appendChild(createTextEl(text));
    container.appendChild(wrap);
    return wrap;
  }

  function hideSection(container) {
    if (!container) return;
    const el = container.querySelector('.loading-section');
    if (el) el.remove();
  }

  // Fullscreen loading (blocking overlay)
  function showFullscreen(text, opts = {}) {
    if (fullscreenEl) {
      fullscreenCount++;
      setLoadingText(fullscreenEl.querySelector('.loading-text'), text);
      return fullscreenEl;
    }
    const size = opts.size || 'xl';
    const wrap = document.createElement('div');
    wrap.className = 'loading-fullscreen';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Loading');
    wrap.appendChild(createSpinner(size));
    wrap.appendChild(createTextEl(text));
    document.body.appendChild(wrap);
    fullscreenEl = wrap;
    fullscreenCount = 1;
    return wrap;
  }

  function hideFullscreen() {
    if (!fullscreenEl) return;
    fullscreenCount--;
    if (fullscreenCount <= 0) {
      fullscreenEl.remove();
      fullscreenEl = null;
      fullscreenCount = 0;
    }
  }

  // Chat loading (inside chat area, not fullscreen)
  function showChat(container, text, opts = {}) {
    if (!container) return null;
    const existing = container.querySelector('.loading-chat');
    if (existing) { setLoadingText(existing.querySelector('.loading-text'), text); return existing; }
    const size = opts.size || 'sm';
    const wrap = document.createElement('div');
    wrap.className = 'loading-chat';
    wrap.setAttribute('role', 'status');
    wrap.setAttribute('aria-label', 'Loading');
    wrap.appendChild(createSpinner(size));
    wrap.appendChild(createTextEl(text));
    container.appendChild(wrap);
    return wrap;
  }

  function hideChat(container) {
    if (!container) return;
    const el = container.querySelector('.loading-chat');
    if (el) el.remove();
  }

  function setLoadingText(el, text) {
    if (!el) return;
    const textEl = el.classList && el.classList.contains('loading-text') ? el : el.querySelector('.loading-text');
    if (textEl) textEl.textContent = text || 'Đang tải…';
  }

  // Expose globally
  global.loadingUI = {
    showInline,
    hideInline,
    showSection,
    hideSection,
    showFullscreen,
    hideFullscreen,
    showChat,
    hideChat,
    setLoadingText,
  };
})(window);
