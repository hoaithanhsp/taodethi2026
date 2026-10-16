/* ==========================================================================
 * GEO3D ENGINE — Hình không gian kiểu SGK Việt Nam (SVG thuần)
 *  - Phép chiếu song song (xiên): trục sâu nghiêng `angle` độ, hệ số co `ratio`.
 *  - Tự xác định cạnh khuất (nét đứt) bằng pháp tuyến mặt của bao lồi.
 *  - Không phụ thuộc thư viện nào.
 *
 *  buildGeo3D(spec) -> { points, hull, segments }      (dữ liệu đã tính)
 *  renderGeo3D(spec) -> chuỗi <svg>
 *
 *  spec (AI sinh JSON này):
 *  { type:"geo3d", preset:"pyramid-square",
 *    params:{ a:2, h:3, apexOver:"center" },
 *    extra:["point M midpoint(S,C)", "point O center(ABCD)", "segment S O", "segment A M"],
 *    marks:["rightangle S O A"], view:{ angle:30, ratio:0.5 }, axes:false }
 *
 *  Preset: pyramid-tri | pyramid-square | pyramid-rect | tetra-right | prism-tri |
 *          box | cube | cone | cylinder | sphere | custom (points + faces tự khai báo)
 *  params: a, b, h, c, r, apexOver (center|centroid|A), rot (xoay đáy tam giác, độ), shift (lăng trụ xiên)
 *  Biểu thức điểm: midpoint(A,B)  centroid(A,B,C)  center(ABCD)  onseg(A,B,t)
 *                  foot(P,A,B) (chân đường vuông góc từ P xuống AB)  [x,y,z]
 * ======================================================================== */
