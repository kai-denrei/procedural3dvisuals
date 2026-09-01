#include "common.glsl"
// ─────────────────────────────────────────────────────────────────────────────
// melting-jelly.frag — translucent jelly melting into a puddle.
//
// ATTRIBUTION
//   Original: noztol — "Melting Jello" — https://fragcoord.xyz/s/m78o8vry
//   This version: parameterised onto this sandbox's uniform contract. The SDF
//   structure, the smin blend, the refraction/Beer's-law shading and the
//   constants are noztol's. See ATTRIBUTIONS.md.
//
// A THIRD kind of machine, unlike anything else here:
//   corona/wormhole  accumulate EMISSION along a ray, no surface, no lighting.
//   metal-grid-flow  distorts 2D UVs, no 3D at all.
//   this             real SDF raymarching to a SURFACE, then shades it.
//
// How the melt works — the only genuinely clever bit, and it is one function:
//
//   smin(a, b, k)  is a smooth minimum. Plain min() unions two SDFs with a hard
//   crease; smin blends them over a width k. So the "melting" is not simulated
//   at all — it is a cube SDF and a flat cylinder SDF, with THREE things
//   animated together by one `melt` value:
//        cube    gets shorter and wider
//        puddle  gets wider
//        k       gets larger, so the join softens from a crease into a slump
//   Freeze any one of those and the illusion dies. It is the blend WIDTH
//   growing that reads as "losing structural integrity".
//
// The glass look is three stacked cheats, all cheaper than they look:
//   fresnel   pow(1 - dot(n, -rd), 5) — rim brightens at grazing angles
//   refract   march the ray INSIDE the surface using -map() (negated distance)
//             until it exits, then sample the floor where it lands
//   Beer     exp(-thickness * (1 - colour) * k) — thicker path = more saturated,
//             which is what actually sells "translucent solid" over "tinted glass"
//
// COST — measured, and the opposite of what the step counts suggest.
// The worst case looks alarming: uSteps march steps x 3 SDFs, plus 6 more map()
// calls for the normal, plus uRefractSteps inside the surface. But sphere
// tracing EARLY-EXITS: most rays hit the floor or escape in a handful of steps,
// and only pixels actually on the jelly pay for refraction.
//
// Measured on an M4 via ANGLE/Metal, 1280x720, ms/frame:
//     corona (40x6, no early exit, every pixel)   0.83
//     this, default framing                       0.21
//     this, jelly filling the frame               0.25
// So it is roughly 3x CHEAPER than corona, because corona has no early exit —
// it runs its full loop for every pixel unconditionally.
//
// Caveats: that is a desktop GPU, the deltas above are near the measurement
// floor, and it says nothing about a phone. Reducing uSteps did not measurably
// help at this scale — if you need frames back, cut RESOLUTION first.
// See docs/BOSS-ANIMATION.md.
// ─────────────────────────────────────────────────────────────────────────────

uniform int   uSteps;          // 90  — primary march
uniform int   uRefractSteps;   // 30  — inside-surface march
uniform float uFar;            // 30  — ray give-up distance

uniform float uMeltAuto;       // 1 = oscillate with time, 0 = use uMelt directly
uniform float uMelt;           // 0 solid … 1 puddle  (drive this from game state)
uniform float uMeltSpeed;      // 1.5

uniform float uSpread;         // 2.2 — how far the three blobs sit from centre
uniform float uScale;          // 1.0 — overall blob size
uniform float uHueShift;       // 0.0 — rotates all three colours together

uniform float uIOR;            // 1.31
uniform float uAbsorb;         // 4.5 — Beer's law strength
uniform float uFresnelPow;     // 5.0
uniform float uReflect;        // 0.6 — reflection mix at the rim

uniform float uCamDist;        // 11.0
uniform float uCamPitch;       // 0.45 — 0 = horizon, 1 = top-down
uniform float uAutoRotate;     // 0.3 — radians/sec
uniform float uFov;            // 1.5 — larger = narrower
uniform float uFloorScale;     // 1.5 — checker frequency
uniform float uFog;            // 0.015

const vec3 BG = vec3(0.05, 0.05, 0.08);

mat2 rot2D(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }

