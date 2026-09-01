#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// serve.mjs — static server that mirrors the PRODUCTION Cache-Control recipe,
// so cache-busting behaviour can actually be tested locally instead of assumed.
//
//   dev  (default)  shaders + modules are always no-store. You never debug a
//                   file that is no longer on disk. Fingerprints still applied
//                   and visible in the Network tab — they just aren't trusted.
//   prod (--prod)   the real recipe:
//                     ?v=<token> present  →  max-age=31536000, immutable
//                     HTML / no query     →  no-cache
//                   Use this to verify a bust actually propagates. Edit a
//                   shader WITHOUT running bust.sh and it should stay stale —
//                   that is the mechanism working, not a bug.
//
// Usage:  node serve.mjs [--port 8080] [--prod]
// ─────────────────────────────────────────────────────────────────────────────

import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const PORT = Number(args[args.indexOf('--port') + 1]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.glsl': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
};

function cacheHeader(pathname, hasVersion) {
  // sw.js must always revalidate: a cached service worker cannot be replaced
  // by a new one, so it would pin users to an old build permanently.
  if (pathname.endsWith('/sw.js')) return 'no-cache';
  if (!PROD) return 'no-store';
  if (hasVersion) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Contain the path inside ROOT — normalize first, then verify the prefix.
    const filePath = join(ROOT, normalize(pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    // public/ is served at the root, matching the Vite/Next convention the
    // cache-busting toolkit assumes when it writes /cb-shapes/*.svg refs.
    let resolved = filePath;
    try {
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      resolved = join(ROOT, 'public', normalize(pathname));
      if (!resolved.startsWith(ROOT)) throw new Error('forbidden');
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error('not a file');
    }

    const body = await readFile(resolved);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(resolved)] ?? 'application/octet-stream',
      'Cache-Control': cacheHeader(pathname, url.searchParams.has('v')),
      'X-Cache-Mode': PROD ? 'prod' : 'dev',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
  }
}).listen(PORT, () => {
  console.log(`\n  procedural3dvisuals  →  http://localhost:${PORT}`);
  console.log(`  cache mode: ${PROD ? 'PROD (fingerprints trusted)' : 'DEV (no-store, always fresh)'}\n`);
});
