import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const SESSION = { name: 'Test User', email: 'test@example.com' };

function seedSession(page) {
  return page.addInitScript(user => localStorage.setItem('paradox-session', JSON.stringify(user)), SESSION);
}

function userKey(name, email = SESSION.email) {
  return `paradox-user:${encodeURIComponent(email.toLowerCase())}:${name}`;
}

function seedLearningSessions(page) {
  return page.addInitScript(({ key, sessions }) => localStorage.setItem(key, JSON.stringify(sessions)), {
    key: userKey('audit-sessions'),
    sessions: [
      { id: '1', date: '26/10', isoDate: '2026-10-26', title: 'Đạo hàm', skill: 'Giải tích', status: 'needs', score: 62, selfDetected: false, minutes: 8 },
      { id: '2', date: '24/10', isoDate: '2026-10-24', title: 'Đại số', skill: 'Đại số', status: 'mastered', score: 88, selfDetected: true, minutes: 10 },
      { id: '3', date: '22/10', isoDate: '2026-10-22', title: 'Python list', skill: 'Lập trình', status: 'mastered', score: 92, selfDetected: true, minutes: 12 },
      { id: '4', date: '19/10', isoDate: '2026-10-19', title: 'Giới hạn', skill: 'Giải tích', status: 'progress', score: 54, selfDetected: false, minutes: 6 },
      { id: '5', date: '17/10', isoDate: '2026-10-17', title: 'Logic', skill: 'Logic', status: 'needs', score: 67, selfDetected: false, minutes: 7 },
      { id: '6', date: '15/10', isoDate: '2026-10-15', title: 'Xác suất', skill: 'Thống kê', status: 'mastered', score: 85, selfDetected: true, minutes: 9 }
    ]
  });
}

async function axeHighImpactViolations(page, contextName) {
  const results = await new AxeBuilder({ page }).analyze();
  if (results.violations.length) {
    console.log(`[axe:${contextName}]`, results.violations.map(v => `${v.impact}:${v.id}`).join(', '));
  }
  return results.violations.filter(v => ['critical', 'serious'].includes(v.impact));
}

test.describe('auth', () => {
  test('landing renders with self-hosted fonts and passes axe', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/PARADOX AI/);
    await expect(page.locator('#landing-login')).toBeVisible();
    expect(await page.locator('link[href*="fonts.googleapis.com"], link[href*="fonts.gstatic.com"]')).toHaveCount(0);
    expect(await page.locator('link[rel="preload"][as="font"]')).toHaveCount(4);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('500 48px "Lora"', 'Chào buổi chiều'))).toBe(true);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /social-preview\.png$/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    const previewSize = await page.evaluate(() => new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = () => resolve([0, 0]);
      image.src = 'social-preview.png';
    }));
    expect(previewSize).toEqual([1200, 630]);
    expect(await axeHighImpactViolations(page, 'landing')).toEqual([]);
  });

  test('signup initializes empty learning data, logout returns to landing', async ({ page }) => {
    await page.goto('/');
    await page.click('#hero-start');
    await page.fill('input[name="name"]', SESSION.name);
    await page.fill('input[name="email"]', SESSION.email);
    await page.fill('input[name="password"]', 'secret123');
    await page.fill('input[name="confirm"]', 'secret123');
    await page.click('.auth-submit');
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paradox-session'))?.email)).toBe(SESSION.email);
    await expect(page.locator('.nav-count')).toHaveText('00');
    await expect(page.locator('section[aria-label^="Tự phát hiện lỗi"]')).toHaveAttribute('aria-label', 'Tự phát hiện lỗi: 0%');
    await expect(page.locator('.plan-card [role="progressbar"]')).toHaveAttribute('aria-valuenow', '10');
    await expect(page.locator('.plan-foot')).toContainText('10 / 10');
    await expect(page.locator('.plan-foot')).toContainText('100%');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), userKey('audit-sessions'))).toEqual([]);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), userKey('practice'))).toEqual([]);

    await page.locator('.sidebar [data-route="audit"]').click();
    await expect(page.locator('#messages .bubble').first()).toContainText(SESSION.name);
    await expect(page.locator('#messages .bubble').first()).not.toContainText('Minh Anh');

    await page.click('#logout-button');
    await expect(page.locator('#landing-login')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('paradox-session'))).toBeNull();
  });

  test('signup rejects mismatched passwords', async ({ page }) => {
    await page.goto('/');
    await page.click('#hero-start');
    await page.fill('input[name="name"]', SESSION.name);
    await page.fill('input[name="email"]', SESSION.email);
    await page.fill('input[name="password"]', 'secret123');
    await page.fill('input[name="confirm"]', 'different');
    await page.click('.auth-submit');
    await expect(page.locator('#auth-error')).not.toBeEmpty();
    expect(await page.evaluate(() => localStorage.getItem('paradox-session'))).toBeNull();
  });
});

