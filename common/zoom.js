/*
 * zoom.js — pinch-to-zoom / two-finger pan / wheel zoom for the games' canvases.
 *
 *   const Z = ViewZoom.attach(canvas, { onChange, cancel });
 *   Z.k, Z.tx, Z.ty      current zoom (>= 1) and translation (screen px)
 *   Z.setSize(w, h)      call whenever the canvas CSS size changes (clamps the pan)
 *   Z.reset()
 *
 * A game computes its normal ("base") layout and then maps base coordinates with
 *   screen = base * Z.k + Z.t
 * One finger keeps working exactly as before (paint / draw). As soon as a second
 * finger lands, `cancel()` is called (so the game can undo the half-started stroke) and
 * the gesture is handled here; the game's own handlers do not see those events.
 */
(function (root) {
  'use strict';

  function attach(el, opts) {
    opts = opts || {};
    const maxK = opts.max || 6;
    const Z = { k: 1, tx: 0, ty: 0, w: 1, h: 1 };
    const pts = new Map();
    let gesturing = false, last = null;

    const btn = document.createElement('button');
    btn.textContent = '⤢ 全体表示';
    btn.hidden = true;
    btn.style.cssText = 'position:absolute;right:10px;bottom:10px;z-index:5;padding:6px 10px;border-radius:16px;' +
      'border:1px solid #2a3a54;background:#172233e0;color:#e6edf6;font:12px system-ui,sans-serif;cursor:pointer;';
    if (el.parentElement) el.parentElement.appendChild(btn);

    function clampPan() {
      Z.k = Math.min(maxK, Math.max(1, Z.k));
      if (Z.k === 1) { Z.tx = 0; Z.ty = 0; return; }
      Z.tx = Math.min(0, Math.max(Z.w * (1 - Z.k), Z.tx));
      Z.ty = Math.min(0, Math.max(Z.h * (1 - Z.k), Z.ty));
    }
    function changed() { clampPan(); btn.hidden = Z.k <= 1.01; if (opts.onChange) opts.onChange(Z); }
    // zoom by factor f keeping the content under (m0) fixed, then move it to m
    function zoomAbout(f, m0, m) {
      const k0 = Z.k, k1 = Math.min(maxK, Math.max(1, k0 * f));
      const g = k1 / k0;
      Z.tx = m.x - (m0.x - Z.tx) * g;
      Z.ty = m.y - (m0.y - Z.ty) * g;
      Z.k = k1;
      changed();
    }
    Z.setSize = (w, h) => { Z.w = w; Z.h = h; clampPan(); btn.hidden = Z.k <= 1.01; };
    Z.reset = () => { Z.k = 1; Z.tx = 0; Z.ty = 0; changed(); };
    btn.onclick = () => Z.reset();

    const rel = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    function two() {
      const [a, b] = Array.from(pts.values());
      return { m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    }

    el.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, rel(e));
      if (pts.size >= 2) {
        if (!gesturing && opts.cancel) opts.cancel();
        gesturing = true; last = two();
      }
      if (gesturing) { e.stopImmediatePropagation(); e.preventDefault(); }
    });
    el.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, rel(e));
      if (gesturing) {
        if (pts.size >= 2) {
          const cur = two();
          zoomAbout(cur.d / last.d, last.m, cur.m);
          last = cur;
        }
        e.stopImmediatePropagation();
      }
    });
    const up = (e) => {
      const was = gesturing;
      pts.delete(e.pointerId);
      if (pts.size < 2 && was) last = null;
      if (pts.size === 0) gesturing = false;
      if (was) e.stopImmediatePropagation();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = rel(e);
      zoomAbout(Math.exp(-e.deltaY * 0.0015), p, p);
    }, { passive: false });

    return Z;
  }

  root.ViewZoom = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
