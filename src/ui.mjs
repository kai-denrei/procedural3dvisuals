// ─────────────────────────────────────────────────────────────────────────────
// ui.mjs — control panel generated from the registry's param schema.
// No framework: the schema is the single source of truth for both the DOM and
// the uniform block, so a slider cannot exist without its uniform.
// ─────────────────────────────────────────────────────────────────────────────

import { EFFECTS } from './registry.mjs';
import { copyLink, copyParams, exportParamsJSON, exportFrag, exportStandaloneHTML } from './export.mjs';
import { fullReport, BUDGET } from './bench.mjs';

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
      if (s.cost) ctx.onParamChange?.();   // a cost-relevant edit invalidates the measurement
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

  // ── compute cost ──────────────────────────────────────────────────────────
  // Measured on this device, not modelled. See bench.mjs for why a static
  // loop-count estimator gets the answer backwards.
  panel.append(el('h2', { class: 'group' }, 'Compute cost'));
  const costBox = el('div', { class: 'cost' });
  const runBtn = el('button', {}, 'Measure on this device');
  costBox.append(runBtn);
  const costOut = el('div', { class: 'cost-out' });
  costBox.append(costOut);
  costBox.append(el('small', {},
    'Renders off-screen and forces a GPU sync — an fps counter cannot see this (it reads 60 either way). Numbers are for THIS device; a phone will differ by an order of magnitude.'));
  panel.append(costBox);

  let lastReport = null;
  const markStale = () => {
    if (lastReport) costOut.classList.add('stale');
  };

  runBtn.onclick = () => {
    runBtn.disabled = true;
    runBtn.textContent = 'Measuring…';
    costOut.classList.remove('stale');
    // Yield a frame so the button repaints before the GPU work blocks.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const r = ctx.measure();
        lastReport = r;
        renderCost(costOut, r);
        runBtn.textContent = 'Re-measure';
      } catch (err) {
        console.error('[bench]', err);
        costOut.innerHTML = '';
        costOut.append(el('p', { class: 'cost-err' }, 'Measurement failed — see console.'));
        runBtn.textContent = 'Measure on this device';
      } finally {
        runBtn.disabled = false;
      }
    }));
  };
  ctx.onParamChange = markStale;
  ctx.getReport = () => lastReport;

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
       () => copyParams(key, u, ctx.getReport?.())),
    mk('Download JSON', 'Same snapshot as a file. Frozen — unlike a deeplink, it will not follow future default changes.',
       () => { exportParamsJSON(key, u, ctx.getReport?.()); }),
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


// ── cost report rendering ───────────────────────────────────────────────────
const ms = (v) => (v < 0.01 ? '<0.01' : v.toFixed(2));

function renderCost(host, r) {
  host.innerHTML = '';

  const v = el('p', { class: `verdict v-${r.verdict.level}` }, r.verdict.text);
  host.append(v);

  const t = el('table', { class: 'cost-table' });
  t.append(el('tr', {},
    el('th', {}, 'target'), el('th', {}, 'ms'), el('th', {}, '% of 60fps frame')));
  for (const row of r.resolutions) {
    const bar = el('div', { class: 'bar' });
    const fill = el('div', { class: 'bar-fill' });
    fill.style.width = Math.min(100, row.pct60).toFixed(1) + '%';
    if (row.pct60 >= 50) fill.style.background = 'var(--err)';
    else if (row.pct60 >= 20) fill.style.background = 'var(--warn)';
    bar.append(fill);
    t.append(el('tr', {},
      el('td', {}, `${row.key === 'native' ? 'viewport' : row.key + '²'}`),
      el('td', { class: 'num' }, ms(row.ms)),
      el('td', {}, bar, el('span', { class: 'num pct' }, row.pct60.toFixed(1) + '%'))));
  }
  host.append(t);

  if (r.sensitivity.params.length) {
    host.append(el('h3', { class: 'sub' }, `What a cut buys (measured at ${r.sensitivity.size}²)`));
    const list = el('ul', { class: 'sens' });
    for (const p of r.sensitivity.params) {
      const sign = p.direction === 'cheaper'  ? `saves ${p.savedPct.toFixed(0)}%`
                 : p.direction === 'costlier' ? `costs ${Math.abs(p.savedPct).toFixed(0)}% more`
                 : 'within noise';
      const cls = p.direction === 'cheaper' ? 'good' : p.direction === 'costlier' ? 'bad' : 'none';
      list.append(el('li', {},
        el('span', { class: 'sens-k' }, `${p.label} ${p.from} → ${p.to}`),
        el('span', { class: 'sens-v ' + cls }, sign)));
    }
    host.append(list);
    host.append(el('small', {},
      `Anything under ±${r.sensitivity.floorPct.toFixed(0)}% is inside this run's own variation and is reported as noise. `
      + 'If nothing here is significant, the effect is resolution-bound rather than iteration-bound — cut the render target size instead.'));
  }

  host.append(el('p', { class: 'device' },
    `${r.device.renderer} · dpr ${r.device.dpr}`,
    el('br'),
    `calibrated at ${r.calibration.size}² → ${r.calibration.msPerMP.toFixed(3)} ms/megapixel `
    + `(±${r.calibration.spreadPct.toFixed(0)}%). Smaller targets are predicted from that and `
    + `run slightly ABOVE the prediction, never below.`));
}
