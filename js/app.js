import { tally, collect } from './irv.js';

// The default voting-centre address comes from config.js. A person can connect to another one on the Connect page.
const CONFIG_API = String(window.QUICK_VOTE_API || '').replace(/\/$/, '');
let apiBase = CONFIG_API;
const app = document.getElementById('app');
let cleanup = null;

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeImg = (s) => (typeof s === 'string' && s.startsWith('data:image/') ? s : '');
// crypto.randomUUID needs HTTPS. A phone on a plain HTTP test link does not have it.
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
const MODE_EMOJI = { ranked: '🗳️', hands: '✋' };
const sumCounts = (counts) => Object.values(counts || {}).reduce((total, n) => total + (Number(n) || 0), 0);
const fmt = (n) => (Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1));
const settings = () => store('qv:settings') || {};
const cleanBase = (value) => {
  try {
    const url = new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) ? `${url.origin}${url.pathname}`.replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
};
const hostOf = (base) => {
  try { return new URL(base).host; } catch { return base; }
};
// A link carries the voting-centre address, so any device can open it with no setup.
const apiParam = (base) => (base && base !== CONFIG_API ? `?api=${encodeURIComponent(base)}` : '');
const appUrl = (hash) => `${location.origin}${location.pathname}#${hash}`;

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage can be blocked. The app still works for the open page. */
  }
  return null;
}

async function api(path, { method = 'GET', body, headers = {}, base } = {}) {
  let res;
  try {
    res = await fetch((base || apiBase) + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Cannot reach the server.');
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function show(html) {
  app.innerHTML = html;
}

function copyButtons(root) {
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const input = root.querySelector(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  });
}

const linkBox = (id, value) =>
  `<div class="linkbox"><input type="text" id="${id}" readonly value="${esc(value)}"><button class="button secondary" type="button" data-copy="#${id}">Copy</button></div>`;

// Shrink a picture in the browser so that it is small to store.
function shrinkImage(file, maxSide = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture.')); };
    img.src = url;
  });
}

// ---------- router ----------

function showFailure(err) {
  console.error(err);
  show(`<section class="card narrow"><h1>Something went wrong</h1>
    <p class="error">${esc(err && err.message ? err.message : err)}</p>
    <p class="muted">Press F12 and read the Console tab for more detail. Check that the Worker runs and that the voting-centre address is right (now ${esc(apiBase || 'not set')}). You can change it on the <a href="#/connect">Connect</a> page.</p>
    <div class="row"><a class="button" href="#/">Go to the start</a></div></section>`);
}

// A link can carry a voting-centre address. Use it only if this browser already knows it, or the person trusts it.
function selectApi(id, params) {
  const raw = params.get('api');
  const fromLink = raw ? cleanBase(raw) : '';
  if (raw && !fromLink) {
    showFailure(new Error('The link has a voting-centre address that is not valid.'));
    return false;
  }
  const known = store(`qv:${id}:api`);
  const trusted = store('qv:trusted') || [];
  if (fromLink && ![known, CONFIG_API, settings().apiBase, ...trusted].includes(fromLink)) {
    showTrust(id, fromLink);
    return false;
  }
  if (fromLink) store(`qv:${id}:api`, fromLink);
  apiBase = fromLink || known || settings().apiBase || CONFIG_API;
  return true;
}

function showTrust(id, base) {
  show(`
    <section class="card narrow">
      <h1>Connect to this voting centre?</h1>
      <p>This link wants to use the voting centre at</p>
      <p><b>${esc(hostOf(base))}</b></p>
      <p class="error">Continue only if you know and trust this address. You will type a password on this page. A false address can steal it.</p>
      <div class="row">
        <button class="button" type="button" id="trust">Continue</button>
        <a class="button secondary" href="#/">Cancel</a>
      </div>
    </section>`);
  document.getElementById('trust').addEventListener('click', () => {
    store('qv:trusted', [...(store('qv:trusted') || []), base]);
    route();
  });
}

function route() {
  if (cleanup) cleanup();
  cleanup = null;
  document.body.classList.remove('booth-mode');
  window.scrollTo(0, 0);
  const [pathPart, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const [view, id, key] = pathPart.split('/').filter(Boolean);
  apiBase = settings().apiBase || CONFIG_API;
  try {
    let page;
    if (view === 'connect') page = connect();
    else if (view === 'new') page = newPoll(false);
    else if (view === 'local' && id === 'new') page = newPoll(true);
    else if (view === 'local' && id) page = localPoll(id);
    else if ((view === 'p' && id) || (view === 'admin' && id && key) || (view === 'results' && id)) {
      if (!selectApi(id, params)) return;
      if (view === 'p') page = booth(id);
      else if (view === 'admin') page = admin(id, key);
      else page = publicResults(id);
    } else page = home();
    Promise.resolve(page).catch(showFailure);
  } catch (err) {
    showFailure(err);
  }
}

// ---------- connect to a voting centre ----------

function connect() {
  const current = settings();
  show(`
    <section class="card narrow">
      <h1>Connect to a voting centre</h1>
      <p>A voting centre stores the polls and adds up the votes. It is a Cloudflare Worker that you set up. Enter its address. If you set an organiser code, enter that too.</p>
      <p class="muted">The address and the code stay in this browser. The code lets this browser make new polls. It does not open polls that already exist.</p>
      <form id="connect-form">
        <label for="api-url">Voting-centre address</label>
        <input type="url" id="api-url" placeholder="https://quick-vote.your-name.workers.dev" required value="${esc(current.apiBase || '')}">
        <label for="api-code">Organiser code (leave empty if none)</label>
        <input type="password" id="api-code" autocomplete="off" value="${esc(current.createCode || '')}">
        <div id="connect-msg"></div>
        <div class="row">
          <button class="button big" type="submit">Connect</button>
          ${current.apiBase ? '<button class="button secondary" type="button" id="disconnect">Disconnect</button>' : ''}
        </div>
      </form>
    </section>`);
  const msg = document.getElementById('connect-msg');
  document.getElementById('connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const base = cleanBase(document.getElementById('api-url').value);
    const code = document.getElementById('api-code').value;
    if (!base) {
      msg.innerHTML = '<p class="error">Enter an address that starts with https:// (or http://localhost for a test).</p>';
      return;
    }
    msg.innerHTML = '<p class="muted">Checking…</p>';
    try {
      const ping = await api('/api/ping', { base });
      if (ping.createCodeRequired && !code) throw new Error('This voting centre needs an organiser code.');
      if (code) await api('/api/check-code', { method: 'POST', base, body: { createCode: code } });
      store('qv:settings', { apiBase: base, createCode: code });
      msg.innerHTML = `<p class="notice">✓ Connected to <b>${esc(hostOf(base))}</b>.</p>
        <div class="row"><a class="button" href="#/new">Make a multi-booth poll</a></div>`;
    } catch (err) {
      if (err.offline) {
        msg.innerHTML = `<p class="error">Cannot reach ${esc(hostOf(base))}. Check the address. Also check that <code>ALLOWED_ORIGIN</code> on the Worker allows ${esc(location.origin)}.</p>`;
      } else if (err.status === 404) {
        msg.innerHTML = '<p class="error">That address does not look like a Quick Vote voting centre.</p>';
      } else {
        msg.innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
    }
  });
  const out = document.getElementById('disconnect');
  if (out) out.addEventListener('click', () => { store('qv:settings', null); connect(); });
}

// ---------- home ----------

const localKeyFor = (id) => `qv:local:poll:${id}`;

// Single-booth polls that this device holds.
function listLocalPolls() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('qv:local:poll:')) out.push(JSON.parse(localStorage.getItem(key)));
    }
  } catch {
    /* Storage can be blocked. */
  }
  return out.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

