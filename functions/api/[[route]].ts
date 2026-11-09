import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import type { Env, Identity, Participant } from '../lib/types';
import { verifyIdentity } from '../lib/auth';
import { listFromEnv, normalizePhone } from '../lib/phone';
import { draw, DrawError } from '../lib/draw';
import { getKey, seal, unseal } from '../lib/crypto';
import { findCandidates, maskEmail } from '../lib/nameMatch';

type Who = { identity: Identity; participant: Participant | null; isAdmin: boolean };
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
app.post('/check-phone', async (c) => {
  const { phone } = await c.req.json<{ phone?: string }>().catch(() => ({ phone: '' }));
  const p = normalizePhone(phone ?? '');
  if (!p) return c.json({ ok: false, error: 'Please enter a German (+49) or Indian (+91) mobile number.' });
  const isAdmin = listFromEnv(c.env.ADMIN_PHONES).includes(p);
  const row = await c.env.DB.prepare('SELECT 1 FROM participants WHERE phone_e164 = ?').bind(p).first();
  if (!row && !isAdmin) return c.json({ ok: false, error: "This number isn't on the list. Ask the admin to add you." });
  return c.json({ ok: true, phone: p });
});

// ---------- Authentication ----------
app.use('*', async (c, next) => {
  const token = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const identity = await verifyIdentity(token, c.env, new URL(c.req.url).host);
  if (!identity) return c.json({ error: 'Please sign in again.' }, 401);

  let participant: Participant | null = null;
  let isAdmin = false;
  if (identity.kind === 'phone') {
    participant = await c.env.DB.prepare('SELECT * FROM participants WHERE phone_e164 = ?')
      .bind(identity.phone)
      .first<Participant>();
    isAdmin = listFromEnv(c.env.ADMIN_PHONES).includes(identity.phone);
  } else {
    participant = await c.env.DB.prepare('SELECT * FROM participants WHERE google_email = ?')
      .bind(identity.email)
      .first<Participant>();
    isAdmin = listFromEnv(c.env.ADMIN_EMAILS).map((e) => e.toLowerCase()).includes(identity.email);
  }
  if (participant?.is_admin) isAdmin = true;
  c.set('who', { identity, participant, isAdmin });
  await next();
});

