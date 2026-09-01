#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// motion-solids.frag — polyhedra that unfold into their nets.
//
// PROVENANCE. Inspired by Jaenam's "MotionCube" (CC BY-NC-SA 4.0), but this is
// an INDEPENDENT implementation: different construction (polar-folded domain
// instead of six hand-placed slabs), different face SDFs, different shading. No
// code is derived from it. Unfolding a polyhedron into its net is classical
// geometry, not anyone's intellectual property — only a particular expression of
// it can be. This file therefore carries no non-commercial restriction and can
// ship in a commercial project. See ATTRIBUTIONS.md.
//
// ── THE IDEA ────────────────────────────────────────────────────────────────
// Every solid here is a BOWL: one base polygon, plus n identical faces hinged
// along the base's edges. Fold the flaps up and the bowl closes into a solid;
// fold them flat and you have its net.
//
// The trick that keeps this cheap is a POLAR DOMAIN FOLD. Rather than placing n
// faces and evaluating n SDFs, wedge the space into n identical sectors and
// evaluate ONE face:
//
//     a = atan(p.y, p.x)  →  a = mod(a + seg/2, seg) - seg/2
//
// So a dodecahedron's five side faces cost the same as one. The same reason
// MotionCube mirrors its left/right faces through abs(p.x) — one evaluation,
// n faces — generalised from a mirror to an n-fold rotation.
//
// A face is a regular m-gon extruded to a slab. Placing its centre at
// (apothem_base + apothem_face) puts one of its EDGES exactly on the hinge line,
// which is what makes flaps meet edge-to-edge when closed.
//
// ── WHAT EACH SOLID IS ──────────────────────────────────────────────────────
//   tetrahedron   3 triangles around a triangle
//   pyramid       4 triangles around a square      ← "Motion Pyramid"
//   cube          4 squares around a square, + a lid
//   octahedron    two 4-triangle bowls, base to base (a square bipyramid)
//   dodecahedron  two 5-pentagon bowls, twisted 36° ← "Motion Dodecahedron"
//   hex prism     6 squares around a hexagon, + a lid
//
// Fold angles are the SUPPLEMENT of each solid's dihedral angle, because a flap
// rotates from flat (0) to its closed position (π − dihedral):
//   tetra 109.47° · cube 90° · octa 70.53° · dodeca 63.43°
//
// ── FACE-LOCAL TEXTURING ────────────────────────────────────────────────────
// `facePos` carries the winning face's LOCAL coordinate out of the SDF, so the
// panel pattern travels with a flap as it swings instead of the flap sliding
// through a world-space field. (Standard SDF practice — the same way material
// IDs and UVs are usually returned — and the thing that sells the unfold.)
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uSolid;        // 0..5
uniform float uOpen;         // 0 closed … 1 flat net
uniform float uOpenAuto;
uniform float uSpeed;

uniform float uSize;
uniform float uThick;
uniform float uRound;

uniform int   uSteps;
uniform float uStepScale;
uniform float uFar;

uniform float uPanel;        // panel line strength
uniform float uPanelScale;
uniform float uGlowAmount;
uniform float uGlowTight;
uniform float uRim;
uniform float uHueA;
uniform float uHueB;
uniform float uExposure;
uniform float uSpinX;
uniform float uSpinY;
uniform float uFov;
uniform float uCamDist;
uniform float uCupGap;   // dodecahedron: vertical offset between the two cups

vec3 facePos;                // face-local coordinate of the winning face

// ── helpers ─────────────────────────────────────────────────────────────────

/** Convex regular m-gon as an intersection of half-planes. One edge faces +x. */
float sdNgon2(vec2 p, float apothem, int m) {
    float d = -1e9;
    for (int i = 0; i < m; i++) {
        float a = TAU * float(i) / float(m);
        d = max(d, dot(p, vec2(cos(a), sin(a))) - apothem);
    }
    return d;
}

/** That polygon, extruded along z into a slab of half-thickness th. */
float slab(vec3 q, float apothem, int m, float th) {
    float d2 = sdNgon2(q.xy, apothem, m);
    float dz = abs(q.z) - th;
    return min(max(d2, dz), 0.0) + length(max(vec2(d2, dz), 0.0));
}

/**
 * Same, but with an EDGE facing -x instead of +x.
 *
 * This matters only for odd-sided faces, and it is the difference between a net
 * that closes and one that does not. sdNgon2 puts a flat edge at +x, which for
 * an even polygon also puts one at -x — so a square flap hinged on its -x side
 * works by accident. A TRIANGLE has a vertex opposite its +x edge, so hinging it
 * the same way attaches the flap by a corner and the solid never seals.
 * Negating the point mirrors the normals, putting the edge where the hinge is.
 */