function home() {
  const mine = listLocalPolls();
  const apiNow = settings().apiBase || CONFIG_API;
  const myPolls = store('qv:mypolls') || [];
  show(`
    <section class="card narrow">
      <h1>Ranked-choice votes, made simple.</h1>
      <p><b>One booth.</b> Run the whole poll on this device. Voters rank the choices here, and the device shows the result. It needs no network after this page loads.</p>
      <div class="row"><a class="button big" href="#/local/new">Make a single-booth poll</a></div>
    </section>
    <section class="card narrow">
      <p><b>Many booths.</b> Make a poll on a voting centre. Each group opens a booth on its own device. The voting centre adds up all the booths. This needs a network.</p>
      <p class="muted">${apiNow ? `Voting centre: <b>${esc(hostOf(apiNow))}</b> · <a href="#/connect">Change</a>` : '<a href="#/connect">Connect to a voting centre</a> first.'}</p>
      <div class="row"><a class="button secondary" href="#/new">Make a multi-booth poll</a></div>
      ${myPolls.length ? `
        <h3>Your multi-booth polls</h3>
        <ul class="groups">
          ${myPolls.map((m) => `<li><a href="#/admin/${esc(m.id)}/${esc(m.adminKey)}">${esc(m.title)}</a> <span class="muted">· ${esc(hostOf(m.api || ''))}</span></li>`).join('')}
        </ul>
        <p class="muted">These admin links are saved in this browser. Anyone who uses this browser can open them.</p>` : ''}
    </section>
    ${mine.length ? `
    <section class="card narrow">
      <h2>Polls on this device</h2>
      <ul class="groups">
        ${mine.map((p) => `<li><a href="#/local/${esc(p.id)}">${esc(p.title)}</a> <span class="muted">· ${p.status === 'finished' ? 'voting closed' : 'voting open'}</span></li>`).join('')}
      </ul>
    </section>` : ''}
    <section class="card narrow">
      <h2>Open a booth</h2>
      <p class="muted">For a multi-booth poll. Paste the poll link or the poll code.</p>
      <form id="open-form">
        <input type="text" id="poll-ref" aria-label="Poll link or code" autocomplete="off" required>
        <div class="row"><button class="button" type="submit">Open</button></div>
      </form>
    </section>`);
  document.getElementById('open-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const ref = document.getElementById('poll-ref').value.trim();
    if (ref.includes('#/')) {
      location.hash = ref.slice(ref.indexOf('#'));
      return;
    }
    const m = ref.match(/^([a-z0-9]+)$/);
    if (m) location.hash = `#/p/${m[1]}`;
  });
}

// ---------- make a poll ----------

function newPoll(local = false) {
  if (!local) {
    apiBase = settings().apiBase || CONFIG_API;
    if (!apiBase) {
      location.hash = '#/connect';
      return;
    }
  }
  const storedCode = settings().createCode;
  show(`
    <section class="card narrow">
      <h1>${local ? 'Make a single-booth poll' : 'Make a multi-booth poll'}</h1>
      ${local ? '<p class="muted">This poll lives on this device only. Nothing is sent to a server.</p>' : `<p class="muted">Voting centre: <b>${esc(hostOf(apiBase))}</b> · <a href="#/connect">Change</a></p>`}
      <form id="poll-form">
        <label for="title">Question</label>
        <input type="text" id="title" maxlength="120" required placeholder="What must the Master Chef dish be?">
        <label for="description">Notes for voters (optional)</label>
        <textarea id="description" maxlength="500"></textarea>
        <label for="max-ranks">How many choices can each voter rank?</label>
        <input type="number" id="max-ranks" min="1" max="12" value="3" required>
        ${local ? `
        <label for="booth-password">Password to close voting</label>
        <input type="text" id="booth-password" minlength="4" maxlength="100" required autocomplete="off">
        <p class="muted">You need this password to close voting, to reopen it and to delete the poll. Keep it from the voters. It stays on this device.</p>` : `
        <label for="booth-minutes">Longest time a booth stays open (minutes)</label>
        <input type="number" id="booth-minutes" min="1" max="1440" value="120" placeholder="No limit">
        <p class="muted">Each booth closes itself this long after its start time. Leave empty for no limit.</p>
        <label for="booth-password">Booth password</label>
        <input type="text" id="booth-password" minlength="4" maxlength="100" required autocomplete="off">
        <p class="muted">Give this password to each leader who runs a booth.</p>`}
        <h2>Choices</h2>
        <p class="muted">Add 2 to 12 choices. A picture is optional.</p>
        <div id="choices"></div>
        <div class="row"><button class="button secondary" type="button" id="add-choice">Add a choice</button></div>
        ${local || storedCode ? '' : `
        <label for="create-code">Organiser code (leave empty if none)</label>
        <input type="password" id="create-code" autocomplete="off">`}
        <div id="form-error"></div>
        <div class="row"><button class="button big" type="submit" id="create-btn">Create poll</button></div>
      </form>
    </section>`);

  const list = document.getElementById('choices');
  const addRow = () => {
    if (list.children.length >= 12) return;
    const row = document.createElement('div');
    row.className = 'choice-row';
    row.innerHTML = `
      <label class="thumb" title="Add a picture">📷<input type="file" accept="image/*"></label>
      <input type="text" maxlength="60" placeholder="Choice name" aria-label="Choice name" required>
      <button class="button secondary remove" type="button" aria-label="Remove this choice">Remove</button>`;
    const thumb = row.querySelector('.thumb');
    row.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        row.dataset.image = await shrinkImage(file);
        thumb.style.backgroundImage = `url(${row.dataset.image})`;
        thumb.firstChild.textContent = '';
      } catch (err) {
        document.getElementById('form-error').innerHTML = `<p class="error">${esc(err.message)}</p>`;
      }
    });
    row.querySelector('.remove').addEventListener('click', () => {
      if (list.children.length > 2) row.remove();
    });
    list.appendChild(row);
  };
  addRow(); addRow(); addRow();
  document.getElementById('add-choice').addEventListener('click', addRow);

  document.getElementById('poll-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('create-btn');
    const errBox = document.getElementById('form-error');
    errBox.innerHTML = '';
    btn.disabled = true;
    try {
      const choices = [...list.children].map((row) => ({
        label: row.querySelector('input[type=text]').value,
        image: row.dataset.image || null,
      }));
      if (local) {
        const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
        const poll = {
          id,
          title: document.getElementById('title').value.trim(),
          description: document.getElementById('description').value.trim(),
          maxRanks: Math.min(Math.max(parseInt(document.getElementById('max-ranks').value, 10) || 3, 1), choices.length),
          choices: choices.map((c, i) => ({ id: i + 1, label: c.label.trim(), image: c.image })),
          password: document.getElementById('booth-password').value,
          status: 'open',
          ballots: [],
          createdAt: Date.now(),
        };
        store(localKeyFor(id), poll);
        if (!store(localKeyFor(id))) throw new Error('This device could not save the poll. The pictures may be too large. Try smaller pictures or fewer of them.');
        location.hash = `#/local/${id}`;
        return;
      }
      const created = await api('/api/polls', {
        method: 'POST',
        body: {
          title: document.getElementById('title').value,
          description: document.getElementById('description').value,
          maxRanks: document.getElementById('max-ranks').value,
          boothMinutes: document.getElementById('booth-minutes').value,
          boothPassword: document.getElementById('booth-password').value,
          createCode: storedCode || (document.getElementById('create-code') ? document.getElementById('create-code').value : ''),
          choices,
        },
      });
      created.boothPassword = document.getElementById('booth-password').value;
      created.title = document.getElementById('title').value;
      // Keep the admin link in this browser. It is the only way to see the results.
      store(`qv:${created.id}:api`, apiBase);
      store('qv:mypolls', [{ id: created.id, title: created.title, adminKey: created.adminKey, api: apiBase, createdAt: Date.now() }, ...(store('qv:mypolls') || [])].slice(0, 50));
      showCreated(created);
    } catch (err) {
      errBox.innerHTML = `<p class="error">${esc(err.message)}${storedCode && err.status === 403 ? ' <a href="#/connect">Connect again</a> with the right code.' : ''}</p>`;
      btn.disabled = false;
    }
  });
}

