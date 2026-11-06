// Async CSS loader - CSP compatible
(function() {
  'use strict';
  function loadAsyncCSS() {
    document.querySelectorAll('link[rel="stylesheet"][media="print"]').forEach(function(link) {
      link.media = 'all';
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAsyncCSS);
  } else {
    loadAsyncCSS();
  }
})();
