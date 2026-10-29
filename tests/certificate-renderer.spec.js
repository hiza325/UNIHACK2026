import { expect, test } from '@playwright/test';
import { certificateData } from '../certificate-renderer.js';
import { AVALANCHE_FUJI_CONFIG } from '../avalanche-config.js';

const credential = { skill: 'Tư duy phản biện', issuedAt: '2026-10-29', source: 'mock', status: 'verified' };
const tx = `0x${'ab'.repeat(32)}`;
function issuedCredential() {
  return { ...credential, id: 'record-1', code: 'PXP-SNAPSHOT-0001', source: 'avalanche', network: AVALANCHE_FUJI_CONFIG.network, chainId: AVALANCHE_FUJI_CONFIG.chainId, contractAddress: AVALANCHE_FUJI_CONFIG.contractAddress, transactionStatus: 'confirmed', transactionHash: tx, issueTransactionHash: tx, verification: { source: 'avalanche', checked: true, valid: true, exists: true },
    snapshot: { version: 1, credentialId: 'record-1', certificateCode: 'PXP-SNAPSHOT-0001', recipientName: 'Nguyễn Thị Ánh Tuyết', subject: 'Tư duy phản biện và lập luận', issuedAt: '2026-10-29T12:00:00Z', capturedAt: '2026-10-28T12:00:00Z', evaluationId: 'evaluation-1' } };
}

test('certificate dates and state derive from records, never a claimed verified status', () => {
  expect(certificateData({ name: 'Nguyễn Ánh' }, credential)).toMatchObject({ name: 'Nguyễn Ánh', subject: 'Tư duy phản biện', date: '29/10/2026', state: 'preview', verified: false });
  for (const issuedAt of [null, '2026-02-30', 'invalid']) expect(() => certificateData({ name: 'An' }, { ...credential, issuedAt })).toThrow();
  expect(() => certificateData({}, credential)).toThrow();
  expect(() => certificateData({ name: '{NAME}' }, credential)).toThrow();
  const verified = issuedCredential();
  expect(certificateData({ name: 'An' }, verified).state).toBe('issued');
  expect(certificateData({ name: 'An' }, { ...verified, isTest: true }).state).toBe('preview');
  expect(certificateData({ name: 'An' }, { ...verified, status: 'revoked' })).toMatchObject({ state: 'revoked', verified: false, canExport: false, name: verified.snapshot.recipientName });
});

test('issued PNG/PDF remain identical after Profile, source subject and clock change', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async record => {
    const { certificateData, renderCertificate, exportCertificate } = await import('/certificate-renderer.js');
    const first = certificateData({ name: 'Current Profile' }, record);
    const encode = async data => {
      const { canvas } = await renderCertificate(data);
      const digests = [];
      for (const format of ['png', 'pdf']) {
        const bytes = await (await exportCertificate(canvas, format)).arrayBuffer();
        digests.push(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).join(','));
      }
      return digests;
    };
    const before = await encode(first);
    const OriginalDate = Date;
    globalThis.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2040-01-01T00:00:00Z'])); } static now() { return 2208988800000; } };
    try {
      const second = certificateData({ name: 'Changed Profile' }, { ...record, skill: 'FORGED SUBJECT', issuedAt: '2040-01-01' });
      return { first, second, sameBytes: JSON.stringify(before) === JSON.stringify(await encode(second)), frozen: Object.isFrozen(second) };
    } finally { globalThis.Date = OriginalDate; }
  }, issuedCredential());
  expect(result.sameBytes).toBe(true);
  expect(result.first).toEqual(result.second);
  expect(result.second).toMatchObject({ name: 'Nguyễn Thị Ánh Tuyết', subject: 'Tư duy phản biện và lập luận', date: '29/10/2026', code: 'PXP-SNAPSHOT-0001', verified: true });
  expect(result.frozen).toBe(true);
});

test('legacy, mismatched snapshot and revoked records cannot export active certificates', async ({ page }) => {
  await page.goto('/');
  for (const variant of ['legacy', 'mismatch', 'revoked', 'unchecked']) {
    const record = issuedCredential();
    if (variant === 'legacy') record.snapshot = null;
    if (variant === 'mismatch') record.snapshot.certificateCode = 'PXP-OTHER-0001';
    if (variant === 'revoked') { record.status = 'revoked'; record.transactionStatus = 'revoked'; }
    if (variant === 'unchecked') record.verification.checked = false;
    const result = await page.evaluate(async record => {
      const { mountCertificatePreview, certificateData, renderCertificate, exportCertificate } = await import('/certificate-renderer.js');
      const container = document.createElement('section'); document.body.replaceChildren(container);
      await mountCertificatePreview(container, { name: 'Wrong current Profile' }, record);
      const data = certificateData({ name: 'Wrong current Profile' }, record);
      let blocked = false;
      try { const { canvas } = await renderCertificate(data); await exportCertificate(canvas, 'png'); } catch { blocked = true; }
      return { text: container.textContent, buttons: container.querySelectorAll('button').length, blocked, data };
    }, record);
    expect(result.buttons).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.text).not.toContain('Wrong current Profile');
    expect(result.data.verified).toBe(false);
    if (['legacy', 'mismatch'].includes(variant)) expect(result.text).toContain('Chứng nhận thiếu dữ liệu lịch sử');
    if (variant === 'revoked') { expect(result.text).toContain('Revoked'); expect(result.text).not.toContain('Verified'); expect(result.data.name).toBe(record.snapshot.recipientName); }
  }
});

