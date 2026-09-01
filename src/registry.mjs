// ─────────────────────────────────────────────────────────────────────────────
// registry.mjs — the effect catalogue.
//
// Each entry is a plain data description: shader path + parameter schema.
// The UI is generated from `params`; the uniform block is generated from the
// same source, so a control and its uniform can never drift apart.
//
// `def` is the FAITHFUL value — the one that reproduces the reference look.
// "Reset" returns here. Record any tuned-away-from-default variant you like in
// .deban/roles/ux.md rather than silently changing `def`.
// ─────────────────────────────────────────────────────────────────────────────

const P = (def, min, max, step, label, help) => ({ def, min, max, step, label, help });
const I = (def, min, max, label, help) => ({ def, min, max, step: 1, int: true, label, help });

// Mark a param as cost-relevant. `bench.mjs` re-times the effect with each of
// these halved to report what a cut actually buys — measured, not assumed.
// Only flag things that change the AMOUNT of work (loop bounds, march limits),
// not things that change what the work produces.
const costly = (schema) => ({ ...schema, cost: true });

/** Params shared by both effects — the raymarch + turbulence + tonemap core. */
const CORE = {
  uSteps:       costly(I(40, 4, 160, 'March steps', 'Ray samples. Cost is linear; detail saturates ~64.')),
  uTurbOctaves: costly(I(6, 1, 12, 'Turb octaves', 'Sine folds per step. Total cost = steps x octaves.')),
  uTurbAmp:     P(1.0, 0.0, 3.0, 0.01, 'Turb amount', 'Warp strength. 0 = clean geometry, no plasma.'),
  uTurbFreq:    P(2.0, 0.25, 8.0, 0.05, 'Turb base freq', 'Starting frequency; doubles each octave.'),
  uStepScale:   P(1.0 / 3.0, 0.05, 1.0, 0.005, 'Step scale', 'March damping. Lower = slower, more accurate, brighter.'),
  uColorBias:   P(1.1, 1.0, 2.5, 0.01, 'Colour bias', 'Cosine offset. At 1.0 channels touch zero and go black.'),
  uExposure:    P(30.0, 2.0, 200.0, 0.5, 'Exposure', 'tanh divisor. Lower = brighter/flatter.'),
  uEpsilon:     P(1e-4, 1e-6, 1e-1, 1e-6, 'Singularity clamp', 'Floor on the 1/x rim term. Raise to tame the blowout.'),
};

