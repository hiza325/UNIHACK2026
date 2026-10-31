// Markdown -> Word-HTML (.doc), so the phase report is openable in Word and
// importable in Google Docs. Hand-rolled OOXML is not an option here: a .docx
// built from raw ZIP parts passed XML validation yet Word still refused it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, '../docs/audit/05-phase-verification-summary.md'), 'utf8');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<span style="font-family:Consolas,monospace">$1</span>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<i>$1</i>');

const rows = (lines, start) => {
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const header = cells(lines[start]);
  let i = start + 2;
  const body = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]));
  const th = header.map((c) => `<td style="background:#E8EDF2"><b>${inline(c)}</b></td>`).join('');
  const tr = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
  return { html: `<table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse;width:100%">\n<tr>${th}</tr>\n${tr}\n</table>\n`, next: i };
};

let out = '';
const lines = source.split(/\r?\n/);
for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (line.trim().startsWith('|')) { const r = rows(lines, i); out += r.html; i = r.next; continue; }
  const heading = /^(#{1,4})\s+(.*)$/.exec(line);
  if (heading) { const n = heading[1].length; out += `<h${n}>${inline(heading[2])}</h${n}>\n`; i += 1; continue; }
  const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
  if (bullet) {
    out += '<ul>';
    while (i < lines.length) { const b = /^[-*]\s+(.*)$/.exec(lines[i].trim()); if (!b) break; out += `<li>${inline(b[1])}</li>`; i += 1; }
    out += '</ul>\n'; continue;
  }
  const numbered = /^\d+\.\s+(.*)$/.exec(line.trim());
  if (numbered) {
    out += '<ol>';
    while (i < lines.length) { const n = /^\d+\.\s+(.*)$/.exec(lines[i].trim()); if (!n) break; out += `<li>${inline(n[1])}</li>`; i += 1; }
    out += '</ol>\n'; continue;
  }
  if (!line.trim()) { i += 1; continue; }
  out += `<p>${inline(line)}</p>\n`;
  i += 1;
}

const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>PARADOX AI — Nghiệm thu theo giai đoạn</title>
<style>
body{font-family:"Segoe UI",Arial,sans-serif;font-size:11pt;color:#12242e;line-height:1.5}
h1{font-size:19pt;color:#0b3d5c;border-bottom:2px solid #0b3d5c;padding-bottom:4pt}
h2{font-size:14pt;color:#0b3d5c;margin-top:16pt}
h3{font-size:12pt;color:#1c5a80;margin-top:12pt}
table{margin:8pt 0}
td{vertical-align:top}
ul,ol{margin:6pt 0 6pt 18pt}
@page WordSection1{size:595.3pt 841.9pt;margin:56.7pt}div.WordSection1{page:WordSection1}
</style></head>
<body><div class="WordSection1">
${out}</div></body></html>`;

const target = path.join(root, '../docs/audit/PARADOX-Ket-qua-nghiem-thu-theo-giai-doan.doc');
writeFileSync(target, '\uFEFF' + doc, 'utf8');
console.log('WROTE', target, Buffer.byteLength('\uFEFF' + doc), 'bytes');
