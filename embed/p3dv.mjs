// ─────────────────────────────────────────────────────────────────────────────
// p3dv.mjs — embed these effects in another project.
//
// Target profile: vanilla ES modules, browser-native, three.js r160, no build.
// Copy `embed/`, `shaders/` and `src/registry.mjs` into your project, or point
// `basePath` at wherever they live (including another origin that sends CORS).
//
//   import { mountFullscreen } from './p3dv/p3dv.mjs';
//   const fx = await mountFullscreen({ canvas, effect: 'wormhole' });
//   fx.set({ uSpeed: 2.4 });
//
// Three entry points, in order of how much control you keep:
//   mountFullscreen  we own a renderer and a loop — one line, works immediately
//   createEffect     you own the renderer; we hand back a Mesh + update()
//   createTexture    you own everything; we render into a texture for your scene
//
// This module NEVER imports the sandbox UI, service worker, or cache-busting.
// The only hard dependencies are three.js r160+ and the shader files.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

// ── shader loading (standalone copy — no dependency on src/) ────────────────
const INCLUDE_RE = /^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm;

async function loadShader(url, { version, seen = new Set(), shaderDir } = {}) {
  const bust = version ? `${url}${url.includes('?') ? '&' : '?'}v=${version}` : url;
  const res = await fetch(bust);
  if (!res.ok) throw new Error(`p3dv: cannot load ${url} (HTTP ${res.status})`);
  let src = await res.text();

  const jobs = [];
  src.replace(INCLUDE_RE, (m, name) => { jobs.push({ m, name }); return m; });
  for (const { m, name } of jobs) {
    if (seen.has(name)) { src = src.replace(m, `// [include guard] ${name}`); continue; }
    seen.add(name);
    src = src.replace(m, await loadShader(shaderDir + name, { version, seen, shaderDir }));
  }
  return src;
}

const VERT = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';

function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

/**
 * @typedef {Object} P3DVOptions
 * @property {string}  effect        registry key, e.g. 'corona'
 * @property {Object} [params]       uniform overrides
 * @property {string} [basePath]     where shaders/ and registry live. Default './'
 * @property {string} [version]      cache-bust token to append to fetches
 * @property {boolean}[outputTransform] route through three's colorspace/tonemap
 * @property {Object} [registry]     inject EFFECTS instead of fetching it
 */

async function resolveSpec(opts) {
  const base = opts.basePath ?? './';
  const registry = opts.registry ?? (await import(`${base}src/registry.mjs`)).EFFECTS;
  const spec = registry[opts.effect];
  if (!spec) {
    throw new Error(`p3dv: unknown effect "${opts.effect}". Known: ${Object.keys(registry).join(', ')}`);
  }
  return { base, registry, spec };
}

function buildUniforms(spec, params) {
  const u = {
    uResolution: { value: new THREE.Vector3(1, 1, 1) },
    uTime:       { value: 0 },
    uMouse:      { value: new THREE.Vector4(0, 0, 0, 0) },
    uTimeScale:  { value: 1 },
  };
  for (const [k, s] of Object.entries(spec.params ?? {})) u[k] = { value: s.def };
  for (const [k, v] of Object.entries(params ?? {})) if (u[k]) u[k].value = v;
  return u;
}

/**
 * Build the material + mesh. You drive the renderer.
 * @returns {Promise<{mesh, material, uniforms, set, setTime, setResolution, credit, dispose}>}
 */
