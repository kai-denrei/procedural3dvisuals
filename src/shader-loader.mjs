// ─────────────────────────────────────────────────────────────────────────────
// shader-loader.mjs — fetch .glsl/.frag with cache-bust token, resolve includes.
//
// WHY THIS EXISTS: the cache-busting toolkit rewrites asset URLs it can see in
// the HTML (<link>, <script>, <img>). It cannot see a URL that only exists
// inside a fetch() call. So we read the token it stamps into
// <meta name="cb" content="..."> and append it ourselves. Without this, edited
// shaders are served from the browser's disk cache and you debug a file that
// is no longer on disk.
// ─────────────────────────────────────────────────────────────────────────────

/** Cache-bust token stamped by scripts/bust.sh, or a dev fallback. */
export function bustToken() {
  const meta = document.querySelector('meta[name="cb"]');
  const tok = meta?.getAttribute('content');
  // No token (badge not installed / meta stripped) → per-load token so dev
  // never sees a stale shader. Deliberately NOT a constant.
  return tok && tok !== '' ? tok : `dev${Date.now().toString(36)}`;
}

const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

/**
 * Fetch a shader and inline its quoted #includes, recursively.
 * Angle-bracket includes are left alone — those belong to three.js.
 */
export async function loadShader(url, { token = bustToken(), seen = new Set(), base = 'shaders/' } = {}) {
  const bust = `${url}${url.includes('?') ? '&' : '?'}v=${token}`;
  const res = await fetch(bust, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`shader fetch failed: ${url} → HTTP ${res.status}`);
  let src = await res.text();

  const jobs = [];
  src.replace(INCLUDE_RE, (match, name) => { jobs.push({ match, name }); return match; });

  for (const { match, name } of jobs) {
    if (seen.has(name)) {           // include guard — a repeat is a no-op, not an error
      src = src.replace(match, `// [include guard] ${name} already inlined`);
      continue;
    }
    seen.add(name);
    const child = await loadShader(base + name, { token, seen, base });
    src = src.replace(match, child);
  }
  return src;
}

/**
 * Map a GLSL compile error's line number back to the pre-include source.
 * three.js reports line numbers against the fully-prefixed shader, which is
 * ~40 lines of injected #define before your first character. Without this you
 * chase phantom errors in three's prefix.
 */
export function annotateError(msg, finalSource) {
  const lines = finalSource.split('\n');
  return msg.replace(/ERROR:\s*\d+:(\d+)/g, (m, n) => {
    const i = parseInt(n, 10) - 1;
    const text = lines[i] !== undefined ? lines[i].trim() : '(out of range)';
    return `${m}  →  "${text}"`;
  });
}
