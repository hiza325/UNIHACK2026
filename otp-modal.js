const OTP_API = 'http://localhost:3000/api/otp';

async function callOtp(path, body) {
  const r = await fetch(`${OTP_API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

function injectStyle() {
  if (document.getElementById('otp-style')) return;
  const s = document.createElement('style');
  s.id = 'otp-style';
  s.textContent = `
    .otp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:9999}
    .otp-box{background:#fff;color:#1c2418;border-radius:16px;padding:28px;width:min(380px,92vw);font-family:'DM Sans',sans-serif}
    .otp-box h3{margin:0 0 6px;font-size:20px}
    .otp-box p{margin:0 0 16px;font-size:14px;color:#5b6652}
    .otp-box input{width:100%;box-sizing:border-box;padding:12px;font-size:22px;letter-spacing:8px;text-align:center;border:1px solid #cfd6c7;border-radius:10px}
    .otp-box button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;font-weight:600;cursor:pointer}
    .otp-verify{background:#527d32;color:#fff}
    .otp-resend{background:transparent;color:#527d32}
    .otp-resend:disabled{color:#9aa591;cursor:default}
    .otp-msg{min-height:20px;margin-top:10px;font-size:13px;color:#b3261e}
    .otp-msg.ok{color:#527d32}
  `;
  document.head.append(s);
}

export function openOtpModal({ email, onVerified }) {
  injectStyle();
  const overlay = document.createElement('div');
  overlay.className = 'otp-overlay';
  overlay.innerHTML = `
    <div class="otp-box" role="dialog" aria-modal="true">
      <h3>Xác minh email</h3>
      <p>Chúng tôi đã gửi mã 6 số tới <strong class="otp-email"></strong>. Mã có hiệu lực trong 5 phút.</p>
      <input class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••" />
      <button class="otp-verify">Xác minh</button>
      <button class="otp-resend" disabled>Gửi lại mã</button>
      <div class="otp-msg" role="status"></div>
    </div>`;
  overlay.querySelector('.otp-email').textContent = email;
  document.body.append(overlay);

  const input = overlay.querySelector('.otp-input');
  const verifyBtn = overlay.querySelector('.otp-verify');
  const resendBtn = overlay.querySelector('.otp-resend');
  const msg = overlay.querySelector('.otp-msg');
  const say = (t, ok = false) => { msg.textContent = t; msg.classList.toggle('ok', ok); };

  let timer;
  function startCooldown(sec = 60) {
    resendBtn.disabled = true;
    let left = sec;
    resendBtn.textContent = `Gửi lại mã (${left}s)`;
    clearInterval(timer);
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        resendBtn.disabled = false;
        resendBtn.textContent = 'Gửi lại mã';
      } else {
        resendBtn.textContent = `Gửi lại mã (${left}s)`;
      }
    }, 1000);
  }

  async function send() {
    say('Đang gửi mã...', true);
    try {
      const d = await callOtp('send', { email });
      if (d.ok) { say('Đã gửi mã, kiểm tra email (cả mục Spam)', true); startCooldown(); }
      else { say(d.error || 'Không gửi được mã'); resendBtn.disabled = false; resendBtn.textContent = 'Gửi lại mã'; }
    } catch {
      say('Không kết nối được server');
      resendBtn.disabled = false;
      resendBtn.textContent = 'Gửi lại mã';
    }
  }

  verifyBtn.onclick = async () => {
    const otp = input.value.trim();
    if (!/^\d{6}$/.test(otp)) return say('Vui lòng nhập đủ 6 số');
    verifyBtn.disabled = true;
    try {
      const d = await callOtp('verify', { email, otp });
      if (d.ok) { clearInterval(timer); overlay.remove(); onVerified?.(); }
      else say(d.error || 'OTP không đúng');
    } catch {
      say('Không kết nối được server');
    }
    verifyBtn.disabled = false;
  };

  resendBtn.onclick = send;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyBtn.click(); });
  input.focus();
  send(); // tự gửi mã ngay khi mở
}