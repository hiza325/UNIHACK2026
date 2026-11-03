// Reconstruct only the three text interiors from adjacent, matching paper texture.
// Original PNG is preserved. No border, ornament or branding pixels are touched.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const source = await readFile(new URL('../assets/certificates/certificate-template.png', import.meta.url));
  const result = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    if (image.width !== 1536 || image.height !== 1024) throw new Error('Unexpected template dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    for (const [x, y, w, h, sourceX, sourceWidth = w] of [[680, 477, 180, 47, 480], [675, 630, 190, 39, 465], [390, 875, 105, 33, 310, 75]]) {
      // Soft edge blend retains the original paper gradient, never a white fill.
      const original = ctx.getImageData(x, y, w, h);
      ctx.drawImage(image, sourceX, y, sourceWidth, h, x, y, w, h);
      const patch = ctx.getImageData(x, y, w, h);
      for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
        const alpha = Math.min(1, Math.min(col, row, w - 1 - col, h - 1 - row) / 3);
        const i = (row * w + col) * 4;
        for (let c = 0; c < 3; c++) patch.data[i + c] = patch.data[i + c] * alpha + original.data[i + c] * (1 - alpha);
      }
      ctx.putImageData(patch, x, y);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, source.toString('base64'));
  await writeFile(new URL('../assets/certificates/certificate-template-clean.png', import.meta.url), Buffer.from(result, 'base64'));
} finally { await browser.close(); }
