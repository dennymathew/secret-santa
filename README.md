# 🎅 Berlin Mallu Santa

A cute, mobile-first Secret Santa site for the Berlin Mallus.

- Sign in with a 🇩🇪 +49 or 🇮🇳 +91 mobile number and an SMS code (Firebase). If the SMS doesn't arrive, use **Google sign-in**: your Google name is matched to the list, then that Google account is locked to you.
- Open your envelope once, with a drum roll 🥁 and confetti 🎉. Every later visit shows the same match.
- The **draw runs on the server** and is stored **encrypted** with a key nobody has seen. The admin can't see matches.
- **Everyone sees the same status board** as the admin: who has opened their envelope, plus an activity log.
- **Emergency unseal:** the admin can see all matches only after **5 participants approve**, and everyone sees that it happened.
- The site closes automatically on **26 Dec 2026**.

Stack: Vite + vanilla TypeScript (frontend), Cloudflare Pages Functions + Hono (API), Cloudflare D1 (SQLite), Firebase Auth (SMS + Google). The only cost is SMS, at about €0.07–0.10 each.

---

## Local development (no Firebase, no real SMS)

```bash
npm install
cp .dev.vars.example .dev.vars        # then put a real key in MATCH_KEY: openssl rand -base64 32
npm run db:migrate:local
npx vite build && npx wrangler pages dev dist --port 8788
```

Open http://localhost:8788. With no Firebase config, the site runs in **dev mode**:
- Any listed number signs in with the code **123456**.
- "Sign in with Google" asks for a fake name and email.
- `+4915100000000` is the admin (see `.dev.vars`). Open `#/admin` to import a list and start.

Dev sign-in only works when **both** `DEV_AUTH=1` is set **and** the request comes from localhost.

Tests: `npm test` · Type check: `npm run typecheck`

---

## Going live (one-time setup, about 30 minutes)

### 1. Firebase (sign-in)
1. Create a project at https://console.firebase.google.com (e.g. `berlinmallusanta`).
2. **Upgrade to Blaze** (pay as you go). Right away, go to *Google Cloud Billing → Budgets & alerts* and create a **€5 budget alert**.
3. *Authentication → Sign-in method*: enable **Phone** and **Google**.
4. *Authentication → Settings → SMS region policy*: **Allow only** Germany and India. This blocks SMS-fraud costs.
5. *Authentication → Settings → Authorized domains*: add `berlinmallusanta.pages.dev`.
6. *Project settings → Your apps*: add a **Web app** and note `apiKey`, `projectId` and `appId`. These are public and safe.
7. Google sign-in through our own domain: in the [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials), open *Web client (auto created by Google Service)* and add
   - Authorized JavaScript origin: `https://berlinmallusanta.pages.dev`
   - Authorized redirect URI: `https://berlinmallusanta.pages.dev/__/auth/handler`
8. Optional, for testing without SMS costs: *Authentication → Sign-in method → Phone → Phone numbers for testing*.

### 2. GitHub
Create a repo named `berlinmallusanta` (private is fine) and push this code.

### 3. Cloudflare (hosting + database), free
```bash
npx wrangler login
npx wrangler d1 create berlinmallusanta      # copy the database_id into wrangler.toml
npm run db:migrate:remote
```
Also set `FIREBASE_PROJECT_ID` in `wrangler.toml` to your Firebase project id.

Then, in the Cloudflare dashboard, go to *Workers & Pages → Create → Pages → Connect to Git*, pick the repo, and set:
- Project name: **berlinmallusanta**, which gives you `berlinmallusanta.pages.dev`
- Build command: `npm run build` · Output directory: `dist`
- Build environment variables:
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` (from Firebase step 6)
  - `VITE_FIREBASE_AUTH_DOMAIN` = `berlinmallusanta.pages.dev`

Then set the secrets:
```bash
npx wrangler pages secret put ADMIN_PHONES --project-name berlinmallusanta   # e.g. +4915112345678
./scripts/set-match-key.sh                                                   # seals the matches; the key is never shown
```
Redeploy (*Deployments → Retry*), so the new secrets are picked up.

> If your Pages URL ends up different (for example, the name was taken), replace `berlinmallusanta.pages.dev` everywhere above **and** in the `og:` tags in `index.html`.

### 4. Run the game
1. Open `https://berlinmallusanta.pages.dev`, sign in with your admin number, then **Admin panel**.
2. Paste the list, one person per line:
   ```
   Name, Phone, Family
   Anu Kurian, +4915111111111, Kurian
   Biju Kurian, +919847222222, Kurian
   Chinnu, +4916033333333
   !Anu Kurian, Chinnu          ← extra "never match" pair
   ```
   People in the same **Family** never get each other, and nobody gets someone who also got them.
   To join the game yourself, put your own number on the list.
3. **Save list**, then **Start Secret Santa 🎁**. The list is locked from then on.
4. Tap **Share on WhatsApp**. 🎄

Before sharing with everyone, test with one German and one Indian number, and try Google sign-in. Open the link from inside WhatsApp on an iPhone and an Android phone.

---

## How the secrecy works (and its limits)

- The draw runs inside the Cloudflare function. The result is encrypted (AES-GCM) with `MATCH_KEY` and never returned to the admin.
- `MATCH_KEY` is generated and stored by `scripts/set-match-key.sh` without being printed, and Cloudflare never shows a secret again.
- `/api/reveal` only ever decrypts **your own** envelope. Every reveal is logged, and you see when your envelope was first opened, so a peek would be noticed.
- `/api/admin/unsealed` works only after `UNSEAL_QUORUM` (5) non-admin participants approve. The request, approvals and unsealing all appear in the public log.
- **Honest limit:** the owner of the Cloudflare account could deploy changed code that decrypts everything. That takes deliberate effort and would show in the git history. This protects against peeking by accident, not against a determined cheater.

---

## After Christmas: delete everything
```bash
npx wrangler d1 delete berlinmallusanta
npx wrangler pages project delete berlinmallusanta
```
Then delete the Firebase project, or downgrade it to Spark and remove the billing account, and archive or delete the GitHub repo.
