# procedural3dvisuals

A local sandbox for XorDev-style procedural fragment shaders — pseudo-raymarching,
sine domain-warping, and singularity-driven emission — built to author effects that
drop into a **three.js r160, no-build, vanilla ES modules** project.

Effects: a replication of XorDev's **Coronal**, a **wormhole / portal travel**
effect derived from the same technique, **Metal Grid Flow** (iridescent foil,
after *harsh* and *koncreate*), **Melting Jelly** (SDF raymarching with
refraction, after *noztol*), **Motion Cube** (a cube unfolding into its net,
after *Jaenam*), and **SDF Primitives** (12 morphable primitives, original).

> **Licences differ per effect.** Motion Cube is **CC BY-NC-SA 4.0** —
> non-commercial only, share-alike. SDF Primitives is original and
> unencumbered. The rest were published without stated terms. See
> **[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md)** before shipping any of them.

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

## Deeplinks

The URL always reflects what you are looking at. It carries the effect plus
**every value that differs from the default**, so a link is short, readable and
hand-editable:

```
?fx=metal-grid-flow&uZStep=0.18&uGridFreq=47.5&uPolarScale=6.25
```

Unset params follow the registry defaults, which means a link tracks the project
if a default is later retuned. For a frozen snapshot use **Download JSON**
instead — that is the deliberate difference between the two.

## Compute cost

Every effect can be **measured on the device viewing it** — press *Measure on
this device* in the rail. You get ms/megapixel, predicted cost at viewport /
1024² / 512² / 256², each as a share of a 60fps frame, a verdict from *free* to
*cinematic only*, and what halving each cost-relevant parameter actually buys.

It measures rather than models because a loop-count model gets the answer
backwards: corona (40x6 sine octaves) costs ~1.20 ms/MP while melting-jelly
(90 march steps x 3 SDFs, plus refraction) costs ~0.06 — **19x cheaper**,
because sphere tracing early-exits and corona's loop does not.

Details and the methodology, including why an fps counter cannot see any of
this: `src/bench.mjs` and [`docs/BOSS-ANIMATION.md`](docs/BOSS-ANIMATION.md).

## Export

Every effect can be taken out of the sandbox five ways:

| | |
|---|---|
| **Copy deeplink** | URL with the non-default values |
| **Copy variables** / **Download JSON** | the values, plus credit, permalink, and the measured cost if you ran one |
| **Download .frag** | shader with `#include`s resolved and a credit header |
| **Download standalone .html** | one self-contained file — raw WebGL2, **no three.js**, no build, no network, ~12KB. Current values baked in. Verified rendering from `file://` offline. |
| **`s` key** | PNG of the current frame |

## Reuse in another project

`embed/p3dv.mjs` is a standalone module whose only dependency is three.js.

```js
import { mountFullscreen, createTexture } from './p3dv/p3dv.mjs';

// fullscreen, we own the loop
const fx = await mountFullscreen({ canvas, effect: 'wormhole', basePath: './' });

// or as a texture on real geometry — portal on a plane, panel on a .glb
const portal = await createTexture(renderer, { effect: 'corona', size: 1024 });
portal.update(t);                    // before your main render
doorway.material.map = portal.texture;
```

Full guide, options table and the three gotchas: **[`embed/README.md`](embed/README.md)**.
Runnable demo of both paths: `embed/example.html`.

## Layout

```
index.html            importmap → vendor/three.module.js
src/
  main.mjs            renderer, frame loop, resize, input
  effect.mjs          ShaderMaterial factory (GLSL3) + fullscreen triangle
  registry.mjs        effect catalogue + parameter schema  ← single source of truth
  shader-loader.mjs   fetch with cache-bust token, resolve #include "…"
  ui.mjs              control rail, generated from the schema
  pwa.mjs             SW registration, update toast, fullscreen, wake lock
  permalink.mjs       deeplink encode/decode
  export.mjs          PNG / JSON / .frag / standalone .html
  bench.mjs           per-device cost measurement (ms/megapixel)
  style.css
embed/
  p3dv.mjs            reusable API — only dependency is three.js
  example.html        runnable demo of both embed paths
  README.md           how to reuse these in another project
shaders/
  common.glsl         uniforms, Xor dialect aliases, turbulence, writeOut()
  corona.frag         un-golfed Coronal, heavily annotated
  corona-golfed.frag  verbatim dialect transcription — a live check on the aliases
  wormhole.frag       portal travel
  metal-grid-flow.frag  iridescent foil (attributed)
  melting-jelly.frag    SDF raymarch + refraction (attributed)
  motion-cube.frag      unfolding cube (attributed — CC BY-NC-SA 4.0)
  sdf-primitives.frag   12 primitives, morph + open (original, unencumbered)
docs/PORTING.md       how to move an effect into the r160 target project
docs/BOSS-ANIMATION.md  assessment: reusing these in spherical-stalberg-grid
ATTRIBUTIONS.md       credit for borrowed work
sw.js                 service worker; cache keyed to the bust token
manifest.webmanifest  PWA manifest (standalone, shortcuts per effect)
icons/                generated by rendering the corona shader itself
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

## Mobile / PWA

Installable, works offline, and runs chrome-less once installed.

```bash
./dev.sh          # then open on your phone at http://<your-lan-ip>:8080
```

| | |
|---|---|
| **Immersive** | The ☰ button hides the controls for a full-bleed effect. Persists across reloads. `h` on desktop. |
| **Fullscreen** | The ⛶ button. `f` on desktop. Unavailable on iPhone Safari — see below. |
| **Offline** | Whole app is precached (~1.3MB, mostly three.js). Verified rendering with the network cut. |
| **Wake lock** | The screen won't dim while an effect is running. |
| **Updates** | A new build shows a "Reload" toast. It never swaps the controller mid-session. |

### Why installing matters here, specifically

The complaint that motivated this was dials being hard to grab without
triggering native gestures. That splits into two problems with two different
fixes:

1. **Scroll / pull-to-refresh / gesture arbitration stealing the first pixels of
   a drag** — fixed in CSS. `touch-action: none` on the sliders and canvas,
   `overscroll-behavior: none` on the body, `contain` on the panel. Verified:
   a full slider drag moves the value and leaves `scrollY` at 0.
2. **iOS Safari's edge-swipe back/forward navigation** — *not* fixable from a
   web page. No CSS property suppresses it. The only fix is Add to Home Screen:
   in `display: standalone` the browser chrome, and its edge gestures, are gone.

So on iPhone the honest instruction is: **add it to your home screen.** The app
shows that hint itself on iOS, once, and the fullscreen button says so rather
than silently failing (iPhone Safari has no Fullscreen API at all).

Touch targets are 44px+ on coarse pointers — the slider track stays 3px but sits
in 21px of hit-testable padding, and the toggle's whole row is a label.

## Decision log

`.deban/` holds role-scoped decision logs, including an append-only
`## Dead Ends` section per role. Gitignored by default. Query it with
`/deban query`, update with `/deban sync`.

## Attribution

Effects carry their credit in `src/registry.mjs`, so it travels automatically
into the UI, every export, and anything embedding via `embed/p3dv.mjs` — rather
than living only in a file nobody copies. See **[`ATTRIBUTIONS.md`](ATTRIBUTIONS.md)**.

If you are one of the credited authors and want a credit corrected, changed, or
removed, please open an issue.
