/* ==========================================================================
 * GEO3D ENGINE — Hình không gian & Khối tròn xoay kiểu SGK Việt Nam (SVG thuần)
 *  - Phép chiếu song song (xiên): trục sâu nghiêng `angle` độ, hệ số co `ratio`.
 *  - Tự xác định cạnh khuất (nét đứt) bằng pháp tuyến mặt của bao lồi.
 *  - Hỗ trợ đầy đủ Khối tròn xoay chuẩn SGK: Nón (cone), Trụ (cylinder),
 *    Cầu (sphere), Nón cụt (frustum / cone-frustum).
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
    const r = (rot * Math.PI) / 180;
    const R = ([x, y]) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r), 0];
    return [[0, 0, 0], R([a / 2, (-a * Math.sqrt(3)) / 2]), R([a, 0])];
  }

  /* ---------- Preset (toạ độ: x ngang, y chiều sâu, z thẳng đứng) ---------- */
  function preset(name, p = {}) {
    const a = p.a ?? 2, b = p.b ?? a, h = p.h ?? 2.8, c = p.c ?? h;
    const normName = String(name || 'custom').toLowerCase();
    switch (normName) {
      case 'pyramid-tri': {
        const [A, B, C] = triBase(a, p.rot);
        const base = p.apexOver === 'A' ? A : avg([A, B, C]);
        return { points: { A, B, C, S: [base[0], base[1], h] }, round: null };
      }
      case 'pyramid-square':
      case 'pyramid-rect': {
        const A = [0, 0, 0], B = [a, 0, 0], C = [a, b, 0], D = [0, b, 0];
        const base = p.apexOver === 'A' ? A : avg([A, B, C, D]);
        return { points: { A, B, C, D, S: [base[0], base[1], h] }, round: null };
      }
      case 'tetra-right':
        return { points: { O: [0, 0, 0], A: [0, -a, 0], B: [b, 0, 0], C: [0, 0, c] }, round: null };
      case 'prism-tri': {
        const s = p.shift || [0, 0];
        const [A, B, C] = triBase(a, p.rot);
        const up = (P) => [P[0] + s[0], P[1] + s[1], h];
        return { points: { A, B, C, "A'": up(A), "B'": up(B), "C'": up(C) }, round: null };
      }
      case 'prism-quad':
      case 'prism-rect':
      case 'prism-square': {
        // Lăng trụ tứ giác: đáy ABCD là hình chữ nhật a×b (skew ≠ 0 → hình bình hành), shift → lăng trụ xiên
        const s = p.shift || [0, 0], k = p.skew || 0;
        const A = [0, 0, 0], B = [a, 0, 0], C = [a + k, b, 0], D = [k, b, 0];
        const up = (P) => [P[0] + s[0], P[1] + s[1], h];
        return { points: { A, B, C, D, "A'": up(A), "B'": up(B), "C'": up(C), "D'": up(D) }, round: null };
      }
      case 'prism-hex':
      case 'pyramid-hex': {
        // Đáy lục giác đều ABCDEF cạnh a, tâm O
        const r = ((p.rot ?? 20) * Math.PI) / 180; // 20° cho hình chiếu xiên dễ nhìn nhất
        const names = ['A', 'B', 'C', 'D', 'E', 'F'];
        const base = names.map((_, i) => {
          const t = r + Math.PI + (i * Math.PI) / 3;
          return [a * Math.cos(t), a * Math.sin(t), 0];
        });
        const pts = {};
        names.forEach((n, i) => { pts[n] = base[i]; });
        if (normName === 'pyramid-hex') {
          const foot = p.apexOver === 'A' ? base[0] : [0, 0, 0];
          pts.S = [foot[0], foot[1], h];
        } else {
          const s = p.shift || [0, 0];
          names.forEach((n, i) => { pts[n + "'"] = [base[i][0] + s[0], base[i][1] + s[1], h]; });
        }
        return { points: pts, round: null };
      }
      case 'box':
      case 'cube': {
        const bb = normName === 'cube' ? a : b, hh = normName === 'cube' ? a : h;
        const A = [0, 0, 0], B = [a, 0, 0], C = [a, bb, 0], D = [0, bb, 0];
        const up = (P) => [P[0], P[1], hh];
        return { points: { A, B, C, D, "A'": up(A), "B'": up(B), "C'": up(C), "D'": up(D) }, round: null };
      }
      case 'cone': {
        const r = p.r ?? p.a ?? 1.6;
        return {
          points: { O: [0, 0, 0], S: [0, 0, h], A: [r, 0, 0] },
          round: { kind: 'cone', r, h },
        };
      }
      case 'cylinder': {
        const r = p.r ?? p.a ?? 1.5;
        const hh = p.h ?? 2.4;
        return {
          points: { O: [0, 0, 0], "O'": [0, 0, hh], A: [r, 0, 0], "A'": [r, 0, hh] },
          round: { kind: 'cylinder', r, h: hh },
        };
      }
      case 'sphere': {
        const r = p.r ?? p.a ?? 1.7;
        return {
          points: { O: [0, 0, 0], A: [r, 0, 0] },
          round: { kind: 'sphere', r },
        };
      }
      case 'frustum':
      case 'cone-frustum': {
        const r1 = p.r1 ?? p.R ?? p.r ?? 1.8;
        const r2 = p.r2 ?? r1 * 0.55;
        const hh = p.h ?? 2.2;
        return {
          points: { O: [0, 0, 0], "O'": [0, 0, hh], A: [r1, 0, 0], "A'": [r2, 0, hh] },
          round: { kind: 'frustum', r: r1, r2, h: hh },
        };
      }
      case 'custom':
        return { points: { ...(p.points || {}) }, round: null };
      default:
        throw new Error('Preset không hỗ trợ: ' + name);
    }
  }

  /* ---------- biểu thức điểm ---------- */
  function splitNames(s, pts) {
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
      if (V.dot(nrm, ctr) - d > 0) nrm = V.mul(nrm, -1);
      const key = on.slice().sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue; seen.add(key);
      const fc = avg(on.map((t) => P[t])), u = V.sub(P[on[0]], fc), w = V.cross(nrm, u);
      const ring = on.slice().sort((x, y) => Math.atan2(V.dot(V.sub(P[x], fc), w), V.dot(V.sub(P[x], fc), u)) - Math.atan2(V.dot(V.sub(P[y], fc), w), V.dot(V.sub(P[y], fc), u)));
      faces.push({ verts: ring.map((t) => names[t]), normal: nrm, d: V.dot(nrm, P[on[0]]) });
    }
    return faces;
  }

  /* ---------- dựng toàn bộ hình ---------- */
  function buildGeo3D(spec) {
    const base = preset(spec.preset || 'custom', { ...(spec.params || {}), points: spec.points });
    const view = { angle: base.round ? 90 : 30, ratio: base.round ? 0.33 : 0.5, ...(spec.view || {}) };
    const al = (view.angle * Math.PI) / 180, k = view.ratio;
    const pts = { ...base.points };
    const solidNames = Object.keys(pts);
    const segments = [], drawPts = new Set(solidNames);
    const extra = spec.extra || [];
    extra.forEach((cmd) => {
      const [kw, ...rest] = cmd.trim().split(/\s+/);
      if (kw === 'point') { pts[rest[0]] = evalPoint(rest.slice(1).join(' '), pts); drawPts.add(rest[0]); }
    });
    const view3 = [-k * Math.cos(al), 1, -k * Math.sin(al)];
    const proj = (p) => [p[0] + k * Math.cos(al) * p[1], p[2] + k * Math.sin(al) * p[1]];

    let faces = [];
    if (!base.round && solidNames.length >= 4) faces = convexHull(solidNames, pts);
    if (spec.faces) faces = spec.faces.map((f) => {
      const vs = splitNames(f, pts), P = vs.map((n) => pts[n]), c = avg(solidNames.map((n) => pts[n]));
      let nrm = V.cross(V.sub(P[1], P[0]), V.sub(P[2], P[0])); nrm = V.mul(nrm, 1 / V.len(nrm));
      if (V.dot(nrm, V.sub(c, P[0])) > 0) nrm = V.mul(nrm, -1);
      return { verts: vs, normal: nrm, d: V.dot(nrm, P[0]) };
    });
    faces.forEach((f) => { f.visible = V.dot(f.normal, view3) < -1e-9; });

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
      if (!host.length) return false;
      return host.some((f) => f.visible);
    };
    const addSeg = (A, B, style) => {
      if (!pts[A] || !pts[B]) return;
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

  /**
   * Vẽ đường cong/đoạn thẳng bằng nét đứt thực sự (chia thành các đoạn nhỏ theo độ dài thực trên màn hình)
   * Giúp hiển thị nét đứt chuẩn 100% trên mọi trình đọc SVG (trình duyệt, Word, PyMuPDF)
   */
  function renderPolylineSvg(screenPts, dashed = false, strokeWidth = 1.4) {
    if (!screenPts || screenPts.length < 2) return '';
    if (!dashed) {
      const d = screenPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="#000000" stroke-width="${strokeWidth}"/>`;
    }
    const dashLen = 6, gapLen = 4.5;
    const subPaths = [];
    let drawing = true, rem = dashLen;
    let cur = [screenPts[0]];

    for (let i = 0; i < screenPts.length - 1; i++) {
      let p0 = screenPts[i], p1 = screenPts[i + 1];
      let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
      let dist = Math.hypot(dx, dy);
      while (dist > 1e-6) {
        if (dist <= rem) {
          if (drawing) cur.push(p1);
          rem -= dist;
          dist = 0;
        } else {
          const ratio = rem / dist;
          const mid = [p0[0] + dx * ratio, p0[1] + dy * ratio];
          if (drawing) {
            cur.push(mid);
            if (cur.length >= 2) subPaths.push(cur);
            cur = [];
          } else {
            cur = [mid];
          }
          drawing = !drawing;
          rem = drawing ? dashLen : gapLen;
          p0 = mid;
          dx = p1[0] - p0[0];
          dy = p1[1] - p0[1];
          dist = Math.hypot(dx, dy);
        }
      }
    }
    if (drawing && cur.length >= 2) subPaths.push(cur);
    const d = subPaths
      .map((seg) => seg.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '))
      .join(' ');
    return `<path d="${d}" fill="none" stroke="#000000" stroke-width="${strokeWidth}"/>`;
  }

  /* ---------- vẽ SVG ---------- */
  function renderGeo3D(spec) {
    const G = buildGeo3D(spec);
    const sc = spec.scale || 75, pad = 38;
    const shapes2d = [];
    Object.values(G.P2).forEach((p) => shapes2d.push(p));
    const round = [];
    const autoMarks = [...(spec.marks || [])];

    if (G.round) {
      const { r, r2 = r, h = 0, kind } = G.round;
      const N = 96;
      // Cung tròn theo khoảng góc [tStart, tEnd] liên tục (tránh tuyệt đối lỗi nối tắt 0 -> pi)
      const arcPts = (rad, z, tStart, tEnd) => {
        const arr = [];
        for (let i = 0; i <= N; i++) {
          const t = tStart + ((tEnd - tStart) * i) / N;
          arr.push(G.proj([rad * Math.cos(t), rad * Math.sin(t), z]));
        }
        return arr;
      };

      if (kind === 'cone' || kind === 'cylinder' || kind === 'frustum') {
        // Đáy dưới: nửa sau [0, π] nét đứt, nửa trước [π, 2π] nét liền
        round.push({ pts: arcPts(r, 0, 0, Math.PI), dashed: true });
        round.push({ pts: arcPts(r, 0, Math.PI, 2 * Math.PI), dashed: false });

        // Đáy trên (cho trụ hoặc nón cụt): nét liền toàn bộ vòng [0, 2π]
        if (kind === 'cylinder') {
          round.push({ pts: arcPts(r, h, 0, 2 * Math.PI), dashed: false });
        } else if (kind === 'frustum') {
          round.push({ pts: arcPts(r2, h, 0, 2 * Math.PI), dashed: false });
        }

        // Hai đường sinh biên trái & phải
        const { al, k } = G.view;
        const t0 = Math.atan(k * Math.cos(al));
        [t0, t0 + Math.PI].forEach((t) => {
          const b = G.proj([r * Math.cos(t), r * Math.sin(t), 0]);
          const top =
            kind === 'cone'
              ? G.P2.S
              : G.proj([(kind === 'frustum' ? r2 : r) * Math.cos(t), (kind === 'frustum' ? r2 : r) * Math.sin(t), h]);
          round.push({ pts: [b, top], dashed: false });
        });

        // Đường cao, bán kính đáy và ký hiệu góc vuông tại tâm O
        if (spec.radius !== false) {
          const topCenter = kind === 'cone' ? G.P2.S : G.P2["O'"];
          round.push({ pts: [G.P2.O, G.P2.A], dashed: true });
          round.push({ pts: [G.P2.O, topCenter], dashed: true });
          if (kind === 'cylinder' || kind === 'frustum') {
            round.push({ pts: [G.P2["O'"], G.P2["A'"]], dashed: false });
          }
          const topName = kind === 'cone' ? 'S' : "O'";
          if (!autoMarks.some((m) => m.includes('rightangle'))) {
            autoMarks.push(`rightangle ${topName} O A`);
          }
        }
      } else if (kind === 'sphere') {
        // Đường tròn lớn bao ngoài
        const outer = [];
        for (let i = 0; i <= N * 2; i++) {
          const t = (2 * Math.PI * i) / (N * 2);
          outer.push([r * Math.cos(t), r * Math.sin(t)]);
        }
        round.push({ pts: outer, dashed: false });
        // Đường xích đạo: nửa sau [0, π] nét đứt, nửa trước [π, 2π] nét liền
        round.push({ pts: arcPts(r, 0, 0, Math.PI), dashed: true });
        round.push({ pts: arcPts(r, 0, Math.PI, 2 * Math.PI), dashed: false });
        if (spec.radius !== false) {
          round.push({ pts: [G.P2.O, G.P2.A], dashed: true });
        }
      }
      round.forEach((rr) => rr.pts.forEach((p) => shapes2d.push(p)));
    }

    // trục Oxyz
    let axes = [];
    if (spec.axes) {
      const L = spec.axesLength || 1.4 * Math.max(...Object.values(G.pts).flat().map(Math.abs), 1);
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

    const out = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}">`,
      `<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#ffffff"/>`,
    ];

    // Vẽ trục Oxyz có mũi tên polygon
    axes.forEach((ax) => {
      const p1 = T(ax.a), p2 = T(ax.b);
      out.push(renderPolylineSvg([p1, p2], false, 1.3));
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, px = -uy, py = ux;
      const bx = p2[0] - ux * 8, by = p2[1] - uy * 8;
      out.push(
        `<polygon points="${p2[0].toFixed(1)},${p2[1].toFixed(1)} ${(bx + px * 3.5).toFixed(1)},${(by + py * 3.5).toFixed(1)} ${(bx - px * 3.5).toFixed(1)},${(by - py * 3.5).toFixed(1)}" fill="#000000"/>`
      );
    });

    // Vẽ các đường của khối tròn xoay
    round.forEach((rr) => {
      out.push(renderPolylineSvg(rr.pts.map(T), rr.dashed, 1.4));
    });

    // Vẽ các cạnh của khối đa diện
    G.segments.forEach((s) => {
      out.push(renderPolylineSvg([T(G.P2[s.a]), T(G.P2[s.b])], s.hidden, 1.4));
    });

    // Ký hiệu góc vuông: "rightangle A H B" (góc tại H)
    autoMarks.forEach((m) => {
      const t = m.trim().split(/\s+/);
      if (t[0] !== 'rightangle') return;
      const [A, O, Bn] = t.slice(1).map((n) => G.pts[n]);
      if (!A || !O || !Bn) return;
      const s = spec.markSize || 0.22;
      const ua = V.mul(V.sub(A, O), s / V.len(V.sub(A, O)));
      const ub = V.mul(V.sub(Bn, O), s / V.len(V.sub(Bn, O)));
      const p1 = G.proj(V.add(O, ua)), p2 = G.proj(V.add(V.add(O, ua), ub)), p3 = G.proj(V.add(O, ub));
      out.push(renderPolylineSvg([T(p1), T(p2), T(p3)], false, 1.0));
    });

    // Vẽ chấm tròn tại các điểm đặc biệt và nhãn điểm
    const allP = G.drawPts.map((n) => G.P2[n]);
    const c2 = [
      allP.reduce((s, p) => s + p[0], 0) / Math.max(1, allP.length),
      allP.reduce((s, p) => s + p[1], 0) / Math.max(1, allP.length),
    ];
    const font = 'font-family="Times New Roman, serif" font-size="18" font-style="italic"';

    G.drawPts.forEach((n) => {
      const p = G.P2[n];
      const [x, y] = T(p);
      // Chấm tròn tại các điểm của khối tròn xoay (O, O', S, A, A') hoặc điểm phụ
      const shouldDot = G.round || !Object.keys(preset(spec.preset || 'custom', { ...(spec.params || {}), points: spec.points }).points).includes(n);
      if (shouldDot) {
        out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.3" fill="#000000"/>`);
      }

      let offX = 0, offY = 0;
      if (G.round) {
        if (n === 'O') {
          offX = G.round.kind === 'sphere' ? -12 : -10;
          offY = 15;
        } else if (n === "O'") {
          offX = -12;
          offY = -12;
        } else if (n === 'S') {
          offX = 0;
          offY = -14;
        } else if (n === 'A' || n === "A'") {
          offX = 14;
          offY = 2;
        } else {
          offX = 12;
          offY = -10;
        }
      } else {
        let dx = p[0] - c2[0], dy = p[1] - c2[1];
        const L = Math.hypot(dx, dy);
        if (L < 1e-6) { dx = 0.7; dy = -0.7; } else { dx /= L; dy /= L; }
        offX = dx * 15;
        offY = -dy * 15;
      }
      out.push(`<text x="${(x + offX).toFixed(1)}" y="${(y + offY).toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${font}>${n}</text>`);
    });

    axes.forEach((ax) => {
      const [x, y] = T(ax.b);
      out.push(`<text x="${(x + 10).toFixed(1)}" y="${(y - 8).toFixed(1)}" ${font}>${ax.n}</text>`);
    });

    out.push('</svg>');
    return out.join('');
  }

  global.Geo3D = { buildGeo3D, renderGeo3D, convexHull, evalPoint, preset };
})(typeof window !== 'undefined' ? window : globalThis);
