export const learningPassportActionMethods = {
  getLearningPassportSnapshot() {
    return this.learningPassportService.getSnapshot(this.user, this.lang);
  },
  findLearningPassportCredential(code) {
    return this.learningPassportService.findCredential(this.getLearningPassportSnapshot(), code);
  },
  openPassportCredential(code) {
    const credential = this.findLearningPassportCredential(code);
    const modal = this.querySelector('#passport-detail-modal');
    if (!credential || !modal) return;
    this.passportSelectedCredentialCode = credential.code;
    modal.innerHTML = this.passportCredentialDetailMarkup(credential);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('[data-close-passport-detail]')?.focus();
  },
  closePassportCredential() {
    const modal = this.querySelector('#passport-detail-modal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    const code = this.passportSelectedCredentialCode;
    this.passportSelectedCredentialCode = '';
    if (code) this.querySelector(`[data-certificate-details="${code}"]`)?.focus();
  },
  openPassportVerification(code = '') {
    const normalized = String(code || '').trim().toUpperCase();
    this.passportVerificationQuery = normalized;
    this.passportVerificationResult = normalized ? this.findLearningPassportCredential(normalized) : null;
    this.closePassportCredential();
    this.navigate('verify');
  },
  searchPassportCredential(form) {
    const value = String(new FormData(form).get('certificateCode') || '').trim().toUpperCase().slice(0, 64);
    this.passportVerificationQuery = value;
    this.passportVerificationSearched = true;
    this.passportVerificationResult = value && this.findLearningPassportCredential(value);
    this.render();
    requestAnimationFrame(() => this.querySelector('#passport-verification-result, #passport-verify-empty')?.focus());
  },
};