function showCreated({ id, adminKey, boothPassword, title }) {
  show(`
    <section class="card narrow">
      <h1>Your poll is ready</h1>
      <p><b>${esc(title)}</b></p>
      <h2>Booth link</h2>
      <p>Share this link with each leader. Share the booth password in a separate message.</p>
      ${linkBox('booth-link', appUrl(`/p/${id}${apiParam(apiBase)}`))}
      <p>Booth password: <b>${esc(boothPassword)}</b></p>
      <h2>Your admin link</h2>
      <p class="error">Save this link now. It is the only way to see the results. It is not shown again.</p>
      ${linkBox('admin-link', appUrl(`/admin/${id}/${adminKey}${apiParam(apiBase)}`))}
      <div class="row"><a class="button" href="#/admin/${esc(id)}/${esc(adminKey)}">Go to the admin page</a></div>
    </section>`);
  copyButtons(app);
}

// ---------- booth ----------

// Markup that the multi-booth booth and the single-booth poll share.
const choiceCardHtml = (c) => `
  <button class="choice-card" type="button" data-id="${c.id}">
    ${safeImg(c.image) ? `<img src="${safeImg(c.image)}" alt="">` : ''}
    <span class="label">${esc(c.label)}</span>
    <span class="rank-badge" hidden></span>
  </button>`;

const handRowHtml = (c, value) => `
  <div class="hand-row">
    ${safeImg(c.image) ? `<img src="${safeImg(c.image)}" alt="">` : ''}
    <span class="label">${esc(c.label)}</span>
    <button class="step" type="button" data-step="-1" data-id="${c.id}" aria-label="One less for ${esc(c.label)}">−</button>
    <input type="number" inputmode="numeric" min="0" max="5000" value="${Number(value) || 0}" data-hand="${c.id}" aria-label="Votes for ${esc(c.label)}">
    <button class="step" type="button" data-step="1" data-id="${c.id}" aria-label="One more for ${esc(c.label)}">+</button>
  </div>`;

function handsBarsHtml(choices, counts) {
  const rows = choices.map((c) => ({ c, n: Number(counts[c.id]) || 0 })).sort((a, b) => b.n - a.n);
  const top = rows[0].n;
  return `<div class="round">${rows.map((r) => `
    <div class="bar-line">
      <span class="name">${esc(r.c.label)}</span>
      <span class="bar-track"><span class="bar" style="display:block;width:${top ? (r.n / top) * 100 : 0}%"></span></span>
      <span class="num">${r.n}</span>
    </div>`).join('')}</div>`;
}

const boothKey = (id) => `qv:${id}:session`;
const queueKey = (id) => `qv:${id}:queue`;
const statsKey = (id) => `qv:${id}:stats`;
const localKey = (id) => `qv:${id}:local`;

async function booth(id) {
  const session = store(boothKey(id));
  if (session) return runBooth(id, session);

  let title = 'Polling booth';
  try {
    title = (await api(`/api/polls/${id}`)).title;
  } catch (err) {
    if (err.status === 404) return show('<section class="card narrow"><h1>Poll not found</h1><p>Check the link.</p></section>');
  }
  show(`
    <section class="card narrow">
      <h1>${esc(title)}</h1>
      <p>Set up a polling booth on this device.</p>
      <form id="booth-form">
        <label for="booth-name">Your group name</label>
        <input type="text" id="booth-name" maxlength="40" required placeholder="1st Ennis Cubs">
        <label for="booth-pass">Booth password</label>
        <input type="password" id="booth-pass" required autocomplete="off">
        <label>How will your group vote?</label>
        <label class="inline"><input type="radio" name="mode" value="ranked" checked> 🗳️ Each cub casts a ranked vote on this device</label>
        <label class="inline"><input type="radio" name="mode" value="hands"> ✋ We count hands. I enter the totals for each choice</label>
        <label>When does voting start?</label>
        <label class="inline"><input type="radio" name="start" value="now" checked> Now</label>
        <label class="inline"><input type="radio" name="start" value="later"> Later, at
          <input type="time" id="start-time" aria-label="Start time"></label>
        <p class="muted">A later start must be within the next 24 hours. The booth is ready when you open it. It starts at that time.</p>
        <div id="booth-error"></div>
        <div class="row"><button class="button big" type="submit">Open the booth</button></div>
      </form>
    </section>`);
  document.getElementById('booth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('booth-pass').value;
    const later = document.querySelector('input[name=start]:checked').value === 'later';
    const mode = document.querySelector('input[name=mode]:checked').value;
    const timeValue = document.getElementById('start-time').value;
    if (later && !timeValue) {
      document.getElementById('booth-error').innerHTML = '<p class="error">Choose a start time.</p>';
      return;
    }
    try {
      const poll = await api(`/api/polls/${id}/booth`, { method: 'POST', body: { password } });
      const offset = poll.now - Date.now();
      let startAt = poll.now;
      if (later) {
        // The next time that the clock shows this value, within 24 hours.
        const [hh, mm] = timeValue.split(':').map(Number);
        const when = new Date();
        when.setHours(hh, mm, 0, 0);
        if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
        startAt = when.getTime() + offset;
      }
      const fresh = {
        password,
        label: document.getElementById('booth-name').value.trim(),
        boothId: uuid(),
        mode,
        offset,
        startAt,
        endAt: poll.boothMinutes ? startAt + poll.boothMinutes * 60000 : null,
        poll,
      };
      store(boothKey(id), fresh);
      runBooth(id, fresh);
    } catch (err) {
      document.getElementById('booth-error').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  });
}

