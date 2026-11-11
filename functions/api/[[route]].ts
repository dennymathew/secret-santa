import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import type { Env, Identity, Participant } from '../lib/types';
import { verifyIdentity, isTestMode } from '../lib/auth';
import { drawPoolsSafe, DrawError, type Relaxation } from '../lib/draw';
import { getKey, seal, unseal } from '../lib/crypto';
import { matchSignIn, maskEmail, isEmail, listFromEnv } from '../lib/nameMatch';
import { identityKey, signAdminSession, verifyAdminSession } from '../lib/adminAuth';

/** A participant-side request: signed in with Google (Firebase ID token). */
type Who = {
  identity: Identity;
  /** "google:email" */
  idKey: string;
  participant: Participant | null;
};
/** An admin-side request: a valid admin session (see /admin/login) for an email on the admin list. */
type AdminWho = { email: string };
type App = { Bindings: Env; Variables: { who: Who; admin: AdminWho } };

const app = new Hono<App>().basePath('/api');

const now = () => new Date().toISOString();
const quorum = (env: Env) => Math.max(1, Number(env.UNSEAL_QUORUM ?? '5') || 5);
const endsAt = (env: Env) => env.GAME_ENDS_AT ?? '2026-12-12T00:00:00+01:00';

async function logEvent(db: D1Database, type: string, actor: string | null, detail: string | null = null) {
  await db.prepare('INSERT INTO events (type, actor_name, detail) VALUES (?, ?, ?)').bind(type, actor, detail).run();
}

async function gameStatus(db: D1Database) {
  return (await db.prepare('SELECT status, started_at FROM game WHERE id = 1').first<{
    status: 'draft' | 'started';
    started_at: string | null;
  }>())!;
}

// ---------- Global guards ----------
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Something went wrong on our side. Please try again.' }, 500);
});

app.use('*', async (c, next) => {
  if (Date.now() > Date.parse(endsAt(c.env))) {
    return c.json({ error: 'Merry Christmas! 🎄 The game is closed.', closed: true }, 410);
  }
  await next();
});

// ---------- Public ----------
// The frontend asks this on load: on the test site it skips Firebase and uses a fake Google sign-in.
app.get('/config', (c) => c.json({ testMode: isTestMode(c.env) }));

// ---------- Admins ----------
/** Is this email on the admin list (the admins table, managed with scripts/admins.sh)? */
async function isAdminEmail(db: D1Database, email: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM admins WHERE email = ?').bind(email.toLowerCase()).first());
}

/** Is, or ever was, an admin. Such people never count towards an unseal quorum. */
async function isOrWasAdmin(db: D1Database, email: string): Promise<boolean> {
  return !!(await db
    .prepare(
      `SELECT 1 FROM admins WHERE email = ?1
       UNION ALL SELECT 1 FROM admin_logins WHERE ok = 1 AND identity = 'google:' || ?1 LIMIT 1`,
    )
    .bind(email.toLowerCase())
    .first());
}

// ---------- Authentication ----------
// Two separate sign-ins. Admin routes (/api/admin/*, except /login) take ONLY an admin session, in the
// X-Admin-Session header. Everything else takes ONLY a participant's Google sign-in. So an admin session
// can never open an envelope, and a participant sign-in can never reach the admin panel.
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/api/admin/') && path !== '/api/admin/login') {
    const email = await verifyAdminSession(c.req.header('X-Admin-Session'), c.env.MATCH_KEY);
    // Checked on every request, so removing someone from the admin list takes effect at once.
    if (!email || !(await isAdminEmail(c.env.DB, email)))
      return c.json({ error: 'Please sign in as admin again.', adminLocked: true }, 401);
    c.set('admin', { email });
    return next();
  }

  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const identity = await verifyIdentity(token, c.env, new URL(c.req.url).host);
  if (!identity) return c.json({ error: 'Please sign in again.' }, 401);

  // The verified Google email is the only key. It is on the list either because the admin typed it in,
  // or because this person linked it once by name (see /google/claim).
  const participant = await c.env.DB.prepare('SELECT * FROM participants WHERE google_email = ?')
    .bind(identity.email)
    .first<Participant>();
  // First sign-in with this email: from now on it can't be replaced by name any more (see /google/claim).
  if (participant && !participant.google_seen_at) {
    participant.google_seen_at = now();
    await c.env.DB.prepare('UPDATE participants SET google_seen_at = ? WHERE id = ? AND google_seen_at IS NULL')
      .bind(participant.google_seen_at, participant.id)
      .run();
  }
  c.set('who', { identity, idKey: identityKey(identity), participant });
  await next();
});

