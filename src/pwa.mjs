// ─────────────────────────────────────────────────────────────────────────────
// pwa.mjs — service-worker registration, update prompting, install hint,
// fullscreen, wake lock, and the immersive (hide-UI) toggle.
//
// The immersive toggle is the mobile answer to the `h` key: a phone has no
// keyboard, so hiding the controls needs a control that outlives the controls.
// ─────────────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

// ── Service worker ──────────────────────────────────────────────────────────
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // file:// and plain http (other than localhost) have no SW. Not an error.
  if (!isSecureContext) { console.info('[pwa] insecure context — SW skipped'); return; }

  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });

      // A worker already waiting when we boot (user reopened without reloading).
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg);

      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          // `controller` null means this is the FIRST install — nothing to
          // update from, so prompting would be nonsense.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(reg);
        });
      });

      // The controller swapping means we asked for it. Reload once, not in a loop.
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch (err) {
      console.warn('[pwa] SW registration failed:', err.message);
    }
  });
}

function offerUpdate(reg) {
  const toast = $('toast');
  if (!toast) return;
  $('toast-msg').textContent = 'A new version is available.';
  toast.classList.add('show');
  $('toast-reload').onclick = () => {
    toast.classList.remove('show');
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  };
  $('toast-dismiss').onclick = () => toast.classList.remove('show');
}

// ── Fullscreen ──────────────────────────────────────────────────────────────
// iOS Safari has no Element.requestFullscreen on iPhone at all. There the
// honest answer is the installed PWA, which is already chrome-less — so the
// button reports that instead of silently doing nothing.
export function initFullscreen({ onChange } = {}) {
  const btn = $('btn-fs');
  const supported = !!(document.documentElement.requestFullscreen
                    || document.documentElement.webkitRequestFullscreen);

  if (!supported) {
    btn.title = standalone() ? 'Already fullscreen (installed)' : 'Fullscreen unavailable — install to home screen';
    btn.setAttribute('aria-disabled', 'true');
  }

  async function toggle() {
    if (!supported) { showInstallHint(true); return; }
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      } else {
        const el = document.documentElement;
        await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
      }
    } catch (err) { console.warn('[pwa] fullscreen:', err.message); }
  }

  btn.addEventListener('click', toggle);
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(ev, () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Exit fullscreen (f)' : 'Fullscreen (f)';
      onChange?.(on);
    });
  }
  return { toggle };
}

export const standalone = () =>
  matchMedia('(display-mode: standalone)').matches
  || matchMedia('(display-mode: fullscreen)').matches
  || navigator.standalone === true;          // iOS-only fallback

// ── Immersive toggle (hide UI) ──────────────────────────────────────────────
export function initImmersive() {
  const btn = $('btn-ui');
  const fab = $('fab');

  function set(hidden) {
    document.body.classList.toggle('hide-ui', hidden);
    btn.setAttribute('aria-pressed', String(hidden));
    btn.title = hidden ? 'Show controls (h)' : 'Hide controls (h)';
    btn.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
    try { localStorage.setItem('p3dv.hideUI', hidden ? '1' : '0'); } catch { /* private mode */ }
  }

  btn.addEventListener('click', () => set(!document.body.classList.contains('hide-ui')));

  // While immersive the FAB dims into the artwork. Any touch near it wakes it
  // for a few seconds so it never becomes unreachable.
  let wakeTimer;
  const wake = () => {
    fab.classList.add('awake');
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => fab.classList.remove('awake'), 2600);
  };
  addEventListener('pointerdown', wake, { passive: true });

  let initial = false;
  try { initial = localStorage.getItem('p3dv.hideUI') === '1'; } catch { /* ignore */ }
  set(initial);
  return { set, toggle: () => set(!document.body.classList.contains('hide-ui')) };
}

// ── Wake lock ───────────────────────────────────────────────────────────────
// A shader you are watching produces no input events, so the phone dims and
// sleeps. Re-acquired on visibility change because the lock is dropped when
// the tab is backgrounded.
export function initWakeLock() {
  if (!('wakeLock' in navigator)) return;
  let lock = null;
  const acquire = async () => {
    try { lock = await navigator.wakeLock.request('screen'); }
    catch { /* denied, low battery, or not user-activated — non-fatal */ }
  };
  acquire();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && lock?.released !== false) acquire();
  });
}

// ── Install hint ────────────────────────────────────────────────────────────
// Chrome/Android give us beforeinstallprompt. iOS gives us nothing, so Safari
// users get a manual Add-to-Home-Screen hint — shown once, and only when not
// already installed.
export function initInstall() {
  let deferred = null;
  const toast = $('toast');
  const dismissed = () => { try { return localStorage.getItem('p3dv.installDismissed') === '1'; } catch { return true; } };
  const dismiss = () => { try { localStorage.setItem('p3dv.installDismissed', '1'); } catch { /* ignore */ } };

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (dismissed() || standalone()) return;
    show('Install for fullscreen, offline use, and no browser gestures.', 'Install', async () => {
      toast.classList.remove('show');
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      dismiss();
    });
  });

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
             || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS && !standalone() && !dismissed()) {
    setTimeout(() => show('Add to Home Screen (Share ➔ Add to Home Screen) for fullscreen with no edge-swipe navigation.', 'Got it', () => {
      toast.classList.remove('show'); dismiss();
    }), 4000);
  }

  function show(msg, label, onClick) {
    if (!toast || toast.classList.contains('show')) return;
    $('toast-msg').textContent = msg;
    const go = $('toast-reload');
    go.textContent = label;
    go.onclick = onClick;
    $('toast-dismiss').textContent = 'Not now';
    $('toast-dismiss').onclick = () => { toast.classList.remove('show'); dismiss(); };
    toast.classList.add('show');
  }
  return { showInstallHint: show };
}

let _hintShown = false;
function showInstallHint() {
  if (_hintShown) return;
  _hintShown = true;
  const toast = $('toast');
  if (!toast) return;
  $('toast-msg').textContent = 'iOS has no fullscreen API. Add to Home Screen (Share ➔ Add to Home Screen) for a chrome-less, gesture-free view.';
  $('toast-reload').textContent = 'Got it';
  $('toast-reload').onclick = () => toast.classList.remove('show');
  $('toast-dismiss').style.display = 'none';
  toast.classList.add('show');
}
