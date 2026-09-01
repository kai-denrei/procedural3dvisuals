// ─────────────────────────────────────────────────────────────────────────────
// main.mjs — renderer boot, frame loop, resize, and wiring.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EFFECTS, DEFAULT_EFFECT } from './registry.mjs';
import { buildEffect, fullscreenTriangle, explainCompileError } from './effect.mjs';
import { buildUI } from './ui.mjs';
import { bustToken } from './shader-loader.mjs';
import { registerSW, initFullscreen, initImmersive, initWakeLock, initInstall, standalone } from './pwa.mjs';

const canvas = document.getElementById('gl');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,          // pointless for a per-pixel procedural effect
  powerPreference: 'high-performance',
});
// Pinned explicitly rather than left to defaults, so the sandbox's colour
// pipeline is stated rather than inherited. Both are three.js r160 defaults;
// writing them down is the point. See shaders/common.glsl :: writeOut().
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.Camera();          // unused; vertex shader is pass-through
const geometry = fullscreenTriangle();

let mesh = null;
let current = null;                          // { material, spec }
let effectName = new URLSearchParams(location.search).get('fx') || DEFAULT_EFFECT;
if (!EFFECTS[effectName]) effectName = DEFAULT_EFFECT;

const state = {
  paused: false,
  time: 0,
  resScale: 1.0,
  outputTransform: false,
  mouse: new THREE.Vector4(0, 0, 0, 0),
};

// ── Load / swap effect ──────────────────────────────────────────────────────
async function load(name) {
  const status = document.getElementById('status');
  status.textContent = `compiling ${name}…`;
  status.className = 'busy';
  try {
    const built = await buildEffect(name, { outputTransform: state.outputTransform });

    if (mesh) { scene.remove(mesh); current.material.dispose(); }
    mesh = new THREE.Mesh(geometry, built.material);
    mesh.frustumCulled = false;              // clip-space verts defeat the bounds test
    scene.add(mesh);
    current = built;
    effectName = name;

    resize();
    renderer.compile(scene, camera);         // surface compile errors now, not on frame 1

    buildUI(built.spec, built.material, state, load);
    document.getElementById('note').textContent = built.spec.note;
    status.textContent = `${built.spec.label} · v${bustToken()}`;
    status.className = 'ok';

    const url = new URL(location.href);
    url.searchParams.set('fx', name);
    history.replaceState(null, '', url);
  } catch (err) {
    status.textContent = 'FAILED — see console';
    status.className = 'err';
    const detail = current ? explainCompileError(current.material, err.message) : err.message;
    console.error('[fx] load failed:', detail);
    throw err;
  }
}

// ── Resize ──────────────────────────────────────────────────────────────────
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * state.resScale;
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (current) {
    const b = renderer.getDrawingBufferSize(new THREE.Vector2());
    current.material.uniforms.uResolution.value.set(b.x, b.y, b.x / b.y);
  }
}
window.addEventListener('resize', resize);
// visualViewport catches the iOS address bar collapsing, which changes the
// usable height without firing a window resize.
window.visualViewport?.addEventListener('resize', resize);
screen.orientation?.addEventListener('change', () => setTimeout(resize, 120));

// ── Input ───────────────────────────────────────────────────────────────────
// Pointer input is bound to the CANVAS, not the window. Bound to the window it
// also fired while dragging a slider — so adjusting a dial moved uMouse too.
// { passive: true } because we never preventDefault here; touch-action:none in
// the CSS already tells the browser we own the gesture.
function pointerXY(e) {
  const dpr = renderer.getPixelRatio();
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * dpr, (r.bottom - e.clientY) * dpr];  // GL origin is bottom-left
}
canvas.addEventListener('pointermove', (e) => {
  [state.mouse.x, state.mouse.y] = pointerXY(e);
}, { passive: true });
canvas.addEventListener('pointerdown', (e) => {
  [state.mouse.z, state.mouse.w] = pointerXY(e);
}, { passive: true });

addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); state.paused = !state.paused; }
  if (e.key === 'r') { state.time = 0; }
  if (e.key === 'h') { immersive.toggle(); }
  if (e.key === 'f') { fullscreen.toggle(); }
  if (e.key === 's') { savePNG(); }
});

function savePNG() {
  renderer.render(scene, camera);            // ensure buffer is fresh before read
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${effectName}-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ── Frame loop ──────────────────────────────────────────────────────────────
let last = performance.now();
let fpsAcc = 0, fpsN = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);   // clamp: tab-switch must not jump time
  last = now;
  if (!current) return;

  if (!state.paused) state.time += dt;

  const u = current.material.uniforms;
  u.uTime.value = state.time;
  u.uMouse.value.copy(state.mouse);

  renderer.render(scene, camera);

  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) {
    document.getElementById('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps`;
    fpsAcc = 0; fpsN = 0;
  }
}

// ── PWA / mobile layer ──────────────────────────────────────────────────────
const immersive = initImmersive();
const fullscreen = initFullscreen({ onChange: () => setTimeout(resize, 120) });
initWakeLock();
initInstall();
registerSW();
if (standalone()) document.body.classList.add('installed');

// ── Go ──────────────────────────────────────────────────────────────────────
load(effectName).then(() => requestAnimationFrame(frame));

// Exposed for console poking and for the reload button.
window.fx = { load, state, get current() { return current; }, renderer, THREE };