// ---------- Not linked yet: find yourself by name ----------
type Adult = { id: number; name: string; google_email: string | null; google_claimed_at: string | null; google_seen_at: string | null };
async function adults(db: D1Database) {
  const { results } = await db
    .prepare('SELECT id, name, google_email, google_claimed_at, google_seen_at FROM participants WHERE is_kid = 0')
    .all<Adult>();
  return results;
}

/** An email the admin typed into the list is only a hint until it is used: until then, a name fit may replace it. */
const typedNeverUsed = (p: Adult) => !!p.google_email && !p.google_claimed_at && !p.google_seen_at;

/** What the claim screen shows: one person to confirm, or why Santa can't find you. */
app.post('/google/match', async (c) => {
  const { identity, participant } = c.get('who');
  if (participant) return c.json({ claimed: true });
  const m = matchSignIn(identity.email, identity.name, await adults(c.env.DB), typedNeverUsed);
  return c.json({
    claimed: false,
    googleName: identity.name,
    email: identity.email,
    result: m.kind,
    candidate: m.kind === 'name' || m.kind === 'taken' ? { id: m.p.id, name: m.p.name } : null,
    replacesEmail: m.kind === 'name' && m.replacesEmail,
    request: await myAccessRequest(c.env.DB, identity.email),
  });
});

// ---------- Not on the list: request access ----------
type AccessRequest = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  google_email: string;
  google_name: string | null;
  created_at: string;
};
const MAX_OPEN_REQUESTS = 100;

async function myAccessRequest(db: D1Database, googleEmail: string) {
  const r = await db.prepare('SELECT * FROM access_requests WHERE google_email = ?').bind(googleEmail).first<AccessRequest>();
  return r ? { firstName: r.first_name, email: r.email, sentAt: r.created_at } : null;
}

/** Someone signed in with Google but isn't on the list asks to be added. The admin sees it in the admin panel. */
app.post('/access-request', async (c) => {
  const { identity, participant } = c.get('who');
  if (participant) return c.json({ error: "You're already on the list." }, 409);
  const body = (await c.req.json<Record<string, unknown>>().catch(() => null)) ?? {};
  const field = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const firstName = field(body.firstName);
  const email = field(body.email).toLowerCase();
  const errors: string[] = [];
  if (!firstName || firstName.length > 60) errors.push('Please enter your first name.');
  if (!isEmail(email) || email.length > 254) errors.push('Please enter a valid email address.');
  if (errors.length) return c.json({ error: 'Please check the form.', details: errors }, 400);
  const db = c.env.DB;
  const open = await db.prepare('SELECT COUNT(*) AS n FROM access_requests WHERE google_email != ?').bind(identity.email).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS)
    return c.json({ error: 'Santa has too many requests right now. Please try again later.' }, 429);
  // One request per Google account: sending again updates it.
  await db
    .prepare(
      `INSERT INTO access_requests (first_name, last_name, email, google_email, google_name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(google_email) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name,
         email = excluded.email, google_name = excluded.google_name, created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    // last_name is no longer asked for (kept in the table, always empty now).
    .bind(firstName, '', email, identity.email, identity.name || null)
    .run();
  return c.json({ ok: true, request: await myAccessRequest(db, identity.email) });
});

app.post('/google/claim', async (c) => {
  const { identity, participant } = c.get('who');
  if (participant) return c.json({ ok: true });
  const { id } = await c.req.json<{ id?: number }>().catch(() => ({ id: undefined }));
  // Decided again on the server: only a single name fit that is unlinked (or has an unused typed email) can be claimed.
  const m = matchSignIn(identity.email, identity.name, await adults(c.env.DB), typedNeverUsed);
  if (m.kind === 'taken')
    return c.json({ error: `${m.p.name} is already linked to another Google account. Please ask one of the admins.` }, 409);
  if (m.kind !== 'name' || m.p.id !== Number(id))
    return c.json({ error: `🎅 Santa couldn't find you on the Berlin Mallu list. Please ask one of the admins to add you.` }, 403);
  // Lock only if still unclaimed, or the typed email is still unused (atomic): first come, first served.
  const at = now();
  const res = await c.env.DB.prepare(
    `UPDATE participants SET google_email = ?, google_claimed_at = ?, google_seen_at = ?
     WHERE id = ? AND (google_email IS NULL OR (google_claimed_at IS NULL AND google_seen_at IS NULL))`,
  )
    .bind(identity.email, at, at, m.p.id)
    .run();
  if (!res.meta.changes)
    return c.json({ error: `${m.p.name} is already linked to another Google account. Please ask one of the admins.` }, 409);
  await logEvent(
    c.env.DB,
    'google_claimed',
    m.p.name,
    `${maskEmail(identity.email)}${m.replacesEmail ? ', replacing the email on the list' : ''}`,
  );
  return c.json({ ok: true });
});