test.describe('route guard', () => {
  test('protected hash prompts login, then lands on the requested view', async ({ page }) => {
    await page.goto('/#/history');
    await expect(page.locator('#auth-backdrop')).toBeVisible();

    await page.fill('input[name="email"]', SESSION.email);
    await page.fill('input[name="password"]', 'secret123');
    await page.click('.auth-submit');

    await expect(page).toHaveURL(/#\/history$/);
    await expect(page.getByRole('heading', { name: 'Lịch sử bài làm' })).toBeVisible();
  });

  test('sitemap stays public without a session', async ({ page }) => {
    await page.goto('/#/sitemap');
    await expect(page.locator('.sitemap-page')).toBeVisible();
    await expect(page.locator('#auth-backdrop')).toBeHidden();
  });
});

test.describe('app shell', () => {
  test('theme toggle switches dark mode and persists', async ({ page }) => {
    await seedSession(page);
    await page.goto('/#/dashboard');
    const toggle = page.locator('[data-theme-toggle]').first();
    await expect(page.locator('.continue-step')).toHaveText('01 / 07');
    await expect(page.locator('.continue-progress')).toHaveAttribute('aria-valuenow', '1');

    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('paradox-theme'))).toBe('dark');

    await toggle.click();
    await expect(page.locator('body')).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('paradox-theme'))).toBe('light');
  });

  test('test notification sends a browser notification and optional sound', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
      class MockNotification {
        static permission = 'granted';
        static requestPermission = async () => 'granted';
        constructor(title, options) { window.__testNotification = { title, options }; }
      }
      class MockAudioContext {
        constructor() { this.currentTime = 0; this.destination = {}; }
        createOscillator() {
          window.__testSoundPlayed = true;
          return {
            frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
            connect(node) { return node; }, start() {}, stop() {},
            addEventListener(_event, callback) { queueMicrotask(callback); }
          };
        }
        createGain() {
          return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect(node) { return node; } };
        }
        close() { return Promise.resolve(); }
      }
      Object.defineProperty(window, 'Notification', { configurable: true, value: MockNotification });
      Object.defineProperty(window, 'AudioContext', { configurable: true, value: MockAudioContext });
    });
    await page.goto('/#/settings');
    await page.locator('[data-setting="sound"]').check();
    await page.locator('[data-test-notification]').click();

    expect(await page.evaluate(() => window.__testNotification?.title)).toContain('PARADOX AI');
    expect(await page.evaluate(() => window.__testNotification?.options?.tag)).toBe('paradox-notification-test');
    expect(await page.evaluate(() => window.__testSoundPlayed)).toBe(true);
    await expect(page.locator('#toast')).toContainText('Đã gửi thông báo thử');
  });

  test('website support AI uses the configured proxy and keeps its scope', async ({ page }) => {
    let requestBody;
    await seedSession(page);
    await page.addInitScript(() => {
      window.PARADOX_SUPPORT_AI_CONFIG = { proxyUrl: '/api/support-test' };
    });
    await page.route('**/api/support-test', async route => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'Bạn mở Lịch sử ở thanh điều hướng bên trái.' }),
      });
    });
    await page.goto('/#/dashboard');
    await expect(page.locator('[data-support-toggle] img')).toHaveAttribute('src', 'chatbot-avatar.png');
    await page.locator('[data-support-toggle]').click();
    await expect(page.locator('#support-panel')).toBeVisible();
    await page.fill('#support-input', 'Tôi xem lịch sử ở đâu?');
    await page.locator('#support-form button[type="submit"]').click();

    await expect(page.locator('.support-message.user')).toContainText('Tôi xem lịch sử ở đâu?');
    await expect(page.locator('.support-message.assistant').last()).toContainText('thanh điều hướng bên trái');
    expect(requestBody.currentView).toBe('dashboard');
    expect(requestBody.language).toBe('vi');
    expect(requestBody.system).toBeUndefined();
  });

  test('all main views pass axe (serious and critical)', async ({ page }) => {
    await seedSession(page);
    test.setTimeout(60000);
    for (const view of ['dashboard', 'audit', 'history', 'analytics', 'practice', 'profile', 'about', 'settings']) {
      await page.goto(`/#/${view}`);
      await expect(page.locator('.page')).toBeVisible();
      expect(await axeHighImpactViolations(page, view), `axe violations on ${view}`).toEqual([]);
    }
  });
});

test.describe('practice lab', () => {
  test('answering a challenge marks it solved and persists', async ({ page }) => {
    await seedSession(page);
    await page.goto('/#/practice');
    await page.locator('.challenge-card [data-challenge="0"]').click();
    await expect(page.locator('#practice-modal')).toBeVisible();

    await page.locator('[data-option="1"]').click(); // correct answer for challenge 0
    await expect(page.locator('#practice-result.ok')).toBeVisible();
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), userKey('practice'))).toContain(0);

    expect(await axeHighImpactViolations(page, 'practice-modal')).toEqual([]);
    await page.locator('.practice-close').click();
    await expect(page.locator('#practice-modal')).toBeHidden();
  });
});

test.describe('history filters', () => {
  test('status chip and search narrow the session list', async ({ page }) => {
    await seedSession(page);
    await seedLearningSessions(page);
    await page.goto('/#/history');

    const rows = page.locator('[data-session-status]');
    await expect(rows).toHaveCount(6);
    await expect(page.locator('[data-session-status]:visible')).toHaveCount(5); // page size

    await page.click('[data-history-filter="mastered"]');
    await expect(page.locator('[data-session-status]:visible')).toHaveCount(3);

    await page.click('[data-history-filter="all"]');
    await page.fill('#history-search', 'python');
    await expect(page.locator('[data-session-status]:visible')).toHaveCount(1);
  });
});