float slabHinged(vec3 q, float apothem, int m, float th) {
    float d2 = sdNgon2(-q.xy, apothem, m);
    float dz = abs(q.z) - th;
    return min(max(d2, dz), 0.0) + length(max(vec2(d2, dz), 0.0));
}

/**
 * Flap apothem that makes the flap's hinge edge exactly as long as the base
 * edge it attaches to.
 *
 *   edge of a regular k-gon with apothem a  =  2 a tan(pi/k)
 *   so  fa tan(pi/m) = ba tan(pi/n)
 *
 * Get this wrong and the flaps are the wrong width: they either overlap or
 * leave gaps, and no fold angle can rescue it.
 */
float flapApothem(float ba, int n, int m) {
    return ba * tan(PI / float(n)) / tan(PI / float(m));
}

/** Wedge space into n identical sectors — n faces for the price of one. */
vec3 polarFold(vec3 p, int n) {
    float seg = TAU / float(n);
    float a = atan(p.y, p.x);
    a = mod(a + seg * 0.5, seg) - seg * 0.5;
    float r = length(p.xy);
    return vec3(r * cos(a), r * sin(a), p.z);
}

/**
 * One bowl: a base n-gon of apothem `ba`, plus n hinged m-gon flaps, folded by
 * `ang` (0 = flat net, the solid's dihedral supplement = closed).
 * `lidToo` chains a lid off flap 0's far edge — the two-hinge chain a box lid
 * needs, since the lid rides on a face that is itself swinging.
 * `withBase` off omits the base polygon (see the octahedron).
 */
float bowl(vec3 p, int n, float ba, int m, float ang, float th, bool lidToo, bool withBase) {
    float fa = flapApothem(ba, n, m);

    // A bipyramid (octahedron) is built from two bowls sharing an equator, and
    // that equator is a construction line, not a face. Drawing it leaves a disc
    // wedged through the middle of the solid.
    float d = withBase ? slab(p, ba, n, th) : 1e9;
    facePos = p;

    // ── flaps: one evaluation, n faces ──────────────────────────────────────
    vec3 q = polarFold(p, n);
    vec3 h = q - vec3(ba, 0.0, 0.0);           // origin on the hinge line
    h.xz = rot(-ang) * h.xz;                   // swing the domain
    vec3 fl = h - vec3(fa, 0.0, 0.0);          // flap centre
    float df = slabHinged(fl, fa, m, th);
    if (df < d) { d = df; facePos = fl; }

    // ── lid, chained off the far edge of flap 0 ─────────────────────────────
    if (lidToo) {
        vec3 l = p - vec3(ba, 0.0, 0.0);       // not polar-folded: only one lid
        l.xz = rot(-ang) * l.xz;
        l -= vec3(2.0 * fa, 0.0, 0.0);         // to that flap's outer edge
        l.xz = rot(-ang) * l.xz;               // second hinge
        l -= vec3(ba, 0.0, 0.0);
        float dl = slabHinged(l, ba, n, th);
        if (dl < d) { d = dl; facePos = l; }
    }
    return d;
}

// Dihedral supplements — how far a flap swings from flat to closed.
const float FOLD_TETRA  = 1.91063324;   // π − 70.529°
const float FOLD_CUBE   = 1.57079633;   // π − 90°
const float FOLD_OCTA   = 1.23095942;   // π − 109.471°
const float FOLD_DODECA = 1.10714872;   // π − 116.565°

// The octahedron is a square BIPYRAMID, and the number that matters is how far
// a flap ROTATES FROM FLAT — not the angle the finished face makes with the
// equator. Those differ, and using the latter (54.74°) leaves the apexes
// splayed outward in a four-pointed star with a hole in the middle.
//
// Solve for the apex landing on the axis. A triangular flap of apothem fa has
// its hinge edge at fa on one side and the opposite VERTEX at 2·fa on the other,
// so the apex sits 3·fa along the face from the hinge:
//     ba + 3·fa·cos(φ) = 0,  with fa = ba·tan(45°)/tan(60°) = ba/√3
//     cos(φ) = −1/√3  →  φ = 125.264°
// Sanity check: apex height = 3·fa·sin(φ) = 1.414·ba = e/√2. Correct.
// This is the same angle as the square pyramid below, which is no coincidence —
// a square pyramid with equilateral faces IS half an octahedron.
const float FOLD_OCTA_EQ = 2.18627604;

// Dodecahedron cup lift — the distance between the two base pentagons, which is
// simply the solid's face-to-face height.
//     apothem ba of a pentagon of edge e  =  e / (2 tan 36°)  =  0.6882·e
//     face-to-face height of a dodecahedron =  2.227·e
//     → height = 2.227 / 0.6882 · ba = 3.236·ba, so each cup lifts half that.
// 1.618 is the golden ratio, which is what a dodecahedron is made of.
const float DODECA_LIFT = 1.61803399;

