import { test, expect } from '@playwright/test';
import { generateSupportReply } from '../api/support.js';

const payload = { language: 'vi', messages: [{ role: 'user', text: 'Xem lịch sử ở đâu?' }] };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('preserves long Vietnamese output, paragraphs, Markdown and final conclusion', async () => {
  const text = '**Hướng dẫn:**\n\n' + 'Đây là hướng dẫn sử dụng lịch sử. '.repeat(80) + '\n```txt\n<a> **literal**\n```\nKết luận cuối cùng.';
  const result = await generateSupportReply(payload, {
    env: { GROQ_API_KEY: 'fake-key' },
    fetcher: async () => json({ choices: [{ finish_reason: 'stop', message: { content: text } }] }),
  });
  expect(result.text).toBe(text);
  expect(result.status).toBe('complete');
});

for (const [provider, reason, status, code] of [
  ['groq', 'length', 'incomplete', 'OUTPUT_LIMIT'],
  ['gemini', 'MAX_TOKENS', 'incomplete', 'OUTPUT_LIMIT'],
  ['groq', 'content_filter', 'incomplete', 'INCOMPLETE_OUTPUT'],
  ['gemini', 'SAFETY', 'incomplete', 'INCOMPLETE_OUTPUT'],
  ['groq', undefined, 'incomplete', 'INCOMPLETE_OUTPUT'],
  ['gemini', 'STOP', 'complete', undefined],
]) {
  test(`${provider} ${reason}: completion metadata and all visible parts`, async () => {
    let calls = 0;
    const result = await generateSupportReply(payload, {
      env: provider === 'groq' ? { GROQ_API_KEY: 'fake-key' } : { GEMINI_API_KEY: 'fake-key' },
      fetcher: async () => {
        calls++;
        return json(provider === 'groq'
          ? { choices: [{ finish_reason: reason, message: { content: [{ type: 'text', text: 'Phần một. ' }, { type: 'text', text: 'Phần hai.' }] } }] }
          : { candidates: [{ finishReason: reason, content: { parts: [{ text: 'private reasoning', thought: true }, { text: 'Phần một. ' }, { text: 'Phần hai.' }] } }] });
      },
    });
    expect(result.text).toBe('Phần một. Phần hai.');
    expect(result.status).toBe(status);
    expect(result.code).toBe(code);
    expect(calls).toBe(1);
  });
}

test('long multi-part question reaches prompt intact and over-limit input is rejected', async () => {
  const question = 'Xem lịch sử ở đâu? ' + 'Tôi cần hướng dẫn. '.repeat(35) + 'Quên mật khẩu thì làm gì?';
  let body;
  await generateSupportReply({ ...payload, messages: [{ role: 'user', text: question }] }, {
    env: { GROQ_API_KEY: 'fake-key' }, fetcher: async (_, options) => {
      body = JSON.parse(options.body);
      return json({ choices: [{ finish_reason: 'stop', message: { content: 'Hướng dẫn.' } }] });
    },
  });
  expect(body.messages.at(-1).content).toBe(question);
  expect(body.messages[0].content).toContain('Address each part');
  expect(body.messages[0].content).toContain('Do not solve homework');
  expect(body.max_tokens).toBe(600);
  await expect(generateSupportReply({ messages: [{ role: 'user', text: 'x'.repeat(1201) }] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});

test('rate limit and broken non-streaming body return explicit degraded guidance', async () => {
  for (const fetcher of [
    async () => json({ error: { message: 'quota' } }, 429),
    async () => new Response('{"choices":'),
  ]) {
    const result = await generateSupportReply(payload, { env: { GROQ_API_KEY: 'fake-key' }, fetcher });
    expect(result.status).toBe('degraded');
    expect(['RATE_LIMITED', 'INVALID_OUTPUT']).toContain(result.code);
  }
});

test('timeout through body consumption is degraded, not a completed AI reply', async () => {
  const result = await generateSupportReply(payload, {
    env: { GROQ_API_KEY: 'fake-key' }, timeoutMs: 100,
    fetcher: async (_, { signal }) => ({ ok: true, json: () => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }) }),
  });
  expect(result.status).toBe('degraded');
  expect(result.code).toBe('TIMEOUT');
});

test('browser shows full content, safe code and interruption; retry replaces rather than duplicates', async ({ page }) => {
  let calls = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const full = '**Bước 1:**\n\n' + 'Tiếng Việt đầy đủ. '.repeat(120) + '\n```js\nconst x = "<img src=x>";\n```\n1. Kiểm tra.\n2. Hoàn tất.\nKẾT LUẬN';
  await page.route('**/api/support', async route => {
    calls++;
    if (calls === 1) await wait;
    const reply = await generateSupportReply(route.request().postDataJSON(), {
      env: { GROQ_API_KEY: 'fake-key' },
      fetcher: async () => json({ choices: [{ finish_reason: calls === 1 ? 'length' : 'stop', message: { content: calls === 1 ? 'Đang hướng dẫn' : full } }] }),
    });
    await route.fulfill({ json: reply });
  });
  await page.goto('/');
  await page.locator('[data-support-toggle]').click();
  await page.fill('#support-input', 'Xem lịch sử ở đâu?');
  await page.locator('#support-form button').click();
  await expect(page.locator('.support-typing')).toBeVisible();
  await expect(page.locator('#support-input')).toBeDisabled();
  await page.evaluate(() => document.querySelector('edu-app').sendSupportMessage('second concurrent question'));
  expect(calls).toBe(1);
  release();
  await expect(page.locator('[data-support-retry]')).toBeVisible();
  await page.locator('[data-support-retry]').click();
  const reply = page.locator('.support-message.assistant').last();
  await expect(reply).toContainText('KẾT LUẬN');
  await expect(reply.locator('strong')).toHaveText('Bước 1:');
  await expect(reply.locator('.support-code')).toHaveText('const x = "<img src=x>";');
  await expect(reply.locator('ol li')).toHaveCount(2);
  await expect(reply.locator('img')).toHaveCount(0);
  await expect(page.locator('.support-message.user')).toHaveCount(1);
  await expect(page.locator('.support-message.assistant')).toHaveCount(1);
  await expect(page.locator('[data-support-retry]')).toHaveCount(0);
  expect(calls).toBe(2);
  await reply.locator('.support-status').scrollIntoViewIfNeeded();
  await expect(reply.locator('.support-status')).toBeVisible();
});

test('browser reports interrupted JSON and allows retry', async ({ page }) => {
  await page.route('**/api/support', route => route.fulfill({ contentType: 'application/json', body: '{"text":' }));
  await page.goto('/');
  await page.locator('[data-support-toggle]').click();
  await page.fill('#support-input', 'Xem lịch sử ở đâu?');
  await page.locator('#support-form button').click();
  await expect(page.locator('[data-support-retry]')).toBeVisible();
  await expect(page.locator('.support-typing')).toHaveCount(0);
  await expect(page.locator('#support-input')).toBeEnabled();
});

test('browser waits beyond the old 25s deadline and reports its own timeout', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/support', () => {});
  await page.goto('/');
  await page.locator('[data-support-toggle]').click();
  await page.fill('#support-input', 'Xem lịch sử ở đâu?');
  const request = page.waitForRequest('**/api/support');
  await page.locator('#support-form button').click();
  await request;
  await page.clock.fastForward(26000);
  await expect(page.locator('.support-typing')).toBeVisible();
  await page.clock.fastForward(25000);
  await expect(page.locator('[data-support-retry]')).toBeVisible();
  await expect(page.locator('.support-typing')).toHaveCount(0);
  await expect(page.locator('#support-input')).toBeEnabled();
});

