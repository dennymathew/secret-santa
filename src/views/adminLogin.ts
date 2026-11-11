// The separate admin sign-in: Google only, and only for emails on the admin list (scripts/admins.sh).
// It gives an admin session, never a participant sign-in.
import { render, on, $, busy, esc, adminBar, logo } from '../ui';
import { googleSignIn, takeAdminError, DEV_MODE, TEST_SITE } from '../auth';
import { GOOGLE_ICON } from './verify';

export async function adminLoginView() {
  const error = takeAdminError();
  render(`
    ${adminBar()}
    ${logo()}
    <section class="card festive">
      <h2>🛠 Admin sign-in</h2>
      <p class="muted">For admins only.</p>
      ${DEV_MODE ? `<p class="notice">${TEST_SITE ? '🧪 Test site' : '🛠 Dev mode'}: no real Google. Type an admin's email.</p>` : ''}
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      <div class="stack" style="margin-top:12px">
        <button class="btn" id="google" type="button">${GOOGLE_ICON} Sign in with Google</button>
      </div>
      <p class="muted small" style="margin:12px 0 0">This signs you in to the admin panel only. To open your own envelope, sign out and use the normal sign-in.</p>
    </section>
    <div class="footer-links"><a href="#/verify" class="link">← Back to the normal sign-in</a></div>
  `);
  on('#google', 'click', async () => {
    try {
      await busy($<HTMLButtonElement>('#google'), 'Opening Google…', () => googleSignIn('admin'));
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
    }
  });
}
