/* settings views — extracted from app-views.js. Methods are merged into viewMethods. */
import { svgIcon } from '../icons.js';
export const settingsViews = {
  viewSettings() {
    const t = k => this.t(k);
    const dark = document.body.classList.contains('dark');
    const langs = [['vi', 'VI'], ['en', 'EN'], ['jp', 'JP']].map(([code, label]) => `<button class="${this.lang === code ? 'active' : ''}" data-set-lang="${code}" aria-pressed="${this.lang === code}">${label}</button>`).join('');
    const subjects = [['math', 'setSubjectMath'], ['algebra', 'setSubjectAlgebra'], ['code', 'setSubjectCode']].map(([value, key]) => `<option value="${value}" ${this.settings.subject === value ? 'selected' : ''}>${t(key)}</option>`).join('');
    const hint = this.settings.hint || 2;
    const toggle = (key, title, desc) => `<div class="setting-row"><div><h3>${t(title)}</h3><p>${t(desc)}</p></div><label class="switch"><input type="checkbox" data-setting="${key}" aria-label="${t(title)}" ${this.settings[key] ? 'checked' : ''}><span></span></label></div>`;
    return `<div class="page">
      ${this.viewHead(t('pageSettings'), 'setSub')}
      <div class="settings-grid">
        <section class="card setting-group"><div class="panel-head"><h2 class="panel-title">${t('setAppearance')}</h2></div>
          <div class="setting-row"><div><h3>${t('setTheme')}</h3></div><div class="segmented"><button class="${dark ? '' : 'active'}" data-set-theme="light" aria-pressed="${!dark}">${t('setLight')}</button><button class="${dark ? 'active' : ''}" data-set-theme="dark" aria-pressed="${dark}">${t('setDark')}</button></div></div>
          <div class="setting-row"><div><h3>${t('setLanguage')}</h3></div><div class="segmented">${langs}</div></div>
        </section>
        <section class="card setting-group"><div class="panel-head"><h2 class="panel-title">${t('setLearning')}</h2></div>
          <div class="setting-row"><div><h3>${t('setSubject')}</h3></div><select id="default-subject" aria-label="${t('setSubject')}">${subjects}</select></div>
          <div class="setting-row"><div><h3>${t('setHint')}</h3></div><div class="hint-control"><input id="hint-level" type="range" min="1" max="3" value="${hint}" aria-label="${t('setHint')}"><span id="hint-value">${[t('setHintLow'), t('setHintMed'), t('setHintHigh')][hint - 1]}</span></div></div>
        </section>
        <section class="card setting-group"><div class="panel-head"><h2 class="panel-title">${t('setNotify')}</h2></div>
          ${toggle('reminder', 'setReminder', 'setReminderDesc')}
          ${toggle('digest', 'setDigest', 'setDigestDesc')}
          ${toggle('sound', 'setSound', 'setSoundDesc')}
        </section>
        <section class="card setting-group"><div class="panel-head"><h2 class="panel-title">${t('setPrivacy')}</h2></div>
          <div class="setting-row"><div><h3>${t('setExport')}</h3><p>${t('setExportDesc')}</p></div><button class="ghost-button" id="export-data">${svgIcon('download')} ${t('setExport')}</button></div>
          <div class="setting-row"><div><h3>${t('setReset')}</h3><p>${t('setResetDesc')}</p></div><button class="ghost-button" id="reset-data">${svgIcon('trash')} ${t('setReset')}</button></div>
          <div class="setting-row"><div><h3>${t('setDelete')}</h3><p>${t('setDeleteDesc')}</p></div><button class="ghost-button" id="delete-account">${t('setDelete')}</button></div>
        </section>
        <section class="card setting-group"><div class="panel-head"><h2 class="panel-title">${t('setAbout')}</h2></div>
          <div class="setting-row"><div><h3>${t('setVersion')}</h3></div></div>
          <div class="setting-row"><div><h3>${t('setOpenSitemap')}</h3><p>${t('setSitemapDesc')}</p></div><button class="ghost-button" data-route="sitemap" aria-label="${t('setOpenSitemap')}">${svgIcon('grid')}</button></div>
        </section>
      </div>
      <div class="confirm-backdrop" id="reset-modal" hidden><section class="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="reset-title"><span class="badge-icon">${svgIcon('trash')}</span><h2 id="reset-title">${t('setResetTitle')}</h2><p>${t('setConfirmReset')}</p><div class="confirm-actions"><button class="ghost-button" data-cancel-reset>${t('profCancel')}</button><button class="danger-button" data-confirm-reset>${t('setResetConfirm')}</button></div></section></div>
    </div>`;
  },
};
