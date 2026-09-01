# Attributions

This project reimplements and adapts shader techniques published by others.
Credit is stored in `src/registry.mjs` alongside each effect, so it travels
automatically into the UI, the JSON export, the `.frag` export, the standalone
HTML export, and anything embedding via `embed/p3dv.mjs` — rather than living
only in this file.

Programmatic access:

```js
import { credits } from './embed/p3dv.mjs';
await credits();                          // every effect
await credits({ effect: 'metal-grid-flow' });
```

---

## Metal Grid Flow

- **Original:** *harsh* — <https://www.shadertoy.com/view/dtKfDD>
- **fragcoord.xyz port:** *koncreate* ("Kong"), titled "Metal Grid Flow (resized)"
  — <https://fragcoord.xyz/s/gt8966nk>
- **This version:** parameterised and adapted to this project's uniform
  contract. Structure and constants are unchanged.

One deliberate deviation: the source loops `i < 4` while writing `c[i]` into a
`vec3`, so `c[3]` is out of bounds — undefined behaviour that drivers happen to
discard. We keep all four iterations, because the fourth still advances `z` and
sets `l`, and the final `c / (l + 0.5)` divide uses that `l`; dropping to three
would change the image. The write is guarded instead. See
`shaders/metal-grid-flow.frag`.

## Corona / Corona (golfed)

- **Original:** *XorDev* — "Coronal"
- **Platform:** fragcoord.xyz — <https://fragcoord.xyz>
- **This version:** un-golfed from the published listing and parameterised.
  `corona-golfed.frag` is a near-verbatim transcription kept as a live check
  that the dialect aliases in `shaders/common.glsl` are faithful.

## Wormhole

Original to this project, derived from XorDev's turbulence technique
(`p += sin(p.zxy * d + t) / d` with `d` doubling). Same raymarch + singularity
machine as Corona, retargeted to a tunnel.

## Technique lineage

The shared method — pseudo-raymarch, sine domain warping, singularity-driven
emission, `tanh` tonemapping — is XorDev's, popularised through fragcoord.xyz
and Shadertoy. `shaders/corona.frag` documents how it works in detail.

## Libraries

- **three.js** r160 — MIT — <https://threejs.org> — vendored at
  `vendor/three.module.js`.

---

If you are one of the authors above and want a credit corrected, changed, or
removed, please open an issue.