export const EFFECTS = {
  corona: {
    label: 'Corona',
    note: "XorDev's 'Coronal', un-golfed. Ring singularity + sine turbulence.",
    frag: 'shaders/corona.frag',
    credit: {
      origin: 'XorDev — "Coronal"',
      via: [{ label: 'fragcoord.xyz', url: 'https://fragcoord.xyz' }],
      note: 'Un-golfed and parameterised from the published listing.',
    },
    params: {
      ...CORE,
      uRingRadius: P(1.0, 0.1, 3.0, 0.01, 'Ring radius', 'Radius of the unit cylinder the ray grazes.'),
    },
  },

  'corona-golfed': {
    label: 'Corona (golfed)',
    note: 'Verbatim dialect transcription. Must match Corona exactly at defaults.',
    frag: 'shaders/corona-golfed.frag',
    credit: {
      origin: 'XorDev — "Coronal"',
      via: [{ label: 'fragcoord.xyz', url: 'https://fragcoord.xyz' }],
      note: 'Near-verbatim transcription of the original golfed listing.',
    },
    params: {},           // hard-coded constants — that is the point of this entry
  },

  wormhole: {
    label: 'Wormhole',
    note: 'Portal travel: moving camera + depth twist + depth-keyed hue.',
    frag: 'shaders/wormhole.frag',
    credit: {
      origin: 'Original, by this project',
      via: [{ label: "derived from XorDev's turbulence technique", url: 'https://fragcoord.xyz' }],
      note: 'Same raymarch + singularity machine as Corona, retargeted to a tunnel.',
    },
    params: {
      ...CORE,
      uExposure:     P(150.0, 2.0, 600.0, 1.0, 'Exposure', 'tanh divisor. Lower = brighter/flatter. Wormhole needs ~3x Corona: nearly every ray crosses the throat, so far more rays hit the singularity.'),
      uThroatRadius: P(1.0, 0.1, 3.0, 0.01, 'Throat radius', 'Tunnel wall radius.'),
      uSpeed:        P(1.6, -6.0, 6.0, 0.02, 'Travel speed', 'Forward rate. Negative flies backwards out of the portal.'),
      uTwist:        P(0.35, -2.0, 2.0, 0.005, 'Twist / depth', 'Swirl per unit depth. The "wormhole" cue.'),
      uSpin:         P(0.15, -2.0, 2.0, 0.005, 'Barrel roll', 'Constant rotation, independent of depth.'),
      uHueSpread:    P(0.5, 0.0, 3.2, 0.01, 'Hue spread', 'Per-channel cosine phase offset. Above ~0.8 it reads as a full rainbow rather than a portal.'),
      uDepthHue:     P(0.12, -1.5, 1.5, 0.005, 'Hue / depth', 'Colour drift from mouth to vanishing point.'),
      uMinStep:      P(0.02, 0.0, 0.3, 0.001, 'Min step', 'March floor. 0 stalls the march at the wall.'),
      uNear:         P(1.5, 0.05, 4.0, 0.01, 'Near', 'Ray start distance. Below ~1.2 the throat crossing moves off-screen and the rim floods the whole frame instead of forming a ring.'),
    },
  },

  'motion-cube': {
    label: 'Motion Cube',
    note: 'A cube unfolding into its own net — six hinged slabs, rendered volumetrically.',
    frag: 'shaders/motion-cube.frag',
    credit: {
      origin: 'Jaenam (Jae) — "MotionCube"',
      via: [{ label: 'fragcoord.xyz/s/mr7xc988', url: 'https://fragcoord.xyz/s/mr7xc988' }],
      license: { id: 'CC-BY-NC-SA-4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
                 warn: 'NON-COMMERCIAL only, and derivatives must carry the same licence.' },
      note: 'Structure, unfold and shading are Jaenam\'s. Parameterised here, plus a manual open drive.',
    },
    params: {
      uOpenAuto:    P(1.0, 0.0, 1.0, 1.0, 'Auto open', 'ON cycles the fold with time. OFF hands it to the Open slider — drive that from game state for a chest, portal or boss shell.'),
      uOpen:        P(0.4, 0.0, 1.0, 0.005, 'Open', '0 = sealed cube, 1 = flat net. Only used when Auto open is OFF.'),
      uSpeed:       P(1.0, 0.05, 4.0, 0.01, 'Speed', 'Animation rate.'),
      uSpin:        P(1.0, 0.0, 3.0, 0.01, 'Tumble', 'Rotation amplitude. 0 holds a fixed isometric view.'),
      uZoom:        P(0.9, 0.3, 2.0, 0.005, 'Zoom', 'Base zoom; the effect modulates it as the cube opens.'),
      uSize:        P(4.0, 1.0, 8.0, 0.05, 'Face size', 'Half-extent of each face slab.'),
      uThick:       P(0.2, 0.02, 1.5, 0.005, 'Face thickness', 'Slab thickness. Thicker reads as armour plate.'),
      uTexScale:    P(0.8, 0.1, 3.0, 0.01, 'Texture scale', 'Scale of the face-local pattern coordinate.'),
      uHoloDensity: P(2.0, 0.5, 8.0, 0.05, 'Holo density', 'Lattice cells per unit — the ring pattern frequency.'),
      uHoloAmount:  P(4.0, 0.0, 12.0, 0.05, 'Holo amount', 'Strength of the holographic rings. 0 leaves the base gradient.'),
      uTurbOctaves: costly(I(3, 0, 8, 'Turb octaves', 'Triangle-wave fold octaves. Harder-edged than a sine fold.')),
      uSteps:       costly(I(100, 8, 200, 'March steps', 'Volumetric accumulation steps.')),
      uGlow:        P(1.0, 0.1, 4.0, 0.01, 'Glow', 'Multiplier before the tonemap.'),
      uExposure:    P(1e7, 1e6, 5e7, 1e5, 'Exposure', 'tanh divisor. The original value is 1e7.'),
      uFov:         P(1.2, 0.4, 3.0, 0.01, 'FOV', 'Ray spread.'),
    },
  },

  'motion-solids': {
    label: 'Motion Solids',
    note: 'Polyhedra unfolding into their nets — pyramid, tetrahedron, cube, octahedron, dodecahedron, hex prism.',
    frag: 'shaders/motion-solids.frag',
    credit: {
      origin: 'Original to this project',
      via: [{ label: "inspired by Jaenam's MotionCube (independent implementation)", url: 'https://fragcoord.xyz/s/mr7xc988' }],
      note: 'Clean-room: polar-folded domain, own face SDFs and shading. No code derived, so no non-commercial restriction — unlike Motion Cube.',
    },
    params: {
      uSolid:      I(4, 0, 5, 'Solid', '0 tetrahedron · 1 square pyramid · 2 cube · 3 octahedron · 4 dodecahedron · 5 hex prism'),
      uOpen:       P(0.35, 0.0, 1.0, 0.005, 'Open', '0 = closed solid, 1 = flat net. Drive this from game state.'),
      uOpenAuto:   P(1.0, 0.0, 1.0, 1.0, 'Auto open', 'ON cycles the fold with time.'),
      uSpeed:      P(0.5, 0.05, 3.0, 0.01, 'Speed', 'Fold cycle rate.'),
      uSize:       P(1.6, 0.4, 4.0, 0.01, 'Size', ''),
      uThick:      P(0.045, 0.005, 0.3, 0.001, 'Face thickness', 'Slab thickness as a fraction of size. Thicker reads as armour plate.'),
      uRound:      P(0.02, 0.0, 0.2, 0.002, 'Rounding', 'Radius subtracted from the whole field.'),
      uSteps:      costly(I(90, 8, 200, 'March steps', 'Sphere-tracing steps.')),
      uStepScale:  P(0.8, 0.2, 1.0, 0.005, 'Step damping', 'Below 1: the polar fold makes the field non-Lipschitz near the seams, so a full step can overshoot.'),
      uFar:        costly(P(26.0, 5.0, 60.0, 0.5, 'Far distance', '')),
      uPanel:      P(0.35, 0.0, 2.0, 0.01, 'Panel lines', 'Grid + ring drawn in FACE-LOCAL space, so it rides each flap as it swings.'),
      uPanelScale: P(1.6, 0.2, 8.0, 0.02, 'Panel scale', 'Panel frequency.'),
      uGlowAmount: P(1.0, 0.0, 6.0, 0.01, 'Glow', 'Proximity aura from the march distance.'),
      uGlowTight:  P(8.0, 0.5, 40.0, 0.05, 'Glow tightness', ''),
      uRim:        P(0.8, 0.0, 3.0, 0.01, 'Rim', 'Fresnel edge.'),
      uHueA:       P(3.9, 0.0, 6.283, 0.01, 'Hue A', ''),
      uHueB:       P(5.4, 0.0, 6.283, 0.01, 'Hue B', ''),
      uExposure:   P(2.2, 0.3, 10.0, 0.01, 'Exposure', ''),
      uSpinX:      P(0.15, -2.0, 2.0, 0.005, 'Spin X', ''),
      uSpinY:      P(0.28, -2.0, 2.0, 0.005, 'Spin Y', ''),
      uFov:        P(1.5, 0.5, 4.0, 0.01, 'FOV', ''),
      uCamDist:    P(9.0, 2.0, 24.0, 0.05, 'Camera distance', 'Far enough that the fully unfolded NET still fits the frame — the net is much wider than the closed solid.'),
      uCupGap:     P(1.0, 0.0, 2.0, 0.005, 'Cup gap', 'Dodecahedron only, as a multiple of the DERIVED offset — 1.0 is the exact value that makes the two cups meet (2·ba·sin 63.435°). Move it only to pull the halves apart deliberately.'),
    },
  },

  'sdf-primitives': {
    label: 'SDF Primitives',
    note: '12 primitives, continuous morph between any two, and an "open" that separates them along their own axes.',
    frag: 'shaders/sdf-primitives.frag',
    credit: {
      origin: 'Original to this project',
      via: [{ label: "distance functions by Inigo Quilez (MIT)", url: 'https://iquilezles.org/articles/distfunctions/' }],
      note: 'Deliberately NOT derived from Motion Cube, so it carries no non-commercial restriction.',
    },
    params: {
      uShapeA:     I(1, 0, 11, 'Shape A', '0 sphere · 1 box · 2 torus · 3 octahedron · 4 capsule · 5 cylinder · 6 cone · 7 hex prism · 8 pyramid · 9 square torus · 10 link · 11 ellipsoid'),
      uShapeB:     I(3, 0, 11, 'Shape B', 'The morph target. Same numbering as Shape A.'),
      uMorph:      P(0.0, 0.0, 1.0, 0.005, 'Morph', '0 = A, 1 = B. Only used when Auto morph is OFF.'),
      uMorphAuto:  P(1.0, 0.0, 1.0, 1.0, 'Auto morph', 'ON cycles A↔B with time.'),
      uOpen:       P(0.0, 0.0, 1.0, 0.005, 'Open', 'Separates the shape along its own octants. Box → exploded net, sphere → cracked shell.'),
      uOpenAuto:   P(0.0, 0.0, 1.0, 1.0, 'Auto open', 'ON cycles the separation with time.'),
      uScale:      P(1.0, 0.3, 3.0, 0.01, 'Scale', ''),
      uRound:      P(0.05, 0.0, 0.5, 0.005, 'Rounding', 'Radius subtracted from every primitive — the cheap way to round any SDF.'),
      uSpinX:      P(0.18, -2.0, 2.0, 0.005, 'Spin X', ''),
      uSpinY:      P(0.32, -2.0, 2.0, 0.005, 'Spin Y', ''),
      uSteps:      costly(I(90, 8, 200, 'March steps', 'Sphere-tracing steps.')),
      uStepScale:  P(0.85, 0.2, 1.0, 0.005, 'Step damping', 'Below 1 because a MORPHED field is not a true SDF and a full step can overshoot the surface. Raise it and you will see the shape crack apart mid-morph.'),
      uFar:        costly(P(24.0, 5.0, 60.0, 0.5, 'Far distance', 'Ray give-up distance.')),
      uGlowAmount: P(1.0, 0.0, 6.0, 0.01, 'Glow', 'Proximity aura, accumulated from the march distance — free, it is already computed.'),
      uGlowTight:  P(6.0, 0.5, 40.0, 0.05, 'Glow tightness', 'Higher hugs the surface; lower fills the frame.'),
      uRim:        P(0.9, 0.0, 3.0, 0.01, 'Rim', 'Fresnel edge strength.'),
      uHueA:       P(3.6, 0.0, 6.283, 0.01, 'Hue A', ''),
      uHueB:       P(5.1, 0.0, 6.283, 0.01, 'Hue B', ''),
      uExposure:   P(2.4, 0.3, 10.0, 0.01, 'Exposure', 'tanh divisor.'),
      uFov:        P(1.6, 0.5, 4.0, 0.01, 'FOV', ''),
      uCamDist:    P(4.2, 1.5, 15.0, 0.05, 'Camera distance', ''),
    },
  },

  'melting-jelly': {
    label: 'Melting Jelly',
    note: 'SDF raymarch with refraction. smin() blends cube → puddle; the blend WIDTH growing is the melt.',
    frag: 'shaders/melting-jelly.frag',
    credit: {
      origin: 'noztol — "Melting Jello"',
      via: [{ label: 'fragcoord.xyz/s/m78o8vry', url: 'https://fragcoord.xyz/s/m78o8vry' }],
      note: 'SDF structure, smin blend and refraction shading are noztol\'s; parameterised here, plus a manual melt drive.',
    },
    params: {
      uMeltAuto:     P(1.0, 0.0, 1.0, 1.0, 'Auto melt', 'ON oscillates with time. OFF hands control to the Melt slider — that is the hook for driving this from game state (boss HP, a timeline).'),
      uMelt:         P(0.35, 0.0, 1.0, 0.005, 'Melt', '0 solid, 1 puddle. Only used when Auto melt is OFF.'),
      uMeltSpeed:    P(1.5, 0.05, 6.0, 0.01, 'Melt speed', 'Oscillation rate when Auto melt is ON.'),
      uSpread:       P(2.2, 0.0, 6.0, 0.02, 'Spread', 'Distance of the three blobs from centre. At 0 they fuse into one mass.'),
      uScale:        P(1.0, 0.2, 3.0, 0.01, 'Scale', 'Overall blob size.'),
      uHueShift:     P(0.0, 0.0, 6.283, 0.01, 'Hue shift', 'Rotates all three colours together.'),
      uIOR:          P(1.31, 1.0, 2.4, 0.005, 'Index of refraction', '1.0 = no bending (looks like coloured fog). 1.31 is ice; 1.5 is glass.'),
      uAbsorb:       P(4.5, 0.0, 15.0, 0.05, 'Absorption', "Beer's law strength. Higher = denser, more saturated body."),
      uFresnelPow:   P(5.0, 0.5, 12.0, 0.05, 'Fresnel power', 'Rim tightness. Lower spreads the sheen across the whole surface.'),
      uReflect:      P(0.6, 0.0, 1.0, 0.005, 'Reflectivity', 'How much floor reflection mixes in at the rim.'),
      uSteps:        costly(I(90, 8, 160, 'March steps', 'Primary march. Each step evaluates 3 SDFs — this is the dominant cost.')),
      uRefractSteps: costly(I(30, 2, 60, 'Refraction steps', 'Inside-surface march. Drop first if you need frames back; it degrades gracefully.')),
      uFar:          costly(P(30.0, 5.0, 80.0, 0.5, 'Far distance', 'Ray give-up distance.')),
      uCamDist:      P(11.0, 3.0, 30.0, 0.05, 'Camera distance', ''),
      uCamPitch:     P(0.45, 0.0, 1.0, 0.005, 'Camera pitch', '0 = horizon, 1 = top-down.'),
      uAutoRotate:   P(0.3, -2.0, 2.0, 0.005, 'Auto-rotate', 'Radians per second. 0 holds still for a fixed camera.'),
      uFov:          P(1.5, 0.5, 4.0, 0.01, 'FOV', 'Larger = narrower, less perspective distortion.'),
      uFloorScale:   P(1.5, 0.1, 6.0, 0.01, 'Floor checker', 'Checkerboard frequency.'),
      uFog:          P(0.015, 0.0, 0.15, 0.001, 'Fog', 'Distance fog on the floor.'),
    },
  },

  'metal-grid-flow': {
    label: 'Metal Grid Flow',
    note: 'Iridescent foil: 2D grid + radial wave + polar sweep. No raymarch.',
    frag: 'shaders/metal-grid-flow.frag',
    credit: {
      origin: 'harsh — Shadertoy "dtKfDD"',
      via: [
        { label: 'Shadertoy original', url: 'https://www.shadertoy.com/view/dtKfDD' },
        { label: 'fragcoord port by koncreate (Kong)', url: 'https://fragcoord.xyz/s/gt8966nk' },
      ],
      note: 'Structure and constants unchanged; parameterised and adapted to this uniform contract.',
    },
    params: {
      uIterations:  costly(I(4, 1, 8, 'Iterations', 'Channels are written for the first 3. The 4th still advances z and l, which the final divide uses — see the shader header.')),
      uZSpeed:      P(1.0, -4.0, 4.0, 0.01, 'Time scale', 'Overall animation rate. Negative runs the sheen backwards.'),
      uZStep:       P(0.05, 0.0, 0.6, 0.001, 'Channel offset', 'Time offset per colour channel. THIS is the iridescence — at 0 the foil turns monochrome.'),
      uGridFreq:    P(30.0, 2.0, 90.0, 0.5, 'Grid frequency', 'Cell density of the sin*cos lattice.'),
      uGridAmp:     P(0.65, 0.0, 2.0, 0.01, 'Grid amount', 'Distortion strength. 0 leaves clean concentric cells.'),
      uGridPhase:   P(25.0, 0.0, 60.0, 0.1, 'Grid phase', 'Offset between the x and y lattice terms; shifts the weave.'),
      uWaveFreq:    P(7.0, 0.0, 30.0, 0.05, 'Wave frequency', 'Radial ring density.'),
      uWaveSpeed:   P(1.0, -4.0, 4.0, 0.01, 'Wave speed', 'Rate the rings travel outward.'),
      uPolarScale:  P(3.0, 0.0, 12.0, 0.05, 'Polar scale', 'How fast angular frequency grows with radius. The swept, brushed-metal look.'),
      uBrightness:  P(0.033, 0.001, 0.3, 0.001, 'Brightness', 'Numerator of the 1/distance emission.'),
      uFalloff:     P(0.5, 0.01, 4.0, 0.01, 'Falloff', 'The +0.5 in c/(l+0.5). Lower blows out the near field.'),
      uCenterX:     P(0.5, -1.0, 2.0, 0.01, 'Centre X', 'Origin of the radial field, in normalised units.'),
      uCenterY:     P(1.0, -1.0, 2.0, 0.01, 'Centre Y', 'Default 1.0 puts the origin off the top edge — that asymmetry is why the sheen sweeps rather than radiating from the middle.'),
    },
  },
};

export const DEFAULT_EFFECT = 'corona';

/** Extract just the default values, for building the uniform block. */
export function defaults(name) {
  const out = {};
  for (const [k, s] of Object.entries(EFFECTS[name].params)) out[k] = s.def;
  return out;
}
