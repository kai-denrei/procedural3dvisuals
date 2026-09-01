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
    params: {
      ...CORE,
      uRingRadius: P(1.0, 0.1, 3.0, 0.01, 'Ring radius', 'Radius of the unit cylinder the ray grazes.'),
    },
  },

  'corona-golfed': {
    label: 'Corona (golfed)',
    note: 'Verbatim dialect transcription. Must match Corona exactly at defaults.',
    frag: 'shaders/corona-golfed.frag',
    params: {},           // hard-coded constants — that is the point of this entry
  },

  wormhole: {
    label: 'Wormhole',
    note: 'Portal travel: moving camera + depth twist + depth-keyed hue.',
    frag: 'shaders/wormhole.frag',
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
};

export const DEFAULT_EFFECT = 'corona';

/** Extract just the default values, for building the uniform block. */
export function defaults(name) {
  const out = {};
  for (const [k, s] of Object.entries(EFFECTS[name].params)) out[k] = s.def;
  return out;
}