// ---------- Participant ----------
/** Kids an adult may open envelopes for: kids in the same family group, as saved from the list. */
async function kidsOf(db: D1Database, adult: Participant | null) {
  if (!adult || adult.is_kid || adult.family_group == null) return [];
  const { results } = await db
    .prepare('SELECT * FROM participants WHERE is_kid = 1 AND family_group = ? ORDER BY name')
    .bind(adult.family_group)
    .all<Participant>();
  return results;
}

app.get('/me', async (c) => {
  const { identity, participant } = c.get('who');
  const game = await gameStatus(c.env.DB);
  const kids = await kidsOf(c.env.DB, participant);
  return c.json({
    kids: kids.map((k) => ({ id: k.id, name: k.name, revealedAt: k.revealed_at })),
    signedInWith: identity.kind,
    /** Is or was an admin: can't approve an unseal. */
    adminEver: await isOrWasAdmin(c.env.DB, identity.email),
    participant: participant
      ? { id: participant.id, name: participant.name, revealedAt: participant.revealed_at }
      : null,
    needsClaim: !participant,
    game: { status: game.status, startedAt: game.started_at, endsAt: endsAt(c.env) },
  });
});

app.post('/reveal', async (c) => {
  const { participant } = c.get('who');
  if (!participant) return c.json({ error: "You're not on the participant list." }, 403);
  const game = await gameStatus(c.env.DB);
  if (game.status !== 'started') return c.json({ error: "The draw hasn't started yet. Hang tight! ⛄" }, 409);

  // Adults open their own envelope, or one of their family's kids' envelopes ({ kidId }).
  const { kidId } = await c.req.json<{ kidId?: number }>().catch(() => ({ kidId: undefined }));
  let subject: Participant = participant;
  if (kidId != null) {
    const kid = (await kidsOf(c.env.DB, participant)).find((k) => k.id === Number(kidId));
    if (!kid) return c.json({ error: 'You can only open envelopes for kids in your own family.' }, 403);
    subject = kid;
  }

  const row = await c.env.DB.prepare('SELECT ciphertext, iv FROM assignments WHERE giver_id = ?')
    .bind(subject.id)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return c.json({ error: 'No envelope found. Please ask one of the admins.' }, 404);

  const key = await getKey(c.env.MATCH_KEY);
  const receiverId = await unseal(key, subject.id, row.ciphertext, row.iv);
  const receiver = await c.env.DB.prepare('SELECT name FROM participants WHERE id = ?')
    .bind(receiverId)
    .first<{ name: string }>();

  let firstOpenedAt = subject.revealed_at;
  let firstTime = false;
  if (!firstOpenedAt) {
    firstOpenedAt = now();
    const res = await c.env.DB.prepare('UPDATE participants SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL')
      .bind(firstOpenedAt, subject.id)
      .run();
    if (res.meta.changes) {
      firstTime = true;
      await logEvent(c.env.DB, 'revealed', subject.name, subject.is_kid ? `opened by ${participant.name}` : null);
    } else {
      const again = await c.env.DB.prepare('SELECT revealed_at FROM participants WHERE id = ?')
        .bind(subject.id)
        .first<{ revealed_at: string }>();
      firstOpenedAt = again!.revealed_at;
    }
  }
  return c.json({ for: subject.name, isKid: !!subject.is_kid, receiver: receiver?.name ?? '???', firstOpenedAt, firstTime });
});

async function unsealState(env: Env) {
  const req = await env.DB.prepare('SELECT * FROM unseal_requests ORDER BY id DESC LIMIT 1').first<{
    id: number;
    created_at: string;
    unsealed_at: string | null;
  }>();
  if (!req) return null;
  const { results } = await env.DB.prepare(
    // Approvals from anyone who is or ever was an admin never count, even if they approved first.
    `SELECT p.id, p.name, a.approved_at FROM unseal_approvals a JOIN participants p ON p.id = a.participant_id
     WHERE a.request_id = ?
       AND NOT EXISTS (SELECT 1 FROM admin_logins l WHERE l.ok = 1
                       AND l.identity = 'google:' || p.google_email)
       AND NOT EXISTS (SELECT 1 FROM admins ad WHERE ad.email = p.google_email)
     ORDER BY a.approved_at`,
  )
    .bind(req.id)
    .all<{ id: number; name: string; approved_at: string }>();
  return {
    id: req.id,
    requestedAt: req.created_at,
    unsealedAt: req.unsealed_at,
    approvals: results,
    quorum: quorum(env),
    approved: results.length >= quorum(env),
  };
}

