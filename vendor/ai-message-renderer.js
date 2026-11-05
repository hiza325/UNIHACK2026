// AI message renderer: Markdown + LaTeX (KaTeX) for vanilla JS.
// Uses vendored marked.js and KaTeX. No dangerouslySetInnerHTML in component code;
// rendering is done via DOM APIs after sanitization.
(function (global) {
  'use strict';

  const markedLib = global.marked;
  const katexLib = global.katex;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function unescapeHtml(str) {
    return String(str)
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Extract math expressions and replace with placeholders.
  function extractMath(text) {
    const math = [];
    let counter = 0;
    // Block math: $$...$$ (may span newlines)
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, function (_, latex) {
      const ph = '@@MATHBLOCK_' + counter + '@@';
      math.push({ type: 'block', latex: latex.trim(), placeholder: ph });
      counter++;
      return ph;
    });
    // Inline math: $...$ (not $$, single line, at least one non-space char)
    text = text.replace(/\$([^\$\n]+?)\$/g, function (_, latex) {
      const trimmed = latex.trim();
      if (!trimmed) return '$' + latex + '$';
      const ph = '@@MATHINLINE_' + counter + '@@';
      math.push({ type: 'inline', latex: trimmed, placeholder: ph });
      counter++;
      return ph;
    });
    return { text: text, math: math };
  }

  function renderMath(latex, displayMode) {
    if (!katexLib) return escapeHtml(latex);
    try {
      return katexLib.renderToString(latex, {
        displayMode: displayMode,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      });
    } catch (e) {
      return '<span class="math-error">' + escapeHtml(latex) + '</span>';
    }
  }

  function sanitizeHtml(html) {
    if (!html) return '';
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const allowedTags = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'code', 'pre', 'blockquote', 'a', 'span', 'div', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'ins', 'sub', 'sup']);
      const allowedAttrs = new Set(['class', 'href', 'title', 'target', 'rel']);

      function cleanNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }
        const tag = node.tagName.toLowerCase();
        if (!allowedTags.has(tag)) {
          const text = document.createTextNode(node.textContent);
          node.parentNode.replaceChild(text, node);
          return;
        }
        for (const attr of [...node.attributes]) {
          const name = attr.name.toLowerCase();
          if (!allowedAttrs.has(name) || name.startsWith('on')) {
            node.removeAttribute(attr.name);
          }
        }
        if (node.hasAttribute('href')) {
          const href = node.getAttribute('href');
          if (!href.match(/^https?:\/\//i) && !href.match(/^#/)) {
            node.removeAttribute('href');
          }
        }
        for (const child of [...node.childNodes]) {
          cleanNode(child);
        }
      }

      for (const child of [...doc.body.childNodes]) {
        cleanNode(child);
      }
      return doc.body.innerHTML;
    } catch (e) {
      return escapeHtml(html);
    }
  }

  function renderMarkdown(text) {
    if (!markedLib) {
      return escapeHtml(text).replace(/\n/g, '<br>');
    }
    try {
      markedLib.setOptions({
        gfm: true,
        breaks: true,
        headerIds: false,
        mangle: false,
      });
      const raw = markedLib.parse(text);
      return sanitizeHtml(raw);
    } catch (e) {
      return escapeHtml(text).replace(/\n/g, '<br>');
    }
  }

  function renderAIMessage(text) {
    if (text == null) return '';
    let raw = String(text);

    // Backwards compat: if content looks already escaped, unescape first
    if (raw.includes('&amp;') || raw.includes('&lt;') || raw.includes('&gt;')) {
      raw = unescapeHtml(raw);
    }

    // Step 1: extract math expressions
    const extracted = extractMath(raw);

    // Step 2: render markdown on text with placeholders
    let html = renderMarkdown(extracted.text);

    // Step 3: restore math placeholders with KaTeX-rendered HTML
    for (const m of extracted.math) {
      const rendered = renderMath(m.latex, m.type === 'block');
      html = html.split(m.placeholder).join(rendered);
    }

    // Step 4: final safety — remove any script/event handlers
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

    return html;
  }

  global.renderAIMessage = renderAIMessage;
  global.escapeHtml = escapeHtml;
  global.unescapeHtml = unescapeHtml;
})(window);