function runBooth(id, session) {
  const { poll } = session;
  document.body.classList.add('booth-mode');
  // A session that an older version saved can miss some fields. Add them.
  if (!session.boothId) session.boothId = uuid();
  if (session.startAt == null) session.startAt = Date.now() + (session.offset || 0);
  if (session.endAt === undefined) session.endAt = null;
  store(boothKey(id), session);
  const mode = session.mode === 'hands' ? 'hands' : 'ranked';
  const emoji = MODE_EMOJI[mode];
  let editing = false;
  let picks = [];
  let syncing = false;
  let online = navigator.onLine !== false;
  let authFailed = false;
  let lastError = '';
  let overall = null;
  let overallState = '';
  let overallError = '';
  let status = poll.status;
  let timer = null;
  let tick = null;

  const serverNow = () => Date.now() + (session.offset || 0);
  const phase = () => {
    const t = serverNow();
    if (t < session.startAt) return 'waiting';
    if (session.endAt && t >= session.endAt) return 'ended';
    return 'voting';
  };
  const canVote = () => phase() === 'voting' && status === 'open';
  const clock = (ms) => new Date(ms - (session.offset || 0)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Show the booth window state and lock the cards outside the window.
  function refreshWindow() {
    const el = document.getElementById('window');
    if (!el) return;
    const p = phase();
    if (p === 'waiting') el.textContent = `Voting starts at ${clock(session.startAt)}. Please wait.`;
    else if (p === 'ended') el.textContent = 'The voting time for this booth has ended. Waiting ballots still send.';
    else el.textContent = session.endAt ? `This booth closes itself at ${clock(session.endAt)}.` : '';
    el.hidden = !el.textContent;
    app.querySelectorAll('.choice-card').forEach((card) => { card.disabled = p !== 'voting'; });
    if (p !== 'voting' && picks.length) {
      picks = [];
      app.querySelectorAll('.choice-card').forEach((card) => {
        card.classList.remove('picked');
        card.querySelector('.rank-badge').hidden = true;
      });
    }
    const sendBtn = document.getElementById('send-hands');
    if (sendBtn) {
      const total = sumCounts(Object.fromEntries([...app.querySelectorAll('[data-hand]')].map((i) => [i.dataset.hand, parseInt(i.value, 10) || 0])));
      document.getElementById('hand-total').textContent = total;
      sendBtn.disabled = total === 0 || !canVote();
      app.querySelectorAll('[data-hand], .step').forEach((el) => { el.disabled = p !== 'voting'; });
    }
    const castBtn = document.getElementById('cast');
    if (castBtn) castBtn.disabled = picks.length === 0 || !canVote();
  }

  const queue = () => store(queueKey(id)) || [];
  const handsPending = () => mode === 'hands' && !!session.hands && !session.hands.accepted && !session.hands.rejected;
  // Votes that are on this device only: waiting ballots, or show-of-hands totals that the server has not accepted.
  const waitingVotes = () => queue().length + (handsPending() ? session.hands.total : 0);
  const stats = () => store(statsKey(id)) || { cast: 0, sent: 0, discarded: 0 };
  const saveStats = (patch) => store(statsKey(id), { ...stats(), ...patch });

  // One call sends waiting ballots and the booth report. With no ballots it is a check on the poll status.
  async function sync() {
    if (syncing) return;
    syncing = true;
    updateStatus();
    try {
      let more = true;
      while (more) {
        const batch = queue().slice(0, 50);
        const st = stats();
        const res = await api(`/api/polls/${id}/ballots`, {
          method: 'POST',
          headers: { 'x-booth-password': session.password },
          body: {
            ballots: batch,
            report: {
              boothId: session.boothId,
              booth: session.label,
              mode,
              castTotal: st.cast,
              discarded: st.discarded,
              startAt: session.startAt,
              endAt: session.endAt,
              hands: handsPending() ? { counts: session.hands.counts, castAt: session.hands.castAt } : undefined,
            },
          },
        });
        online = true;
        authFailed = false;
        lastError = '';
        session.offset = res.now - Date.now();
        store(boothKey(id), session);
        const gone = new Set([...res.accepted, ...res.rejected]);
        store(queueKey(id), queue().filter((b) => !gone.has(b.clientId)));
        saveStats({ sent: stats().sent + res.accepted.length, discarded: stats().discarded + res.rejected.length });
        status = res.status;
        if (mode === 'hands' && session.hands) {
          if (res.handsAcceptedAt === session.hands.castAt) session.hands.accepted = true;
          else if (!session.hands.accepted && status !== 'open') {
            session.hands.rejected = true;
            saveStats({ discarded: session.hands.total });
          }
          store(boothKey(id), session);
        }
        more = batch.length > 0 && queue().length > 0 && gone.size > 0;
      }
    } catch (err) {
      if (err.status === 401) authFailed = true;
      else if (err.offline) online = false;
      else lastError = err.message;
    }
    syncing = false;
    updateStatus();
    refreshWindow();
    loadOverall();
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Short line for the top of the page, and a long message for the results page.
  function updateStatus() {
    const waiting = waitingVotes();
    const late = stats().discarded;
    let cls = 'ok';
    let short;
    let long;
    if (authFailed) {
      cls = 'bad';
      short = 'Booth password not accepted';
      long = 'The voting centre no longer accepts this booth password. Ask the organiser.';
    } else if (lastError) {
      cls = 'bad';
      short = 'Cannot reach the voting centre properly';
      long = `The voting centre refused the last message: "${lastError}". Votes on this device are safe. Tell the organiser.`;
    } else if (waiting > 0 && !online) {
      cls = 'warn';
      short = `Offline · ${plural(waiting, 'vote')} saved on this device`;
      long = `⚠ Offline. ${plural(waiting, 'vote')} ${waiting === 1 ? 'is' : 'are'} saved on this device only. `
        + 'They have not reached the voting centre. They send by themselves when this device is back online. Keep this device safe.';
    } else if (waiting > 0) {
      cls = 'warn';
      short = `Sending ${plural(waiting, 'vote')}…`;
      long = `⚠ ${plural(waiting, 'vote')} ${waiting === 1 ? 'has' : 'have'} not reached the voting centre yet. Sending now.`;
    } else if (!online) {
      cls = 'idle';
      short = 'Offline · nothing waiting to send';
      long = stats().cast ? `Offline. All ${plural(stats().cast - late, 'vote')} reached the voting centre before the signal went.` : 'Offline.';
    } else {
      short = 'Online · all votes sent';
      long = stats().cast ? `✓ All ${plural(stats().cast - late, 'vote')} reached the voting centre.` : '✓ Online.';
    }
    if (late > 0) long += ` ${plural(late, 'vote')} came after voting closed and ${late === 1 ? 'was' : 'were'} not counted.`;
    document.querySelectorAll('.net').forEach((el) => {
      el.className = `net ${cls}`;
      el.textContent = short;
    });
    const box = document.getElementById('sendstate');
    if (box) {
      box.className = `sendstate ${cls}`;
      box.textContent = long;
    }
  }

  // The overall result is available when the organiser has made the poll final and shared it.
  async function loadOverall() {
    if (status === 'final' && !overall) {
      try {
        overall = await api(`/api/polls/${id}/results`);
        overallState = 'ready';
      } catch (err) {
        overallState = err.status === 403 ? 'private' : 'error';
        overallError = err.offline ? '' : err.message;
      }
    }
    updateOverall();
  }

  function updateOverall() {
    const el = document.getElementById('overall');
    if (!el) return;
    if (overall) {
      el.innerHTML = resultsHtml(overall, overall.ballots, overall.manual, overall.countMode, overall.handsMode);
    } else if (status === 'open') {
      el.innerHTML = '<p class="muted">The overall result shows here after voting closes and the organiser shares it.</p>';
    } else if (status === 'closed') {
      el.innerHTML = '<p class="muted">Voting has closed. The organiser is waiting for every booth to send its votes.</p>';
    } else if (overallState === 'private') {
      el.innerHTML = '<p class="muted">The organiser has not shared the overall result yet. Open this page again later.</p>';
    } else {
      el.innerHTML = `<p class="muted">The overall result could not load. ${overallError ? esc(overallError) : 'This device may be offline.'}</p>`;
    }
  }

  let view = 'ballot';

  // The result from this booth only.
  function localResult() {
    if (mode === 'hands') {
      if (!session.hands) return '<p class="muted">No totals were entered at this booth.</p>';
      const counts = session.hands.counts;
      return `
        <p class="muted">${plural(session.hands.total, 'cub')} counted by show of hands. This result is for this booth only. It can differ from the overall result.</p>
        ${handsBarsHtml(poll.choices, counts)}`;
    }
    const local = store(localKey(id)) || [];
    if (!local.length) return '<p class="muted">No votes were cast at this booth on this device.</p>';
    return `
      <p class="muted">${plural(local.length, 'vote')} cast at this booth. This result is for this booth only. It can differ from the overall result.</p>
      ${renderResults(poll, local.map((b) => b.ranking))}`;
  }

  // The booth counts hands and enters one total for each choice.
  function renderHands() {
    view = 'hands';
    const counts = session.hands ? session.hands.counts : {};
    show(`
      <div class="booth-bar">
        <h1 class="booth-title">${esc(poll.title)}</h1>
        <div class="status-line">${emoji} ${esc(session.label)} · <span class="net" id="status"></span></div>
      </div>
      <p class="notice" id="window" hidden></p>
      <p class="instruction"><b>Count the hands.</b> Ask who wants each choice. Enter how many cubs voted for each one. Each cub votes once.</p>
      ${poll.description ? `<p class="muted instruction">${esc(poll.description)}</p>` : ''}
      <div class="hand-list">
        ${poll.choices.map((c) => handRowHtml(c, counts[c.id])).join('')}
      </div>
      <p class="hand-total">Total: <b id="hand-total">0</b> cubs counted</p>
      <div class="ballot-actions">
        ${session.hands ? '<button class="button secondary big" type="button" id="cancel-hands">Cancel</button>' : ''}
        <button class="button big" type="button" id="send-hands" disabled>Send our totals</button>
      </div>`);
    updateStatus();
    const inputs = [...app.querySelectorAll('[data-hand]')];
    const read = () => Object.fromEntries(inputs.map((i) => [i.dataset.hand, Math.max(0, Math.min(parseInt(i.value, 10) || 0, 5000))]));
    inputs.forEach((i) => i.addEventListener('input', refreshWindow));
    app.querySelectorAll('.step').forEach((btn) => btn.addEventListener('click', () => {
      const input = app.querySelector(`[data-hand="${btn.dataset.id}"]`);
      input.value = Math.max(0, Math.min((parseInt(input.value, 10) || 0) + Number(btn.dataset.step), 5000));
      refreshWindow();
    }));
    document.getElementById('send-hands').addEventListener('click', () => {
      if (!canVote()) return refreshWindow();
      const counts = read();
      const total = sumCounts(counts);
      if (total === 0) return;
      if (!confirm(`Send these totals? ${plural(total, 'cub')} counted. You can change the totals until voting closes.`)) return;
      session.hands = { counts, total, castAt: Math.round(serverNow()), accepted: false, rejected: false };
      store(boothKey(id), session);
      saveStats({ cast: total, discarded: 0 });
      editing = false;
      render();
      sync();
    });
    const cancel = document.getElementById('cancel-hands');
    if (cancel) cancel.addEventListener('click', () => { editing = false; render(); });
    refreshWindow();
  }
  const showSummary = () => phase() === 'ended' || status !== 'open' || (mode === 'hands' && !!session.hands && !editing);

  // After the booth window ends, or when voting closes, the booth shows its own count and the overall result.
  function renderSummary() {
    view = 'summary';
    show(`
      <div class="booth-bar">
        <h1 class="booth-title">${esc(poll.title)}</h1>
        <div class="status-line">${emoji} ${esc(session.label)} · <span class="net" id="status"></span></div>
      </div>
      <section class="card">
        <h2>Our booth result</h2>
        <p id="sendstate" class="sendstate"></p>
        ${localResult()}
        ${mode === 'hands' && status === 'open' && phase() === 'voting' ? '<div class="row"><button class="button secondary small" type="button" id="change-hands">Change our totals</button></div>' : ''}
      </section>
      <section class="card">
        <h2>Overall result</h2>
        <div id="overall"></div>
        <div class="row"><button class="button secondary small" type="button" id="check-again">Check again</button></div>
      </section>
      <div class="finish-area">
        <button class="button secondary small" type="button" id="forget">Delete this booth</button>
        <form id="forget-form" hidden>
          <p><b>Delete this booth?</b> The booth result on this device will be deleted. You cannot get it back. Votes that already reached the voting centre stay in the overall poll. To open the booth again, you must enter the booth password.</p>
          <label for="forget-pass">Booth password</label>
          <input type="password" id="forget-pass" autocomplete="off" required>
          <div id="forget-error"></div>
          <div class="row">
            <button class="button danger small" type="submit">Delete booth</button>
            <button class="button secondary small" type="button" id="forget-cancel">Cancel</button>
          </div>
        </form>
      </div>`);
    updateStatus();
    updateOverall();
    loadOverall();
    const change = document.getElementById('change-hands');
    if (change) change.addEventListener('click', () => { editing = true; render(); });
    const again = document.getElementById('check-again');
    again.addEventListener('click', async () => {
      again.disabled = true;
      again.textContent = 'Checking…';
      await sync();
      again.disabled = false;
      again.textContent = 'Check again';
    });
    const btn = document.getElementById('forget');
    const form = document.getElementById('forget-form');
    btn.addEventListener('click', () => { btn.hidden = true; form.hidden = false; document.getElementById('forget-pass').focus(); });
    document.getElementById('forget-cancel').addEventListener('click', () => {
      form.reset();
      document.getElementById('forget-error').innerHTML = '';
      form.hidden = true;
      btn.hidden = false;
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = document.getElementById('forget-error');
      if (document.getElementById('forget-pass').value !== session.password) {
        err.innerHTML = '<p class="error">Wrong booth password.</p>';
      } else if (waitingVotes() > 0) {
        err.innerHTML = `<p class="error">${plural(waitingVotes(), 'vote')} ${waitingVotes() === 1 ? 'has' : 'have'} not reached the voting centre. Get this device online first, so the votes can send.</p>`;
      } else {
        forget();
      }
    });
  }

  function render() {
    if (showSummary()) return renderSummary();
    if (mode === 'hands') return renderHands();
    view = 'ballot';
    show(`
      <div class="booth-bar">
        <h1 class="booth-title">${esc(poll.title)}</h1>
        <div class="status-line">${emoji} ${esc(session.label)} · <span class="net" id="status"></span></div>
      </div>
      <p class="notice" id="window" hidden></p>
      <p class="instruction"><b>Tap your favourite first.</b> Then tap your next choices (up to ${poll.maxRanks}).</p>
      ${poll.description ? `<p class="muted instruction">${esc(poll.description)}</p>` : ''}
      <div class="choice-grid">
        ${poll.choices.map(choiceCardHtml).join('')}
      </div>
      <div class="ballot-actions">
        <button class="button secondary big" type="button" id="reset">Start again</button>
        <button class="button big" type="button" id="cast" disabled>Cast my vote</button>
      </div>
      <div class="finish-area">
        <button class="button secondary small" type="button" id="finish">Finish voting here</button>
        <form id="finish-form" hidden>
          <p><b>Finish voting at this booth?</b> No more votes can be cast here. Waiting ballots still send.</p>
          <label for="finish-pass">Booth password</label>
          <input type="password" id="finish-pass" autocomplete="off" required>
          <div id="finish-error"></div>
          <div class="row">
            <button class="button danger small" type="submit">Finish voting</button>
            <button class="button secondary small" type="button" id="finish-cancel">Cancel</button>
          </div>
        </form>
      </div>`);
    updateStatus();

    const cards = [...app.querySelectorAll('.choice-card')];
    const paint = () => {
      cards.forEach((card) => {
        const pos = picks.indexOf(Number(card.dataset.id));
        const badge = card.querySelector('.rank-badge');
        card.classList.toggle('picked', pos >= 0);
        card.setAttribute('aria-pressed', pos >= 0);
        badge.hidden = pos < 0;
        badge.textContent = pos + 1;
      });
      refreshWindow();
    };
    cards.forEach((card) => card.addEventListener('click', () => {
      const cid = Number(card.dataset.id);
      if (picks.includes(cid)) picks = picks.filter((p) => p !== cid);
      else if (picks.length < poll.maxRanks) picks.push(cid);
      paint();
    }));
    document.getElementById('reset').addEventListener('click', () => { picks = []; paint(); });
    document.getElementById('cast').addEventListener('click', cast);
    const finishBtn = document.getElementById('finish');
    const finishForm = document.getElementById('finish-form');
    finishBtn.addEventListener('click', () => {
      finishBtn.hidden = true;
      finishForm.hidden = false;
      document.getElementById('finish-pass').focus();
    });
    document.getElementById('finish-cancel').addEventListener('click', () => {
      finishForm.reset();
      document.getElementById('finish-error').innerHTML = '';
      finishForm.hidden = true;
      finishBtn.hidden = false;
    });
    finishForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (document.getElementById('finish-pass').value !== session.password) {
        document.getElementById('finish-error').innerHTML = '<p class="error">Wrong booth password.</p>';
        return;
      }
      finish();
    });
    paint();
  }

  function cast() {
    if (!canVote()) return refreshWindow();
    // The cast time uses the server clock offset from the last contact. The server never stores it.
    store(queueKey(id), [...queue(), {
      clientId: uuid(),
      ranking: picks,
      castAt: Date.now() + (session.offset || 0),
    }]);
    store(localKey(id), [...(store(localKey(id)) || []), { booth: session.label, ranking: picks }]);
    saveStats({ cast: stats().cast + 1 });
    picks = [];
    const overlay = document.createElement('div');
    overlay.className = 'thanks';
    overlay.innerHTML = '<div class="big-emoji">✅</div><h1>Vote cast!</h1><p>Thank you. The next voter can step up.</p>';
    const close = () => { overlay.remove(); render(); };
    overlay.addEventListener('click', close);
    document.body.appendChild(overlay);
    setTimeout(close, 2500);
    sync();
  }

  function finish() {
    const now = serverNow();
    session.startAt = Math.min(session.startAt, now);
    session.endAt = now;
    store(boothKey(id), session);
    render();
    sync();
  }

  function forget() {
    store(boothKey(id), null);
    store(statsKey(id), null);
    store(localKey(id), null);
    store(queueKey(id), null);
    location.hash = '#/';
  }

  render();
  sync();
  timer = setInterval(sync, 20000);
  tick = setInterval(() => {
    if (showSummary() !== (view === 'summary')) render();
    else refreshWindow();
  }, 1000);
  const goOffline = () => { online = false; updateStatus(); };
  window.addEventListener('online', sync);
  window.addEventListener('offline', goOffline);
  cleanup = () => {
    clearInterval(timer);
    clearInterval(tick);
    window.removeEventListener('online', sync);
    window.removeEventListener('offline', goOffline);
  };
}

