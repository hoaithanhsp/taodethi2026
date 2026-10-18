/* ==========================================================================
 * GEO2D ENGINE — Hình học phẳng 2D kiểu SGK Việt Nam (SVG thuần)
 *  - Hỗ trợ: Tam giác (thường, vuông, cân, đều, biết cạnh/góc),
 *    Hình bình hành, Hình chữ nhật, Hình vuông, Hình thoi, Hình thang,
 *    Đường tròn, Vectơ, Bài toán thực tế phương hướng (Tàu thuyền / Đo đạc).
 *  - Không phụ thuộc thư viện ngoài.
 *
 *  renderGeo2D(spec) -> chuỗi <svg>
 * ======================================================================== */
(function (global) {
  const V2 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
    mul: (a, k) => [a[0] * k, a[1] * k],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1],
    len: (a) => Math.hypot(a[0], a[1]),
    norm: (a) => {
      const L = Math.hypot(a[0], a[1]) || 1;
      return [a[0] / L, a[1] / L];
    },
    perp: (a) => [-a[1], a[0]],
  };

  const avg2 = (ps) =>
    V2.mul(
      ps.reduce((s, p) => V2.add(s, p), [0, 0]),
      1 / (ps.length || 1)
    );

  /** Escape ký tự đặc biệt XML để nhãn chứa &, <, > không làm hỏng SVG. */
  const escXml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function parseBearingDeg(bearingStr) {
    // Hỗ trợ: "N45E" (Đông Bắc 45°), "S30E" (Đông Nam tạo với Nam 30°), "N60W", "S45W", hoặc số độ lượng giác
    const s = String(bearingStr).trim().toUpperCase();
    const m = s.match(/^([NS])\s*([\d.]+)\s*([EW])$/);
    if (m) {
      const ns = m[1];
      const deg = Number(m[2]);
      const ew = m[3];
      if (ns === 'N' && ew === 'E') return 90 - deg;
      if (ns === 'N' && ew === 'W') return 90 + deg;
      if (ns === 'S' && ew === 'E') return -90 + deg;
      if (ns === 'S' && ew === 'W') return -90 - deg;
    }
    const num = Number(s);
    return Number.isFinite(num) ? num : 45;
  }

  function buildPreset2D(name, p = {}) {
    const presetName = String(name || 'triangle').toLowerCase();
    const pts = {};
    const segs = [];
    const vectors = [];
    const circles = [];
    const marks = [];
    const compassNodes = [];

    switch (presetName) {
      case 'parallelogram': {
        const a = Number(p.a ?? 4);
        const b = Number(p.b ?? 2.4);
        const angle = ((p.angle ?? 62) * Math.PI) / 180;
        const dx = b * Math.cos(angle);
        const dy = b * Math.sin(angle);
        // Đặt A dưới-trái, D trên-trái, C trên-phải, B dưới-phải (hoặc A trên-trái, B trên-phải, C dưới-phải, D dưới-trái)
        pts.A = [0, 0];
        pts.B = [a, 0];
        pts.C = [a + dx, dy];
        pts.D = [dx, dy];
        segs.push(
          { a: 'A', b: 'B' },
          { a: 'B', b: 'C' },
          { a: 'C', b: 'D' },
          { a: 'D', b: 'A' }
        );
        if (p.center || p.diagonals) {
          pts.O = avg2([pts.A, pts.B, pts.C, pts.D]);
          segs.push({ a: 'A', b: 'C' }, { a: 'B', b: 'D' });
        }
        break;
      }

      case 'rectangle':
      case 'square': {
        const a = Number(p.a ?? 3.6);
        const b = presetName === 'square' ? a : Number(p.b ?? 2.4);
        pts.A = [0, b];
        pts.B = [a, b];
        pts.C = [a, 0];
        pts.D = [0, 0];
        segs.push(
          { a: 'A', b: 'B' },
          { a: 'B', b: 'C' },
          { a: 'C', b: 'D' },
          { a: 'D', b: 'A' }
        );
        if (p.center || p.diagonals) {
          pts.O = avg2([pts.A, pts.B, pts.C, pts.D]);
          segs.push({ a: 'A', b: 'C' }, { a: 'B', b: 'D' });
        }
        break;
      }

      case 'rhombus': {
        const d1 = Number(p.d1 ?? 4);
        const d2 = Number(p.d2 ?? 2.6);
        pts.A = [-d1 / 2, 0];
        pts.B = [0, d2 / 2];
        pts.C = [d1 / 2, 0];
        pts.D = [0, -d2 / 2];
        segs.push(
          { a: 'A', b: 'B' },
          { a: 'B', b: 'C' },
          { a: 'C', b: 'D' },
          { a: 'D', b: 'A' }
        );
        if (p.center || p.diagonals) {
          pts.O = [0, 0];
          segs.push({ a: 'A', b: 'C' }, { a: 'B', b: 'D' });
        }
        break;
      }

      case 'trapezoid':
      case 'trapezoid-right': {
        const a = Number(p.a ?? 4); // đáy lớn CD
        const b = Number(p.b ?? 2.4); // đáy nhỏ AB
        const h = Number(p.h ?? 2.2);
        const offset = presetName === 'trapezoid-right' ? 0 : (a - b) / 2;
        pts.D = [0, 0];
        pts.C = [a, 0];
        pts.A = [offset, h];
        pts.B = [offset + b, h];
        segs.push(
          { a: 'A', b: 'B' },
          { a: 'B', b: 'C' },
          { a: 'C', b: 'D' },
          { a: 'D', b: 'A' }
        );
        if (presetName === 'trapezoid-right') {
          marks.push('rightangle B A D', 'rightangle A D C');
        }
        break;
      }

      case 'triangle-right': {
        const rightAt = String(p.rightAt || 'A').toUpperCase();
        const c = Number(p.c ?? p.ab ?? 3);
        const b = Number(p.b ?? p.ac ?? 4);
        if (rightAt === 'A') {
          pts.A = [0, 0];
          pts.B = [0, c];
          pts.C = [b, 0];
          marks.push('rightangle B A C');
        } else if (rightAt === 'B') {
          pts.B = [0, 0];
          pts.A = [0, c];
          pts.C = [b, 0];
          marks.push('rightangle A B C');
        } else {
          pts.C = [0, 0];
          pts.A = [0, b];
          pts.B = [c, 0];
          marks.push('rightangle A C B');
        }
        segs.push({ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'A' });
        break;
      }

      case 'triangle-equil': {
        const a = Number(p.a ?? 3.4);
        pts.B = [0, 0];
        pts.C = [a, 0];
        pts.A = [a / 2, (a * Math.sqrt(3)) / 2];
        segs.push({ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'A' });
        break;
      }

      case 'triangle-iso': {
        const base = Number(p.a ?? p.bc ?? 3.6);
        const h = Number(p.h ?? 2.8);
        pts.B = [0, 0];
        pts.C = [base, 0];
        pts.A = [base / 2, h];
        segs.push({ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'A' });
        break;
      }

      case 'navigation': {
        // Bài toán tàu thuyền / phương hướng: đi từ A -> B -> C
        const ab = Number(p.ab ?? 20);
        const bc = Number(p.bc ?? 30);
        const scaleLen = 3.2 / Math.max(ab, bc, 1);
        const r1 = ab * scaleLen;
        const r2 = bc * scaleLen;
        const deg1 = parseBearingDeg(p.bearingAB ?? p.angle1 ?? 'N45E');
        const deg2 = parseBearingDeg(p.bearingBC ?? p.angle2 ?? 'S30E');
        const rad1 = (deg1 * Math.PI) / 180;
        const rad2 = (deg2 * Math.PI) / 180;

        pts.A = [0, 0];
        pts.B = [r1 * Math.cos(rad1), r1 * Math.sin(rad1)];
        pts.C = [
          pts.B[0] + r2 * Math.cos(rad2),
          pts.B[1] + r2 * Math.sin(rad2),
        ];

        segs.push(
          { a: 'A', b: 'B', label: p.labelAB || `${ab} km` },
          { a: 'B', b: 'C', label: p.labelBC || `${bc} km` },
          { a: 'A', b: 'C', dashed: true, label: p.labelAC || '?' }
        );
        compassNodes.push({ pt: 'A', showSouth: false }, { pt: 'B', showSouth: true });
        break;
      }

      case 'circle': {
        const r = Number(p.r ?? 2.2);
        pts.O = [0, 0];
        circles.push({ center: 'O', r });
        break;
      }

      case 'custom': {
        if (p.points && typeof p.points === 'object') {
          Object.entries(p.points).forEach(([k, v]) => {
            if (Array.isArray(v) && v.length >= 2) {
              pts[k] = [Number(v[0]), Number(v[1])];
            }
          });
        }
        break;
      }

      case 'triangle':
      default: {
        // Hỗ trợ biết 2 cạnh ab, bc và góc B, hoặc 3 cạnh a, b, c
        if (p.ab && p.bc && p.angleB) {
          const ab = Number(p.ab);
          const bc = Number(p.bc);
          const scale = 3.4 / Math.max(ab, bc, 1);
          const c = ab * scale;
          const a = bc * scale;
          const radB = (Number(p.angleB) * Math.PI) / 180;
          pts.B = [0, 0];
          pts.C = [a, 0];
          pts.A = [c * Math.cos(radB), c * Math.sin(radB)];
          segs.push(
            { a: 'A', b: 'B', label: p.labelAB || String(p.ab) },
            { a: 'B', b: 'C', label: p.labelBC || String(p.bc) },
            { a: 'A', b: 'C', dashed: Boolean(p.dashedAC), label: p.labelAC || '' }
          );
        } else if (p.a && p.b && p.c) {
          const rawA = Number(p.a);
          const rawB = Number(p.b);
          const rawC = Number(p.c);
          const sc = 3.5 / Math.max(rawA, rawB, rawC, 1);
          const a = rawA * sc;
          const b = rawB * sc;
          const c = rawC * sc;
          const cosB = Math.max(-0.95, Math.min(0.95, (a * a + c * c - b * b) / (2 * a * c)));
          const sinB = Math.sqrt(Math.max(0.05, 1 - cosB * cosB));
          pts.B = [0, 0];
          pts.C = [a, 0];
          pts.A = [c * cosB, c * sinB];
          segs.push(
            { a: 'A', b: 'B', label: p.labelAB || '' },
            { a: 'B', b: 'C', label: p.labelBC || '' },
            { a: 'C', b: 'A', label: p.labelAC || '' }
          );
        } else {
          pts.B = [0, 0];
          pts.C = [3.8, 0];
          pts.A = [1.3, 2.6];
          segs.push({ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'A' });
        }
        break;
      }
    }

    return { pts, segs, vectors, circles, marks, compassNodes };
  }

  function splitPointNames2D(s, pts) {
    if (s.includes(',')) return s.split(',').map((t) => t.trim());
    const names = Object.keys(pts).sort((x, y) => y.length - x.length);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const n = names.find((k) => s.startsWith(k, i));
      if (!n) break;
      out.push(n);
      i += n.length;
    }
    return out;
  }

  function evalPoint2D(expr, pts) {
    const clean = expr.trim();
    if (clean.startsWith('[')) {
      const arr = JSON.parse(clean);
      return [Number(arr[0]), Number(arr[1])];
    }
    const m = clean.match(/^(\w+)\((.*)\)$/);
    if (!m) {
      if (pts[clean]) return pts[clean];
      throw new Error('Không hiểu biểu thức điểm 2D: ' + clean);
    }
    const fn = m[1].toLowerCase();
    const args = m[2].split(',').map((t) => t.trim());
    const P = (n) => {
      if (!pts[n]) throw new Error('Chưa có điểm ' + n);
      return pts[n];
    };
    switch (fn) {
      case 'midpoint':
        return avg2([P(args[0]), P(args[1])]);
      case 'centroid':
        return avg2(args.map(P));
      case 'center':
        return avg2(splitPointNames2D(m[2], pts).map(P));
      case 'onseg': {
        const t = Number(args[2]);
        return V2.add(P(args[0]), V2.mul(V2.sub(P(args[1]), P(args[0])), t));
      }
      case 'foot': {
        const p = P(args[0]);
        const a = P(args[1]);
        const d = V2.sub(P(args[2]), a);
        return V2.add(a, V2.mul(d, V2.dot(V2.sub(p, a), d) / (V2.dot(d, d) || 1)));
      }
      case 'polar': {
        const base = P(args[0]);
        const r = Number(args[1]);
        const deg = Number(args[2]);
        const rad = (deg * Math.PI) / 180;
        return [base[0] + r * Math.cos(rad), base[1] + r * Math.sin(rad)];
      }
      case 'compass': {
        const base = P(args[0]);
        const r = Number(args[1]);
        const deg = parseBearingDeg(args[2]);
        const rad = (deg * Math.PI) / 180;
        return [base[0] + r * Math.cos(rad), base[1] + r * Math.sin(rad)];
      }
      default:
        throw new Error('Hàm điểm 2D không hỗ trợ: ' + fn);
    }
  }

  function buildGeo2D(spec) {
    const base = buildPreset2D(spec.preset || 'triangle', {
      ...(spec.params || {}),
      points: spec.points,
    });
    const pts = { ...base.pts, ...(spec.points || {}) };
    const segs = [...base.segs];
    const vectors = [...base.vectors];
    const circles = [...base.circles];
    const marks = [...base.marks, ...(spec.marks || [])];
    const compassNodes = [...base.compassNodes];

    const addSeg = (a, b, dashed = false, label = '') => {
      if (!pts[a] || !pts[b]) return;
      const existing = segs.find(
        (s) => (s.a === a && s.b === b) || (s.a === b && s.b === a)
      );
      if (existing) {
        if (dashed) existing.dashed = true;
        if (label) existing.label = label;
        return;
      }
      segs.push({ a, b, dashed, label });
    };

    (spec.extra || []).forEach((cmd) => {
      const str = String(cmd).trim();
      const parts = str.split(/\s+/);
      const kw = parts[0].toLowerCase();
      if (kw === 'point') {
        const ptName = parts[1];
        const expr = parts.slice(2).join(' ');
        pts[ptName] = evalPoint2D(expr, pts);
      } else if (kw === 'segment') {
        const a = parts[1];
        const b = parts[2];
        const rest = parts.slice(3).join(' ');
        const dashed = /\bdashed\b/i.test(rest);
        const lblMatch = rest.match(/label=([^\s]+|"[^"]+")/i);
        const label = lblMatch ? lblMatch[1].replace(/^"|"$/g, '') : '';
        addSeg(a, b, dashed, label);
      } else if (kw === 'vector') {
        const a = parts[1];
        const b = parts[2];
        if (pts[a] && pts[b]) vectors.push({ a, b });
      } else if (kw === 'polygon') {
        const pNames = parts.slice(1);
        for (let i = 0; i < pNames.length; i++) {
          addSeg(pNames[i], pNames[(i + 1) % pNames.length], false);
        }
      } else if (kw === 'circle') {
        const center = parts[1];
        const arg2 = parts[2];
        if (pts[center]) {
          const r = pts[arg2]
            ? V2.len(V2.sub(pts[arg2], pts[center]))
            : Number(arg2 || 2);
          circles.push({ center, r });
        }
      } else if (kw === 'rightangle') {
        marks.push(str);
      }
    });

    if (spec.edgeLabels && typeof spec.edgeLabels === 'object') {
      Object.entries(spec.edgeLabels).forEach(([edgeKey, lbl]) => {
        const pair = splitPointNames2D(edgeKey, pts);
        if (pair.length === 2) {
          addSeg(pair[0], pair[1], false, String(lbl));
        }
      });
    }

    return { pts, segs, vectors, circles, marks, compassNodes };
  }

  function renderGeo2D(spec) {
    const G = buildGeo2D(spec);
    const sc = Number(spec.scale || 72);
    const pad = 42;

    const bboxPts = Object.values(G.pts).slice();
    G.circles.forEach((c) => {
      const o = G.pts[c.center];
      if (o) {
        bboxPts.push([o[0] - c.r, o[1] - c.r], [o[0] + c.r, o[1] + c.r]);
      }
    });
    G.compassNodes.forEach((cn) => {
      const p = G.pts[cn.pt];
      if (p) {
        bboxPts.push([p[0], p[1] + 1.1], [p[0], p[1] - (cn.showSouth ? 1.1 : 0.3)]);
      }
    });

    if (bboxPts.length === 0) {
      return '';
    }

    const xs = bboxPts.map((p) => p[0]);
    const ys = bboxPts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const W = Math.max(220, (maxX - minX) * sc + 2 * pad);
    const H = Math.max(170, (maxY - minY) * sc + 2 * pad);
    const T = (p) => [pad + (p[0] - minX) * sc, pad + (maxY - p[1]) * sc];

    const out = [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}">`,
      `<rect width="${W.toFixed(0)}" height="${H.toFixed(0)}" fill="#fff"/>`,
      `<defs><marker id="g2Arr" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1.5 L10,5 L0,8.5 z" fill="#000"/></marker></defs>`,
    ];

    const fontItalic = 'font-family="Times New Roman, serif" font-size="17" font-style="italic"';
    const fontNormal = 'font-family="Times New Roman, serif" font-size="14"';

    // 1. Vẽ kim chỉ hướng Bắc - Nam (nếu là bài toán phương hướng)
    G.compassNodes.forEach((cn) => {
      const p = G.pts[cn.pt];
      if (!p) return;
      const [x, y] = T(p);
      const northLen = 0.95 * sc;
      out.push(
        `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - northLen).toFixed(1)}" stroke="#555" stroke-width="1" stroke-dasharray="4,3" marker-end="url(#g2Arr)"/>`
      );
      out.push(
        `<text x="${(x + 8).toFixed(1)}" y="${(y - northLen + 4).toFixed(1)}" ${fontNormal} fill="#333">Bắc</text>`
      );
      if (cn.showSouth) {
        const southLen = 0.85 * sc;
        out.push(
          `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y + southLen).toFixed(1)}" stroke="#555" stroke-width="1" stroke-dasharray="4,3"/>`
        );
        out.push(
          `<text x="${(x - 16).toFixed(1)}" y="${(y + southLen + 10).toFixed(1)}" ${fontNormal} fill="#333">Nam</text>`
        );
      }
    });

    // 2. Đường tròn
    G.circles.forEach((c) => {
      const o = G.pts[c.center];
      if (!o) return;
      const [cx, cy] = T(o);
      out.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(c.r * sc).toFixed(1)}" fill="none" stroke="#000" stroke-width="1.4"/>`
      );
    });

    // 3. Đoạn thẳng & Nhãn cạnh
    const center2D = avg2(Object.values(G.pts));
    G.segs.forEach((s) => {
      const pa = G.pts[s.a];
      const pb = G.pts[s.b];
      if (!pa || !pb) return;
      const [x1, y1] = T(pa);
      const [x2, y2] = T(pb);
      out.push(
        `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="1.4"${s.dashed ? ' stroke-dasharray="5,4"' : ''}/>`
      );
      if (s.label) {
        const mid = avg2([pa, pb]);
        const [mx, my] = T(mid);
        const dir = V2.norm(V2.sub(pb, pa));
        let nrm = V2.perp(dir);
        if (V2.dot(nrm, V2.sub(mid, center2D)) < 0) {
          nrm = V2.mul(nrm, -1);
        }
        const lx = mx + nrm[0] * 15;
        const ly = my - nrm[1] * 15;
        out.push(
          `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ${fontNormal}>${escXml(s.label)}</text>`
        );
      }
    });

    // 4. Vectơ
    G.vectors.forEach((v) => {
      const pa = G.pts[v.a];
      const pb = G.pts[v.b];
      if (!pa || !pb) return;
      const [x1, y1] = T(pa);
      const [x2, y2] = T(pb);
      out.push(
        `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="1.6" marker-end="url(#g2Arr)"/>`
      );
    });

    // 5. Ký hiệu góc vuông
    G.marks.forEach((m) => {
      const t = String(m).trim().split(/\s+/);
      if (t[0].toLowerCase() !== 'rightangle') return;
      const A = G.pts[t[1]];
      const O = G.pts[t[2]];
      const B = G.pts[t[3]];
      if (!A || !O || !B) return;
      const sz = 0.22;
      const ua = V2.mul(V2.norm(V2.sub(A, O)), sz);
      const ub = V2.mul(V2.norm(V2.sub(B, O)), sz);
      const p1 = T(V2.add(O, ua));
      const p2 = T(V2.add(V2.add(O, ua), ub));
      const p3 = T(V2.add(O, ub));
      out.push(
        `<polyline points="${[p1, p2, p3].map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#000" stroke-width="1"/>`
      );
    });

    // 6. Đỉnh & Nhãn điểm
    Object.entries(G.pts).forEach(([name, p]) => {
      const [x, y] = T(p);
      let dx = p[0] - center2D[0];
      let dy = p[1] - center2D[1];
      const L = Math.hypot(dx, dy);
      if (L < 1e-6) {
        dx = 0;
        dy = -1;
      } else {
        dx /= L;
        dy /= L;
      }
      out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="#000"/>`);
      out.push(
        `<text x="${(x + dx * 15).toFixed(1)}" y="${(y - dy * 15).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ${fontItalic}>${escXml(name)}</text>`
      );
    });

    out.push('</svg>');
    return out.join('');
  }

  global.Geo2D = { buildGeo2D, renderGeo2D };
})(typeof window !== 'undefined' ? window : globalThis);
