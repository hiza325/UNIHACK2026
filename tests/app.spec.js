import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const SESSION = { name: 'Test User', email: 'test@example.com' };

function seedSession(page) {
  return page.addInitScript(user => localStorage.setItem('paradox-session', JSON.stringify(user)), SESSION);
}

function userKey(name, email = SESSION.email) {
  return `paradox-user:${encodeURIComponent(email.toLowerCase())}:${name}`;
}

async function verifyLocalOtp(page) {
  await expect(page.locator('input[name="otp"]')).toBeVisible();
  const message = await page.locator('#auth-demo-code').textContent();
  const code = message?.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  await page.fill('input[name="otp"]', code);
  await page.click('.auth-submit');
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
    await verifyLocalOtp(page);
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paradox-session'))?.email)).toBe(SESSION.email);
    await expect(page.locator('.nav-count')).toHaveText('00');
    await expect(page.locator('[data-dashboard-state="empty"]')).toBeVisible();
    await expect(page.locator('[data-continue-state="empty"]')).toContainText('Tạo phiên học đầu tiên');
    await expect(page.locator('.dashboard-stats')).toHaveCount(0);
    await expect(page.locator('.plan-card')).toContainText('Chưa có API hạn mức');
    await expect(page.locator('.plan-card [role="progressbar"]')).toHaveCount(0);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), userKey('audit-sessions'))).toEqual([]);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), userKey('practice'))).toEqual([]);

    await page.locator('.sidebar [data-route="audit"]').click();
    await expect(page.locator('#messages .bubble').first()).toContainText(SESSION.name);
    await expect(page.locator('#messages .bubble').first()).not.toContainText('Minh Anh');

    await page.click('#logout-button');
    await expect(page.locator('#landing-login')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('paradox-session'))).toBeNull();

    await page.click('#landing-login');
    await page.fill('input[name="email"]', SESSION.email);
    await page.fill('input[name="password"]', 'secret123');
    await page.click('.auth-submit');
    await expect(page.locator('.sidebar')).toBeVisible();
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

  test('an open browser session logs out when the account becomes suspended', async ({ page }) => {
    let suspended = false;
    let appealPayload;
    await seedSession(page);
    await page.route('**/api/auth/session', route => route.fulfill({
      status: suspended ? 403 : 200,
      contentType: 'application/json',
      body: JSON.stringify(suspended ? { error: 'This account is suspended', code: 'ACCOUNT_SUSPENDED', suspensionReason: 'account_sharing', appealToken: 'signed-appeal-token' } : { user: { ...SESSION, id: 'user-id', role: 'user', status: 'active' } }),
    }));
    await page.route('**/api/auth/logout', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ loggedOut: true }) }));
    await page.route('**/api/auth/otp', async route => {
      appealPayload = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ appealed: true }) });
    });

    await page.goto('/#/dashboard');
    await expect(page.locator('.sidebar')).toBeVisible();

    suspended = true;
    await page.evaluate(() => document.querySelector('edu-app').checkRemoteSession());

    await expect(page.locator('#landing-login')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('paradox-session'))).toBeNull();
    await expect(page.locator('#auth-backdrop')).toBeVisible();
    await expect(page.locator('.auth-panel')).toContainText('Chia sẻ tài khoản');
    await expect(page.locator('#suspension-appeal-form textarea')).toBeVisible();
    await page.fill('#suspension-appeal-form textarea', 'Tôi không chia sẻ tài khoản và mong quản trị viên kiểm tra lại giúp tôi.');
    await page.click('#suspension-appeal-form button[type="submit"]');
    await expect(page.locator('.appeal-success')).toBeVisible();
    expect(appealPayload).toMatchObject({ action: 'suspension-appeal', appealToken: 'signed-appeal-token' });
  });
});