for (const code of ['TIMEOUT', 'RATE_LIMITED']) {
  test(`browser distinguishes documentation fallback from AI success: ${code}`, async ({ page }) => {
    await page.route('**/api/support', route => route.fulfill({ json: { text: 'Hướng dẫn từ tài liệu.', status: 'degraded', code } }));
    await page.goto('/');
    await page.locator('[data-support-toggle]').click();
    await page.fill('#support-input', 'Xem lịch sử ở đâu?');
    await page.locator('#support-form button').click();
    await expect(page.locator('.support-status')).toContainText('tài liệu');
    await expect(page.locator('[data-support-retry]')).toBeVisible();
  });
}

test('Markdown treats active HTML, links and code as untrusted content and preserves list numbers', async ({ page }) => {
  const text = '<svg onload="window.__xss=1"></svg>\n**<img src=x onerror="window.__xss=2">**\n'
    + '[run](javascript:window.__xss=3)\n&lt;script&gt;window.__xss=4&lt;/script&gt;\n'
    + '`<iframe srcdoc="evil">`\n```html\n</code><script>window.__xss=5</script>\n```\n'
    + '3. Bước ba.\n5. Bước năm.\nKết luận.';
  await page.route('**/api/support', route => route.fulfill({ json: { text, status: 'complete' } }));
  await page.goto('/');
  await page.locator('[data-support-toggle]').click();
  await page.fill('#support-input', 'Xem lịch sử ở đâu?');
  await page.locator('#support-form button').click();
  const reply = page.locator('.support-message.assistant').last();
  await expect(reply).toContainText('Kết luận.');
  await expect(reply.locator('script, img, svg, iframe, a, [onload], [onerror]')).toHaveCount(0);
  await expect(reply.locator('ol li').nth(0)).toHaveAttribute('value', '3');
  await expect(reply.locator('ol li').nth(1)).toHaveAttribute('value', '5');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

for (const [status, code] of [[429, 'RATE_LIMITED'], [504, 'TIMEOUT']]) {
  test(`client preserves HTTP ${status} when proxy returns HTML`, async ({ page }) => {
    await page.route('**/api/support', route => route.fulfill({ status, contentType: 'text/html', body: '<h1>Proxy error</h1>' }));
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { requestSupportReply } = await import('/support-ai.js');
      try { await requestSupportReply([{ role: 'user', text: 'Xem lịch sử ở đâu?' }], 'vi', 'landing'); }
      catch (error) { return error.code; }
    });
    expect(result).toBe(code);
  });
}
