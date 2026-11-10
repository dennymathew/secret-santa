import { Hono, type Context } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import type { Env, Identity, Participant } from '../lib/types';
import { verifyIdentity, isTestMode } from '../lib/auth';
import { listFromEnv, normalizePhone } from '../lib/phone';
import { drawPoolsSafe, DrawError, type Relaxation } from '../lib/draw';
import { getKey, seal, unseal } from '../lib/crypto';
import { findCandidates, maskEmail } from '../lib/nameMatch';
import { identityKey, signSession, verifySession, verifyPassword } from '../lib/adminAuth';

type Who = {
  identity: Identity;
  /** "phone:+49…" or "google:email" */
  idKey: string;
  participant: Participant | null;
  /** On ADMIN_PHONES / ADMIN_EMAILS: may sign in even when not on the list (needed to paste the first list). */
  organizer: boolean;
  /** Has a valid admin session (unlocked with the admin password). */
  isAdmin: boolean;
};
type App = { Bindings: Env; Variables: { who: Who } };

const app = new Hono<App>().basePath('/api');

const now = () => new Date().toISOString();
const quorum = (env: Env) => Math.max(1, Number(env.UNSEAL_QUORUM ?? '5') || 5);
const endsAt = (env: Env) => env.GAME_ENDS_AT ?? '2026-12-26T00:00:00+01:00';

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
// The frontend asks this on load: on the test site it skips Firebase and uses code 123456.
app.get('/config', (c) => c.json({ testMode: isTestMode(c.env) }));

app.post('/check-phone', async (c) => {
  const { phone } = await c.req.json<{ phone?: string }>().catch(() => ({ phone: '' }));
  const p = normalizePhone(phone ?? '');
  if (!p) return c.json({ ok: false, error: 'Please enter a German (+49) or Indian (+91) mobile number.' });
  const isAdmin = listFromEnv(c.env.ADMIN_PHONES).includes(p);
  const row = await c.env.DB.prepare('SELECT 1 FROM participants WHERE phone_e164 = ?').bind(p).first();
  // Numbers that aren't on the list never reach Firebase, so no SMS is ever sent to them.
  if (!row && !isAdmin)
    return c.json({
      ok: false,
      error: "🎅 Santa can't find this number on the official Berlin Mallu list, so no SMS was sent. Ask the admin to add you.",
    });
  return c.json({ ok: true, phone: p });
});

// ---------- Authentication ----------
app.use('*', async (c, next) => {
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const identity = await verifyIdentity(token, c.env, new URL(c.req.url).host);
  if (!identity) return c.json({ error: 'Please sign in again.' }, 401);

  let participant: Participant | null = null;
  let organizer = false;
  if (identity.kind === 'phone') {
    participant = await c.env.DB.prepare('SELECT * FROM participants WHERE phone_e164 = ?')
      .bind(identity.phone)
      .first<Participant>();
    organizer = listFromEnv(c.env.ADMIN_PHONES).includes(identity.phone);
  } else {
    participant = await c.env.DB.prepare('SELECT * FROM participants WHERE google_email = ?')
      .bind(identity.email)
      .first<Participant>();
    organizer = listFromEnv(c.env.ADMIN_EMAILS).map((e) => e.toLowerCase()).includes(identity.email);
  }
  const idKey = identityKey(identity);
  // Admin = a valid session from POST /admin/login, for this exact person and the current password.
  const isAdmin =
    (!!participant || organizer) &&
    (await verifySession(c.req.header('X-Admin-Session'), c.env.MATCH_KEY, c.env.ADMIN_PASSWORD_HASH, idKey));
  c.set('who', { identity, idKey, participant, organizer, isAdmin });
  await next();
});

/** Has this participant ever unlocked the admin panel (with their phone or their Google account)? */
async function everUnlockedAdmin(db: D1Database, p: Participant | null, idKey: string): Promise<boolean> {
  const keys = [idKey, p?.phone_e164 ? `phone:${p.phone_e164}` : '', p?.google_email ? `google:${p.google_email}` : ''];
  const row = await db
    .prepare('SELECT 1 FROM admin_logins WHERE ok = 1 AND identity IN (?, ?, ?) LIMIT 1')
    .bind(...keys)
    .first();
  return !!row;
}

