#include "common.glsl"
// SPDX-License-Identifier: CC-BY-NC-SA-4.0
// Copyright (c) 2026 @Jaenam
// [LICENSE] https://creativecommons.org/licenses/by-nc-sa/4.0/
// ─────────────────────────────────────────────────────────────────────────────
// motion-cube.frag — "MotionCube" by Jaenam, replicated.
//
//   Original: Jaenam (Jae) — https://fragcoord.xyz/s/mr7xc988 — 2026-05-12
//   This file is a DERIVATIVE WORK and inherits CC BY-NC-SA 4.0:
//     BY  attribution required (kept above and in ATTRIBUTIONS.md)
//     NC  NON-COMMERCIAL USE ONLY
//     SA  derivatives must carry this same licence
//   This is the only effect here with a stated licence. See ATTRIBUTIONS.md
//   before reusing it anywhere that might earn money.
//
// WHAT IT DOES — a cube that unfolds into its own net, rendered volumetrically.
//
//  1. cube_unfold(p, a) is six BOXES, not one. Each face is a thin slab, and
//     each is hinged: translate the hinge to the origin, rotate by `a`, put it
//     back. At a = 0 the six slabs coincide with the faces of a cube; at
//     a = π/2 they lie flat as a cross-shaped net. The "opening" is entirely
//     that one angle.
//
//     The left/right faces share one slab via `abs(p.x)` — mirroring the domain
//     is cheaper than evaluating two SDFs, and the X sign is restored afterwards
//     so the texture does not mirror with the geometry.
//
//  2. `texPos` is a global written by whichever face won the min(). It carries
//     the FACE-LOCAL coordinate out of the SDF, so the holographic pattern
//     travels with a face as it swings instead of sliding across it. That is
//     the trick that makes the unfold read as printed panels rather than a
//     shape moving through a fixed field.
//
//  3. The march is volumetric, not a surface hit. The step is a blend of the
//     cube distance and a texture-derived term, so the ray keeps accumulating
//     colour through a soft shell. `tanh(c*c/1e7)` at the end is the tonemap.
//
//  4. The turbulence loop (`tex += (abs(mod(...)-.5)*4.-1.)*1.57/n`) is a
//     triangle-wave fold rather than a sine — cheaper, and it gives the harder
//     creased look the hologram has.
//
// ADDED HERE: uOpenAuto / uOpen. The original drives `a` from sin(time). With
// Auto off, the fold angle becomes an input — so the opening can be driven by
// game state (a chest, a portal, a boss shell) instead of a clock.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uSteps;
uniform float uOpenAuto;     // 1 = oscillate with time, 0 = use uOpen
uniform float uOpen;         // 0 closed cube … 1 flat net
uniform float uSpeed;
uniform float uSpin;         // tumble amount
uniform float uZoom;
uniform float uSize;         // face half-extent (sz)
uniform float uThick;        // face thickness (th)
uniform float uTexScale;
uniform float uHoloDensity;
uniform float uHoloAmount;
uniform int   uTurbOctaves;
uniform float uGlow;
uniform float uExposure;
uniform float uFov;

#define R2(a) mat2(cos(a), sin(a), -sin(a), cos(a))
#define BOX(p, b) length(max(abs(p) - (b), 0.0))

// Integer hash — bit-mixing on the float bits. Cheaper and higher quality than
// the usual sin(dot(..)) trick, and GLSL ES 3.00 gives us floatBitsToUint.
uvec3 hash3u(uvec3 s) {
    s = s * 1145141919u + 1919810u;
    s.x += s.y * s.z; s.y += s.z * s.x; s.z += s.x * s.y;
    s ^= s >> 16;
    s.x += s.y * s.z; s.y += s.z * s.x; s.z += s.x * s.y;
    return s;
}
// Two adaptations in this one line:
//  - the original writes `float(-1u)` for "largest uint, as float"; unary
//    minus on a uint literal is not valid GLSL ES 3.00 — fragcoord's toolchain
//    accepts it, ANGLE does not. Same value, spelled legally.
//  - the parameter was named `f`, and common.glsl defines `f` as an alias for
//    `float` (the fragcoord dialect). The preprocessor turned `vec3 f` into
//    `vec3 float`. Renamed. Any shader pasted in from that dialect must avoid
//    `f`, `len` and `nor` as identifiers.
vec3 hash3f(vec3 v) { return vec3(hash3u(floatBitsToUint(v))) / float(0xffffffffu); }

vec3 texPos;   // face-local coordinate of the winning face — see note 2

