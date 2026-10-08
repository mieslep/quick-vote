// A multi-booth poll from start to finish: ranked booth, offline votes, show-of-hands booth,
// close, finalise, share, re-open a booth, an older saved session, a new device, and delete.
import { API, CODE, createHarness, sleep } from './helpers.mjs';

const h = createHarness({ configApi: API });
const { openPage, q, qa, t, submit, check, post, get, storageOf, state } = h;

const created = await post('/api/polls', {
  createCode: CODE,
  title: 'Class party menu',
  maxRanks: 3,
  boothMinutes: 120,
  boothPassword: 'secret',
  choices: [{ label: 'Pizza' }, { label: 'Pasta' }, { label: 'Tacos' }, { label: 'Soup' }],
});
const { id, adminKey } = created;
const url = `http://localhost:8000/#/p/${id}`;

// 1. Log in on a fresh page load.
const w = openPage(url);
await sleep(700);
check('poll shown before voting', !q(w, '#booth-form') && !!q(w, '#open-voting'));
q(w, '#open-voting').click();
q(w, '#booth-name').value = 'Class 1';
q(w, '#booth-pass').value = 'secret';
submit(w, '#booth-form');
await sleep(900);
check('booth opens', !!q(w, '#cast'));
check('online status shown', t(w, '#status').startsWith('Online'), t(w, '#status'));

// 2. Cast two votes while offline.
state.offline = true;
for (const picks of [[0, 1], [2]]) {
  const cards = qa(w, '.choice-card');
  picks.forEach((i) => cards[i].click());
  q(w, '#cast').click();
  await sleep(300);
  q(w, '.thanks')?.click();
  await sleep(300);
}
await sleep(500);
check('offline status in the voting page', t(w, '#status').startsWith('Offline') && t(w, '#status').includes('2 votes'), t(w, '#status'));

// 3. Finish with the password. The summary warns that the votes are unsent.
q(w, '#finish').click();
q(w, '#finish-pass').value = 'secret';
submit(w, '#finish-form');
await sleep(500);
check('summary shown', t(w, '.card h2') === 'Our booth result');
check('unsent warning', t(w, '#sendstate').includes('saved on this device only'), t(w, '#sendstate'));
check('warning style', q(w, '#sendstate').className.includes('warn'));
check('overall result waits while open', t(w, '#overall').includes('after voting closes'), t(w, '#overall'));

// 4. Delete is refused while votes wait.
q(w, '#forget').click();
q(w, '#forget-pass').value = 'secret';
submit(w, '#forget-form');
check('delete refused with unsent votes', t(w, '#forget-error').includes('not reached the voting centre'), t(w, '#forget-error'));

// 5. Back online. The votes send.
state.offline = false;
w.dispatchEvent(new w.Event('online'));
await sleep(1200);
check('all-sent message', t(w, '#sendstate').startsWith('✓ All 2 votes'), t(w, '#sendstate'));
check('ok style', q(w, '#sendstate').className.includes('ok'));
check('top status online', t(w, '#status').startsWith('Online'), t(w, '#status'));
check('server received 2 ballots', (await get(`/api/polls/${id}/admin`, adminKey)).total === 2);

