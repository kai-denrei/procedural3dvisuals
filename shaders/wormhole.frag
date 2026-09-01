#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// wormhole.frag — portal / tunnel-travel effect.
//
// Same four tricks as corona.frag, with three changes that turn a static ring
// into forward travel down a throat:
//
//  A. THE CAMERA MOVES. p.z is offset by uSpeed*time, so the field streams past
//     instead of the ring sitting still. Because the turbulence is a pure
//     function of position, translating the sample point makes the structure
//     flow coherently — you get motion parallax for free.
//
//  B. TWIST WITH DEPTH. p.xy is rotated by an angle proportional to p.z. This
//     is the single cheapest thing that reads as "wormhole" rather than "flying
//     down a pipe" — the walls shear past each other at different rates.
//
//  C. DEPTH-KEYED HUE. The cosine colour term is phase-shifted per channel and
//     by depth, so the throat runs a gradient from mouth to vanishing point
//     instead of one flat colour.
//
// The singularity trick is retained verbatim, measured against the *un-warped,
// un-twisted* sample so the throat edge stays a clean bright rim.
//
// uMinStep exists because the tunnel-wall distance goes to zero at the throat;
// without a floor the march stalls there and burns all its iterations in one
// spot, which shows up as a hard bright ring with no depth behind it.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uSteps;
uniform int   uTurbOctaves;
uniform float uTurbAmp;
uniform float uTurbFreq;
uniform float uStepScale;
uniform float uThroatRadius;
uniform float uColorBias;
uniform float uExposure;
uniform float uEpsilon;

uniform float uSpeed;        // forward travel rate
uniform float uTwist;        // radians of swirl per unit depth
uniform float uSpin;         // constant barrel roll
uniform float uHueSpread;    // per-channel cosine phase offset
uniform float uDepthHue;     // hue shift per unit depth
uniform float uMinStep;      // march step floor — prevents stalling at the wall
uniform float uNear;         // starting distance along the ray

void main() {
    vec3  rd  = rayDir(gl_FragCoord.xy);
    vec3  acc = vec3(0.0);
    float z   = uNear;
    float travel = T * uSpeed;

    for (int i = 0; i < uSteps; i++) {
        vec3 p = z * rd;
        p.z += travel;                                  // (A) fly forward

        p.xy = rot(p.z * uTwist + T * uSpin) * p.xy;    // (B) twist with depth

        vec3 unwarped = p;

        p = turbulence(p, z - T, uTurbOctaves, uTurbAmp, uTurbFreq);

        float wall = abs(uThroatRadius - length(p.xy));
        z += wall * uStepScale + uMinStep;

        float rim = max(abs(length(unwarped.xy) - uThroatRadius), uEpsilon);

        // (C) depth-keyed hue
        vec3 phase = p + vec3(0.0, 1.0, 2.0) * uHueSpread + unwarped.z * uDepthHue;
        acc += (uColorBias - cos(phase)) / (z * z) / rim;
    }

    writeOut(tanh(acc / uExposure));
}