// ---------- Google fallback: find yourself and claim ----------
app.post('/google/candidates', async (c) => {
  const { identity, participant } = c.get('who');
  if (identity.kind !== 'google') return c.json({ error: 'Google sign-in only.' }, 400);
  if (participant) return c.json({ claimed: true, candidates: [] });
  const { results } = await c.env.DB.prepare('SELECT id, name, google_email FROM participants WHERE is_kid = 0').all<{
    id: number;
    name: string;
    google_email: string | null;
  }>();
  const candidates = findCandidates(identity.name, results).map((p) => ({
    id: p.id,
    name: p.name,
    taken: !!p.google_email,
  }));
  return c.json({ claimed: false, googleName: identity.name, candidates });
});

app.post('/google/claim', async (c) => {
  const { identity, participant } = c.get('who');
  if (identity.kind !== 'google') return c.json({ error: 'Google sign-in only.' }, 400);
  if (participant) return c.json({ ok: true });
  const { id } = await c.req.json<{ id?: number }>().catch(() => ({ id: undefined }));
  const target = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ? AND is_kid = 0')
    .bind(Number(id))
    .first<Participant>();
  if (!target) return c.json({ error: 'Person not found.' }, 404);
  if (!findCandidates(identity.name, [target]).length)
    return c.json({ error: "Your Google name doesn't match this person." }, 403);
  // Lock only if still unclaimed (atomic)
  const res = await c.env.DB.prepare(
    'UPDATE participants SET google_email = ?, google_claimed_at = ? WHERE id = ? AND google_email IS NULL',
  )
    .bind(identity.email, now(), target.id)
    .run();
  if (!res.meta.changes)
    return c.json({ error: `${target.name} is already linked to another Google account. Ask the admin.` }, 409);
  await logEvent(c.env.DB, 'google_claimed', target.name, maskEmail(identity.email));
  return c.json({ ok: true });
});

// ---------- Participant ----------
/** Kids an adult may open envelopes for: kids in the same family group. */
async function kidsOf(db: D1Database, adult: Participant | null) {
  if (!adult || adult.is_kid || !adult.family) return [];
  const { results } = await db
    .prepare('SELECT * FROM participants WHERE is_kid = 1 AND family = ? COLLATE NOCASE ORDER BY name')
    .bind(adult.family)
    .all<Participant>();
  return results;
}

