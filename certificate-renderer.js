import { hasActualAvalancheVerification, isCertificateCode } from './learning-passport-service.js';

export const CERTIFICATE_TEMPLATE = new URL('./assets/certificates/certificate-template-clean.png', import.meta.url).href;
const FONT = '"Be Vietnam Pro"';
const resolvedData = new WeakSet();
const exportPermissions = new WeakMap();

function requiredText(value) {
  const text = String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!text || /\{(?:NAME|SUBJECT|DATE)\}/i.test(text)) throw new Error('Certificate information is incomplete');
  return text;
}

export function certificateData(profile, credential) {
  const revoked = credential?.status === 'revoked' || credential?.transactionStatus === 'revoked' || credential?.transactionStatus === 'revoke_pending' || Boolean(credential?.revokedAt) || credential?.verification?.revoked === true;
  const official = credential?.source === 'avalanche' && !credential.isTest;
  const snapshot = credential?.snapshot;
  const code = String(credential?.code || '');
  const historical = official && (Boolean(snapshot?.issuedAt || credential.issuedAt || credential.issueTransactionHash) || ['confirmed', 'revoked', 'revoke_pending'].includes(credential.transactionStatus) || ['verified', 'revoked'].includes(credential.status));
  if (official && (!snapshot || snapshot.version !== 1 || !snapshot.recipientName || !snapshot.subject || !snapshot.capturedAt || !snapshot.evaluationId || snapshot.credentialId !== credential.id || snapshot.certificateCode !== code || !isCertificateCode(code) || (historical && !snapshot.issuedAt))) {
    return Object.freeze({ state: 'legacy', revoked, code, canExport: false, verified: false });
  }
  const useSnapshot = official && (historical || revoked);
  const name = requiredText(useSnapshot ? snapshot.recipientName : profile?.name);
  const subject = requiredText(useSnapshot ? snapshot.subject : credential?.skill);
  const rawDate = String(useSnapshot ? snapshot.issuedAt || '' : credential?.issuedAt || '').slice(0, 10);
  const date = new Date(`${rawDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== rawDate) {
    throw new Error('Certificate issue date is unavailable');
  }
  const state = revoked ? 'revoked' : useSnapshot ? 'issued' : 'preview';
  const verified = state === 'issued' && hasActualAvalancheVerification(credential);
  const result = Object.freeze({ name, subject, date: rawDate.split('-').reverse().join('/'), code, state, verified, canExport: state === 'preview' || verified });
  resolvedData.add(result);
  return result;
}

export async function renderCertificate(data) {
  if (data.state === 'legacy' || (data.state !== 'preview' && !resolvedData.has(data))) throw new Error('Certificate requires an authoritative snapshot');
  const fields = [requiredText(data.name), requiredText(data.subject), requiredText(data.date)];
  await document.fonts.load(`40px ${FONT}`, fields.join(' '));
  if (!document.fonts.check(`40px ${FONT}`, fields.join(' '))) throw new Error('Certificate font could not load');
  const image = new Image(); image.src = CERTIFICATE_TEMPLATE;
  await image.decode();
  if (image.width !== 1536 || image.height !== 1024) throw new Error('Invalid certificate template');
  const canvas = document.createElement('canvas'); canvas.width = 1536; canvas.height = 1024;
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
  ctx.fillStyle = '#081c1d'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const layouts = [];
  for (const [index, x, y, width, maxSize] of [[0, 768, 500, 900, 42], [1, 768, 649, 900, 32], [2, 441, 892, 248, 23]]) {
    let size = maxSize;
    do { ctx.font = `400 ${size}px ${FONT}`; if (ctx.measureText(fields[index]).width <= width) break; size--; } while (size >= 14);
    if (size < 14) throw new Error('Certificate text is too long to fit legibly');
    ctx.fillText(fields[index], x, y);
    layouts.push({ text: fields[index], size, width: ctx.measureText(fields[index]).width, maxWidth: width });
  }
  // The exported preview must remain distinguishable even outside the website.
  if (data.state !== 'issued' || !data.verified) {
    ctx.font = `400 16px ${FONT}`;
    ctx.fillText(data.state === 'revoked' ? 'REVOKED — ĐÃ THU HỒI' : data.state === 'issued' ? 'ISSUED — VERIFICATION UNAVAILABLE' : 'PREVIEW — NOT ISSUED / BẢN XEM TRƯỚC', 768, 1007);
  }
  canvas.setAttribute('aria-label', `${data.state}: ${data.code || ''} · ${fields.join(' · ')}`);
  if (data.code) canvas.dataset.certificateCode = data.code;
  exportPermissions.set(canvas, data.state === 'preview' || data.canExport === true);
  canvas.setAttribute('role', 'img');
  canvas.style.cssText = 'display:block;width:100%;height:auto;aspect-ratio:3/2';
  return { canvas, layouts };
}

export async function exportCertificate(canvas, format) {
  if (exportPermissions.get(canvas) !== true) throw new Error('Certificate export is unavailable');
  if (format === 'png') return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'));
  if (format !== 'pdf') throw new Error('Unsupported certificate format');
  // Single raster page: embeds rendered Vietnamese glyphs without external PDF/font dependencies.
  const jpeg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.98).split(',')[1]), c => c.charCodeAt(0));
  const encoder = new TextEncoder(); const chunks = []; const offsets = [0]; let length = 0;
  const append = value => { const bytes = typeof value === 'string' ? encoder.encode(value) : value; chunks.push(bytes); length += bytes.length; };
  const object = (id, body) => { offsets[id] = length; append(`${id} 0 obj\n${body}\nendobj\n`); };
  append('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Image 4 0 R >> >> /Contents 5 0 R >>');
  offsets[4] = length;
  append(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width 1536 /Height 1024 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  append(jpeg); append('\nendstream\nendobj\n');
  const content = 'q\n842 0 0 561.3333 0 16.8333 cm\n/Image Do\nQ\n';
  object(5, `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`);
  const xref = length;
  append(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export async function mountCertificatePreview(container, profile, credential) {
  try {
    const data = certificateData(profile, credential);
    container.dataset.certificateState = data.state;
    if (data.state === 'legacy') {
      container.textContent = `${data.revoked ? 'Revoked · Đã thu hồi. ' : ''}Chứng nhận thiếu dữ liệu lịch sử`;
      return;
    }
    const { canvas } = await renderCertificate(data);
    const label = document.createElement('p');
    label.textContent = data.state === 'revoked' ? 'Revoked · Đã thu hồi' : data.state === 'issued' ? (data.verified ? 'Issued · Verified (Avalanche evidence)' : 'Issued · Chưa xác minh hiệu lực') : 'Preview · Chưa phát hành / Not verified';
    const identity = document.createElement('p');
    identity.textContent = data.code ? `Certificate ID: ${data.code}` : 'Preview · Chưa có Certificate ID';
    const notice = document.createElement('p');
    notice.textContent = 'Avalanche lưu evidence hash; Name/Subject là snapshot do backend lưu, không được blockchain chứng thực riêng.';
    container.replaceChildren(label, identity, canvas, notice);
    if (!data.canExport) return;
    for (const format of ['png', 'pdf']) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost-button'; button.textContent = `↓ ${format.toUpperCase()}`;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const blob = await exportCertificate(canvas, format);
          const url = URL.createObjectURL(blob); const link = document.createElement('a');
          link.href = url; link.download = `paradox-certificate-${data.state}.${format}`; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 30000);
        } catch { label.textContent = 'Export failed. Please retry.'; }
        finally { button.disabled = false; }
      });
      container.append(button);
    }
  } catch (error) { container.textContent = error.message; }
}
