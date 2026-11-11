# 🎅 Berlin Mallu Santa

A cute, mobile-first Secret Santa site for the Berlin Mallus.

- **Sign in with Google** (Firebase). No phone numbers, no SMS. Santa finds you on the list by your **Gmail address** if the admin entered one, otherwise by your **Google name**. A name match is only used when exactly one person fits, and it then locks that Google account to you (first come, first served, shown in the log; the admin can unlink it). An email on the list that was never used can be replaced this way too, after "Are you …?".
- Open your envelope once, with a drum roll 🥁 and confetti 🎉. Every later visit shows the same Secret Santa.
- **Families** are groups the admin defines, not surnames. Family members never draw each other.
- **Kids** have their own draw, so kids give to kids. They never sign in: any adult in their family opens the kid's envelope on their own phone, together with the kid.
- The **draw runs on the server** and is stored **encrypted** with a key nobody has seen. The admin can't see anyone's Secret Santa.
- **Everyone sees the same status board** as the admin: who has opened their envelope, plus an activity log.
- **Emergency unseal:** the admin can see all Secret Santas only after **5 participants approve**, and everyone sees that it happened.
- The **admin panel has its own sign-in** ("🛠 Sign in as admin" at the bottom of the sign-in page): Google only, and only for emails on the admin list (`./scripts/admins.sh`). Admins don't have to be participants. The admin side looks different (dark, with a blue admin bar), and an admin session can't open envelopes: to see your own, sign out and use the normal sign-in. It has a **restart switch**: redraw (keep the list) or wipe everything.
- A separate **test site** with its **own database**, with a fake Google sign-in (type any name and email), so you can try the whole flow after deploying.
- The site closes automatically on **12 Dec 2026** (midnight Berlin time, so the last day to play is 11 Dec). The sign-in page promises that **all accounts and data are removed on 12 December 2026**: the admin does that by hand, see [12 December: remove all data](#12-december-remove-all-data).

Stack: Vite + vanilla TypeScript (frontend), Cloudflare Pages Functions + Hono (API), Cloudflare D1 (SQLite), Firebase Auth (Google). Everything runs on free plans.

---

## 🧰 Command cheat sheet

Run everything from the project folder. **Real** = https://berlinmallusanta.pages.dev (database `berlinmallusanta`) · **Test** = https://test.berlinmallusanta.pages.dev (database `berlinmallusanta-test`) · **Local** = your computer.

### Run locally
| What | Command | Notes |
|---|---|---|
| First-time setup | `npm install && cp .dev.vars.example .dev.vars && npm run db:migrate:local` | Then put a real key in `MATCH_KEY` in `.dev.vars` (`openssl rand -base64 32`) |
| Start the site | `npm run build && npx wrangler pages dev dist --port 8788` | Open http://localhost:8788. Fake Google sign-in. Add yourself as admin first (next row) |
| "No such table" error | `npm run db:migrate:local` | Run after pulling new migrations |
| Run the tests | `npm test` | |
| Type check | `npm run typecheck` | Also runs as part of `npm run build`, so a type error fails the deploy |
| Add a local admin | `./scripts/admins.sh add name@gmail.com --local` | Then "🛠 Sign in as admin" with that email |

### See the databases (read only)
| What | Command | Notes |
|---|---|---|
| Participants: **real** | `npx wrangler d1 execute berlinmallusanta --remote --command "SELECT id, name, family, is_kid, google_email, revealed_at FROM participants"` | |
| Participants: **test** | `npx wrangler d1 execute berlinmallusanta-test --remote --env preview --command "SELECT id, name, family, is_kid, google_email, revealed_at FROM participants"` | |
| Activity log: **real** | `npx wrangler d1 execute berlinmallusanta --remote --command "SELECT ts, type, actor_name, detail FROM events ORDER BY id DESC LIMIT 30"` | For **test**: database `berlinmallusanta-test` and add `--env preview` |
| Game status: **real** | `npx wrangler d1 execute berlinmallusanta --remote --command "SELECT * FROM game"` | Draft or Started |
| Admin sign-ins: **real** | `npx wrangler d1 execute berlinmallusanta --remote --command "SELECT * FROM admin_logins ORDER BY id DESC LIMIT 20"` | |
| Local database | Same commands with `--local` instead of `--remote` | |
| In the browser | dash.cloudflare.com → **Storage & Databases → D1 SQL Database** → pick the database → **Tables** or **Console** | |

> ⚠️ Only use `SELECT` there. The console and `d1 execute` can also change data. Change the list or restart the game in the **admin panel**: it checks the rules and records the change in the public log. Matches are stored encrypted, so they are unreadable here.

### Admin access (secrets)
| What | Command | Notes |
|---|---|---|
| Add admins: **real** | `./scripts/admins.sh add name@gmail.com other@gmail.com` | As many as you like; they don't have to be participants. They sign in with Google via "🛠 Sign in as admin" |
| Add admins: **test** | `./scripts/admins.sh add name@gmail.com --preview` | |
| Remove an admin | `./scripts/admins.sh remove name@gmail.com` (`--preview` for test) | Takes effect at their next click |
| List admins | `./scripts/admins.sh list` (`--preview` for test) | |
| Old secrets, no longer used | `npx wrangler pages secret delete ADMIN_PASSWORD_HASH --project-name berlinmallusanta --env production` | Also `ADMIN_EMAILS` once its admins have signed in once (they're moved to the admin list then), and the same with `--env preview` |
| List secrets | `npx wrangler pages secret list --project-name berlinmallusanta --env production` | Use `--env preview` for test. Only shows the names, never the values |
| Delete the old phone secret | `npx wrangler pages secret delete ADMIN_PHONES --project-name berlinmallusanta --env production` | Not used any more. Also run it with `--env preview` |
| Match key: **real** / **test** | `./scripts/set-match-key.sh` / `./scripts/set-match-key.sh --preview` | Only once, before the game starts. **Never** after the game starts, or nobody can open their envelope |

After changing a secret, redeploy so the site picks it up: Cloudflare dashboard → the Pages project → **Deployments → Retry**, or push a commit.

### Database migrations (after pulling code with a new `migrations/` file)
| What | Command |
|---|---|
| **Real** | `npm run db:migrate:remote` |
| **Test** | `npx wrangler d1 migrations apply berlinmallusanta-test --remote --env preview` |
| **Local** | `npm run db:migrate:local` |

### Deploy
| What | Command | Notes |
|---|---|---|
| Update the **real** site | Merge the PR into `main` on GitHub, then `git switch main && git pull` | Cloudflare builds `main` automatically (about 1 min) |
| Update the **test** site | `git switch main && git pull`, then `git switch test && git merge main && git push`, then `git switch main` | **Always pull `main` first**, or the test site gets old code |
| See **real** deployments | `npx wrangler pages deployment list --project-name berlinmallusanta --environment production` | Status `Failure` = the build failed; open the Build link for logs |
| See **test** deployments | `npx wrangler pages deployment list --project-name berlinmallusanta --environment preview` | |
| Check a site is up | `curl https://berlinmallusanta.pages.dev/api/config` | `{"testMode":false}` on real, `true` on test |

### Accounts and clean-up
| What | Command |
|---|---|
| Log in to Cloudflare | `npx wrangler login` |
| **12 Dec: remove all data** (promised on the sign-in page) | See [12 December: remove all data](#12-december-remove-all-data) |
| After Christmas: delete everything | `npx wrangler d1 delete berlinmallusanta`, `npx wrangler d1 delete berlinmallusanta-test`, `npx wrangler pages project delete berlinmallusanta`, then delete the Firebase project |

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
- Add a local admin with `./scripts/admins.sh add name@gmail.com --local`, then tap **🛠 Sign in as admin** at the bottom of the sign-in page and type that email. Admins don't need to be on the list.

Dev sign-in only works when **both** `DEV_AUTH=1` is set **and** the request comes from localhost.

Tests: `npm test` · Type check: `npm run typecheck`

---

## Going live (one-time setup, about 30 minutes)

Every command used here is also in the [Command cheat sheet](#-command-cheat-sheet).

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
./scripts/set-match-key.sh                                                   # seals the Secret Santas; the key is never shown
npx wrangler d1 migrations apply berlinmallusanta --remote                   # the database tables
./scripts/admins.sh add you@gmail.com                                        # who may sign in to the admin panel
```
- **Admins** sign in with Google via **🛠 Sign in as admin**. Only emails on the admin list get in; they don't have to be participants. Add or remove admins any time with `./scripts/admins.sh`.
Redeploy (*Deployments → Retry*), so the new secrets are picked up.

> If your Pages URL ends up different (for example, the name was taken), replace `berlinmallusanta.pages.dev` everywhere above **and** in the `og:` tags in `index.html`.

### 4. Test site (separate database, fake Google sign-in)
Every Pages **preview** deployment (any branch except `main`) is the test site. It uses its own database, `berlinmallusanta-test`, and "Sign in with Google" just asks for a name and email, so you can be anyone on the list. Test mode can't switch on for `main`, even by mistake.
```bash
npx wrangler d1 create berlinmallusanta-test        # copy the database_id into [[env.preview.d1_databases]] in wrangler.toml
npx wrangler d1 migrations apply berlinmallusanta-test --remote --env preview
./scripts/set-match-key.sh --preview                # the test site's own key (never shown)
./scripts/admins.sh add you@gmail.com --preview      # the test site's admins
```
Then:
```bash
git switch -c test && git push -u origin test
```
Open **https://test.berlinmallusanta.pages.dev**. It shows a yellow "🧪 TEST SITE" banner. Run the whole flow there, signing in as each person on the list in turn. To test again, push to `test` again (`git switch test && git merge main && git push`).

Before going live, also run the new migration on the real database: `npm run db:migrate:remote`.

### 5. Run the game
1. Open `https://berlinmallusanta.pages.dev`, tap **🛠 Sign in as admin** at the bottom, and sign in with Google (an account on the admin list).
2. Build the list in **1. Participants**: tap **🏠 ＋ Add a family**, give it a name, then **＋ Adult** (name, Gmail optional) and **＋ Kid** (name only). People with no family go under **🙋 Singles**. Add extra **never match** pairs below. Open **📋 View the raw list** to check everything in one table or copy it as text. To paste a whole list, tap **📋 Paste a whole list as text**, paste, and tap **Save this list 💾**: it saves and fills in the families. The text format:
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
   - Adults: `Name` or `Name, Gmail address`. With an email, Santa recognises them straight away. The email is only a hint until it's used: if they sign in with a different Google account whose name fits, Santa asks "Are you Denny?", and **Yes** replaces the email on the list (shown in the log). Once an email has signed in, it stays locked to that person (you can still unlink it). Without an email, their Google account name must contain the name on the list (e.g. `Anu` matches *Anu Mary Kurian*), and only when exactly one person fits. Two people with the same first name need emails (the preview warns you). Kids: `Kid: Name`. A kid must be under a family that has at least one adult.
   - There are two separate draws: adults ↔ adults and kids ↔ kids. In both, family members never get each other, and nobody gets someone who also got them. The kids' draw needs at least 2 kids.
   - **Everyone always gets a Secret Santa.** Saving the list runs a test draw and shows the result above the Start button. If the rules can't all be met, they are loosened one at a time, least important first: first two people may draw each other, then the extra `!` pairs are ignored, and family members may draw each other only as a last resort. You see what would be loosened and confirm it at Start, and it appears in the public log. Every draw is also checked before it is saved: everyone gives once and receives once, or nothing is saved.
   - Lines starting with any other `#` are comments. To join the game yourself, put yourself on the list too; to open your envelope, sign out of the admin panel and use the normal sign-in.
   - Problems show under each person as you type (and in the raw list), and the server checks again when you save. An "Unsaved changes" note stays until you tap **Save list**.
3. **Save list**, then **Start Secret Santa 🎁**. The list is locked from then on.
4. Tap **Share on WhatsApp**. 🎄
5. **Restart**, if needed: the *Danger zone* card at the bottom of the admin panel. Type `RESET`, then choose **Redraw** (keeps the list, deletes all Secret Santas, opened envelopes and the log, back to Draft) or **Wipe everything** (also deletes the list). Everyone sees "🔄 … restarted the game" in the log.

Before sharing with everyone, try Google sign-in with an email on the list and with a name-only entry. Open the link from inside WhatsApp on an iPhone and an Android phone.

---

## How the secrecy works (and its limits)

- The draw runs inside the Cloudflare function. The result is encrypted (AES-GCM) with `MATCH_KEY` and never returned to the admin.
- `MATCH_KEY` is generated and stored by `scripts/set-match-key.sh` without being printed, and Cloudflare never shows a secret again.
- `/api/reveal` only ever decrypts **your own** envelope. Every reveal is logged, and you see when your envelope was first opened, so a peek would be noticed.
- **Admin sign-in:** `/api/admin/login` takes a verified Google sign-in and, only for an email on the admin list, returns an admin session: signed on the server, valid for 2 hours. Every other `/api/admin/*` request needs that session, and nothing else: the participant sign-in can't reach the admin panel, and an admin session can't open envelopes. The admin list is checked on every request, so removing an admin takes effect at once. Every admin sign-in is in the public log.
- `/api/admin/unsealed` works only after `UNSEAL_QUORUM` (5) participants approve. **Admins, and anyone who has ever signed in as admin, can't approve**, and their approvals don't count, even if they gave them before. The request, approvals and unsealing all appear in the public log.
- **Honest limit:** the owner of the Cloudflare account could deploy changed code that decrypts everything. That takes deliberate effort and would show in the git history. This protects against peeking by accident, not against a determined cheater.

---

## 12 December: remove all data

The sign-in page tells everyone that all accounts and data are removed on **12 December 2026**. The site closes by itself at midnight (`GAME_ENDS_AT`), but **deleting the data is your job that day**:

1. Wipe the real database. This also removes the activity log and the admin login log, which the in-app "Wipe everything" keeps:
   ```bash
   npx wrangler d1 execute berlinmallusanta --remote --command "DELETE FROM unseal_approvals; DELETE FROM unseal_requests; DELETE FROM assignments; DELETE FROM exclusions; DELETE FROM participants; DELETE FROM events; DELETE FROM admin_logins; DELETE FROM access_requests; DELETE FROM admins; UPDATE game SET status='draft', started_at=NULL WHERE id=1;"
   ```
2. Wipe the test database:
   ```bash
   npx wrangler d1 execute berlinmallusanta-test --remote --env preview --command "DELETE FROM unseal_approvals; DELETE FROM unseal_requests; DELETE FROM assignments; DELETE FROM exclusions; DELETE FROM participants; DELETE FROM events; DELETE FROM admin_logins; DELETE FROM access_requests; DELETE FROM admins; UPDATE game SET status='draft', started_at=NULL WHERE id=1;"
   ```
3. Delete the Google sign-in accounts that Firebase keeps (the database wipe doesn't touch them): Firebase console → **Authentication** → **Users** → select all → **Delete**.
4. Check that it's empty: `npx wrangler d1 execute berlinmallusanta --remote --command "SELECT (SELECT COUNT(*) FROM participants) AS people, (SELECT COUNT(*) FROM events) AS log"` should show 0 and 0.

## After Christmas: delete everything
```bash
npx wrangler d1 delete berlinmallusanta
npx wrangler d1 delete berlinmallusanta-test
npx wrangler pages project delete berlinmallusanta
```
Then delete the Firebase project and archive or delete the GitHub repo.
