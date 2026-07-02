#!/usr/bin/env node
// screenshot.cjs <base-url> <comma-separated-paths> <out-dir>
// Runs INSIDE the sandbox container (mounted read-only, like pipeline.sh).
// Captures a full-page PNG per path into <out-dir>/<sanitized-path>.png.
// Starts NOTHING itself — pipeline.sh owns the app server lifecycle.
// Best-effort by contract: ALWAYS exits 0, even on total failure (prints warnings) —
// a build must never fail because of screenshots.
// No deps beyond playwright-core (globally installed in the image).
'use strict';

const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  // require() from an arbitrary cwd does not see global npm modules, so fall back to the
  // image's global install path explicitly (pipeline.sh also sets NODE_PATH as belt-and-braces).
  const candidates = ['playwright-core', '/usr/local/lib/node_modules/playwright-core'];
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try next */ }
  }
  return null;
}

function sanitize(p) {
  const s = String(p).replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  return (s || 'home').slice(0, 80);
}

const [baseUrl, pathsCsv, outDir] = process.argv.slice(2);
if (!baseUrl || !pathsCsv || !outDir) {
  console.warn('screenshot: usage: screenshot.cjs <base-url> <paths-csv> <out-dir> — skipping');
  process.exit(0);
}

const pw = loadPlaywright();
if (!pw) {
  console.warn('screenshot: playwright-core not available in this image — skipping (rebuild via deploy/sandbox/build-image.sh)');
  process.exit(0);
}

(async () => {
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {
    console.warn('screenshot: cannot create ' + outDir + ': ' + e.message + ' — skipping');
    return;
  }

  let browser;
  try {
    // chromiumSandbox:false — the rootless podman container has no privileges for Chromium's
    // own sandbox; isolation is provided by the container itself.
    browser = await pw.chromium.launch({
      chromiumSandbox: false,
      args: ['--disable-dev-shm-usage'],
    });
  } catch (e) {
    console.warn('screenshot: chromium launch failed: ' + e.message + ' — skipping');
    return;
  }

  const base = String(baseUrl).replace(/\/+$/, '');
  const paths = pathsCsv.split(',').map((s) => s.trim()).filter(Boolean);
  let ok = 0;

  for (const p of paths) {
    const url = base + (p.startsWith('/') ? p : '/' + p);
    let page;
    try {
      page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      // networkidle when it settles, otherwise proceed after 15s and shoot whatever rendered.
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      } catch (e) {
        console.warn('screenshot: ' + url + ': ' + e.message + ' — capturing current state anyway');
      }
      const file = path.join(outDir, sanitize(p) + '.png');
      await page.screenshot({ path: file, fullPage: true, timeout: 15000 });
      console.log('screenshot: wrote ' + file);
      ok++;
    } catch (e) {
      console.warn('screenshot: FAILED ' + url + ': ' + e.message);
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  await browser.close().catch(() => {});
  console.log('screenshot: captured ' + ok + '/' + paths.length);
})().catch((e) => {
  console.warn('screenshot: fatal (ignored): ' + (e && e.message));
}).finally(() => process.exit(0));
