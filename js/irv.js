// Instant-runoff count. Shared by the admin page, the results page, the booth page and the tests.
//
// choiceIds: array of choice ids, in poll order.
// rankings:  array of ballots. A ballot is an array of choice ids, best first.
//            A ballot can also be { ranking, weight }. A weight below 1 is a part of a vote.
//
// Tie rule: when several choices share the lowest count, the choice with the
// lowest count in the most recent earlier round is eliminated. If all earlier
// rounds are equal, the choice that is last in poll order is eliminated.

const EPSILON = 1e-9;
const near = (a, b) => Math.abs(a - b) < EPSILON;

export function tally(choiceIds, rankings) {
  const ballots = rankings
    .map((r) => (Array.isArray(r) ? { ranking: r, weight: 1 } : r))
    .map((b) => ({ ranking: b.ranking.filter((id) => choiceIds.includes(id)), weight: b.weight }))
    .filter((b) => b.ranking.length > 0 && b.weight > 0);
  const totalWeight = ballots.reduce((sum, b) => sum + b.weight, 0);
  const remaining = [...choiceIds];
  const rounds = [];
  const eliminatedOrder = [];
  let winners = [];

  while (remaining.length > 0) {
    const counts = Object.fromEntries(remaining.map((id) => [id, 0]));
    let exhausted = 0;
    for (const ballot of ballots) {
      const pick = ballot.ranking.find((id) => remaining.includes(id));
      if (pick === undefined) exhausted += ballot.weight;
      else counts[pick] += ballot.weight;
    }
    const active = totalWeight - exhausted;
    const round = { counts, active, exhausted, eliminated: null };
    rounds.push(round);

    if (active < EPSILON) break;
    const top = Math.max(...remaining.map((id) => counts[id]));
    if (top * 2 > active + EPSILON || remaining.length === 1) {
      winners = remaining.filter((id) => near(counts[id], top));
      break;
    }
    const low = Math.min(...remaining.map((id) => counts[id]));
    let candidates = remaining.filter((id) => near(counts[id], low));
    if (candidates.length === remaining.length) {
      winners = [...remaining];
      break;
    }
    for (let i = rounds.length - 2; i >= 0 && candidates.length > 1; i -= 1) {
      const earlier = Math.min(...candidates.map((id) => rounds[i].counts[id]));
      candidates = candidates.filter((id) => near(rounds[i].counts[id], earlier));
    }
    const out = candidates[candidates.length - 1];
    round.eliminated = out;
    eliminatedOrder.push(out);
    remaining.splice(remaining.indexOf(out), 1);
  }

  const last = rounds[rounds.length - 1];
  const runnersUp = remaining
    .filter((id) => !winners.includes(id))
    .sort((a, b) => last.counts[b] - last.counts[a]);
  const finishing = [...winners, ...runnersUp, ...[...eliminatedOrder].reverse()];
  const unplaced = choiceIds.filter((id) => !finishing.includes(id));
  return { rounds, winners, order: [...finishing, ...unplaced], ballotCount: totalWeight };
}

const MAX_MANUAL = 5000;
const clampCount = (n) => Math.min(Math.max(parseInt(n, 10) || 0, 0), MAX_MANUAL);

// A show of hands gives a first choice only. Each hand becomes a one-choice ballot.
export function manualBallots(counts) {
  const out = [];
  for (const [choiceId, n] of Object.entries(counts || {})) {
    for (let i = 0; i < clampCount(n); i += 1) out.push([Number(choiceId)]);
  }
  return out;
}

// Estimate the later choices of a show of hands.
// Take the ranked ballots that have the same first choice. Copy how they rank the later choices.
// Each pattern gets a part of the hands in the same proportion as it has among those ranked ballots.
// With no ranked ballot for a first choice, the hands stay one-choice ballots.
export function estimateBallots(choiceIds, ranked, counts) {
  const byFirst = new Map();
  for (const r of ranked) {
    const ranking = r.filter((id) => choiceIds.includes(id));
    if (ranking.length === 0) continue;
    if (!byFirst.has(ranking[0])) byFirst.set(ranking[0], new Map());
    const patterns = byFirst.get(ranking[0]);
    const key = ranking.join(',');
    if (!patterns.has(key)) patterns.set(key, { ranking, n: 0 });
    patterns.get(key).n += 1;
  }
  const out = [];
  for (const [choiceId, raw] of Object.entries(counts || {})) {
    const id = Number(choiceId);
    const hands = clampCount(raw);
    if (hands === 0) continue;
    const patterns = byFirst.get(id);
    if (!patterns) {
      out.push({ ranking: [id], weight: hands });
      continue;
    }
    const total = [...patterns.values()].reduce((sum, p) => sum + p.n, 0);
    for (const p of patterns.values()) out.push({ ranking: p.ranking, weight: (hands * p.n) / total });
  }
  return out;
}

// Build the list of ballots for the overall count.
// ballots: [{ booth, ranking }]. manual: [{ booth, counts }].
// mode 'ballot': every ballot is one vote.
// mode 'site':   each group is one vote. The vote is the full order from that group's own count.
//                A tie inside a group is settled by poll order.
// handsMode 'first':    a show of hands counts as first choices only (mode 'ballot').
// handsMode 'estimate': the later choices of a show of hands are estimated from the ranked ballots (mode 'ballot').
// Groups with the same name (ignoring case and spaces at the ends) are one group.
export function collect(choiceIds, ballots, manual, mode, handsMode = 'first') {
  const sites = new Map();
  const site = (name) => {
    const key = String(name).trim().toLowerCase();
    if (!sites.has(key)) sites.set(key, []);
    return sites.get(key);
  };
  for (const b of ballots) site(b.booth).push(b.ranking);
  for (const m of manual) site(m.booth).push(...manualBallots(m.counts));

  if (mode === 'site') {
    return [...sites.values()]
      .filter((rankings) => rankings.length > 0)
      .map((rankings) => tally(choiceIds, rankings).order);
  }
  if (handsMode === 'estimate') {
    const ranked = ballots.map((b) => b.ranking);
    return [...ranked, ...manual.flatMap((m) => estimateBallots(choiceIds, ranked, m.counts))];
  }
  return [...sites.values()].flat();
}
