// Shared helpers for the browser-flow tests. They run the real page code in jsdom.
// jsdom has no layout engine. These tests check behaviour, not how the page looks.
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const API = process.env.QUICK_VOTE_TEST_API || 'http://localhost:8788';
export const CODE = process.env.QUICK_VOTE_TEST_CODE || 'abc123';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const irv = fs.readFileSync(path.join(ROOT, 'js/irv.js'), 'utf8').replace(/^export /gm, '');
const appJs = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8').replace(/^import .*$/m, '');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');

// configApi: the address that config.js would hold. Use '' to test a site with no default address.
export function createHarness({ configApi = API } = {}) {
  const errors = [];
  const fetched = [];
  const state = { offline: false, failures: 0, passes: 0 };

  function openPage(url, storage = {}) {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => errors.push(String(e.detail || e.message)));
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', virtualConsole, pretendToBeVisual: true });
    const w = dom.window;
    for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
    w.QUICK_VOTE_API = configApi;
    w.fetch = (target, options) => {
      fetched.push(String(target));
      return state.offline ? Promise.reject(new TypeError('offline')) : fetch(target, options);
    };
    w.confirm = () => true;
    w.alert = (message) => errors.push(`alert: ${message}`);
    w.addEventListener('error', (e) => errors.push(`window error: ${e.message}`));
    w.addEventListener('unhandledrejection', (e) => errors.push(`rejection: ${e.reason}`));
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = () => {};
    w.eval(`${irv}\n${appJs}`);
    return w;
  }

  const q = (w, selector) => w.document.querySelector(selector);
  const qa = (w, selector) => [...w.document.querySelectorAll(selector)];
  const t = (w, selector) => (q(w, selector)?.textContent || '(missing)').replace(/\s+/g, ' ').trim();
  const submit = (w, selector) => q(w, selector).dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
  const storageOf = (w) => {
    const out = {};
    for (let i = 0; i < w.localStorage.length; i += 1) {
      const key = w.localStorage.key(i);
      out[key] = w.localStorage.getItem(key);
    }
    return out;
  };
  const check = (label, ok, extra = '') => {
    if (ok) state.passes += 1;
    else state.failures += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  [${extra}]` : ''}`);
  };
  const post = (apiPath, body, key) => fetch(`${API}${apiPath}`, {
    method: 'POST',
    headers: key ? { authorization: `Bearer ${key}` } : {},
    body: JSON.stringify(body || {}),
  }).then((r) => r.json());
  const get = (apiPath, key) => fetch(`${API}${apiPath}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());

  // Print the summary and set the exit code. Any failed check or page error fails the suite.
  function finish() {
    console.log(`${state.passes} passed, ${state.failures} failed, ${errors.length} page errors`);
    if (errors.length) console.log('ERRORS:', errors);
    process.exit(state.failures || errors.length ? 1 : 0);
  }

  return { openPage, q, qa, t, submit, storageOf, check, post, get, finish, errors, fetched, state };
}
