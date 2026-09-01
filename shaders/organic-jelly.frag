#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// organic-jelly.frag — translucent specimens: amoeba, adenovirus, jellyfish,
// bacteriophage.
//
// Variations on melting-jelly's LOOK — refraction, Beer's law absorption,
// Fresnel rim — applied to organic bodies instead of melting cubes. The shading
// is a fresh implementation of standard translucent-raymarch technique
// (march the negated distance to exit the surface; attenuate by path length);
// the shapes are original, following the specimen set in Braille Lab's
// fun-shapes catalogue. See ATTRIBUTIONS.md.
//
// The background is a graticule — a microscope reticle. Refraction needs
// something with structure behind the body or there is nothing to bend, and a
// measuring grid is what you would actually be looking through.
//
// ── WHY THESE ARE INTERESTING TO BUILD ──────────────────────────────────────
// Each specimen needs a different symmetry trick, and picking the right one is
// most of the work:
//
//   amoeba        NO symmetry. A sphere plus smooth-min'd pseudopods whose
//                 directions are animated. Irregularity IS the shape, so the
//                 body must not be foldable.
//   adenovirus    ICOSAHEDRAL. Three mirror planes with golden-ratio normals
//                 fold all 60 symmetry copies into one, so 12 spikes cost one
//                 capsule evaluation.
//   jellyfish     ROTATIONAL. A bell of revolution, plus polar-folded tentacles
//                 with a phase delay down their length so they trail rather
//                 than swing rigidly.
//   bacteriophage | MIXED. Icosahedral head, a body of revolution for the
//                 sheath, and 6-fold polar legs. Three symmetries in one body.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uSpecies;      // 0 amoeba · 1 adenovirus · 2 jellyfish · 3 phage

uniform float uPulse;        // life animation amount
uniform float uPulseAuto;
uniform float uSpeed;
uniform float uMelt;         // 0 intact … 1 slumped (kept from melting-jelly)

uniform float uScale;
uniform float uIOR;
uniform float uAbsorb;
uniform float uFresnelPow;
uniform float uReflect;
uniform float uInnerGlow;    // nucleus / core luminance seen through the body

uniform int   uSteps;
uniform int   uRefractSteps;
uniform float uStepScale;
uniform float uFar;

uniform float uHue;
uniform float uHueSpread;
uniform float uExposure;
uniform float uGrid;         // graticule strength
uniform float uGridScale;
uniform float uSpinY;
uniform float uCamDist;
uniform float uFov;

const float PHI = 1.61803399;

// ── primitives ──────────────────────────────────────────────────────────────
float sdSph(vec3 p, float r) { return length(p) - r; }
float sdCap(vec3 p, vec3 a, vec3 b, float r) {          // capsule
    vec3 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - r;
}
float sdCyl(vec3 p, float h, float r) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

/** Icosahedral symmetry fold: 60 copies collapse to one wedge. */
vec3 icoFold(vec3 p) {
    const vec3 n1 = vec3(0.0, 0.52573111, 0.85065081);   // (0, 1, φ) normalised
    const vec3 n2 = vec3(0.85065081, 0.0, 0.52573111);
    const vec3 n3 = vec3(0.52573111, 0.85065081, 0.0);
    p = abs(p);
    p -= 2.0 * min(0.0, dot(p, n1)) * n1;
    p -= 2.0 * min(0.0, dot(p, n2)) * n2;
    p -= 2.0 * min(0.0, dot(p, n3)) * n3;
    return p;
}

/** n-fold rotational fold about the Y axis. */
vec3 polarY(vec3 p, float n) {
    float seg = TAU / n;
    float a = atan(p.z, p.x);
    a = mod(a + seg * 0.5, seg) - seg * 0.5;
    float r = length(p.xz);
    return vec3(r * cos(a), p.y, r * sin(a));
}

float life() {
    float osc = sin(T * uSpeed) * 0.5 + 0.5;
    return clamp(mix(uPulse, osc, clamp(uPulseAuto, 0.0, 1.0)), 0.0, 1.0);
}

// `core` reports how deep inside a lit inner structure the sample is — the
// nucleus, the capsid's DNA, the bell's gonads. It is what makes a translucent
// body read as ALIVE rather than as a glass ornament.
float core;

// ── specimens ───────────────────────────────────────────────────────────────

float amoeba(vec3 p, float t) {
    // Irregular by construction: three pseudopods on independent slow orbits,
    // smooth-min'd into a body that is itself lumpy.
    float d = sdSph(p, 0.85 + 0.05 * sin(t * 1.3));
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float a = t * (0.4 + fi * 0.17) + fi * 2.1;
        float b = t * (0.3 - fi * 0.11) + fi * 1.3;
        vec3 dir = normalize(vec3(cos(a) * cos(b), sin(b), sin(a) * cos(b)));
        float reach = 1.15 + 0.45 * sin(t * 0.9 + fi * 2.0);
        d = smin(d, sdCap(p, vec3(0.0), dir * reach, 0.30 - 0.06 * fi), 0.42);
    }
    // Surface lumpiness — low frequency so it reads as cytoplasm, not noise.
    d += 0.055 * sin(p.x * 4.1 + t) * sin(p.y * 3.7 - t * 0.8) * sin(p.z * 4.4 + t * 0.6);
    core = sdSph(p - vec3(0.22 * sin(t * 0.7), 0.1, 0.15 * cos(t * 0.5)), 0.26);
    return d;
}

