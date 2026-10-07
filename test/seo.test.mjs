// Guards the search-engine and social-preview tags, and the files that go with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['index.html', 'ranked-choice-voting.html'];
const meta = (doc, selector) => doc.querySelector(selector)?.getAttribute('content') || '';

for (const page of pages) {
  const doc = new JSDOM(read(page)).window.document;

  test(`${page}: title, description and language`, () => {
    assert.equal(doc.documentElement.lang, 'en');
    const title = doc.title;
    assert.ok(title.length >= 20 && title.length <= 65, `title length ${title.length}`);
    const description = meta(doc, 'meta[name=description]');
    assert.ok(description.length >= 70 && description.length <= 160, `description length ${description.length}`);
    assert.ok(doc.querySelector('meta[name=viewport]'));
  });

  test(`${page}: canonical and social tags agree`, () => {
    const canonical = doc.querySelector('link[rel=canonical]').getAttribute('href');
    assert.match(canonical, /^https:\/\//);
    assert.equal(meta(doc, 'meta[property="og:url"]'), canonical);
    assert.equal(meta(doc, 'meta[property="og:title"]'), doc.title);
    assert.ok(meta(doc, 'meta[property="og:description"]').length > 40);
    assert.equal(doc.querySelector('meta[name^="twitter:"]'), null, 'no Twitter tags');
    const image = meta(doc, 'meta[property="og:image"]');
    assert.match(image, /^https:\/\//);
    assert.ok(fs.existsSync(path.join(root, new URL(image).pathname.split('/').slice(2).join('/'))), `missing ${image}`);
  });

  test(`${page}: one h1, and local links point to real files`, () => {
    assert.equal(doc.querySelectorAll('h1').length, 1);
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^(https?:|#|mailto:)/.test(href) || href === './') continue;
      assert.ok(fs.existsSync(path.join(root, href.split('#')[0])), `broken link ${href}`);
    }
    for (const link of doc.querySelectorAll('link[href]')) {
      const href = link.getAttribute('href');
      if (/^https?:/.test(href)) continue;
      assert.ok(fs.existsSync(path.join(root, href)), `missing ${href}`);
    }
  });
}

test('index.html: the structured data is valid JSON', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  assert.equal(data['@type'], 'WebApplication');
  assert.equal(data.url, doc.querySelector('link[rel=canonical]').getAttribute('href'));
  assert.equal(data.isAccessibleForFree, true);
});

test('index.html: real page text is in the HTML, not only made by the script', () => {
  const doc = new JSDOM(read('index.html')).window.document;
  assert.match(doc.querySelector('#app h1').textContent, /ranked-choice voting/i);
  assert.ok(doc.querySelector('#about').textContent.length > 1500);
  assert.ok(doc.querySelectorAll('#about details').length >= 4);
});

test('sitemap.xml and robots.txt list the pages and use one site address', () => {
  const canonicals = pages.map((p) => new JSDOM(read(p)).window.document.querySelector('link[rel=canonical]').getAttribute('href'));
  const sitemap = read('sitemap.xml');
  for (const url of canonicals) assert.ok(sitemap.includes(`<loc>${url}</loc>`), `sitemap lacks ${url}`);
  const base = canonicals[0];
  assert.ok(read('robots.txt').includes(`Sitemap: ${base}sitemap.xml`));
  assert.ok(read('robots.txt').includes('Allow: /'));
});

test('the favicon and the social image exist', () => {
  assert.ok(fs.existsSync(path.join(root, 'favicon.svg')));
  const png = fs.readFileSync(path.join(root, 'assets/og-image.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
