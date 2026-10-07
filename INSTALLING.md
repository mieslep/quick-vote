# Installing Quick Vote

This guide sets up your own Quick Vote *voting centre* on Cloudflare, and publishes the site. You need this for **multi-booth polls**. Single-booth polls need no setup: open the site and click "Make a single-booth poll".

It takes about 20 minutes. You do it once.

## What you will set up

| Part | What it does | Where it runs |
|---|---|---|
| The site | The pages that people open (HTML, CSS and JavaScript, no build step) | GitHub Pages, or any static host |
| The Worker | A small program with an API. It checks passwords and adds up the votes | Cloudflare Workers |
| The database | Stores polls and ballots | Cloudflare D1 |

The site talks to the Worker. People can use your site with a Worker that you run, and you can run your own copy of the site too.

## What you need

- A [Cloudflare](https://dash.cloudflare.com/sign-up) account. The free plan is usually enough for classes and clubs. Check the current limits on the Cloudflare pricing pages if you expect large events.
- A GitHub account, to publish the site with GitHub Pages. Any static host also works.
- Node.js **22 or newer** (the Wrangler tool needs it) and `git`, on your computer. Linux and WSL are tested. macOS should also work.

## 1. Get the code

Fork the repository on GitHub, then clone your fork. Or clone it directly.

```sh
git clone https://github.com/<your-name>/quick-vote.git
cd quick-vote
npm install
```

## 2. Sign in to Cloudflare from the command line

Wrangler is the Cloudflare command-line tool. `npm install` installs it. Pick **one** way to sign in.

### Option A: sign in with your browser (simplest)

```sh
cd worker
npx wrangler login
```

A browser window opens. Approve the request. Check it:

```sh
npx wrangler whoami
```

### Option B: an API token in a `.env` file (for scripts, CI and tools that cannot open a browser)

1. Find your **account ID**: open the Cloudflare dashboard, then Workers & Pages. The account ID is on the right-hand side.
2. Make an **Account API token**: open **Manage account → Account API tokens → Create Token**. Add these permissions, all at account level:
   - Workers Scripts: Edit
   - D1: Edit
   - Account Settings: Read
3. Limit the token to your account. Set an end date.
4. Copy the token once. Cloudflare does not show it again.
5. Make `worker/.env` from the template, and fill it in:

   ```sh
   cp worker/.env.example worker/.env
   ```

   ```
   CLOUDFLARE_ACCOUNT_ID=<your account ID>
   CLOUDFLARE_API_TOKEN=<your token>
   CREATE_CODE=<a long random string>
   ```

Git ignores `.env` files. Never commit a real token. Check it:

```sh
cd worker
npx wrangler d1 list --json
```

An empty list `[]` means the token works and you have no databases yet. (`wrangler whoami` can show little with an account token.)

## 3. Make the database

```sh
cd worker
npx wrangler d1 create quick-vote
```

The command prints a `database_id`. Open `worker/wrangler.toml` and put the ID in the `[[d1_databases]]` block. **Keep `binding = "DB"`**. The code uses that name.

```toml
[[d1_databases]]
binding = "DB"
database_name = "quick-vote"
database_id = "<the ID that Wrangler printed>"
```

Apply the schema to the remote database:

```sh
npx wrangler d1 execute quick-vote --remote --file=schema.sql
```

## 4. Choose who may call the Worker

Open `worker/wrangler.toml` and set `ALLOWED_ORIGIN` to the address of your site, with no path and no trailing slash:

```toml
[vars]
ALLOWED_ORIGIN = "https://<your-name>.github.io"
```

This stops other websites from calling your Worker from a browser. Use `"*"` only while you test.

## 5. Set the organiser code

The organiser code stops strangers from making polls on your Worker. It is a Worker *secret*. Choose a long random string, for example the output of:

```sh
openssl rand -base64 24
```

Save it in your password manager. Then set it:

```sh
cd worker
npx wrangler secret put CREATE_CODE
```

Wrangler asks for the value. Paste it. (With Option B, you can pipe the value from the `.env` file: `grep '^CREATE_CODE=' .env | cut -d= -f2- | npx wrangler secret put CREATE_CODE`.)

A Worker with no `CREATE_CODE` lets anyone who finds its address make polls.

## 6. Deploy the Worker

```sh
npx wrangler deploy
```

The first time, Cloudflare may ask you to register a `workers.dev` name for your account. Accept it. Wrangler prints the Worker address, for example `https://quick-vote.<your-name>.workers.dev`. Copy it.

A new secret can take about 10 seconds to apply. Test the Worker:

```sh
curl https://quick-vote.<your-name>.workers.dev/api/ping
```

You should see `{"ok":true,"createCodeRequired":true}`.

## 7. Publish the site

### GitHub Pages

1. Push your clone to GitHub.
2. Open the repository on GitHub. Go to **Settings → Pages**.
3. Set the source to the `main` branch and the `/ (root)` folder. Save.
4. Wait for the first build. The site address is `https://<your-name>.github.io/<repository-name>/`.

If this address is different from the `ALLOWED_ORIGIN` that you set, fix `ALLOWED_ORIGIN` and run `npx wrangler deploy` again. Use the origin only, for example `https://<your-name>.github.io`.

### Another host

Any static host works. Upload these files from the repository root: `index.html`, `ranked-choice-voting.html`, `styles.css`, `config.js`, `sw.js`, `favicon.svg`, `robots.txt`, `sitemap.xml`, the `js/` folder and the `assets/` folder. The host must use `https://`, so that the offline cache works.

## 8. Connect and test

1. Open your site.
2. Click **Make a multi-booth poll**. The site asks you to connect.
3. Enter the Worker address and the organiser code. Click **Connect**. The page checks both.
4. Make a test poll with two choices. Open its booth link on your phone. Cast a vote. Open the admin page. You should see one ballot.

The site saves the Worker address and the code in your browser. The booth, admin and results links carry the Worker address, so other devices need no setup. A link with an unknown address first asks the person to confirm it.

### Optional: a default address

`config.js` is empty by default. Each visitor then connects to a voting centre on the Connect page, and the site remembers the address in that browser. You do not need to edit `config.js`.

To give visitors one voting centre with no setup, put its address in `config.js`:

```js
window.QUICK_VOTE_API = 'https://quick-vote.<your-name>.workers.dev';
```

Visitors still need the organiser code to make a poll. Booth hosts need nothing: the booth link carries the address.

## 9. Search engines (optional)

If you want people to find your site on Google or Bing:

1. **Set your site address.** The page tags, `sitemap.xml` and `robots.txt` hold the address of the original site. Change them with one command, and commit the result:

   ```sh
   node scripts/set-site-url.mjs https://<your-name>.github.io/<repository-name> https://github.com/<your-name>/<repository-name>
   ```

   The second address (your repository) is optional.
2. **Check the text.** Search engines read `index.html` and `ranked-choice-voting.html`. They do not read the `#/...` pages of the app, so only these two pages appear in search results. Edit the title, the description and the text to suit your audience.
3. **Verify the site.** In [Google Search Console](https://search.google.com/search-console) and [Bing Webmaster Tools](https://www.bing.com/webmasters), add your site. Choose the HTML tag method. Each service gives you a `<meta>` tag. Put it in the `<head>` of `index.html`, commit and push, then press "Verify".
4. **Submit the sitemap.** In each service, submit `https://<your-name>.github.io/<repository-name>/sitemap.xml`.
5. **Check the result.** Test one page with the URL Inspection tool in Search Console. A new site can take days or weeks to appear.

The social preview image is `assets/og-image.png`. To change it, edit `assets/og-image.svg` and run `node scripts/make-og-image.mjs`.

## Updating

Pull the new code, then:

```sh
npm install
cd worker
npx wrangler deploy
```

If a release changes `worker/schema.sql`, its notes say how to change an existing database. The schema uses `CREATE TABLE IF NOT EXISTS`, so running it again does no harm, but it does not change tables that already exist.

## Security checklist

- Set `CREATE_CODE` before you share the Worker address.
- Set `ALLOWED_ORIGIN` to your site.
- Give the API token an end date. Delete it when you finish. A later `wrangler deploy` then needs a new token, or `wrangler login`.
- Never commit `.env`, `.dev.vars` or a token.
- Change the organiser code if it leaks: `npx wrangler secret put CREATE_CODE`.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| The Connect page says "Cannot reach" | The address is wrong, or `ALLOWED_ORIGIN` does not match the site's origin. Check both. |
| "This voting centre needs an organiser code" | The Worker has `CREATE_CODE`. Enter it on the Connect page. |
| "The organiser code is wrong" right after `secret put` | Wait about 10 seconds and try again. |
| "That address does not look like a Quick Vote voting centre" | The address points to something else. Use the `workers.dev` address that `wrangler deploy` printed. |
| A booth shows "Cannot reach the voting centre properly" | The Worker refused a request. The text shows the reason. Votes on the device are safe. |
| `wrangler deploy` says the database ID is wrong | Check `database_id` in `worker/wrangler.toml`. |
| `Address already in use` in local tests | An old test server holds the port. See [DEVELOPING.md](DEVELOPING.md). |

## Removing everything

```sh
cd worker
npx wrangler delete                  # the Worker
npx wrangler d1 delete quick-vote    # the database and all polls
```

Turn off GitHub Pages in the repository settings.