/** The status board: the same for everyone, admins included. `me` marks the signed-in participant. */
async function boardData(env: Env, me: number | null) {
  const game = await gameStatus(env.DB);
  const { results: people } = await env.DB.prepare(
    'SELECT id, name, is_kid, revealed_at, google_email FROM participants ORDER BY name COLLATE NOCASE',
  ).all<{ id: number; name: string; is_kid: number; revealed_at: string | null; google_email: string | null }>();
  const { results: events } = await env.DB.prepare(
    'SELECT ts, type, actor_name, detail FROM events ORDER BY id DESC LIMIT 100',
  ).all();
  return {
    game: { status: game.status, startedAt: game.started_at, endsAt: endsAt(env) },
    participants: people.map((p) => ({
      id: p.id,
      name: p.name,
      isKid: !!p.is_kid,
      revealed: !!p.revealed_at,
      revealedAt: p.revealed_at,
      google: maskEmail(p.google_email),
    })),
    events,
    unseal: await unsealState(env),
    me,
  };
}

app.get('/board', async (c) => {
  const { participant } = c.get('who');
  if (!participant) return c.json({ error: "You're not on the participant list." }, 403);
  return c.json(await boardData(c.env, participant.id));
});

app.post('/unseal/approve', async (c) => {
  const { participant, identity } = c.get('who');
  if (!participant) return c.json({ error: "You're not on the participant list." }, 403);
  if (await isOrWasAdmin(c.env.DB, identity.email))
    return c.json({ error: "Admins can't approve an unseal request." }, 403);
  const state = await unsealState(c.env);
  if (!state || state.unsealedAt) return c.json({ error: 'There is no open unseal request.' }, 409);
  const res = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO unseal_approvals (request_id, participant_id) VALUES (?, ?)',
  )
    .bind(state.id, participant.id)
    .run();
  if (res.meta.changes) await logEvent(c.env.DB, 'unseal_approved', participant.name);
  return c.json({ ok: true, unseal: await unsealState(c.env) });
});

// ---------- Admin ----------
const admin = new Hono<App>();

/** Name for the public log: the admin's name if they're on the list, else "An admin". */
async function adminActor(db: D1Database, email: string): Promise<string> {
  const p = await db.prepare('SELECT name FROM participants WHERE google_email = ?').bind(email).first<{ name: string }>();
  return p?.name ?? 'An admin';
}

/**
 * Admin sign-in: a Google sign-in (Authorization header, like a participant's) from the admin sign-in page.
 * Only emails on the admin list get an admin session; being on the participant list doesn't matter.
 */
admin.post('/login', async (c) => {
  const { identity } = c.get('who');
  const db = c.env.DB;
  // One-time move from the old ADMIN_EMAILS secret: those emails become admins at their first admin sign-in.
  if (listFromEnv(c.env.ADMIN_EMAILS).includes(identity.email))
    await db.prepare('INSERT OR IGNORE INTO admins (email) VALUES (?)').bind(identity.email).run();
  if (!(await isAdminEmail(db, identity.email)))
    return c.json({ error: `${identity.email} isn't an admin. Sign in with an admin's Google account, or use the normal sign-in.` }, 403);
  // Recorded so that admins never count towards an unseal quorum (see unsealState).
  await db.prepare('INSERT INTO admin_logins (identity, ok) VALUES (?, 1)').bind(identityKey(identity)).run();
  await logEvent(db, 'admin_unlocked', await adminActor(db, identity.email));
  return c.json(await signAdminSession(c.env.MATCH_KEY, identity.email));
});

/** Who is signed in to the admin panel. */
admin.get('/me', (c) => c.json({ email: c.get('admin').email }));

/** The status board, for the admin panel (the same data everyone sees). */
admin.get('/board', async (c) => c.json(await boardData(c.env, null)));

