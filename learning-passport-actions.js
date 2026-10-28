import { createLearningPassportService } from './learning-passport-service.js';

export const learningPassportActionMethods = {
  configureLearningPassportService() {
    const runtime = globalThis.PARADOX_LEARNING_PASSPORT_CONFIG || {};
    const mode = runtime.mode === 'api' || (runtime.mode !== 'mock' && this.authProvider === 'remote') ? 'api' : 'mock';
    this.learningPassportService = createLearningPassportService({ mode, apiBaseUrl: runtime.apiBaseUrl || '/api' });
    this.passportSnapshot = null;
    this.passportLoadAttempted = false;
    this.passportError = '';
  },
  getLearningPassportSnapshot() {
    return this.passportSnapshot || this.learningPassportService.getSnapshot(this.user, this.lang);
  },
  async loadLearningPassportSnapshot({ force = false } = {}) {
    if (this.learningPassportService.mode !== 'api' || this.passportLoading || (this.passportLoadAttempted && !force)) return;
    this.passportLoading = true;
    this.passportLoadAttempted = true;
    this.passportError = '';
    try {
      const passport = await this.learningPassportService.fetchPassport();
      if (!passport?.source?.isReal || !Array.isArray(passport.credentials)) throw new Error('Invalid Learning Passport response');
      this.passportSnapshot = passport;
    } catch (error) {
      this.passportError = error.message || 'Learning Passport API unavailable';
    } finally {
      this.passportLoading = false;
      if (this.view === 'passport') this.render();
    }
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
    this.passportVerificationResult = this.learningPassportService.mode === 'mock' && normalized ? this.findLearningPassportCredential(normalized) : null;
    this.passportVerificationSearched = false;
    this.closePassportCredential();
    this.navigate('verify');
    if (normalized && this.learningPassportService.mode === 'api') this.lookupPassportCredential(normalized);
  },
  async searchPassportCredential(form) {
    const value = String(new FormData(form).get('certificateCode') || '').trim().toUpperCase().slice(0, 64);
    this.passportVerificationQuery = value;
    this.passportVerificationSearched = true;
    if (this.learningPassportService.mode === 'api') {
      await this.lookupPassportCredential(value);
      return;
    }
    this.passportVerificationResult = value ? this.findLearningPassportCredential(value) : null;
    this.render();
    requestAnimationFrame(() => this.querySelector('#passport-verification-result, #passport-verify-empty')?.focus());
  },
  async lookupPassportCredential(code) {
    this.passportLoading = true;
    this.passportError = '';
    this.passportVerificationSearched = true;
    this.render();
    try {
      this.passportVerificationResult = await this.learningPassportService.verifyCredential(code);
    } catch (error) {
      this.passportVerificationResult = null;
      if (error.status !== 404) this.passportError = error.message || 'Credential verification unavailable';
    } finally {
      this.passportLoading = false;
      if (this.view === 'verify') this.render();
      requestAnimationFrame(() => this.querySelector('#passport-verification-result, #passport-verify-empty')?.focus());
    }
  },
};
