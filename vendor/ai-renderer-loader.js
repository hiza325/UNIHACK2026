// Lazy loader for AI message rendering (marked.js + KaTeX)
// Loads dependencies on demand to reduce initial page load cost.
(function (global) {
  'use strict';

  let loadPromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(script);
    });
  }

  function loadCSS(href) {
    return new Promise(function (resolve) {
      if (document.querySelector('link[href="' + href + '"]')) {
        resolve();
        return;
      }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = function () { resolve(); };
      link.onerror = function () { resolve(); };
      document.head.appendChild(link);
    });
  }

  global.loadAIRenderer = function () {
    if (loadPromise) return loadPromise;
    if (typeof global.renderAIMessage === 'function') {
      loadPromise = Promise.resolve();
      return loadPromise;
    }
    loadPromise = Promise.all([
      loadScript('vendor/marked.min.js'),
      loadScript('vendor/katex/katex.min.js'),
      loadCSS('vendor/katex/katex.min.css'),
    ]).then(function () {
      return loadScript('vendor/ai-message-renderer.js');
    }).catch(function (err) {
      console.warn('AI renderer load failed:', err);
      loadPromise = null;
      throw err;
    });
    return loadPromise;
  };

  global.ensureAIRenderer = function () {
    if (typeof global.renderAIMessage === 'function') return Promise.resolve();
    return global.loadAIRenderer();
  };
})(window);