// Restart: "redraw" keeps the list, "wipe" deletes everything (except the admin list). Needs "RESET" typed.
admin.post('/reset', async (c) => {
  const { mode, confirm } = await c.req
    .json<{ mode?: string; confirm?: string }>()
    .catch(() => ({ mode: undefined, confirm: undefined }));
  if (mode !== 'redraw' && mode !== 'wipe') return c.json({ error: 'Choose redraw or wipe.' }, 400);
  if (confirm !== 'RESET') return c.json({ error: 'Type RESET to confirm.' }, 400);
  const db = c.env.DB;
  const actor = await adminActor(db, c.get('admin').email);
  await db.batch([
    db.prepare('DELETE FROM unseal_approvals'),
    db.prepare('DELETE FROM unseal_requests'),
    db.prepare('DELETE FROM assignments'),
    db.prepare('DELETE FROM events'),
    db.prepare("UPDATE game SET status = 'draft', started_at = NULL WHERE id = 1"),
    ...(mode === 'wipe'
      ? [db.prepare('DELETE FROM exclusions'), db.prepare('DELETE FROM participants'), db.prepare('DELETE FROM access_requests')]
      : [db.prepare('UPDATE participants SET revealed_at = NULL')]),
  ]);
  await logEvent(db, 'game_reset', actor, mode === 'wipe' ? 'everything wiped' : 'list kept, new draw needed');
  return c.json({ ok: true });
});

interface ImportBody {
  participants: unknown;
  exclusions?: unknown;
}

/** A text field from the request: '' if missing, null if it isn't text at all. */
const text = (v: unknown): string | null => (v == null ? '' : typeof v === 'string' ? v : null);

