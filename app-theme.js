import { svgIcon } from './icons.js';

export const themeMethods = {
  themeToggleMarkup(extraClass = '') {
    const dark = document.body.classList.contains('dark');
    const label = this.t(dark ? 'themeToLight' : 'themeToDark');
    return `<button class="icon-button theme-toggle ${extraClass}" type="button" data-theme-toggle aria-label="${label}" title="${label}" aria-pressed="${dark}">${svgIcon(dark ? 'sun' : 'moon')}</button>`;
  },
  applyTheme(dark, persist = true) {
    document.body.classList.toggle('dark', dark);
    if (persist) localStorage.setItem('paradox-theme', dark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151b18' : '#f6f7f3');
    this.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      const label = this.t(dark ? 'themeToLight' : 'themeToDark');
      btn.innerHTML = svgIcon(dark ? 'sun' : 'moon');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-pressed', String(dark));
    });
    this.querySelectorAll('[data-set-theme]').forEach(btn => {
      const active = btn.dataset.setTheme === (dark ? 'dark' : 'light');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  },
  toggleTheme() { this.applyTheme(!document.body.classList.contains('dark')); },
  applyStoredTheme() { this.applyTheme(localStorage.getItem('paradox-theme') === 'dark', false); },
};
