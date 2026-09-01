// ─────────────────────────────────────────────────────────────────────────────
// common.glsl — shared preamble for every effect in this sandbox.
//
// Included via  #include "common.glsl"   (double quotes).
// Our runtime resolver handles quoted includes; three.js's own resolveIncludes
// only handles angle-bracket <chunk> form, so the two never collide.
//
// Compiled as GLSL ES 3.00 (THREE.GLSL3). Under GLSL3 three.js does NOT declare
// pc_fragColor or alias gl_FragColor, so every effect declares its own
//     out vec4 fragColor;
// See vendor/three.module.js:20228 for the branch that decides this.
// ─────────────────────────────────────────────────────────────────────────────

// ── Uniforms present in every effect (see src/effect.mjs) ────────────────────
uniform vec3  uResolution;   // (w, h, w/h) in device pixels
uniform float uTime;         // seconds since start, pausable
uniform vec4  uMouse;        // xy = current px, zw = last click px
uniform float uTimeScale;

// ── Constants ───────────────────────────────────────────────────────────────
#define PI   3.14159265359
#define TAU  6.28318530718

// ── Xor / fragcoord.xyz dialect ─────────────────────────────────────────────
// Aliases so golfed source from fragcoord.xyz pastes in near-verbatim.
// Use these when transcribing; use the long forms when writing new code.
#define f   float
#define f2  vec2
#define f3  vec3
#define f4  vec4
#define len length
#define nor normalize
#define T   (uTime * uTimeScale)
#define R   uResolution

// ── Ray setup ───────────────────────────────────────────────────────────────
// Xor's standard camera. Reproduces  nor(2*C.rgb - R.xyy)  from the golfed
// source. The original leans on gl_FragCoord.z (~0.5) to supply the third
// component as (2*0.5 - R.y); we write -R.y explicitly — a sub-pixel difference,
// but deterministic instead of dependent on the quad's depth.
vec3 rayDir(vec2 fragCoord) {
    return normalize(vec3(2.0 * fragCoord - uResolution.xy, -uResolution.y));
}

// Screen coords normalised to [-1,1] on the short axis, aspect-correct.
vec2 screenUV(vec2 fragCoord) {
    return (2.0 * fragCoord - uResolution.xy) / uResolution.y;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
mat2 rot(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// Xor's turbulence: repeated  p += sin(p.zxy * d + phase) / d  with d doubling.
// Octaves of sine folded through a channel swizzle — organic advection with no
// noise texture and no hash. The .zxy rotation is what stops it collapsing into
// an axis-aligned grid.
vec3 turbulence(vec3 p, float phase, int octaves, float amp, float freq) {
    float d = freq;
    for (int i = 0; i < octaves; i++) {
        d += d;
        p += amp * sin(p.zxy * d + phase) / d;
    }
    return p;
}

// ── Output ──────────────────────────────────────────────────────────────────
// common.glsl owns the fragment output declaration. Under THREE.GLSL3 three.js
// injects neither `pc_fragColor` nor a `gl_FragColor` alias, so this must be
// declared exactly once per program — here, not in each effect.
out vec4 fragColor;

// Every effect ends with writeOut(colour) instead of assigning fragColor.
//
// A bare ShaderMaterial writes to the framebuffer VERBATIM: three.js applies
// colorspace and tone mapping only via the <colorspace_fragment> /
// <tonemapping_fragment> chunks embedded in its built-in material shaders, and
// a user shader contains neither. So the default path below is faithful to
// fragcoord.xyz — what you author is what you see.
//
// But the prefix still *defines* linearToOutputTexel() and (when tone mapping
// is enabled) toneMapping(). Flipping USE_THREE_OUTPUT_TRANSFORM routes through
// them, which is what the effect will experience if it is dropped into a scene
// that has renderer tone mapping on, or rendered into a target that is later
// composited. Check your effect under BOTH before porting it.
void writeOut(vec3 c) {
#ifdef USE_THREE_OUTPUT_TRANSFORM
  #if defined( TONE_MAPPING )
    c = toneMapping(c);
  #endif
    fragColor = linearToOutputTexel(vec4(c, 1.0));
#else
    fragColor = vec4(c, 1.0);
#endif
}
