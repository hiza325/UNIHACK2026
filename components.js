export function defineComponents(EduApp) {
  if (!customElements.get('edu-app')) customElements.define('edu-app', EduApp);
  if (!customElements.get('audit-stepper')) customElements.define('audit-stepper', class extends HTMLElement {});
  if (!customElements.get('audit-message')) customElements.define('audit-message', class extends HTMLElement {});
}
