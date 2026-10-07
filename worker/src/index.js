const MAX_CHOICES = 12;
const MAX_IMAGE_CHARS = 150_000;
const MAX_BATCH = 50;
const MAX_MANUAL = 5000;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const cors = (env) => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
  'access-control-allow-headers': 'content-type, authorization, x-booth-password',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
});

const reply = (env, data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(env) },
  });

// ---------- crypto helpers ----------

const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

function newPollId() {
  return Array.from(randomBytes(10), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

async function sha256(text) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100_000 },
    key,
    256,
  );
  return b64(new Uint8Array(bits));
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- data helpers ----------

async function getPoll(env, id) {
  const poll = await env.DB.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first();
  if (!poll) throw new HttpError(404, 'Poll not found.');
  return poll;
}

async function getChoices(env, id) {
  const { results } = await env.DB.prepare(
    'SELECT id, label, image FROM choices WHERE poll_id = ? ORDER BY position',
  ).bind(id).all();
  return results;
}

const publicPoll = (poll, choices) => ({
  id: poll.id,
  title: poll.title,
  description: poll.description,
  maxRanks: poll.max_ranks,
  boothMinutes: poll.booth_minutes,
  status: poll.status,
  choices,
});

async function requireBooth(env, request, poll) {
  const password = request.headers.get('x-booth-password') || '';
  const hash = await hashPassword(password, poll.booth_salt);
  if (!same(hash, poll.booth_hash)) throw new HttpError(401, 'Wrong booth password.');
}

async function requireAdmin(env, request, poll) {
  const key = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!key || !same(await sha256(key), poll.admin_hash)) throw new HttpError(401, 'Wrong admin key.');
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'The request body is not valid JSON.');
  }
}

const text = (value, max, name) => {
  const out = typeof value === 'string' ? value.trim() : '';
  if (out.length > max) throw new HttpError(400, `${name} is too long.`);
  return out;
};

function cleanCounts(raw, validIds) {
  const counts = {};
  for (const [key, value] of Object.entries(raw || {})) {
    const n = parseInt(value, 10);
    if (!validIds.has(key) || !Number.isFinite(n) || n < 0 || n > MAX_MANUAL) {
      throw new HttpError(400, `Each count must be a whole number from 0 to ${MAX_MANUAL}.`);
    }
    if (n > 0) counts[key] = n;
  }
  return counts;
}

async function allManual(env, id) {
  const { results: byAdmin } = await env.DB.prepare('SELECT booth, counts FROM manual_counts WHERE poll_id = ? ORDER BY booth')
    .bind(id).all();
  const { results: byBooth } = await env.DB.prepare('SELECT booth, counts FROM hand_counts WHERE poll_id = ? ORDER BY booth')
    .bind(id).all();
  return [
    ...byAdmin.map((row) => ({ booth: row.booth, counts: JSON.parse(row.counts), source: 'admin' })),
    ...byBooth.map((row) => ({ booth: row.booth, counts: JSON.parse(row.counts), source: 'booth' })),
  ];
}

async function allRankings(env, id) {
  const { results } = await env.DB.prepare(
    'SELECT booth, ranking FROM ballots WHERE poll_id = ? ORDER BY RANDOM()',
  ).bind(id).all();
  return results.map((row) => ({ booth: row.booth, ranking: JSON.parse(row.ranking) }));
}

// ---------- routes ----------

