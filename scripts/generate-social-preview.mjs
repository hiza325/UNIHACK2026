import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const logo = await readFile(new URL('logo-mark.svg', root), 'utf8');
const bodyFont = (await readFile(new URL('fonts/QdVPSTAyLFyeg_IDWvOJmVES_Hw4BXoKZA.woff2', root))).toString('base64');
const titleFont = (await readFile(new URL('fonts/xn7gYHE41ni1AdIRggexSg.woff2', root))).toString('base64');
const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html>
<html lang="vi"><head><style>
  @font-face { font-family: 'Preview Body'; src: url(data:font/woff2;base64,${bodyFont}) format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Preview Title'; src: url(data:font/woff2;base64,${titleFont}) format('woff2'); font-weight: 600 800; }
  * { box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
  body { display: grid; grid-template-columns: 1.25fr .75fr; padding: 72px 78px; color: #24382c; background: #f5f2e9; font-family: 'Preview Body', sans-serif; }
  body::before { content: ''; position: absolute; inset: 20px; border: 1px solid #d4d9cb; pointer-events: none; }
  .copy { position: relative; z-index: 1; align-self: center; }
  .brand { display: flex; align-items: center; gap: 17px; margin-bottom: 62px; }
  .brand img { width: 58px; height: 66px; }
  .brand strong { font: 800 27px 'Preview Title', sans-serif; letter-spacing: -.04em; }
  .brand small { display: block; margin-top: 5px; color: #59645c; font-size: 13px; letter-spacing: .11em; }
  .eyebrow { margin-bottom: 18px; color: #a5412c; font-size: 16px; letter-spacing: .12em; text-transform: uppercase; }
  h1 { max-width: 680px; margin: 0; font: 700 65px/1.07 'Preview Title', sans-serif; letter-spacing: -.055em; }
  p { max-width: 650px; margin: 24px 0 0; color: #59645c; font-size: 23px; line-height: 1.5; }
  .art { position: relative; display: grid; place-items: center; }
  .orbit { position: absolute; width: 420px; height: 420px; border: 1px solid #cad2bf; border-radius: 50%; }
  .orbit::before, .orbit::after { content: ''; position: absolute; border: 1px solid #dce1d5; border-radius: 50%; }
  .orbit::before { inset: 42px; }
  .orbit::after { inset: 94px; }
  .sheet { position: relative; z-index: 1; width: 315px; padding: 31px 30px; background: #fffdf7; border: 1px solid #cfd5c8; box-shadow: 12px 14px 0 #e1dfd5; transform: rotate(-3deg); }
  .sheet-head { display: flex; justify-content: space-between; padding-bottom: 19px; border-bottom: 1px solid #d9ddd2; color: #59645c; font-size: 11px; letter-spacing: .08em; }
  .equation { padding: 31px 0 24px; font: 700 39px 'Preview Title', sans-serif; }
  .line { display: flex; gap: 22px; padding: 14px 0; border-top: 1px solid #e1e4db; color: #475541; font-size: 17px; }
  .line small { color: #68736b; }
  .line.wrong { margin-inline: -10px; padding-inline: 10px; color: #a5412c; background: #fbf0eb; border-left: 3px solid #b7472c; }
  .note { margin-top: 20px; padding-left: 15px; border-left: 2px solid #b7472c; color: #a5412c; font-size: 16px; line-height: 1.4; }
</style></head><body>
  <section class="copy">
    <div class="brand"><img src="${logoDataUrl}" alt=""><div><strong>PARADOX AI</strong><small>THINK. QUESTION. UNDERSTAND.</small></div></div>
    <div class="eyebrow">Trợ lý phản biện học tập</div>
    <h1>Đừng vội xem đáp án.</h1>
    <p>Học cách nghĩ qua phản biện học thuật — tự tìm lỗi, tự sửa và hiểu sâu hơn.</p>
  </section>
  <section class="art"><div class="orbit"></div><article class="sheet"><div class="sheet-head"><span>THINKING JOURNAL</span><span>№ 001</span></div><div class="equation">2x + 5 = 13</div><div class="line"><small>01</small><span>2x = 13 − 5</span></div><div class="line"><small>02</small><span>2x = 8</span></div><div class="line wrong"><small>03</small><span>x = 8 − 2</span></div><div class="note">Ở bước cuối, trừ 2<br>hay chia cho 2?</div></article></section>
</body></html>`);
await page.screenshot({ path: fileURLToPath(new URL('social-preview.png', root)), type: 'png' });
await browser.close();
console.log('Generated social-preview.png (1200×630)');
