# Porting an effect into another three.js r160 project

Target profile assumed: **vanilla ES modules, browser-native, three.js r160,
DOM + CSS, glTF 2.0 `.glb`, no build step, `.mjs`, node.**

## The contract

An effect needs exactly four things from its host. Nothing else in this
sandbox is load-bearing.

1. **`glslVersion: THREE.GLSL3`** on the material.
2. **Four core uniforms**, updated per frame: `uResolution` (vec3, *drawing
   buffer* pixels — not CSS pixels), `uTime` (float, seconds), `uMouse` (vec4),
   `uTimeScale` (float).
3. **The effect's own uniforms**, from `src/registry.mjs`.
4. **The shader source with `common.glsl` inlined** (`src/shader-loader.mjs`
   does this, or paste it in by hand).

## Minimal host

```js
import * as THREE from 'three';
import { loadShader } from './shader-loader.mjs';

const fragmentShader = await loadShader('shaders/corona.frag');

const uniforms = {
  uResolution: { value: new THREE.Vector3(1, 1, 1) },
  uTime:       { value: 0 },
  uMouse:      { value: new THREE.Vector4() },
  uTimeScale:  { value: 1 },
  // …plus the effect's params, see registry.mjs
};

const material = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader,
  uniforms,
  depthTest: false,
  depthWrite: false,
});
```

Feed `uResolution` from `renderer.getDrawingBufferSize()`, never from
`window.innerWidth`. Using CSS pixels on a 2x display halves the effective
ray-setup scale and the ring lands in the wrong place.

---

## Four things that will bite you

### 1. GLSL3 does not give you `gl_FragColor`

`vendor/three.module.js:20228` — when `glslVersion === GLSL3`, three.js skips
injecting `layout(location=0) out highp vec4 pc_fragColor;` and the
`#define gl_FragColor pc_fragColor` alias. Your shader declares its own output.
Here `common.glsl` owns that declaration and every effect calls `writeOut()`.

You cannot drop `glslVersion: GLSL3`: `tanh()` is GLSL ES 3.00 only, and the
tonemap depends on it. Under GLSL ES 1.00 you would hand-roll
`(e^2x - 1)/(e^2x + 1)` and watch it overflow at the singularity.

### 2. Colour space — the reason the sandbox has a toggle

A bare `ShaderMaterial` writes to the framebuffer **verbatim**. three.js applies
colour-space conversion and tone mapping only through the
`<colorspace_fragment>` / `<tonemapping_fragment>` chunks embedded in its
*built-in* material shaders, and a user shader contains neither. So what you
author is what you see — faithful to fragcoord.xyz.

That stops being true the moment the effect lands in a scene that:

- sets `renderer.toneMapping` to anything but `NoToneMapping`, **or**
- renders into a `WebGLRenderTarget` that is later composited by a built-in
  material or a post-processing pass.

In those cases the output gets transformed a second time and the effect goes
washed-out or muddy. Flip **three.js output transform** in the sandbox rail to
preview that before you port. If it looks wrong with the toggle ON, the fix is
to compensate in the host, not to re-tune the shader — otherwise it breaks
again in the next scene.

### 3. The singularity is division by zero, on purpose

`acc += colour / (z*z) / abs(length(unwarped.xy) - radius)`

The divisor reaches zero exactly at the ring. That is the effect, not a bug —
it is what makes the corona edge explode instead of looking flat.

It is safe because it is `x/0`, never `0/0`: the numerator
`(uColorBias - cos(p))` has a floor of `uColorBias - 1` (0.1 at default), so the
worst case is `+Inf`, and `tanh(+Inf)` saturates to 1.0.

**But** some drivers return NaN from `tanh(Inf)`, and NaN survives `clamp()`.
`uEpsilon` floors the divisor to keep it finite. Measured cost of that safety:
at 300x240, `uEpsilon` 1e-4 vs 1e-7 differs on **3 pixels out of 72,000**, max
channel delta 6. It is free. Keep it.

If you set `uColorBias` to exactly 1.0, the numerator can reach zero at the same
place the denominator does — now it *is* `0/0`, and you get real NaN. The slider
floor is 1.0 for that reason; do not go below it.

### 4. Cost is `uSteps x uTurbOctaves` inner iterations

Default Corona is 40 x 6 = 240 sine-heavy iterations **per pixel**. At 1440p
that is a serious fragment load, and it does not batch — it is pure ALU.

For reuse in a project that also renders glTF geometry, budget it:

| Move | Effect |
|---|---|
| `uSteps` 40 → 24 | ~40% cheaper; softest falloff detail goes first |
| `uTurbOctaves` 6 → 4 | ~33% cheaper; plasma gets visibly coarser |
| Render at 0.5x into a target, upscale | ~4x cheaper; the effect is low-frequency enough to take it well |

The render-scale route is usually the right one — this is a glow effect, not
text. The sandbox's **Render scale** slider previews exactly that.

---

## Using an effect as a texture rather than a fullscreen pass

For a portal *in* a scene (on a plane, a `.glb` doorway), render to a target and
sample it:

```js
const rt = new THREE.WebGLRenderTarget(1024, 1024);
uniforms.uResolution.value.set(1024, 1024, 1);

// each frame, before the main render:
renderer.setRenderTarget(rt);
renderer.render(fxScene, fxCamera);
renderer.setRenderTarget(null);

portalMesh.material.map = rt.texture;
```

Two adjustments this forces:

- **Set `rt.texture.colorSpace`.** The effect writes display-referred values.
  If the material sampling it expects linear, set
  `rt.texture.colorSpace = THREE.SRGBColorSpace` so three converts on read.
  Getting this backwards is the single most common cause of "it looked right in
  the sandbox and wrong in my scene."
- **`uResolution` must be the target's size**, not the canvas's — otherwise the
  ring is sized for the wrong aspect and lands off-centre.

## Downgrading

If the effect must run somewhere without GLSL ES 3.00, the realistic move is not
to port the shader — it is to **bake it**. Render 60–120 frames to PNGs with the
sandbox's `s` key (or drive `serve.mjs` with a headless browser), assemble a
sprite sheet, and play it back on a plane. The look survives; the per-pixel cost
drops to a texture fetch.