async function createPoll(env, request) {
  const body = await readBody(request);
  if (env.CREATE_CODE && !same(String(body.createCode || ''), env.CREATE_CODE)) {
    throw new HttpError(403, 'The organiser code is wrong.');
  }
  const title = text(body.title, 120, 'The title');
  if (!title) throw new HttpError(400, 'The poll needs a title.');
  const description = text(body.description, 500, 'The description');
  const password = typeof body.boothPassword === 'string' ? body.boothPassword : '';
  if (password.length < 4 || password.length > 100) {
    throw new HttpError(400, 'The booth password needs 4 to 100 characters.');
  }
  const choices = Array.isArray(body.choices) ? body.choices : [];
  if (choices.length < 2 || choices.length > MAX_CHOICES) {
    throw new HttpError(400, `A poll needs 2 to ${MAX_CHOICES} choices.`);
  }
  const clean = choices.map((c) => {
    const label = text(c && c.label, 60, 'A choice label');
    if (!label) throw new HttpError(400, 'Each choice needs a label.');
    const image = c.image ? String(c.image) : null;
    if (image && (!image.startsWith('data:image/') || image.length > MAX_IMAGE_CHARS)) {
      throw new HttpError(400, 'A choice picture is not valid or is too large.');
    }
    return { label, image };
  });
  const maxRanks = Math.min(Math.max(parseInt(body.maxRanks, 10) || 3, 1), clean.length);
  const minutes = parseInt(body.boothMinutes, 10);
  const boothMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 1440) : null;

  const id = newPollId();
  const adminKey = b64(randomBytes(24));
  const salt = b64(randomBytes(16));
  const statements = [
    env.DB.prepare(
      `INSERT INTO polls (id, title, description, max_ranks, booth_minutes, booth_salt, booth_hash, admin_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, title, description, maxRanks, boothMinutes, salt, await hashPassword(password, salt), await sha256(adminKey), Date.now()),
    ...clean.map((c, i) =>
      env.DB.prepare('INSERT INTO choices (poll_id, position, label, image) VALUES (?, ?, ?, ?)').bind(id, i, c.label, c.image),
    ),
  ];
  await env.DB.batch(statements);
  return reply(env, { id, adminKey }, 201);
}

async function boothLogin(env, request, id) {
  const poll = await getPoll(env, id);
  const body = await readBody(request);
  const hash = await hashPassword(String(body.password || ''), poll.booth_salt);
  if (!same(hash, poll.booth_hash)) throw new HttpError(401, 'Wrong booth password.');
  return reply(env, { ...publicPoll(poll, await getChoices(env, id)), now: Date.now() });
}

async function submitBallots(env, request, id) {
  const poll = await getPoll(env, id);
  await requireBooth(env, request, poll);
  const body = await readBody(request);
  const ballots = Array.isArray(body.ballots) ? body.ballots : [];
  if (ballots.length > MAX_BATCH) throw new HttpError(400, `Send at most ${MAX_BATCH} ballots.`);
  const report = body.report || {};
  const boothId = text(report.boothId, 64, 'The booth id');
  const boothName = text(report.booth, 40, 'The section name') || 'Unnamed';
  if (!boothId) throw new HttpError(400, 'The booth report is missing.');
  const count = (n) => Math.max(0, Math.min(parseInt(n, 10) || 0, 1_000_000));
  const boothMode = report.mode === 'hands' ? 'hands' : 'ranked';
  const time = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  const now = Date.now();
  const valid = new Set((await getChoices(env, id)).map((c) => c.id));

  const statements = [
    env.DB.prepare(
      `INSERT INTO booth_reports (poll_id, booth_id, booth, cast_total, discarded, mode, start_at, end_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM polls WHERE id = ? AND status != 'final')
       ON CONFLICT (poll_id, booth_id) DO UPDATE SET
         booth = excluded.booth,
         mode = excluded.mode,
         cast_total = CASE WHEN excluded.mode = 'hands' THEN excluded.cast_total ELSE MAX(cast_total, excluded.cast_total) END,
         discarded = CASE WHEN excluded.mode = 'hands' THEN excluded.discarded ELSE MAX(discarded, excluded.discarded) END,
         start_at = excluded.start_at,
         end_at = excluded.end_at`,
    ).bind(id, boothId, boothName, count(report.castTotal), count(report.discarded), boothMode, time(report.startAt), time(report.endAt), id),
  ];
  // A booth in show-of-hands mode sends its totals in the report. A newer send replaces an older one.
  let hands = null;
  if (boothMode === 'hands' && report.hands) {
    const counts = cleanCounts(report.hands.counts, valid.size ? new Set([...valid].map(String)) : new Set());
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const castAt = Math.min(Number.isFinite(report.hands.castAt) ? report.hands.castAt : now, now);
    if (total > 0) {
      hands = { counts, total, castAt: Math.round(castAt) };
      statements.push(env.DB.prepare(
        `INSERT INTO hand_counts (poll_id, booth_id, booth, counts, total, cast_at)
         SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM polls WHERE id = ? AND (status = 'open' OR (status = 'closed' AND closed_at >= ?)))
         ON CONFLICT (poll_id, booth_id) DO UPDATE SET
           booth = excluded.booth, counts = excluded.counts, total = excluded.total, cast_at = excluded.cast_at
         WHERE excluded.cast_at >= hand_counts.cast_at`,
      ).bind(id, boothId, boothName, JSON.stringify(counts), total, hands.castAt, id, hands.castAt));
    }
  }
  for (const b of ballots) {
    const clientId = typeof b.clientId === 'string' ? b.clientId.slice(0, 64) : '';
    const ranking = Array.isArray(b.ranking) ? b.ranking : [];
    const unique = new Set(ranking);
    if (!clientId || ranking.length < 1 || ranking.length > poll.max_ranks || unique.size !== ranking.length
      || !ranking.every((r) => valid.has(r))) {
      throw new HttpError(400, 'A ballot is not valid.');
    }
    // The booth sends a cast time that it corrects with the server clock. A time in the future is not trusted.
    const castAt = Math.min(Number.isFinite(b.castAt) ? b.castAt : now, now);
    // Open: accept. Closed: accept only a ballot cast before the poll closed. Final: refuse.
    statements.push(env.DB.prepare(
      `INSERT OR IGNORE INTO ballots (poll_id, client_id, booth_id, booth, ranking)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (
         SELECT 1 FROM polls WHERE id = ? AND (status = 'open' OR (status = 'closed' AND closed_at >= ?)))`,
    ).bind(id, clientId, boothId, boothName, JSON.stringify(ranking), id, castAt));
  }
  await env.DB.batch(statements);

  // A ballot that is now in the table is accepted. All other ballots were refused as late.
  const ids = ballots.map((b) => String(b.clientId).slice(0, 64));
  let stored = new Set();
  if (ids.length > 0) {
    const { results } = await env.DB.prepare(
      `SELECT client_id FROM ballots WHERE poll_id = ? AND client_id IN (${ids.map(() => '?').join(',')})`,
    ).bind(id, ...ids).all();
    stored = new Set(results.map((r) => r.client_id));
  }
  const fresh = await getPoll(env, id);
  const row = await env.DB.prepare('SELECT cast_at FROM hand_counts WHERE poll_id = ? AND booth_id = ?').bind(id, boothId).first();
  return reply(env, {
    accepted: ids.filter((c) => stored.has(c)),
    rejected: ids.filter((c) => !stored.has(c)),
    handsAcceptedAt: row ? row.cast_at : null,
    status: fresh.status,
    now: Date.now(),
  });
}

async function adminView(env, request, id) {
  const poll = await getPoll(env, id);
  await requireAdmin(env, request, poll);
  const choices = await getChoices(env, id);
  const { results: booths } = await env.DB.prepare(
    `SELECT r.booth_id AS boothId, r.booth, r.mode, r.cast_total AS cast, r.discarded, r.start_at AS startAt, r.end_at AS endAt,
            (SELECT COUNT(*) FROM ballots b WHERE b.poll_id = r.poll_id AND b.booth_id = r.booth_id)
              + COALESCE((SELECT h.total FROM hand_counts h WHERE h.poll_id = r.poll_id AND h.booth_id = r.booth_id), 0) AS received
     FROM booth_reports r WHERE r.poll_id = ? ORDER BY r.booth, r.booth_id`,
  ).bind(id).all();
  const total = booths.reduce((sum, b) => sum + b.received, 0);
  const pending = booths.reduce((sum, b) => sum + Math.max(b.cast - b.received - b.discarded, 0), 0);
  const out = {
    ...publicPoll(poll, choices),
    resultsPublic: !!poll.results_public,
    countMode: poll.count_mode,
    handsMode: poll.hands_mode,
    manual: await allManual(env, id),
    total,
    pending,
    booths,
  };
  // Ballots stay hidden until voting closes. After that the count is provisional until the poll is final.
  if (poll.status !== 'open') out.ballots = await allRankings(env, id);
  return reply(env, out);
}

async function closePoll(env, request, id) {
  const poll = await getPoll(env, id);
  await requireAdmin(env, request, poll);
  await env.DB.prepare("UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'")
    .bind(Date.now(), id).run();
  return reply(env, { status: (await getPoll(env, id)).status });
}

async function finalizePoll(env, request, id) {
  const poll = await getPoll(env, id);
  await requireAdmin(env, request, poll);
  if (poll.status === 'open') throw new HttpError(409, 'Close voting first.');
  await env.DB.prepare("UPDATE polls SET status = 'final' WHERE id = ?").bind(id).run();
  return reply(env, { status: 'final' });
}

async function setManual(env, request, id) {
  const poll = await getPoll(env, id);
  await requireAdmin(env, request, poll);
  if (poll.status === 'final') throw new HttpError(409, 'The poll is final.');
  const body = await readBody(request);
  const booth = text(body.booth, 40, 'The group name');
  if (!booth) throw new HttpError(400, 'The group needs a name.');
  const valid = new Set((await getChoices(env, id)).map((c) => String(c.id)));
  const counts = cleanCounts(body.counts, valid);
  // An empty count removes the group.
  if (Object.keys(counts).length === 0) {
    await env.DB.prepare('DELETE FROM manual_counts WHERE poll_id = ? AND booth = ?').bind(id, booth).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO manual_counts (poll_id, booth, counts) VALUES (?, ?, ?)
       ON CONFLICT (poll_id, booth) DO UPDATE SET counts = excluded.counts`,
    ).bind(id, booth, JSON.stringify(counts)).run();
  }
  return reply(env, { manual: await allManual(env, id) });
}

