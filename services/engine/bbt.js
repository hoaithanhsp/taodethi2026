/* ==========================================================================
 * BBT ENGINE — Bảng biến thiên chuẩn SGK (SVG thuần, xuất PNG/DOCX được)
 * Phụ thuộc: math.js (window.math)
 *
 *  analyzeFunction("x^3-3x^2+2")  -> spec (tự tính đạo hàm, nghiệm, cực trị, giới hạn)
 *  renderBBT(spec)                -> chuỗi <svg>
 *  verifyBBT(fn, specTuAI)        -> { ok, errors[] }   (kiểm chứng bảng do AI sinh)
 *
 *  Định dạng spec (AI có thể sinh trực tiếp JSON này):
 *  {
 *    xs:    ["-\\infty", "0", "2", "+\\infty"],      // mốc x
 *    signs: ["+", "0", "-", "0", "+"],               // 2n-1 phần tử: khoảng / mốc
 *                                                     // mốc: "0" | "" | "||" (không xác định)
 *    ys: [ {level:"bottom", label:"-\\infty"},       // mỗi mốc x 1 phần tử
 *          {level:"top",    label:"2"},
 *          {pole:true, left:{level:"bottom",label:"-\\infty"},
 *                      right:{level:"top",label:"+\\infty"}}, ... ]
 *  }
 * ======================================================================== */
