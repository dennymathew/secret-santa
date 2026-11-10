import { logo, render, on, $, busy, showError, go, esc } from '../ui';
import { api } from '../api';
import { sendCode, confirmCode, googleSignIn, takeGoogleError, DEV_MODE, TEST_SITE } from '../auth';

export async function verifyView() {
  const googleError = takeGoogleError();
  render(`
    ${logo()}
    <section class="card festive">
      <h2>Who's there? 🔔</h2>
      ${DEV_MODE ? `<p class="notice">${TEST_SITE ? '🧪 Test site' : '🛠 Dev mode'}: no real SMS. The code is <b>123456</b>.</p>` : ''}
      <form id="phone-form" class="stack" novalidate>
        <div>
          <label for="phone">Your mobile number</label>
          <div class="phone-row">
            <select id="cc" aria-label="Country code">
              <option value="+49">🇩🇪 +49</option>
              <option value="+91">🇮🇳 +91</option>
            </select>
            <input id="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="151 2345 6789" required />
          </div>
        </div>
        <p class="error" id="phone-err" hidden></p>
        <button class="btn" id="send" type="submit">Send me a code 📩</button>
      </form>

      <form id="otp-form" class="stack" hidden novalidate>
        <p>We sent a 6-digit code to <b id="sent-to"></b>.</p>
        <div>
          <label for="otp">Code from the SMS</label>
          <input id="otp" class="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" required />
        </div>
        <p class="error" id="otp-err" hidden></p>
        <button class="btn green" id="confirm" type="submit">Verify ✅</button>
        <button class="link" type="button" id="change">Use a different number</button>
      </form>
    </section>

    <section class="card">
      <div class="divider">SMS not arriving?</div>
      <p class="muted center">Sign in with your Google account instead. We match your Google name to the list.</p>
      ${googleError ? `<p class="error">${esc(googleError)}</p><p class="muted">Tip: if you opened this link inside WhatsApp, tap ⋮ / the share icon and choose <b>Open in Chrome</b> or <b>Open in Safari</b>.</p>` : ''}
      <button class="btn ghost" id="google" type="button">
        <svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:-3px;margin-right:6px" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Sign in with Google
      </button>
    </section>
  `);

  let phoneE164 = '';
  on('#phone-form', 'submit', async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('#send');
    $('#phone-err').hidden = true;
    const raw = $<HTMLInputElement>('#phone').value.trim();
    const full = raw.startsWith('+') || raw.startsWith('00') ? raw : $<HTMLSelectElement>('#cc').value + raw.replace(/^0+/, '');
    try {
      await busy(btn, 'Checking the list… 📜', async () => {
        const check = await api<{ ok: boolean; phone?: string; error?: string }>('/check-phone', { body: { phone: full } });
        if (!check.ok) throw new Error(check.error);
        phoneE164 = check.phone!;
        btn.innerHTML = 'Sending SMS… 📩';
        await sendCode(phoneE164, 'recaptcha');
      });
      $('#sent-to').textContent = phoneE164;
      $('#phone-form').hidden = true;
      $('#otp-form').hidden = false;
      $<HTMLInputElement>('#otp').focus();
    } catch (err) {
      showError('#phone-err', err);
    }
  });

  on('#otp', 'input', () => {
    const el = $<HTMLInputElement>('#otp');
    el.value = el.value.replace(/\D/g, '').slice(0, 6);
    if (el.value.length === 6) $<HTMLFormElement>('#otp-form').requestSubmit();
  });

  on('#otp-form', 'submit', async (e) => {
    e.preventDefault();
    $('#otp-err').hidden = true;
    const code = $<HTMLInputElement>('#otp').value;
    if (code.length !== 6) return showError('#otp-err', new Error('Please enter all 6 digits.'));
    try {
      await busy($<HTMLButtonElement>('#confirm'), 'Checking… 🔍', () => confirmCode(code));
      go('#/home');
    } catch (err) {
      showError('#otp-err', err);
    }
  });

  on('#change', 'click', () => {
    $('#otp-form').hidden = true;
    $('#phone-form').hidden = false;
  });

  on('#google', 'click', async () => {
    try {
      await busy($<HTMLButtonElement>('#google'), 'Opening Google…', googleSignIn);
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
    }
  });
}
