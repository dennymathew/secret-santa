import { logo, render, on, $, busy, esc } from '../ui';
import { googleSignIn, takeGoogleError, DEV_MODE, TEST_SITE } from '../auth';

const GOOGLE_ICON = `<svg width="18" height="18" viewBox="0 0 48 48" style="vertical-align:-3px;margin-right:6px" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

export async function verifyView() {
  const googleError = takeGoogleError();
  render(`
    ${logo()}
    <section class="card festive">
      <h2>Who's there?</h2>
      ${DEV_MODE ? `<p class="notice">${TEST_SITE ? '🧪 Test site' : '🛠 Dev mode'}: no real Google. Type any name and email that's on the list.</p>` : ''}
      <p>🎄 This game is <b>exclusively for the Berlin Mallus group</b>.</p>
      <p class="muted">If Santa has approved you as a Berlin Mallu, your name is already on the list.
        Sign in with your Google account and you're in. Santa recognizes you by your Google profile.</p>
      ${
        googleError
          ? `<p class="error">${esc(googleError)}</p>
             <p class="muted small">Tip: if you opened this link inside WhatsApp, tap ⋮ or the share icon and choose <b>Open in Chrome</b> or <b>Open in Safari</b>.</p>`
          : ''
      }
      <div class="stack" style="margin-top:12px">
        <button class="btn" id="google" type="button">${GOOGLE_ICON} Sign in with Google</button>
      </div>
      <p class="muted small center" style="margin:12px 0 0">All accounts and user data will be removed on 12 December 2026.</p>
    </section>
  `);

  on('#google', 'click', async () => {
    try {
      await busy($<HTMLButtonElement>('#google'), 'Opening Google…', googleSignIn);
    } catch (err) {
      alert(err instanceof Error ? err.message : err);
    }
  });
}