admin.post('/participants', async (c) => {
  const game = await gameStatus(c.env.DB);
  if (game.status !== 'draft') return c.json({ error: 'The game has already started. The list is locked.' }, 409);
  const body = await c.req.json<ImportBody>().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray(body.participants) || !body.participants.length)
    return c.json({ error: 'No participants given.' }, 400);
  if (body.exclusions != null && !Array.isArray(body.exclusions))
    return c.json({ error: 'Please fix the list.', details: ['The "never match" pairs must be a list.'] }, 400);

  const errors: string[] = [];
  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();
  // Family groups come from the list itself: the same family name (ignoring case) is one group.
  const groupOf = new Map<string, number>();
  const rows = (body.participants as unknown[]).map((raw, i) => {
    const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const rawName = text(p.name);
    const rawEmail = text(p.email);
    const rawFamily = text(p.family);
    const name = (rawName ?? '').trim();
    const kid = !!p.kid;
    const family = (rawFamily ?? '').trim() || null;
    const email = kid ? null : (rawEmail ?? '').trim().toLowerCase() || null;
    const label = `Row ${i + 1}${name ? ` (${name})` : ''}`;
    if (!raw || typeof raw !== 'object') errors.push(`${label}: isn't a person (expected a name, email, family and kid).`);
    else if (rawName === null) errors.push(`${label}: the name must be text.`);
    else if (!name) errors.push(`${label}: name is missing.`);
    if (rawEmail === null && !kid) errors.push(`${label}: the email must be text.`);
    if (rawFamily === null) errors.push(`${label}: the family must be text.`);
    if (email && !isEmail(email)) errors.push(`${label}: "${email}" isn't a valid email address.`);
    if (kid && !family) errors.push(`${label}: kids must be listed under a family, so their parents can open their envelope.`);
    if (email && seenEmails.has(email)) errors.push(`${label}: duplicate email.`);
    if (name && seenNames.has(name.toLowerCase())) errors.push(`${label}: duplicate name. Add a surname or initial.`);
    if (email) seenEmails.add(email);
    if (name) seenNames.add(name.toLowerCase());
    let familyGroup: number | null = null;
    if (family) {
      const key = family.toLowerCase();
      if (!groupOf.has(key)) groupOf.set(key, groupOf.size + 1);
      familyGroup = groupOf.get(key)!;
    }
    return { name, email, family, familyGroup, kid };
  });
  const adultGroups = new Set(rows.filter((r) => !r.kid && r.familyGroup != null).map((r) => r.familyGroup));
  for (const r of rows)
    if (r.kid && r.familyGroup != null && !adultGroups.has(r.familyGroup))
      errors.push(`${r.name}: family "${r.family}" has no adult to open the envelope.`);
  const byName = new Map(rows.filter((r) => r.name).map((r) => [r.name.toLowerCase(), r]));
  const exclusions: Array<[string, string]> = [];
  ((body.exclusions ?? []) as unknown[]).forEach((pair, i) => {
    const [a, b] = Array.isArray(pair) ? pair : [];
    if (!Array.isArray(pair) || pair.length !== 2 || typeof a !== 'string' || typeof b !== 'string' || !a.trim() || !b.trim()) {
      errors.push(`Never-match pair ${i + 1}: needs exactly two names.`);
      return;
    }
    const ra = byName.get(a.trim().toLowerCase());
    const rb = byName.get(b.trim().toLowerCase());
    if (!ra || !rb) errors.push(`Exclusion "${a} / ${b}": both names must be on the list.`);
    else if (ra.kid !== rb.kid) errors.push(`Exclusion "${a} / ${b}": kids and adults are in separate draws already.`);
    else exclusions.push([a, b]);
  });
  const adultCount = rows.filter((r) => !r.kid).length;
  const kidCount = rows.length - adultCount;
  if (adultCount < 3) errors.push('You need at least 3 adults.');
  if (kidCount === 1) errors.push("There's only 1 kid, so they have nobody to swap gifts with. Add another kid, or list them as an adult.");
  if (errors.length) return c.json({ error: 'Please fix the list.', details: errors }, 400);

  const db = c.env.DB;
  // Keep Google accounts people already linked by name, so a list edit doesn't make them link again.
  // An email typed into the list always wins.
  const { results: old } = await db
    .prepare(
      'SELECT name, google_email, google_claimed_at, google_seen_at FROM participants WHERE is_kid = 0 AND google_email IS NOT NULL',
    )
    .all<{ name: string; google_email: string; google_claimed_at: string | null; google_seen_at: string | null }>();
  const oldLink = new Map(old.map((o) => [o.name.toLowerCase(), o]));
  // An email that has already signed in stays "used" after a list edit, so it can't be replaced by name.
  const oldByEmail = new Map(old.map((o) => [o.google_email.toLowerCase(), o]));
  const final = rows.map((r) => {
    const none = { claimedAt: null as string | null, seenAt: null as string | null };
    if (r.kid) return { ...r, ...none };
    if (r.email) {
      const o = oldByEmail.get(r.email);
      if (!o) return { ...r, ...none };
      // Same person and email as before: keep how it was linked, too.
      const same = o.name.toLowerCase() === r.name.toLowerCase();
      return { ...r, claimedAt: same ? o.google_claimed_at : null, seenAt: o.google_seen_at };
    }
    const o = oldLink.get(r.name.toLowerCase());
    return o && !seenEmails.has(o.google_email.toLowerCase())
      ? { ...r, email: o.google_email, claimedAt: o.google_claimed_at, seenAt: o.google_seen_at }
      : { ...r, ...none };
  });
  await db.batch([
    db.prepare('DELETE FROM unseal_approvals'),
    db.prepare('DELETE FROM unseal_requests'),
    db.prepare('DELETE FROM assignments'),
    db.prepare('DELETE FROM exclusions'),
    db.prepare('DELETE FROM participants'),
    ...final.map((r) =>
      db
        .prepare(
          'INSERT INTO participants (name, google_email, google_claimed_at, google_seen_at, family, family_group, is_kid) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(r.name, r.email, r.claimedAt, r.seenAt, r.family, r.familyGroup, r.kid ? 1 : 0),
    ),
    // Requests whose email is now on the list are done.
    db.prepare(
      `DELETE FROM access_requests WHERE email IN (SELECT google_email FROM participants WHERE google_email IS NOT NULL)
         OR google_email IN (SELECT google_email FROM participants WHERE google_email IS NOT NULL)`,
    ),
  ]);
  const { results: saved } = await db.prepare('SELECT id, name FROM participants').all<{ id: number; name: string }>();
  const idOf = new Map(saved.map((s) => [s.name.toLowerCase(), s.id]));
  const ex = exclusions.map(([a, b]) => [idOf.get(a.trim().toLowerCase())!, idOf.get(b.trim().toLowerCase())!]);
  if (ex.length)
    await db.batch(ex.map(([a, b]) => db.prepare('INSERT OR IGNORE INTO exclusions (a_id, b_id) VALUES (?, ?)').bind(a, b)));
  return c.json({ ok: true, adults: adultCount, kids: kidCount, exclusions: ex.length, check: await drawCheck(db) });
});

admin.get('/participants', async (c) => {
  // Emails and families are needed by the admin to check the list. Secret Santas are never included.
  const { results: people } = await c.env.DB.prepare(
    'SELECT id, name, google_email AS email, google_claimed_at AS claimed_at, family, is_kid FROM participants ORDER BY id',
  ).all();
  const { results: ex } = await c.env.DB.prepare(
    `SELECT a.name AS a, b.name AS b FROM exclusions e
     JOIN participants a ON a.id = e.a_id JOIN participants b ON b.id = e.b_id`,
  ).all();
  return c.json({ participants: people, exclusions: ex });
});

