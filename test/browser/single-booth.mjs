// A single-booth poll. It must use no network at all.
import { createHarness, sleep } from './helpers.mjs';

const h = createHarness({ configApi: 'http://localhost:9' });
const { openPage, q, qa, t, submit, check, storageOf } = h;
const pixel = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
h.state.offline = true;

// 1. Home page
const w = openPage('http://localhost:8000/');
await sleep(200);
check('home has the single-booth button', qa(w, 'a.button').some((a) => a.textContent === 'Make a single-booth poll' && a.getAttribute('href') === '#/local/new'));
check('home has the multi-booth button', qa(w, 'a.button').some((a) => a.textContent === 'Make a multi-booth poll'));

// 2. Make a poll with one picture
w.location.hash = '#/local/new';
await sleep(300);
check('form has no booth minutes or organiser code', !q(w, '#booth-minutes') && !q(w, '#create-code'));
check('form has no voting-method choice', !q(w, 'input[name=method]') && !t(w, '#app').includes('count hands'));
check('password is required and labelled', q(w, '#booth-password').required === true && t(w, 'label[for=booth-password]') === 'Password to close voting', t(w, 'label[for=booth-password]'));
q(w, '#title').value = 'Which game should we play?';
q(w, '#max-ranks').value = '3';
q(w, '#booth-password').value = 'pw12';
const rows = qa(w, '.choice-row');
['Tag', 'Hide and seek', 'Capture the flag'].forEach((label, i) => { rows[i].querySelector('input[type=text]').value = label; });
rows[0].dataset.image = pixel;
submit(w, '#poll-form');
await sleep(500);
const id = w.location.hash.replace('#/local/', '');
check('goes to the poll page', /^[a-z0-9]{8}$/.test(id), w.location.hash);
check('shows 3 cards', qa(w, '.choice-card').length === 3);
check('only the choice with a picture has an image', qa(w, '.choice-card img').length === 1 && !q(w, '.noimg'));
check('no placeholder picture', !w.document.body.textContent.includes('🍽'));

// 3. Cast votes
async function cast(picks) {
  const cards = qa(w, '.choice-card');
  picks.forEach((i) => cards[i].click());
  q(w, '#cast').click();
  q(w, '.thanks')?.click();
  await sleep(100);
}
await cast([0, 1]);
await cast([2]);
await cast([2, 1]);
await cast([0]);
check('vote counter shows 4', t(w, '.status-line').includes('4 votes cast'), t(w, '.status-line'));

// 4. Close with a wrong, then the right password
q(w, '#finish').click();
q(w, '#guard-pass').value = 'nope';
submit(w, '#guard form');
check('wrong password refused', t(w, '#guard-error') === 'Wrong password.');
q(w, '#guard-pass').value = 'pw12';
submit(w, '#guard form');
await sleep(200);
check('result page shown', t(w, '.card h2') === 'Result' && t(w, '.card').includes('4 votes cast on this device'), t(w, '.card').slice(0, 80));
check('result has a count', t(w, '.card').includes('Final order'));

// 5. Reload: the poll survives, and the home page lists it
const w2 = openPage(`http://localhost:8000/#/local/${id}`, storageOf(w));
await sleep(300);
check('reload shows the result', t(w2, '.card h2') === 'Result');
w2.location.hash = '#/';
await sleep(300);
check('home lists the poll', t(w2, '.groups').includes('Which game should we play?') && t(w2, '.groups').includes('voting closed'), t(w2, '.groups'));

// 6. Reopen with the password, then close again
q(w, '#reopen').click();
q(w, '#guard-pass').value = 'pw12';
submit(w, '#guard form');
await sleep(200);
check('reopen goes back to voting', !!q(w, '#cast'));
check('earlier votes are kept', t(w, '.status-line').includes('4 votes cast'));
q(w, '#finish').click();
q(w, '#guard-pass').value = 'pw12';
submit(w, '#guard form');
await sleep(200);

// 7. Delete with the password
q(w, '#delete').click();
check('delete explains the loss', t(w, '#guard').includes('votes and the result on this device will be deleted'));
q(w, '#guard-pass').value = 'pw12';
submit(w, '#guard form');
await sleep(300);
check('poll deleted from the device', w.localStorage.getItem(`qv:local:poll:${id}`) === null && w.location.hash === '#/');

// 8. No network call at all (the harness fails every call)
check('no network calls at all', h.fetched.length === 0, String(h.fetched.length));

h.finish();
