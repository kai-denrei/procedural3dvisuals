#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// corona.frag — un-golfed replication of XorDev's "Coronal".
//
// Original (fragcoord.xyz dialect):
//     f z=2,d
//     @(40) {
//       f3 p = z * nor(2*C.rgb - R.xyy), t=p;
//       d=2; @(6) d+=d, p += sin(p.zxy*d+z-T) / d;
//       z += abs(1-len(p.xy))/3;
//       O += f4(1.1-cos(p),)/z/z/abs(len(t.xy)-1)
//     }
//     O = tanh(O / 30)
//
// How it actually works — four independent tricks stacked:
//
//  1. PSEUDO-RAYMARCH. z is distance along the ray. p = z*rd is the sample
//     point. There is no scene: the "geometry" is the unit cylinder x²+y²=1.
//
//  2. DOMAIN WARP drives the step. p is turbulence-warped BEFORE measuring
//     abs(1 - length(p.xy)), so the march advances through a distorted field.
//     This is what makes the plasma churn rather than sit still.
//
//  3. THE SINGULARITY — the load-bearing part. The emission is divided by
//     abs(length(t.xy) - 1) where t is the UN-warped sample. That term hits
//     zero exactly where the ray grazes the unit cylinder, so brightness goes
//     to infinity at the ring and falls off fast either side. Skip this and
//     you get a flat glow instead of a corona edge.
//
//     Note it is x/0, never 0/0: the numerator (uColorBias - cos(p)) has a
//     floor of uColorBias-1 = 0.1, so the worst case is +Inf, and tanh(+Inf)
//     saturates to 1. That is *why* the trick is safe. uEpsilon keeps it
//     strictly finite anyway — some drivers return NaN from tanh(Inf).
//
//  4. 1/z² FALLOFF + tanh TONEMAP. Inverse-square keeps distant samples from
//     washing out the frame; tanh is a cheap soft shoulder that never clips
//     hard, so the blown-out core stays white instead of going magenta.
//
// t (here: `unwarped`) is re-taken every iteration, NOT captured once — the
// ring term therefore sweeps outward with z rather than acting as a fixed
// screen-space mask. Getting this wrong yields a static vignette.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uSteps;        // 40  — march iterations
uniform int   uTurbOctaves;  //  6  — sine-fold octaves per step
uniform float uTurbAmp;      // 1.0 — warp strength
uniform float uTurbFreq;     // 2.0 — base frequency (doubles per octave)
uniform float uStepScale;    // 0.333 — march step damping
uniform float uRingRadius;   // 1.0 — cylinder radius
uniform float uColorBias;    // 1.1 — cosine colour offset
uniform float uExposure;     // 30.0 — tanh divisor
uniform float uEpsilon;      // 1e-4 — singularity clamp

void main() {
    vec3  rd  = rayDir(gl_FragCoord.xy);
    vec3  acc = vec3(0.0);
    float z   = 2.0;

    for (int i = 0; i < uSteps; i++) {
        vec3 p        = z * rd;
        vec3 unwarped = p;                 // `t` in the original

        p = turbulence(p, z - T, uTurbOctaves, uTurbAmp, uTurbFreq);

        z += abs(uRingRadius - length(p.xy)) * uStepScale;

        float ring = max(abs(length(unwarped.xy) - uRingRadius), uEpsilon);
        acc += (uColorBias - cos(p)) / (z * z) / ring;
    }

    writeOut(tanh(acc / uExposure));
}