/** Loads the saved list and runs the draw (rules loosened only if needed). Nothing is saved. */
async function runDraw(db: D1Database) {
  const { results: people } = await db.prepare('SELECT id, name, family_group, is_kid FROM participants').all<{
    id: number;
    name: string;
    family_group: number | null;
    is_kid: number;
  }>();
  const { results: ex } = await db.prepare('SELECT a_id, b_id FROM exclusions').all<{ a_id: number; b_id: number }>();
  const { assignment, relaxed } = drawPoolsSafe(
    // The family rule uses the groups saved from the list, the same ones that decide who opens a kid's envelope.
    people.map((p) => ({ id: p.id, name: p.name, family: p.family_group == null ? null : `group:${p.family_group}`, isKid: !!p.is_kid })),
    ex.map((e) => [e.a_id, e.b_id]),
  );
  return { people, assignment, relaxed };
}

/** Test run of the draw, so the admin sees problems when saving, not only at Start. Result is thrown away. */
async function drawCheck(db: D1Database): Promise<{ ok: boolean; relaxed: string[]; error?: string }> {
  try {
    const { relaxed } = await runDraw(db);
    return { ok: true, relaxed: relaxed.map((r) => r.message) };
  } catch (e) {
    if (e instanceof DrawError) return { ok: false, relaxed: [], error: e.message };
    throw e;
  }
}

admin.get('/draw-check', async (c) => c.json(await drawCheck(c.env.DB)));

admin.post('/start', async (c) => {
  const db = c.env.DB;
  const game = await gameStatus(db);
  if (game.status !== 'draft') return c.json({ error: 'The game has already started.' }, 409);
  const { acceptLoosened } = await c.req.json<{ acceptLoosened?: boolean }>().catch(() => ({ acceptLoosened: false }));
  let people: Array<{ id: number }>, result: Map<number, number>, relaxed: Relaxation[];
  try {
    ({ people, assignment: result, relaxed } = await runDraw(db));
  } catch (e) {
    if (e instanceof DrawError) return c.json({ error: e.message }, 400);
    throw e;
  }
  if (relaxed.length && !acceptLoosened)
    return c.json({ error: 'Some rules have to be loosened so everyone gets a Secret Santa.', details: relaxed.map((r) => r.message), needsConfirm: true }, 428);
  // Final guard: one sealed envelope per participant, nobody missing.
  if (result.size !== people.length || people.some((p) => !result.has(p.id)))
    return c.json({ error: 'Safety check failed: not everyone got a Secret Santa. Nothing was saved.' }, 500);
  const key = await getKey(c.env.MATCH_KEY);
  const sealed = await Promise.all([...result].map(async ([g, r]) => ({ g, ...(await seal(key, g, r)) })));
  const startedAt = now();
  const alreadyStarted = () => c.json({ error: 'The game has already started.' }, 409);
  let upd: D1Result[];
  try {
    upd = await db.batch([
      db.prepare("UPDATE game SET status = 'started', started_at = ? WHERE id = 1 AND status = 'draft'").bind(startedAt),
      ...sealed.map((s) =>
        db.prepare('INSERT INTO assignments (giver_id, ciphertext, iv) VALUES (?, ?, ?)').bind(s.g, s.ciphertext, s.iv),
      ),
    ]);
  } catch (e) {
    // Two Starts at once: the other one saved its envelopes first, so ours clash and are rolled back.
    if ((await gameStatus(db)).status === 'started') return alreadyStarted();
    throw e;
  }
  if (!upd[0].meta.changes) return alreadyStarted();
  const loosened = relaxed.length ? `. Rules loosened: ${relaxed.map((r) => r.message).join(' ')}` : '';
  await logEvent(db, 'game_started', null, `${people.length} participants${loosened}`);
  // Note: the result is deliberately NOT returned.
  return c.json({ ok: true, startedAt });
});

admin.get('/access-requests', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM access_requests ORDER BY created_at').all<AccessRequest>();
  return c.json({
    requests: results.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      googleEmail: r.google_email,
      googleName: r.google_name,
      sentAt: r.created_at,
    })),
  });
});

/**
 * Approve a request by linking it to someone already on the list: their email becomes the requester's
 * (replacing any email there). Works after the draw has started too, because the draw doesn't change.
 */
