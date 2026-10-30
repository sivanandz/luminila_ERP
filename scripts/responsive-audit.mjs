#!/usr/bin/env node
/**
 * Responsive overflow audit.
 *
 * Drives the locally installed Chrome over the DevTools protocol (no npm
 * dependency: Node's global WebSocket is enough) and measures every reachable
 * route at phone, tablet and desktop widths. It reports three things:
 *
 *   1. page overflow   - the document scrolls horizontally (always a bug)
 *   2. viewport escapes - an element's box crosses the viewport edge
 *   3. text spills     - text paints outside its own box (no scrolling/ellipsis)
 *
 * It signs in through PocketBase with the superuser credentials from the
 * environment (or .env.local) and injects that session into localStorage before
 * each navigation. Credentials are read at run time and never printed.
 *
 * Usage:
 *   node scripts/responsive-audit.mjs [--widths=360,768,1024] [--routes=/a,/b]
 *                                     [--base=http://127.0.0.1:3000] [--json=path]
 * Exit code is 1 when any page overflows horizontally or any text spills.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'src', 'app');
const PUBLIC_ROUTES = new Set(['/', '/login', '/setup', '/checkout', '/tracking']);

function arg(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const WIDTHS = arg('widths', '360,768,1024')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const BASE = arg('base', process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const JSON_OUT = arg('json', path.join(ROOT, 'out', 'responsive-audit.json'));
const SUMMARY_OUT = arg('summary', JSON_OUT.replace(/\.json$/i, '') + '-failing.json');
const SHOTS_DIR = arg('shots', '');
const SHOTS_ALL = process.argv.includes('--shots-all');
const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const readEnvLocal = () => {
  const out = {};
  const file = path.join(ROOT, '.env.local');
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
};

function discoverRoutes() {
  const routes = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'api' || entry.name.startsWith('_')) continue;
        walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      } else if (entry.name === 'page.tsx' || entry.name === 'page.jsx') {
        if (prefix.includes('[')) continue;
        const route = prefix || '/';
        if (PUBLIC_ROUTES.has(route)) continue;
        routes.push(route);
      }
    }
  };
  if (fs.existsSync(APP_DIR)) walk(APP_DIR, '');
  return [...new Set(routes)].sort();
}

function pickChrome() {
  for (const candidate of CHROME_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (event) => reject(new Error(`CDP socket error: ${event?.message || 'unknown'}`)));
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  });

  return {
    ready,
    send(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => {
        const list = listeners.get(method) || [];
        const fn = (params) => {
          const idx = list.indexOf(fn);
          if (idx >= 0) list.splice(idx, 1);
          resolve(params);
        };
        list.push(fn);
        listeners.set(method, list);
      });
    },
    on(method, fn) {
      const list = listeners.get(method) || [];
      list.push(fn);
      listeners.set(method, list);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Runs inside the page. Returns overflow evidence for the current viewport.
 * Kept as a plain function so it can be serialised without escaping.
 */
