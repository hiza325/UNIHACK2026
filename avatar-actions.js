import { svgIcon } from './icons.js';

const messages = {
  vi: { change: 'Thay đổi ảnh đại diện', title: 'Ảnh đại diện', choose: 'Chọn ảnh', save: 'Lưu ảnh', cancel: 'Hủy', remove: 'Xóa avatar', zoom: 'Thu phóng', x: 'Căn ngang', y: 'Căn dọc', hint: 'JPG, PNG hoặc WebP · tối đa 5 MB. Kéo ảnh hoặc dùng thanh trượt để cắt vuông 1:1.', loading: 'Đang tải ảnh…', saving: 'Đang lưu ảnh…', success: 'Đã lưu ảnh đại diện', removed: 'Đã xóa ảnh đại diện', invalid: 'Ảnh không hợp lệ. Hãy chọn JPG, PNG hoặc WebP.', large: 'Ảnh vượt quá 5 MB.', error: 'Không thể xử lý ảnh. Vui lòng thử lại.', auth: 'Hãy đăng nhập bằng tài khoản thật hoặc Local Auth để lưu ảnh.', rate: 'Bạn thay đổi ảnh quá thường xuyên. Vui lòng thử lại sau 10 phút.', unavailable: 'Storage avatar chưa được cấu hình.', deferred: 'Đã cập nhật avatar. Ảnh cũ đang chờ dọn dẹp trên storage.', retry: 'Thử lại' },
  en: { change: 'Change profile picture', title: 'Profile picture', choose: 'Choose image', save: 'Save image', cancel: 'Cancel', remove: 'Remove avatar', zoom: 'Zoom', x: 'Horizontal position', y: 'Vertical position', hint: 'JPG, PNG or WebP · up to 5 MB. Drag or use the sliders for a square 1:1 crop.', loading: 'Loading image…', saving: 'Saving image…', success: 'Profile picture saved', removed: 'Profile picture removed', invalid: 'Invalid image. Choose JPG, PNG or WebP.', large: 'Image exceeds 5 MB.', error: 'Could not process the image. Please try again.', auth: 'Sign in with a real account or Local Auth to save an avatar.', rate: 'Too many changes. Please try again in 10 minutes.', unavailable: 'Avatar storage is not configured.', deferred: 'Avatar updated. The old image is awaiting storage cleanup.', retry: 'Retry' },
  jp: { change: 'プロフィール画像を変更', title: 'プロフィール画像', choose: '画像を選択', save: '画像を保存', cancel: 'キャンセル', remove: '画像を削除', zoom: 'ズーム', x: '水平位置', y: '垂直位置', hint: 'JPG・PNG・WebP、最大5 MB。ドラッグまたはスライダーで1:1に調整できます。', loading: '画像を読み込み中…', saving: '保存中…', success: '画像を保存しました', removed: '画像を削除しました', invalid: 'JPG・PNG・WebPの画像を選択してください。', large: '画像が5 MBを超えています。', error: '画像を処理できませんでした。再試行してください。', auth: '保存するにはアカウントまたはLocal Authでログインしてください。', rate: '変更回数が多すぎます。10分後に再試行してください。', unavailable: '画像ストレージが設定されていません。', deferred: '更新しました。古い画像は削除待ちです。', retry: '再試行' },
};

