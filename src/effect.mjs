// ─────────────────────────────────────────────────────────────────────────────
// effect.mjs — builds a THREE.ShaderMaterial for one registry entry.
//
// PORTABILITY CONTRACT. Everything an effect needs from the host is in
// `coreUniforms()`. To drop an effect into another r160 project you need:
//   1. these uniforms, updated per frame,
//   2. glslVersion: THREE.GLSL3,
//   3. the shader source with common.glsl inlined.
// Nothing else. See docs/PORTING.md.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import { EFFECTS, defaults } from './registry.mjs';
import { loadShader, annotateError } from './shader-loader.mjs';

// A fullscreen triangle beats a quad: one primitive instead of two, no seam
// down the diagonal where derivatives go wrong. Vertices are already in clip
// space, so the vertex shader is a pass-through and no camera matrix is used.
const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

export function coreUniforms() {
  return {
    uResolution: { value: new THREE.Vector3(1, 1, 1) },
    uTime:       { value: 0 },
    uMouse:      { value: new THREE.Vector4(0, 0, 0, 0) },
    uTimeScale:  { value: 1 },
  };
}

/** Build the material for `name`. Throws with an annotated source on failure. */
export async function buildEffect(name, { outputTransform = false } = {}) {
  const spec = EFFECTS[name];
  if (!spec) throw new Error(`unknown effect: ${name}`);

  const fragmentShader = await loadShader(spec.frag);

  const uniforms = coreUniforms();
  for (const [k, v] of Object.entries(defaults(name))) uniforms[k] = { value: v };

  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,   // required: tanh() and `out` are GLSL ES 3.00
    vertexShader: VERT,
    fragmentShader,
    uniforms,
    defines: outputTransform ? { USE_THREE_OUTPUT_TRANSFORM: '' } : {},
    depthTest: false,
    depthWrite: false,
  });

  material.userData.sourceForErrors = fragmentShader;
  return { material, spec };
}

/**
 * Did the material's program actually link?
 *
 * renderer.compile() logs a compile failure to the console and returns
 * normally, so a broken shader otherwise reports "ok" and renders black — the
 * worst failure mode, because it looks like a shader bug rather than a build
 * error. Ask the GL program directly.
 */
export function assertLinked(renderer, material) {
  const gl = renderer.getContext();
  const program = renderer.properties.get(material)?.currentProgram?.program;
  if (!program) return;                       // not compiled yet — nothing to assert
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return;

  // The program log only says "fragment shader is not compiled". The useful
  // message — file, line, and the offending token — lives on the SHADER.
  let detail = gl.getProgramInfoLog(program) || '';
  for (const sh of gl.getAttachedShaders(program) ?? []) {
    if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) continue;
    const log = (gl.getShaderInfoLog(sh) || '').trim();
    const src = gl.getShaderSource(sh) || '';
    const lines = src.split('\n');
    // Quote the line each ERROR: 0:<n> points at. three.js prefixes ~40 lines
    // of injected #define, so a raw line number is not findable by hand.
    const quoted = log.replace(/ERROR:\s*\d+:(\d+)/g, (m, n) => {
      const i = parseInt(n, 10) - 1;
      return `${m}  →  ${(lines[i] ?? '(out of range)').trim()}`;
    });
    detail += `\n${quoted}`;
  }
  throw new Error(`shader failed to link:\n${detail.trim()}`);
}

/** Re-annotate a WebGL compile log against our own source lines. */
export function explainCompileError(material, log) {
  return annotateError(String(log), material.userData.sourceForErrors ?? '');
}