async function setMode(env, request, id) {
  const poll = await getPoll(env, id);
  await requireAdmin(env, request, poll);
  if (poll.status === 'final') throw new HttpError(409, 'The poll is final.');
  const body = await readBody(request);
  const mode = body.mode === 'site' ? 'site' : body.mode === 'ballot' ? 'ballot' : poll.count_mode;
  const handsMode = body.handsMode === 'estimate' ? 'estimate' : body.handsMode === 'first' ? 'first' : poll.hands_mode;
  await env.DB.prepare('UPDATE polls SET count_mode = ?, hands_mode = ? WHERE id = ?').bind(mode, handsMode, id).run();
  return reply(env, { countMode: mode, handsMode });
}

async function shareResults(env, request, id) {
  const poll = await getPoll(env, id);
  await requireAdmin(env, request, poll);
  if (poll.status !== 'final') throw new HttpError(409, 'Finalise the poll before you share the results.');
  const body = await readBody(request);
  await env.DB.prepare('UPDATE polls SET results_public = ? WHERE id = ?').bind(body.public ? 1 : 0, id).run();
  return reply(env, { resultsPublic: !!body.public });
}

async function publicResults(env, id) {
  const poll = await getPoll(env, id);
  if (poll.status !== 'final' || !poll.results_public) {
    throw new HttpError(403, 'The results are not shared.');
  }
  const ballots = await allRankings(env, id);
  return reply(env, {
    ...publicPoll(poll, await getChoices(env, id)),
    countMode: poll.count_mode,
    handsMode: poll.hands_mode,
    manual: await allManual(env, id),
    ballots,
  });
}

