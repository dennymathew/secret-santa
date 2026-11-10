# 🎅 Berlin Mallu Santa

A cute, mobile-first Secret Santa site for the Berlin Mallus.

- **Sign in with Google** (Firebase). No phone numbers, no SMS. Santa finds you on the list by your **Gmail address** if the admin entered one, otherwise by your **Google name**. A name match is only used when exactly one person fits, and it then locks that Google account to you (first come, first served, shown in the log; the admin can unlink it).
- Open your envelope once, with a drum roll 🥁 and confetti 🎉. Every later visit shows the same match.
- **Families** are groups the admin defines, not surnames. Family members never draw each other.
- **Kids** have their own draw, so kids give to kids. They never sign in: any adult in their family opens the kid's envelope on their own phone, together with the kid.
- The **draw runs on the server** and is stored **encrypted** with a key nobody has seen. The admin can't see matches.
- **Everyone sees the same status board** as the admin: who has opened their envelope, plus an activity log.
- **Emergency unseal:** the admin can see all matches only after **5 participants approve**, and everyone sees that it happened.
- The **admin panel is locked with a password**, which the server checks on every admin request. It has a **restart switch**: redraw (keep the list) or wipe everything.
- A separate **test site** with its **own database**, with a fake Google sign-in (type any name and email), so you can try the whole flow after deploying.
- The site closes automatically on **26 Dec 2026**.

Stack: Vite + vanilla TypeScript (frontend), Cloudflare Pages Functions + Hono (API), Cloudflare D1 (SQLite), Firebase Auth (Google). Everything runs on free plans.

---

## Local development (no Firebase, no real Google)

```bash
npm install
cp .dev.vars.example .dev.vars        # then put a real key in MATCH_KEY: openssl rand -base64 32
npm run db:migrate:local
npx vite build && npx wrangler pages dev dist --port 8788
```

Open http://localhost:8788. With no Firebase config, the site runs in **dev mode**:
- "Sign in with Google" asks for a fake name and email. Use an email or name that's on the list.
- `dev@example.com` may sign in even before any list exists (`ADMIN_EMAILS` in `.dev.vars`). Open `#/admin` and unlock it with the local password **local-admin-123** (from `.dev.vars.example`; set your own with `./scripts/set-admin-password.sh --local`).

Dev sign-in only works when **both** `DEV_AUTH=1` is set **and** the request comes from localhost.

Tests: `npm test` · Type check: `npm run typecheck`

---

## Going live (one-time setup, about 30 minutes)

### 1. Firebase (sign-in)
1. Create a project at https://console.firebase.google.com (e.g. `berlinmallusanta`).
2. The free **Spark** plan is enough (Google sign-in needs no billing).
3. *Authentication → Sign-in method*: enable **Google** (leave Phone off).
4. *Authentication → Settings → Authorized domains*: add `berlinmallusanta.pages.dev`.
5. *Project settings → Your apps*: add a **Web app** and note `apiKey`, `projectId` and `appId`. These are public and safe.
6. Google sign-in through our own domain: in the [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials), open *Web client (auto created by Google Service)* and add
   - Authorized JavaScript origin: `https://berlinmallusanta.pages.dev`
   - Authorized redirect URI: `https://berlinmallusanta.pages.dev/__/auth/handler`

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
- No build environment variables are needed. The public Firebase web config (from Firebase step 5) is in `vite.config.ts`, and is only built in when Cloudflare builds the production branch `main`. Test-site and local builds never contain it, so they can't use real Google sign-in. The Node version comes from `.node-version`.

Then set the secrets:
```bash
npx wrangler pages secret put ADMIN_EMAILS --project-name berlinmallusanta --env production   # your Gmail address (comma-separate several)
./scripts/set-match-key.sh                                                   # seals the matches; the key is never shown
./scripts/set-admin-password.sh                                              # the admin panel password (only a hash is stored)
```
- `ADMIN_EMAILS` only lets these people **sign in before they're on the list**, so you can paste the first list. It doesn't make anyone admin.
- **Admin = whoever knows the admin password**, and is signed in as someone on the list or in `ADMIN_EMAILS`. Use at least 10 characters. Running the script again changes the password and logs out every open admin panel.
Redeploy (*Deployments → Retry*), so the new secrets are picked up.

> If your Pages URL ends up different (for example, the name was taken), replace `berlinmallusanta.pages.dev` everywhere above **and** in the `og:` tags in `index.html`.

