import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('silver homepage keeps all content sections and original CTA contracts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  for (const selector of ['.hero', '#how', '#features', '#audience', '.liquid-lab', '.study-sheet', '.scene-caption', '.landing-statement', '.landing-closing', '.landing-footer']) {
    await expect(page.locator(selector)).toBeVisible();
  }
  await page.locator('#hero-start').click();
  await expect(page.locator('.auth-name-field')).toBeVisible();
  await page.locator('#auth-close').click();
  await page.locator('#landing-login').click();
  await expect(page.locator('.auth-name-field')).toBeHidden();
  await expect(page.locator('.auth-email-field')).toBeVisible();
  await page.locator('#auth-close').click();
  await page.locator('.hero-secondary').click();
  await expect(page).toHaveURL(/#how$/);
  await page.locator('.footer-sitemap').click();
  await expect(page.locator('.sitemap-page')).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile navigation, language and protected-route modal remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#mobile-menu-toggle').click();
  await expect(page.locator('#mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#landing-lang').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.hero h1')).toContainText('Think it through.');
  await page.locator('#mobile-menu-toggle').click();
  await page.locator('#landing-nav-links a[href="#how"]').click();
  await expect(page.locator('#mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/#/passport');
  await expect(page.locator('#auth-backdrop')).toBeVisible();
  await expect(page.locator('.auth-submit')).toBeVisible();
  await page.locator('#auth-close').click();
  await expect(page.locator('.hero')).toBeVisible();
});

test('reduced motion keeps the static mentor and does not load Three.js', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/');
  await expect(page.locator('.silver-robot-fallback')).toBeVisible();
  await page.locator('#landing-login').click();
  await expect(page.locator('#auth-backdrop')).toBeVisible();
  expect(requests.some(url => url.includes('/vendor/three/'))).toBe(false);
  await expect(page.locator('.study-scene canvas')).toHaveCount(0);
});

test('WebGL loss restores the fallback and rerender disposes the old canvas', async ({ page }) => {
  await page.goto('/');
  await page.locator('.study-scene').hover();
  await expect(page.locator('.study-scene canvas')).toHaveCount(1);
  await page.locator('.study-scene canvas').evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost')));
  await expect(page.locator('.silver-robot-fallback')).toBeVisible();
  await expect(page.locator('.study-scene canvas')).toHaveCount(0);
  await page.locator('#landing-lang').click();
  await page.locator('.study-scene').hover();
  await expect(page.locator('.study-scene canvas')).toHaveCount(1);
  await page.locator('.study-scene canvas').evaluate(canvas => { window.oldHomepageCanvas = canvas; });
  await page.locator('.footer-sitemap').click();
  await expect(page.locator('.sitemap-page')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.oldHomepageCanvas.parentNode === null)).toBe(true);
});

test('unavailable WebGL retains readable hero and working signup', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type.includes('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await page.locator('.study-scene').hover();
  await expect(page.locator('.silver-robot-fallback')).toBeVisible();
  await page.locator('#hero-start').click();
  await expect(page.locator('.auth-name-field')).toBeVisible();
});

test('login modal remains accessible in both themes and theme survives refresh', async ({ page }) => {
  await page.goto('/');
  for (const dark of [false, true]) {
    if (dark) await page.locator('[data-theme-toggle]').click();
    await page.locator('#landing-login').click();
    const results = await new AxeBuilder({ page }).include('.auth-panel').analyze();
    expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    await page.locator('#auth-close').click();
  }
  await page.reload();
  await expect(page.locator('[data-theme-toggle]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('paradox-theme'))).toBe('dark');
});
