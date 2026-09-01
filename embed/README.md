# p3dv — reusing these effects in another project

Designed for: **vanilla ES modules, browser-native, three.js r160, DOM + CSS,
glTF 2.0 `.glb`, no build step, `.mjs`, node.** No bundler, no npm install.

## Install

Copy three things into your project:

```
p3dv/
  p3dv.mjs          ← embed/p3dv.mjs
shaders/            ← the whole folder
src/registry.mjs    ← effect catalogue + params + credits
```

Point `basePath` at wherever `shaders/` and `src/` ended up. You need three.js
r160+ resolvable as `"three"` — an importmap is enough:

```html
<script type="importmap">
{ "imports": { "three": "./vendor/three.module.js" } }
</script>
```

`p3dv.mjs` imports **only** `three`. It never pulls in the sandbox UI, service
worker, or cache-busting.

## Three entry points

Pick by how much control you want to keep.

### `mountFullscreen(opts)` — we own the renderer and the loop

```js
import { mountFullscreen } from './p3dv/p3dv.mjs';

const fx = await mountFullscreen({
  canvas: document.querySelector('#bg'),
  effect: 'wormhole',
  basePath: './',
  params: { uSpeed: 2.1, uTwist: 0.5 },
});

fx.set({ uSpeed: 3 });   // live
fx.paused = true;
fx.time = 12.5;
fx.stop(); fx.start();
fx.dispose();
```

### `createEffect(opts)` — you own the renderer

Returns a `THREE.Mesh` you add to your own scene, plus the plumbing.

```js
const fx = await createEffect({ effect: 'corona', basePath: './' });
scene.add(fx.mesh);

// each frame:
fx.setTime(t);
fx.setResolution(...renderer.getDrawingBufferSize(new THREE.Vector2()));
```

### `createTexture(renderer, opts)` — the effect as a material map

The case for a portal on a plane, or an emissive panel on a `.glb`.

```js
const portal = await createTexture(renderer, {
  effect: 'wormhole', size: 1024, basePath: './',
});
doorway.material.map = portal.texture;
doorway.material.needsUpdate = true;

// each frame, BEFORE your main render:
portal.update(t);
renderer.render(scene, camera);
```

Two things this handles that are easy to get wrong by hand:

- **`uResolution` is the target's size, not the canvas's.** Otherwise the ring
  is sized for the wrong aspect and lands off-centre.
- **`texture.colorSpace = SRGBColorSpace`**, because the effect writes
  display-referred values. Getting this backwards is the single most common
  cause of "it looked right in the sandbox and wrong in my scene."

## Options

| key | default | meaning |
|---|---|---|
| `effect` | — | registry key: `corona`, `wormhole`, `metal-grid-flow`, … |
| `basePath` | `'./'` | where `shaders/` and `src/registry.mjs` live |
| `params` | `{}` | uniform overrides; unknown keys ignored |
| `version` | — | cache-bust token appended to shader fetches |
| `outputTransform` | `false` | route through three's colorspace + tone mapping |
| `registry` | — | inject `EFFECTS` directly instead of importing it |
| `size` | `1024` | `createTexture` only; number or `[w, h]` |
| `renderScale` | `1` | `mountFullscreen` only; internal resolution multiplier |
| `maxPixelRatio` | `2` | `mountFullscreen` only |
| `onFrame(t, fx)` | — | `mountFullscreen` only; per-frame hook |

## The three gotchas that will bite you

**1. `glslVersion: GLSL3` is mandatory.** `tanh()` is GLSL ES 3.00 only. Under
GLSL3, three.js injects neither `pc_fragColor` nor a `gl_FragColor` alias
(`three.module.js:20228`), so `shaders/common.glsl` declares the output itself
and every effect calls `writeOut()`. `p3dv.mjs` sets this for you — don't
remove it.

**2. Colour space.** A bare `ShaderMaterial` writes to the framebuffer
**verbatim**: three applies colorspace/tone mapping only via the
`<colorspace_fragment>` / `<tonemapping_fragment>` chunks inside its *built-in*
material shaders, and a user shader has neither. That faithfulness ends the
moment your scene sets `renderer.toneMapping`, or composites the effect through
a render target. Set `outputTransform: true` to preview that path.

**3. Cost is `uSteps × uTurbOctaves` per pixel.** Corona defaults to 40 × 6 =
240 sine-heavy iterations *per pixel*, pure ALU that does not batch. If you are
also rendering glTF geometry, budget it:

| move | effect |
|---|---|
| `uSteps` 40 → 24 | ~40% cheaper; softest falloff goes first |
| `uTurbOctaves` 6 → 4 | ~33% cheaper; plasma gets coarser |
| `createTexture` at 512 and upscale | ~4× cheaper; these are low-frequency effects and take it well |

The texture route is usually right. This is a glow, not text.

## No three.js at all?

The sandbox's **Download standalone .html** export emits a single
dependency-free file — raw WebGL2, current values baked in, ~12KB, works from
`file://` with no network. Drop it in an `<iframe>`, or lift its ~60 lines of
GL boilerplate. That is the most portable form these effects take.

## Credits

Effects carry their attribution in the registry, so it travels into embeds
automatically:

```js
import { credits } from './p3dv/p3dv.mjs';
await credits();                              // every effect
await credits({ effect: 'metal-grid-flow' }); // one
// → { effect, label, origin, via: [{label, url}], note }
```

Please surface it somewhere in anything you ship. See `../ATTRIBUTIONS.md`.

## Live example

`embed/example.html` runs both `mountFullscreen` and `createTexture`
side by side, with credits wired up.
