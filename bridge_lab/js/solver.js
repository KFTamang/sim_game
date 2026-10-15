/*
 * solver.js — 2D pin-jointed truss solver (direct stiffness method)
 *
 * - Members carry axial force only (pin joints).
 * - Tension limit: yield (sigma_y * A)
 * - Compression limit: Euler buckling combined with yield (Rankine-Gordon):
 *       1/Pc = 1/Py + 1/Pe,  Pe = pi^2 E I / L^2
 * - The structure is linear, so one solve for the dead load and one for a
 *   unit live load give the exact load factor at which the first member fails.
 *
 * Works both in the browser (window.Solver) and in node (module.exports).
 */
(function (root) {
  'use strict';

  const PHYS = {
    E: 200e9,            // Young's modulus of steel [Pa]
    SIGY: 250e6,         // yield stress [Pa]
    RHO: 7850,           // density [kg/m^3]
    G: 9.81,             // gravity [m/s^2]
    DECK_KG_PER_M: 80,   // road surface weight (dead load, free of charge) [kg/m]
    MAX_DECK_SPAN: 2,    // longest deck stretch that may go unsupported [m]
  };

  // outer radii of the available sections [m]
  const RADII = [0.008, 0.012, 0.018, 0.026, 0.038];

  const TYPES = {
    rod: { label: '丸棒', price: 1.0 },
    tube: { label: 'パイプ', price: 1.5, ratio: 0.9 }, // inner/outer radius
  };

  function section(type, size) {
    const ro = RADII[size];
    let A, I;
    if (type === 'tube') {
      const ri = ro * TYPES.tube.ratio;
      A = Math.PI * (ro * ro - ri * ri);
      I = (Math.PI / 4) * (Math.pow(ro, 4) - Math.pow(ri, 4));
    } else {
      A = Math.PI * ro * ro;
      I = (Math.PI / 4) * Math.pow(ro, 4);
    }
    return { A, I, ro, massPerM: A * PHYS.RHO };
  }

  /** Cholesky solve of K x = b for several b. K is overwritten. Returns null if singular. */
  function choleskySolve(K, n, rhsList) {
    let maxd = 0;
    for (let i = 0; i < n; i++) maxd = Math.max(maxd, K[i * n + i]);
    const tol = maxd * 1e-8;
    for (let j = 0; j < n; j++) {
      let d = K[j * n + j];
      for (let k = 0; k < j; k++) d -= K[j * n + k] * K[j * n + k];
      if (!(d > tol)) return null;
      d = Math.sqrt(d);
      K[j * n + j] = d;
      for (let i = j + 1; i < n; i++) {
        let s = K[i * n + j];
        for (let k = 0; k < j; k++) s -= K[i * n + k] * K[j * n + k];
        K[i * n + j] = s / d;
      }
    }
    return rhsList.map((b) => {
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = b[i];
        for (let k = 0; k < i; k++) s -= K[i * n + k] * y[k];
        y[i] = s / K[i * n + i];
      }
      const x = new Float64Array(n);
      for (let i = n - 1; i >= 0; i--) {
        let s = y[i];
        for (let k = i + 1; k < n; k++) s -= K[k * n + i] * x[k];
        x[i] = s / K[i * n + i];
      }
      return x;
    });
  }

  /**
   * stage:  { span, load: 'udl'|'point' }
   * design: { nodes:[{x,y,fixed}], members:[{a,b,type,size}] }
   */
  function analyze(stage, design) {
    const nodes = design.nodes;
    const members = design.members;
    const nn = nodes.length;

    const res = {
      status: 'ok',        // ok | roadBroken | deckSpan | unstable | deadFail
      mass: 0,
      cost: 0,
      lambda: 0,           // load factor == total live load capacity [kN]
      capacity: 0,         // [kN]
      critical: -1,
      mode: '',
      members: [],
      reach: new Array(nn).fill(false),
      brokenRoad: [],      // indices of road gaps (x of left node)
      longDeck: [],        // x of unsupported deck stretches that are too long
      floppy: [],          // node indices that move freely (mechanism)
      dispDead: new Array(nn).fill(null).map(() => [0, 0]),
      dispLive: new Array(nn).fill(null).map(() => [0, 0]),
    };

    // ---------- mass / cost / section properties ----------
    members.forEach((m, i) => {
      const a = nodes[m.a], b = nodes[m.b];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const s = section(m.type, m.size);
      const mass = s.massPerM * L;
      res.mass += mass;
      res.cost += mass * TYPES[m.type].price;
      const Py = PHYS.SIGY * s.A;
      const Pe = (Math.PI * Math.PI * PHYS.E * s.I) / (L * L);
      res.members.push({
        L, mass, A: s.A, I: s.I, ro: s.ro,
        Py, Pe,
        capT: Py,
        capC: 1 / (1 / Py + 1 / Pe),
        Nd: 0, Nl: 0, reach: false,
      });
    });

    // ---------- road continuity ----------
    const span = stage.span;
    const roadNode = new Array(span + 1).fill(-1);
    nodes.forEach((n, i) => {
      if (n.y === 0 && n.x >= 0 && n.x <= span && Number.isInteger(n.x)) roadNode[n.x] = i;
    });
    const linked = new Set();
    members.forEach((m) => linked.add(Math.min(m.a, m.b) + '-' + Math.max(m.a, m.b)));
    for (let x = 0; x < span; x++) {
      const a = roadNode[x], b = roadNode[x + 1];
      if (a < 0 || b < 0 || !linked.has(Math.min(a, b) + '-' + Math.max(a, b))) res.brokenRoad.push(x);
    }
    if (res.brokenRoad.length) {
      res.status = 'roadBroken';
      return res;
    }

    // ---------- deck nodes with no support of their own ("pass-through" nodes) ----------
    // A deck node that has nothing but its two deck neighbours is not a joint: the deck
    // acts as a floor beam between the two joints, which must be at most MAX_DECK_SPAN apart.
    const inc = nodes.map(() => []);
    members.forEach((m, i) => { inc[m.a].push(i); inc[m.b].push(i); });
    const deckPiece = (m) => {
      const a = nodes[m.a], b = nodes[m.b];
      return a.y === 0 && b.y === 0 && Math.abs(a.x - b.x) === 1;
    };
    const pass = nodes.map((n, i) => n.y === 0 && !n.fixed && n.x > 0 && n.x < span &&
      inc[i].length === 2 && inc[i].every((k) => deckPiece(members[k])));
    const fe = [];                        // finite elements: {a, b, L, keff, pieces}
    const chainOf = new Array(nn).fill(null); // pass node -> {j1, j2, t}
    const usedM = new Array(members.length).fill(false);
    members.forEach((m, k) => {
      if (pass[m.a] || pass[m.b]) return;
      usedM[k] = true;
      const r = res.members[k];
      fe.push({ a: m.a, b: m.b, L: r.L, keff: (PHYS.E * r.A) / r.L, pieces: [k] });
    });
    nodes.forEach((jn, j) => {
      if (pass[j] || jn.y !== 0) return;
      inc[j].forEach((k0) => {
        if (usedM[k0]) return;
        const path = [k0];
        let prev = j;
        let cur = members[k0].a === j ? members[k0].b : members[k0].a;
        const walk = [];
        while (pass[cur]) {
          walk.push(cur);
          const k = inc[cur].find((kk) => kk !== path[path.length - 1]);
          path.push(k);
          prev = cur;
          cur = members[k].a === prev ? members[k].b : members[k].a;
        }
        path.forEach((k) => { usedM[k] = true; });
        const Lc = Math.abs(nodes[cur].x - jn.x);
        let compliance = 0;
        path.forEach((k) => { compliance += res.members[k].L / (PHYS.E * res.members[k].A); });
        fe.push({ a: j, b: cur, L: Lc, keff: 1 / compliance, pieces: path });
        walk.forEach((w) => {
          chainOf[w] = { j1: j, j2: cur, t: Math.abs(nodes[w].x - jn.x) / Lc };
        });
        // buckling length of a deck chord is the whole unsupported length
        path.forEach((k) => {
          const r = res.members[k];
          r.Pe = (Math.PI * Math.PI * PHYS.E * r.I) / (Lc * Lc);
          r.capC = 1 / (1 / r.Py + 1 / r.Pe);
        });
        if (Lc > PHYS.MAX_DECK_SPAN + 1e-9) res.longDeck.push(Math.min(jn.x, nodes[cur].x));
      });
    });
    // chains were visited from both ends; drop the mirrored duplicate
    {
      const seen = new Set();
      for (let q = fe.length - 1; q >= 0; q--) {
        const key = fe[q].pieces.slice().sort((u, v) => u - v).join(',');
        if (seen.has(key)) fe.splice(q, 1); else seen.add(key);
      }
    }
    if (res.longDeck.length) {
      res.status = 'deckSpan';
      return res;
    }

    // ---------- reachability from anchors ----------
    const adj = nodes.map(() => []);
    fe.forEach((e, q) => { adj[e.a].push(e.b); adj[e.b].push(e.a); });
    const stack = [];
    nodes.forEach((n, i) => { if (n.fixed) { res.reach[i] = true; stack.push(i); } });
    while (stack.length) {
      const u = stack.pop();
      for (const v of adj[u]) if (!res.reach[v]) { res.reach[v] = true; stack.push(v); }
    }
    nodes.forEach((_, i) => { if (chainOf[i]) res.reach[i] = res.reach[chainOf[i].j1] && res.reach[chainOf[i].j2]; });
    fe.forEach((e) => { e.reach = res.reach[e.a] && res.reach[e.b]; e.pieces.forEach((k) => { res.members[k].reach = e.reach; }); });

    // ---------- dof numbering ----------
    const dof = new Array(nn).fill(-1);
    let n = 0;
    nodes.forEach((nd, i) => { if (res.reach[i] && !nd.fixed && !chainOf[i]) { dof[i] = n; n += 2; } });
    if (n === 0) { res.status = 'unstable'; return res; }

    // ---------- loads ----------
    const fDead = new Float64Array(n);
    const fLive = new Float64Array(n);
    const addLoad = (vec, node, fy) => {
      const c = chainOf[node];
      if (c) {
        if (dof[c.j1] >= 0) vec[dof[c.j1] + 1] += fy * (1 - c.t);
        if (dof[c.j2] >= 0) vec[dof[c.j2] + 1] += fy * c.t;
      } else if (dof[node] >= 0) vec[dof[node] + 1] += fy;
    };
    members.forEach((m, i) => {
      if (!res.members[i].reach) return;
      const w = res.members[i].mass * PHYS.G;
      addLoad(fDead, m.a, -w / 2);
      addLoad(fDead, m.b, -w / 2);
    });
    for (let x = 0; x < span; x++) {
      const w = PHYS.DECK_KG_PER_M * 1 * PHYS.G;
      addLoad(fDead, roadNode[x], -w / 2);
      addLoad(fDead, roadNode[x + 1], -w / 2);
    }
    // live load: nominal total of 1 kN (so lambda == capacity in kN)
    if (stage.load === 'point') {
      addLoad(fLive, roadNode[Math.round(span / 2)], -1000);
    } else {
      const per = 1000 / (span - 1);
      for (let x = 1; x < span; x++) addLoad(fLive, roadNode[x], -per);
    }

    // ---------- stiffness matrix ----------
    const K = new Float64Array(n * n);
    fe.forEach((e) => {
      if (!e.reach) return;
      const a = nodes[e.a], b = nodes[e.b];
      const c = (b.x - a.x) / e.L, s = (b.y - a.y) / e.L;
      const k = e.keff;
      const T = [c * c, c * s, c * s, s * s];
      const idx = [dof[e.a], dof[e.b]];
      for (let p = 0; p < 2; p++) {
        for (let q = 0; q < 2; q++) {
          if (idx[p] < 0 || idx[q] < 0) continue;
          const sign = p === q ? 1 : -1;
          K[(idx[p]) * n + idx[q]] += sign * k * T[0];
          K[(idx[p]) * n + idx[q] + 1] += sign * k * T[1];
          K[(idx[p] + 1) * n + idx[q]] += sign * k * T[2];
          K[(idx[p] + 1) * n + idx[q] + 1] += sign * k * T[3];
        }
      }
    });

    const Kcopy = Float64Array.from(K);
    const sol = choleskySolve(Kcopy, n, [fDead, fLive]);
    if (!sol) {
      res.status = 'unstable';
      // regularised solve just to find which nodes are floppy
      const Kr = Float64Array.from(K);
      let md = 0;
      for (let i = 0; i < n; i++) md = Math.max(md, K[i * n + i]);
      for (let i = 0; i < n; i++) Kr[i * n + i] += md * 1e-7;
      const probe = new Float64Array(n);
      for (let i = 0; i < n; i++) probe[i] = fDead[i] + fLive[i] * 50;
      const s2 = choleskySolve(Kr, n, [probe]);
      if (s2) {
        const mag = nodes.map((_, i) => (dof[i] >= 0 ? Math.hypot(s2[0][dof[i]], s2[0][dof[i] + 1]) : 0));
        const mx = Math.max(...mag);
        mag.forEach((v, i) => { if (dof[i] >= 0 && v > mx * 0.2 && v > 1e-3) res.floppy.push(i); });
      }
      return res;
    }
    const [uD, uL] = sol;
    const uAt = (u, node) => (dof[node] >= 0 ? [u[dof[node]], u[dof[node] + 1]] : [0, 0]);
    nodes.forEach((_, i) => {
      const c = chainOf[i];
      if (c) {
        const lerp = (u) => {
          const p1 = uAt(u, c.j1), p2 = uAt(u, c.j2);
          return [p1[0] * (1 - c.t) + p2[0] * c.t, p1[1] * (1 - c.t) + p2[1] * c.t];
        };
        res.dispDead[i] = lerp(uD);
        res.dispLive[i] = lerp(uL);
      } else if (dof[i] >= 0) {
        res.dispDead[i] = uAt(uD, i);
        res.dispLive[i] = uAt(uL, i);
      }
    });

    // ---------- member forces ----------
    const axial = (e, u) => {
      const a = nodes[e.a], b = nodes[e.b];
      const c = (b.x - a.x) / e.L, s = (b.y - a.y) / e.L;
      const ua = uAt(u, e.a), ub = uAt(u, e.b);
      return e.keff * ((ub[0] - ua[0]) * c + (ub[1] - ua[1]) * s);
    };
    fe.forEach((e) => {
      if (!e.reach) return;
      const Nd = axial(e, uD), Nl = axial(e, uL); // tension positive; Nl per 1 kN of live load
      e.pieces.forEach((k) => { res.members[k].Nd = Nd; res.members[k].Nl = Nl; });
    });

    // ---------- load factor at first failure ----------
    let lam = Infinity, crit = -1, mode = '';
    members.forEach((m, i) => {
      const r = res.members[i];
      if (!r.reach) return;
      let l = Infinity, md = '';
      const compMode = r.Pe < r.Py ? 'buckling' : 'crush';
      if (r.Nd > r.capT) { l = -1; md = 'tension'; }
      else if (r.Nd < -r.capC) { l = -1; md = compMode; }
      else if (r.Nl > 1e-9) { l = (r.capT - r.Nd) / r.Nl; md = 'tension'; }
      else if (r.Nl < -1e-9) { l = (-r.capC - r.Nd) / r.Nl; md = compMode; }
      if (l < lam) { lam = l; crit = i; mode = md; }
    });
    res.critical = crit;
    res.mode = mode;
    if (lam < 0) {
      res.status = 'deadFail';
      res.lambda = 0;
      res.capacity = 0;
    } else {
      res.lambda = Math.min(lam, 1e6);
      res.capacity = res.lambda;
    }
    return res;
  }

  /** signed utilisation (>0 tension, <0 compression) of member i at live load factor lam */
  function utilAt(res, i, lam) {
    const r = res.members[i];
    if (!r.reach) return 0;
    const N = r.Nd + lam * r.Nl;
    return N >= 0 ? N / r.capT : N / r.capC;
  }

  const api = { PHYS, RADII, TYPES, section, analyze, utilAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Solver = api;
})(typeof window !== 'undefined' ? window : globalThis);
