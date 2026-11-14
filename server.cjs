require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());
app.use(cors({ origin: ['http://127.0.0.1:5500', 'http://localhost:5500'] }));

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// Lưu tạm trong bộ nhớ: email -> { hash, expires, attempts, lastSent }
const otpStore = new Map();
const hash = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

app.post('/api/otp/send', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email không hợp lệ' });
  }

  const old = otpStore.get(email);
  if (old && Date.now() - old.lastSent < 60_000) {
    return res.status(429).json({ error: 'Vui lòng đợi 60 giây rồi gửi lại' });
  }

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  otpStore.set(email, {
    hash: hash(otp),
    expires: Date.now() + 5 * 60_000,
    attempts: 0,
    lastSent: Date.now(),
  });

  try {
    await transporter.sendMail({
      from: `"UNIHACK2026" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Mã OTP của bạn',
      text: `Mã OTP của bạn là ${otp}. Mã có hiệu lực trong 5 phút. Không chia sẻ mã này cho bất kỳ ai.`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Gửi mail lỗi:', err.message);
    otpStore.delete(email);
    res.status(500).json({ error: 'Không gửi được email' });
  }
});

app.post('/api/otp/verify', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '');
  const rec = otpStore.get(email);

  if (!rec || Date.now() > rec.expires) {
    otpStore.delete(email);
    return res.status(400).json({ error: 'OTP không tồn tại hoặc đã hết hạn' });
  }
  if (++rec.attempts > 5) {
    otpStore.delete(email);
    return res.status(429).json({ error: 'Nhập sai quá nhiều lần, hãy gửi lại mã' });
  }
  if (hash(otp) !== rec.hash) {
    return res.status(400).json({ error: 'OTP không đúng' });
  }

  otpStore.delete(email);
  res.json({ ok: true });
});

app.listen(3000, () => console.log('Server chạy ở http://localhost:3000'));