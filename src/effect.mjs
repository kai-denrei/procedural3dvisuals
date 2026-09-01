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

/** Re-annotate a WebGL compile log against our own source lines. */
export function explainCompileError(material, log) {
  return annotateError(String(log), material.userData.sourceForErrors ?? '');
}
