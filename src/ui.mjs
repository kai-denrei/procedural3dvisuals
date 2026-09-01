// ─────────────────────────────────────────────────────────────────────────────
// ui.mjs — control panel generated from the registry's param schema.
// No framework: the schema is the single source of truth for both the DOM and
// the uniform block, so a slider cannot exist without its uniform.
// ─────────────────────────────────────────────────────────────────────────────

import { EFFECTS } from './registry.mjs';
import { copyLink, copyParams, exportParamsJSON, exportFrag, exportStandaloneHTML } from './export.mjs';

const fmt = (v, step) => {
  if (Number.isInteger(step) && step >= 1) return String(Math.round(v));
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(1);
  return v.toFixed(step >= 0.01 ? 2 : 3);
};

export function buildUI(spec, material, state, reload, ctx = {}) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';

  // ── attribution ───────────────────────────────────────────────────────────
  // Credit lives in the registry so it travels with the effect into exports and
  // embeds, rather than sitting only in a README nobody copies.
  if (spec.credit) {
    const box = el('div', { class: 'credit' });
    box.append(el('span', { class: 'credit-origin' }, spec.credit.origin));
    for (const v of spec.credit.via ?? []) {
      box.append(el('a', { href: v.url, target: '_blank', rel: 'noopener noreferrer' }, v.label));
    }
    if (spec.credit.note) box.append(el('small', {}, spec.credit.note));
    panel.append(box);
  }

  // ── effect switcher ───────────────────────────────────────────────────────
  const sel = el('select', { id: 'fx-select' });
  for (const [key, s] of Object.entries(EFFECTS)) {
    sel.append(el('option', { value: key, selected: s === spec }, s.label));
  }
  sel.onchange = () => reload(sel.value);
  panel.append(row('Effect', sel));

  // ── global toggles ────────────────────────────────────────────────────────
  const scale = el('input', { type: 'range', min: 0.25, max: 1, step: 0.05, value: state.resScale });
  const scaleOut = el('span', { class: 'val' }, `${state.resScale.toFixed(2)}x`);
  scale.oninput = () => {
    state.resScale = parseFloat(scale.value);
    scaleOut.textContent = `${state.resScale.toFixed(2)}x`;
    window.dispatchEvent(new Event('resize'));
  };
  panel.append(row('Render scale', scale, scaleOut, 'Internal resolution multiplier. Drop it if the fps counter sags.'));

  const ot = el('input', { type: 'checkbox', checked: state.outputTransform });
  ot.onchange = () => { state.outputTransform = ot.checked; reload(sel.value); };
  panel.append(row('three.js output transform', ot, null,
    "OFF = verbatim framebuffer write (faithful to fragcoord.xyz). ON = routed through linearToOutputTexel() + toneMapping(), i.e. what this effect will look like inside a scene that has tone mapping enabled. Check both before porting."));

  // ── per-effect params ─────────────────────────────────────────────────────
  const entries = Object.entries(spec.params);
  if (!entries.length) {
    panel.append(el('p', { class: 'empty' }, 'This effect has no exposed parameters — constants are baked in by design.'));
  }

  const controls = [];
  for (const [key, s] of entries) {
    const input = el('input', {
      type: 'range', min: s.min, max: s.max, step: s.step, value: s.def,
    });
    const out = el('span', { class: 'val' }, fmt(s.def, s.step));
    input.oninput = () => {
      const v = s.int ? Math.round(parseFloat(input.value)) : parseFloat(input.value);
      material.uniforms[key].value = v;
      out.textContent = fmt(v, s.step);
    };
    controls.push(() => {
      input.value = s.def;
      material.uniforms[key].value = s.def;
      out.textContent = fmt(s.def, s.step);
    });
    panel.append(row(s.label, input, out, s.help));
  }

  // ── actions ───────────────────────────────────────────────────────────────
  const reset = el('button', {}, 'Reset to faithful defaults');
  reset.onclick = () => controls.forEach((f) => f());

  const rl = el('button', {}, 'Reload shader');
  rl.onclick = () => reload(sel.value);

  panel.append(el('div', { class: 'actions' }, reset, rl));

  // ── export ────────────────────────────────────────────────────────────────
  panel.append(el('h2', { class: 'group' }, 'Export'));
  const key = ctx.effectName ?? sel.value;
  const u = material.uniforms;

  const flash = (btn, msg) => {
    const original = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = original; btn.classList.remove('ok'); }, 1400);
  };

  const mk = (label, help, fn) => {
    const b = el('button', {}, label);
    b.onclick = async () => {
      try { const r = await fn(b); flash(b, r === false ? 'Failed' : 'Done'); }
      catch (err) { console.error('[export]', err); flash(b, 'Failed'); }
    };
    return el('div', { class: 'exp-row' }, b, el('small', {}, help));
  };

  panel.append(
    mk('Copy deeplink', 'URL with every non-default value. Short, readable, hand-editable.',
       () => copyLink(key, u)),
    mk('Copy variables', 'JSON snapshot of the current values, with credit and a permalink.',
       () => copyParams(key, u)),
    mk('Download JSON', 'Same snapshot as a file. Frozen — unlike a deeplink, it will not follow future default changes.',
       () => { exportParamsJSON(key, u); }),
    mk('Download .frag', 'Shader with #includes resolved and a credit header. Paste into any GLSL host.',
       () => { exportFrag(key, ctx.source ?? material.userData.sourceForErrors ?? ''); }),
    mk('Download standalone .html', 'One self-contained file: raw WebGL2, no three.js, no build, no network. Current values baked in.',
       () => { exportStandaloneHTML(key, ctx.source ?? material.userData.sourceForErrors ?? '', u); }),
  );

  panel.append(el('p', { class: 'keys' },
    'space pause · r restart · h hide UI · f fullscreen · s save PNG'));
}

// ── tiny DOM helpers ────────────────────────────────────────────────────────
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'checked' || k === 'selected') n[k] = !!v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
}

function row(label, input, out, help) {
  const r = el('div', { class: 'row' });
  r.append(el('label', {}, label));

  // A checkbox gets wrapped in a <label> so the whole strip is a hit target.
  // At 26px the switch itself is under the 44px touch minimum, and enlarging
  // it would look clumsy — the label carries the area instead.
  let line;
  if (input.type === 'checkbox') {
    const state = el('span', { class: 'switch-state' }, input.checked ? 'on' : 'off');
    input.addEventListener('change', () => { state.textContent = input.checked ? 'on' : 'off'; });
    line = el('label', { class: 'line switch' }, input, state);
  } else {
    line = el('div', { class: 'line' }, input);
    if (out) line.append(out);
  }
  r.append(line);
  if (help) r.append(el('small', {}, help));
  return r;
}
