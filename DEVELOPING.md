# Developing Quick Vote

Thank you for your interest. This guide explains how the code works, how to run it, and how to send a change. For a user guide, read [README.md](README.md). For a Cloudflare setup, read [INSTALLING.md](INSTALLING.md).

## Principles

- **No build step, no browser dependencies.** The site is plain HTML, CSS and JavaScript (ES modules). A person can read the source in the browser and host the files anywhere.
- **Few moving parts.** One Worker, one database, one JavaScript file for the pages.
- **Voters and booth hosts may be children and non-experts.** Screens use short, plain sentences. Buttons say what they do. A screen must say clearly when something has not been saved or sent.
- **Privacy by default.** Store only what the count needs.
- **Fail visibly.** An error shows a message. It does not leave a blank page.

## Layout

```
index.html          the page shell, the search-engine tags and the about text
ranked-choice-voting.html  a static guide page (for search engines and teachers)
styles.css          all styles
config.js           an optional default voting-centre address (empty by default)
sw.js               a service worker: keeps a copy of the site for offline use (network first)
favicon.svg, assets/og-image.*  the icon and the social preview image
robots.txt, sitemap.xml  for search engines
scripts/            set-site-url.mjs (change the site address), make-og-image.mjs
js/irv.js           the counting code (pure functions; also used by the tests)
js/app.js           the pages: routing, forms, booth, admin, results, single-booth poll
worker/src/index.js the Cloudflare Worker (the API)
server/             a Node server that runs the same API code with SQLite (used by the Docker image)
Dockerfile, compose.yaml  the container build (see DOCKER.md)
worker/schema.sql   the D1 database schema
worker/wrangler.toml the Worker configuration
test/irv.test.mjs   unit tests for the count
test/browser/       browser-flow tests (jsdom) and a runner
```

## Run it on your computer

You need Node.js 22 or newer.

```sh
npm install
npm run db:local       # first time only: makes the local database
npm run dev:worker     # terminal 1: Worker on http://localhost:8787
npm run dev:site       # terminal 2: site on http://localhost:8000
```

Open `http://localhost:8000`. `config.js` is empty, so click **Make a multi-booth poll** and connect to `http://localhost:8787` on the Connect page. Leave the organiser code empty, unless your local Worker has one. The site remembers the address in that browser.

Notes:
- `wrangler.toml` may allow only your real site (`ALLOWED_ORIGIN`). For local runs, make `worker/.dev.vars` with `ALLOWED_ORIGIN=*`. Wrangler uses it for `wrangler dev` only. Git ignores it.
- The local database is in `worker/.wrangler/`. To reset it: `rm -rf worker/.wrangler && npm run db:local`.
- `npm run dev:worker` listens on all network interfaces, so that a phone on your Wi-Fi can reach it. To test on a phone, open `http://<your-computer-ip>:8000` on the phone, and connect to `http://<your-computer-ip>:8787` on the Connect page.
- The site registers a service worker. It tries the network first, so a changed file is never hidden. If a page looks stale, do a hard refresh (Ctrl+Shift+R).
- `worker/.env` (see `worker/.env.example`) holds your Cloudflare token and organiser code. Never commit it.

## Tests

```sh
npm test               # unit tests for the count and the search-engine tags (fast)
npm run test:browser   # browser-flow tests: starts a local Worker and a temporary database
npm run test:browser:node  # the same tests against the Node server that the Docker image uses
npm run test:all       # all of them
```

**Unit tests** (`test/irv.test.mjs`) cover the instant-runoff count, ties, parts of a vote, show-of-hands estimates and the "every group is one vote" method.

**Search-engine tests** (`test/seo.test.mjs`) check the title and description lengths, the canonical and social tags, the structured data, that links point to real files, and that `sitemap.xml` and `robots.txt` use the same site address.