test('preview follows current Profile and never promotes a claimed verified status', () => {
  expect(certificateData({ name: 'Tên mới' }, credential)).toMatchObject({ name: 'Tên mới', state: 'preview', verified: false });
  expect(certificateData({ name: 'Tên cũ' }, credential).name).toBe('Tên cũ');
});

test('clean template removes ink from placeholders and preserves every pixel outside repair areas', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const images = await Promise.all(['certificate-template.png', 'certificate-template-clean.png'].map(async name => {
      const image = new Image(); image.src = `/assets/certificates/${name}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 1024;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, 1536, 1024).data;
    }));
    const regions = [[680, 477, 180, 47], [675, 630, 190, 39], [390, 875, 105, 33]];
    let outsideChanges = 0, originalInk = 0, remainingInk = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1536; x++) {
      const i = (y * 1536 + x) * 4;
      const inside = regions.some(([rx, ry, w, h]) => x >= rx && x < rx + w && y >= ry && y < ry + h);
      if (inside) { if (images[0][i] < 120) originalInk++; if (images[1][i] < 120) remainingInk++; }
      else if ([0, 1, 2, 3].some(c => images[0][i + c] !== images[1][i + c])) outsideChanges++;
    }
    return { outsideChanges, originalInk, remainingInk };
  });
  expect(result.outsideChanges).toBe(0);
  expect(result.originalInk).toBeGreaterThan(1000);
  expect(result.remainingInk).toBe(0);
});

for (const [label, name, subject] of [
  ['short', 'An', 'Logic'],
  ['vietnamese', 'Nguyễn Thị Ánh Tuyết', 'Tư duy phản biện và lập luận'],
  ['long', 'Nguyễn Hoàng Phương Anh Trần Thị Minh Ngọc', 'Phân tích lập luận khoa học và đánh giá bằng chứng trong các tình huống thực tế'],
]) {
  test(`renderer fits ${label} text and exports PNG and landscape PDF`, async ({ page }, testInfo) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ name, subject }) => {
      const { renderCertificate, exportCertificate } = await import('/certificate-renderer.js');
      const { canvas, layouts } = await renderCertificate({ name, subject, date: '29/10/2026', state: 'preview' });
      document.body.replaceChildren(canvas);
      const png = await exportCertificate(canvas, 'png');
      const bitmap = await createImageBitmap(png);
      const pdf = await exportCertificate(canvas, 'pdf');
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      const xref = Number(text.match(/startxref\n(\d+)/)[1]);
      return { layouts, width: bitmap.width, height: bitmap.height, pngType: png.type, pdfType: pdf.type, pdfHeader: text.slice(0, 8), landscape: text.includes('/MediaBox [0 0 842 595]'), xrefValid: new TextDecoder().decode(bytes.slice(xref, xref + 4)) === 'xref' };
    }, { name, subject });
    expect(result).toMatchObject({ width: 1536, height: 1024, pngType: 'image/png', pdfType: 'application/pdf', pdfHeader: '%PDF-1.4', landscape: true, xrefValid: true });
    for (const layout of result.layouts) { expect(layout.width).toBeLessThanOrEqual(layout.maxWidth); expect(layout.size).toBeGreaterThanOrEqual(14); }
    expect(result.layouts.map(l => l.text)).toEqual([name, subject, '29/10/2026']);
    await page.locator('canvas').screenshot({ path: testInfo.outputPath(`certificate-${label}.png`) });
  });
}

test('passport preview uses Profile name and selected credential, with working download buttons', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('paradox-session', JSON.stringify({ id: 'renderer-test', name: 'Nguyễn Minh Anh', email: 'renderer@example.com' })));
  await page.goto('/#/passport');
  await page.locator('[data-certificate-details]').first().click();
  const preview = page.locator('[data-certificate-preview]');
  await expect(preview.locator('canvas')).toBeVisible();
  await expect(preview).toContainText('Preview · Chưa phát hành / Not verified');
  await expect(preview.locator('canvas')).toHaveAttribute('aria-label', /Nguyễn Minh Anh/);
  for (const format of ['PNG', 'PDF']) {
    const downloaded = page.waitForEvent('download');
    await preview.getByRole('button', { name: `↓ ${format}`, exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe(`paradox-certificate-preview.${format.toLowerCase()}`);
    expect(await download.failure()).toBeNull();
  }
});
