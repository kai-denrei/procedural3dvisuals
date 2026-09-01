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

// ── Controls panel ──────────────────────────────────────────────────────────
// On a phone this is a MODAL: closed by default, dismissible four ways, so the
// effect can be evaluated fullscreen. On desktop it is a persistent side rail,
// where a 320px column costs nothing and hiding it is an occasional wish.
//
// It used to open by default on mobile too, covering 62% of the screen, with
// the only exit a small unlabelled circle floating in the middle of the
// artwork. That toggle worked; nobody could tell it was a close button.
export function initImmersive() {
  const btn = $('btn-ui');
  const close = $('btn-close');
  const scrim = $('scrim');
  const rail = $('rail');
  const fab = $('fab');

  // "Modal" applies where the panel would cover the artwork. Above this width
  // the rail sits beside the canvas and never occludes it.
  const isModal = () => matchMedia('(max-width: 720px)').matches;

  function set(hidden, { persist = true } = {}) {
    document.body.classList.toggle('hide-ui', hidden);
    btn.setAttribute('aria-pressed', String(hidden));
    btn.setAttribute('aria-expanded', String(!hidden));
    btn.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
    btn.title = hidden ? 'Controls (h)' : 'Hide controls (h)';
    rail.setAttribute('aria-modal', String(isModal() && !hidden));
    // `hidden` rather than display, so the scrim can transition.
    if (isModal() && !hidden) scrim.hidden = false;
    else if (hidden) setTimeout(() => { scrim.hidden = true; }, 280);
    requestAnimationFrame(() => scrim.classList.toggle('on', isModal() && !hidden));
    // A modal's open/closed state is not a preference worth remembering — it
    // should always start closed. The desktop rail's IS.
    if (persist && !isModal()) {
      try { localStorage.setItem('p3dv.hideUI', hidden ? '1' : '0'); } catch { /* private mode */ }
    }
  }

  const toggle = () => set(!document.body.classList.contains('hide-ui'));
  const dismiss = () => set(true);

  btn.addEventListener('click', toggle);
  close.addEventListener('click', dismiss);
  scrim.addEventListener('click', dismiss);            // tap anywhere off the sheet
  addEventListener('keydown', (e) => {                 // Escape
    if (e.key === 'Escape' && !document.body.classList.contains('hide-ui')) dismiss();
  });

  // Swipe the sheet down to dismiss — the gesture a bottom sheet implies.
  //
  // Bound to the RAIL, not to its <header>. The visible grab handle is
  // `#rail::before`, and a pseudo-element belongs to its host — so a drag that
  // starts on the handle targets #rail and never reaches a listener on the
  // header. That is the one place a user is most likely to grab, and it was
  // the only place the gesture did nothing.
  //
  // Drags starting inside #panel are excluded so scrolling the controls, and
  // dragging a slider, never dismiss the sheet.
  const header = rail;
  const fromPanel = (e) => e.target.closest('#panel') || e.target.closest('button');
  let startY = null, lastDy = 0, dragging = false;
  header.addEventListener('pointerdown', (e) => {
    if (!isModal() || fromPanel(e)) return;
    startY = e.clientY; lastDy = 0; dragging = true;
    rail.style.transition = 'none';
    header.setPointerCapture?.(e.pointerId);
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    lastDy = Math.max(0, e.clientY - startY);          // remember it HERE:
    rail.style.transform = `translateY(${lastDy}px)`;  // pointerup/cancel does
  });                                                  // not reliably carry a
  const endDrag = (e) => {                             // position on touch end
    if (!dragging) return;
    dragging = false;
    // Release the capture taken in pointerdown. Leaving it held means the next
    // gesture on this element is delivered to a stale capture target, so the
    // second and later swipes silently do nothing.
    if (e && header.hasPointerCapture?.(e.pointerId)) header.releasePointerCapture(e.pointerId);
    rail.style.transition = '';
    rail.style.transform = '';
    if (lastDy > 60) dismiss();                        // far enough = intent
    lastDy = 0;
  };
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);
  header.addEventListener('lostpointercapture', () => { dragging = false; });

  // While immersive the opener dims into the artwork. Any touch wakes it for a
  // few seconds so it never becomes unfindable.
  let wakeTimer;
  addEventListener('pointerdown', () => {
    fab.classList.add('awake');
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => fab.classList.remove('awake'), 2600);
  }, { passive: true });

  // Start closed on mobile, always. Honour the stored preference on desktop.
  let initial = true;
  if (!isModal()) {
    try { initial = localStorage.getItem('p3dv.hideUI') === '1'; } catch { initial = false; }
  }
  set(initial, { persist: false });

  // Crossing the breakpoint changes the rules: a rail that was open on desktop
  // must not become a modal that is already covering the artwork.
  matchMedia('(max-width: 720px)').addEventListener('change', (e) => {
    if (e.matches) set(true, { persist: false });
  });

  return { set, toggle, dismiss };
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
