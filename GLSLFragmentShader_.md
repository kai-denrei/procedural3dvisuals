Highly golfed GLSL fragment shader (tweet-style / code-golf minimized).

Coronal

f z=2,d
@(40)
{
f3 p = z * nor(2*C.rgb - R.xyy),t=p
d=2; @(6) d+=d,
p += sin(p.zxy*d+z-T) / d
z += abs(1-len(p.xy))/3;
O += f4(1.1-cos(p),)/z/z/abs(len(t.xy)-1)
}
O = tanh(O / 30)


Tech stack

Language**: Highly golfed GLSL fragment shader (tweet-style / code-golf minimized).
Platform**: FragCoord.xyz — a browser-based shader editor and playground built by XorDev himself. It runs on WebGL (with multipass buffers, recursion, float textures, and export options to HLSL / WGSL / Metal).
Key techniques used**:
  Pseudo-raymarching / volumetric accumulation along the view ray.
  Iterative domain warping with sine waves (Xor’s signature cheap “turbulence” method) for organic, fluid motion without classic noise textures.
  Simple circle SDF (len(p.xy)) to create the ring geometry.
  Emission accumulation with \(1/z^2\) falloff + a singularity trick (1/abs(...)) that makes the corona edges explode with brightness.
  Cosine-based coloring + tanh soft tonemapping.

The whole effect is a single-pass fragment shader that fits in a few dozen characters.

Similar effects achievable with the same approach

Because the core idea is so flexible (ray + domain-warped turbulence + emission + simple SDF), you can get a wide range of related looks just by changing the shape, the warping strength, the density, or the color mapping:

Solar corona / sun with flares and coronal mass ejections
Black-hole accretion disks or event-horizon glow rings
Plasma orbs, energy balls, magical auras, and force fields
Wormholes / portals with swirling energy
Nebulae and turbulent cosmic gas clouds
Smoke rings / vortex rings
Abstract fluid simulations or ink-in-water effects
Glowing eyes / iris effects (Eye of Sauron style)
Explosive energy bursts or shockwaves
Atmospheric planetary glows or planetary rings

Xor’s turbulence technique (repeated p += sin(p.zxy * d + time) / d) is especially powerful — it produces fluid, organic motion extremely cheaply and scales well to many of the effects listed above.

"honestly the f4(1.1-cos(p),)/z/z/abs(len(t.xy)-1) is doing the heavy lifting. that abs in the denominator is a singularity trick to blow out the corona edges, most ppl skip it and wonder why theirs looks flat"

--explore this website, and replicate some elements locally;
https://fragcoord.xyz/explore

Among else:
Get inspiration from this effect: https://fragcoord.xyz/s/t7ug6jkj
To recreate a wormhole portal like effect.