admin.post('/access-requests/link', async (c) => {
  const body = await c.req.json<{ id?: number; participantId?: number; email?: string }>().catch(() => null);
  const db = c.env.DB;
  const req = await db.prepare('SELECT * FROM access_requests WHERE id = ?').bind(Number(body?.id)).first<AccessRequest>();
  if (!req) return c.json({ error: 'That request is gone. Refresh the page.' }, 404);
  const p = await db.prepare('SELECT * FROM participants WHERE id = ?').bind(Number(body?.participantId)).first<Participant>();
  if (!p) return c.json({ error: 'Choose who this person is on the list.' }, 400);
  if (p.is_kid) return c.json({ error: "Kids don't sign in, so they can't be linked to an account." }, 400);
  // Either the Google account they signed in with, or the email they typed in the form.
  const email = (body?.email ?? req.google_email).trim().toLowerCase();
  if (email !== req.google_email && email !== req.email.toLowerCase())
    return c.json({ error: 'Link the Google account they signed in with, or the email from their request.' }, 400);
  const other = await db
    .prepare('SELECT name FROM participants WHERE google_email = ? AND id != ?')
    .bind(email, p.id)
    .first<{ name: string }>();
  if (other) return c.json({ error: `${email} is already linked to ${other.name}. Unlink it there first.` }, 409);
  // Like an email the admin typed in: it locks to the person at their first sign-in.
  await db.batch([
    db.prepare('UPDATE participants SET google_email = ?, google_claimed_at = NULL, google_seen_at = NULL WHERE id = ?').bind(email, p.id),
    db.prepare('DELETE FROM access_requests WHERE id = ? OR google_email = ?').bind(req.id, email),
  ]);
  await logEvent(
    db,
    'admin_linked',
    p.name,
    `${maskEmail(email)}${p.google_email && p.google_email !== email ? `, replacing ${maskEmail(p.google_email)}` : ''}`,
  );
  return c.json({ ok: true, wasRevealed: !!p.revealed_at });
});

admin.post('/access-requests/dismiss', async (c) => {
  const { id } = await c.req.json<{ id?: number }>().catch(() => ({ id: undefined }));
  await c.env.DB.prepare('DELETE FROM access_requests WHERE id = ?').bind(Number(id)).run();
  return c.json({ ok: true });
});

admin.post('/unlock-claim', async (c) => {
  const { id } = await c.req.json<{ id?: number }>().catch(() => ({ id: undefined }));
  const p = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?').bind(Number(id)).first<Participant>();
  if (!p || !p.google_email) return c.json({ error: 'Nothing to unlock.' }, 404);
  await c.env.DB.prepare('UPDATE participants SET google_email = NULL, google_claimed_at = NULL WHERE id = ?')
    .bind(p.id)
    .run();
  await logEvent(c.env.DB, 'claim_unlocked', p.name, maskEmail(p.google_email));
  return c.json({ ok: true, wasRevealed: !!p.revealed_at });
});

admin.post('/unseal/request', async (c) => {
  const game = await gameStatus(c.env.DB);
  if (game.status !== 'started') return c.json({ error: 'Nothing to unseal yet.' }, 409);
  const state = await unsealState(c.env);
  if (state && !state.unsealedAt) return c.json({ ok: true, unseal: state });
  await c.env.DB.prepare('INSERT INTO unseal_requests DEFAULT VALUES').run();
  await logEvent(c.env.DB, 'unseal_requested', null);
  return c.json({ ok: true, unseal: await unsealState(c.env) });
});

admin.get('/unsealed', async (c) => {
  const state = await unsealState(c.env);
  if (!state) return c.json({ error: 'No unseal request.' }, 403);
  if (!state.approved)
    return c.json({ error: `Needs ${state.quorum} approvals (has ${state.approvals.length}).` }, 403);
  const db = c.env.DB;
  if (!state.unsealedAt) {
    await db.prepare('UPDATE unseal_requests SET unsealed_at = ? WHERE id = ?').bind(now(), state.id).run();
    await logEvent(db, 'unsealed', null, 'The admin viewed all Secret Santas');
  }
  const { results: people } = await db.prepare('SELECT id, name, is_kid FROM participants').all<{
    id: number;
    name: string;
    is_kid: number;
  }>();
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const kidIds = new Set(people.filter((p) => p.is_kid).map((p) => p.id));
  const { results: rows } = await db.prepare('SELECT giver_id, ciphertext, iv FROM assignments').all<{
    giver_id: number;
    ciphertext: string;
    iv: string;
  }>();
  const key = await getKey(c.env.MATCH_KEY);
  const pairs = await Promise.all(
    rows.map(async (r) => ({
      giver: nameOf.get(r.giver_id),
      isKid: kidIds.has(r.giver_id),
      receiver: nameOf.get(await unseal(key, r.giver_id, r.ciphertext, r.iv)),
    })),
  );
  return c.json({ pairs });
});

app.route('/admin', admin);

app.all('*', (c) => c.json({ error: 'Not found' }, 404));

export const onRequest = handle(app);