async function publicInfo(env, id) {
  const poll = await getPoll(env, id);
  return reply(env, { id: poll.id, title: poll.title, status: poll.status });
}

// Lets the site test an address, and an organiser code, before it saves them.
async function checkCode(env, request) {
  const body = await readBody(request);
  if (env.CREATE_CODE && !same(String(body.createCode || ''), env.CREATE_CODE)) {
    throw new HttpError(403, 'The organiser code is wrong.');
  }
  return reply(env, { ok: true });
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;
  if (method === 'GET' && pathname === '/api/ping') return reply(env, { ok: true, createCodeRequired: !!env.CREATE_CODE });
  if (method === 'POST' && pathname === '/api/check-code') return checkCode(env, request);
  if (method === 'POST' && pathname === '/api/polls') return createPoll(env, request);
  const m = pathname.match(/^\/api\/polls\/([a-z0-9]+)(?:\/([a-z]+))?$/);
  if (!m) throw new HttpError(404, 'Not found.');
  const [, id, action] = m;
  if (method === 'GET' && !action) return publicInfo(env, id);
  if (method === 'GET' && action === 'admin') return adminView(env, request, id);
  if (method === 'GET' && action === 'results') return publicResults(env, id);
  if (method === 'POST' && action === 'booth') return boothLogin(env, request, id);
  if (method === 'POST' && action === 'ballots') return submitBallots(env, request, id);
  if (method === 'POST' && action === 'close') return closePoll(env, request, id);
  if (method === 'POST' && action === 'manual') return setManual(env, request, id);
  if (method === 'POST' && action === 'mode') return setMode(env, request, id);
  if (method === 'POST' && action === 'finalize') return finalizePoll(env, request, id);
  if (method === 'POST' && action === 'share') return shareResults(env, request, id);
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    try {
      return await route(request, env);
    } catch (err) {
      if (err instanceof HttpError) return reply(env, { error: err.message }, err.status);
      console.error(err);
      return reply(env, { error: 'Server error.' }, 500);
    }
  },
};