float adenovirus(vec3 p, float t) {
    vec3 q = icoFold(p);
    // Capsid: a sphere trimmed by the folded plane gives flat facets.
    float capsid = max(sdSph(p, 0.78), dot(q, normalize(vec3(0.5, 0.9, 0.2))) - 0.70);
    // One spike, replicated 12x by the fold. Knob on the end — the fibre and
    // its penton base, which is what an adenovirus is recognised by.
    vec3 axis = normalize(vec3(0.0, 0.52573111, 0.85065081));
    float len = 0.55 + 0.10 * life();
    float spike = sdCap(q, axis * 0.72, axis * (0.72 + len), 0.035);
    float knob  = sdSph(q - axis * (0.72 + len), 0.085);
    core = sdSph(p, 0.42);                       // packed genome
    return min(capsid, min(spike, knob));
}

float jellyfish(vec3 p, float t) {
    float pulse = life();
    // Bell: a squashed sphere, hollowed from below. The squash IS the pulse —
    // contracting vertically while widening is what swimming looks like.
    float sq = mix(0.62, 0.82, pulse);
    vec3 b = p; b.y /= sq;
    float bell = sdSph(b, 0.9) * sq;
    bell = max(bell, -sdSph(vec3(p.x, p.y + 0.55 * sq, p.z), 0.78 * sq));  // hollow
    bell = max(bell, -p.y - 0.30);                                          // open rim
    bell = abs(bell) - 0.035;                                               // thin shell

    // Tentacles: polar-folded, with the wave PHASE DELAYED down their length so
    // the tip follows the base. Without the delay they swing like rigid rods.
    vec3 q = polarY(p, 8.0);
    float y = clamp(-p.y, 0.0, 2.4);
    float lag = y * 1.6;
    float sway = 0.16 * sin(t * 1.6 - lag) * y;
    vec3 tq = vec3(q.x - 0.62 - sway - 0.1 * pulse, q.y, q.z);
    float tent = sdCap(tq, vec3(0.0, -0.28, 0.0), vec3(0.10, -2.3, 0.0), 0.045);

    // Oral arms: four shorter, thicker frills inside the tentacle ring.
    vec3 r = polarY(p, 4.0);
    float arm = sdCap(vec3(r.x - 0.20 - 0.05 * sin(t * 1.2), r.y, r.z),
                      vec3(0.0, -0.3, 0.0), vec3(0.22, -1.3, 0.0), 0.075);

    core = sdSph(p - vec3(0.0, 0.12, 0.0), 0.34);   // gonads glowing in the bell
    return min(bell, min(tent, arm));
}

float bacteriophage(vec3 p, float t) {
    float contract = life();
    // Head: icosahedral capsid, same fold as the adenovirus.
    vec3 head = p - vec3(0.0, 0.95, 0.0);
    vec3 hq = icoFold(head);
    float capsid = max(sdSph(head, 0.52), dot(hq, normalize(vec3(0.5, 0.9, 0.2))) - 0.47);

    // Sheath: contracts and fattens when it fires — the actual injection motion.
    float sh = mix(0.42, 0.28, contract);
    float rad = mix(0.10, 0.145, contract);
    float sheath = sdCyl(p - vec3(0.0, 0.35, 0.0), sh, rad);
    float core_tube = sdCyl(p - vec3(0.0, 0.30, 0.0), 0.52, 0.045);   // inner tube
    float plate = sdCyl(p - vec3(0.0, -0.10, 0.0), 0.035, 0.20);      // baseplate

    // Six legs, polar-folded, kinked at the knee and splaying as it lands.
    vec3 q = polarY(p - vec3(0.0, -0.12, 0.0), 6.0);
    float splay = mix(0.30, 0.52, contract);
    vec3 knee = vec3(splay, -0.28, 0.0);
    float legA = sdCap(q, vec3(0.16, 0.0, 0.0), knee, 0.032);
    float legB = sdCap(q, knee, vec3(splay + 0.22, -0.62, 0.0), 0.028);

    core = sdSph(head, 0.30);                                          // genome
    return min(min(capsid, sheath), min(min(core_tube, plate), min(legA, legB)));
}

float map(vec3 p) {
    float t = T * uSpeed;
    p /= uScale;

    // Melt, carried over from melting-jelly: slump toward the floor plane.
    float m = clamp(uMelt, 0.0, 1.0);
    p.y = mix(p.y, p.y * (1.0 + m * 3.0) + m * 0.9, m);

    float d;
    if      (uSpecies == 0) d = amoeba(p, t);
    else if (uSpecies == 1) d = adenovirus(p, t);
    else if (uSpecies == 2) d = jellyfish(p, t);
    else                    d = bacteriophage(p, t);
    return d * uScale;
}

