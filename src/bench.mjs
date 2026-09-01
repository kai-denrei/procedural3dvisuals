// ─────────────────────────────────────────────────────────────────────────────
// bench.mjs — measure what an effect actually costs, on this device.
//
// WHY MEASURED AND NOT MODELLED. The obvious estimator is arithmetic on the
// loop bounds: uSteps x uTurbOctaves x pixels. It is wrong, and provably so.
// Corona (40 x 6, no early exit) measures ~0.83ms at 1280x720 on an M4, while
// Melting Jelly — 90 march steps, 3 SDFs each, 6 more for the normal, plus 30
// refraction steps — measures ~0.21ms. Three times CHEAPER, because sphere
// tracing early-exits and corona's loop runs unconditionally for every pixel.
//
// A static model would have confidently reported the opposite. So this asks the
// GPU.
//
// METHOD, and why it is not "time the thing you care about".
//
// 1. Force a sync. Render N frames into an off-screen target, then read one
//    pixel back before stopping the clock. Without that read you time how fast
//    JavaScript can QUEUE draw calls, not how long they take — which is how an
//    fps counter reports 60 for both a 1280x720 and a 256x256 render.
//    gl.readPixels on a bound render target is a real sync point. On the
//    DEFAULT framebuffer it is not usable at all: the drawing buffer is cleared
//    after compositing.
//
// 2. Measure BIG, then derive. These effects cost tens of microseconds at
//    512x512 on a desktop GPU, and performance.now() is deliberately coarsened
//    by browsers. Timing them directly measures the clock. An earlier version
//    of this file did exactly that and confidently reported that cutting a
//    loop from 4 iterations to 3 made it 314% SLOWER.
//
//    Fragment cost is linear in pixel count — verified here across 1024/2048/
//    3072 at 0.315 / 0.335 / 0.336 ms per megapixel. So calibrate at a target
//    large enough that the signal swamps the clock, reduce to ms/megapixel, and
//    predict the small sizes from that. Predictions are marked as such.
//
//    Linearity breaks DOWN, not up: at 512x512 the same shader measured
//    0.458 ms/MP because fixed per-draw overhead stops being negligible. Small
//    targets therefore cost slightly MORE than the prediction, never less —
//    which is the safe direction to be wrong in.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EFFECTS } from './registry.mjs';

/** Frame budgets, in ms. */
export const BUDGET = { 60: 1000 / 60, 30: 1000 / 30 };

/** Below this, a difference is indistinguishable from measurement noise. */
export const NOISE_FLOOR_PCT = 8;

/** Resolutions worth knowing about, and what each corresponds to in practice. */
export const PRESETS = [
  { key: 'native', label: 'viewport', note: 'fullscreen at the current render scale' },
  { key: '1024',   w: 1024, h: 1024, note: 'large render target — a portal on a plane, up close' },
  { key: '512',    w: 512,  h: 512,  note: 'the usual texture size for an in-scene effect' },
  { key: '256',    w: 256,  h: 256,  note: 'small emissive panel, or a distant object' },
];

const MP = (w, h) => (w * h) / 1e6;

/**
 * One timed run at w x h. Adaptive: renders until the total is comfortably
 * above the clock's resolution. Restores uResolution and the bound render
 * target before returning — a probe that mutates what it measures corrupts
 * every later observation.
 */
export function timeOnce(renderer, material, w, h, { minTotalMs = 80, maxReps = 2000 } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false });
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

  const prevRes = material.uniforms.uResolution.value.clone();
  const prevTarget = renderer.getRenderTarget();
  material.uniforms.uResolution.value.set(w, h, w / h);

  try {
    renderer.setRenderTarget(target);
    for (let i = 0; i < 3; i++) { material.uniforms.uTime.value = i * 0.1; renderer.render(scene, camera); }
    sync();

    const CAL = 4;
    let t = performance.now();
    for (let i = 0; i < CAL; i++) { material.uniforms.uTime.value = 1 + i * 0.05; renderer.render(scene, camera); }
    sync();
    const perRep = Math.max((performance.now() - t) / CAL, 1e-4);

    const reps = Math.max(CAL, Math.min(maxReps, Math.ceil(minTotalMs / perRep)));
    t = performance.now();
    for (let i = 0; i < reps; i++) {
      material.uniforms.uTime.value = 1 + i * 0.05;   // vary time: no frame is a repeat
      renderer.render(scene, camera);
    }
    sync();
    return (performance.now() - t) / reps;
  } finally {
    renderer.setRenderTarget(prevTarget);
    material.uniforms.uResolution.value.copy(prevRes);
    target.dispose();
    geometry.dispose();
  }
}

/**
 * MINIMUM of repeated runs, plus the spread.
 * Min, not mean: every error source here is additive — scheduler hiccups, GPU
 * contention, thermal throttling. None of them make a shader faster, so the
 * fastest pass is closest to the truth and the spread says how much to trust it.
 */
function best(renderer, material, w, h, passes = 3) {
  const runs = [];
  for (let i = 0; i < passes; i++) runs.push(timeOnce(renderer, material, w, h));
  runs.sort((a, b) => a - b);
  return { ms: runs[0], spreadPct: runs[0] > 0 ? ((runs.at(-1) - runs[0]) / runs[0]) * 100 : 0 };
}

