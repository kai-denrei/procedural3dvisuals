# Can these be reused for a final-level boss in spherical-stalberg-grid?

Short answer: **yes, and the integration is easier than expected — but one
specific thing will make it look wrong, and it is not performance.**

Assessment written 2026-09-01 against `~/Dev/spherical-stalberg-grid` as it
stands. Nothing in that project has been modified.

---

## 1. The stack fits with no friction

| | procedural3dvisuals | spherical-stalberg-grid |
|---|---|---|
| modules | vanilla ESM, no build | vanilla ESM, no build |
| three.js | r160, vendored | r160, vendored flat in `vendor/` |
| models | — | glTF 2.0 `.glb` |
| hosting | GitHub Pages | GitHub Pages |
| cache bust | `?v=` via `bust.sh` | `?v=` via `bust.sh` + pre-push guard |

`embed/p3dv.mjs` was written against exactly this profile. One edit is needed:
it does `import * as THREE from 'three'`, and the game vendors flat with no
importmap, so rewrite that to `from '../vendor/three.module.js'`. That is the
project's documented "fits with vendoring" path (`TECH-STACK.md`).

Two house rules to respect:
- **Never put `?v=` on a `../vendor/` import** — a tokened vendor URL loads a
  second copy of three.js. `p3dv.mjs`'s `version` option only stamps shader
  fetches, so leave the vendor import bare.
- `bust.sh` output commits atomically; the pre-push hook enforces it.

## 2. The thing that will make it look wrong

**`src/postfx.js:101` adds `OutputPass` to the final composer.** In r160 that
pass applies tone mapping *and* the sRGB transfer, read from
`renderer.toneMapping` / `renderer.outputColorSpace`. The game therefore renders
its scene in **linear** space and converts once, at the end. Its own comment
says so: *"without OutputPass the whole scene washes out"*.

Every effect in this sandbox outputs **display-referred** values — `corona` and
`wormhole` end in `tanh()`, which is already a tonemap. Add one of those
straight into the game's scene and it gets tonemapped and sRGB-encoded a second
time: washed out, milky, low contrast.

This is the concrete answer to the open question this project has carried since
day one ("does the target set toneMapping or composite through a target?").
**It does both.**

### The correct integration path

Use **`createTexture`**, not `mountFullscreen`, and not adding the effect's mesh
to the game's scene.

```js
import { createTexture } from './p3dv/p3dv.mjs';

const boss = await createTexture(renderer, {
  effect: 'wormhole', size: 512, basePath: './p3dv/',
});
bossMesh.material = new THREE.MeshBasicMaterial({ map: boss.texture });

// each frame, BEFORE composer.render():
boss.update(clock.elapsedTime);
```

`createTexture` already sets `texture.colorSpace = SRGBColorSpace`, so three
converts sRGB→linear **on read**. The effect's display-referred output lands in
the game's linear pipeline correctly, and `OutputPass` then converts once at the
end, as it does for everything else. That is the whole fix, and it is already
written.

Bonus: a `MeshBasicMaterial` map participates in the existing bloom chain, so
the boss picks up the game's glow for free. Check `bloomweights.js` — you will
want to give it a deliberate weight rather than inherit a default.

## 3. Performance is not the problem

Measured on an M4 via ANGLE/Metal, ms per frame at 1280x720:

| | ms | vs corona |
|---|---|---|
| corona, default | 0.83 | 1.0x |
| melting-jelly, default framing | 0.21 | 0.3x |
| melting-jelly, filling the frame | 0.25 | 0.3x |
| melting-jelly, 512x512 | 0.11 | 0.1x |

The SDF effects are **cheaper** than the emission ones, which inverts the
intuition. Sphere tracing early-exits — most rays hit the floor or escape in a
few steps. Corona has no early exit: it runs 40x6 iterations for every pixel
unconditionally.

At 512x512 in a render target, a boss effect costs well under 1% of a 16.7ms
frame on this hardware, against a game already spending ~1022–1448 draw calls.

**Caveats, stated plainly.** That is a desktop M4; it says nothing about a
phone, and the game already halves its bloom scale on coarse pointers. The
deltas above are near the measurement floor — reducing `uSteps` did not
measurably help, so if frames are needed, **cut the render-target resolution,
not the step count**. Measure on a real phone before committing.

## 4. Which effect actually suits the boss

The game's look is neon wireframe on a relaxed Stålberg sphere. That matters
more than the technique.

| effect | fit | why |
|---|---|---|
| **wormhole** | **strongest** | The run already ends at portals/gates — "every portal dead with all five sectors open". A portal *is* the vocabulary. Neon, dark-field, reads at small size. |
| **corona** | strong | Sector 5 is THE PLANET. A corona wrapped on a sphere is a planet-scale threat with no new concept needed. |
| **metal-grid-flow** | weak | Iridescent foil is a surface treatment, not a threat. Could work as a shield/armour pass. |
| **melting-jelly** | weakest *visually*, strongest *mechanically* | Checkerboard floor and cartoon cubes clash badly with the game's palette. But see below. |

### What is actually worth stealing from the jelly

Not the shader — the **mechanic**. The melt is one function, `smin(a, b, k)`,
with three things animated by a single scalar:

- the body shrinks,
- the puddle spreads,
- **the blend width `k` grows**

That third one is what reads as "losing structural integrity". Freeze it and the
illusion dies.

Drive that scalar from **boss HP** and you have a death animation that is
continuous, interruptible, and needs no keyframes — the boss visibly slumps as
it takes damage and re-forms if it heals. `uMeltAuto = 0` plus `uMelt` exists
for exactly this; it is the one thing added to noztol's original.

The `knot` enemy is already `boss: true` with `hp: 5` (`src/enemyspec.js:130`),
so `uMelt = 1 - hp/maxHp` is a one-line binding.

## 5. Honest risks

- **Aesthetic mismatch is the real risk, not tech.** These effects were authored
  as standalone art. Dropped into a game with an established neon palette they
  will look pasted on unless recoloured deliberately. Budget design time, not
  integration time.
- **Mobile is unmeasured.** Everything above is desktop.
- **The bloom chain is tuned.** `postfx.js` explains the per-group weight trick
  at length. A bright new emissive object will disturb a balance someone
  deliberately set; it needs a weight, not a default.
- **Attribution travels.** `metal-grid-flow` and `melting-jelly` are adapted
  from other people's work. `credits()` returns it programmatically — surface it
  in the game's credits screen. See `ATTRIBUTIONS.md`.

## 6. What I would do

1. Prototype `wormhole` via `createTexture` at 512, on a plane at the sector-5
   portal. One afternoon; the code exists.
2. Measure on a real phone before anything else.
3. If it survives that, add the jelly's HP-driven `smin` melt as a *separate*
   mechanic on the boss body — reuse the idea, not the checkerboard.

Not done here: nothing in `spherical-stalberg-grid` has been touched. This is an
assessment, not a change.
