// ─────────────────────────────────────────────────────────────────────────────
// permalink.mjs — encode the full visual state into a shareable URL.
//
// Format:  ?fx=<effect>&<uniform>=<value>&…
//
// Only params that DIFFER FROM THE REGISTRY DEFAULT are written, so a link to
// an untouched effect is just `?fx=corona`, and a tuned one carries exactly the
// deltas. That keeps links short, readable, and hand-editable — and it means a
// link stays meaningful if a default is later retuned, because it says "this
// param was deliberately set", not "here is a snapshot of everything".
//
// The trade-off is deliberate: if a default changes, an old link's *unset*
// params follow the new default. That is what you want for a sandbox (links
// track the project) and not what you want for an archive. Use the JSON export
// for a frozen snapshot.
// ─────────────────────────────────────────────────────────────────────────────

import { EFFECTS } from './registry.mjs';

const RESERVED = new Set(['fx', 'src', 'v']);

/** Build a query string for the given effect + live uniform values. */
export function encodeState(effectName, uniforms, { absolute = true } = {}) {
  const spec = EFFECTS[effectName];
  const q = new URLSearchParams();
  q.set('fx', effectName);

  for (const [key, schema] of Object.entries(spec?.params ?? {})) {
    const u = uniforms[key];
    if (!u) continue;
    const v = u.value;
    if (typeof v !== 'number') continue;
    if (nearly(v, schema.def)) continue;                 // default → omit
    q.set(key, schema.int ? String(Math.round(v)) : trim(v));
  }

  const qs = `?${q.toString()}`;
  if (!absolute) return qs;
  return `${location.origin}${location.pathname}${qs}`;
}

/** Read effect name + param overrides out of a URL's query string. */
export function decodeState(search = location.search) {
  const q = new URLSearchParams(search);
  const fx = q.get('fx');
  const effectName = fx && EFFECTS[fx] ? fx : null;
  const params = {};

  if (effectName) {
    const schema = EFFECTS[effectName].params ?? {};
    for (const [key, raw] of q.entries()) {
      if (RESERVED.has(key)) continue;
      const s = schema[key];
      if (!s) continue;                                   // unknown key: ignore, don't throw
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;                  // garbage: ignore
      params[key] = clamp(s.int ? Math.round(n) : n, s.min, s.max);
    }
  }
  return { effectName, params };
}

/** Apply decoded params onto a material's uniforms. Returns keys applied. */
export function applyParams(uniforms, params) {
  const applied = [];
  for (const [k, v] of Object.entries(params)) {
    if (uniforms[k]) { uniforms[k].value = v; applied.push(k); }
  }
  return applied;
}

/** Rewrite the address bar without adding a history entry. */
export function syncURL(effectName, uniforms) {
  history.replaceState(null, '', encodeState(effectName, uniforms, { absolute: false }));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const nearly = (a, b) => Math.abs(a - b) < 1e-9;
// Trim float noise: 0.30000000000000004 → 0.3
const trim = (v) => String(parseFloat(v.toPrecision(6)));
