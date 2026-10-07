// Changes the site address that the search-engine files use. Run it once after you fork the project.
//   node scripts/set-site-url.mjs https://your-name.github.io/quick-vote [https://github.com/your-name/quick-vote]
// It rewrites index.html, ranked-choice-voting.html, sitemap.xml and robots.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [siteArg, repoArg] = process.argv.slice(2);
if (!siteArg || !/^https:\/\//.test(siteArg)) {
  console.error('Usage: node scripts/set-site-url.mjs https://your-name.github.io/quick-vote [https://github.com/your-name/quick-vote]');
  process.exit(1);
}
const strip = (url) => url.replace(/\/+$/, '');
const files = ['index.html', 'ranked-choice-voting.html', 'sitemap.xml', 'robots.txt'].map((f) => path.join(root, f));

// The current address is the canonical link in index.html.
const index = fs.readFileSync(files[0], 'utf8');
const oldSite = strip(index.match(/<link rel="canonical" href="([^"]+)"/)[1]);
const oldRepo = strip((index.match(/"codeRepository": "([^"]+)"/) || [])[1] || '');

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.split(oldSite).join(strip(siteArg));
  if (repoArg && oldRepo) text = text.split(oldRepo).join(strip(repoArg));
  fs.writeFileSync(file, text);
}
console.log(`Site address: ${oldSite} -> ${strip(siteArg)}`);
if (repoArg) console.log(`Repository:   ${oldRepo} -> ${strip(repoArg)}`);