// Smooth minimum — the whole melt effect lives here.
float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCylinder(vec3 p, vec2 h) {
    vec2 d = abs(vec2(length(p.xz), p.y)) - h;
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Cheap hue rotation so one slider can recolour the whole scene.
vec3 hueShift(vec3 c, float a) {
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}

vec4 sdMeltingCube(vec3 p, vec3 center, vec3 color, float melt) {
    vec3 q = (p - center) / uScale;

    float h = mix(0.8, 0.05, melt);      // cube collapses
    float w = mix(0.7, 1.1, melt);       // …and spreads
    vec3 cubePos = q;
    cubePos.y -= h;                      // keep the base on the ground
    float dCube = sdRoundBox(cubePos, vec3(w * 0.8, h, w * 0.8), 0.15);

    float puddleR = mix(0.8, 2.0, melt); // puddle grows
    vec3 puddlePos = q;
    puddlePos.y -= 0.05;
    float dPuddle = sdCylinder(puddlePos, vec2(puddleR, 0.05));

    // The blend WIDTH grows with melt — this is what reads as slumping.
    float blend = mix(0.1, 0.6, melt);
    return vec4(color, smin(dCube, dPuddle, blend) * uScale);
}

float meltAmount() {
    float osc = sin(T * uMeltSpeed) * 0.5 + 0.5;
    return clamp(mix(uMelt, osc, clamp(uMeltAuto, 0.0, 1.0)), 0.0, 1.0);
}

vec4 map(vec3 p) {
    float melt = meltAmount();
    float s = uSpread;
    vec4 a = sdMeltingCube(p, vec3(-s,  0.0,  s * 0.545), hueShift(vec3(0.0, 0.8, 1.0), uHueShift), melt);
    vec4 b = sdMeltingCube(p, vec3( s,  0.0,  s * 0.545), hueShift(vec3(1.0, 0.0, 0.8), uHueShift), melt);
    vec4 c = sdMeltingCube(p, vec3(0.0, 0.0, -s),         hueShift(vec3(1.0, 0.8, 0.0), uHueShift), melt);
    vec4 res = a;
    if (b.w < res.w) res = b;
    if (c.w < res.w) res = c;
    return res;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.001, 0.0);
    return normalize(vec3(
        map(p + e.xyy).w - map(p - e.xyy).w,
        map(p + e.yxy).w - map(p - e.yxy).w,
        map(p + e.yyx).w - map(p - e.yyx).w));
}

vec3 floorColor(vec3 p) {
    float check = mod(floor(p.x * uFloorScale) + floor(p.z * uFloorScale), 2.0);
    return mix(vec3(0.15), vec3(0.25), check);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;

    // Mouse orbits when the pointer has been used; otherwise a default framing.
    vec2 m = uMouse.xy / uResolution.xy;
    if (length(uMouse.xy) < 10.0) m = vec2(0.5, 0.3);

    vec3 ro = vec3(0.0, 0.0, -uCamDist);
    vec3 rd = normalize(vec3(uv, uFov));

    float rotY = T * uAutoRotate + m.x * TAU;
    float rotX = mix(0.15, 1.2, clamp(uCamPitch + (m.y - 0.3), 0.0, 1.0));
    ro.yz *= rot2D(rotX); rd.yz *= rot2D(rotX);
    ro.xz *= rot2D(rotY); rd.xz *= rot2D(rotY);

    // ── primary march: nearest of {jelly, ground plane y=0} ─────────────────
    float t = 0.0;
    vec4 res = vec4(0.0);
    bool hitJelly = false;

    for (int i = 0; i < uSteps; i++) {
        vec3 p = ro + rd * t;
        res = map(p);
        float dFloor = p.y;                       // plane SDF, y = 0
        float d = min(res.w, dFloor);
        if (d < 0.001) { hitJelly = res.w < dFloor; break; }
        if (t > uFar) break;
        t += d;
    }

    vec3 col = BG;

    if (t <= uFar) {
        vec3 p = ro + rd * t;

        if (!hitJelly) {
            col = floorColor(p) * exp(-t * uFog);
        } else {
            vec3 n = calcNormal(p);

            float fresnel = mix(0.05, 1.0, pow(1.0 - max(dot(n, -rd), 0.0), uFresnelPow));

            // March INSIDE the surface on the negated distance until we exit.
            vec3 refDir = refract(rd, n, 1.0 / max(uIOR, 1.001));
            float tIn = 0.02;
            for (int i = 0; i < uRefractSteps; i++) {
                float d = -map(p + refDir * tIn).w;
                if (d < 0.002 || tIn > 6.0) break;
                tIn += max(0.01, d);
            }

            vec3 exitP = p + refDir * tIn;
            vec3 bg = BG;
            if (refDir.y < 0.0) bg = floorColor(exitP + refDir * (-exitP.y / refDir.y));

            // Beer's law: thicker path → more saturated. Sells "solid", not "glass".
            vec3 refrCol = bg * exp(-tIn * (vec3(1.0) - res.rgb) * uAbsorb);

            vec3 reflDir = reflect(rd, n);
            vec3 reflCol = BG;
            if (reflDir.y < 0.0) reflCol = floorColor(p + reflDir * (-p.y / reflDir.y));

            col = mix(refrCol, reflCol, fresnel * uReflect);
            col += res.rgb * 0.08;                 // faint self-colour so it never goes grey
            col *= exp(-t * uFog);
        }
    }

    writeOut(col);
}