float cube_unfold(vec3 p, float a) {
    p.yz *= R2(0.2 * PI);      // isometric framing
    p.xz *= R2(-0.25 * PI);

    float d = 1e9, sz = uSize, th = uThick;
    float sx = sign(p.x);
    vec3 q; float fd;

    // Bottom — the hinge everything else swings from.
    fd = BOX(p - vec3(0, -sz, 0), vec3(sz, th, sz));
    if (fd < d) { d = fd; texPos = p; }

    // Top — two hinges: it unfolds off the back, which itself unfolds.
    q = p;
    q.y += sz; q.z += sz;  q.yz *= R2(-a);  q.y -= sz; q.z -= sz;
    q.y -= sz; q.z += sz;  q.yz *= R2(-a);  q.y += sz; q.z -= sz;
    fd = BOX(q - vec3(0, sz, 0), vec3(sz, th, sz));
    if (fd < d) { d = fd; texPos = q; }

    // Front
    q = p;
    q.y += sz; q.z += sz;  q.yz *= R2(-a);  q.y -= sz; q.z -= sz;
    fd = BOX(q - vec3(0, 0, -sz), vec3(sz, sz, th));
    if (fd < d) { d = fd; texPos = q; }

    // Back
    q = p;
    q.y += sz; q.z -= sz;  q.yz *= R2(a);   q.y -= sz; q.z += sz;
    fd = BOX(q - vec3(0, 0, sz), vec3(sz, sz, th));
    if (fd < d) { d = fd; texPos = q; }

    // Left + right share one evaluation via a mirrored domain.
    q = vec3(abs(p.x), p.yz);
    q.y += sz; q.x -= sz;  q.xy *= R2(-a);  q.y -= sz; q.x += sz;
    fd = BOX(q - vec3(sz, 0, 0), vec3(th, sz, sz));
    if (fd < d) { d = fd; texPos = vec3(sx * q.x, q.yz); }   // restore X sign

    return d;
}

void main() {
    vec2  I = gl_FragCoord.xy;
    float t = T * uSpeed;

    float e = sin(t) * 0.5;
    // Fold angle: driven by time, or handed over to uOpen.
    float aAuto = clamp(e, 0.0, 1.0) * 1.57;
    float a = mix(clamp(uOpen, 0.0, 1.0) * 1.57, aAuto, clamp(uOpenAuto, 0.0, 1.0));

    mat2 Rx = R2(sin(t - PI / 2.0) * uSpin);
    mat2 Ry = R2(sin(t + PI / 2.0) * uSpin);

    vec3  col = vec3(0.0);
    float d = 0.0, s = 0.0;

    for (int i = 1; i <= uSteps; i++) {
        float fi = float(i);
        vec2  uv = (I + I - uResolution.xy) / uResolution.y;
        float fl = 20.0;

        vec3 ro = vec3(0, 0, 9.5 * fl);
        vec3 rd = normalize(vec3(uv * uFov, -fl));
        vec3 p  = ro + rd * d;

        p.xy *= Rx;
        p.yz *= Ry;

        float z    = -tanh(e * 8.0 - fi * 0.005);
        float zoom = uZoom + 0.3 * z;
        p *= zoom;

        float cube = cube_unfold(p, a);
        vec3  tex  = texPos * uTexScale;

        // Holographic cells: a hash per lattice cell decides a ring radius and
        // a hue phase, so the surface reads as printed foil rather than noise.
        vec3  g   = floor(tex * uHoloDensity);
        vec3  cel = fract(tex * uHoloDensity) - 0.5;
        vec3  rnd = hash3f(g);
        float ang = rnd.y * TAU;
        float h   = smoothstep(0.08, 0.0, abs(length(cel) - (rnd.x * 0.3 + 0.1)));

        // Triangle-wave fold turbulence — harder-edged than a sine fold.
        for (int n = 1; n <= uTurbOctaves; n++) {
            float fn = float(n);
            tex += (abs(mod(tex.zyx * fn / TAU + 0.75, 1.0) - 0.5) * 4.0 - 1.0) * 1.57 / fn;
        }

        s  = (0.005 + 0.1 * abs(dot(abs(fract(tex) - 0.5), vec3(0.6)) - cube * 2.0 - fi / 300.0)) / zoom;
        d += s;

        if (d > 3e2 || s < 1e-4) break;

        float sf = smoothstep(0.02, 0.01, s);
        col += ((0.5 + 0.5 * sin(fi * 0.3 + vec3(-1.0, 0.0, 1.0) * 5.0)) / s
             + sf * uHoloAmount * h * (0.5 + 0.5 * sin(ang + fi * 0.1 + vec3(1, 2, 3))) / s) / zoom;
    }

    col *= uGlow;
    writeOut(tanh(col * col / uExposure));
}
