// ─────────────────────────────────────────────────────────────────────────────
// xor-dialect.glsl — fragcoord.xyz / XorDev shorthand.
//
// Include this ONLY in files that transcribe golfed source. It used to live in
// common.glsl, which armed it in every shader in the project, and it cost two
// debugging sessions before this file existed:
//
//   `vec3 hash3f(vec3 f)`  →  `vec3 hash3f(vec3 float)`
//   `vec2 f = fract(g)`    →  `vec2 float = fract(g)`
//
// The preprocessor is text substitution with no scope, so ANY identifier named
// `f`, `len` or `nor` is rewritten — parameters and locals included — and the
// compiler then points at the substituted keyword, which reads like a problem
// with the surrounding expression rather than with the name.
//
// So: one file needs these, one file gets them.
// ─────────────────────────────────────────────────────────────────────────────

#define f   float
#define f2  vec2
#define f3  vec3
#define f4  vec4
#define len length
#define nor normalize