function measureInPage() {
  const vw = window.innerWidth;
  const seen = new Set();

  const cssPath = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let name = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`${name}#${node.id}`);
        break;
      }
      const raw = node.getAttribute('class') || '';
      const cls = raw.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      if (cls) name += `.${cls}`;
      const parent = node.parentElement;
      if (parent) {
        const index = Array.prototype.indexOf.call(parent.children, node) + 1;
        name += `:nth-child(${index})`;
      }
      parts.unshift(name);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const label = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  /**
   * A deliberate horizontal scroller (a table, a chip rail) is allowed to hold
   * content wider than itself. The page's own scroll container is not: because
   * `overflow-y: auto` forces `overflow-x` to `auto` as well, a page wrapper
   * silently becomes a horizontal scroller when any child is too wide. Treat a
   * wide, tall scroller as primary and count its horizontal overflow as a bug.
   */
  const isPrimaryScroller = (node) => {
    const rect = node.getBoundingClientRect();
    return rect.width >= vw - 40 && rect.height >= window.innerHeight * 0.4;
  };

  const isInsideSecondaryScroller = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && !isPrimaryScroller(node)) {
        return true;
      }
      // Text the author explicitly set to ellipsize is clipped on purpose: an
      // inline child still reports its full layout width, which is not a leak.
      if (style.textOverflow === 'ellipsis' && (style.overflowX === 'hidden' || style.overflowX === 'clip')) {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  };

  const overflowScrollers = [];
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
    const excess = el.scrollWidth - el.clientWidth;
    if (excess <= 1) continue;
    overflowScrollers.push({
      selector: cssPath(el),
      excess,
      primary: isPrimaryScroller(el),
      text: label(el).slice(0, 40),
    });
  }

  const offenders = [];
  const textSpills = [];
  const widerThanParent = [];
  const elementCount = document.querySelectorAll('body *').length;

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const right = Math.round(rect.right - vw);
    const left = Math.round(-rect.left);
    if ((right > 1 || left > 1) && !isInsideSecondaryScroller(el)) {
      const key = `${el.tagName}:${Math.round(rect.width)}:${label(el).slice(0, 24)}`;
      if (!seen.has(key)) {
        seen.add(key);
        offenders.push({
          selector: cssPath(el),
          tag: el.tagName.toLowerCase(),
          text: label(el),
          overflowRight: right > 1 ? right : 0,
          overflowLeft: left > 1 ? left : 0,
          width: Math.round(rect.width),
        });
      }
    }

    const isTextLeaf = el.children.length === 0 && (el.textContent || '').trim().length > 0;
    if (isTextLeaf && style.overflowX === 'visible' && el.scrollWidth - el.clientWidth > 1) {
      textSpills.push({
        selector: cssPath(el),
        text: label(el),
        spill: el.scrollWidth - el.clientWidth,
      });
    }

    const parent = el.parentElement;
    if (
      parent &&
      parent !== document.body &&
      style.position !== 'absolute' &&
      style.position !== 'fixed' &&
      style.overflowX === 'visible'
    ) {
      const parentRect = parent.getBoundingClientRect();
      const excess = Math.round(rect.width - parentRect.width);
      if (excess > 4 && rect.width > 0 && parentRect.width > 0) {
        const key = `wide:${cssPath(el)}`;
        if (!seen.has(key)) {
          seen.add(key);
          widerThanParent.push({ selector: cssPath(el), text: label(el), excess });
        }
      }
    }
  }

  const trim = (list, key) =>
    list.sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, 12);

  return {
    viewport: vw,
    path: location.pathname,
    title: document.title,
    elementCount,
    heading: (document.querySelector('h1, h2')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    bodyChars: (document.body.innerText || '').length,
    pageOverflow: Math.max(0, document.documentElement.scrollWidth - vw),
    overflowScrollers: trim(overflowScrollers, 'excess'),
    offenders: trim(offenders, 'overflowRight'),
    textSpills: trim(textSpills, 'spill'),
    widerThanParent: trim(widerThanParent, 'excess'),
  };
}

