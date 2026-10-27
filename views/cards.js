/* cards views — extracted from app-views.js. Methods are merged into viewMethods. */
export const cardViews = {
  learningMetricCards(metrics) {
    const dayUnit = this.lang === 'en' ? 'DAYS' : this.lang === 'jp' ? '日' : 'NGÀY';
    return `<div class="right-duo">${this.metricCard(this.t('accuracy'), metrics.accuracy, '%', this.t('accuracyDesc'), 'spark')}${this.metricCard(this.t('streak'), String(metrics.streak).padStart(2, '0'), dayUnit, this.t('streakDesc'), 'check')}</div>`;
  },
  sourceCard() {
    const items = [['◉', 'source1', 'source1type'], ['ƒ', 'source2', 'source2type'], ['⌘', 'source3', 'source3type']];
    return `<section class="card source-card"><div class="source-head"><h3 class="source-title">${this.t('sources')}</h3><button class="source-link" data-route="about">${this.t('viewAll')}</button></div>${items.map(([icon, name, type]) => `<div class="source-item"><span class="source-icon" aria-hidden="true">${icon}</span><div><div class="source-name">${this.t(name)}</div><div class="source-type">${this.t(type)}</div></div></div>`).join('')}</section>`;
  },
  activityCard() {
    return `<section class="card activity-card"><div class="activity-head"><h3 class="activity-title">${this.t('progress')}</h3><span class="activity-week">${this.t('thisWeek')}</span></div>${this.weeklyChartMarkup()}</section>`;
  },
  barChartMarkup(series, labels, { title, chartClass = 'chart', labelsClass = 'chart-labels' } = {}) {
    const maxValue = Math.max(...series.values);
    const accessibleLabel = `${title}: ${series.values.join(', ')} min`;
    const bars = series.heights.map((height, i) => `<div class="bar-wrap" aria-hidden="true"><span class="bar ${series.values[i] === maxValue && maxValue ? 'hot' : ''}" style="height:${height}%" title="${series.values[i]} min"></span></div>`).join('');
    const rows = labels.map((label, i) => `<tr><th scope="row">${this.escape(String(label))}</th><td>${series.values[i]} min</td></tr>`).join('');
    const labelSpans = labels.map(label => `<span>${this.escape(String(label))}</span>`).join('');
    return `<div class="${chartClass}" role="img" aria-label="${this.escape(accessibleLabel)}">${bars}</div><table class="sr-only"><caption>${this.escape(title)}</caption><tbody>${rows}</tbody></table><div class="${labelsClass}" aria-hidden="true">${labelSpans}</div>`;
  },
  weeklyChartMarkup() {
    return this.barChartMarkup(this.activitySeries(7), ['M', 'T', 'W', 'T', 'F', 'S', 'S'], { title: this.t('progress') });
  },
  auditStepsMarkup() {
    return this.t('stepLabels').map((label, index) => `<div class="step ${index < this.step ? 'done' : ''} ${index === this.step ? 'active' : ''}" role="listitem" ${index === this.step ? 'aria-current="step"' : ''}><span class="step-num" aria-hidden="true">${index < this.step ? '✓' : index + 1}</span><span class="step-name">${label}</span></div>`).join('');
  },
  sessionRow(s, compact = false) {
    const statusKey = 'status' + s.status.charAt(0).toUpperCase() + s.status.slice(1);
    return `<div class="session-row ${compact ? 'compact' : ''}" data-session-status="${s.status}" data-session-subject="${this.escape(s.skill)}" data-session-date="${this.escape(this.sessionISODate(s))}" data-search="${this.escape((s.title + ' ' + s.skill).toLowerCase())}">
      <div class="session-main"><span class="session-title">${this.escape(s.title)}</span><span class="session-date">${s.date} · ${this.escape(s.skill)}</span></div>
      ${compact ? '' : `<span class="session-skill">${this.escape(s.skill)}</span>`}
      <span class="session-score">${s.score}<small>/100</small></span>
      <span class="status ${s.status}">${this.t(statusKey)}</span>
      <button class="row-action" data-route="audit">${this.t('histOpen')} ↗</button>
    </div>`;
  },
  formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  },
  fileSelectionMarkup(type) {
    const file = this.files[type][0];
    if (!file) return '';
    const extension = file.name.split('.').pop()?.toUpperCase() || 'FILE';
    return `<div class="file-selected"><div class="file-chip"><span class="file-chip-type">${this.escape(extension)}</span><span class="file-chip-copy"><strong>${this.escape(file.name)}</strong><small>${this.formatBytes(file.size)}</small></span><button type="button" data-remove-file="${type}" aria-label="${this.t('fileRemove')}"><span aria-hidden="true">×</span></button></div><div class="file-preview" data-file-preview="${type}" aria-label="${this.t('filePreview')}"></div></div>`;
  },
  fileControl(type, title, meta) {
    return `<div class="file-field"><label class="file-drop" for="file-${type}"><span class="file-symbol">${type === 'problem' ? '▧' : '▤'}</span><span><span class="file-title">${title}</span><span class="file-meta">${meta} · MAX 10 MB</span></span><span class="file-plus">＋</span><input class="file-input" type="file" id="file-${type}" data-file="${type}" accept="image/*,.pdf,.doc,.docx,.txt,.js,.py" /></label>${this.fileSelectionMarkup(type)}</div>`;
  },
  auditMessagesMarkup() {
    const greeting = `<audit-message class="message"><span class="message-icon">✳</span><div class="bubble">${this.t('greeting')}<div style="margin-top:7px">${this.t('greetingPrompt')}</div><div class="message-time">${this.t('timeNow')}</div></div></audit-message>`;
    const saved = this.auditMessages.map(item => {
      const initials = (this.user?.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
      return `<audit-message class="message ${item.user ? 'user' : ''}"><span class="message-icon">${item.user ? this.escape(initials) : '✳'}</span><div class="bubble">${item.html}<div class="message-time">${this.t('timeNow')}</div></div></audit-message>`;
    }).join('');
    return greeting + saved + (this.isAnalyzing ? this.typingMarkup() : '');
  },
  typingMarkup() {
    return `<div class="typing-indicator" id="typing-indicator" role="status"><span class="agent-orb">✳</span><span class="typing-dots"><i></i><i></i><i></i></span><span>${this.t('analyzing')}</span></div>`;
  },
};
