#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// sdf-primitives.frag — a gallery of 3D SDF primitives, morphable and openable.
//
// LICENSING NOTE — this file is deliberately NOT a derivative of motion-cube.
// That effect is CC BY-NC-SA 4.0 (non-commercial, share-alike). This one is
// original work built on Inigo Quilez's published distance functions
// (https://iquilezles.org/articles/distfunctions/, MIT), with its own surface
// shading rather than MotionCube's volumetric holographic accumulation. So it
// carries no non-commercial restriction and can go into a commercial game.
// If you want the holographic look on these shapes, that IS a derivative and
// inherits the NC/SA terms.
//
// WHAT IT IS
//   12 primitives, a continuous MORPH between any two, and an "open" parameter
//   that separates the shape along its own axes — the generalisation of
//   MotionCube's unfold to shapes that have no net.
//
//   Morphing is a straight mix() of two distance FIELDS. That is not a true
//   SDF (the result can violate the Lipschitz bound mid-morph, so the march can
//   overshoot), which is why the step is damped by uStepScale. Blending fields
//   is the cheap way; the correct way is to march both and interpolate the
//   surfaces, at double the cost for a difference you cannot see here.
//
//   "Open" uses domain separation: push each octant outward along sign(p).
//   For a box that reads as an exploded net; for a sphere, as a cracked shell.
//   One parameter, twelve shapes, no per-shape animation to author — and it is
//   drivable from game state exactly like the jelly's melt.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uShapeA;
uniform int   uShapeB;
uniform float uMorph;        // 0 = A, 1 = B
uniform float uMorphAuto;    // 1 = cycle with time

uniform float uOpen;         // 0 sealed … 1 separated
uniform float uOpenAuto;

uniform float uScale;
uniform float uRound;        // radius subtracted from every primitive
uniform float uSpinX;
uniform float uSpinY;

uniform int   uSteps;
uniform float uStepScale;    // damping — a morphed field is not a true SDF
uniform float uFar;

uniform float uGlowAmount;
uniform float uGlowTight;
uniform float uRim;
uniform float uHueA;
uniform float uHueB;
uniform float uExposure;
uniform float uFov;
uniform float uCamDist;