// ---------- results ----------

// Group list with the emoji for each way of voting.
function renderGroups(ballots, manual) {
  const groups = new Map();
  const group = (name) => {
    const key = String(name).trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, { name: String(name).trim(), ranked: 0, hands: 0 });
    return groups.get(key);
  };
  ballots.forEach((b) => { group(b.booth).ranked += 1; });
  manual.forEach((m) => { group(m.booth).hands += sumCounts(m.counts); });
  if (groups.size === 0) return '';
  const rows = [...groups.values()].map((g) => `
    <li><b>${esc(g.name)}</b>
      ${g.ranked ? ` · ${MODE_EMOJI.ranked} ${g.ranked} ranked ${g.ranked === 1 ? 'ballot' : 'ballots'}` : ''}
      ${g.hands ? ` · ${MODE_EMOJI.hands} ${g.hands} by show of hands` : ''}</li>`).join('');
  return `<h2>Groups in this count</h2>
    <p class="muted">${MODE_EMOJI.ranked} ranked ballots · ${MODE_EMOJI.hands} show of hands (first choice only)</p>
    <ul class="groups">${rows}</ul>`;
}

// The full result: the count, a note about estimates, and the group list.
function resultsHtml(poll, ballots, manual, mode, handsMode) {
  const ids = poll.choices.map((c) => c.id);
  const handsTotal = manual.reduce((total, m) => total + sumCounts(m.counts), 0);
  let note = '';
  if (mode !== 'site' && handsMode === 'estimate' && handsTotal > 0) {
    note = ballots.length
      ? `${MODE_EMOJI.hands} Estimate: the later choices of ${handsTotal} show-of-hands voters are filled in from the ${ballots.length} ranked ballots. This is not what those voters chose.`
      : `${MODE_EMOJI.hands} There are no ranked ballots to estimate from. Show-of-hands voters count as first choice only.`;
  }
  return renderResults(poll, collect(ids, ballots, manual, mode, handsMode), mode, note) + renderGroups(ballots, manual);
}

