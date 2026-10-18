/* ==========================================================================
 * GRAPH ENGINE — Đồ thị hàm số kiểu SGK (SVG thuần, không cần JSXGraph)
 * Phụ thuộc: math.js (window.math); dùng lại BBT.findRoots/niceNumber nếu có.
 *
 *  analyzeGraph(fn)       -> { poles, hAsym, oblique, extrema, xIntercepts, yIntercept }
 *  renderGraph(spec)      -> chuỗi <svg>
 *
 *  spec (AI sinh JSON này):
 *  { type:"graph", fn:["(2x+1)/(x-1)"], xRange:[-4,5], yRange:[-4,7],
 *    asymptotes:"auto" | false, points:"extrema+intercepts" | "extrema" | "none",
 *    grid:false, unit:40,
 *    shade:{ fn:"x^2", fn2:"0", from:0, to:2 }   // tuỳ chọn: tô miền tích phân
 *    marks:[[1,2,"A"]] }                          // tuỳ chọn: điểm thêm
 * ======================================================================== */
(function (global) {
  const M = global.math;
  const B = global.BBT || {};
  const nice = B.niceNumber || ((v) => String(Math.round(v * 100) / 100));

  // Chuẩn hoá biểu thức (LaTeX, ln, nhân ngầm...) bằng BBT nếu có; trả về hàm số thực (NaN khi không xác định).
  function compile(fnStr) {
    if (B.makeFunction) return B.makeFunction(String(fnStr)).f;
    const c = M.parse(fnStr).compile();
    return (x) => { try { const v = c.evaluate({ x }); return typeof v === 'number' ? v : NaN; } catch (e) { return NaN; } };
  }

  function roots(g, lo, hi) {
    if (B.findRoots) return B.findRoots(g, lo, hi, Math.max((hi - lo) / 4000, 0.002));
    const out = []; const step = (hi - lo) / 4000;
    for (let x = lo; x < hi; x += step) { const a = g(x), b = g(x + step); if (isFinite(a) && isFinite(b) && a * b <= 0 && a !== b) out.push(x - a * step / (b - a)); }
    return out;
  }

  const round4 = (v) => Math.round(v * 1e4) / 1e4;
  const dedupNum = (arr) => arr.sort((a, b) => a - b).filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) > 1e-6 * Math.max(1, Math.abs(v)));

  /** Tiệm cận đứng (fallback khi không có BBT mới): nghiệm mẫu số của phân thức. */
  function polesLegacy(fnStr, f, lo, hi) {
    try {
      const r = M.rationalize(fnStr, {}, true);
      if (r.denominator) {
        const den = compile(r.denominator.toString());
        return roots(den, lo, hi).filter((p) => Math.abs(f(p + 1e-6)) > 1e4 || Math.abs(f(p - 1e-6)) > 1e4);
      }
    } catch (e) { /* không phải phân thức */ }
    return [];
  }

  /** Tìm tiệm cận, cực trị, giao trục của một hàm. */
  function analyzeGraph(fnStr, lo = -30, hi = 30) {
    let f, df, node = null, normStr = fnStr;
    if (B.makeFunction) {
      const mf = B.makeFunction(String(fnStr));
      f = mf.f; df = mf.df; node = mf.node; normStr = mf.fnStr;
    } else {
      f = compile(fnStr);
      df = compile(M.derivative(fnStr, 'x').toString());
    }
    const R = Math.max(Math.abs(lo), Math.abs(hi));

    // --- tiệm cận đứng: điểm gián đoạn vô cực trong TXĐ + đầu mút mở mà f → ±∞ (vd ln x tại 0)
    let poles = [];
    if (B.findDomain && B.findPoles && B.limitAt) {
      try {
        const intervals = B.findDomain(f, R);
        poles = B.findPoles(node, f, df, R, intervals).filter((p) => {
          const l = B.limitAt(f, p, -1), r = B.limitAt(f, p, 1);
          return !isFinite(l) && !isNaN(l) || !isFinite(r) && !isNaN(r);
        });
        intervals.forEach((I) => {
          [[I.a, I.aClosed, 1], [I.b, I.bClosed, -1]].forEach(([x, closed, side]) => {
            if (!isFinite(x) || closed) return;
            const L = B.limitAt(f, x, side);
            if (L === Infinity || L === -Infinity) poles.push(x);
          });
        });
        poles = dedupNum(poles.filter((p) => p >= lo && p <= hi));
      } catch (e) { poles = polesLegacy(normStr, f, lo, hi); }
    } else poles = polesLegacy(normStr, f, lo, hi);

    // --- tiệm cận ngang: xét riêng từng phía (vd e^x chỉ có y = 0 khi x → −∞)
    const limInf = (dir) => {
      if (B.limitInf) return B.limitInf(f, dir);
      const v = f(dir * 1e6);
      return isFinite(v) && Math.abs(v - f(dir * 2e6)) < 1e-3 ? v : NaN;
    };
    const hL = limInf(-1), hR = limInf(1);
    const hAsyms = dedupNum([hL, hR].filter((v) => isFinite(v) && Math.abs(v) < 1e5).map(round4));
    // giữ trường cũ: một giá trị (ưu tiên khi hai phía trùng nhau)
    const hAsym = hAsyms.length ? (isFinite(hR) && Math.abs(hR) < 1e5 ? round4(hR) : hAsyms[0]) : null;

    // --- tiệm cận xiên (chỉ khi không có tiệm cận ngang ở phía tương ứng)
    let oblique = null;
    if (!hAsyms.length) {
      const big = 1e6;
      const a = (f(2 * big) - f(big)) / big, b = f(big) - a * big;
      const a2 = (f(-2 * big) - f(-big)) / -big;
      if (isFinite(a) && Math.abs(a - a2) < 1e-4 && Math.abs(a) > 1e-6 && Math.abs(b) < 1e5) {
        // kiểm tra f(x) − (ax+b) → 0 thật sự (loại x·ln x, x + sin x ...)
        const gap = Math.abs(f(1e5) - (a * 1e5 + b));
        if (gap < 1e-2) oblique = { a: round4(a), b: round4(b) };
      }
    }

    const nearPole = (x) => poles.some((p) => Math.abs(x - p) < 1e-3);
    const crit = roots((x) => (nearPole(x) ? NaN : df(x)), lo, hi);
    const extrema = crit.map((x) => {
      const h = 1e-3 * Math.max(1, Math.abs(x));
      const l = df(x - h), r = df(x + h);
      const kind = l > 0 && r < 0 ? 'max' : l < 0 && r > 0 ? 'min' : 'flat';
      return { x, y: f(x), kind };
    }).filter((e) => e.kind !== 'flat' && isFinite(e.y));

    // --- giao điểm với Ox: loại "nghiệm" giả khi f chỉ tiến sát 0 (vd e^x khi x → −∞)
    const xIntercepts = roots((x) => (nearPole(x) ? NaN : f(x)), lo, hi).filter((x) => {
      if (!(Math.abs(f(x)) < 1e-6)) return false;
      const d = 0.05 * Math.max(1, Math.abs(x));
      const around = Math.max(Math.abs(f(x - d)) || 0, Math.abs(f(x + d)) || 0);
      return around > 1e-6;
    });
    const y0 = f(0);
    return { fn: fnStr, f, poles, hAsym, hAsyms, oblique, extrema, xIntercepts, yIntercept: isFinite(y0) && !nearPole(0) ? y0 : null };
  }

  /** Vẽ đồ thị. */
  function renderGraph(spec) {
    const fns = Array.isArray(spec.fn) ? spec.fn : [spec.fn];
    const infos = fns.map((s) => analyzeGraph(s));
    let [x0, x1] = spec.xRange || [-5, 5];
    let [y0, y1] = spec.yRange || autoY(infos, x0, x1);
    const u = spec.unit || Math.min(44, 520 / (x1 - x0), 440 / (y1 - y0));
    const pad = 22;
    const W = (x1 - x0) * u + 2 * pad, H = (y1 - y0) * u + 2 * pad;
    const X = (x) => pad + (x - x0) * u, Y = (y) => pad + (y1 - y) * u;
    const font = 'font-family="Times New Roman, serif" font-size="15"';
    const colors = spec.colors || ['#000', '#1f4fbf', '#b22', '#2a7a2a'];
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}">`];
    out.push('<defs><marker id="gArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,1 L10,5 L0,9 z" fill="#000"/></marker>'
      + `<clipPath id="gClip"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}"/></clipPath></defs>`);
    out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    const txt = (x, y, s, anchor = 'middle', extra = '') => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" ${font} ${extra}>${String(s).replace(/</g, '&lt;')}</text>`;
    const label = (v) => (B.texToText ? B.texToText(nice(v)) : nice(v));

    // lưới
    if (spec.grid) for (let i = Math.ceil(x0); i <= x1; i++) out.push(`<line x1="${X(i)}" y1="${pad}" x2="${X(i)}" y2="${H - pad}" stroke="#ddd"/>`);
    if (spec.grid) for (let j = Math.ceil(y0); j <= y1; j++) out.push(`<line x1="${pad}" y1="${Y(j)}" x2="${W - pad}" y2="${Y(j)}" stroke="#ddd"/>`);

    // miền tô (tích phân / diện tích)
    if (spec.shade) {
      const g1 = compile(spec.shade.fn), g2 = compile(spec.shade.fn2 || '0');
      const a = spec.shade.from, b = spec.shade.to, N = 200, pts = [];
      for (let k = 0; k <= N; k++) { const x = a + (b - a) * k / N; pts.push(`${X(x).toFixed(1)},${Y(g1(x)).toFixed(1)}`); }
      for (let k = N; k >= 0; k--) { const x = a + (b - a) * k / N; pts.push(`${X(x).toFixed(1)},${Y(g2(x)).toFixed(1)}`); }
      out.push(`<polygon points="${pts.join(' ')}" fill="#9bb7e8" fill-opacity="0.45" stroke="none" clip-path="url(#gClip)"/>`);
    }

    // khối tròn xoay quanh trục Ox (tích phân thể tích V = pi * int_a^b [f(x)]^2 dx)
    if (spec.revolve) {
      const revFn = compile(spec.revolve.fn || fns[0]);
      const a = spec.revolve.from ?? 0, b = spec.revolve.to ?? 2, N = 200;
      const topPts = [], botPts = [];
      for (let k = 0; k <= N; k++) {
        const x = a + (b - a) * k / N, yv = revFn(x);
        if (isFinite(yv)) {
          topPts.push([X(x), Y(yv)]);
          botPts.push([X(x), Y(-yv)]);
        }
      }
      if (topPts.length > 1) {
        const polyPts = [...topPts, ...botPts.slice().reverse()].map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
        out.push(`<polygon points="${polyPts}" fill="#9bb7e8" fill-opacity="0.32" stroke="none" clip-path="url(#gClip)"/>`);
        out.push(`<path d="M${botPts.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join(' L')}" fill="none" stroke="#333" stroke-width="1.3" clip-path="url(#gClip)"/>`);
      }
      // Hàm vẽ thiết diện elip đứng tại hoành độ xSec
      const drawDisk = (xSec, fillOpacity = 0) => {
        const rVal = Math.abs(revFn(xSec));
        if (!isFinite(rVal) || rVal < 1e-3) return;
        const cx = X(xSec), cy = Y(0);
        const ry = Math.abs(Y(0) - Y(rVal));
        const rx = Math.max(6, Math.min(ry * 0.32, Math.abs(X(b) - X(a)) * 0.14));
        if (fillOpacity > 0) {
          out.push(`<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="#7ea4e0" fill-opacity="${fillOpacity}" stroke="none"/>`);
        }
        // Nửa trước (bên phải: -pi/2 -> pi/2) nét liền
        const front = [], back = [];
        const Msteps = 40;
        for (let i = 0; i <= Msteps; i++) {
          const tF = -Math.PI / 2 + (Math.PI * i) / Msteps;
          front.push([cx + rx * Math.cos(tF), cy + ry * Math.sin(tF)]);
          const tB = Math.PI / 2 + (Math.PI * i) / Msteps;
          back.push([cx + rx * Math.cos(tB), cy + ry * Math.sin(tB)]);
        }
        out.push(`<path d="M${front.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L')}" fill="none" stroke="#000" stroke-width="1.4"/>`);
        // Nửa sau (bên trái: pi/2 -> 3pi/2) nét đứt
        for (let i = 0; i < back.length - 1; i += 2) {
          const p0 = back[i], p1 = back[Math.min(i + 1, back.length - 1)];
          out.push(`<line x1="${p0[0].toFixed(2)}" y1="${p0[1].toFixed(2)}" x2="${p1[0].toFixed(2)}" y2="${p1[1].toFixed(2)}" stroke="#000" stroke-width="1.15"/>`);
        }
        // Bán kính tại thiết diện
        out.push(`<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${Y(revFn(xSec)).toFixed(1)}" stroke="#000" stroke-width="1" stroke-dasharray="4,3"/>`);
        out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.2" fill="#000"/>`);
      };
      drawDisk(a, 0.18);
      if (spec.revolve.midDisk !== false && b - a > 0.5) {
        drawDisk((a + b) / 2, 0.12);
      }
      drawDisk(b, 0.25);
    }

    // trục toạ độ
    const ox = Math.min(Math.max(0, x0), x1), oy = Math.min(Math.max(0, y0), y1);
    out.push(`<line x1="${pad - 8}" y1="${Y(oy)}" x2="${W - 4}" y2="${Y(oy)}" stroke="#000" marker-end="url(#gArr)"/>`);
    out.push(`<line x1="${X(ox)}" y1="${H - pad + 8}" x2="${X(ox)}" y2="4" stroke="#000" marker-end="url(#gArr)"/>`);
    out.push(txt(W - 8, Y(oy) + 14, 'x', 'middle', 'font-style="italic"'));
    out.push(txt(X(ox) - 12, 10, 'y', 'middle', 'font-style="italic"'));
    if (ox === 0 && oy === 0) out.push(txt(X(0) - 10, Y(0) + 12, 'O', 'middle', 'font-style="italic"'));

    // vạch số trên trục (chỉ ghi số tại các mốc có ý nghĩa nếu points != none, ngược lại ghi số nguyên)
    const ticksX = new Set(), ticksY = new Set();
    if (spec.revolve) {
      if (spec.revolve.from) ticksX.add(spec.revolve.from);
      if (spec.revolve.to) ticksX.add(spec.revolve.to);
    }
    if (spec.shade) {
      if (spec.shade.from) ticksX.add(spec.shade.from);
      if (spec.shade.to) ticksX.add(spec.shade.to);
    }
    if (spec.ticks === 'all' || spec.grid) {
      for (let i = Math.ceil(x0); i <= x1; i++) if (i) ticksX.add(i);
      for (let j = Math.ceil(y0); j <= y1; j++) if (j) ticksY.add(j);
    }

    // tiệm cận
    if (spec.asymptotes !== false) infos.forEach((I) => {
      I.poles.forEach((p) => { if (p > x0 && p < x1) { out.push(`<line x1="${X(p)}" y1="${pad}" x2="${X(p)}" y2="${H - pad}" stroke="#000" stroke-dasharray="5,4"/>`); ticksX.add(p); } });
      (I.hAsyms || (I.hAsym !== null ? [I.hAsym] : [])).forEach((h) => {
        if (h > y0 && h < y1) { out.push(`<line x1="${pad}" y1="${Y(h)}" x2="${W - pad}" y2="${Y(h)}" stroke="#000" stroke-dasharray="5,4"/>`); ticksY.add(h); }
      });
      if (I.oblique) { const { a, b } = I.oblique; out.push(`<line x1="${X(x0)}" y1="${Y(a * x0 + b)}" x2="${X(x1)}" y2="${Y(a * x1 + b)}" stroke="#000" stroke-dasharray="5,4" clip-path="url(#gClip)"/>`); }
    });

    // đường cong — chặt tại tiệm cận đứng và khi nhảy quá lớn
    infos.forEach((I, idx) => {
      const N = 1600, segs = []; let cur = [];
      const yLim = (y1 - y0) * 4;
      for (let k = 0; k <= N; k++) {
        const x = x0 + (x1 - x0) * k / N, y = I.f(x);
        const crossPole = cur.length && I.poles.some((p) => (cur[cur.length - 1][0] - p) * (x - p) <= 0);
        if (!isFinite(y) || Math.abs(y - (y0 + y1) / 2) > yLim || crossPole) { if (cur.length > 1) segs.push(cur); cur = []; if (!isFinite(y) || crossPole) continue; }
        cur.push([x, y]);
      }
      if (cur.length > 1) segs.push(cur);
      segs.forEach((s) => out.push(`<path d="M${s.map(([x, y]) => `${X(x).toFixed(2)},${Y(Math.max(Math.min(y, y1 + (y1 - y0)), y0 - (y1 - y0))).toFixed(2)}`).join(' L')}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="1.6" clip-path="url(#gClip)"/>`));
      if (fns.length > 1 || spec.showName) {
        let xl = null, yl = NaN;
        for (let q = 0.06; q < 0.9; q += 0.02) { const xx = x1 - (x1 - x0) * q, yy = I.f(xx); if (isFinite(yy) && yy > y0 + (y1 - y0) * 0.05 && yy < y1 - (y1 - y0) * 0.08) { xl = xx; yl = yy; break; } }
        if (xl !== null) out.push(txt(X(xl), Y(yl) - 12, spec.names?.[idx] || (idx ? ['g', 'h', 'k'][idx - 1] : 'f') , 'middle', `font-style="italic" fill="${colors[idx % colors.length]}"`));
      }
    });

    // điểm đặc biệt + đường gióng
    const mode = spec.points ?? 'extrema+intercepts';
    const dots = [];
    infos.forEach((I) => {
      if (/extrema/.test(mode)) I.extrema.forEach((e) => dots.push([e.x, e.y, '', true]));
      if (/intercepts/.test(mode)) {
        I.xIntercepts.forEach((x) => dots.push([x, 0, '', false]));
        if (I.yIntercept !== null) dots.push([0, I.yIntercept, '', false]);
      }
    });
    // giao điểm giữa các đồ thị
    if (infos.length > 1 && mode !== 'none') for (let i = 0; i < infos.length; i++) for (let j = i + 1; j < infos.length; j++) {
      const fi = infos[i].f, fj = infos[j].f;
      roots((x) => fi(x) - fj(x), x0, x1).forEach((x) => { if (Math.abs(fi(x) - fj(x)) < 1e-6) dots.push([x, fi(x), '', true]); });
    }
    (spec.marks || []).forEach(([x, y, name]) => dots.push([x, y, name || '', true]));
    dots.forEach(([x, y, name, guide]) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return;
      if (guide && Math.abs(x) > 1e-9 && Math.abs(y) > 1e-9) {
        out.push(`<polyline points="${X(x)},${Y(oy)} ${X(x)},${Y(y)} ${X(ox)},${Y(y)}" fill="none" stroke="#000" stroke-dasharray="3,3" stroke-width="0.8"/>`);
      }
      if (Math.abs(x) > 1e-9) ticksX.add(x);
      if (Math.abs(y) > 1e-9 && guide) ticksY.add(y);
      out.push(`<circle cx="${X(x)}" cy="${Y(y)}" r="2.6" fill="#000"/>`);
      if (name) out.push(txt(X(x) + 9, Y(y) - 10, name, 'start', 'font-style="italic"'));
    });
    const posY = Y(oy), posX = X(ox);
    const isNice = (v) => !/,/.test(nice(v));
    const dedup = (arr) => arr.filter((v, i) => isNice(v) && arr.findIndex((w) => Math.abs(w - v) < 1e-6) === i);
    dedup([...ticksX]).forEach((v) => { out.push(`<line x1="${X(v)}" y1="${posY - 3}" x2="${X(v)}" y2="${posY + 3}" stroke="#000"/>`); out.push(txt(X(v) + (v < 0 ? (v > -0.8 ? -8 : -4) : 0), posY + (oy === y0 ? -10 : 13), label(v), 'middle')); });
    dedup([...ticksY]).forEach((v) => { out.push(`<line x1="${posX - 3}" y1="${Y(v)}" x2="${posX + 3}" y2="${Y(v)}" stroke="#000"/>`); out.push(txt(posX - 7, Y(v), label(v), 'end')); });
    out.push('</svg>');
    return out.join('');
  }

  function autoY(infos, x0, x1) {
    let lo = Infinity, hi = -Infinity;
    infos.forEach((I) => {
      [...I.extrema.map((e) => e.y), I.yIntercept ?? 0, ...(I.hAsyms || [I.hAsym ?? 0]), 0].filter((v) => isFinite(v) && Math.abs(v) < 1e4).forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      if (!I.poles.length) [x0, x1].forEach((x) => { const v = I.f(x); if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
      else if (B.makeFunction) {
        // có tiệm cận đứng: lấy phân vị 10%–90% của giá trị hàm trên khung để thấy rõ nhánh đi ra vô cực (vd ln x)
        const vals = [];
        for (let k = 0; k <= 200; k++) { const v = I.f(x0 + ((x1 - x0) * k) / 200); if (isFinite(v)) vals.push(v); }
        if (vals.length > 10) {
          vals.sort((p, q) => p - q);
          lo = Math.min(lo, vals[Math.floor(vals.length * 0.1)]);
          hi = Math.max(hi, vals[Math.floor(vals.length * 0.9)]);
        }
      }
    });
    if (!isFinite(lo)) return [-5, 5];
    const m = Math.max(1, (hi - lo) * 0.25);
    return [Math.floor(lo - m), Math.ceil(hi + m)];
  }

  global.Graph = { analyzeGraph, renderGraph };
})(typeof window !== 'undefined' ? window : globalThis);