test.describe('route guard', () => {
  test('protected hash prompts login, then lands on the requested view', async ({ page }) => {
    await page.goto('/#/history');
    await expect(page.locator('#auth-backdrop')).toBeVisible();

    await page.click('#auth-switch');
    await page.fill('input[name="name"]', SESSION.name);
    await page.fill('input[name="email"]', SESSION.email);
    await page.fill('input[name="password"]', 'secret123');
    await page.fill('input[name="confirm"]', 'secret123');
    await page.click('.auth-submit');
    await verifyLocalOtp(page);

    await expect(page).toHaveURL(/#\/history$/);
    await expect(page.getByRole('heading', { name: 'Lịch sử bài làm' })).toBeVisible();
  });

  test('sitemap stays public without a session', async ({ page }) => {
    await page.goto('/#/sitemap');
    await expect(page.locator('.sitemap-page')).toBeVisible();
    await expect(page.locator('#auth-backdrop')).toBeHidden();
  });

  test('non-admin sessions cannot open the admin route', async ({ page }) => {
    await seedSession(page);
    await page.goto('/#/admin');
    await expect(page).toHaveURL(/#\/dashboard$/);
    await expect(page.locator('.admin-page')).toHaveCount(0);
  });
});

test.describe('admin', () => {
  test('verified configured admin can open user management', async ({ page }) => {
    await page.goto('/');
    await page.click('#hero-start');
    await page.fill('input[name="name"]', 'PARADOX Admin');
    await page.fill('input[name="email"]', 'admin@paradox.ai');
    await page.fill('input[name="password"]', 'Admin123!');
    await page.fill('input[name="confirm"]', 'Admin123!');
    await page.click('.auth-submit');
    await verifyLocalOtp(page);

    await page.locator('[data-route="admin"]').click();
    await expect(page.locator('.admin-page')).toBeVisible();
    await expect(page.locator('[data-admin-user]')).toHaveCount(1);
    await expect(page.locator('[data-admin-user]')).toContainText('admin@paradox.ai');
    expect(await axeHighImpactViolations(page, 'admin')).toEqual([]);
  });
});

test.describe('app shell', () => {
  test('theme toggle switches dark mode and persists', async ({ page }) => {
    await seedSession(page);
    await page.goto('/#/dashboard');
    const toggle = page.locator('[data-theme-toggle]').first();
    await expect(page.locator('[data-dashboard-state="empty"]')).toBeVisible();
    await expect(page.locator('[data-continue-state="empty"]')).toBeVisible();

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

  test('website support AI shows a localized error, escapes output and recovers on retry', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
      window.PARADOX_SUPPORT_AI_CONFIG = { proxyUrl: '/api/support-test' };
    });
    let attempt = 0;
    await page.route('**/api/support-test', async route => {
      attempt += 1;
      if (attempt === 1) {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: '<img src=x onerror="window.__supportXss=1"> Đã kết nối lại.' }),
      });
    });

    await page.goto('/#/dashboard');
    await page.locator('[data-support-toggle]').click();
    await page.fill('#support-input', 'Tôi xem lịch sử ở đâu?');
    await page.locator('#support-form button[type="submit"]').click();

    await expect(page.locator('.support-message.assistant').last()).toContainText('hơi nhiều câu hỏi');

    await page.fill('#support-input', 'Thử lại giúp mình');
    await page.locator('#support-form button[type="submit"]').click();

    const lastMessage = page.locator('.support-message.assistant').last();
    await expect(lastMessage).toContainText('Đã kết nối lại.');
    await expect(lastMessage.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__supportXss)).toBeUndefined();
    await expect(page.locator('#support-input')).toBeEnabled();
  });

  test('website support AI renders bold safely without allowing markup injection', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
      window.PARADOX_SUPPORT_AI_CONFIG = { proxyUrl: '/api/support-test' };
    });
    await page.route('**/api/support-test', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: '**Bước 1:** Kiểm tra thư rác.\n<script>window.__supportXss=2</script>\n<img src=x onerror="window.__supportXss=3">\n*Lưu ý* quan trọng.',
        }),
      });
    });

    await page.goto('/#/dashboard');
    await page.locator('[data-support-toggle]').click();
    await page.fill('#support-input', 'Tôi không nhận được mã OTP thì sao?');
    await page.locator('#support-form button[type="submit"]').click();

    const lastMessage = page.locator('.support-message.assistant').last();
    await expect(lastMessage.locator('strong')).toHaveText('Bước 1:');
    await expect(lastMessage.locator('em')).toHaveText('Lưu ý');
    await expect(lastMessage).not.toContainText('**');
    await expect(lastMessage).toContainText('<script>');
    await expect(lastMessage.locator('img')).toHaveCount(0);
    await expect(lastMessage.locator('script')).toHaveCount(0);
    expect(await page.evaluate(() => window.__supportXss)).toBeUndefined();
  });

  test('website support shows suggested questions and sends them on click', async ({ page }) => {
    await seedSession(page);
    await page.addInitScript(() => {
      window.PARADOX_SUPPORT_AI_CONFIG = { proxyUrl: '/api/support-test' };
    });
    await page.route('**/api/support-test', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          text: 'Đây là câu trả lời gợi ý.',
          suggestions: ['Gợi ý tiếp theo A', 'Gợi ý tiếp theo B'],
        }),
      });
    });

    await page.goto('/#/dashboard');
    await page.locator('[data-support-toggle]').click();

    const firstChip = page.locator('.support-suggestions .suggestion-chip').first();
    await expect(firstChip).toBeVisible();
    const chipText = (await firstChip.innerText()).trim();
    await firstChip.click();

    await expect(page.locator('.support-message.user').first()).toContainText(chipText);
    await expect(page.locator('.support-message.assistant').last()).toContainText('Đây là câu trả lời gợi ý.');
    await expect(page.locator('.suggestion-chip', { hasText: 'Gợi ý tiếp theo A' })).toBeVisible();
  });

  test('all main views pass axe (serious and critical)', async ({ page }) => {
    await seedSession(page);
    test.setTimeout(60000);
    for (const view of ['dashboard', 'audit', 'history', 'analytics', 'practice', 'profile', 'passport', 'verify', 'about', 'settings']) {
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

test.describe('AI Debate Engine', () => {
  test('submits the problem and solution and renders structured AI findings', async ({ page }) => {
    const requestBodies = [];
    await seedSession(page);
    await page.route('**/api/debate', async route => {
      const requestBody = route.request().postDataJSON();
      requestBodies.push(requestBody);
      const isHint = requestBody.mode === 'hint';
      const isResubmit = requestBody.mode === 'resubmit';
      const status = isResubmit ? 'correct' : 'incorrect';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ analysis: {
          status, summary: isResubmit ? 'Lời giải mới đã sửa đúng bước cuối.' : 'Bước cuối sử dụng sai phép toán ngược.', confidence: 0.96,
          issues: isResubmit ? [] : [{ category: 'logic', step: 'x = 8 - 2', explanation: 'Hai vế phải được chia cho 2.', suggestion: 'Xem lại phép toán đang tác động lên x.' }],
          strengths: ['Biến đổi hai bước đầu đúng.'], nextQuestion: 'Muốn tách x khỏi hệ số 2, bạn dùng phép toán nào?', reply: requestBody.question ? 'Hãy dùng phép chia để đảo phép nhân với 2.' : '',
          hint: isHint ? { level: requestBody.hintLevel, content: `Gợi ý không lặp ở cấp ${requestBody.hintLevel}.` } : null,
          comparison: isResubmit ? { summary: 'Bước cuối đã được sửa từ phép trừ thành phép chia.', improvements: ['Đã tìm đúng x = 4.'], remainingIssues: [] } : null,
          evaluation: isResubmit ? {
            rubricVersion: 'paradox-rubric-v1', evidenceSufficient: true, score: 91, status: 'pass', comment: 'Bài sửa chính xác và đầy đủ.',
            criteria: {
              knowledgeAccuracy: { score: 24, evidence: 'Kiến thức đúng.' }, reasoningLogic: { score: 23, evidence: 'Lập luận logic.' },
              solutionCompleteness: { score: 21, evidence: 'Đủ bước chính.' }, errorRemediation: { score: 23, evidence: 'Đã sửa lỗi cuối.' },
            },
            correctedIssues: ['Đã thay phép trừ bằng phép chia.'], remainingIssues: [],
          } : null,
          proofRecord: isResubmit ? { schemaVersion: 'paradox-proof-of-learning-v1', contentHash: 'a'.repeat(64) } : null,
        } }),
      });
    });
    await page.goto('/#/audit');
    await page.fill('#problem-text', 'Giải phương trình 2x + 5 = 13');
    await page.fill('#work-text', '2x = 8, do đó x = 8 - 2 = 6');
    await page.click('#start-audit');

    await expect(page.locator('.debate-result.incorrect')).toBeVisible();
    await expect(page.locator('.debate-issue')).toContainText('Logic');
    await expect(page.locator('.debate-issue')).toContainText('x = 8 - 2');
    expect(requestBodies[0].problem).toContain('2x + 5 = 13');
    expect(requestBodies[0].solution).toContain('x = 8 - 2');
    expect(requestBodies[0].language).toBe('vi');

    await page.fill('#chat-message', 'Cho mình một gợi ý.');
    await page.locator('#chat-form button').click();
    await expect(page.locator('#messages .bubble').last()).toContainText('phép chia');
    expect(requestBodies[1].question).toBe('Cho mình một gợi ý.');
    expect(requestBodies[1].previousAnalysis.status).toBe('incorrect');

    for (const level of [1, 2, 3]) {
      await page.locator('[data-request-hint]').click();
      await expect(page.locator('.debate-hint-history article')).toHaveCount(level);
      await expect(page.locator('.debate-session-tools')).toContainText(`${level} / 3`);
    }
    expect(requestBodies.slice(2, 5).map(body => body.hintLevel)).toEqual([1, 2, 3]);
    await expect(page.locator('[data-request-hint]')).toBeDisabled();

    await page.fill('#work-text', '2x = 8, do đó chia hai vế cho 2 và được x = 4.');
    await page.locator('[data-resubmit]').click();
    await expect(page.locator('.debate-result.correct')).toBeVisible();
    await expect(page.locator('.debate-comparison')).toContainText('phép trừ thành phép chia');
    await expect(page.locator('.debate-evaluation')).toContainText('91');
    await expect(page.locator('.debate-evaluation')).toContainText('ĐẠT');
    await expect(page.locator('.debate-evaluation')).toContainText('Đã thay phép trừ bằng phép chia');
    await expect(page.locator('.debate-session-tools')).toContainText('Số lần sửa: 1');
    expect(requestBodies[5].mode).toBe('resubmit');
    expect(requestBodies[5].previousSolution).toContain('x = 8 - 2');
    expect(requestBodies[5].solution).toContain('x = 4');
    expect(await axeHighImpactViolations(page, 'debate-result')).toEqual([]);

    await page.locator('.sidebar [data-route="dashboard"]').click();
    await page.locator('.sidebar [data-route="audit"]').click();
    await expect(page.locator('#work-text')).toHaveValue(/x = 4/);
    await expect(page.locator('.debate-hint-history article')).toHaveCount(3);
    await expect(page.locator('.debate-session-tools')).toContainText('Số lần sửa: 1');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.debate-evaluation')).toBeVisible();
    expect(await page.locator('.debate-evaluation').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.locator('.evaluation-criteria').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
    expect(await axeHighImpactViolations(page, 'debate-result-mobile')).toEqual([]);
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