function renderResults(poll, rankings, mode = 'ballot', note = '') {
  const byId = Object.fromEntries(poll.choices.map((c) => [c.id, c]));
  const result = tally(poll.choices.map((c) => c.id), rankings);
  const name = (cid) => esc(byId[cid].label);

  if (result.ballotCount === 0) return '<p class="notice">No votes were cast.</p>';

  const top = result.winners.length === 1
    ? `<div class="winner">
         ${safeImg(byId[result.winners[0]].image) ? `<img src="${safeImg(byId[result.winners[0]].image)}" alt="">` : ''}
         <div><div class="muted">Winner</div><h2>${name(result.winners[0])}</h2></div>
       </div>`
    : `<div class="winner"><div><div class="muted">Tie</div><h2>${result.winners.map(name).join(' and ')}</h2></div></div>`;

  const rounds = result.rounds.map((round, i) => {
    const ids = Object.keys(round.counts).map(Number).sort((a, b) => round.counts[b] - round.counts[a]);
    return `
      <div class="round">
        <h3>Round ${i + 1}</h3>
        ${ids.map((cid) => `
          <div class="bar-line ${round.eliminated === cid ? 'out' : ''}">
            <span class="name">${name(cid)}</span>
            <span class="bar-track"><span class="bar" style="display:block;width:${round.active ? (round.counts[cid] / round.active) * 100 : 0}%"></span></span>
            <span class="num">${fmt(round.counts[cid])}</span>
          </div>`).join('')}
        <p class="muted">${fmt(round.active)} counted${round.exhausted > 1e-9 ? `, ${fmt(round.exhausted)} with no choice left` : ''}.
          ${round.eliminated ? `${name(round.eliminated)} is out.` : ''}</p>
      </div>`;
  }).join('');

  const order = result.order.map((cid, i) => `<li>${name(cid)}${i === 0 && result.winners.length > 1 ? ' (tie)' : ''}</li>`).join('');
  return `${top}
    <p>${fmt(result.ballotCount)} ${mode === 'site' ? 'groups' : 'votes'} counted.</p>
    ${note ? `<p class="notice">${note}</p>` : ''}
    <h2>Final order</h2><ol>${order}</ol>
    <h2>Round by round</h2>${rounds}`;
}

async function publicResults(id) {
  try {
    const poll = await api(`/api/polls/${id}/results`);
    show(`<section class="card"><h1>${esc(poll.title)}</h1>${resultsHtml(poll, poll.ballots, poll.manual, poll.countMode, poll.handsMode)}</section>`);
  } catch (err) {
    show(`<section class="card narrow"><h1>Results</h1><p class="error">${esc(err.message)}</p></section>`);
  }
}

// ---------- admin ----------