**Browser-flow tests** (`test/browser/`) run the real page code in [jsdom](https://github.com/jsdom/jsdom) against a real local Worker. The runner (`run-all.mjs`) makes a temporary database, starts `wrangler dev` on port 8788 with the organiser code `abc123`, runs each suite, and stops the Worker. You can change the port with `QUICK_VOTE_TEST_PORT`.

| Suite | What it checks |
|---|---|
| `multi-booth.mjs` | A whole poll: ranked and show-of-hands booths, offline votes, close, finalise, share, late ballots, re-opening a booth, an older saved session, a new device, delete |
| `single-booth.mjs` | A single-booth poll with no network at all |
| `connect.mjs` | The Connect page, the organiser code, links that carry the address, the saved-polls list, and the warning for unknown addresses |

Limits: jsdom has no layout engine, so these tests do not check how a page *looks* or whether a screen fits on a phone. They also do not run a real browser. Tests in a real browser (for example with Playwright) would be a useful contribution. The runner needs Linux, macOS or WSL (it uses `pgrep`).

If a test run leaves a Worker behind ("Address already in use"), find it with `ss -ltnp | grep 8788` and stop that process.

## How it works

### Pages and routing

`js/app.js` is one file. The address after `#` selects the page:

| Route | Page |
|---|---|
| `#/` | Home: the two ways to start, saved polls, "Open a booth" |
| `#/connect` | Connect to a voting centre |
| `#/new` | Make a multi-booth poll |
| `#/local/new`, `#/local/<id>` | Make and run a single-booth poll |
| `#/p/<id>` | A booth |
| `#/admin/<id>/<key>` | The admin page |
| `#/results/<id>` | The public results |

A link can end with `?api=<voting-centre address>`. `selectApi()` checks that the address is valid, uses it, and saves it for that poll.

**`route()` and the start call must stay at the end of `app.js`.** The pages use `const` values that the file sets up in order. A start call that runs earlier fails on a page that is opened directly from a link.

### Browser storage

| Key | Content |
|---|---|
| `qv:settings` | The voting-centre address and the organiser code for this browser |
| `qv:mypolls` | Multi-booth polls that this browser made, with their admin keys |
| `qv:<pollId>:api` | The voting-centre address for that poll |
| `qv:<pollId>:session` | The booth session: password, group name, booth ID, mode, window |
| `qv:<pollId>:queue` | Ballots that have not reached the server |
| `qv:<pollId>:stats` | How many ballots the booth cast, sent and lost as late |
| `qv:<pollId>:local` | The booth's own ballots, for its own result |
| `qv:local:poll:<id>` | A whole single-booth poll |

Storage can be blocked. `store()` ignores errors, and the pages still work for the open page.

### The API

All calls are JSON. A booth sends its password in the `x-booth-password` header. An admin sends the key as `authorization: Bearer <key>`.

| Call | Who | What |
|---|---|---|
| `GET /api/ping` | anyone | Says whether an organiser code is required |
| `POST /api/check-code` | anyone | Tests an organiser code |
| `POST /api/polls` | organiser code | Makes a poll. Returns the ID and the admin key |
| `GET /api/polls/:id` | anyone | Title and state only |
| `POST /api/polls/:id/booth` | booth password | Returns the poll, its choices and the server time |
| `POST /api/polls/:id/ballots` | booth password | Sends ballots and the booth report. Returns which were accepted and which were late |
| `GET /api/polls/:id/admin` | admin key | Booths, counts, manual counts. Ballots only after voting closes |
| `POST /api/polls/:id/close` | admin key | Stops new votes. Late ballots cast before this time still count |
| `POST /api/polls/:id/finalize` | admin key | Refuses all later ballots |
| `POST /api/polls/:id/manual` | admin key | Adds, changes or removes a hand count for a group |
| `POST /api/polls/:id/mode` | admin key | Sets the count method and the show-of-hands method |
| `POST /api/polls/:id/share` | admin key | Turns the public results on or off (after finalise) |
| `GET /api/polls/:id/results` | anyone, if shared | Choices, ballots and manual counts of a final poll |

### Two backends, one API

The API code in `worker/src/index.js` runs in two places: on Cloudflare Workers with D1, and on Node with SQLite (`server/index.mjs`). `server/d1-sqlite.mjs` is a small stand-in for the D1 calls that the code uses (`prepare`, `bind`, `first`, `all`, `run`, `batch`). If you use another D1 feature in the Worker, add it to the stand-in too, and run both browser-test commands. Both backends must pass every suite.

### Data

`worker/schema.sql` has six tables: `polls`, `choices`, `ballots`, `booth_reports`, `hand_counts` and `manual_counts`. A poll is `open`, then `closed` (no new votes; late ballots still count), then `final`.

A ballot has the ranking, the group name, a random booth ID and a client ID. The client ID makes a re-sent ballot harmless (`INSERT OR IGNORE` on a unique key). **The server never stores the cast time.**

### Offline voting and late ballots

- A booth keeps every ballot in `localStorage` first, then sends it. It sends again every 20 seconds and when the browser goes online.
- At login the booth learns the server time and keeps the difference from its own clock. Each ballot gets a cast time on the server's clock.
- After a close, the server accepts a ballot only if its cast time is not later than the close time. The server uses the time once and does not store it.
- Each booth reports how many ballots it cast. The admin page compares this with the ballots received. That is how the organiser knows whether a booth still has votes to send.
- A booth report carries the booth mode (`ranked` or `hands`). A show-of-hands booth sends its totals in the same report. A newer send replaces an older one.

### The count (`js/irv.js`)

`tally(choiceIds, rankings)` runs instant runoff. A ballot can be a list of choice IDs, or `{ ranking, weight }`. A weight below 1 is a part of a vote.

- Each round counts the first remaining choice on every ballot. A choice with more than half of the counted votes wins.
- Otherwise the choice with the fewest votes is out.
- **Tie rule:** several choices at the lowest count are compared in the most recent earlier round where they differ. The one with the lowest count there is out. If all earlier rounds are equal, the choice that is last in the poll list is out. If every remaining choice has the same count, they are joint winners.

`collect()` builds the ballots for the overall count:
- *Every ballot is one vote:* all ranked ballots, plus hand counts.
- *Every group is one vote:* each group is counted first. Its full order of choices becomes its single ballot. A tie inside a group is settled by poll order.
- *Estimate later choices* (show of hands only): for each first choice, `estimateBallots()` copies how ranked ballots with that first choice rank the later choices. It splits the hands in the same proportions. With no ranked ballot for a first choice, those hands stay one-choice ballots. The result page must say that it used an estimate.

Group names are compared without regard to capital letters and spaces at the ends.

### Search engines

Search engines do not read the `#/...` addresses of the app. They read `index.html` and `ranked-choice-voting.html`. So the real page text (the intro, the explanation and the questions) is in the HTML, and not only made by JavaScript. The `about` section shows on the home view only: `route()` sets `data-view` on `<body>`, and the CSS hides the section on other views. Keep one `<h1>` on each page. When you change a title or a description, run `npm test`: it checks the lengths.

## Conventions

- Escape every piece of user text with `esc()`. Accept pictures only through `safeImg()` (data URLs that start with `data:image/`).
- Keep screens short. Use plain words. Say what happened and what the person can do.
- Do not add a build step or a browser dependency without a strong reason. Tell us in the issue first.
- Do not store anything about a voter. Do not store the cast time of a ballot.
- Server code must check every input. Return a clear error message with the right status code.
- Add or update a test for each change in behaviour. Update the docs.

## Send a change

1. Open an issue for a large change, so that we can agree on the idea first.
2. Fork the repository and make a branch.
3. Make the change. Run `npm run test:all`. All tests must pass.
4. Update `README.md`, `INSTALLING.md` or this file if the change needs it.
5. Open a pull request. Say what changed and why. Say how you tested it, and on which devices or browsers if the change affects the pages.

By sending a change, you agree that your work is under the [MIT licence](LICENSE), like the rest of the project.

Never commit `.env`, `.dev.vars`, a token or a password. To report a security problem, use GitHub's private security advisory for the repository. Do not post it in a public issue.

## Ideas for contributions

- Translations (all text is in `js/app.js` and `index.html`).
- An accessibility review: screen readers, keyboard use, colour contrast, large text.
- A test run in a real browser (Playwright), including phone-sized screens.
- A QR code for the booth link, so that a host can show it on a screen.
- Migration files for schema changes, and a note for each release.
- A "delete poll" action, and automatic deletion of old polls.
- Printable results.
- A third count method: each group has the same total weight, and ranked ballots still count.
- Other voting methods (for example Borda or Condorcet) as a comparison view.
- Per-person organiser codes.
