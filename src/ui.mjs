// ─────────────────────────────────────────────────────────────────────────────
// ui.mjs — control panel generated from the registry's param schema.
// No framework: the schema is the single source of truth for both the DOM and
// the uniform block, so a slider cannot exist without its uniform.
// ─────────────────────────────────────────────────────────────────────────────

import { EFFECTS } from './registry.mjs';

const fmt = (v, step) => {
  if (Number.isInteger(step) && step >= 1) return String(Math.round(v));
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(1);
  return v.toFixed(step >= 0.01 ? 2 : 3);
};

export function buildUI(spec, material, state, reload) {
  const panel = document.getElementById('panel');
  panel.innerHTML = '';

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
  panel.append(el('p', { class: 'keys' },
    'space pause · r restart · h hide UI · s save PNG'));
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