export async function createEffect(opts) {
  const { base, spec } = await resolveSpec(opts);
  const shaderDir = `${base}shaders/`;
  const fragmentShader = await loadShader(`${base}${spec.frag}`, { version: opts.version, shaderDir });
  const uniforms = buildUniforms(spec, opts.params);

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,          // required: tanh() is GLSL ES 3.00
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    defines: opts.outputTransform ? { USE_THREE_OUTPUT_TRANSFORM: '' } : {},
    depthTest: false,
    depthWrite: false,
  });

  const geometry = fullscreenTriangle();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;          // clip-space verts defeat the bounds test

  return {
    mesh, material, uniforms, spec,
    credit: spec.credit ?? null,
    source: fragmentShader,
    set(next) { for (const [k, v] of Object.entries(next)) if (uniforms[k]) uniforms[k].value = v; },
    setTime(t) { uniforms.uTime.value = t; },
    /** Pass DRAWING BUFFER pixels, not CSS pixels. */
    setResolution(w, h) { uniforms.uResolution.value.set(w, h, w / h); },
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

/**
 * Own canvas, own renderer, own rAF loop. The one-liner.
 * @returns {Promise<{fx, renderer, start, stop, resize, set, dispose}>}
 */
export async function mountFullscreen(opts) {
  const canvas = opts.canvas ?? document.body.appendChild(document.createElement('canvas'));
  const renderer = opts.renderer ?? new THREE.WebGLRenderer({
    canvas, antialias: false, powerPreference: 'high-performance',
  });
  // Stated, not inherited. A bare ShaderMaterial writes to the framebuffer
  // verbatim; these are the values that make that faithful.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const fx = await createEffect(opts);
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(fx.mesh);

  const maxDPR = opts.maxPixelRatio ?? 2;
  const scale = opts.renderScale ?? 1;

  function resize() {
    const w = opts.width ?? canvas.clientWidth ?? window.innerWidth;
    const h = opts.height ?? canvas.clientHeight ?? window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDPR) * scale);
    renderer.setSize(w, h, opts.updateStyle !== false);
    const b = renderer.getDrawingBufferSize(new THREE.Vector2());
    fx.setResolution(b.x, b.y);
  }
  resize();
  window.addEventListener('resize', resize);

  let raf = null, t0 = performance.now(), paused = false, elapsed = 0, last = t0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);   // clamp: tab-switch must not jump
    last = now;
    if (!paused) elapsed += dt;
    fx.setTime(elapsed);
    opts.onFrame?.(elapsed, fx);
    renderer.render(scene, camera);
  }

  const api = {
    fx, renderer, scene, camera,
    set: fx.set,
    credit: fx.credit,
    get time() { return elapsed; },
    set time(v) { elapsed = v; },
    get paused() { return paused; },
    set paused(v) { paused = v; },
    start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } return api; },
    stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } return api; },
    resize,
    dispose() {
      api.stop();
      window.removeEventListener('resize', resize);
      fx.dispose();
      if (!opts.renderer) renderer.dispose();
    },
  };
  if (opts.autoStart !== false) api.start();
  return api;
}

/**
 * Render the effect into a texture for use on real geometry — a portal on a
 * plane, an emissive material on a .glb, a screen in a scene.
 *
 * Two things this gets right that are easy to get wrong by hand:
 *  - uResolution is the TARGET's size, not the canvas's. Otherwise the ring is
 *    sized for the wrong aspect and lands off-centre.
 *  - texture.colorSpace is SRGBColorSpace, because the effect writes
 *    display-referred values. Getting this backwards is the most common cause
 *    of "it looked right in the sandbox and wrong in my scene".
 *
 * @returns {Promise<{texture, update, setSize, dispose}>}
 */
export async function createTexture(renderer, opts) {
  const size = opts.size ?? 1024;
  const w = Array.isArray(size) ? size[0] : size;
  const h = Array.isArray(size) ? size[1] : size;

  const target = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.colorSpace = THREE.SRGBColorSpace;

  const fx = await createEffect(opts);
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  scene.add(fx.mesh);
  fx.setResolution(w, h);

  return {
    texture: target.texture,
    target, fx,
    credit: fx.credit,
    set: fx.set,
    /** Call once per frame BEFORE your main render. */
    update(timeSeconds) {
      fx.setTime(timeSeconds);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
    },
    setSize(nw, nh) { target.setSize(nw, nh); fx.setResolution(nw, nh); },
    dispose() { fx.dispose(); target.dispose(); },
  };
}

/** Credits for one effect, or all of them. Call it; ship it in your about box. */
export async function credits(opts = {}) {
  const base = opts.basePath ?? './';
  const registry = opts.registry ?? (await import(`${base}src/registry.mjs`)).EFFECTS;
  const one = (k) => ({ effect: k, label: registry[k].label, ...(registry[k].credit ?? {}) });
  return opts.effect ? one(opts.effect) : Object.keys(registry).map(one);
}
