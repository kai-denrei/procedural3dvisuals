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

/** Params shared by both effects — the raymarch + turbulence + tonemap core. */
const CORE = {
  uSteps:       I(40, 4, 160, 'March steps', 'Ray samples. Cost is linear; detail saturates ~64.'),
  uTurbOctaves: I(6, 1, 12, 'Turb octaves', 'Sine folds per step. Total cost = steps x octaves.'),
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
      uSteps:        I(90, 8, 160, 'March steps', 'Primary march. Each step evaluates 3 SDFs — this is the dominant cost.'),
      uRefractSteps: I(30, 2, 60, 'Refraction steps', 'Inside-surface march. Drop first if you need frames back; it degrades gracefully.'),
      uFar:          P(30.0, 5.0, 80.0, 0.5, 'Far distance', 'Ray give-up distance.'),
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
      uIterations:  I(4, 1, 8, 'Iterations', 'Channels are written for the first 3. The 4th still advances z and l, which the final divide uses — see the shader header.'),
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