### 4. Test site (separate database, fake Google sign-in)
Every Pages **preview** deployment (any branch except `main`) is the test site. It uses its own database, `berlinmallusanta-test`, and "Sign in with Google" just asks for a name and email, so you can be anyone on the list. Test mode can't switch on for `main`, even by mistake.
```bash
npx wrangler d1 create berlinmallusanta-test        # copy the database_id into [[env.preview.d1_databases]] in wrangler.toml
npx wrangler d1 migrations apply berlinmallusanta-test --remote --env preview
./scripts/set-match-key.sh --preview                # the test site's own key (never shown)
./scripts/set-admin-password.sh --preview           # the test site's admin password
npx wrangler pages secret put ADMIN_EMAILS --project-name berlinmallusanta --env preview
```
Then:
```bash
git switch -c test && git push -u origin test
```
Open **https://test.berlinmallusanta.pages.dev**. It shows a yellow "🧪 TEST SITE" banner. Run the whole flow there, signing in as each person on the list in turn. To test again, push to `test` again (`git switch test && git merge main && git push`).

Before going live, also run the new migration on the real database: `npm run db:migrate:remote`.

### 5. Run the game
1. Open `https://berlinmallusanta.pages.dev`, sign in with Google (the account in `ADMIN_EMAILS`), tap **🛠 Admin** at the bottom, and enter the admin password.
2. Build the list in **1. Participants**: tap **🏠 ＋ Add a family**, give it a name, then **＋ Adult** (name, Gmail optional) and **＋ Kid** (name only). People with no family go under **🙋 Singles**. Add extra **never match** pairs below. Open **📋 View the raw list** to check everything in one table, copy it as text, or paste a whole list in this text format:
   ```
   # Family: Mathew
   Denny, denny@gmail.com         ← email optional
   Priya
   Kid: Aarav
   Kid: Diya

   # Family: Nair-Kurian          ← surnames don't matter, the header does
   Anu
   Biju, biju.nair@gmail.com
   Kid: Ammu

   # Single                       ← people with no family in the group
   Chinnu

   !Anu, Chinnu                   ← extra "never match" pair
   ```
   - Adults: `Name` or `Name, Gmail address`. With an email, Santa recognises them for sure. Without one, their Google account name must contain the name on the list (e.g. `Anu` matches *Anu Mary Kurian*), and only when exactly one person fits. Two people with the same first name need emails (the preview warns you). Kids: `Kid: Name`. A kid must be under a family that has at least one adult.
   - There are two separate draws: adults ↔ adults and kids ↔ kids. In both, family members never get each other, and nobody gets someone who also got them. The kids' draw needs at least 2 kids.
   - **Everyone always gets a match.** Saving the list runs a test draw and shows the result above the Start button. If the rules can't all be met, they are loosened one at a time, least important first: first two people may draw each other, then the extra `!` pairs are ignored, and family members may draw each other only as a last resort. You see what would be loosened and confirm it at Start, and it appears in the public log. Every draw is also checked before it is saved: everyone gives once and receives once, or nothing is saved.
   - Lines starting with any other `#` are comments. To join the game yourself, put yourself on the list with the same Gmail address as in `ADMIN_EMAILS`.
   - Problems show under each person as you type (and in the raw list), and the server checks again when you save. An "Unsaved changes" note stays until you tap **Save list**.
3. **Save list**, then **Start Secret Santa 🎁**. The list is locked from then on.
4. Tap **Share on WhatsApp**. 🎄
5. **Restart**, if needed: the *Danger zone* card at the bottom of the admin panel. Type `RESET` and the password, then choose **Redraw** (keeps the list, deletes matches, opened envelopes and the log, back to Draft) or **Wipe everything** (also deletes the list). Everyone sees "🔄 … restarted the game" in the log.

Before sharing with everyone, try Google sign-in with an email on the list and with a name-only entry. Open the link from inside WhatsApp on an iPhone and an Android phone.

---

## How the secrecy works (and its limits)

- The draw runs inside the Cloudflare function. The result is encrypted (AES-GCM) with `MATCH_KEY` and never returned to the admin.
- `MATCH_KEY` is generated and stored by `scripts/set-match-key.sh` without being printed, and Cloudflare never shows a secret again.
- `/api/reveal` only ever decrypts **your own** envelope. Every reveal is logged, and you see when your envelope was first opened, so a peek would be noticed.
- **Admin password:** every `/api/admin/*` request needs a session token from `/api/admin/login`. The token is signed on the server, expires after 2 hours, only works for the person who signed in, and stops working when the password changes. 5 wrong passwords lock one person out for 15 minutes, and 20 in an hour lock everyone out. Every unlock and wrong try is in the public log. Hiding the password form in the browser changes nothing, because the server refuses anyway.
- `/api/admin/unsealed` works only after `UNSEAL_QUORUM` (5) participants approve. **Anyone who has ever unlocked the admin panel can't approve**, and their approvals don't count, even if they gave them before unlocking. The request, approvals and unsealing all appear in the public log.
- **Honest limit:** the owner of the Cloudflare account could deploy changed code that decrypts everything. That takes deliberate effort and would show in the git history. This protects against peeking by accident, not against a determined cheater.

---

## After Christmas: delete everything
```bash
npx wrangler d1 delete berlinmallusanta
npx wrangler d1 delete berlinmallusanta-test
npx wrangler pages project delete berlinmallusanta
```
Then delete the Firebase project and archive or delete the GitHub repo.
