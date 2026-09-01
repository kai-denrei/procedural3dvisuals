#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// metal-grid-flow.frag
//
// ATTRIBUTION
//   Original      : "harsh" — https://www.shadertoy.com/view/dtKfDD
//   fragcoord port: koncreate (Kong) — https://fragcoord.xyz/s/gt8966nk
//                   titled "Metal Grid Flow (resized)"
//   This version  : parameterised and adapted to this sandbox's uniform
//                   contract. Structure and constants are unchanged.
//   See ATTRIBUTIONS.md.
//
// A different machine from corona/wormhole — no ray, no raymarch. Pure 2D
// domain distortion:
//
//   1. Build a GRID from sin(x)*cos(y), animated by z.
//   2. Build a radial WAVE from length(p), also animated by z.
//   3. Push the UV outward along p/l by wave*grid, then wrap with mod().
//   4. Push it again by a POLAR term whose frequency grows with radius —
//      this is what turns concentric rings into the swept, foil-like sheen.
//   5. Emission is 0.033 / distance-to-cell-centre. Same singularity family as
//      corona.frag: brightness explodes at the cell centres, which is where the
//      metallic glints come from.
//
// Each of the three colour channels is a separate iteration with z advanced by
// 0.05, so the channels sample the field at slightly different times. That
// time-offset-per-channel IS the iridescence — it is chromatic aberration in
// the time axis rather than the spatial one.
//
// NOTE ON THE ORIGINAL'S LOOP BOUND
//   The source loops `i < 4` while writing `c[i]` into a vec3. `c[3]` is out of
//   bounds — undefined behaviour, which drivers happen to discard. We keep the
//   4 iterations, because the 4th still advances `z` and sets `l`, and the
//   final `c / (l + 0.5)` divide uses that last `l`. Dropping to 3 iterations
//   would change the image. We simply guard the write instead.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uIterations;   // 4 — see note above
uniform float uZSpeed;       // 1.0  — time → z
uniform float uZStep;        // 0.05 — per-channel time offset (the iridescence)
uniform float uGridFreq;     // 30.0
uniform float uGridAmp;      // 0.65
uniform float uGridPhase;    // 25.0
uniform float uWaveFreq;     // 7.0
uniform float uWaveSpeed;    // 1.0
uniform float uPolarScale;   // 3.0  — polar frequency growth with radius
uniform float uBrightness;   // 0.033
// Split into two floats rather than a vec2 so each maps to exactly one schema
// entry in registry.mjs — the invariant that a slider cannot exist without its
// uniform, and vice versa.
uniform float uCenterX;      // 0.5
uniform float uCenterY;      // 1.0 — asymmetric on purpose; the origin sits
                             //   off-frame, which is why the sheen sweeps
                             //   rather than radiating from the middle.
uniform float uFalloff;      // 0.5  — the +0.5 in c / (l + 0.5)

void main() {
    vec2  fragCoord = gl_FragCoord.xy;
    vec3  c = vec3(0.0);
    float l = 1.0;
    float z = T * uZSpeed;

    for (int i = 0; i < uIterations; i++) {
        vec2 p  = fragCoord / uResolution.xy;
        vec2 uv = p;

        p.x *= uResolution.x / uResolution.y;   // aspect correction
        p   -= vec2(uCenterX, uCenterY);

        z += uZStep;
        l  = length(p);

        float grid = uGridAmp * sin(p.x * uGridFreq + z)
                              * cos(p.y * uGridFreq + z + uGridPhase);

        float wave = (sin(z) + 1.0) * abs(sin(l * uWaveFreq - z * uWaveSpeed));

        uv += (p / l) * wave * grid;
        uv  = mod(uv, 1.0);

        float angle  = atan(p.y, p.x);
        float radius = l * uPolarScale;
        uv += vec2(cos(angle * radius - z), sin(angle * radius - z)) * grid;

        // Guarded: vec3 has no c[3]. The 4th pass exists for its effect on z/l.
        if (i < 3) c[i] = uBrightness / length(mod(uv, 1.0) - 0.5);
    }

    writeOut(c / (l + uFalloff));
}
