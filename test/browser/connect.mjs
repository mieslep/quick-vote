// A site with no default address: connect to a voting centre, make a poll, return to it from the saved list,
// and open links on other devices. Unknown addresses must ask first and must send no request.
import { API, CODE, createHarness, sleep } from './helpers.mjs';

const HOST = new URL(API).host;
const ENCODED = encodeURIComponent(API);
const h = createHarness({ configApi: '' });
const { openPage, q, t, submit, check, post, storageOf } = h;

async function connectWith(w, address, code) {
  w.location.hash = '#/connect';
  await sleep(200);
  q(w, '#api-url').value = address;
  q(w, '#api-code').value = code;
  submit(w, '#connect-form');
  await sleep(800);
  return t(w, '#connect-msg');
}

// 1. A site with no address sends "Make a multi-booth poll" to the Connect page.
const w = openPage('http://localhost:8000/');
await sleep(200);
check('home asks to connect', t(w, '.card:nth-of-type(2)').includes('Connect to a voting centre'));
w.location.hash = '#/new';
await sleep(300);
check('make-a-poll goes to the Connect page', w.location.hash === '#/connect' && t(w, 'h1') === 'Connect to a voting centre', w.location.hash);

// 2. Bad addresses
check('unreachable address', (await connectWith(w, 'http://localhost:9', '')).includes('Cannot reach localhost:9'));
check('bad scheme refused', (await connectWith(w, 'ftp://example.com', '')).includes('Enter an address'));
check('not a Quick Vote address', (await connectWith(w, `${API}/nothing`, '')).includes('does not look like a Quick Vote voting centre'));

// 3. The organiser code
check('code required', (await connectWith(w, API, '')).includes('needs an organiser code'));
check('wrong code', (await connectWith(w, API, 'nope')).includes('organiser code is wrong'));
check('settings are not saved after a failure', w.localStorage.getItem('qv:settings') === null);
const connected = await connectWith(w, API, CODE);
check('connected', connected.includes(`Connected to ${HOST}`), connected);
check('settings saved', JSON.parse(w.localStorage.getItem('qv:settings')).apiBase === API);

// 4. Make a poll. There is no code field. The links carry the address.
w.location.hash = '#/new';
await sleep(300);
check('shows the voting centre', t(w, '.card').includes(`Voting centre: ${HOST}`));
check('no organiser code field', !q(w, '#create-code'));
q(w, '#title').value = 'Class party menu';
q(w, '#booth-password').value = 'boothpw';
[...w.document.querySelectorAll('.choice-row')].forEach((row, i) => { row.querySelector('input[type=text]').value = ['Pizza', 'Pasta', 'Tacos'][i]; });
submit(w, '#poll-form');
await sleep(1200);
const boothLink = q(w, '#booth-link').value;
const adminLink = q(w, '#admin-link').value;
check('created page shown', t(w, 'h1') === 'Your poll is ready');
check('the page says this browser saved the admin link', t(w, '.card').includes('This browser has saved the admin link'));
check('booth link carries the address', boothLink.includes(`?api=${ENCODED}`), boothLink);
check('admin link carries the address', adminLink.includes(`?api=${ENCODED}`));
check('poll saved in this browser', JSON.parse(w.localStorage.getItem('qv:mypolls')).length === 1);

// 5. The saved list shows the live state and lets the organiser return
const adminKey = adminLink.split('/admin/')[1].split('/')[1].split('?')[0];
const pollId = adminLink.split('/admin/')[1].split('/')[0];
w.location.hash = '#/';
await sleep(800);
check('home lists the saved poll', t(w, '.mypolls').includes('Class party menu'), t(w, '.mypolls'));
check('list shows the poll is open', t(w, `[data-status="${pollId}"]`) === 'voting open', t(w, `[data-status="${pollId}"]`));
check('list links to the admin page', q(w, '.mypolls a').getAttribute('href') === `#/admin/${pollId}/${adminKey}`);
await post(`/api/polls/${pollId}/close`, {}, adminKey);
const w1 = openPage('http://localhost:8000/', storageOf(w));
await sleep(800);
check('list shows the poll is closed', t(w1, `[data-status="${pollId}"]`).startsWith('voting closed'), t(w1, `[data-status="${pollId}"]`));
q(w1, '.mypolls a').click();
w1.location.hash = `#/admin/${pollId}/${adminKey}`;
await sleep(900);
check('returning to the admin page works', t(w1, 'h1') === 'Class party menu' && t(w1, '.card').includes('Voting is closed'), t(w1, '.card').slice(0, 60));
const w1b = openPage('http://localhost:8000/', storageOf(w));
await sleep(500);
q(w1b, '[data-forget]').click();
check('remove takes the poll off the list', !q(w1b, '.mypolls') && JSON.parse(w1b.localStorage.getItem('qv:mypolls')).length === 0);

// 6. A different device opens the booth link. It connects at once.
const boothHash = boothLink.slice(boothLink.indexOf('#'));
const w2 = openPage(`http://localhost:8000/${boothHash}`);
await sleep(800);
check('an unknown address needs no question', !q(w2, '#trust'));
check('booth login page loads', t(w2, 'h1') === 'Class party menu', t(w2, 'h1'));
const saved2 = storageOf(w2);
check('the address is remembered for the poll', Object.values(saved2).includes(JSON.stringify(API)));

// 7. The same device opens the link again
const w3 = openPage(`http://localhost:8000/${boothHash}`, saved2);
await sleep(700);
check('the second visit loads', t(w3, 'h1') === 'Class party menu', t(w3, 'h1'));

// 8. The admin link on a new device
const adminHash = adminLink.slice(adminLink.indexOf('#'));
const w4 = openPage(`http://localhost:8000/${adminHash}`);
await sleep(900);
check('admin page loads', t(w4, 'h1') === 'Class party menu', t(w4, 'h1'));

// 9. Bad and unknown addresses in a link
const w5 = openPage('http://localhost:8000/#/p/abcdefgh?api=javascript%3Aalert(1)');
await sleep(300);
check('a bad address is refused', t(w5, 'h1') === 'Something went wrong' && t(w5, '.card').includes('not valid'));

// 10. Pasting a full link into "Open a booth" keeps the address
const w7 = openPage('http://localhost:8000/');
await sleep(200);
q(w7, '#poll-ref').value = boothLink;
submit(w7, '#open-form');
await sleep(300);
check('a pasted link keeps the address', w7.location.hash.includes('api='), w7.location.hash);

// 11. Disconnect
w.location.hash = '#/connect';
await sleep(200);
q(w, '#disconnect').click();
check('disconnect clears the settings', w.localStorage.getItem('qv:settings') === null);

h.finish();
