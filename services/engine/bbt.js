/* ==========================================================================
 * BBT ENGINE — Bảng biến thiên chuẩn SGK (SVG thuần, xuất PNG/DOCX 300 DPI)
 * Phụ thuộc: math.js (window.math)
 *
 *  analyzeFunction("x^3-3x")      -> spec (tự tính đạo hàm, nghiệm, cực trị, giới hạn)
 *  renderBBT(spec)                -> chuỗi <svg> chuẩn SGK Việt Nam
 *  verifyBBT(fn, specTuAI)        -> { ok, errors[] }   (kiểm chứng bảng do AI sinh)
 * ======================================================================== */
(function (global) {
  const getMath = () => global.math || (typeof window !== 'undefined' ? window.math : undefined);
  const BIG = 1e6;

  /* ---------- Chuẩn hóa biểu thức hàm số (hỗ trợ cả LaTeX từ AI) ---------- */
  function normalizeFnExpr(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/^\$+|\$+$/g, '').trim();
    s = s.replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    s = s.replace(/−/g, '-').replace(/⋅|\\cdot|\\times/g, '*');
    // Chuyển \frac{A}{B} (hỗ trợ lồng nhau tối đa 3 cấp)
    for (let i = 0; i < 3; i++) {
      s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
    }
    s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
    s = s.replace(/\^\{([^{}]*)\}/g, '^($1)');
    s = s.replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')');
    s = s.replace(/\\ln\b/g, 'log');
    s = s.replace(/[{}]/g, '');
    // Thêm dấu * giữa số và x, hoặc giữa )(, hoặc )x
    s = s.replace(/(\d)\s*([a-zA-Z(])/g, '$1*$2');
    s = s.replace(/(\))\s*([a-zA-Z0-9(])/g, '$1*$2');
    s = s.replace(/\bx\s*\(/g, 'x*(');
    return s.trim();
  }

  /* ---------- tiện ích số ---------- */
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }

  function niceNumber(v) {
    if (!isFinite(v)) return v > 0 ? '+\\infty' : '-\\infty';
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
    // Tìm phân số tối giản n/d với mẫu số d <= 12
    for (let d = 2; d <= 12; d++) {
      const n = Math.round(Math.abs(v) * d);
      if (n > 0 && Math.abs(n / d - Math.abs(v)) < 1e-5) {
        const g = gcd(n, d);
        return (v < 0 ? '-' : '') + '\\frac{' + (n / g) + '}{' + (d / g) + '}';
      }
    }
    // Thử dạng a*sqrt(b)
    for (let b of [2, 3, 5, 6, 7, 10, 11, 13]) {
      const a = v / Math.sqrt(b);
      if (Math.abs(a - Math.round(a)) < 1e-5 && Math.round(a) !== 0) {
        const ai = Math.round(a);
        return (ai === 1 ? '' : ai === -1 ? '-' : ai) + '\\sqrt{' + b + '}';
      }
    }
    return String(Math.round(v * 100) / 100).replace('.', ',');
  }

  /** Tìm nghiệm thực của hàm g trên [lo,hi] bằng quét + chia đôi (gồm cả nghiệm kép). */
  function findRoots(g, lo = -25, hi = 25, step = 0.02) {
    const roots = [];
    const push = (r) => {
      const clean = Math.abs(r - Math.round(r)) < 1e-5 ? Math.round(r) : Math.round(r * 1e6) / 1e6;
      if (!roots.some((x) => Math.abs(x - clean) < 1e-4)) roots.push(clean);
    };
    let x0 = lo, g0 = g(x0);
    for (let x1 = lo + step; x1 <= hi; x1 += step) {
      const g1 = g(x1);
      if (isFinite(g0) && isFinite(g1)) {
        if (Math.abs(g0) < 1e-12) push(x0);
        else if (g0 * g1 < 0) {
          let a = x0, b = x1, ga = g0;
          for (let k = 0; k < 55; k++) {
            const m = (a + b) / 2, gm = g(m);
            if (!isFinite(gm)) break;
            if (ga * gm <= 0) b = m; else { a = m; ga = gm; }
          }
          const root = (a + b) / 2;
          if (Math.abs(g(root)) < 1e-3) push(root);
        }
      }
      x0 = x1; g0 = g1;
    }
    // nghiệm kép (chạm 0 không đổi dấu): tìm cực tiểu của |g| gần 0
    for (let x = lo + step; x < hi - step; x += step) {
      const a = Math.abs(g(x - step)), b = Math.abs(g(x)), c = Math.abs(g(x + step));
      if (b <= a && b <= c && b < 1e-3) {
        let l = x - step, r = x + step;
        for (let k = 0; k < 45; k++) {
          const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3;
          if (Math.abs(g(m1)) < Math.abs(g(m2))) r = m2; else l = m1;
        }
        const xr = (l + r) / 2;
        if (Math.abs(g(xr)) < 1e-6) push(xr);
      }
    }
    return roots.sort((a, b) => a - b);
  }

  function limitValue(f, x) {
    const v = f(x);
    if (!isFinite(v) || Math.abs(v) > BIG) return v > 0 ? Infinity : -Infinity;
    return Math.abs(v - Math.round(v)) < 1e-4 ? Math.round(v) : v;
  }

  /** Phân tích hàm số → spec bảng biến thiên. */
  function analyzeFunction(rawFnStr) {
    const M = getMath();
    const fnStr = normalizeFnExpr(rawFnStr);
    const node = M.parse(fnStr);
    const fc = node.compile();
    const f = (x) => { try { return fc.evaluate({ x }); } catch (e) { return NaN; } };
    const dnode = M.derivative(node, 'x');
    const dc = dnode.compile();
    const df = (x) => { try { return dc.evaluate({ x }); } catch (e) { return NaN; } };

    // Tìm điểm không xác định (mẫu = 0) bằng cách duyệt AST lấy mẫu số của phép chia '/'
    const poleSet = [];
    const addPole = (p) => {
      if (!poleSet.some((x) => Math.abs(x - p) < 1e-4)) poleSet.push(p);
    };
    try {
      node.traverse((sub) => {
        if (sub && sub.isOperatorNode && sub.op === '/' && sub.args && sub.args[1]) {
          const denStr = sub.args[1].toString();
          if (/\bx\b/.test(denStr)) {
            const denCompiled = sub.args[1].compile();
            const denRoots = findRoots((x) => {
              try { return denCompiled.evaluate({ x }); } catch (e) { return NaN; }
            });
            denRoots.forEach(addPole);
          }
        }
      });
    } catch (e) { /* bỏ qua */ }
    const poles = poleSet.sort((a, b) => a - b);

    const crit = findRoots((x) => (poles.some((p) => Math.abs(x - p) < 1e-3) ? NaN : df(x)))
      .filter((c) => !poles.some((p) => Math.abs(c - p) < 1e-3));

    const pts = [...crit.map((x) => ({ x, kind: 'crit' })), ...poles.map((x) => ({ x, kind: 'pole' }))]
      .sort((a, b) => a.x - b.x);

    const xs = ['-\\infty', ...pts.map((p) => niceNumber(p.x)), '+\\infty'];
    const signs = [];
    const bounds = [-Infinity, ...pts.map((p) => p.x), Infinity];
    for (let i = 0; i < bounds.length - 1; i++) {
      const a = bounds[i], b = bounds[i + 1];
      const mid = !isFinite(a) ? (isFinite(b) ? b - 1 : 0) : !isFinite(b) ? a + 1 : (a + b) / 2;
      const s = df(mid);
      signs.push(s > 0 ? '+' : s < 0 ? '-' : '0');
      if (i < pts.length) signs.push(pts[i].kind === 'pole' ? '||' : '0');
    }

    const lvl = (signBefore, signAfter) => {
      if (signBefore === '+' && signAfter === '-') return 'top';
      if (signBefore === '-' && signAfter === '+') return 'bottom';
      return 'mid';
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
    return String(s ?? '')
      .replace(/\\infty/g, '∞')
      .replace(/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
      .replace(/\\sqrt\{([^{}]*)\}/g, '√$1')
      .replace(/\\pi/g, 'π')
      .replace(/-/g, '−')
      .replace(/[{}$\\]/g, '')
      .trim();
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  /** Vẽ nhãn toán học (hỗ trợ −∞, +∞, phân số \frac{a}{b}, căn thức) */
  function renderMathLabelSvg(x, y, rawLabel, fontSize = 20) {
    const raw = String(rawLabel ?? '').replace(/^\$+|\$+$/g, '').trim();
    const font = `font-family="Times New Roman, serif" font-size="${fontSize}"`;

    // Kiểm tra -∞ hoặc +∞
    const txt = texToText(raw);
    if (txt === '−∞' || txt === '-∞') {
      return (
        `<text x="${(x - 7).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${font}>−</text>` +
        `<text x="${(x + 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Times New Roman, serif" font-size="${fontSize + 1}">∞</text>`
      );
    }
    if (txt === '+∞') {
      return (
        `<text x="${(x - 7).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${font}>+</text>` +
        `<text x="${(x + 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Times New Roman, serif" font-size="${fontSize + 1}">∞</text>`
      );
    }

    // Kiểm tra phân số \frac{num}{den}
    const fracMatch = raw.match(/^(-|\+)?\s*\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}$/);
    if (fracMatch) {
      const sign = fracMatch[1] === '-' ? '−' : fracMatch[1] === '+' ? '+' : '';
      const num = esc(texToText(fracMatch[2]));
      const den = esc(texToText(fracMatch[3]));
      const fSmall = Math.round(fontSize * 0.78);
      const fracX = sign ? x + 5 : x;
      const barHalf = Math.max(8, Math.max(num.length, den.length) * 4.5 + 3);
      let s = '';
      if (sign) {
        s += `<text x="${(fracX - barHalf - 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${font}>${sign}</text>`;
      }
      s += `<text x="${fracX.toFixed(1)}" y="${(y - fSmall * 0.74).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Times New Roman, serif" font-size="${fSmall}">${num}</text>`;
      s += `<line x1="${(fracX - barHalf).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(fracX + barHalf).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#000000" stroke-width="1.2"/>`;
      s += `<text x="${fracX.toFixed(1)}" y="${(y + fSmall * 0.84).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Times New Roman, serif" font-size="${fSmall}">${den}</text>`;
      return s;
    }

    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="central" ${font}>${esc(txt)}</text>`;
  }

  /** Vẽ mũi tên biến thiên bằng line + polygon (hiển thị sắc nét 100% trên mọi trình đọc SVG/Word/Canvas) */
  function renderArrowSvg(x1, y1, x2, y2, padStart = 24, padEnd = 22) {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (L <= padStart + padEnd + 8) return '';
    const ux = dx / L, uy = dy / L;
    const sx = x1 + ux * padStart, sy = y1 + uy * padStart;
    const ex = x2 - ux * padEnd, ey = y2 - uy * padEnd;
    const ahLen = 10.5, ahW = 4.2;
    const bx = ex - ux * ahLen, by = ey - uy * ahLen;
    const px = -uy, py = ux;
    const p1x = bx + px * ahW, p1y = by + py * ahW;
    const p2x = bx - px * ahW, p2y = by - py * ahW;
    const lx = ex - ux * 3, ly = ey - uy * 3;
    return (
      `<line x1="${sx.toFixed(2)}" y1="${sy.toFixed(2)}" x2="${lx.toFixed(2)}" y2="${ly.toFixed(2)}" stroke="#000000" stroke-width="1.5"/>` +
      `<polygon points="${ex.toFixed(2)},${ey.toFixed(2)} ${p1x.toFixed(2)},${p1y.toFixed(2)} ${(bx + ux * 2.2).toFixed(2)},${(by + uy * 2.2).toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}" fill="#000000"/>`
    );
  }

  /** Ước lượng khoảng đệm cần chừa quanh nhãn ở đầu/cuối mũi tên */
  function estimateLabelPad(rawLabel) {
    const txt = texToText(rawLabel);
    if (txt.includes('∞')) return 25;
    if (String(rawLabel).includes('\\frac')) return 25;
    if (txt.length >= 3) return 24;
    if (txt.length === 2) return 22;
    return 19;
  }

  /** Vẽ SVG bảng biến thiên chuẩn SGK Việt Nam (kiểu tkz-tab). */
  function renderBBT(spec, opt = {}) {
    const margin = opt.margin ?? 16;
    const W0 = opt.labelWidth || 68;
    const colW = opt.colWidth || 125;
    const padX = opt.padX || 48;
    const hX = 42, hD = 42, hY = opt.yHeight || 136;

    const n = spec.xs.length;
    const W = W0 + 2 * padX + colW * Math.max(1, n - 1);
    const H = hX + hD + hY;
    const W_total = W + 2 * margin;
    const H_total = H + 2 * margin;
    const x0 = margin, y0 = margin;

    const xAt = (i) => x0 + W0 + padX + colW * i;
    const y_x = y0 + hX / 2;
    const y_d = y0 + hX + hD / 2;
    const y_y = y0 + hX + hD + hY / 2;
    const yTop = y0 + hX + hD + 28;
    const yBot = y0 + H - 28;
    const yMid = (yTop + yBot) / 2;
    const yOf = (lv) => (lv === 'top' ? yTop : lv === 'mid' ? yMid : yBot);

    const out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W_total} ${H_total}" width="${W_total}" height="${H_total}">`);
    // Nền trắng
    out.push(`<rect x="0" y="0" width="${W_total}" height="${H_total}" fill="#ffffff"/>`);
    // Khung bảng chính & các đường phân cách
    out.push(`<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="none" stroke="#000000" stroke-width="1.6"/>`);
    out.push(`<line x1="${x0 + W0}" y1="${y0}" x2="${x0 + W0}" y2="${y0 + H}" stroke="#000000" stroke-width="1.5"/>`);
    out.push(`<line x1="${x0}" y1="${y0 + hX}" x2="${x0 + W}" y2="${y0 + hX}" stroke="#000000" stroke-width="1.5"/>`);
    out.push(`<line x1="${x0}" y1="${y0 + hX + hD}" x2="${x0 + W}" y2="${y0 + hX + hD}" stroke="#000000" stroke-width="1.5"/>`);

    // Cột nhãn trái: x, y', y
    const lblFont = 'font-family="Times New Roman, serif" font-size="21" font-style="italic"';
    out.push(`<text x="${x0 + W0 / 2}" y="${y_x}" text-anchor="middle" dominant-baseline="central" ${lblFont}>${esc(opt.xLabel || 'x')}</text>`);
    out.push(`<text x="${x0 + W0 / 2}" y="${y_d}" text-anchor="middle" dominant-baseline="central" ${lblFont}>${esc(opt.dLabel || "y'")}</text>`);
    out.push(`<text x="${x0 + W0 / 2}" y="${y_y}" text-anchor="middle" dominant-baseline="central" ${lblFont}>${esc(opt.fLabel || 'y')}</text>`);

    // Hàng x
    spec.xs.forEach((v, i) => {
      out.push(renderMathLabelSvg(xAt(i), y_x, v, 20));
    });

    // Hàng y'
    spec.signs.forEach((s, k) => {
      const idx = Math.floor(k / 2);
      const x = k % 2 === 0 ? (xAt(idx) + xAt(idx + 1)) / 2 : xAt((k + 1) / 2);
      if (s === '||') {
        const yIdx = (k + 1) / 2;
        const isPoleY = spec.ys[yIdx] && spec.ys[yIdx].pole;
        const endY = isPoleY ? y0 + H : y0 + hX + hD;
        out.push(`<line x1="${(x - 2.5).toFixed(1)}" y1="${y0 + hX}" x2="${(x - 2.5).toFixed(1)}" y2="${endY}" stroke="#000000" stroke-width="1.3"/>`);
        out.push(`<line x1="${(x + 2.5).toFixed(1)}" y1="${y0 + hX}" x2="${(x + 2.5).toFixed(1)}" y2="${endY}" stroke="#000000" stroke-width="1.3"/>`);
      } else if (s) {
        const signChar = s === '-' ? '−' : s;
        out.push(`<text x="${x.toFixed(1)}" y="${y_d}" text-anchor="middle" dominant-baseline="central" font-family="Times New Roman, serif" font-size="20">${esc(signChar)}</text>`);
      }
    });

    // Hàng y: tính các nút (x, y, label, seg)
    const nodes = [];
    let seg = 0;
    spec.ys.forEach((e, i) => {
      const x = xAt(i);
      if (e && e.pole) {
        const signAtPole = spec.signs[2 * i - 1];
        if (signAtPole !== '||') {
          out.push(`<line x1="${(x - 2.5).toFixed(1)}" y1="${y0 + hX + hD}" x2="${(x - 2.5).toFixed(1)}" y2="${y0 + H}" stroke="#000000" stroke-width="1.3"/>`);
          out.push(`<line x1="${(x + 2.5).toFixed(1)}" y1="${y0 + hX + hD}" x2="${(x + 2.5).toFixed(1)}" y2="${y0 + H}" stroke="#000000" stroke-width="1.3"/>`);
        }
        const leftX = x - 24;
        const rightX = x + 24;
        nodes.push({ x: leftX, y: yOf(e.left.level), label: e.left.label, seg });
        seg++;
        nodes.push({ x: rightX, y: yOf(e.right.level), label: e.right.label, seg });
      } else if (e) {
        nodes.push({ x, y: yOf(e.level), label: e.label, seg });
      }
    });

    // Vẽ giá trị tại các nút hàng y
    nodes.forEach((nd) => {
      out.push(renderMathLabelSvg(nd.x, nd.y, nd.label, 20));
    });

    // Vẽ các mũi tên biến thiên
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      if (a.seg !== b.seg) continue;
      const padA = estimateLabelPad(a.label);
      const padB = estimateLabelPad(b.label);
      out.push(renderArrowSvg(a.x, a.y, b.x, b.y, padA, padB));
    }

    out.push('</svg>');
    return out.join('');
  }

  /** So sánh bảng biến thiên do AI sinh với kết quả tính toán. */
  function verifyBBT(fnStr, aiSpec) {
    const M = getMath();
    const ref = analyzeFunction(fnStr);
    const errors = [];
    const num = (s) => {
      try {
        return M.evaluate(
          String(s)
            .replace(/\\(?:d|t)?frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
            .replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)')
            .replace(/\\infty/g, 'Infinity')
        );
      } catch (e) {
        return NaN;
      }
    };
    if (aiSpec.xs.length !== ref.xs.length)
      errors.push(`Số mốc x: AI=${aiSpec.xs.length}, đúng=${ref.xs.length} (${ref.xs.join('; ')})`);
    else
      aiSpec.xs.forEach((v, i) => {
        if (Math.abs(num(v) - num(ref.xs[i])) > 1e-6 && isFinite(num(ref.xs[i])))
          errors.push(`Mốc x thứ ${i + 1}: AI=${v}, đúng=${ref.xs[i]}`);
      });
    if (aiSpec.signs.join() !== ref.signs.join())
      errors.push(`Dấu y': AI=[${aiSpec.signs}], đúng=[${ref.signs}]`);
    if (aiSpec.ys.length === ref.ys.length)
      aiSpec.ys.forEach((e, i) => {
        const r = ref.ys[i];
        if (!e.pole && !r.pole && isFinite(num(r.label)) && Math.abs(num(e.label) - num(r.label)) > 1e-6)
          errors.push(`Giá trị y tại x=${ref.xs[i]}: AI=${e.label}, đúng=${r.label}`);
      });
    return { ok: errors.length === 0, errors, reference: ref };
  }

  global.BBT = { analyzeFunction, renderBBT, verifyBBT, niceNumber, findRoots, texToText, normalizeFnExpr };
})(typeof window !== 'undefined' ? window : globalThis);