(function (global) {
  const M = global.math;
  const BIG = 1e6;

  /* ---------- tiện ích số ---------- */
  function niceNumber(v) {
    if (!isFinite(v)) return v > 0 ? '+\\infty' : '-\\infty';
    if (Math.abs(v - Math.round(v)) < 1e-7) return String(Math.round(v));
    try {
      const f = M.fraction(v);
      if (f.d <= 12 && Math.abs(f.n / f.d * f.s - v) < 1e-7)
        return (f.s < 0 ? '-' : '') + '\\frac{' + f.n + '}{' + f.d + '}';
    } catch (e) { /* bỏ qua */ }
    // thử dạng a*sqrt(b)
    for (let b = 2; b <= 30; b++) {
      const a = v / Math.sqrt(b);
      if ([2, 3, 5, 6, 7, 10, 11, 13].includes(b) && Math.abs(a - Math.round(a)) < 1e-7 && Math.round(a) !== 0) {
        const ai = Math.round(a);
        return (ai === 1 ? '' : ai === -1 ? '-' : ai) + '\\sqrt{' + b + '}';
      }
    }
    return String(Math.round(v * 100) / 100).replace('.', ',');
  }

  /** Tìm nghiệm thực của hàm g trên [lo,hi] bằng quét + chia đôi (gồm cả nghiệm kép). */
  function findRoots(g, lo = -60, hi = 60, step = 0.005) {
    const roots = [];
    const push = (r) => { if (!roots.some((x) => Math.abs(x - r) < 1e-5)) roots.push(r); };
    let x0 = lo, g0 = g(x0);
    for (let x1 = lo + step; x1 <= hi; x1 += step) {
      const g1 = g(x1);
      if (isFinite(g0) && isFinite(g1)) {
        if (g0 === 0) push(x0);
        else if (g0 * g1 < 0) {
          let a = x0, b = x1, ga = g0;
          for (let k = 0; k < 80; k++) {
            const m = (a + b) / 2, gm = g(m);
            if (ga * gm <= 0) b = m; else { a = m; ga = gm; }
          }
          push((a + b) / 2);
        }
      }
      x0 = x1; g0 = g1;
    }
    // nghiệm kép (chạm 0 không đổi dấu): tìm cực tiểu của |g| gần 0
    for (let x = lo + step; x < hi - step; x += step) {
      const a = Math.abs(g(x - step)), b = Math.abs(g(x)), c = Math.abs(g(x + step));
      if (b <= a && b <= c && b < 1e-4) {
        let l = x - step, r = x + step;
        for (let k = 0; k < 60; k++) {
          const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3;
          if (Math.abs(g(m1)) < Math.abs(g(m2))) r = m2; else l = m1;
        }
        const xr = (l + r) / 2;
        if (Math.abs(g(xr)) < 1e-7) push(Math.round(xr * 1e6) / 1e6);
      }
    }
    return roots.map((r) => (Math.abs(r - Math.round(r)) < 1e-6 ? Math.round(r) : r)).sort((a, b) => a - b);
  }

  function limitValue(f, x) {
    const v = f(x);
    if (!isFinite(v) || Math.abs(v) > BIG) return v > 0 ? Infinity : -Infinity;
    return Math.abs(v - Math.round(v)) < 1e-4 ? Math.round(v) : v;
  }

  /** Phân tích hàm số → spec bảng biến thiên. */
  function analyzeFunction(fnStr) {
    const node = M.parse(fnStr);
    const fc = node.compile();
    const f = (x) => { try { return fc.evaluate({ x }); } catch (e) { return NaN; } };
    const dnode = M.derivative(node, 'x');
    const dc = dnode.compile();
    const df = (x) => { try { return dc.evaluate({ x }); } catch (e) { return NaN; } };

    // điểm không xác định (mẫu = 0)
    let poles = [];
    try {
      const r = M.rationalize(fnStr, {}, true);
      if (r.denominator) {
        const den = r.denominator.compile();
        poles = findRoots((x) => den.evaluate({ x }));
      }
    } catch (e) { /* hàm không hữu tỉ: bỏ qua */ }

    const crit = findRoots((x) => (poles.some((p) => Math.abs(x - p) < 1e-3) ? NaN : df(x)))
      .filter((c) => !poles.some((p) => Math.abs(c - p) < 1e-4));

    const pts = [...crit.map((x) => ({ x, kind: 'crit' })), ...poles.map((x) => ({ x, kind: 'pole' }))]
      .sort((a, b) => a.x - b.x);

    const xs = ['-\\infty', ...pts.map((p) => niceNumber(p.x)), '+\\infty'];
    const signs = [];
    const bounds = [-Infinity, ...pts.map((p) => p.x), Infinity];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1];
      const mid = !isFinite(a) ? b - 1 : !isFinite(b) ? a + 1 : (a + b) / 2;
      const s = df(isFinite(a) || isFinite(b) ? mid : 0);
      signs.push(s > 0 ? '+' : s < 0 ? '-' : '0');
      if (i < pts.length) signs.push(pts[i].kind === 'pole' ? '||' : '0');
    }

    const lvl = (signBefore, signAfter) => {
      // mốc đỉnh: trước tăng sau giảm → top; trước giảm sau tăng → bottom
      if (signBefore === '+' && signAfter === '-') return 'top';
      if (signBefore === '-' && signAfter === '+') return 'bottom';
      return 'mid'; // điểm uốn có f'=0 (nghiệm kép): mũi tên đi qua giữa
    };
    const ys = [];
    const eps = 1e-7;
    // -∞
    {
      const v = limitValue(f, -1e7), first = signs[0];
      ys.push({ level: first === '+' ? 'bottom' : 'top', label: niceNumber(v) });
    }
    pts.forEach((p, i) => {
      const sBefore = signs[2 * i], sAfter = signs[2 * i + 2];
      if (p.kind === 'pole') {
        const l = limitValue(f, p.x - eps), r = limitValue(f, p.x + eps);
        ys.push({
          pole: true,
          left: { level: sBefore === '+' ? 'top' : 'bottom', label: niceNumber(l) },
          right: { level: sAfter === '+' ? 'bottom' : 'top', label: niceNumber(r) },
        });
      } else {
        ys.push({ level: lvl(sBefore, sAfter), label: niceNumber(f(p.x)) });
      }
    });
    {
      const v = limitValue(f, 1e7), last = signs[signs.length - 1];
      ys.push({ level: last === '+' ? 'top' : 'bottom', label: niceNumber(v) });
    }
    return {
      fn: fnStr, derivative: dnode.toString(), xs, signs, ys,
      critical: crit, poles,
      extrema: crit.map((x) => ({ x, y: f(x) })),
    };
  }

  /* ---------- LaTeX đơn giản → text SVG (Unicode) ---------- */
  function texToText(s) {
    return String(s)
      .replace(/\\infty/g, '∞')
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
      .replace(/\\pi/g, 'π')
      .replace(/-/g, '−')
      .replace(/[{}$\\]/g, '');
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /** Vẽ SVG bảng biến thiên kiểu tkz-tab. */
  function renderBBT(spec, opt = {}) {
    const W0 = opt.labelWidth || 60, colW = opt.colWidth || 80;
    const hX = 36, hD = 36, hY = opt.yHeight || 96, pad = 14;
    const n = spec.xs.length;
    const W = W0 + colW * (n - 1) + 2 * pad;
    const H = hX + hD + hY;
    const xAt = (i) => W0 + pad + colW * i;
    const font = 'font-family="Times New Roman, serif" font-size="17"';
    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
    out.push(`<defs><marker id="bbtArr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#000"/></marker></defs>`);
    out.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="#fff" stroke="#000"/>`);
    out.push(`<line x1="${W0}" y1="0" x2="${W0}" y2="${H}" stroke="#000"/>`);
    out.push(`<line x1="0" y1="${hX}" x2="${W}" y2="${hX}" stroke="#000"/>`);
    out.push(`<line x1="0" y1="${hX + hD}" x2="${W}" y2="${hX + hD}" stroke="#000"/>`);
    const T = (x, y, s, extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" ${font} ${extra}>${esc(texToText(s))}</text>`;
    out.push(T(W0 / 2, hX / 2, 'x', 'font-style="italic"'));
    out.push(T(W0 / 2, hX + hD / 2, opt.dLabel || "y'", 'font-style="italic"'));
    out.push(T(W0 / 2, hX + hD + hY / 2, opt.fLabel || 'y', 'font-style="italic"'));
    // hàng x
    spec.xs.forEach((v, i) => out.push(T(xAt(i), hX / 2, v)));
    // hàng y'
    spec.signs.forEach((s, k) => {
      const x = k % 2 === 0 ? (xAt(k / 2) + xAt(k / 2 + 1)) / 2 : xAt((k + 1) / 2);
      if (s === '||') {
        out.push(`<line x1="${x - 2}" y1="${hX}" x2="${x - 2}" y2="${H}" stroke="#000"/><line x1="${x + 2}" y1="${hX}" x2="${x + 2}" y2="${H}" stroke="#000"/>`);
      } else if (s) out.push(T(x, hX + hD / 2, s === '-' ? '−' : s));
      if (k % 2 === 1 && s === '0') out.push(`<line x1="${x}" y1="${hX}" x2="${x}" y2="${hX + hD}" stroke="#000" stroke-dasharray="2,3"/>`);
    });
    // hàng y: tính các nút (x, y, label)
    const yTop = hX + hD + 18, yBot = H - 16;
    const yOf = (lv) => (lv === 'top' ? yTop : lv === 'mid' ? (yTop + yBot) / 2 : yBot);
    const nodes = []; // {x,y,label,seg} seg tăng khi qua điểm không xác định
    let seg = 0;
    spec.ys.forEach((e, i) => {
      const x = xAt(i);
      if (e.pole) {
        nodes.push({ x: x - 6, y: yOf(e.left.level), label: e.left.label, seg, anchor: 'end' });
        seg++;
        nodes.push({ x: x + 6, y: yOf(e.right.level), label: e.right.label, seg, anchor: 'start' });
      } else {
        const anchor = i === 0 ? 'start' : i === spec.ys.length - 1 ? 'end' : 'middle';
        nodes.push({ x: i === 0 ? x - 4 : i === spec.ys.length - 1 ? x + 4 : x, y: yOf(e.level), label: e.label, seg, anchor });
      }
    });
    nodes.forEach((nd) => out.push(`<text x="${nd.x}" y="${nd.y}" text-anchor="${nd.anchor}" dominant-baseline="middle" ${font}>${esc(texToText(nd.label))}</text>`));
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      if (a.seg !== b.seg) continue;
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const sA = 22 / L, sB = 22 / L;
      const x1 = a.x + dx * sA, y1 = a.y + dy * sA + (dy > 0 ? 6 : dy < 0 ? -6 : 0);
      const x2 = b.x - dx * sB, y2 = b.y - dy * sB - (dy > 0 ? 6 : dy < 0 ? -6 : 0);
      out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="1.2" marker-end="url(#bbtArr)"/>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  /** So sánh bảng biến thiên do AI sinh với kết quả tính toán. */
  function verifyBBT(fnStr, aiSpec) {
    const ref = analyzeFunction(fnStr);
    const errors = [];
    const num = (s) => { try { return M.evaluate(String(s).replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)').replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)').replace(/\\infty/g, 'Infinity')); } catch (e) { return NaN; } };
    if (aiSpec.xs.length !== ref.xs.length) errors.push(`Số mốc x: AI=${aiSpec.xs.length}, đúng=${ref.xs.length} (${ref.xs.join('; ')})`);
    else aiSpec.xs.forEach((v, i) => { if (Math.abs(num(v) - num(ref.xs[i])) > 1e-6 && isFinite(num(ref.xs[i]))) errors.push(`Mốc x thứ ${i + 1}: AI=${v}, đúng=${ref.xs[i]}`); });
    if (aiSpec.signs.join() !== ref.signs.join()) errors.push(`Dấu y': AI=[${aiSpec.signs}], đúng=[${ref.signs}]`);
    if (aiSpec.ys.length === ref.ys.length) aiSpec.ys.forEach((e, i) => {
      const r = ref.ys[i];
      if (!e.pole && !r.pole && isFinite(num(r.label)) && Math.abs(num(e.label) - num(r.label)) > 1e-6) errors.push(`Giá trị y tại x=${ref.xs[i]}: AI=${e.label}, đúng=${r.label}`);
    });
    return { ok: errors.length === 0, errors, reference: ref };
  }

  global.BBT = { analyzeFunction, renderBBT, verifyBBT, niceNumber, findRoots, texToText };
})(typeof window !== 'undefined' ? window : globalThis);