float map(vec3 p) {
    float t  = clamp(uOpen, 0.0, 1.0);
    float osc = sin(T * uSpeed) * 0.5 + 0.5;
    float open = clamp(mix(t, osc, clamp(uOpenAuto, 0.0, 1.0)), 0.0, 1.0);

    float s  = uSize;
    float th = uThick * s;
    float d;

    if (uSolid == 0) {                          // tetrahedron
        float fold = mix(FOLD_TETRA, 0.0, open);
        d = bowl(p - vec3(0, 0, -s * 0.2), 3, s * 0.42, 3, fold, th, false, true);

    } else if (uSolid == 1) {                   // square pyramid — Motion Pyramid
        // Equilateral flaps on a square base: a Johnson solid J1. Its dihedral
        // to the base is 54.74°, so the flaps swing 125.26°.
        float fold = mix(2.18627604, 0.0, open);
        d = bowl(p - vec3(0, 0, -s * 0.25), 4, s * 0.5, 3, fold, th, false, true);

    } else if (uSolid == 2) {                   // cube
        float fold = mix(FOLD_CUBE, 0.0, open);
        d = bowl(p - vec3(0, 0, -s * 0.5), 4, s * 0.5, 4, fold, th, true, true);

    } else if (uSolid == 3) {                   // octahedron = square bipyramid
        float fold = mix(FOLD_OCTA_EQ, 0.0, open);
        float ba = s * 0.45;
        vec3 a = p, b = vec3(p.xy, -p.z);       // second bowl mirrored in z
        float da = bowl(a, 4, ba, 3, fold, th, false, false);   // no equator face
        vec3 keepA = facePos;
        float db = bowl(b, 4, ba, 3, fold, th, false, false);
        if (da < db) { d = da; facePos = keepA; } else { d = db; }

    } else if (uSolid == 4) {                   // dodecahedron
        // Two 6-face cups (pentagon + 5 pentagons), twisted 36° against each
        // other so their rims interlock. uCupGap centres them.
        float fold = mix(FOLD_DODECA, 0.0, open);
        float ba = s * 0.42;
        float lift = DODECA_LIFT * ba * uCupGap;   // uCupGap = 1.0 is the exact value
        // A dodecahedron is CENTRALLY SYMMETRIC, so the second cup is the
        // central inversion of the first — negate all three axes, not just z.
        // A z-only mirror is a reflection: it flips handedness and leaves the
        // pentagons misaligned, which is why the halves would not meet. The
        // inversion also supplies the 36° twist between the rims for free, so
        // no explicit rotation is needed.
        vec3 a = p - vec3(0, 0, -lift);
        vec3 b = -p - vec3(0, 0, -lift);
        float da = bowl(a, 5, ba, 5, fold, th, false, true);
        vec3 keepA = facePos;
        float db = bowl(b, 5, ba, 5, fold, th, false, true);
        if (da < db) { d = da; facePos = keepA; } else { d = db; }

    } else {                                    // hexagonal prism
        float fold = mix(FOLD_CUBE, 0.0, open);
        d = bowl(p - vec3(0, 0, -s * 0.3), 6, s * 0.5, 4, fold, th, true, true);
    }

    return d - uRound * s;
}

vec3 normal(vec3 p) {
    vec2 e = vec2(0.002, 0.0);
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
    vec3 localAtHit = vec3(0.0);

    for (int i = 0; i < uSteps; i++) {
        vec3  p = ro + rd * t;
        float d = map(p);
        glow += uGlowAmount / (1.0 + d * d * uGlowTight);
        if (d < 0.0015) { hit = true; localAtHit = facePos; break; }
        if (t > uFar) break;
        t += d * uStepScale;
    }

    vec3 hueA = 0.5 + 0.5 * cos(uHueA + vec3(0.0, 2.1, 4.2));
    vec3 hueB = 0.5 + 0.5 * cos(uHueB + vec3(0.0, 2.1, 4.2));
    vec3 col = vec3(0.0);

    if (hit) {
        vec3 p = ro + rd * t;
        vec3 n = normal(p);
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        float lam  = 0.5 + 0.5 * dot(n, normalize(vec3(0.5, 0.8, -0.5)));

        // Panel lines in FACE-LOCAL space, so they ride the flap as it swings.
        vec2  g  = abs(fract(localAtHit.xy * uPanelScale) - 0.5);
        float ln = smoothstep(0.5, 0.42, max(g.x, g.y));
        float rr = smoothstep(0.03, 0.0, abs(length(localAtHit.xy * uPanelScale) - 0.9));

        col  = mix(hueA, hueB, lam) * (0.22 + 0.78 * lam);
        col += hueB * (ln + rr) * uPanel;
        col += hueA * fres * uRim;
    }
    col += mix(hueA, hueB, 0.5) * glow * 0.02;

    writeOut(tanh(col / uExposure * 3.0));
}
