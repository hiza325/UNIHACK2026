import { test, expect } from '@playwright/test';
import { generateSupportReply } from '../api/support.js';

async function openSupport(page) {
  await page.goto('/');
  await page.locator('[data-support-toggle]').click();
  await expect(page.locator('#support-panel')).toBeVisible();
}

async function ask(page, text) {
  await page.fill('#support-input', text);
  await page.locator('#support-form button[type="submit"]').click();
}

function replyRoute(handler = null) {
  return async route => {
    const reply = handler
      ? await handler(route.request().postDataJSON())
      : await generateSupportReply(route.request().postDataJSON());
    await route.fulfill({ json: reply });
  };
}

test('browser shows four documented answers with their source questions and no truncation', async ({ page }) => {
  await page.route('**/api/support', replyRoute());
  await openSupport(page);
  await ask(page, 'Tôi không nhận được OTP, quên mật khẩu, làm sao mở khoá Error Hunter, và xác minh credential');

  const answers = page.locator('.support-answer');
  await expect(answers).toHaveCount(4);
  await expect(answers.nth(0)).toContainText('Tôi không nhận được mã OTP thì sao?');
  await expect(answers.nth(3)).toContainText('Làm sao xác minh một credential?');
  await expect(page.locator('.support-source')).toHaveCount(4);
  await expect(page.locator('.support-source').nth(0)).toContainText('A03');
  await expect(page.locator('.support-source').nth(3)).toContainText('A46');
  await expect(page.locator('.support-message.assistant').last()).toContainText('nhập mã chứng nhận cần kiểm tra');
  await expect(page.locator('.support-message.assistant').last()).not.toContainText('…');
  await expect(page.locator('.support-message.assistant').last()).not.toContainText('AI đang');
});

test('browser shows the unmatched part without inventing guidance', async ({ page }) => {
  await page.route('**/api/support', replyRoute());
  await openSupport(page);
  await ask(page, 'Tôi không nhận được OTP và cách nấu phở');

  const reply = page.locator('.support-message.assistant').last();
  await expect(reply.locator('.support-answer')).toHaveCount(1);
  await expect(reply).toContainText('cách nấu phở');
  await expect(reply).toContainText('Mình chưa có hướng dẫn cho phần');
});

test('browser asks the user to choose a documented question when the topic is ambiguous', async ({ page }) => {
  await page.route('**/api/support', replyRoute());
  await openSupport(page);
  await ask(page, 'tài khoản');

  const reply = page.locator('.support-message.assistant').last();
  await expect(reply.locator('.support-answer')).toHaveCount(0);
  await expect(reply).toContainText('Bạn chọn một câu hỏi');
  const chips = page.locator('.support-suggestions .suggestion-chip');
  await expect(chips.first()).toBeVisible();
  const chipText = (await chips.first().innerText()).trim();
  expect(chipText.length).toBeGreaterThan(0);
});

test('browser reports an undocumented topic and offers starter questions', async ({ page }) => {
  await page.route('**/api/support', replyRoute());
  await openSupport(page);
  await ask(page, 'thời tiết hôm nay');

  const reply = page.locator('.support-message.assistant').last();
  await expect(reply).toContainText('chưa tìm thấy hướng dẫn chính thức');
  await expect(page.locator('.support-suggestions .suggestion-chip').first()).toBeVisible();
});

test('browser renders FAQ content as text and blocks markup injection', async ({ page }) => {
  const malicious = {
    status: 'answered',
    text: 'answer',
    answers: [{
      id: 'A03',
      question: '<img src=x onerror="window.__supportXss=1"> Câu hỏi',
      answer: '<script>window.__supportXss=2</script> **Bước 1:** Kiểm tra.\n<img src=x onerror="window.__supportXss=3">',
      category: '<svg onload="window.__supportXss=4">',
      source: { paragraph: 15 },
    }],
    suggestions: [],
  };
  await page.route('**/api/support', replyRoute(() => malicious));
  await openSupport(page);
  await ask(page, 'Tôi không nhận được mã OTP thì sao?');

  const reply = page.locator('.support-message.assistant').last();
  await expect(reply).toContainText('Bước 1:');
  await expect(reply.locator('strong')).toHaveText('Bước 1:');
  await expect(reply.locator('img, script, svg')).toHaveCount(0);
  expect(await page.evaluate(() => window.__supportXss)).toBeUndefined();
});

test('retry appears only for a request error and replaces the failed attempt without duplicating the question', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/support', async route => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 429, json: { error: 'Too many requests', code: 'RATE_LIMITED' } });
      return;
    }
    await route.fulfill({ json: await generateSupportReply(route.request().postDataJSON()) });
  });
  await openSupport(page);
  await ask(page, 'Tôi không nhận được mã OTP thì sao?');

  await expect(page.locator('[data-support-retry]')).toBeVisible();
  await expect(page.locator('.support-message.user')).toHaveCount(1);
  await page.locator('[data-support-retry]').click();

  await expect(page.locator('.support-message.assistant').last()).toContainText('thư rác');
  await expect(page.locator('.support-message.user')).toHaveCount(1);
  await expect(page.locator('[data-support-retry]')).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('a non-AI answer is not marked complete while the request is still running', async ({ page }) => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/support', async route => {
    calls += 1;
    await wait;
    await route.fulfill({ json: await generateSupportReply(route.request().postDataJSON()) });
  });
  await openSupport(page);
  await ask(page, 'Xem lịch sử ở đâu?');

  await expect(page.locator('.support-typing')).toBeVisible();
  await expect(page.locator('#support-input')).toBeDisabled();
  await page.evaluate(() => document.querySelector('edu-app').sendSupportMessage('second concurrent question'));
  expect(calls).toBe(1);

  release();
  await expect(page.locator('.support-message.assistant').last()).toContainText('Learning History');
  await expect(page.locator('.support-message.user')).toHaveCount(1);
});

test('browser reports a gateway timeout and allows a retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/support', async route => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 504, contentType: 'text/html', body: '<h1>Gateway timeout</h1>' });
      return;
    }
    await route.fulfill({ json: await generateSupportReply(route.request().postDataJSON()) });
  });
  await openSupport(page);
  await ask(page, 'Xem lịch sử ở đâu?');

  await expect(page.locator('[data-support-retry]')).toBeVisible();
  await expect(page.locator('.support-message.assistant').last()).toContainText('hơi lâu');
  await expect(page.locator('.support-typing')).toHaveCount(0);
  await page.locator('[data-support-retry]').click();
  await expect(page.locator('.support-message.assistant').last()).toContainText('Learning History');
});

test('browser reports an interrupted JSON response instead of rendering a partial success', async ({ page }) => {
  await page.route('**/api/support', route => route.fulfill({ contentType: 'application/json', body: '{"text":' }));
  await openSupport(page);
  await ask(page, 'Xem lịch sử ở đâu?');
  await expect(page.locator('[data-support-retry]')).toBeVisible();
  await expect(page.locator('.support-typing')).toHaveCount(0);
  await expect(page.locator('#support-input')).toBeEnabled();
});

test('English UI displays the Vietnamese-documentation notice from the API', async ({ page }) => {
  await page.route('**/api/support', replyRoute());
  await page.addInitScript(() => localStorage.setItem('paradox-lang', 'en'));
  await openSupport(page);
  await ask(page, 'Tôi không nhận được mã OTP thì sao?');
  await expect(page.locator('.support-message.assistant').last().locator('.support-notice')).toContainText('Vietnamese');
});