export const avatarMethods = {
  avatarText(key) { return (messages[this.lang] || messages.vi)[key]; },
  avatarEndpoint() {
    if (this.authProvider === 'remote') return '/api/auth/session?avatar=meta';
    if (localStorage.getItem('paradox-local-server') === '1') return '/api/auth/local?avatar=meta';
    return null;
  },
  avatarMarkup(extraClass = '') {
    const initials = this.avatarInitials();
    return `<span class="avatar user-avatar ${extraClass}" data-user-avatar aria-hidden="true"><span class="avatar-initials" ${this.avatarUrl ? 'hidden' : ''}>${this.escape(initials)}</span>${this.avatarUrl ? `<img src="${this.escape(this.avatarUrl)}" alt="" referrerpolicy="same-origin">` : ''}</span>`;
  },
  avatarInitials() {
    return (this.user?.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  },
  syncAvatarDom() {
    this.querySelectorAll('[data-user-avatar]').forEach(node => {
      const extra = [...node.classList].filter(name => !['avatar', 'user-avatar'].includes(name)).join(' ');
      node.outerHTML = this.avatarMarkup(extra);
    });
    this.syncAvatarControls();
    this.bindAvatarImages();
  },
  syncAvatarControls() {
    this.querySelectorAll('[data-avatar-remove]').forEach(button => {
      button.hidden = !this.avatarUrl && !this.avatarCleanupPending;
      button.textContent = this.avatarText(this.avatarUrl ? 'remove' : 'retry');
    });
  },
  bindAvatarImages() {
    this.querySelectorAll('[data-user-avatar] img').forEach(image => {
      image.addEventListener('error', () => { image.hidden = true; image.previousElementSibling.hidden = false; }, { once: true });
    });
  },
  async loadAvatar() {
    const endpoint = this.avatarEndpoint();
    const owner = this.user;
    this.avatarUrl = null;
    this.avatarCleanupPending = false;
    this.avatarLoadError = '';
    if (!owner || !endpoint) { this.syncAvatarDom(); return; }
    try {
      const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.code);
      if (this.user !== owner) return;
      this.avatarUrl = this.safeAvatarUrl(data.avatarUrl);
      this.avatarCleanupPending = Boolean(data.cleanupPending);
    } catch (error) {
      if (this.user !== owner) return;
      this.avatarLoadError = error.message === 'AVATAR_NOT_CONFIGURED' ? this.avatarText('unavailable') : this.avatarText('error');
    }
    this.syncAvatarDom();
  },
  safeAvatarUrl(url) {
    return typeof url === 'string' && /^\/api\/auth\/(local|session)\?avatar=image&v=[a-z0-9%.\-]+$/i.test(url) ? url : null;
  },
  bindAvatar() {
    this.bindAvatarImages();
    this.syncAvatarControls();
    const input = this.querySelector('[data-avatar-file]');
    this.querySelector('[data-avatar-change]')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => { const file = input.files?.[0]; input.value = ''; if (file) this.openAvatarEditor(file); });
    this.querySelector('[data-avatar-remove]')?.addEventListener('click', () => this.removeAvatar());
    this.querySelector('[data-avatar-reload]')?.addEventListener('click', async () => {
      await this.loadAvatar();
      const status = this.querySelector('[data-avatar-status]');
      if (status) status.textContent = this.avatarLoadError || '';
    });
  },
  avatarErrorText(code) {
    return this.avatarText(({ AVATAR_TOO_LARGE: 'large', AVATAR_INVALID_TYPE: 'invalid', AVATAR_INVALID_IMAGE: 'invalid', AVATAR_RATE_LIMITED: 'rate', AVATAR_NOT_CONFIGURED: 'unavailable', SESSION_INVALID: 'auth' })[code] || 'error');
  },
  closeAvatarEditor() {
    this.avatarSelection = (this.avatarSelection || 0) + 1;
    const editor = this.avatarEditor;
    if (!editor) return;
    this.avatarEditor = null;
    editor.dialog.close();
    editor.dialog.remove();
    URL.revokeObjectURL(editor.url);
    this.querySelector('[data-avatar-change]')?.focus();
  },
  async openAvatarEditor(file) {
    const status = this.querySelector('[data-avatar-status]');
    const fail = key => { if (status) status.textContent = this.avatarText(key); };
    if (!this.avatarEndpoint()) { fail('auth'); return; }
    if (file.size > 5 * 1024 * 1024) { fail('large'); return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { fail('invalid'); return; }
    this.closeAvatarEditor();
    const selection = this.avatarSelection;
    fail('loading');
    const url = URL.createObjectURL(file);
    const image = new Image();
    const owner = this.user;
    try {
      image.src = url;
      await image.decode();
      if (this.user !== owner || this.view !== 'profile' || selection !== this.avatarSelection) { URL.revokeObjectURL(url); return; }
      if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 25000000) throw new Error('image');
    } catch { URL.revokeObjectURL(url); fail('invalid'); return; }
    if (status) status.textContent = '';
    const t = key => this.avatarText(key);
    const dialog = document.createElement('dialog');
    dialog.className = 'avatar-editor';
    dialog.setAttribute('aria-labelledby', 'avatar-editor-title');
    dialog.innerHTML = `<h2 id="avatar-editor-title">${t('title')}</h2><p>${t('hint')}</p><div class="avatar-crop-preview"><canvas width="512" height="512" aria-label="${t('title')}"></canvas></div><div class="avatar-crop-controls">${[['zoom', 1, 3, 1], ['x', 0, 100, 50], ['y', 0, 100, 50]].map(([key, min, max, value]) => `<label>${t(key)}<input type="range" data-crop="${key}" min="${min}" max="${max}" value="${value}" step="${key === 'zoom' ? '.01' : '1'}"></label>`).join('')}</div><p data-avatar-editor-status role="status" aria-live="polite"></p><div class="avatar-editor-actions"><button type="button" data-avatar-cancel>${t('cancel')}</button><button type="button" data-avatar-save>${t('save')}</button></div>`;
    document.body.append(dialog);
    const editor = { dialog, image, url, owner, busy: false };
    this.avatarEditor = editor;
    const canvas = dialog.querySelector('canvas');
    const sliders = Object.fromEntries([...dialog.querySelectorAll('[data-crop]')].map(input => [input.dataset.crop, input]));
    const draw = () => {
      const size = Math.min(image.naturalWidth, image.naturalHeight) / Number(sliders.zoom.value);
      const x = (image.naturalWidth - size) * Number(sliders.x.value) / 100;
      const y = (image.naturalHeight - size) * Number(sliders.y.value) / 100;
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 512, 512);
      context.drawImage(image, x, y, size, size, 0, 0, 512, 512);
    };
    Object.values(sliders).forEach(input => input.addEventListener('input', draw));
    let pointer;
    canvas.addEventListener('pointerdown', event => { if (editor.busy) return; pointer = { x: event.clientX, y: event.clientY }; canvas.setPointerCapture(event.pointerId); });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || editor.busy) return;
      sliders.x.value = Math.max(0, Math.min(100, Number(sliders.x.value) - (event.clientX - pointer.x) / 2));
      sliders.y.value = Math.max(0, Math.min(100, Number(sliders.y.value) - (event.clientY - pointer.y) / 2));
      pointer = { x: event.clientX, y: event.clientY }; draw();
    });
    canvas.addEventListener('pointerup', () => { pointer = null; });
    canvas.addEventListener('pointercancel', () => { pointer = null; });
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!editor.busy) this.closeAvatarEditor(); });
    dialog.querySelector('[data-avatar-cancel]').addEventListener('click', () => this.closeAvatarEditor());
    dialog.querySelector('[data-avatar-save]').addEventListener('click', async () => {
      if (editor.busy) return;
      editor.busy = true;
      dialog.querySelectorAll('button,input').forEach(element => { element.disabled = true; });
      const message = dialog.querySelector('[data-avatar-editor-status]');
      message.textContent = t('saving');
      try {
        const data = canvas.toDataURL('image/webp', .9);
        const result = await this.writeAvatar('POST', { mime: data.startsWith('data:image/webp;') ? 'image/webp' : 'image/png', image: data.split(',')[1] });
        if (this.user !== owner) return;
        this.avatarUrl = this.safeAvatarUrl(result.avatarUrl);
        this.avatarCleanupPending = Boolean(result.cleanupPending);
        this.syncAvatarDom();
        this.closeAvatarEditor();
        const messageText = result.cleanupPending ? t('deferred') : t('success');
        const pageStatus = this.querySelector('[data-avatar-status]');
        if (pageStatus) pageStatus.textContent = messageText;
        this.showToast(messageText);
      } catch (error) { message.textContent = this.avatarErrorText(error.code); }
      finally { editor.busy = false; dialog.querySelectorAll('button,input').forEach(element => { element.disabled = false; }); }
    });
    draw(); dialog.showModal();
  },
  async writeAvatar(method, body) {
    const endpoint = this.avatarEndpoint();
    if (!endpoint) throw Object.assign(new Error(), { code: 'SESSION_INVALID' });
    const response = await fetch(endpoint, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(), { code: data.code });
    return data;
  },
  async removeAvatar() {
    if (this.avatarRemoving) return;
    const status = this.querySelector('[data-avatar-status]');
    const owner = this.user;
    this.avatarRemoving = true;
    this.querySelectorAll('[data-avatar-remove], [data-avatar-change]').forEach(button => { button.disabled = true; });
    if (status) status.textContent = this.avatarText('saving');
    try {
      const data = await this.writeAvatar('DELETE');
      if (this.user !== owner) return;
      this.avatarUrl = null;
      this.avatarCleanupPending = Boolean(data.cleanupPending);
      this.syncAvatarDom();
      if (status) status.textContent = this.avatarText(data.cleanupPending ? 'deferred' : 'removed');
    } catch (error) { if (status) status.textContent = this.avatarErrorText(error.code); }
    finally {
      this.avatarRemoving = false;
      this.querySelectorAll('[data-avatar-remove], [data-avatar-change]').forEach(button => { button.disabled = false; });
    }
  },
};
