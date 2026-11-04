import { test, expect } from '@playwright/test';

const SESSION = { name: 'Test User', email: 'sessions@example.com' };
const USER = { ...SESSION, id: '11111111-1111-4111-8111-111111111111', role: 'user', status: 'active' };

function seedSession(page) {
  return page.addInitScript(user => {
    localStorage.setItem('paradox-session', JSON.stringify(user));
    window.PARADOX_LEARNING_RECORDS_CONFIG = { enabled: true, apiBaseUrl: '/api' };
  }, SESSION);
}

function iso(offsetDays = 0, hour = 10) {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function sessionFixtures() {
  const list = [
    { id: 's1', title: 'Đạo hàm và giới hạn', subject: 'Giải tích', status: 'in_progress', problem: 'Tính đạo hàm của x^2.', startedAt: iso(0), updatedAt: iso(0, 10), lastActivityAt: iso(0, 10) },
    { id: 's2', title: 'Logic và lập luận', subject: 'Logic', status: 'completed', problem: 'Phân tích lập luận sau.', startedAt: iso(1), updatedAt: iso(1, 9), lastActivityAt: iso(1, 9) },
    { id: 's3', title: 'Python cơ bản', subject: 'Lập trình', status: 'in_progress', problem: 'Giải thích list comprehension.', startedAt: iso(3), updatedAt: iso(3, 8), lastActivityAt: iso(3, 8) },
  ];
  const details = {
    s1: {
      ...list[0],
      submissions: [{ id: 'sub1', attemptNumber: 1, type: 'initial', solution: '2x', analysis: null, analysisState: 'analyzed', submittedAt: iso(0, 10) }],
      interactions: [
        { id: 1, mode: 'discussion', role: 'user', content: 'Vì sao đạo hàm của x bình phương là 2x?', createdAt: iso(0, 10) },
        { id: 2, mode: 'discussion', role: 'assistant', content: 'Hãy áp dụng quy tắc lũy thừa và tự kiểm tra bước cuối.', createdAt: iso(0, 11) },
      ],
      evaluations: [],
    },
    s2: {
      ...list[1],
      submissions: [{ id: 'sub2', attemptNumber: 1, type: 'initial', solution: 'Lập luận có lỗi ở bước 2.', analysis: null, analysisState: 'analyzed', submittedAt: iso(1, 9) }],
      interactions: [
        { id: 3, mode: 'discussion', role: 'user', content: 'Bước nào trong lập luận bị sai?', createdAt: iso(1, 9) },
        { id: 4, mode: 'discussion', role: 'assistant', content: 'Hãy kiểm tra lại giả thiết ở bước thứ hai.', createdAt: iso(1, 10) },
      ],
      evaluations: [],
    },
    s3: {
      ...list[2],
      submissions: [{ id: 'sub3', attemptNumber: 1, type: 'initial', solution: 'expr for x in items', analysis: null, analysisState: 'analyzed', submittedAt: iso(3, 8) }],
      interactions: [
        { id: 5, mode: 'discussion', role: 'user', content: 'List comprehension hoạt động thế nào?', createdAt: iso(3, 8) },
        { id: 6, mode: 'discussion', role: 'assistant', content: 'Hãy đọc biểu thức từ trái sang phải.', createdAt: iso(3, 9) },
      ],
      evaluations: [],
    },
  };
  return { list, details };
}

async function setupSessions(page, { viewport } = {}) {
  const state = sessionFixtures();
  await seedSession(page);
  if (viewport) await page.setViewportSize(viewport);
  await page.route('**/api/auth/session', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: USER }),
  }));
  await page.route('**/api/learning-records**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const detail = state.details[id];
        if (!detail) {
          await route.fulfill({ status: 404, json: { error: 'Not found', code: 'LEARNING_SESSION_NOT_FOUND' } });
          return;
        }
        await route.fulfill({ json: { session: detail } });
        return;
      }
      const search = (url.searchParams.get('search') || '').toLowerCase();
      await route.fulfill({
        json: {
          sessions: state.list.filter(item => !item.archivedAt && (!search || item.title.toLowerCase().includes(search))),
          achievementSummary: { schemaVersion: 'paradox-achievement-summary-v1', metrics: {}, achievements: [] },
        },
      });
      return;
    }
    const body = request.postDataJSON() || {};
    if (body.action === 'renameSession') {
      const row = state.list.find(item => item.id === body.sessionId);
      if (row) row.title = String(body.title || '').trim();
      await route.fulfill({ json: { session: row } });
      return;
    }
    if (body.action === 'archiveSession') {
      const row = state.list.find(item => item.id === body.sessionId);
      if (row) row.archivedAt = new Date().toISOString();
      await route.fulfill({ json: { session: row } });
      return;
    }
    await route.fulfill({ status: 400, json: { error: 'Unsupported test action' } });
  });
  return state;
}

test('sidebar groups sessions and opens only the selected session conversation', async ({ page }) => {
  await setupSessions(page);
  await page.goto('/#/audit');
  await expect(page.locator('.learning-sessions')).toBeVisible();
  await expect(page.locator('.ls-group')).toHaveCount(3);
  await expect(page.locator('.ls-session')).toHaveCount(3);
  await expect(page.locator('.ls-group').first()).toContainText('Hôm nay');

  await page.locator('[data-session-open="s1"]').click();
  await expect(page.locator('#problem-text')).toHaveValue('Tính đạo hàm của x^2.');
  await expect(page.locator('#messages')).toContainText('Vì sao đạo hàm của x bình phương là 2x?');
  await expect(page.locator('#messages')).not.toContainText('Bước nào trong lập luận bị sai?');

  await page.locator('[data-session-open="s2"]').click();
  await expect(page.locator('.learning-current-head h2')).toHaveText('Logic và lập luận');
  await expect(page.locator('#messages')).toContainText('Bước nào trong lập luận bị sai?');
  await expect(page.locator('#messages')).not.toContainText('Vì sao đạo hàm của x bình phương là 2x?');
});

