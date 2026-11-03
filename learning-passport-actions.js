import { createLearningPassportService, getCredentialVerificationState, isCertificateCode } from './learning-passport-service.js';
import { mountCertificatePreview } from './certificate-renderer.js';

export const learningPassportActionMethods = {
  configureLearningPassportService() {
    const runtime = globalThis.PARADOX_LEARNING_PASSPORT_CONFIG || {};
    const mode = runtime.mode === 'api' || (runtime.mode !== 'mock' && this.authProvider === 'remote') ? 'api' : 'mock';
    this.learningPassportService = createLearningPassportService({ mode, apiBaseUrl: runtime.apiBaseUrl || '/api' });
    this.passportSnapshot = null;
    this.passportLoading = false;
    this.passportLoadAttempted = false;
    this.passportError = '';
  },
  getLearningPassportSnapshot() {
    if (this.learningPassportService.mode === 'mock') return this.learningPassportService.getSnapshot(this.user, this.lang);
    return this.passportSnapshot;
  },
  async loadLearningPassportSnapshot({ force = false } = {}) {
    if (this.learningPassportService.mode !== 'api' || this.passportLoading || (this.passportLoadAttempted && !force)) return;
    this.passportLoading = true;
    this.passportLoadAttempted = true;
    this.passportError = '';
    if (['dashboard', 'profile', 'passport'].includes(this.view)) this.render();
    try {
      const passport = await this.learningPassportService.fetchPassport();
      if (!passport?.source?.isReal || !Array.isArray(passport.skills) || !Array.isArray(passport.assessments) || !Array.isArray(passport.credentials)) {
        throw new Error('Invalid Learning Passport response');
      }
      this.passportSnapshot = passport;
    } catch (error) {
      this.passportError = error.message || 'Learning Passport API unavailable';
    } finally {
      this.passportLoading = false;
      if (['dashboard', 'profile', 'passport'].includes(this.view)) this.render();
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
    const preview = document.createElement('section');
    preview.setAttribute('data-certificate-preview', '');
    preview.setAttribute('aria-live', 'polite');
    modal.querySelector('.passport-detail-actions').before(preview);
    void mountCertificatePreview(preview, this.user, credential);
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
    this.passportVerificationState = this.passportVerificationResult ? 'demo' : 'idle';
    this.passportVerificationErrorCode = '';
    this.closePassportCredential();
    this.navigate('verify');
    if (normalized && this.learningPassportService.mode === 'api') this.lookupPassportCredential(normalized);
  },
  async searchPassportCredential(form) {
    const input = form.elements.certificateCode;
    const value = String(new FormData(form).get('certificateCode') || '').trim().toUpperCase().slice(0, 80);
    if (!isCertificateCode(value)) {
      input?.setCustomValidity(this.t('passportInvalidCode'));
      input?.reportValidity();
      input?.focus();
      return;
    }
    input?.setCustomValidity('');
    this.passportVerificationQuery = value;
    this.passportVerificationSearched = true;
    if (this.learningPassportService.mode === 'api') {
      await this.lookupPassportCredential(value);
      return;
    }
    this.passportVerificationResult = value ? this.findLearningPassportCredential(value) : null;
    this.passportVerificationState = this.passportVerificationResult ? 'demo' : 'not-found';
    this.passportVerificationErrorCode = '';
    this.render();
    requestAnimationFrame(() => this.querySelector('#passport-verification-result, #passport-verification-state')?.focus());
  },
  async lookupPassportCredential(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!isCertificateCode(normalized)) return;
    this.passportVerificationQuery = normalized;
    this.passportVerificationState = 'checking';
    this.passportVerificationErrorCode = '';
    this.passportVerificationSearched = true;
    this.render();
    try {
      this.passportVerificationResult = await this.learningPassportService.verifyCredential(normalized);
      this.passportVerificationState = getCredentialVerificationState(this.passportVerificationResult);
    } catch (error) {
      this.passportVerificationResult = null;
      this.passportVerificationState = error.status === 404 ? 'not-found' : 'network-error';
      this.passportVerificationErrorCode = String(error.code || 'PASSPORT_VERIFY_ERROR');
    } finally {
      if (this.view === 'verify') this.render();
      requestAnimationFrame(() => this.querySelector('#passport-verification-result, #passport-verification-state')?.focus());
    }
  },
};