app.get('/me', async (c) => {
  const { identity, idKey, participant, organizer, isAdmin } = c.get('who');
  const game = await gameStatus(c.env.DB);
  const kids = await kidsOf(c.env.DB, participant);
  return c.json({
    kids: kids.map((k) => ({ id: k.id, name: k.name, revealedAt: k.revealed_at })),
    signedInWith: identity.kind,
    isAdmin,
    organizer,
    adminEver: await everUnlockedAdmin(c.env.DB, participant, idKey),
    participant: participant
      ? { id: participant.id, name: participant.name, revealedAt: participant.revealed_at }
      : null,
    needsClaim: identity.kind === 'google' && !participant,
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
  if (!row) return c.json({ error: 'No envelope found. Ask the admin.' }, 404);

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
    // Approvals from anyone who has ever unlocked the admin panel never count, even if they approved first.
    `SELECT p.id, p.name, a.approved_at FROM unseal_approvals a JOIN participants p ON p.id = a.participant_id
     WHERE a.request_id = ?
       AND NOT EXISTS (SELECT 1 FROM admin_logins l WHERE l.ok = 1
                       AND (l.identity = 'phone:' || p.phone_e164 OR l.identity = 'google:' || p.google_email))
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

app.get('/board', async (c) => {
  const { participant, organizer, isAdmin } = c.get('who');
  if (!participant && !organizer && !isAdmin) return c.json({ error: "You're not on the participant list." }, 403);
  const game = await gameStatus(c.env.DB);
  const { results: people } = await c.env.DB.prepare(
    'SELECT id, name, is_kid, revealed_at, google_email FROM participants ORDER BY name COLLATE NOCASE',
  ).all<{ id: number; name: string; is_kid: number; revealed_at: string | null; google_email: string | null }>();
  const { results: events } = await c.env.DB.prepare(
    'SELECT ts, type, actor_name, detail FROM events ORDER BY id DESC LIMIT 100',
  ).all();
  return c.json({
    game: { status: game.status, startedAt: game.started_at, endsAt: endsAt(c.env) },
    participants: people.map((p) => ({
      id: p.id,
      name: p.name,
      isKid: !!p.is_kid,
      revealed: !!p.revealed_at,
      revealedAt: p.revealed_at,
      google: maskEmail(p.google_email),
    })),
    events,
    unseal: await unsealState(c.env),
    me: participant?.id ?? null,
  });
});

app.post('/unseal/approve', async (c) => {
  const { participant, isAdmin, idKey } = c.get('who');
  if (!participant) return c.json({ error: "You're not on the participant list." }, 403);
  if (isAdmin || (await everUnlockedAdmin(c.env.DB, participant, idKey)))
    return c.json({ error: "Anyone who has unlocked the admin panel can't approve an unseal request." }, 403);
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

// Every admin route except /login needs a valid admin session. This is the real lock:
// the password form in the browser is only a convenience.
admin.use('*', async (c, next) => {
  if (c.req.path === '/api/admin/login') return next();
  if (!c.get('who').isAdmin)
    return c.json({ error: 'The admin panel is locked. Enter the admin password.', adminLocked: true }, 403);
  await next();
});

const actorName = (who: Who) => who.participant?.name ?? 'The organizer';

/**
 * Checks the admin password with a brute-force limit: 5 wrong tries per person per 15 minutes,
 * 20 wrong tries in total per hour. Every try is recorded; returns an error response or null if correct.
 */
async function checkPassword(c: Context<App>, password: unknown) {
  const db = c.env.DB;
  const who = c.get('who');
  if (!c.env.ADMIN_PASSWORD_HASH)
    return c.json({ error: "The admin password hasn't been set up yet (see the README: set-admin-password.sh)." }, 503);
  const mine = await db
    .prepare("SELECT COUNT(*) AS n FROM admin_logins WHERE ok = 0 AND identity = ? AND ts > datetime('now', '-15 minutes')")
    .bind(who.idKey)
    .first<{ n: number }>();
  const all = await db
    .prepare("SELECT COUNT(*) AS n FROM admin_logins WHERE ok = 0 AND ts > datetime('now', '-60 minutes')")
    .first<{ n: number }>();
  if ((mine?.n ?? 0) >= 5 || (all?.n ?? 0) >= 20)
    return c.json({ error: 'Too many wrong passwords. Please wait 15 minutes and try again.' }, 429);
  const ok = typeof password === 'string' && (await verifyPassword(password, c.env.ADMIN_PASSWORD_HASH));
  await db.prepare('INSERT INTO admin_logins (identity, ok) VALUES (?, ?)').bind(who.idKey, ok ? 1 : 0).run();
  if (!ok) {
    await logEvent(db, 'admin_login_failed', actorName(who));
    return c.json({ error: "That password isn't right." }, 403);
  }
  return null;
}

admin.post('/login', async (c) => {
  const who = c.get('who');
  if (!who.participant && !who.organizer)
    return c.json({ error: 'Only people on the list can unlock the admin panel.' }, 403);
  const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: undefined }));
  const fail = await checkPassword(c, password);
  if (fail) return fail;
  await logEvent(c.env.DB, 'admin_unlocked', actorName(who));
  return c.json(await signSession(c.env.MATCH_KEY, c.env.ADMIN_PASSWORD_HASH!, who.idKey));
});

// Restart: "redraw" keeps the list, "wipe" deletes everything. Needs the password typed again.
admin.post('/reset', async (c) => {
  const { mode, password } = await c.req
    .json<{ mode?: string; password?: string }>()
    .catch(() => ({ mode: undefined, password: undefined }));
  if (mode !== 'redraw' && mode !== 'wipe') return c.json({ error: 'Choose redraw or wipe.' }, 400);
  const fail = await checkPassword(c, password);
  if (fail) return fail;
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM unseal_approvals'),
    db.prepare('DELETE FROM unseal_requests'),
    db.prepare('DELETE FROM assignments'),
    db.prepare('DELETE FROM events'),
    db.prepare("UPDATE game SET status = 'draft', started_at = NULL WHERE id = 1"),
    ...(mode === 'wipe'
      ? [db.prepare('DELETE FROM exclusions'), db.prepare('DELETE FROM participants')]
      : [db.prepare('UPDATE participants SET revealed_at = NULL')]),
  ]);
  await logEvent(db, 'game_reset', actorName(c.get('who')), mode === 'wipe' ? 'everything wiped' : 'list kept, new draw needed');
  return c.json({ ok: true });
});

interface ImportBody {
  participants: Array<{ name: string; phone?: string | null; family?: string | null; kid?: boolean }>;
  exclusions?: Array<[string, string]>;
}

admin.post('/participants', async (c) => {
  const game = await gameStatus(c.env.DB);
  if (game.status !== 'draft') return c.json({ error: 'The game has already started. The list is locked.' }, 409);
  const body = await c.req.json<ImportBody>().catch(() => null);
  if (!body?.participants?.length) return c.json({ error: 'No participants given.' }, 400);

  const errors: string[] = [];
  const seenPhones = new Set<string>();
  const seenNames = new Set<string>();
  const rows = body.participants.map((p, i) => {
    const name = (p.name ?? '').trim();
    const kid = !!p.kid;
    const family = (p.family ?? '').trim() || null;
    const phone = kid ? null : normalizePhone(p.phone ?? '');
    const label = `Row ${i + 1}${name ? ` (${name})` : ''}`;
    if (!name) errors.push(`${label}: name is missing.`);
    if (!kid && !phone) errors.push(`${label}: "${p.phone ?? ''}" isn't a valid +49 or +91 mobile number.`);
    if (kid && !family) errors.push(`${label}: kids must be listed under a family, so their parents can open their envelope.`);
    if (phone && seenPhones.has(phone)) errors.push(`${label}: duplicate phone number.`);
    if (name && seenNames.has(name.toLowerCase())) errors.push(`${label}: duplicate name. Add a surname or initial.`);
    if (phone) seenPhones.add(phone);
    seenNames.add(name.toLowerCase());
    return { name, phone, family, kid };
  });
  const adultFamilies = new Set(rows.filter((r) => !r.kid && r.family).map((r) => r.family!.toLowerCase()));
  for (const r of rows)
    if (r.kid && r.family && !adultFamilies.has(r.family.toLowerCase()))
      errors.push(`${r.name}: family "${r.family}" has no adult with a phone number to open the envelope.`);
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  for (const [a, b] of body.exclusions ?? []) {
    const ra = byName.get(a.trim().toLowerCase());
    const rb = byName.get(b.trim().toLowerCase());
    if (!ra || !rb) errors.push(`Exclusion "${a} / ${b}": both names must be on the list.`);
    else if (ra.kid !== rb.kid) errors.push(`Exclusion "${a} / ${b}": kids and adults are in separate draws already.`);
  }
  const adultCount = rows.filter((r) => !r.kid).length;
  const kidCount = rows.length - adultCount;
  if (adultCount < 3) errors.push('You need at least 3 adults.');
  if (kidCount === 1) errors.push("There's only 1 kid, so they have nobody to swap gifts with. Add another kid, or list them as an adult.");
  if (errors.length) return c.json({ error: 'Please fix the list.', details: errors }, 400);

  const admins = listFromEnv(c.env.ADMIN_PHONES);
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM unseal_approvals'),
    db.prepare('DELETE FROM unseal_requests'),
    db.prepare('DELETE FROM assignments'),
    db.prepare('DELETE FROM exclusions'),
    db.prepare('DELETE FROM participants'),
    ...rows.map((r) =>
      db
        .prepare('INSERT INTO participants (name, phone_e164, family, is_kid, is_admin) VALUES (?, ?, ?, ?, ?)')
        .bind(r.name, r.phone, r.family, r.kid ? 1 : 0, r.phone && admins.includes(r.phone) ? 1 : 0),
    ),
  ]);
  const { results: saved } = await db.prepare('SELECT id, name FROM participants').all<{ id: number; name: string }>();
  const idOf = new Map(saved.map((s) => [s.name.toLowerCase(), s.id]));
  const ex = (body.exclusions ?? []).map(([a, b]) => [idOf.get(a.trim().toLowerCase())!, idOf.get(b.trim().toLowerCase())!]);
  if (ex.length)
    await db.batch(ex.map(([a, b]) => db.prepare('INSERT OR IGNORE INTO exclusions (a_id, b_id) VALUES (?, ?)').bind(a, b)));
  return c.json({ ok: true, adults: adultCount, kids: kidCount, exclusions: ex.length, check: await drawCheck(db) });
});

