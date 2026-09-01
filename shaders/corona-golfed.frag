#include "common.glsl"
// Near-verbatim transcription of the original golfed listing, using the
// dialect aliases in common.glsl. Kept as a live check that the aliases are
// faithful: this and corona.frag at default params must render identically.
// Differences forced by real GLSL: explicit loop syntax, `out` declaration,
// and vec4(...,0) for the trailing-comma constructor the platform auto-fills.
void main() {
    f4 O = f4(0);
    f z = 2., d;
    f3 rd = nor(f3(2. * gl_FragCoord.xy - R.xy, -R.y));
    for (int i = 0; i < 40; i++) {
        f3 p = z * rd, t = p;
        d = 2.;
        for (int j = 0; j < 6; j++) { d += d; p += sin(p.zxy * d + z - T) / d; }
        z += abs(1. - len(p.xy)) / 3.;
        O += f4(1.1 - cos(p), 0) / z / z / abs(len(t.xy) - 1.);
    }
    writeOut(tanh(O.rgb / 30.));
}
