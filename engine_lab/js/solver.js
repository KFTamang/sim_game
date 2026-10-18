/*
 * solver.js — Engine Lab: a single-zone, crank-angle resolved model of a four-stroke
 * spark-ignition engine (one cylinder, 0.5 L).
 *
 * The closed part of the cycle (intake valve closes -> exhaust valve opens) is integrated with the
 * first law for an ideal gas with temperature-dependent cv:
 *     m cv dT = -p dV + dQ_combustion - dQ_wall
 *  - heat release: Wiebe function starting at the spark (plus a short ignition delay)
 *  - wall heat loss: Woschni-type film coefficient
 *  - knock: Livengood-Wu integral of 1/tau (Douaud-Eyzat autoignition delay) for the unburned gas
 * The open part (intake, exhaust) is handled with simple pressure levels: throttling, valve
 * timing (late intake closing = Miller/Atkinson effect, early exhaust opening = blow-down loss).
 *
 * Crank angle: 0 deg = TDC of the power stroke (combustion), -360 = start of intake,
 * -180 = bottom dead centre (BDC) before compression, +180 = BDC at the end of expansion.
 */
(function (root) {
  'use strict';

  const ENGINE = {
    bore: 0.086, stroke: 0.086, rod: 0.150,
    Rgas: 287, LHV: 44e6, AFR: 14.7,
    p0: 1.0e5, Tint: 330, Twall: 450,
  };
  const D2R = Math.PI / 180;
  const A_CR = ENGINE.stroke / 2;
  const VD = (Math.PI / 4) * ENGINE.bore * ENGINE.bore * ENGINE.stroke;   // displacement (m^3)

  const volume = (th, r) => {
    const Vc = VD / (r - 1), R = ENGINE.rod / A_CR, c = Math.cos(th * D2R), s = Math.sin(th * D2R);
    return Vc * (1 + ((r - 1) / 2) * (R + 1 - c - Math.sqrt(R * R - s * s)));
  };
  const cv = (T) => 650 + 0.22 * T;                        // J/(kg K)
  const wallArea = (th, r) => {
    const Vc = VD / (r - 1), V = volume(th, r), B = ENGINE.bore;
    const x = (V - Vc) / ((Math.PI / 4) * B * B);          // piston distance from TDC
    return (Math.PI / 2) * B * B + Math.PI * B * (x + Vc / ((Math.PI / 4) * B * B));
  };

  // defaults for every adjustable parameter
  const DEFAULTS = { r: 10, spark: 20, ivc: 30, evo: 40, lambda: 1.0, throttle: 1.0, boost: 1.0, rpm: 2500, octane: 91, burn: 45 };

  /*
   * simulate(params) -> {
   *   ok, knock, knockI, trapped, pmax, imep, pmep, fmep, bmep, eta (brake), etaInd, torque, power,
   *   energy: {fuel, work, friction, pumping, wall, exhaust, unburned},
   *   trace: { th[], p[], V[], T[], xb[] }
   * }
   */
  function simulate(par) {
    const q = Object.assign({}, DEFAULTS, par);
    const { r, rpm } = q;
    const thIvc = -180 + q.ivc, thEvo = 180 - q.evo, thSpark = -q.spark;
    const dth = 0.5;
    const dtPer = 1 / (6 * rpm);                                // seconds per degree

    // --- gas exchange levels
    const Tint = ENGINE.Tint + 45 * (q.boost - 1);                  // intercooled, but not perfectly
    const pInt = Math.max(0.2e5, q.throttle * q.boost * ENGINE.p0 - 0.04e5);
    const Vivc = volume(thIvc, r), Vtdc = VD / (r - 1), Vbdc = VD + Vtdc;
    const mAir = 0.95 * pInt * Vivc / (ENGINE.Rgas * Tint);
    const m = mAir * (1 + 1 / (q.lambda * ENGINE.AFR));         // charge mass (air + fuel)
    const mFuel = mAir / (q.lambda * ENGINE.AFR);

    // combustion efficiency: rich -> CO / HC, very lean -> partial burn / misfire
    let etaC = 1;
    if (q.lambda < 1) etaC -= 0.55 * (1 - q.lambda);
    if (q.lambda > 1.15) etaC -= 0.9 * Math.pow(q.lambda - 1.15, 2) * 4;
    etaC = Math.max(0.3, etaC);
    const Qin = mFuel * ENGINE.LHV * etaC;
    // burn duration: slower when lean; ignition delay shrinks with density
    const burn = q.burn * (1 + 1.6 * Math.max(0, q.lambda - 1));
    const delay = (4 + 6 * Math.max(0, q.lambda - 1)) ;      // degrees
    const th0 = thSpark + delay;
    const wiebe = (th) => (th <= th0 ? 0 : 1 - Math.exp(-6.9 * Math.pow((th - th0) / burn, 3)));

    // initial state at IVC
    let T = Tint + 25, p = m * ENGINE.Rgas * T / Vivc;
    const pIvc = p, Tivc = T;
    let Qloss = 0, Wclosed = 0, xPrev = 0, I = 0, knock = false, knockI = 0, pmax = p, Iat95 = null;
    const ON = q.octane;
    const trace = { th: [], p: [], V: [], T: [], xb: [] };
    const Sp = 2 * ENGINE.stroke * rpm / 60;                    // mean piston speed
    let V = Vivc;
    for (let th = thIvc; th < thEvo - 1e-9; th += dth) {
      const V2 = volume(th + dth, r), dV = V2 - V;
      const xb = wiebe(th + dth), dx = xb - xPrev; xPrev = xb;
      const dQin = Qin * dx;
      // Woschni (simplified): p in kPa, w in m/s
      const w = 2.28 * Sp + (th > th0 - 20 ? 0.3 * Sp : 0);
      const h = 3.26 * Math.pow(ENGINE.bore, -0.2) * Math.pow(p / 1000, 0.8) * Math.pow(T, -0.55) * Math.pow(w, 0.8);
      const dQl = 2.3 * h * wallArea(th, r) * Math.max(0, T - ENGINE.Twall) * dtPer * dth;
      Qloss += dQl;
      Wclosed += p * dV;
      T += (-p * dV + dQin - dQl) / (m * cv(T));
      V = V2; p = m * ENGINE.Rgas * T / V;
      if (p > pmax) pmax = p;
      // knock integral on the unburned gas (isentropic compression of the end gas)
      if (Iat95 === null) {
        const Tu = Tivc * Math.pow(Math.max(p, pIvc) / pIvc, 0.26);
        const patm = p / 1.013e5;
        const tau = 17.68 * Math.pow(ON / 100, 3.402) * Math.pow(patm, -1.7) * Math.exp(3800 / Tu) * 4.24e-3;   // s (scaled so that 91 octane knocks near r = 11)
        I += (dtPer * dth) / tau;
        if (xb >= 0.95) Iat95 = I;
      }
      if (((th + dth) * 2) % 8 === 0) { trace.th.push(th + dth); trace.p.push(p); trace.V.push(V); trace.T.push(T); trace.xb.push(xb); }
    }
    knockI = Iat95 === null ? I : Iat95;
    knock = knockI >= 1;
    const pEvo = p, Tevo = T;

    // --- open cycle: exhaust blow-down, exhaust stroke, intake stroke
    const pb = (1.05 + 0.5 * (q.boost - 1)) * 1e5;                // turbine back-pressure grows with boost
    const dpExh = 0.9e5 * (pEvo / 3.5e5) * (rpm / 2500) * Math.exp(-q.evo / 30);
    const pExh = pb + dpExh;
    const Vevo = volume(thEvo, r);
    const Wexh = pb * (Vbdc - Vevo) - pExh * (Vbdc - Vtdc);
    const Wint = pInt * (Vivc - Vtdc);   // intake stroke minus the part pushed back before the valve closes
    const Wnet = Wclosed + Wexh + Wint;
    const Wpump = Wexh + Wint;                                  // negative = loss
    const n = rpm / 1000;
    const fmep = (0.7 + 0.15 * n + 0.035 * n * n) * 1e5 + 0.25e5 * Math.max(0, (pmax - 50e5) / 50e5);
    const imep = Wnet / VD, pmep = Wpump / VD, bmep = imep - fmep;
    const Wfric = fmep * VD, Wbrake = Wnet - Wfric;
    const Qfuel = mFuel * ENGINE.LHV;
    const eta = Wbrake / Qfuel, etaInd = Wnet / Qfuel;
    const torque = (bmep * VD) / (4 * Math.PI);                 // N m
    const power = (torque * 2 * Math.PI * rpm / 60) / 1000;     // kW
    const exhaust = Math.max(0, Qin - Wclosed - Qloss);          // sensible energy left at EVO
    const energy = {
      fuel: Qfuel, work: Math.max(0, Wbrake), friction: Wfric, pumping: Math.max(0, -Wpump),
      wall: Qloss, exhaust: 0, unburned: Qfuel - Qin,
    };
    energy.exhaust = Math.max(0, Qfuel - energy.work - energy.friction - energy.pumping - energy.wall - energy.unburned);   // sensible heat left at EVO
    void exhaust;
    return { ok: true, knock, knockI, pInt, pExh, pIvc, Tint, Vivc, Vevo, Vtdc, Vbdc, pmax, imep, pmep, fmep, bmep, eta, etaInd, torque, power, mFuel, Wbrake, Wnet, pEvo, Tevo, energy, trace, par: q, thIvc, thEvo, thSpark, th0, burn };
  }

  // ---------------------------------------------------------------------------- scoring
  // objective per stage. Returns { score, valid, value, note }
  function evaluate(st, par) {
    const q = Object.assign({}, DEFAULTS, st.fixed || {}, par);
    const r = simulate(q);
    let valid = !r.knock, note = '';
    const value = st.objective === 'torque' ? r.bmep / 1e5 : r.eta;
    if (r.knock) note = 'ノッキング(異常燃焼)';
    else if (st.minBmep && r.bmep < st.minBmep * 1e5) { valid = false; note = `出力不足(平均有効圧 ${(r.bmep / 1e5).toFixed(1)} < ${st.minBmep} bar)`; }
    else if (r.pmax > 90e5) { valid = false; note = '最高圧力が高すぎる(90 bar超)'; }
    const score = valid ? Math.max(0, Math.round((1000 * (value - st.floor)) / (st.ref - st.floor))) : 0;
    return { r, valid, value, score, note };
  }

  const api = { ENGINE, VD, DEFAULTS, volume, simulate, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