// 6. A second booth uses a show of hands.
const wh = openPage(url);
await sleep(700);
check('poll shown before voting', !q(wh, '#booth-form') && !!q(wh, '#open-voting'));
q(wh, '#open-voting').click();
q(wh, '#booth-name').value = 'Class 3';
q(wh, '#booth-pass').value = 'secret';
q(wh, 'input[name=mode][value=hands]').checked = true;
submit(wh, '#booth-form');
await sleep(900);
check('hands booth shows the entry page', !!q(wh, '#send-hands') && !q(wh, '#cast'));
check('hands booth status line has the hand emoji', t(wh, '.status-line').startsWith('✋'), t(wh, '.status-line'));
const setHand = (win, index, value) => {
  const input = win.document.querySelectorAll('[data-hand]')[index];
  input.value = String(value);
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
};
setHand(wh, 0, 6);
setHand(wh, 1, 4);
q(wh, '.step[data-step="1"][data-id="3"]').click();
q(wh, '.step[data-step="1"][data-id="3"]').click();
await sleep(1200);
check('total is 12', t(wh, '#hand-total') === '12', t(wh, '#hand-total'));
check('send button enabled', !q(wh, '#send-hands').disabled);
q(wh, '#send-hands').click();
await sleep(1500);
check('hands summary shown', t(wh, '.card h2') === 'Our booth result' && t(wh, '.card').includes('12 voters counted by show of hands'), t(wh, '.card').slice(0, 90));
check('hands totals reached the server', t(wh, '#sendstate').startsWith('✓ All 12 votes'), t(wh, '#sendstate'));
q(wh, '#change-hands').click();
setHand(wh, 0, 7);
q(wh, '#send-hands').click();
await sleep(1500);
const afterChange = await get(`/api/polls/${id}/admin`, adminKey);
const entry = afterChange.manual.find((m) => m.booth === 'Class 3');
check('server holds the corrected totals', entry && entry.counts['1'] === 7 && entry.source === 'booth', JSON.stringify(entry));
const row = afterChange.booths.find((b) => b.mode === 'hands');
check('admin sees a hands booth with 13 received', row && row.received === 13 && row.cast === 13);
check('nothing is pending', afterChange.pending === 0, String(afterChange.pending));
await post(`/api/polls/${id}/mode`, { handsMode: 'estimate' }, adminKey);

// 7. Close, finalise and share. The booth picks up each state.
await post(`/api/polls/${id}/close`, {}, adminKey);
w.dispatchEvent(new w.Event('online'));
await sleep(1000);
check('closed message', t(w, '#overall').includes('waiting for every booth'), t(w, '#overall'));
const wc = openPage(url);
await sleep(900);
check('closed poll page has no open voting button', !q(wc, '#open-voting') && t(wc, '.card').includes('Voting has closed'), t(wc, '.card').slice(0, 80));
await post(`/api/polls/${id}/finalize`, {}, adminKey);
w.dispatchEvent(new w.Event('online'));
await sleep(1000);
check('not-shared message', t(w, '#overall').includes('not shared'), t(w, '#overall'));
await post(`/api/polls/${id}/share`, { public: true }, adminKey);
w.dispatchEvent(new w.Event('online'));
await sleep(1000);
check('overall result shown', t(w, '#overall').includes('Final order'), t(w, '#overall').slice(0, 60));
check('estimate note shown', t(w, '#overall').includes('Estimate: the later choices of 13 show-of-hands voters'), t(w, '#overall').slice(0, 200));
check('groups listed with emoji', t(w, '#overall').includes('✋ 13 by show of hands') && t(w, '#overall').includes('🗳️ 2 ranked ballots'));

// 8. Re-open the closed booth on the same device.
const saved = storageOf(w);
const w2 = openPage(url, saved);
await sleep(1500);
check('re-open goes to the summary', t(w2, '.card h2') === 'Our booth result');
check('re-open shows the booth result', t(w2, '.card').includes('2 votes cast at this booth'));
check('re-open shows the overall result', t(w2, '#overall').includes('Final order'));

// 9. A booth that an older version saved has no booth id. It must repair itself.
const old = { ...saved };
const session = JSON.parse(old[`qv:${id}:session`]);
delete session.boothId;
delete session.startAt;
delete session.endAt;
old[`qv:${id}:session`] = JSON.stringify(session);
const w4 = openPage(url, old);
await sleep(1800);
check('an older saved session still shows the overall result', t(w4, '#overall').includes('Final order'), t(w4, '#overall').slice(0, 80));

// 10. A new device opens the link after the poll is final. It sees the poll and the overall result.
const w3 = openPage(url);
await sleep(1500);
check('final poll page has no open voting button', !q(w3, '#open-voting') && !q(w3, '#booth-form'));
check('new device sees the overall result', t(w3, '#poll-result').includes('Final order'), t(w3, '#poll-result').slice(0, 80));

// 11. Delete the booth. The password is required.
q(w, '#forget').click();
q(w, '#forget-pass').value = 'wrong';
submit(w, '#forget-form');
check('wrong password refused', t(w, '#forget-error') === 'Wrong booth password.');
q(w, '#forget-pass').value = 'secret';
submit(w, '#forget-form');
check('booth deleted from the device', w.localStorage.getItem(`qv:${id}:session`) === null && w.location.hash === '#/');

h.finish();
