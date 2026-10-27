export const notificationMethods = {
  async testNotification() {
    if (!('Notification' in window)) {
      this.showToast(this.t('notifyUnsupported'));
      return false;
    }

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      this.showToast(this.t('notifyDenied'));
      return false;
    }

    try {
      new Notification(this.t('notifyTestTitle'), {
        body: this.t('notifyTestBody'),
        icon: 'logo-mark.svg',
        badge: 'logo-mark.svg',
        tag: 'paradox-notification-test'
      });
      if (this.settings.sound) this.playCompletionSound();
      this.showToast(this.t('notifySent'));
      return true;
    } catch {
      this.showToast(this.t('notifyUnsupported'));
      return false;
    }
  },
  playCompletionSound() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;
    try {
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.21);
      oscillator.addEventListener('ended', () => context.close(), { once: true });
      return true;
    } catch {
      return false;
    }
  },
};