(function (global) {
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
  };
  const avg = (ps) => V.mul(ps.reduce((s, p) => V.add(s, p), [0, 0, 0]), 1 / ps.length);

  /** Đáy tam giác đều cạnh a, xoay quanh A một góc rot (độ) để đỉnh B không bị chiếu trùng A. */
  function triBase(a, rot = 20) {
    const r = rot * Math.PI / 180, R = ([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r), 0];
    return [[0, 0, 0], R([a / 2, -a * Math.sqrt(3) / 2]), R([a, 0])];
  }

  /* ---------- Preset (toạ độ: x ngang, y chiều sâu, z thẳng đứng) ---------- */
  function preset(name, p = {}) {
    const a = p.a ?? 2, b = p.b ?? a, h = p.h ?? 3, c = p.c ?? h;
    switch (name) {
      case 'pyramid-tri': { // chóp tam giác (mặc định đều); apexOver: centroid | A
        const [A, B, C] = triBase(a, p.rot); // B phía trước, AC cạnh sau (kiểu SGK)
        const base = p.apexOver === 'A' ? A : avg([A, B, C]);
        return { points: { A, B, C, S: [base[0], base[1], h] }, round: null };
      }
      case 'pyramid-square': case 'pyramid-rect': { // đáy ABCD; apexOver: center | A
        const A = [0, 0, 0], B = [a, 0, 0], C = [a, b, 0], D = [0, b, 0];
        const base = p.apexOver === 'A' ? A : avg([A, B, C, D]);
        return { points: { A, B, C, D, S: [base[0], base[1], h] } };
      }
      case 'tetra-right': // tứ diện vuông O.ABC
        return { points: { O: [0, 0, 0], A: [0, -a, 0], B: [b, 0, 0], C: [0, 0, c] } }; // OA, OB, OC theo hướng Ox, Oy, Oz
      case 'prism-tri': { // lăng trụ đứng (hoặc xiên với shift:[dx,dy])
        const s = p.shift || [0, 0];
        const [A, B, C] = triBase(a, p.rot); // B phía trước, AC cạnh sau (kiểu SGK)
        const up = (P) => [P[0] + s[0], P[1] + s[1], h];
        return { points: { A, B, C, "A'": up(A), "B'": up(B), "C'": up(C) } };
      }
      case 'box': case 'cube': {
        const bb = name === 'cube' ? a : b, hh = name === 'cube' ? a : h;
        const A = [0, 0, 0], B = [a, 0, 0], C = [a, bb, 0], D = [0, bb, 0];
        const up = (P) => [P[0], P[1], hh];
        return { points: { A, B, C, D, "A'": up(A), "B'": up(B), "C'": up(C), "D'": up(D) } };
      }
      case 'cone': return { points: { O: [0, 0, 0], S: [0, 0, h] }, round: { kind: 'cone', r: p.r ?? a, h } };
      case 'cylinder': return { points: { O: [0, 0, 0], "O'": [0, 0, h] }, round: { kind: 'cylinder', r: p.r ?? a, h } };
      case 'sphere': return { points: { O: [0, 0, 0] }, round: { kind: 'sphere', r: p.r ?? a } };
      case 'custom': return { points: { ...(p.points || {}) } };
      default: throw new Error('Preset không hỗ trợ: ' + name);
    }
  }

  /* ---------- biểu thức điểm ---------- */
  function splitNames(s, pts) {
    // "ABCD" hoặc "A,B,C" hoặc "A',B'"
    if (s.includes(',')) return s.split(',').map((t) => t.trim());
    const names = Object.keys(pts).sort((x, y) => y.length - x.length), out = [];
    let i = 0;
    while (i < s.length) {
      const n = names.find((k) => s.startsWith(k, i));
      if (!n) throw new Error('Không rõ điểm trong "' + s + '"');
      out.push(n); i += n.length;
    }
    return out;
  }
  function evalPoint(expr, pts) {
    expr = expr.trim();
    if (expr.startsWith('[')) return JSON.parse(expr);
    const m = expr.match(/^(\w+)\((.*)\)$/);
    if (!m) { if (pts[expr]) return pts[expr]; throw new Error('Biểu thức điểm sai: ' + expr); }
    const fn = m[1], args = m[2].split(',').map((t) => t.trim());
    const P = (n) => { if (!pts[n]) throw new Error('Chưa có điểm ' + n); return pts[n]; };
    switch (fn) {
      case 'midpoint': return avg([P(args[0]), P(args[1])]);
      case 'centroid': return avg(args.map(P));
      case 'center': return avg(splitNames(m[2], pts).map(P));
      case 'onseg': { const t = Number(args[2]); return V.add(P(args[0]), V.mul(V.sub(P(args[1]), P(args[0])), t)); }
      case 'foot': {
        const p = P(args[0]), a = P(args[1]), d = V.sub(P(args[2]), a);
        return V.add(a, V.mul(d, V.dot(V.sub(p, a), d) / V.dot(d, d)));
      }
      default: throw new Error('Hàm điểm không hỗ trợ: ' + fn);
    }
  }

  /* ---------- bao lồi (brute force, đủ cho ≤ 20 đỉnh) ---------- */
  function convexHull(names, pts) {
    const P = names.map((n) => pts[n]), n = P.length, faces = [], seen = new Set();
    const ctr = avg(P);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      let nrm = V.cross(V.sub(P[j], P[i]), V.sub(P[k], P[i]));
      const L = V.len(nrm); if (L < 1e-9) continue;
      nrm = V.mul(nrm, 1 / L);
      const d = V.dot(nrm, P[i]);
      let pos = 0, neg = 0; const on = [];
      for (let t = 0; t < n; t++) { const s = V.dot(nrm, P[t]) - d; if (s > 1e-7) pos++; else if (s < -1e-7) neg++; else on.push(t); }
      if (pos && neg) continue;
      if (V.dot(nrm, ctr) - d > 0) nrm = V.mul(nrm, -1); // pháp tuyến hướng ra ngoài
      const key = on.slice().sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue; seen.add(key);
      // sắp xếp đỉnh của mặt theo vòng
      const fc = avg(on.map((t) => P[t])), u = V.sub(P[on[0]], fc), w = V.cross(nrm, u);
      const ring = on.slice().sort((x, y) => Math.atan2(V.dot(V.sub(P[x], fc), w), V.dot(V.sub(P[x], fc), u)) - Math.atan2(V.dot(V.sub(P[y], fc), w), V.dot(V.sub(P[y], fc), u)));
      faces.push({ verts: ring.map((t) => names[t]), normal: nrm, d: V.dot(nrm, P[on[0]]) });
    }
    return faces;
  }

  /* ---------- dựng toàn bộ hình ---------- */
  function buildGeo3D(spec) {
    const base = preset(spec.preset || 'custom', { ...(spec.params || {}), points: spec.points });
    // khối tròn xoay: góc 90° để đáy là elip nằm ngang như SGK; đa diện: xiên 30°, co 1/2
    const view = { angle: base.round ? 90 : 30, ratio: base.round ? 0.35 : 0.5, ...(spec.view || {}) };
    const al = view.angle * Math.PI / 180, k = view.ratio;
    const pts = { ...base.points };
    const solidNames = Object.keys(pts);
    const segments = [], drawPts = new Set(solidNames);
    const extra = spec.extra || [];
    extra.forEach((cmd) => {
      const [kw, ...rest] = cmd.trim().split(/\s+/);
      if (kw === 'point') { pts[rest[0]] = evalPoint(rest.slice(1).join(' '), pts); drawPts.add(rest[0]); }
    });
    // hướng nhìn: các điểm trên đường thẳng song song với d chiếu trùng nhau; người xem ở phía -y
    const view3 = [-k * Math.cos(al), 1, -k * Math.sin(al)];
    const proj = (p) => [p[0] + k * Math.cos(al) * p[1], p[2] + k * Math.sin(al) * p[1]];

    let faces = [];
    if (!base.round && solidNames.length >= 4) faces = convexHull(solidNames, pts);
    if (spec.faces) faces = spec.faces.map((f) => { // custom: mặt tự khai báo
      const vs = splitNames(f, pts), P = vs.map((n) => pts[n]), c = avg(solidNames.map((n) => pts[n]));
      let nrm = V.cross(V.sub(P[1], P[0]), V.sub(P[2], P[0])); nrm = V.mul(nrm, 1 / V.len(nrm));
      if (V.dot(nrm, V.sub(c, P[0])) > 0) nrm = V.mul(nrm, -1);
      return { verts: vs, normal: nrm, d: V.dot(nrm, P[0]) };
    });
    faces.forEach((f) => { f.visible = V.dot(f.normal, view3) < -1e-9; });

    // điểm nằm trên mặt (trong đa giác) không?
    const onFace = (p, f) => {
      if (Math.abs(V.dot(f.normal, p) - f.d) > 1e-7) return false;
      const P = f.verts.map((n) => pts[n]);
      for (let i = 0; i < P.length; i++) {
        const e = V.sub(P[(i + 1) % P.length], P[i]);
        if (V.dot(V.cross(e, V.sub(p, P[i])), f.normal) < -1e-7) return false;
      }
      return true;
    };
    const segVisible = (A, B) => {
      if (!faces.length) return true;
      const pa = pts[A], pb = pts[B], mid = avg([pa, pb]);
      const host = faces.filter((f) => onFace(pa, f) && onFace(pb, f) && onFace(mid, f));
      if (!host.length) return false;          // đi xuyên bên trong khối → khuất
      return host.some((f) => f.visible);      // nằm trên mặt trông thấy được → nét liền
    };
    const addSeg = (A, B, style) => {
      if (segments.some((s) => (s.a === A && s.b === B) || (s.a === B && s.b === A))) return;
      segments.push({ a: A, b: B, hidden: style ? style === 'dashed' : !segVisible(A, B) });
    };
    faces.forEach((f) => f.verts.forEach((v, i) => addSeg(v, f.verts[(i + 1) % f.verts.length])));
    extra.forEach((cmd) => {
      const t = cmd.trim().split(/\s+/);
      if (t[0] === 'segment') addSeg(t[1], t[2], t[3]);
    });
    const P2 = {}; Object.keys(pts).forEach((n) => { P2[n] = proj(pts[n]); });
    return { pts, P2, faces, segments, drawPts: [...drawPts], round: base.round, view: { al, k }, proj, view3 };
  }

  /* ---------- vẽ SVG ---------- */
  function renderGeo3D(spec) {
    const G = buildGeo3D(spec);
    const sc = spec.scale || 70, pad = 34;
    const shapes2d = []; // để tính khung
    Object.values(G.P2).forEach((p) => shapes2d.push(p));
    const round = [];
    if (G.round) {
      const { r, h = 0, kind } = G.round, N = 120;
      const circle = (z) => { const arr = []; for (let i = 0; i <= N; i++) { const t = 2 * Math.PI * i / N; arr.push({ t, p3: [r * Math.cos(t), r * Math.sin(t), z] }); } return arr; };
      const isBack = (t) => Math.sin(t) > 0; // phần đáy phía sau (y > 0)
      if (kind === 'cone' || kind === 'cylinder') {
        const bottom = circle(0);
        // nửa sau đáy dưới nét đứt, nửa trước nét liền; đáy trên (trụ) liền hoàn toàn
        round.push({ pts: bottom.filter((q) => isBack(q.t) || Math.abs(Math.sin(q.t)) < 1e-9).map((q) => G.proj(q.p3)), dashed: true });
        round.push({ pts: bottom.filter((q) => !isBack(q.t)).map((q) => G.proj(q.p3)), dashed: false });
        if (kind === 'cylinder') round.push({ pts: circle(h).map((q) => G.proj(q.p3)), dashed: false });
        // đường sinh biên: điểm trên đường tròn có tiếp tuyến chiếu song song với trục chiếu
        const { al, k } = G.view;
        // tham số t sao cho đạo hàm chiếu của (r cos t, r sin t) song song với hướng chiếu của trục z: x' = 0
        // x(t) = r cos t + k cos(al) r sin t → x'(t)=0 ⇔ tan t = k cos al
        const t0 = Math.atan(k * Math.cos(al));
        [t0, t0 + Math.PI].forEach((t) => {
          const b = G.proj([r * Math.cos(t), r * Math.sin(t), 0]);
          const top = kind === 'cone' ? G.P2.S : G.proj([r * Math.cos(t), r * Math.sin(t), h]);
          round.push({ pts: [b, top], dashed: false });
        });
        if (spec.radius !== false) {
          const R = G.proj([r, 0, 0]);
          round.push({ pts: [G.P2.O, R], dashed: true });
          round.push({ pts: [G.P2.O, kind === 'cone' ? G.P2.S : G.P2["O'"]], dashed: true });
        }
      } else if (kind === 'sphere') {
        const out = []; for (let i = 0; i <= N; i++) { const t = 2 * Math.PI * i / N; out.push([r * Math.cos(t), r * Math.sin(t)]); }
        round.push({ pts: out, dashed: false });
        const eq = circle(0);
        round.push({ pts: eq.filter((q) => isBack(q.t) || Math.abs(Math.sin(q.t)) < 1e-9).map((q) => G.proj(q.p3)), dashed: true });
        round.push({ pts: eq.filter((q) => !isBack(q.t)).map((q) => G.proj(q.p3)), dashed: false });
      }
      round.forEach((rr) => rr.pts.forEach((p) => shapes2d.push(p)));
    }
    // trục Oxyz
    let axes = [];
    if (spec.axes) {
      const L = spec.axesLength || 1.4 * Math.max(...Object.values(G.pts).flat().map(Math.abs), 1);
      // Ox: hướng về phía người xem (y âm trong toạ độ dựng hình), Oy: sang phải, Oz: lên
      axes = [
        { n: 'x', a: [0, 0], b: G.proj([0, -L, 0]) },
        { n: 'y', a: [0, 0], b: G.proj([L, 0, 0]) },
        { n: 'z', a: [0, 0], b: G.proj([0, 0, L]) },
      ];
      axes.forEach((ax) => shapes2d.push(ax.b));
    }
    const xs = shapes2d.map((p) => p[0]), ys = shapes2d.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = (maxX - minX) * sc + 2 * pad, H = (maxY - minY) * sc + 2 * pad;
    const T = (p) => [pad + (p[0] - minX) * sc, pad + (maxY - p[1]) * sc];
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}">`, `<rect width="${W}" height="${H}" fill="#fff"/>`];
    out.push('<defs><marker id="g3Arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,1 L10,5 L0,9 z" fill="#000"/></marker></defs>');
    const line = (a, b, dashed, extra = '') => { const [x1, y1] = T(a), [x2, y2] = T(b); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="1.3"${dashed ? ' stroke-dasharray="5,4"' : ''} ${extra}/>`; };
    axes.forEach((ax) => out.push(line(ax.a, ax.b, false, 'marker-end="url(#g3Arr)"')));
    round.forEach((rr) => out.push(`<polyline points="${rr.pts.map((p) => T(p).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#000" stroke-width="1.3"${rr.dashed ? ' stroke-dasharray="5,4"' : ''}/>`));
    G.segments.forEach((s) => out.push(line(G.P2[s.a], G.P2[s.b], s.hidden)));

    // ký hiệu góc vuông: "rightangle A H B" (góc tại H)
    (spec.marks || []).forEach((m) => {
      const t = m.trim().split(/\s+/);
      if (t[0] !== 'rightangle') return;
      const [A, O, Bn] = t.slice(1).map((n) => G.pts[n]);
      const s = (spec.markSize || 0.22);
      const ua = V.mul(V.sub(A, O), s / V.len(V.sub(A, O))), ub = V.mul(V.sub(Bn, O), s / V.len(V.sub(Bn, O)));
      const p1 = G.proj(V.add(O, ua)), p2 = G.proj(V.add(V.add(O, ua), ub)), p3 = G.proj(V.add(O, ub));
      out.push(`<polyline points="${[p1, p2, p3].map((p) => T(p).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#000" stroke-width="1"/>`);
    });

    // nhãn điểm: đẩy ra xa tâm hình
    const allP = G.drawPts.map((n) => G.P2[n]);
    const c2 = [allP.reduce((s, p) => s + p[0], 0) / allP.length, allP.reduce((s, p) => s + p[1], 0) / allP.length];
    const font = 'font-family="Times New Roman, serif" font-size="17" font-style="italic"';
    G.drawPts.forEach((n) => {
      const p = G.P2[n]; let dx = p[0] - c2[0], dy = p[1] - c2[1]; const L = Math.hypot(dx, dy);
      if (L < 1e-6) { dx = 0.7; dy = -0.7; } else { dx /= L; dy /= L; }
      const [x, y] = T(p);
      const isExtra = !G.round && !Object.keys(preset(spec.preset || 'custom', { ...(spec.params || {}), points: spec.points }).points).includes(n);
      if (isExtra) out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#000"/>`);
      out.push(`<text x="${(x + dx * 14).toFixed(1)}" y="${(y - dy * 14).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ${font}>${n}</text>`);
    });
    axes.forEach((ax) => { const [x, y] = T(ax.b); out.push(`<text x="${x + 8}" y="${y - 8}" ${font}>${ax.n}</text>`); });
    out.push('</svg>');
    return out.join('');
  }

  global.Geo3D = { buildGeo3D, renderGeo3D, convexHull, evalPoint, preset };
})(typeof window !== 'undefined' ? window : globalThis);