vec3 normal(vec3 p) {
    vec2 e = vec2(0.0015, 0.0);
    return normalize(vec3(map(p + e.xyy) - map(p - e.xyy),
                          map(p + e.yxy) - map(p - e.yxy),
                          map(p + e.yyx) - map(p - e.yyx)));
}

/**
 * Microscope graticule. Refraction needs structure behind the specimen or
 * there is nothing to bend.
 *
 * Mapped SPHERICALLY, not by a planar divide. `rd.xy / rd.z` blows up wherever
 * the ray turns parallel to the screen, which draws a hard seam and a fan of
 * radiating lines right where the refracted rays go — exactly the directions
 * this function exists to serve. Angles have no such singularity.
 *
 * The grid also fades toward the edges: it is scenery for the specimen, and a
 * bright lattice across the whole frame competes with the thing being looked at.
 */
vec3 background(vec3 rd) {
    float u = atan(rd.x, rd.z) / TAU;
    float v = asin(clamp(rd.y, -1.0, 1.0)) / PI;
    vec2 g = vec2(u, v) * uGridScale * 8.0;

    vec2 fine  = abs(fract(g) - 0.5);
    vec2 major = abs(fract(g * 0.25) - 0.5);
    // abs(fract(x) - 0.5) is 0.5 AT a cell boundary and 0 in the middle, so the
    // edge is the HIGH value. Ordering these the other way fills every cell and
    // leaves thin dark lines — a bright field instead of a dark one with a grid.
    float lf = smoothstep(0.47, 0.50, max(fine.x, fine.y));
    float lm = smoothstep(0.44, 0.50, max(major.x, major.y));

    // Centre-weighted: the refracted rays that matter leave through the middle
    // of the frame, so put the contrast there and let the edges fall away
    // rather than lighting the whole field.
    float fade = smoothstep(1.25, 0.10, length(rd.xy));
    vec3  base = vec3(0.006, 0.009, 0.014);
    return base + (lf * 0.30 + lm * 0.62) * uGrid * fade * vec3(0.16, 0.40, 0.46);
}

void main() {
    vec2 uv = (2.0 * gl_FragCoord.xy - uResolution.xy) / uResolution.y;
    float t = T * uSpeed;

    vec3 ro = vec3(0.0, 0.0, -uCamDist);
    vec3 rd = normalize(vec3(uv, uFov));
    float ay = T * uSpinY;
    ro.xz *= rot(ay); rd.xz *= rot(ay);
    // Hover: the whole specimen bobs, which is what sells "suspended in fluid".
    float bob = 0.12 * sin(t * 0.8);
    ro.y -= bob;

    float z = 0.0;
    bool hit = false;
    for (int i = 0; i < uSteps; i++) {
        vec3 p = ro + rd * z;
        float d = map(p);
        if (d < 0.0015) { hit = true; break; }
        if (z > uFar) break;
        z += d * uStepScale;
    }

    vec3 hue  = 0.5 + 0.5 * cos(uHue + vec3(0.0, 2.1, 4.2));
    vec3 hue2 = 0.5 + 0.5 * cos(uHue + uHueSpread + vec3(0.0, 2.1, 4.2));
    vec3 col;

    if (!hit) {
        col = background(rd);
    } else {
        vec3 p = ro + rd * z;
        vec3 n = normal(p);
        float fres = mix(0.05, 1.0, pow(1.0 - max(dot(n, -rd), 0.0), uFresnelPow));

        // Refract INTO the body and march the negated field until we exit.
        vec3 refDir = refract(rd, n, 1.0 / max(uIOR, 1.001));
        float tIn = 0.02;
        for (int i = 0; i < uRefractSteps; i++) {
            float d = -map(p + refDir * tIn);
            if (d < 0.002 || tIn > 6.0) break;
            tIn += max(0.012, d);
        }
        vec3 exitP = p + refDir * tIn;

        // Beer's law: path length decides saturation. This is what separates
        // "translucent flesh" from "tinted glass".
        vec3 absorbed = exp(-tIn * (vec3(1.0) - hue) * uAbsorb);
        vec3 refr = background(refDir) * absorbed;

        // Inner structure glows through, brightest where the path crosses it.
        float coreDepth = smoothstep(0.35, -0.15, core);
        refr += hue2 * coreDepth * uInnerGlow * (0.35 + 0.65 * tIn);

        vec3 refl = background(reflect(rd, n));
        col = mix(refr, refl, fres * uReflect);
        col += hue * 0.06;
    }

    col *= 1.0 - 0.45 * smoothstep(0.35, 1.35, length(uv));   // vignette
    writeOut(tanh(col / uExposure * 2.2));
}