async function admin(id, key) {
  const headers = { authorization: `Bearer ${key}` };
  let timer = null;
  let dirty = false;
  cleanup = () => clearInterval(timer);

  async function load() {
    // Do not redraw while the leader types in the group count form.
    if (dirty) return;
    let poll;
    try {
      poll = await api(`/api/polls/${id}/admin`, { headers });
    } catch (err) {
      clearInterval(timer);
      return show(`<section class="card narrow"><h1>Admin</h1><p class="error">${esc(err.message)}</p></section>`);
    }
    draw(poll);
  }

  const stateLabel = { open: 'Voting is open', closed: 'Voting is closed. Results are provisional', final: 'Final' };

  const windowText = (b) => {
    if (!b.startAt) return '';
    const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `${fmt(b.startAt)}${b.endAt ? ` to ${fmt(b.endAt)}` : ''}`;
  };

  const choiceCounts = (poll, m) => poll.choices
    .filter((c) => m.counts[c.id])
    .map((c) => `${esc(c.label)}: ${m.counts[c.id]}`)
    .join(', ');

  function manualCard(poll) {
    const editable = poll.status !== 'final';
    return `
      <section class="card" id="manual-card">
        <h2>${MODE_EMOJI.hands} Groups counted by show of hands</h2>
        ${editable ? '<p class="muted">A booth can send its own show-of-hands totals. Use the form below for a group that did not use a booth. Enter how many voters picked each choice first. Use the group name of a booth to add to that group.</p>' : ''}
        ${poll.manual.length ? poll.manual.map((m, i) => `
          <div class="row"><span>${MODE_EMOJI.hands} <b>${esc(m.booth)}</b> · ${choiceCounts(poll, m)}
              <span class="muted">(${m.source === 'booth' ? 'sent by the booth' : 'entered by you'})</span></span>
            ${editable && m.source === 'admin' ? `<button class="button secondary" type="button" data-edit="${i}">Edit</button>
            <button class="button secondary" type="button" data-remove="${i}">Remove</button>` : ''}</div>`).join('') : '<p class="muted">None.</p>'}
        ${editable ? `
          <form id="manual-form">
            <label for="manual-name">Group name</label>
            <input type="text" id="manual-name" maxlength="40" required>
            ${poll.choices.map((c) => `
              <label for="manual-${c.id}">${esc(c.label)}</label>
              <input type="number" id="manual-${c.id}" data-choice="${c.id}" min="0" max="5000" value="0">`).join('')}
            <div class="row"><button class="button" type="submit">Save group count</button></div>
          </form>` : ''}
      </section>`;
  }

  function boothTable(poll) {
    if (!poll.booths.length) return '<p class="muted">No booth has reported yet.</p>';
    return `<table><thead><tr><th>Group</th><th>Ballots received</th><th>Cast on the device</th><th>Booth window</th><th></th></tr></thead><tbody>
      ${poll.booths.map((b) => {
        const waiting = Math.max(b.cast - b.received - b.discarded, 0);
        const late = b.discarded ? ` (${b.discarded} cast after close, not counted)` : '';
        return `<tr><td>${MODE_EMOJI[b.mode] || MODE_EMOJI.ranked} ${esc(b.booth)}</td><td>${b.received}</td><td>${b.cast}</td><td>${windowText(b)}</td>
          <td>${waiting ? `<b>${waiting} still waiting</b>` : 'All received'}${late}</td></tr>`;
      }).join('')}</tbody></table>`;
  }

  function draw(poll) {
    const resultsLink = appUrl(`/results/${id}${apiParam(apiBase)}`);
    show(`
      <section class="card">
        <h1>${esc(poll.title)}</h1>
        <p><b>${stateLabel[poll.status]}</b> · ${poll.total} ballots received</p>
        ${boothTable(poll)}
        ${poll.status === 'open' ? `
          <h2>Booth link</h2>${linkBox('booth-link', appUrl(`/p/${id}${apiParam(apiBase)}`))}
          <p class="muted">Results stay hidden until you close voting. Booths with no signal keep their ballots and send them later.</p>
          <div class="row"><button class="button danger" type="button" id="close">Close voting</button></div>` : ''}
        ${poll.status === 'closed' ? `
          <p class="notice">${poll.pending
            ? `${poll.pending} ballots cast before the close are not received yet. This page updates by itself. Wait for the booths, then finalise.`
            : 'All cast ballots are received.'}</p>
          <div class="row"><button class="button danger" type="button" id="finalize">Finalise results</button></div>` : ''}
      </section>
      ${manualCard(poll)}
      ${poll.status !== 'open' ? `
        <section class="card">
          <h2>Results${poll.status === 'closed' ? ' (provisional)' : ''}</h2>
          <fieldset ${poll.status === 'final' ? 'disabled' : ''}>
            <legend>How votes are counted</legend>
            <label class="inline"><input type="radio" name="mode" value="ballot" ${poll.countMode === 'ballot' ? 'checked' : ''}> Every ballot is one vote</label>
            <label class="inline"><input type="radio" name="mode" value="site" ${poll.countMode === 'site' ? 'checked' : ''}> Every group is one vote</label>
          </fieldset>
          <fieldset ${poll.status === 'final' || poll.countMode === 'site' ? 'disabled' : ''}>
            <legend>${MODE_EMOJI.hands} Show-of-hands groups</legend>
            <label class="inline"><input type="radio" name="hands" value="first" ${poll.handsMode === 'first' ? 'checked' : ''}> Count the first choice only</label>
            <label class="inline"><input type="radio" name="hands" value="estimate" ${poll.handsMode === 'estimate' ? 'checked' : ''}> Estimate later choices from the ranked ballots</label>
            ${poll.countMode === 'site' ? '<p class="muted">This setting is not used when every group is one vote.</p>' : ''}
          </fieldset>
          ${resultsHtml(poll, poll.ballots, poll.manual, poll.countMode, poll.handsMode)}
          ${poll.status === 'final' ? '<div class="row"><button class="button secondary" type="button" id="csv">Download ballots (CSV)</button></div>' : ''}
        </section>` : ''}
      ${poll.status === 'final' ? `
        <section class="card">
          <h2>Share the results</h2>
          <label><input type="checkbox" id="share" ${poll.resultsPublic ? 'checked' : ''}> Anyone with the link can see the results</label>
          <div ${poll.resultsPublic ? '' : 'hidden'} id="share-link">${linkBox('results-link', resultsLink)}</div>
        </section>` : ''}`);
    copyButtons(app);

    const post = async (path, body) => {
      try {
        await api(`/api/polls/${id}/${path}`, { method: 'POST', headers, body });
        dirty = false;
        load();
      } catch (err) {
        alert(err.message);
      }
    };
    document.querySelectorAll('input[name=mode]').forEach((radio) => {
      radio.addEventListener('change', () => post('mode', { mode: radio.value }));
    });
    document.querySelectorAll('input[name=hands]').forEach((radio) => {
      radio.addEventListener('change', () => post('mode', { handsMode: radio.value }));
    });
    const form = document.getElementById('manual-form');
    if (form) {
      form.addEventListener('input', () => { dirty = true; });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const counts = {};
        form.querySelectorAll('[data-choice]').forEach((input) => { counts[input.dataset.choice] = input.value || 0; });
        post('manual', { booth: document.getElementById('manual-name').value, counts });
      });
      document.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
        const m = poll.manual[btn.dataset.edit];
        document.getElementById('manual-name').value = m.booth;
        form.querySelectorAll('[data-choice]').forEach((input) => { input.value = m.counts[input.dataset.choice] || 0; });
        dirty = true;
        form.scrollIntoView({ behavior: 'smooth' });
      }));
      document.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
        const m = poll.manual[btn.dataset.remove];
        if (confirm(`Remove the hand count for ${m.booth}?`)) post('manual', { booth: m.booth, counts: {} });
      }));
    }

    const act = (btnId, path, question) => {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', async () => {
        if (!confirm(question(poll))) return;
        try {
          await api(`/api/polls/${id}/${path}`, { method: 'POST', headers });
          load();
        } catch (err) {
          alert(err.message);
        }
      });
    };
    act('close', 'close', () => 'Close voting? Booths stop taking new votes. Ballots cast before now still count when they arrive.');
    act('finalize', 'finalize', (p) => (p.pending
      ? `${p.pending} ballots are not received yet. They are lost if you finalise now. Finalise anyway?`
      : 'Finalise the results? The server refuses all later ballots.'));

    if (poll.status === 'final') {
      clearInterval(timer);
      document.getElementById('share').addEventListener('change', async (e) => {
        await api(`/api/polls/${id}/share`, { method: 'POST', headers, body: { public: e.target.checked } });
        document.getElementById('share-link').hidden = !e.target.checked;
      });
      document.getElementById('csv').addEventListener('click', () => downloadCsv(poll));
    }
  }

  timer = setInterval(load, 15000);
  await load();
}