/**
 * Find a target big enough to measure honestly, and reduce to ms/megapixel.
 * Steps up until a single render takes >= 2ms, so a phone lands on a smaller
 * size than a desktop and neither is timing its own clock.
 */
export function calibrate(renderer, material) {
  // Linearity holds from ~1MP up (verified: 0.315 / 0.335 / 0.336 ms/MP at
  // 1024/2048/3072), so 2048² is the default calibration point. Drop to 1024²
  // only if this device is slow enough that 2048² would stall the tab.
  const probe = timeOnce(renderer, material, 1024, 1024, { minTotalMs: 30 });
  const size = probe > 8 ? 1024 : 2048;          // >8ms per 1MP frame = slow device
  const { ms, spreadPct } = best(renderer, material, size, size, 3);
  return { size, ms, spreadPct, msPerMP: ms / MP(size, size) };
}

/**
 * Which parameters actually cost anything, and by how much.
 * Measured at the calibration size, where a difference is visible at all.
 */
export function sensitivity(renderer, material, effectName, size) {
  const spec = EFFECTS[effectName];
  const baseRun = best(renderer, material, size, size, 3);
  const base = baseRun.ms;
  // Self-calibrating noise floor: never claim a difference smaller than the
  // run-to-run variation we just observed.
  const floor = Math.max(NOISE_FLOOR_PCT, baseRun.spreadPct);
  const out = [];

  for (const [key, s] of Object.entries(spec.params ?? {})) {
    if (!s.cost) continue;                       // flagged in the registry
    const u = material.uniforms[key];
    if (!u) continue;
    const original = u.value;
    const cheaper = s.int ? Math.max(s.min, Math.round((original + s.min) / 2))
                          : Math.max(s.min, (original + s.min) / 2);
    if (cheaper === original) continue;
    u.value = cheaper;
    const t = best(renderer, material, size, size, 3).ms;
    u.value = original;                          // always restore
    const savedPct = base > 0 ? ((base - t) / base) * 100 : 0;
    out.push({
      key, label: s.label, from: original, to: cheaper,
      ms: t, savedMs: base - t, savedPct,
      // Significance is judged against THIS run's observed spread, not a fixed
      // constant. If three passes of the same config varied by 20%, then a 15%
      // "saving" is nothing. Hard-coding the threshold is how you end up
      // reporting that halving a loop made a shader 57% slower — which was
      // noise, tested and disproved by a uSteps sweep, not a real effect.
      significant: Math.abs(savedPct) >= floor,
      direction: savedPct >= floor ? 'cheaper' : savedPct <= -floor ? 'costlier' : 'noise',
    });
  }
  out.sort((a, b) => Math.abs(b.savedPct) - Math.abs(a.savedPct));
  return { base, size, floorPct: floor, spreadPct: baseRun.spreadPct, params: out };
}

/** Predicted cost at each preset, from the calibrated ms/megapixel. */
export function profile(msPerMP, nativeW, nativeH) {
  return PRESETS.map((p) => {
    const w = p.key === 'native' ? nativeW : p.w;
    const h = p.key === 'native' ? nativeH : p.h;
    const ms = msPerMP * MP(w, h);
    return { ...p, w, h, mp: MP(w, h), ms,
             pct60: (ms / BUDGET[60]) * 100, pct30: (ms / BUDGET[30]) * 100 };
  });
}

/**
 * Turn a number into an integration decision.
 * The thresholds are a judgement, not physics. A 60fps frame is 16.7ms and a
 * game needs most of it for the game — so an effect eating a fifth of the frame
 * is already expensive, and one eating half is only affordable when nothing
 * else is happening, i.e. a cutscene.
 */
export function verdict(ms) {
  const pct = (ms / BUDGET[60]) * 100;
  if (pct < 5)   return { level: 'free',      text: 'Effectively free. Safe in-game alongside a running scene.' };
  if (pct < 20)  return { level: 'in-game',   text: 'Affordable in-game. Budget it, but it will not dominate the frame.' };
  if (pct < 50)  return { level: 'heavy',     text: 'Heavy. In-game only if it IS the focus; comfortable for cinematics.' };
  if (pct < 100) return { level: 'cinematic', text: 'Cinematic only — little frame left for a game to run underneath.' };
  return { level: 'over', text: 'Over a whole 60fps frame by itself. Cut resolution first; it scales linearly, step counts often do not.' };
}

/** One measurement of everything, for the UI and the JSON export. */
export function fullReport(renderer, material, effectName, nativeW, nativeH) {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const cal = calibrate(renderer, material);
  const rows = profile(cal.msPerMP, nativeW, nativeH);
  const native = rows.find((r) => r.key === 'native');
  return {
    measuredAt: new Date().toISOString(),
    device: {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      dpr: window.devicePixelRatio || 1,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
    },
    calibration: cal,
    resolutions: rows,
    verdict: verdict(native.ms),
    sensitivity: sensitivity(renderer, material, effectName, cal.size),
  };
}
