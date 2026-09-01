# procedural3dvisuals

A local sandbox for XorDev-style procedural fragment shaders — pseudo-raymarching,
sine domain-warping, and singularity-driven emission — built to author effects that
drop into a **three.js r160, no-build, vanilla ES modules** project.

Two effects so far: a replication of XorDev's **Coronal**, and a **wormhole /
portal travel** effect derived from the same technique.

## Run

```bash
./dev.sh                 # http://localhost:8080  — server + bust-on-save watcher
./dev.sh --port 9000
./dev.sh --prod          # production cache recipe, to verify busting actually works
```

No `npm install`. three.js r160 is vendored at `vendor/three.module.js`.

| Key | |
|---|---|
| `space` | pause |
| `r` | restart time |
| `h` | hide the control rail |
| `s` | save PNG |

Deep-link an effect with `?fx=corona`, `?fx=wormhole`, `?fx=corona-golfed`.

## Layout

```
index.html            importmap → vendor/three.module.js
src/
  main.mjs            renderer, frame loop, resize, input
  effect.mjs          ShaderMaterial factory (GLSL3) + fullscreen triangle
  registry.mjs        effect catalogue + parameter schema  ← single source of truth
  shader-loader.mjs   fetch with cache-bust token, resolve #include "…"
  ui.mjs              control rail, generated from the schema
  style.css
shaders/
  common.glsl         uniforms, Xor dialect aliases, turbulence, writeOut()
  corona.frag         un-golfed Coronal, heavily annotated
  corona-golfed.frag  verbatim dialect transcription — a live check on the aliases
  wormhole.frag       portal travel
docs/PORTING.md       how to move an effect into the r160 target project
serve.mjs             static server; mirrors the production Cache-Control recipe
dev.sh                server + watcher
.deban/               decision log (gitignored — local working memory)
```

The **registry is the single source of truth**: a slider and its uniform are
generated from the same schema entry, so they cannot drift apart.

## The technique, in four parts

Both effects are the same machine with different parameters:

1. **Pseudo-raymarch.** `z` is distance along the ray, `p = z * rayDir` the
   sample point. There is no scene — the geometry is the unit cylinder.
2. **Domain warp drives the step.** `p += sin(p.zxy * d + phase) / d` with `d`
   doubling per octave. Organic advection with no noise texture and no hash. The
   `.zxy` swizzle is what stops it collapsing into an axis-aligned grid.
3. **The singularity does the heavy lifting.** Emission is divided by
   `abs(length(unwarped.xy) - radius)`, which reaches zero exactly at the ring.
   Skip it and you get a flat glow instead of a corona edge. It is `x/0`, never
   `0/0` — so the worst case is `+Inf`, and `tanh` saturates it to white.
4. **`1/z²` falloff + `tanh` tonemap.** Inverse-square stops distant samples
   washing out the frame; `tanh` is a soft shoulder that never hard-clips, so
   the blown core stays white instead of shifting hue.

`shaders/corona.frag` carries the full derivation from the golfed original.

## Cache busting

Installed via the `cache-busting` skill. The token appears three ways:

- `?v=<token>` on every asset URL, including runtime `fetch()` of `.glsl`
- `<meta name="cb">` — how JS learns the token (the fingerprinter cannot see a
  URL that only exists inside a `fetch` call)
- the shape favicon + corner badge — **if the badge changed, the bust worked**

`serve.mjs` mirrors the real recipe so this is testable rather than assumed:

| mode | behaviour |
|---|---|
| `--dev` (default) | `no-store` on everything. You never debug a file that is no longer on disk. |
| `--prod` | `?v=` present → `immutable`; otherwise `no-cache`. Edit a shader *without* running `./scripts/bust.sh` and it correctly stays stale. |

Bump manually with `./scripts/bust.sh`; `./dev.sh` does it on save.

## Decision log

`.deban/` holds role-scoped decision logs, including an append-only
`## Dead Ends` section per role. Gitignored by default. Query it with
`/deban query`, update with `/deban sync`.