// ── Inigo Quilez's distance functions (MIT) ─────────────────────────────────
float sdSphere   (vec3 p, float r)        { return length(p) - r; }
float sdBox      (vec3 p, vec3 b)         { vec3 q = abs(p) - b;
                                            return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdTorus    (vec3 p, vec2 t)         { vec2 q = vec2(length(p.xz) - t.x, p.y); return length(q) - t.y; }
float sdCapsule  (vec3 p, float h, float r) { p.y -= clamp(p.y, -h, h); return length(p) - r; }
float sdCylinder (vec3 p, float h, float r) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
                                            return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdCone     (vec3 p, float h, float r) { vec2 q = vec2(length(p.xz), p.y);
                                            vec2 t = normalize(vec2(h, r));
                                            float d1 = -q.y - h, d2 = max(dot(q, t), q.y - h);
                                            return length(max(vec2(d1, d2), 0.0)) + min(max(d1, d2), 0.0); }
float sdOctahedron(vec3 p, float s)       { p = abs(p); return (p.x + p.y + p.z - s) * 0.57735027; }
float sdHexPrism (vec3 p, vec2 h)         { const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
                                            p = abs(p);
                                            p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
                                            vec2 d = vec2(length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
                                                          p.z - h.y);
                                            return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdPyramid  (vec3 p, float h)        { float m2 = h * h + 0.25;
                                            p.xz = abs(p.xz);
                                            p.xz = (p.z > p.x) ? p.zx : p.xz;
                                            p.xz -= 0.5;
                                            vec3 q = vec3(p.z, h * p.y - 0.5 * p.x, h * p.x + 0.5 * p.y);
                                            float s = max(-q.x, 0.0);
                                            float t = clamp((q.y - 0.5 * p.z) / (m2 + 0.25), 0.0, 1.0);
                                            float A = m2 * (q.x + s) * (q.x + s) + q.y * q.y;
                                            float B = m2 * (q.x + 0.5 * t) * (q.x + 0.5 * t) + (q.y - m2 * t) * (q.y - m2 * t);
                                            float d2 = min(q.y, -q.x * m2 - q.y * 0.5) > 0.0 ? 0.0 : min(A, B);
                                            return sqrt((d2 + q.z * q.z) / m2) * sign(max(q.z, -p.y)); }
float sdTorus82  (vec3 p, vec2 t)         { vec2 q = vec2(length(p.xz) - t.x, p.y);
                                            return pow(pow(abs(q.x), 8.0) + pow(abs(q.y), 8.0), 0.125) - t.y; }
float sdLink     (vec3 p, float le, float r1, float r2) {
                                            vec3 q = vec3(p.x, max(abs(p.y) - le, 0.0), p.z);
                                            return length(vec2(length(q.xy) - r1, q.z)) - r2; }
float sdEllipsoid(vec3 p, vec3 r)         { float k0 = length(p / r), k1 = length(p / (r * r));
                                            return k0 * (k0 - 1.0) / k1; }

/** Dispatch. A switch keeps every branch uniform across the wavefront. */
float shape(int id, vec3 p) {
    if (id == 0)  return sdSphere(p, 1.0);
    if (id == 1)  return sdBox(p, vec3(0.8));
    if (id == 2)  return sdTorus(p, vec2(0.85, 0.32));
    if (id == 3)  return sdOctahedron(p, 1.15);
    if (id == 4)  return sdCapsule(p, 0.6, 0.5);
    if (id == 5)  return sdCylinder(p, 0.8, 0.7);
    if (id == 6)  return sdCone(p, 1.0, 0.85);
    if (id == 7)  return sdHexPrism(p, vec2(0.8, 0.55));
    if (id == 8)  return sdPyramid(p * 0.85, 1.1) / 0.85;
    if (id == 9)  return sdTorus82(p, vec2(0.85, 0.35));
    if (id == 10) return sdLink(p, 0.35, 0.65, 0.28);
    return sdEllipsoid(p, vec3(1.15, 0.75, 0.9));
}

float openAmount() {
    float osc = sin(T * 0.6) * 0.5 + 0.5;
    return clamp(mix(uOpen, osc, clamp(uOpenAuto, 0.0, 1.0)), 0.0, 1.0);
}
float morphAmount() {
    float osc = sin(T * 0.4) * 0.5 + 0.5;
    return clamp(mix(uMorph, osc, clamp(uMorphAuto, 0.0, 1.0)), 0.0, 1.0);
}

float map(vec3 p) {
    // Separate the octants. Pushing along sign(p) rather than a fixed axis is
    // what makes one parameter work for every shape: a box splits into its
    // corners, a torus into quarters, a sphere into a cracked shell.
    float o = openAmount();
    p -= sign(p) * o * 0.55 * uScale;

    p /= uScale;
    float a = shape(uShapeA, p);
    float b = shape(uShapeB, p);
    return (mix(a, b, morphAmount()) - uRound) * uScale;
}

vec3 normal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(map(p + e.xyy) - map(p - e.xyy),
                          map(p + e.yxy) - map(p - e.yxy),
                          map(p + e.yyx) - map(p - e.yyx)));
}

void main() {
    vec2 uv = (2.0 * gl_FragCoord.xy - uResolution.xy) / uResolution.y;

    vec3 ro = vec3(0.0, 0.0, -uCamDist);
    vec3 rd = normalize(vec3(uv, uFov));

    float ax = T * uSpinX, ay = T * uSpinY;
    ro.yz *= rot(ax); rd.yz *= rot(ax);
    ro.xz *= rot(ay); rd.xz *= rot(ay);

    float t = 0.0, glow = 0.0;
    bool hit = false;

    for (int i = 0; i < uSteps; i++) {
        vec3  p = ro + rd * t;
        float d = map(p);
        // Proximity glow: accumulate inverse distance every step, so the shape
        // carries an aura whose tightness is tunable. Costs nothing extra —
        // the distance is already computed for the march.
        glow += uGlowAmount / (1.0 + d * d * uGlowTight);
        if (d < 0.001) { hit = true; break; }
        if (t > uFar) break;
        t += d * uStepScale;          // damped: a morphed field is not a true SDF
    }

    vec3 col = vec3(0.0);
    vec3 hueA = 0.5 + 0.5 * cos(uHueA + vec3(0.0, 2.1, 4.2));
    vec3 hueB = 0.5 + 0.5 * cos(uHueB + vec3(0.0, 2.1, 4.2));

    if (hit) {
        vec3 p = ro + rd * t;
        vec3 n = normal(p);
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        float lam  = 0.5 + 0.5 * dot(n, normalize(vec3(0.6, 0.8, -0.4)));
        col  = mix(hueA, hueB, morphAmount()) * (0.25 + 0.75 * lam);
        col += hueB * fres * uRim;
    }
    col += mix(hueA, hueB, morphAmount()) * glow * 0.02;

    writeOut(tanh(col / uExposure * 3.0));
}