test('new session clears the current chat and does not load another session', async ({ page }) => {
  await setupSessions(page);
  await page.goto('/#/audit');
  await page.locator('[data-session-open="s2"]').click();
  await expect(page.locator('#messages')).toContainText('Bước nào trong lập luận bị sai?');

  await page.locator('.ls-new').click();
  await expect(page.locator('.learning-current-head h2')).toHaveText('Phiên học mới');
  await expect(page.locator('#problem-text')).toHaveValue('');
  await expect(page.locator('#messages')).not.toContainText('Bước nào trong lập luận bị sai?');
  await expect(page.locator('.ls-session.active')).toHaveCount(0);
});

test('refresh restores the selected valid session, not the full history', async ({ page }) => {
  await setupSessions(page);
  await page.goto('/#/audit');
  await page.locator('[data-session-open="s2"]').click();
  await expect(page.locator('.learning-current-head h2')).toHaveText('Logic và lập luận');
  await page.reload();
  await expect(page.locator('.learning-current-head h2')).toHaveText('Logic và lập luận');
  await expect(page.locator('#messages')).toContainText('Bước nào trong lập luận bị sai?');
  await expect(page.locator('#messages')).not.toContainText('Vì sao đạo hàm của x bình phương là 2x?');
});

test('renaming and archiving a session update the sidebar and retain server data', async ({ page }) => {
  const state = await setupSessions(page);
  await page.goto('/#/audit');
  await page.locator('[data-session-menu="s1"]').click();
  await page.locator('[data-session-rename="s1"]').click();
  await page.fill('[data-session-rename-input]', 'Đạo hàm nâng cao');
  await page.locator('[data-session-rename-form] button[type="submit"]').click();
  await expect(page.locator('[data-session-id="s1"] .ls-title')).toHaveText('Đạo hàm nâng cao');
  expect(state.list.find(item => item.id === 's1').title).toBe('Đạo hàm nâng cao');

  await page.locator('[data-session-menu="s1"]').click();
  await page.locator('[data-session-ask-delete="s1"]').click();
  await expect(page.locator('.ls-confirm')).toContainText('Bài nộp, đánh giá, thành tựu và chứng nhận đã xác minh vẫn được giữ.');
  await page.locator('[data-session-confirm-delete="s1"]').click();
  await expect(page.locator('[data-session-id="s1"]')).toHaveCount(0);
  expect(state.list.find(item => item.id === 's1').archivedAt).toBeTruthy();
  expect(state.details.s1.submissions).toHaveLength(1);
});

test('search filters session titles and keeps the list scoped', async ({ page }) => {
  await setupSessions(page);
  await page.goto('/#/audit');
  await page.fill('#learning-session-search', 'logic');
  await expect(page.locator('.ls-session')).toHaveCount(1);
  await expect(page.locator('.ls-session')).toContainText('Logic và lập luận');
  await page.fill('#learning-session-search', 'không tồn tại');
  await expect(page.locator('.ls-session')).toHaveCount(0);
  await expect(page.locator('.ls-note')).toContainText('Không tìm thấy phiên phù hợp');
});

test('AI context for each session excludes messages from the other session', async ({ page }) => {
  const state = await setupSessions(page);
  const payloads = [];
  await page.route('**/api/debate', async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        analysis: { status: 'incorrect', summary: 'Hãy kiểm tra lại.', issues: [], strengths: [], reply: 'Mình đang hướng dẫn theo phiên hiện tại.' },
      },
    });
  });
  await page.goto('/#/audit');
  await page.locator('[data-session-open="s1"]').click();
  await page.fill('#chat-message', 'Câu hỏi riêng của phiên một');
  await page.locator('#chat-form button').click();
  await expect(page.locator('#messages')).toContainText('Mình đang hướng dẫn theo phiên hiện tại.');

  await page.locator('[data-session-open="s2"]').click();
  await page.fill('#chat-message', 'Câu hỏi riêng của phiên hai');
  await page.locator('#chat-form button').click();
  await expect(page.locator('#messages')).toContainText('Mình đang hướng dẫn theo phiên hiện tại.');

  const serialized = JSON.stringify(payloads);
  expect(payloads).toHaveLength(2);
  expect(serialized).toContain('Câu hỏi riêng của phiên một');
  expect(serialized).toContain('Câu hỏi riêng của phiên hai');
  const first = JSON.stringify(payloads[0]);
  const second = JSON.stringify(payloads[1]);
  expect(first).not.toContain('Bước nào trong lập luận bị sai?');
  expect(second).not.toContain('Vì sao đạo hàm của x bình phương là 2x?');
});

test('mobile history is a drawer and closes without covering the composer', async ({ page }) => {
  await setupSessions(page, { viewport: { width: 390, height: 844 } });
  await page.goto('/#/audit');
  await expect(page.locator('.learning-session-mobilebar')).toBeVisible();
  const panel = page.locator('.learning-sessions');
  await expect(panel).not.toHaveClass(/open/);
  await page.locator('[data-session-drawer]').click();
  await expect(panel).toHaveClass(/open/);
  await page.locator('[data-session-close]').first().click();
  await expect(panel).not.toHaveClass(/open/);
  await expect(page.locator('#chat-message')).toBeVisible();
});