admin.get('/participants', async (c) => {
  // Phones and families are needed by the admin to check the list. Matches are never included.
  const { results: people } = await c.env.DB.prepare(
    'SELECT id, name, phone_e164, family, is_kid FROM participants ORDER BY id',
  ).all();
  const { results: ex } = await c.env.DB.prepare(
    `SELECT a.name AS a, b.name AS b FROM exclusions e
     JOIN participants a ON a.id = e.a_id JOIN participants b ON b.id = e.b_id`,
  ).all();
  return c.json({ participants: people, exclusions: ex });
});

/** Loads the saved list and runs the draw (rules loosened only if needed). Nothing is saved. */
async function runDraw(db: D1Database) {
  const { results: people } = await db.prepare('SELECT id, name, family, is_kid FROM participants').all<{
    id: number;
    name: string;
    family: string | null;
    is_kid: number;
  }>();
  const { results: ex } = await db.prepare('SELECT a_id, b_id FROM exclusions').all<{ a_id: number; b_id: number }>();
  const { assignment, relaxed } = drawPoolsSafe(
    people.map((p) => ({ ...p, isKid: !!p.is_kid })),
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
    return c.json({ error: 'Some rules have to be loosened so everyone gets a match.', details: relaxed.map((r) => r.message), needsConfirm: true }, 428);
  // Final guard: one sealed envelope per participant, nobody missing.
  if (result.size !== people.length || people.some((p) => !result.has(p.id)))
    return c.json({ error: 'Safety check failed: not everyone got a match. Nothing was saved.' }, 500);
  const key = await getKey(c.env.MATCH_KEY);
  const sealed = await Promise.all([...result].map(async ([g, r]) => ({ g, ...(await seal(key, g, r)) })));
  const startedAt = now();
  const upd = await db.batch([
    db.prepare("UPDATE game SET status = 'started', started_at = ? WHERE id = 1 AND status = 'draft'").bind(startedAt),
    ...sealed.map((s) =>
      db.prepare('INSERT INTO assignments (giver_id, ciphertext, iv) VALUES (?, ?, ?)').bind(s.g, s.ciphertext, s.iv),
    ),
  ]);
  if (!upd[0].meta.changes) return c.json({ error: 'The game has already started.' }, 409);
  const loosened = relaxed.length ? `. Rules loosened: ${relaxed.map((r) => r.message).join(' ')}` : '';
  await logEvent(db, 'game_started', null, `${people.length} participants${loosened}`);
  // Note: the result is deliberately NOT returned.
  return c.json({ ok: true, startedAt });
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
    await logEvent(db, 'unsealed', null, 'The admin viewed all matches');
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
