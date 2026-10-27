import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const SESSION = { name: 'Test User', email: 'test@example.com' };

function seedSession(page) {
  return page.addInitScript(user => localStorage.setItem('paradox-session', JSON.stringify(user)), SESSION);
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
    expect(await page.locator('link[rel="preload"][as="font"]')).toHaveCount(3);
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

  test('signup creates a session, logout returns to landing', async ({ page }) => {
    await page.goto('/');
    await page.click('#hero-start');
    await page.fill('input[name="name"]', SESSION.name);
    await page.fill('input[name="email"]', SESSION.email);
    await page.fill('input[name="password"]', 'secret123');
    await page.fill('input[name="confirm"]', 'secret123');
    await page.click('.auth-submit');
    await expect(page.locator('.sidebar')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paradox-session'))?.email)).toBe(SESSION.email);

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

    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('paradox-theme'))).toBe('dark');

    await toggle.click();
    await expect(page.locator('body')).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => localStorage.getItem('paradox-theme'))).toBe('light');
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
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paradox-practice') || '[]'))).toContain(0);

    expect(await axeHighImpactViolations(page, 'practice-modal')).toEqual([]);
    await page.locator('.practice-close').click();
    await expect(page.locator('#practice-modal')).toBeHidden();
  });
});

test.describe('history filters', () => {
  test('status chip and search narrow the session list', async ({ page }) => {
    await seedSession(page);
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