// ---------- Google fallback: find yourself and claim ----------
app.post('/google/candidates', async (c) => {
  const { identity, participant } = c.get('who');
  if (identity.kind !== 'google') return c.json({ error: 'Google sign-in only.' }, 400);
  if (participant) return c.json({ claimed: true, candidates: [] });
  const { results } = await c.env.DB.prepare('SELECT id, name, google_email FROM participants').all<{
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
  const target = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?').bind(Number(id)).first<Participant>();
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
app.get('/me', async (c) => {
  const { identity, participant, isAdmin } = c.get('who');
  const game = await gameStatus(c.env.DB);
  return c.json({
    signedInWith: identity.kind,
    isAdmin,
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

  const row = await c.env.DB.prepare('SELECT ciphertext, iv FROM assignments WHERE giver_id = ?')
    .bind(participant.id)
    .first<{ ciphertext: string; iv: string }>();
  if (!row) return c.json({ error: 'No envelope found for you. Ask the admin.' }, 404);

  const key = await getKey(c.env.MATCH_KEY);
  const receiverId = await unseal(key, participant.id, row.ciphertext, row.iv);
  const receiver = await c.env.DB.prepare('SELECT name FROM participants WHERE id = ?')
    .bind(receiverId)
    .first<{ name: string }>();

  let firstOpenedAt = participant.revealed_at;
  let firstTime = false;
  if (!firstOpenedAt) {
    firstOpenedAt = now();
    const res = await c.env.DB.prepare('UPDATE participants SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL')
      .bind(firstOpenedAt, participant.id)
      .run();
    if (res.meta.changes) {
      firstTime = true;
      await logEvent(c.env.DB, 'revealed', participant.name);
    } else {
      const again = await c.env.DB.prepare('SELECT revealed_at FROM participants WHERE id = ?')
        .bind(participant.id)
        .first<{ revealed_at: string }>();
      firstOpenedAt = again!.revealed_at;
    }
  }
  return c.json({ receiver: receiver?.name ?? '???', firstOpenedAt, firstTime });
});

async function unsealState(env: Env) {
  const req = await env.DB.prepare('SELECT * FROM unseal_requests ORDER BY id DESC LIMIT 1').first<{
    id: number;
    created_at: string;
    unsealed_at: string | null;
  }>();
  if (!req) return null;
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, a.approved_at FROM unseal_approvals a JOIN participants p ON p.id = a.participant_id
     WHERE a.request_id = ? ORDER BY a.approved_at`,
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
  const { participant, isAdmin } = c.get('who');
  if (!participant && !isAdmin) return c.json({ error: "You're not on the participant list." }, 403);
  const game = await gameStatus(c.env.DB);
  const { results: people } = await c.env.DB.prepare(
    'SELECT id, name, revealed_at, google_email FROM participants ORDER BY name COLLATE NOCASE',
  ).all<{ id: number; name: string; revealed_at: string | null; google_email: string | null }>();
  const { results: events } = await c.env.DB.prepare(
    'SELECT ts, type, actor_name, detail FROM events ORDER BY id DESC LIMIT 100',
  ).all();
  return c.json({
    game: { status: game.status, startedAt: game.started_at, endsAt: endsAt(c.env) },
    participants: people.map((p) => ({
      id: p.id,
      name: p.name,
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
  const { participant, isAdmin } = c.get('who');
  if (!participant) return c.json({ error: "You're not on the participant list." }, 403);
  if (isAdmin) return c.json({ error: "The admin can't approve their own unseal request." }, 403);
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
admin.use('*', async (c, next) => {
  if (!c.get('who').isAdmin) return c.json({ error: 'Admins only.' }, 403);
  await next();
});

interface ImportBody {
  participants: Array<{ name: string; phone: string; family?: string | null }>;
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
    const phone = normalizePhone(p.phone ?? '');
    if (!name) errors.push(`Row ${i + 1}: name is missing.`);
    if (!phone) errors.push(`Row ${i + 1} (${name}): "${p.phone}" isn't a valid +49 or +91 mobile number.`);
    if (phone && seenPhones.has(phone)) errors.push(`Row ${i + 1} (${name}): duplicate phone number.`);
    if (name && seenNames.has(name.toLowerCase())) errors.push(`Row ${i + 1}: duplicate name "${name}".`);
    if (phone) seenPhones.add(phone);
    seenNames.add(name.toLowerCase());
    return { name, phone: phone!, family: (p.family ?? '').trim() || null };
  });
  const byName = new Map(rows.map((r) => [r.name.toLowerCase(), r]));
  for (const [a, b] of body.exclusions ?? []) {
    if (!byName.has(a.trim().toLowerCase()) || !byName.has(b.trim().toLowerCase()))
      errors.push(`Exclusion "${a} / ${b}": both names must be on the list.`);
  }
  if (rows.length < 3) errors.push('You need at least 3 participants.');
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
        .prepare('INSERT INTO participants (name, phone_e164, family, is_admin) VALUES (?, ?, ?, ?)')
        .bind(r.name, r.phone, r.family, admins.includes(r.phone) ? 1 : 0),
    ),
  ]);
  const { results: saved } = await db.prepare('SELECT id, name FROM participants').all<{ id: number; name: string }>();
  const idOf = new Map(saved.map((s) => [s.name.toLowerCase(), s.id]));
  const ex = (body.exclusions ?? []).map(([a, b]) => [idOf.get(a.trim().toLowerCase())!, idOf.get(b.trim().toLowerCase())!]);
  if (ex.length)
    await db.batch(ex.map(([a, b]) => db.prepare('INSERT OR IGNORE INTO exclusions (a_id, b_id) VALUES (?, ?)').bind(a, b)));
  return c.json({ ok: true, count: rows.length, exclusions: ex.length });
});

admin.get('/participants', async (c) => {
  // Phones and families are needed by the admin to check the list. Matches are never included.
  const { results: people } = await c.env.DB.prepare(
    'SELECT id, name, phone_e164, family FROM participants ORDER BY id',
  ).all();
  const { results: ex } = await c.env.DB.prepare(
    `SELECT a.name AS a, b.name AS b FROM exclusions e
     JOIN participants a ON a.id = e.a_id JOIN participants b ON b.id = e.b_id`,
  ).all();
  return c.json({ participants: people, exclusions: ex });
});

admin.post('/start', async (c) => {
  const db = c.env.DB;
  const game = await gameStatus(db);
  if (game.status !== 'draft') return c.json({ error: 'The game has already started.' }, 409);
  const { results: people } = await db.prepare('SELECT id, name, family FROM participants').all<{
    id: number;
    name: string;
    family: string | null;
  }>();
  const { results: ex } = await db.prepare('SELECT a_id, b_id FROM exclusions').all<{ a_id: number; b_id: number }>();
  let result: Map<number, number>;
  try {
    result = draw(people, ex.map((e) => [e.a_id, e.b_id]));
  } catch (e) {
    if (e instanceof DrawError) return c.json({ error: e.message }, 400);
    throw e;
  }
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
  await logEvent(db, 'game_started', null, `${people.length} participants`);
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
  const { results: people } = await db.prepare('SELECT id, name FROM participants').all<{ id: number; name: string }>();
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const { results: rows } = await db.prepare('SELECT giver_id, ciphertext, iv FROM assignments').all<{
    giver_id: number;
    ciphertext: string;
    iv: string;
  }>();
  const key = await getKey(c.env.MATCH_KEY);
  const pairs = await Promise.all(
    rows.map(async (r) => ({
      giver: nameOf.get(r.giver_id),
      receiver: nameOf.get(await unseal(key, r.giver_id, r.ciphertext, r.iv)),
    })),
  );
  return c.json({ pairs });
});

app.route('/admin', admin);

app.all('*', (c) => c.json({ error: 'Not found' }, 404));

export const onRequest = handle(app);
