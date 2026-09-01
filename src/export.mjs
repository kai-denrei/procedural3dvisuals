// ─────────────────────────────────────────────────────────────────────────────
// export.mjs — get things OUT of the sandbox.
//
// Five outputs, in rough order of how portable the result is:
//   PNG          a frame
//   JSON         the variables (a frozen snapshot, unlike a permalink)
//   Link         a deeplink to this exact look
//   .frag        the shader with #includes resolved — paste into any GLSL host
//   .html        a self-contained page: raw WebGL2, NO three.js, no build,
//                no network. Open it anywhere, forever.
//
// The standalone HTML deliberately does not use three.js. These are fullscreen
// fragment shaders; three is ~1.2MB of scene graph to draw two triangles. A
// dependency-free file is the most reusable artifact this project can emit.
// ─────────────────────────────────────────────────────────────────────────────

import { EFFECTS } from './registry.mjs';
import { encodeState } from './permalink.mjs';

// ── helpers ─────────────────────────────────────────────────────────────────
function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context and a user gesture; fall back so
    // the action never silently does nothing.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Live uniform values for the effect's own params (not the core four). */
export function paramValues(effectName, uniforms) {
  const out = {};
  for (const key of Object.keys(EFFECTS[effectName]?.params ?? {})) {
    if (uniforms[key]) out[key] = uniforms[key].value;
  }
  return out;
}

// ── 1. PNG ──────────────────────────────────────────────────────────────────
export function exportPNG(renderer, scene, camera, effectName) {
  renderer.render(scene, camera);            // the buffer is cleared after compositing
  return new Promise((resolve) => {
    renderer.domElement.toBlob((blob) => {
      download(`${effectName}-${stamp()}.png`, blob);
      resolve(true);
    }, 'image/png');
  });
}

// ── 2. Variables ────────────────────────────────────────────────────────────
export function paramsDocument(effectName, uniforms, cost = null) {
  const spec = EFFECTS[effectName];
  return {
    effect: effectName,
    label: spec.label,
    credit: spec.credit ?? null,
    generator: 'procedural3dvisuals',
    exported: new Date().toISOString(),
    permalink: encodeState(effectName, uniforms),
    params: paramValues(effectName, uniforms),
    // Present only if the cost was measured this session. A params file that
    // records what it cost on a real device is worth far more to a game
    // integration decision than one that does not.
    cost: cost ?? undefined,
  };
}

export function exportParamsJSON(effectName, uniforms, cost = null) {
  const doc = paramsDocument(effectName, uniforms, cost);
  download(`${effectName}-params-${stamp()}.json`,
           new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  return doc;
}

export const copyParams = (effectName, uniforms, cost = null) =>
  copyText(JSON.stringify(paramsDocument(effectName, uniforms, cost), null, 2));

export const copyLink = (effectName, uniforms) =>
  copyText(encodeState(effectName, uniforms));

// ── 3. Shader source ────────────────────────────────────────────────────────
export function exportFrag(effectName, resolvedSource) {
  download(`${effectName}.frag`, new Blob([creditHeader(effectName) + resolvedSource],
                                          { type: 'text/plain' }));
}

function creditHeader(effectName) {
  const c = EFFECTS[effectName]?.credit;
  if (!c) return '';
  const via = (c.via ?? []).map((v) => `//   via: ${v.label} — ${v.url}`).join('\n');
  return `// ${EFFECTS[effectName].label}\n//   origin: ${c.origin}\n${via}\n`
       + (c.note ? `//   note: ${c.note}\n` : '') + '//\n';
}

// ── 4. Self-contained HTML ──────────────────────────────────────────────────
/**
 * Emit a single .html file that renders this effect with raw WebGL2 and no
 * dependencies at all. The shader body is reused verbatim; only the uniform
 * plumbing is replaced, so what you see here is what that file renders.
 */
export function exportStandaloneHTML(effectName, resolvedSource, uniforms) {
  const spec = EFFECTS[effectName];
  const values = paramValues(effectName, uniforms);
  const c = spec.credit;

  // Bake the current values in as constants: a standalone file has no UI, and a
  // uniform nobody can set is just a slower constant.
  const baked = Object.entries(values)
    .map(([k, v]) => {
      const s = spec.params[k];
      return s?.int ? `const int ${k} = ${Math.round(v)};`
                    : `const float ${k} = ${Number(v).toFixed(6)};`;
    }).join('\n');

  // Strip the uniform declarations we are replacing with constants.
  let body = resolvedSource;
  for (const k of Object.keys(values)) {
    body = body.replace(new RegExp(`^\\s*uniform\\s+(int|float)\\s+${k}\\s*;.*$`, 'gm'), '');
  }
  body = body.replace(/^\s*uniform\s+vec3\s+uResolution\s*;.*$/gm, '')
             .replace(/^\s*uniform\s+float\s+uTime\s*;.*$/gm, '')
             .replace(/^\s*uniform\s+vec4\s+uMouse\s*;.*$/gm, '')
             .replace(/^\s*uniform\s+float\s+uTimeScale\s*;.*$/gm, '');

  const creditHTML = c
    ? `<!--\n  ${spec.label}\n  origin: ${c.origin}\n`
      + (c.via ?? []).map((v) => `  via: ${v.label} — ${v.url}\n`).join('')
      + (c.note ? `  note: ${c.note}\n` : '')
      + `  exported from procedural3dvisuals\n-->`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${spec.label}</title>
${creditHTML}
<style>
  html,body{margin:0;height:100%;background:#07080a;overflow:hidden}
  canvas{display:block;width:100%;height:100%;touch-action:none}
</style></head><body>
<canvas id="c"></canvas>
<script>
// Self-contained: raw WebGL2, no dependencies, no network.
const cv = document.getElementById('c');
const gl = cv.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
if (!gl) { document.body.innerHTML = '<p style="color:#eee;font:14px system-ui;padding:2rem">WebGL2 required.</p>'; }

const VS = \`#version 300 es
void main(){
  // Fullscreen triangle from gl_VertexID — no buffers needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}\`;

const FS = \`#version 300 es
precision highp float;
uniform vec3 uResolution;
uniform float uTime;
uniform vec4 uMouse;
const float uTimeScale = 1.0;
${baked.split('\n').map((l) => l).join('\n')}
${body.replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}
\`;

function compile(type, src){
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); }
  return s;
}
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);

const uRes = gl.getUniformLocation(prog, 'uResolution');
const uT   = gl.getUniformLocation(prog, 'uTime');
const uM   = gl.getUniformLocation(prog, 'uMouse');
const vao  = gl.createVertexArray(); gl.bindVertexArray(vao);

let mouse = [0,0,0,0];
cv.addEventListener('pointermove', (e) => {
  const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio||1, 2);
  mouse[0] = (e.clientX - r.left) * d; mouse[1] = (r.bottom - e.clientY) * d;
}, { passive: true });

function resize(){
  const d = Math.min(devicePixelRatio || 1, 2);
  const w = Math.floor(innerWidth * d), h = Math.floor(innerHeight * d);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  gl.viewport(0, 0, cv.width, cv.height);
}
addEventListener('resize', resize); resize();

const t0 = performance.now();
(function frame(){
  requestAnimationFrame(frame);
  resize();
  gl.uniform3f(uRes, cv.width, cv.height, cv.width / cv.height);
  gl.uniform1f(uT, (performance.now() - t0) / 1000);
  gl.uniform4f(uM, mouse[0], mouse[1], mouse[2], mouse[3]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
})();
<\/script></body></html>`;

  download(`${effectName}-standalone.html`, new Blob([html], { type: 'text/html' }));
  return html;
}
