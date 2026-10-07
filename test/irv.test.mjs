import test from 'node:test';
import assert from 'node:assert/strict';
import { tally } from '../js/irv.js';

test('majority in round 1 wins at once', () => {
  const r = tally([1, 2, 3], [[1], [1, 2], [1, 3], [2], [3]]);
  assert.deepEqual(r.winners, [1]);
  assert.equal(r.rounds.length, 1);
});

test('transfers decide the winner', () => {
  const ballots = [
    ...Array(4).fill([1, 3]),
    ...Array(3).fill([2, 3]),
    ...Array(2).fill([3, 2]),
  ];
  const r = tally([1, 2, 3], ballots);
  assert.equal(r.rounds[0].eliminated, 3);
  assert.deepEqual(r.winners, [2]);
  assert.deepEqual(r.order, [2, 1, 3]);
});

test('exhausted ballots leave the count', () => {
  const r = tally([1, 2, 3], [[1], [1], [2], [3], [3]]);
  assert.equal(r.rounds[0].eliminated, 2);
  assert.equal(r.rounds[1].exhausted, 1);
});

test('tie break uses an earlier round', () => {
  const ballots = [[1], [1], [1], [2], [2], [3, 2], [4, 3], [4, 3]];
  const r = tally([1, 2, 3, 4], ballots);
  assert.equal(r.rounds[0].eliminated, 3);
});

test('a full tie gives joint winners', () => {
  const r = tally([1, 2], [[1], [2]]);
  assert.deepEqual(r.winners, [1, 2]);
});

test('no ballots gives no winner', () => {
  const r = tally([1, 2], []);
  assert.deepEqual(r.winners, []);
});

import { collect, manualBallots } from '../js/irv.js';

test('manual counts become one-choice ballots', () => {
  assert.deepEqual(manualBallots({ 1: 2, 3: 1 }), [[1], [1], [3]]);
});

test('ballot mode pools every ballot and manual count', () => {
  const r = collect([1, 2], [{ booth: 'A', ranking: [1] }], [{ booth: 'B', counts: { 2: 2 } }], 'ballot');
  assert.equal(r.length, 3);
});

test('site mode gives each group one vote', () => {
  const ballots = [
    ...Array(10).fill({ booth: 'Big', ranking: [1, 2] }),
    { booth: 'small one', ranking: [2] },
    { booth: 'Small Two ', ranking: [2] },
  ];
  const manual = [{ booth: 'small two', counts: { 2: 3 } }];
  const rankings = collect([1, 2], ballots, manual, 'site');
  assert.equal(rankings.length, 3);
  assert.deepEqual(tally([1, 2], rankings).winners, [2]);
  assert.deepEqual(tally([1, 2], collect([1, 2], ballots, manual, 'ballot')).winners, [1]);
});

import { estimateBallots } from '../js/irv.js';

test('weighted ballots count as parts of a vote', () => {
  const r = tally([1, 2], [{ ranking: [1], weight: 0.5 }, { ranking: [2], weight: 0.25 }]);
  assert.deepEqual(r.winners, [1]);
  assert.equal(r.ballotCount, 0.75);
});

test('estimate copies later choices from ranked ballots with the same first choice', () => {
  // 3 ranked ballots start with 1: two go to 2 next, one goes to 3 next.
  const ranked = [[1, 2], [1, 2], [1, 3], [2]];
  const parts = estimateBallots([1, 2, 3], ranked, { 1: 6 });
  const total = parts.reduce((s, p) => s + p.weight, 0);
  assert.equal(Math.round(total * 1e6) / 1e6, 6);
  const toTwo = parts.find((p) => p.ranking.join() === '1,2').weight;
  const toThree = parts.find((p) => p.ranking.join() === '1,3').weight;
  assert.equal(Math.round(toTwo * 1e6) / 1e6, 4);
  assert.equal(Math.round(toThree * 1e6) / 1e6, 2);
});

test('estimate keeps one-choice ballots when no ranked ballot starts with that choice', () => {
  const parts = estimateBallots([1, 2], [[2]], { 1: 3 });
  assert.deepEqual(parts, [{ ranking: [1], weight: 3 }]);
});

test('estimate lets a show of hands transfer votes', () => {
  // 6 hands for A, 4 for B, 2 for C. Ranked ballots: C voters prefer B next. A voters split.
  const ids = [1, 2, 3];
  const ballots = [
    { booth: 'R', ranking: [1, 3] }, { booth: 'R', ranking: [1, 3] },
    { booth: 'R', ranking: [2, 3] }, { booth: 'R', ranking: [3, 2] }, { booth: 'R', ranking: [3, 2] },
  ];
  const manual = [{ booth: 'H', counts: { 1: 6, 2: 4, 3: 2 } }];
  const first = tally(ids, collect(ids, ballots, manual, 'ballot', 'first'));
  const est = tally(ids, collect(ids, ballots, manual, 'ballot', 'estimate'));
  assert.equal(first.ballotCount, 17);
  assert.equal(Math.round(est.ballotCount * 1e6) / 1e6, 17);
  // In the estimate, hands for the eliminated choice move on. Fewer votes are lost.
  assert.ok(est.rounds[1].exhausted < first.rounds[1].exhausted);
});