function downloadCsv(poll) {
  const byId = Object.fromEntries(poll.choices.map((c) => [c.id, c.label]));
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const grouped = poll.ballots.some((b) => b.booth);
  const header = [...(grouped ? ['Group'] : []), ...Array.from({ length: poll.maxRanks }, (_, i) => `Rank ${i + 1}`)];
  const lines = [header, ...poll.ballots.map((b) => [...(grouped ? [b.booth] : []), ...b.ranking.map((r) => byId[r])])];
  const blob = new Blob([lines.map((l) => l.map(cell).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ballots-${poll.id}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- single-booth poll (this device only) ----------

function localPoll(id) {
  const key = localKeyFor(id);
  const poll = store(key);
  if (!poll) {
    return show(`<section class="card narrow"><h1>Poll not found</h1>
      <p>A single-booth poll is saved on the device that made it. Open this link on that device, in the same browser.</p>
      <div class="row"><a class="button" href="#/">Go to the start</a></div></section>`);
  }
  document.body.classList.add('booth-mode');
  const save = () => store(key, poll);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let picks = [];

  // Ask for the poll password before a step that cannot be undone. With no password, ask for a plain confirmation.
  function guard(question, button, danger, onOk) {
    const area = document.getElementById('guard');
    area.innerHTML = `
      <form class="guard">
        <p><b>${question}</b></p>
        ${poll.password ? '<label for="guard-pass">Password</label><input type="password" id="guard-pass" autocomplete="off" required>' : ''}
        <div id="guard-error"></div>
        <div class="row">
          <button class="button ${danger ? 'danger ' : ''}small" type="submit">${button}</button>
          <button class="button secondary small" type="button" id="guard-cancel">Cancel</button>
        </div>
      </form>`;
    const input = document.getElementById('guard-pass');
    if (input) input.focus();
    document.getElementById('guard-cancel').addEventListener('click', () => { area.innerHTML = ''; });
    area.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (poll.password && input.value !== poll.password) {
        document.getElementById('guard-error').innerHTML = '<p class="error">Wrong password.</p>';
        return;
      }
      onOk();
    });
  }

  const header = (line) => `
    <div class="booth-bar">
      <h1 class="booth-title">${esc(poll.title)}</h1>
      <div class="status-line">${MODE_EMOJI.ranked} This device only · ${line}</div>
    </div>`;

  function renderVoting() {
    show(`
      ${header(`<b>${poll.ballots.length}</b> ${poll.ballots.length === 1 ? 'vote' : 'votes'} cast`)}
      <p class="instruction"><b>Tap your favourite first.</b> Then tap your next choices (up to ${poll.maxRanks}).</p>
      ${poll.description ? `<p class="muted instruction">${esc(poll.description)}</p>` : ''}
      <div class="choice-grid">${poll.choices.map(choiceCardHtml).join('')}</div>
      <div class="ballot-actions">
        <button class="button secondary big" type="button" id="reset">Start again</button>
        <button class="button big" type="button" id="cast" disabled>Cast my vote</button>
      </div>
      <div class="finish-area">
        <button class="button secondary small" type="button" id="finish">Close voting and show the result</button>
        <div id="guard"></div>
      </div>`);
    picks = [];
    const cards = [...app.querySelectorAll('.choice-card')];
    const paint = () => {
      cards.forEach((card) => {
        const pos = picks.indexOf(Number(card.dataset.id));
        const badge = card.querySelector('.rank-badge');
        card.classList.toggle('picked', pos >= 0);
        card.setAttribute('aria-pressed', pos >= 0);
        badge.hidden = pos < 0;
        badge.textContent = pos + 1;
      });
      document.getElementById('cast').disabled = picks.length === 0;
    };
    cards.forEach((card) => card.addEventListener('click', () => {
      const cid = Number(card.dataset.id);
      if (picks.includes(cid)) picks = picks.filter((p) => p !== cid);
      else if (picks.length < poll.maxRanks) picks.push(cid);
      paint();
    }));
    document.getElementById('reset').addEventListener('click', () => { picks = []; paint(); });
    document.getElementById('cast').addEventListener('click', () => {
      poll.ballots.push(picks);
      save();
      const overlay = document.createElement('div');
      overlay.className = 'thanks';
      overlay.innerHTML = '<div class="big-emoji">✅</div><h1>Vote cast!</h1><p>Thank you. The next voter can step up.</p>';
      let closed = false;
      const close = () => { if (!closed) { closed = true; overlay.remove(); renderVoting(); } };
      overlay.addEventListener('click', close);
      document.body.appendChild(overlay);
      setTimeout(close, 2500);
    });
    document.getElementById('finish').addEventListener('click', () => {
      if (poll.ballots.length === 0) {
        document.getElementById('guard').innerHTML = '<p class="error">No votes have been cast yet.</p>';
        return;
      }
      guard('Close voting? No more votes can be cast. The result shows.', 'Close voting', false, () => {
        poll.status = 'finished';
        save();
        render();
      });
    });
    paint();
  }

  function renderFinished() {
    const total = poll.ballots.length;
    show(`
      ${header('voting closed')}
      <section class="card">
        <h2>Result</h2>
        ${total === 0 ? '<p class="muted">No votes were cast.</p>' : `<p class="muted">${plural(total, 'vote')} cast on this device.</p>${renderResults(poll, poll.ballots)}`}
      </section>
      <div class="finish-area">
        <div class="row">
          ${total ? '<button class="button secondary small" type="button" id="csv">Download votes (CSV)</button>' : ''}
          <button class="button secondary small" type="button" id="reopen">Reopen voting</button>
          <button class="button secondary small" type="button" id="delete">Delete this poll</button>
          <a class="button secondary small" href="#/">Back to the start</a>
        </div>
        <div id="guard"></div>
      </div>`);
    const csv = document.getElementById('csv');
    if (csv) csv.addEventListener('click', () => downloadCsv({ id: poll.id, maxRanks: poll.maxRanks, choices: poll.choices, ballots: poll.ballots.map((r) => ({ booth: '', ranking: r })) }));
    document.getElementById('reopen').addEventListener('click', () => {
      guard('Reopen voting? The votes so far stay.', 'Reopen voting', false, () => { poll.status = 'open'; save(); render(); });
    });
    document.getElementById('delete').addEventListener('click', () => {
      guard('Delete this poll? The votes and the result on this device will be deleted. You cannot get them back.', 'Delete poll', true, () => {
        store(key, null);
        location.hash = '#/';
      });
    });
  }

  function render() {
    if (poll.status === 'finished') renderFinished();
    else renderVoting();
  }

  render();
}

// ---------- start ----------
// This must stay last. The views above use constants that are set up in file order.

window.addEventListener('hashchange', route);
route();

// Cache the site files, so a single-booth poll also works when the device opens the site with no network.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
