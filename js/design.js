/*
 * design.js — the editable bridge model (nodes on a 1 m grid + members).
 * Pure data manipulation, no DOM, so it can be tested in node.
 */
(function (root) {
  'use strict';

  const EPS = 1e-9;

  function createDesign(stage) {
    const nodes = [];
    // road nodes at every metre of the deck line (y = 0). Ends are anchors.
    for (let x = 0; x <= stage.span; x++) {
      nodes.push({ x, y: 0, fixed: x === 0 || x === stage.span, road: true });
    }
    return { nodes, members: [] };
  }

  function clone(d) { return JSON.parse(JSON.stringify(d)); }

  /** Can a node live at this grid point? */
  function isValidPoint(stage, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (x === 0 || x === stage.span) return y <= 0 && y >= -stage.anchorDepth; // anchor on the cliff face
    if (x < 0 || x > stage.span) return false;
    return y <= stage.yMax && y >= stage.yMin;
  }

  function findNode(d, x, y) {
    return d.nodes.findIndex((n) => n.x === x && n.y === y);
  }

  function ensureNode(stage, d, x, y) {
    let i = findNode(d, x, y);
    if (i >= 0) return i;
    const fixed = x === 0 || x === stage.span;
    d.nodes.push({ x, y, fixed });
    i = d.nodes.length - 1;
    splitMembersAt(d, i);
    return i;
  }

  /** If node i lies strictly inside an existing member, split that member in two. */
  function splitMembersAt(d, i) {
    const p = d.nodes[i];
    for (let k = d.members.length - 1; k >= 0; k--) {
      const m = d.members[k];
      if (m.a === i || m.b === i) continue;
      const a = d.nodes[m.a], b = d.nodes[m.b];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) > EPS) continue;
      const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
      const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
      if (dot <= EPS || dot >= len2 - EPS) continue;
      const b0 = m.b;
      m.b = i;
      d.members.push({ a: i, b: b0, type: m.type, size: m.size });
    }
  }

  function segIntersect(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < EPS) return null;
    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
    if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }

  /**
   * Add a member between two grid points. Nodes are created where needed, the new
   * member is split at every node it passes through, and crossings with existing
   * members that fall exactly on a grid point become joints.
   * Returns { ok, reason }.
   */
  function addSegment(stage, d, p, q, type, size) {
    if (p.x === q.x && p.y === q.y) return { ok: false, reason: '長さがありません' };
    if (!isValidPoint(stage, p.x, p.y) || !isValidPoint(stage, q.x, q.y)) return { ok: false, reason: '置けない場所です' };
    // a segment must not run through the cliff
    if (Math.min(p.x, q.x) < 0 || Math.max(p.x, q.x) > stage.span) return { ok: false, reason: '地面の中です' };
    if ((p.x === 0 && q.x === 0) || (p.x === stage.span && q.x === stage.span)) return { ok: false, reason: '崖に沿っては置けません' };

    // 1. joints at grid-point crossings with existing members
    const A = { x: p.x, y: p.y }, B = { x: q.x, y: q.y };
    const crossings = [];
    d.members.forEach((m) => {
      const hit = segIntersect(A, B, d.nodes[m.a], d.nodes[m.b]);
      if (hit && Math.abs(hit.x - Math.round(hit.x)) < 1e-6 && Math.abs(hit.y - Math.round(hit.y)) < 1e-6) {
        crossings.push({ x: Math.round(hit.x), y: Math.round(hit.y) });
      }
    });
    const pts = [A, ...crossings, B];

    // 2. create endpoint / crossing nodes
    const idxs = pts.map((pt) => ensureNode(stage, d, pt.x, pt.y));

    // 3. collect every node lying on the segment, ordered along it
    const dx = B.x - A.x, dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const onSeg = [];
    d.nodes.forEach((n, i) => {
      const cross = dx * (n.y - A.y) - dy * (n.x - A.x);
      if (Math.abs(cross) > EPS) return;
      const t = ((n.x - A.x) * dx + (n.y - A.y) * dy) / len2;
      if (t < -EPS || t > 1 + EPS) return;
      onSeg.push({ i, t });
    });
    onSeg.sort((u, v) => u.t - v.t);

    // 4. one member per consecutive pair (replace section if it already exists)
    let made = 0;
    for (let k = 0; k + 1 < onSeg.length; k++) {
      const a = onSeg[k].i, b = onSeg[k + 1].i;
      if (d.nodes[a].fixed && d.nodes[b].fixed) continue;
      const ex = d.members.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
      if (ex) { ex.type = type; ex.size = size; } else d.members.push({ a, b, type, size });
      made++;
    }
    void idxs;
    if (!made) { cleanup(d); return { ok: false, reason: 'アンカー同士は結べません' }; }
    return { ok: true };
  }

  /** Remove a member; drop free-floating, non-road nodes that become orphaned. */
  function removeMember(d, k) {
    d.members.splice(k, 1);
    cleanup(d);
  }

  function cleanup(d) {
    const used = new Array(d.nodes.length).fill(false);
    d.members.forEach((m) => { used[m.a] = true; used[m.b] = true; });
    const remap = new Array(d.nodes.length).fill(-1);
    const nodes = [];
    d.nodes.forEach((n, i) => {
      if (used[i] || n.road) { remap[i] = nodes.length; nodes.push(n); }
    });
    d.nodes = nodes;
    d.members.forEach((m) => { m.a = remap[m.a]; m.b = remap[m.b]; });
  }

  function paintMember(d, k, type, size) {
    d.members[k].type = type;
    d.members[k].size = size;
  }

  /** nearest member to a world point, or -1 */
  function pickMember(d, wx, wy, tol) {
    let best = -1, bd = tol;
    d.members.forEach((m, k) => {
      const a = d.nodes[m.a], b = d.nodes[m.b];
      const vx = b.x - a.x, vy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * vx + (wy - a.y) * vy) / (vx * vx + vy * vy)));
      const dist = Math.hypot(wx - (a.x + t * vx), wy - (a.y + t * vy));
      if (dist < bd) { bd = dist; best = k; }
    });
    return best;
  }

  const api = { createDesign, clone, isValidPoint, addSegment, removeMember, paintMember, pickMember, cleanup, findNode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Design = api;
})(typeof window !== 'undefined' ? window : globalThis);