async function main() {
  const chrome = pickChrome();
  if (!chrome) {
    console.error('[audit] No Chrome/Edge binary found. Set CHROME_PATH.');
    process.exit(2);
  }

  const env = readEnvLocal();
  const pbUrl = (process.env.NEXT_PUBLIC_POCKETBASE_URL || env.NEXT_PUBLIC_POCKETBASE_URL || env.PB_URL || 'http://127.0.0.1:8090').replace(/\/+$/, '');
  const email = process.env.POCKETBASE_SUPERUSER_EMAIL || env.POCKETBASE_SUPERUSER_EMAIL;
  const password = process.env.POCKETBASE_SUPERUSER_PASSWORD || env.POCKETBASE_SUPERUSER_PASSWORD;

  let session = null;
  if (email && password) {
    const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    }).catch(() => null);
    if (res && res.ok) {
      const data = await res.json();
      session = { token: data.token, record: data.record };
      // Superusers bypass collection rules, which hides the rule failures a real
      // operator hits. Prefer a session for the account the app logs in as.
      const account = (
        process.env.NEXT_PUBLIC_ACCOUNT_EMAIL ||
        process.env.ACCOUNT_EMAIL ||
        env.NEXT_PUBLIC_ACCOUNT_EMAIL ||
        env.ACCOUNT_EMAIL ||
        'niththigal@gmail.com'
      )
        .trim()
        .toLowerCase();
      try {
        const list = await fetch(
          `${pbUrl}/api/collections/users/records?perPage=1&filter=${encodeURIComponent(`email="${account}"`)}`,
          { headers: { authorization: data.token } }
        ).then((r) => r.json());
        const user = (list.items || [])[0];
        if (user) {
          const impersonated = await fetch(`${pbUrl}/api/collections/users/impersonate/${user.id}`, {
            method: 'POST',
            headers: { authorization: data.token },
          }).then((r) => (r.ok ? r.json() : null));
          if (impersonated && impersonated.token) {
            session = { token: impersonated.token, record: impersonated.record };
          }
        }
      } catch {
        /* keep the superuser session */
      }
      console.log(`[audit] signed in as ${session.record?.email || '(superuser)'}`);
    } else {
      console.warn('[audit] PocketBase sign-in failed; pages will redirect to /login.');
    }
  } else {
    console.warn('[audit] No superuser credentials in env or .env.local; pages will redirect to /login.');
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lum-audit-'));
  const port = 9333;
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };

  try {
    await waitFor(`http://127.0.0.1:${port}/json/version`, 15000);
    const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
    const cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    // The app follows the OS preference; audit the dark theme the operators use.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }],
    });

    if (session) {
      const payload = JSON.stringify(JSON.stringify(session));
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { try { localStorage.setItem('pocketbase_auth', ${payload}); } catch (e) {} })();`,
      });
    }

    const routes = arg('routes', '')
      ? arg('routes', '').split(',').map((r) => r.trim()).filter(Boolean)
      : discoverRoutes();

    let consoleErrors = [];
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      const text = (params.args || [])
        .map((a) => (typeof a.value === 'string' ? a.value : a.description || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) consoleErrors.push(text.slice(0, 300));
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails || {};
      consoleErrors.push((details.exception?.description || details.text || 'uncaught exception').slice(0, 300));
    });

    const results = [];
    for (const route of routes) {
      for (const width of WIDTHS) {
        consoleErrors = [];
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width,
          height: Math.round(width * 1.6),
          deviceScaleFactor: 1,
          mobile: width < 768,
        });

        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url: `${BASE}${route}` });
        await Promise.race([loaded, new Promise((r) => setTimeout(r, 25000))]);
        await new Promise((r) => setTimeout(r, 1400));

        const evaluated = await cdp.send('Runtime.evaluate', {
          expression: `(${measureInPage.toString()})()`,
          returnByValue: true,
          awaitPromise: false,
        });
        const value = evaluated?.result?.value || {
          viewport: width,
          path: route,
          pageOverflow: -1,
          offenders: [],
          textSpills: [],
          widerThanParent: [],
          error: evaluated?.exceptionDetails?.text || 'evaluation failed',
        };

        const redirected = value.path && value.path !== route && value.path !== `${route}/`;
        const row = {
          route,
          width,
          redirectedTo: redirected ? value.path : null,
          elementCount: value.elementCount || 0,
          heading: value.heading || '',
          bodyChars: value.bodyChars || 0,
          pageOverflow: value.pageOverflow,
          overflowScrollers: value.overflowScrollers || [],
          offenders: value.offenders || [],
          textSpills: value.textSpills || [],
          widerThanParent: value.widerThanParent || [],
          consoleErrors: consoleErrors.slice(0, 6),
          consoleErrorCount: consoleErrors.length,
        };
        row.looksEmpty = !row.redirectedTo && (row.elementCount < 20 || row.bodyChars < 40);
        row.primaryOverflow = row.overflowScrollers.filter((s) => s.primary).length > 0;
        row.failed =
          Boolean(row.redirectedTo) ||
          row.looksEmpty ||
          row.pageOverflow > 0 ||
          row.primaryOverflow ||
          row.textSpills.length > 0;
        results.push(row);

        if (SHOTS_DIR && (row.failed || SHOTS_ALL)) {
          const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          });
          const safe = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
          const file = path.join(SHOTS_DIR, `${safe}_${width}.png`);
          fs.mkdirSync(SHOTS_DIR, { recursive: true });
          fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
          row.screenshot = path.relative(ROOT, file);
        }

        const flag = row.redirectedTo
          ? 'AUTH-REDIRECT'
          : row.looksEmpty
          ? 'EMPTY PAGE'
          : row.primaryOverflow
          ? `X-SCROLL +${Math.max(...row.overflowScrollers.filter((s) => s.primary).map((s) => s.excess))}px`
          : row.pageOverflow > 0
          ? `OVERFLOW +${row.pageOverflow}px`
          : 'ok';
        console.log(
          `${flag.padEnd(16)} ${String(width).padStart(4)}px  ${route.padEnd(28)} ` +
            `els=${row.elementCount} escapes=${row.offenders.length} textSpills=${row.textSpills.length} wide=${row.widerThanParent.length} errs=${row.consoleErrorCount}  ${row.heading}`
        );
      }
    }

    cdp.close();

    const failed = results.filter((r) => r.failed);
    const report = {
      base: BASE,
      generatedAt: new Date().toISOString(),
      widths: WIDTHS,
      routes: routes.length,
      measurements: results,
      summary: {
        checks: results.length,
        redirects: results.filter((r) => r.redirectedTo).length,
        empty: results.filter((r) => r.looksEmpty).length,
        pageOverflow: results.filter((r) => r.pageOverflow > 0).length,
        primaryOverflow: results.filter((r) => r.primaryOverflow).length,
        withEscapes: results.filter((r) => r.offenders.length > 0).length,
        withTextSpills: results.filter((r) => r.textSpills.length > 0).length,
        failed: failed.length,
        widestEscape: Math.max(0, ...results.flatMap((r) => r.offenders.map((o) => o.overflowRight))),
      },
    };

    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(
      SUMMARY_OUT,
      JSON.stringify(
        {
          base: BASE,
          generatedAt: report.generatedAt,
          widths: WIDTHS,
          total: results.length,
          summary: report.summary,
          failing: failed.map((r) => ({
            route: r.route,
            width: r.width,
            failed: r.failed,
            redirectedTo: r.redirectedTo,
            looksEmpty: r.looksEmpty,
            pageOverflow: r.pageOverflow,
            primaryOverflow: r.primaryOverflow,
            scrollers: r.overflowScrollers,
            offenders: r.offenders,
            textSpills: r.textSpills,
            widerThanParent: r.widerThanParent,
            consoleErrors: r.consoleErrors,
            consoleErrorCount: r.consoleErrorCount,
            screenshot: r.screenshot || null,
            heading: r.heading,
          })),
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(
      `\n[audit] ${results.length} measurements, ${report.summary.pageOverflow} with page overflow, ` +
        `${report.summary.withEscapes} with viewport escapes, ${report.summary.withTextSpills} with text spills, ` +
        `${report.summary.redirects} auth redirects, ${report.summary.empty} empty pages`
    );
    console.log(`[audit] detail written to ${path.relative(ROOT, JSON_OUT)}`);
    process.exitCode = failed.length > 0 ? 1 : 0;
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error(`[audit] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
