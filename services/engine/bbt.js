/* ==========================================================================
 * BBT ENGINE — Bảng biến thiên chuẩn SGK (SVG thuần, xuất PNG/DOCX 300 DPI)
 * Phụ thuộc: math.js (window.math)
 *
 *  analyzeFunction("x^3-3x")      -> spec (tự tính đạo hàm, tập xác định, nghiệm, cực trị, giới hạn)
 *  renderBBT(spec)                -> chuỗi <svg> chuẩn SGK Việt Nam
 *  verifyBBT(fn, specTuAI)        -> { ok, errors[] }   (kiểm chứng bảng do AI sinh)
 *
 *  Hỗ trợ: đa thức, phân thức, căn thức (tập xác định là đoạn/nửa khoảng),
 *  ln/log/mũ/lượng giác; cực trị ngoài [-25;25] (tự mở rộng vùng quét với hàm hữu tỉ);
 *  nghiệm vô tỉ hiển thị dạng chính xác (1−√2, (1+√5)/2, 1/e, π/2, ln2...).
 * ======================================================================== */
(function (global) {
  const getMath = () => global.math || (typeof window !== 'undefined' ? window.math : undefined);

  /* ---------- Chuẩn hóa biểu thức hàm số (hỗ trợ cả LaTeX từ AI) ---------- */
  const FN_NAMES = 'sqrt|cbrt|nthRoot|log|log10|log2|exp|sin|cos|tan|cot|sec|csc|asin|acos|atan|sinh|cosh|tanh|abs';
  function normalizeFnExpr(raw) {
    let s = String(raw ?? '').trim();
    s = s.replace(/^\$+|\$+$/g, '').trim();
    s = s.replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
    s = s.replace(/[−–]/g, '-').replace(/⋅|·|\\cdot|\\times|×/g, '*');
    s = s.replace(/\\left\s*([(|[])/g, '$1').replace(/\\right\s*([)|\]])/g, '$1');
    s = s.replace(/\\(?:,|;|!|quad)/g, ' ');
    s = s.replace(/π|\\pi\b/g, 'pi').replace(/²/g, '^2').replace(/³/g, '^3');
    s = s.replace(/√\s*\(/g, 'sqrt(').replace(/√\s*([a-z0-9.]+)/gi, 'sqrt($1)');
    // \sqrt[3]{u} -> cbrt(u), \sqrt[n]{u} -> nthRoot(u, n)
    for (let i = 0; i < 3; i++) {
      s = s.replace(/\\sqrt\s*\[\s*3\s*\]\s*\{([^{}]*)\}/g, 'cbrt($1)');
      s = s.replace(/\\sqrt\s*\[\s*([^\]]+)\]\s*\{([^{}]*)\}/g, 'nthRoot($2,$1)');
      s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
      s = s.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
    }
    s = s.replace(/\\sqrt\s*([a-z0-9])/gi, 'sqrt($1)');
    s = s.replace(/\^\{([^{}]*)\}/g, '^($1)');
    // log cơ số: \log_{2}(u) / \log_2 x
    s = s.replace(/\\?log_\{?([0-9.]+|e)\}?\s*\(([^()]*)\)/g, 'log($2,$1)');
    s = s.replace(/\\?log_\{?([0-9.]+|e)\}?\s*([a-z0-9.]+)/g, 'log($2,$1)');
    s = s.replace(/\\ln\b/g, 'log').replace(/\\log\b/g, 'log10').replace(/\\exp\b/g, 'exp');
    s = s.replace(/\\arc(sin|cos|tan)\b/g, 'a$1').replace(/\barc(sin|cos|tan)\b/g, 'a$1');
    s = s.replace(/\\(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh)\b/g, '$1');
    s = s.replace(/\bcotg\b/g, 'cot').replace(/\btg\b/g, 'tan');
    s = s.replace(/\bln(?=[a-z(\s])/g, 'log');
    s = s.replace(/\b(sin|cos|tan|cot)(?=x\b)/g, '$1 ');
    s = s.replace(/[{}]/g, '');
    s = s.replace(/\|([^|]+)\|/g, 'abs($1)');
    s = s.replace(new RegExp(`\\bx(?=(?:${FN_NAMES})\\b)`, 'g'), 'x*'); // "x\ln x" -> x*log x
    // Hàm viết không có ngoặc: "log x", "sin 2x", "log x^2" -> log(x), sin(2x), log(x^2)
    s = s.replace(new RegExp(`\\b(${FN_NAMES})\\s+(-?[0-9.]*[a-z]?(?:\\^[0-9.]+)?)`, 'g'), (m, fn, arg) =>
      arg ? `${fn}(${arg})` : m
    );
    // Thêm dấu * : 2x, 3(…), 2sqrt(…), )(, )x, x(, x log(...), x e^…
    s = s.replace(/(?<![A-Za-z_\d.])(\d+(?:\.\d+)?)\s*(?=[A-Za-z(])/g, '$1*');
    s = s.replace(/(\))\s*(?=[A-Za-z0-9(])/g, '$1*');
    s = s.replace(/\bx\s*(?=\()/g, 'x*');
    s = s.replace(new RegExp(`\\bx(?=(?:${FN_NAMES}|e\\^|pi)\\b|e\\^)`, 'g'), 'x*');
    return s.replace(/\s+/g, ' ').trim();
  }

  /** Tạo hàm số thực an toàn: trả về số thực, NaN nếu không xác định (số phức, lỗi). */
  function realFn(compiled) {
    return (x) => {
      try {
        const v = compiled.evaluate({ x });
        if (typeof v === 'number') return v;
        if (v && typeof v.re === 'number' && typeof v.im === 'number') return Math.abs(v.im) < 1e-12 ? v.re : NaN;
        if (v && typeof v.toNumber === 'function') return v.toNumber();
        return NaN;
      } catch (e) {
        return NaN;
      }
    };
  }

  /** Phân tích chuỗi hàm số → { fnStr, node, f, dnode, df }. */
  function makeFunction(rawFnStr) {
    const M = getMath();
    const fnStr = normalizeFnExpr(rawFnStr);
    const node = M.parse(fnStr);
    const f = realFn(node.compile());
    let dnode = null, df;
    try {
      dnode = M.derivative(node, 'x');
      df = realFn(dnode.compile());
    } catch (e) {
      // Đạo hàm số học khi math.js không lấy được đạo hàm ký hiệu
      df = (x) => {
        const h = 1e-6 * Math.max(1, Math.abs(x));
        const a = f(x + h), b = f(x - h);
        return isFinite(a) && isFinite(b) ? (a - b) / (2 * h) : NaN;
      };
    }
    return { fnStr, node, f, dnode, df };
  }

  /* ---------- tiện ích số ---------- */
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }

  /** Phân số tối giản n/d (d ≤ maxD) gần v; trả về [n, d] hoặc null. */
  function asFraction(v, maxD = 12, tol = 1e-7) {
    for (let d = 1; d <= maxD; d++) {
      const n = Math.round(v * d);
      if (Math.abs(n / d - v) < tol) { const g = gcd(n, d); return [n / g, d / g]; }
    }
    return null;
  }
  const fracTex = (n, d, body = '') => {
    // n·body/d  với body là ký hiệu (\sqrt{3}, \pi, e, \ln 2 ...) hoặc rỗng
    const sign = n < 0 ? '-' : '';
    const an = Math.abs(n);
    const numer = body ? (an === 1 ? body : an + body) : String(an);
    return d === 1 ? sign + numer : `${sign}\\frac{${numer}}{${d}}`;
  };

  const SURD_B = [2, 3, 5, 6, 7, 10, 11, 13, 14, 15, 17, 19, 21, 22, 23, 26, 29, 30, 33];

  /** Số đẹp dạng LaTeX: nguyên, phân số, (p+q√b)/d, kπ, e^k, k·ln n; ngược lại thập phân 2 chữ số. */
  function niceNumber(v) {
    if (v === Infinity) return '+\\infty';
    if (v === -Infinity) return '-\\infty';
    if (!isFinite(v)) return '';
    if (Math.abs(v - Math.round(v)) < 1e-7) return String(Math.round(v));
    const fr = asFraction(v, 12, 1e-7);
    if (fr) return fracTex(fr[0], fr[1]);
    // (p + q√b)/d
    for (let d = 1; d <= 6; d++) {
      for (const b of SURD_B) {
        const sb = Math.sqrt(b);
        for (let qa = 1; qa <= 12; qa++) {
          for (const q of [qa, -qa]) {
            const p = Math.round(v * d - q * sb);
            if (Math.abs(p) > 60 || Math.abs((p + q * sb) / d - v) > 1e-7) continue;
            const g = gcd(gcd(p, q), d);
            let P = p / g, Q = q / g, D = d / g;
            const root = (k) => (k === 1 ? '' : String(k)) + `\\sqrt{${b}}`;
            if (P === 0) return fracTex(Q, D, `\\sqrt{${b}}`);
            let neg = false;
            if (D > 1 && P < 0 && Q < 0) { neg = true; P = -P; Q = -Q; }
            const body = `${P}${Q > 0 ? '+' : '-'}${root(Math.abs(Q))}`;
            if (D === 1) return body;
            return `${neg ? '-' : ''}\\frac{${body}}{${D}}`;
          }
        }
      }
    }
    // kπ
    const fp = asFraction(v / Math.PI, 6, 1e-9);
    if (fp) return fracTex(fp[0], fp[1], '\\pi');
    // r·e^k
    for (const k of [1, -1, 2, -2, 3, -3]) {
      const fe = asFraction(v / Math.exp(k), 4, 1e-9);
      if (fe && Math.abs(fe[0]) <= 12) {
        const ek = Math.abs(k) === 1 ? 'e' : `e^{${Math.abs(k)}}`;
        if (k > 0) return fracTex(fe[0], fe[1], ek);
        const sign = fe[0] < 0 ? '-' : '';
        const den = fe[1] === 1 ? ek : fe[1] + ek;
        return `${sign}\\frac{${Math.abs(fe[0])}}{${den}}`;
      }
    }
    // r·ln n
    for (const n of [2, 3, 5, 6, 7, 10]) {
      const fl = asFraction(v / Math.log(n), 4, 1e-9);
      if (fl && Math.abs(fl[0]) <= 12) return fracTex(fl[0], fl[1], `\\ln ${n}`);
    }
    // phân số mẫu lớn (vd 275684/27) — chỉ khi gần như chính xác
    const big = asFraction(v, 200, 1e-9);
    if (big && Math.abs(big[0]) < 1e7) return fracTex(big[0], big[1]);
    return String(Math.round(v * 100) / 100).replace('.', ',');
  }

  /**
   * Tìm nghiệm thực của g trên [lo,hi] bằng quét + chia đôi (gồm cả nghiệm kép).
   * Tham số `out.jumps` (tuỳ chọn) nhận các điểm g đổi dấu nhưng không bằng 0 (điểm gián đoạn).
   */
  function findRoots(g, lo = -25, hi = 25, step = 0.02, out) {
    const roots = [];
    const push = (r) => {
      const clean = Math.abs(r - Math.round(r)) < 1e-7 ? Math.round(r) : r;
      if (!roots.some((x) => Math.abs(x - clean) < 1e-6 * Math.max(1, Math.abs(clean)))) roots.push(clean);
    };
    const n = Math.max(2, Math.ceil((hi - lo) / step));
    const xs = new Array(n + 1), gs = new Array(n + 1);
    for (let i = 0; i <= n; i++) { xs[i] = lo + ((hi - lo) * i) / n; gs[i] = g(xs[i]); }
    for (let i = 0; i < n; i++) {
      const x0 = xs[i], x1 = xs[i + 1], g0 = gs[i], g1 = gs[i + 1];
      if (!isFinite(g0) || !isFinite(g1)) continue;
      if (g0 === 0 || (Math.abs(g0) < 1e-12 && i > 0 && (Math.abs(gs[i - 1]) > 1e-9 || Math.abs(g1) > 1e-9))) {
        push(x0);
      } else if (g0 * g1 < 0) {
        let a = x0, b = x1, ga = g0;
        for (let k = 0; k < 60; k++) {
          const m = (a + b) / 2, gm = g(m);
          if (!isFinite(gm)) break;
          if (ga * gm <= 0) b = m; else { a = m; ga = gm; }
        }
        const root = (a + b) / 2, gr = g(root);
        const scale = Math.max(1, Math.abs(g0), Math.abs(g1));
        if (Math.abs(gr) < 1e-6 * scale) push(root);
        else if (out && out.jumps) out.jumps.push(root);
      }
    }
    // nghiệm kép (|g| có cực tiểu địa phương gần 0, g không đổi dấu)
    for (let i = 1; i < n; i++) {
      const a = Math.abs(gs[i - 1]), b = Math.abs(gs[i]), c = Math.abs(gs[i + 1]);
      if (!(isFinite(a) && isFinite(b) && isFinite(c))) continue;
      if (!(b <= a && b <= c) || gs[i - 1] * gs[i + 1] < 0) continue;
      let l = xs[i - 1], r = xs[i + 1];
      for (let k = 0; k < 60; k++) {
        const m1 = l + (r - l) / 3, m2 = r - (r - l) / 3;
        if (Math.abs(g(m1)) < Math.abs(g(m2))) r = m2; else l = m1;
      }
      const xr = (l + r) / 2, gr = Math.abs(g(xr));
      const scale = Math.max(a, c);
      if (gr < 1e-9 * Math.max(1, scale) && scale > 100 * gr && scale > 1e-12) push(xr);
    }
    return roots.sort((p, q) => p - q);
  }

  /* ---------- giới hạn số học (nhận biết hội tụ / phân kỳ ra ±∞) ---------- */
  function seqLimit(v) {
    const last = v[v.length - 1];
    if (last === Infinity || last === -Infinity) return last;
    if (!isFinite(last)) {
      const fin = v.filter(isFinite);
      if (fin.length >= 2 && Math.abs(fin[fin.length - 1]) > 1e6) return Math.sign(fin[fin.length - 1]) * Infinity;
      return NaN;
    }
    if (Math.abs(last) > 1e9) return Math.sign(last) * Infinity;
    const n = v.length;
    const d1 = v[n - 2] - v[n - 3], d2 = v[n - 1] - v[n - 2];
    const round = (x) => (Math.abs(x - Math.round(x)) < 1e-4 ? Math.round(x) : x);
    if (Math.abs(d2) < 1e-6 * (1 + Math.abs(last))) return round(last);
    if (Math.sign(d1) === Math.sign(d2) && Math.abs(d2) > 0.5 * Math.abs(d1) && Math.abs(last) > Math.abs(v[0]))
      return Math.sign(d2) * Infinity;
    // không hội tụ (dao động, vd sin x khi x → ∞): không có giới hạn
    if (Math.abs(d2) > 1e-3 * (1 + Math.abs(last))) return NaN;
    return round(last);
  }
  /** lim f(x) khi x → x0 từ phía side (−1: trái, +1: phải). */
  function limitAt(f, x0, side) {
    const hs = [1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8];
    return seqLimit(hs.map((h) => f(x0 + side * h * Math.max(1, Math.abs(x0)))));
  }
  /** lim f(x) khi x → dir·∞ (dir = ±1). */
  function limitInf(f, dir) {
    return seqLimit([1e2, 1e3, 1e4, 1e5, 1e6, 1e7].map((t) => f(dir * t)));
  }
  // Giữ tương thích API cũ
  function limitValue(f, x) {
    if (!isFinite(x)) return limitInf(f, Math.sign(x));
    const v = f(x);
    return Math.abs(v - Math.round(v)) < 1e-4 ? Math.round(v) : v;
  }

  /** Bán kính quét nghiệm: với hàm hữu tỉ dùng chặn Cauchy của tử/mẫu đạo hàm, tối thiểu 25. */
  function scanRadius(dnode) {
    const M = getMath();
    let R = 25;
    try {
      const r = M.rationalize(dnode, {}, true);
      const bound = (expr) => {
        if (!expr) return 0;
        const c = M.rationalize(expr, {}, true).coefficients;
        if (!c || c.length < 2) return 0;
        const an = c[c.length - 1];
        if (!an) return 0;
        return 1 + Math.max(...c.slice(0, -1).map((a) => Math.abs(a / an)));
      };
      R = Math.max(R, bound(r.numerator) * 1.02 + 1, bound(r.denominator) * 1.02 + 1);
    } catch (e) { /* không phải hữu tỉ */ }
    return Math.min(R, 5000);
  }

  /** Quét nghiệm hai độ phân giải: mịn trên [-25;25], thô hơn ở phần mở rộng. */
  function findRootsWide(g, R, out) {
    const res = findRoots(g, -25, 25, 0.02, out);
    if (R > 25.01) {
      const st = Math.max(0.02, (R - 25) / 3000);
      res.push(...findRoots(g, -R, -25, st, out), ...findRoots(g, 25, R, st, out));
    }
    return res.sort((a, b) => a - b).filter((x, i, arr) => i === 0 || Math.abs(x - arr[i - 1]) > 1e-6 * Math.max(1, Math.abs(x)));
  }

  /**
   * Tập xác định trên trục số: danh sách khoảng { a, b, aClosed, bClosed } (a = −∞ / b = +∞ nếu kéo dài).
   * Điểm cô lập không xác định (mẫu = 0) KHÔNG tách khoảng — được xử lý như tiệm cận/điểm gián đoạn.
   */
  function findDomain(f, R) {
    // ±∞ ở |x| lớn là do tràn số (vd e^x), vẫn coi là xác định; gần gốc thì ±∞ = không xác định (vd ln 0).
    const ok = (x) => { const v = f(x); return isFinite(v) || (!isNaN(v) && Math.abs(x) > 100); };
    const lo = -R, hi = R;
    const n = Math.max(2000, Math.min(20000, Math.ceil((hi - lo) / 0.01)));
    const xs = [], flags = [];
    for (let i = 0; i <= n; i++) { const x = lo + ((hi - lo) * i) / n; xs.push(x); flags.push(ok(x)); }
    for (let i = 1; i < n; i++) if (!flags[i] && flags[i - 1] && flags[i + 1]) flags[i] = true; // điểm cô lập
    const snap = (b) => {
      for (const cand of [Math.round(b), Math.round(b * 1e6) / 1e6]) if (Math.abs(cand - b) < 1e-7) return cand;
      return b;
    };
    const boundary = (xIn, xOut) => {
      let a = xIn, b = xOut;
      for (let k = 0; k < 70; k++) { const m = (a + b) / 2; if (ok(m)) a = m; else b = m; }
      const s = snap((a + b) / 2);
      return { x: s, closed: ok(s) };
    };
    // phần ngoài [lo, hi]
    const farEdge = (xEdge, dir) => {
      for (const t of [R * 2, R * 10, 1e4, 1e6]) {
        if (!ok(dir * t)) {
          let a = xEdge, b = dir * t;
          for (let k = 0; k < 80; k++) { const m = (a + b) / 2; if (ok(m)) a = m; else b = m; }
          const s = snap((a + b) / 2);
          return { x: s, closed: ok(s) };
        }
      }
      return null;
    };
    const intervals = [];
    let i = 0;
    while (i <= n) {
      if (!flags[i]) { i++; continue; }
      let j = i;
      while (j + 1 <= n && flags[j + 1]) j++;
      let A, B;
      if (i === 0) A = farEdge(lo, -1) || { x: -Infinity, closed: false };
      else A = boundary(xs[i], xs[i - 1]);
      if (j === n) B = farEdge(hi, 1) || { x: Infinity, closed: false };
      else B = boundary(xs[j], xs[j + 1]);
      if (B.x - A.x > 1e-9) intervals.push({ a: A.x, b: B.x, aClosed: A.closed, bClosed: B.closed });
      i = j + 1;
    }
    return intervals;
  }

  /** Điểm gián đoạn vô cực / không xác định bên trong tập xác định (tiệm cận đứng, điểm khử được). */
  function findPoles(node, f, df, R, intervals) {
    const cands = [];
    const add = (p) => { if (isFinite(p) && !cands.some((x) => Math.abs(x - p) < 1e-6 * Math.max(1, Math.abs(p)))) cands.push(p); };
    const M = getMath();
    const rootsOf = (expr) => {
      try { return findRootsWide(realFn(expr.compile()), R); } catch (e) { return []; }
    };
    try {
      node.traverse((sub) => {
        if (!sub) return;
        if (sub.isOperatorNode && sub.op === '/' && sub.args?.[1] && /\bx\b/.test(sub.args[1].toString())) rootsOf(sub.args[1]).forEach(add);
        if (sub.isOperatorNode && sub.op === '^' && sub.args?.[1]) {
          const ex = Number(sub.args[1].toString().replace(/[()\s]/g, ''));
          if (isFinite(ex) && ex < 0) rootsOf(sub.args[0]).forEach(add);
        }
        if (sub.isFunctionNode && sub.args?.[0]) {
          const fname = sub.fn?.name;
          if (fname === 'log' || fname === 'log10' || fname === 'log2') rootsOf(sub.args[0]).forEach(add);
          if (fname === 'tan' || fname === 'sec') rootsOf(new M.FunctionNode('cos', [sub.args[0]])).forEach(add);
          if (fname === 'cot' || fname === 'csc') rootsOf(new M.FunctionNode('sin', [sub.args[0]])).forEach(add);
        }
      });
    } catch (e) { /* bỏ qua */ }
    // Phát hiện số học: f hoặc f' đổi dấu qua "bước nhảy"
    const jumps = { jumps: [] };
    findRootsWide(f, R, jumps);
    findRootsWide(df, R, jumps);
    jumps.jumps.forEach((p) => {
      const l = f(p - 1e-7 * Math.max(1, Math.abs(p))), r = f(p + 1e-7 * Math.max(1, Math.abs(p)));
      if (Math.abs(l) > 1e4 || Math.abs(r) > 1e4) add(p);
    });
    const inside = (p) => intervals.some((I) => p > I.a + 1e-9 && p < I.b - 1e-9);
    return cands
      .map((p) => (Math.abs(p - Math.round(p)) < 1e-7 ? Math.round(p) : p))
      .filter((p) => {
        if (!inside(p)) return false;
        const h = 1e-6 * Math.max(1, Math.abs(p));
        if (!isFinite(f(p - h)) || !isFinite(f(p + h))) return false;
        return !isFinite(f(p)) || !isFinite(limitAt(f, p, -1)) || !isFinite(limitAt(f, p, 1));
      })
      .sort((a, b) => a - b);
  }

  /** Phân tích hàm số → spec bảng biến thiên. */
  function analyzeFunction(rawFnStr) {
    const { fnStr, node, f, dnode, df } = makeFunction(rawFnStr);
    const R = dnode ? scanRadius(dnode) : 25;
    const intervals = findDomain(f, R);
    if (!intervals.length) throw new Error('Hàm số không xác định trên ℝ: ' + fnStr);
    const poles = findPoles(node, f, df, R, intervals);
    const nearPole = (x) => poles.some((p) => Math.abs(x - p) < 1e-6 * Math.max(1, Math.abs(p)));

    const snapX = (x) => { const fr = asFraction(x, 12, 1e-9); return fr ? fr[0] / fr[1] : x; };
    const crit = findRootsWide((x) => (nearPole(x) ? NaN : df(x)), R).map(snapX).filter((c) =>
      intervals.some((I) => c > I.a + 1e-7 && c < I.b - 1e-7) && !nearPole(c) && isFinite(f(c))
    );

    // Danh sách mốc x theo thứ tự
    const pts = [];
    intervals.forEach((I, k) => {
      const last = k === intervals.length - 1;
      pts.push({ x: I.a, kind: I.a === -Infinity ? 'ninf' : I.aClosed ? 'end' : 'open', start: true, gapBefore: k > 0 });
      [...crit.filter((c) => c > I.a && c < I.b).map((x) => ({ x, kind: 'crit' })),
       ...poles.filter((p) => p > I.a && p < I.b).map((x) => ({ x, kind: 'pole' }))]
        .sort((a, b) => a.x - b.x)
        .forEach((p) => pts.push(p));
      pts.push({ x: I.b, kind: I.b === Infinity ? 'pinf' : I.bClosed ? 'end' : 'open', start: false, gapAfter: !last });
    });

    const xs = pts.map((p) => niceNumber(p.x));
    const signs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i], B = pts[i + 1];
      if (A.gapAfter) signs.push('gap');
      else {
        const mid = !isFinite(A.x) && !isFinite(B.x) ? 0 : !isFinite(A.x) ? B.x - 1 : !isFinite(B.x) ? A.x + 1 : (A.x + B.x) / 2;
        let s = df(mid);
        if (!isFinite(s)) s = (f(mid + 1e-6) - f(mid - 1e-6));
        signs.push(s > 1e-12 ? '+' : s < -1e-12 ? '-' : '0');
      }
      if (i + 1 < pts.length - 1) {
        const k = pts[i + 1].kind;
        signs.push(k === 'crit' ? '0' : k === 'pole' ? '||' : '');
      }
    }

    const intervalSign = (i) => signs[2 * i]; // dấu trên khoảng (pts[i], pts[i+1])
    const ys = pts.map((p, i) => {
      const sBefore = i > 0 ? intervalSign(i - 1) : null;
      const sAfter = i < pts.length - 1 ? intervalSign(i) : null;
      const startLevel = (s) => (s === '+' ? 'bottom' : s === '-' ? 'top' : 'mid');
      const endLevel = (s) => (s === '+' ? 'top' : s === '-' ? 'bottom' : 'mid');
      switch (p.kind) {
        case 'ninf': return { level: startLevel(sAfter), label: niceNumber(limitInf(f, -1)) };
        case 'pinf': return { level: endLevel(sBefore), label: niceNumber(limitInf(f, 1)) };
        case 'pole': return {
          pole: true,
          left: { level: endLevel(sBefore), label: niceNumber(limitAt(f, p.x, -1)) },
          right: { level: startLevel(sAfter), label: niceNumber(limitAt(f, p.x, 1)) },
        };
        case 'crit': {
          const level = sBefore === '+' && sAfter === '-' ? 'top' : sBefore === '-' && sAfter === '+' ? 'bottom' : 'mid';
          return { level, label: niceNumber(f(p.x)) };
        }
        default: { // 'end' | 'open' — đầu mút khoảng xác định
          const val = p.kind === 'end' ? f(p.x) : limitAt(f, p.x, p.start ? 1 : -1);
          const e = { level: p.start ? startLevel(sAfter) : endLevel(sBefore), label: niceNumber(val) };
          if (p.kind === 'open') e.open = true;
          if (p.gapAfter) e.gapAfter = true;
          if (p.gapBefore) e.gapBefore = true;
          return e;
        }
      }
    });

    return {
      fn: fnStr, derivative: dnode ? dnode.toString() : '', xs, signs, ys,
      critical: crit, poles,
      domain: intervals,
      extrema: crit
        .map((x, i) => ({ x, y: f(x) }))
        .filter((e) => {
          const l = df(e.x - 1e-4 * Math.max(1, Math.abs(e.x))), r = df(e.x + 1e-4 * Math.max(1, Math.abs(e.x)));
          return l * r < 0;
        }),
    };
  }

  /* ---------- LaTeX đơn giản → text SVG (Unicode) ---------- */
  const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  /** Tiền xử lý: \sqrt{n} → √n, e^{k} → eᵏ, \ln → ln (để \frac lồng bên trong vẫn nhận dạng được). */
  function preTex(s) {
    return String(s ?? '')
      .replace(/\\sqrt\{([^{}]*)\}/g, (m, a) => (/^[\w.]+$/.test(a) ? '√' + a : '√(' + a + ')'))
      .replace(/\^\{?(-?\d+)\}?/g, (m, d) => d.split('').map((c) => SUP[c] || c).join(''))
      .replace(/\\ln\s*/g, 'ln');
  }
  function texToText(s) {
    return preTex(s)
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
    const raw = preTex(String(rawLabel ?? '').replace(/^\$+|\$+$/g, '').trim());
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
      if (s === 'gap') {
        // Khoảng hàm số không xác định: gạch chéo trên hàng y' và y (kiểu SGK)
        const gx1 = xAt(idx) + 30, gx2 = xAt(idx + 1) - 30, gy1 = y0 + hX, gy2 = y0 + H;
        if (gx2 > gx1) {
          out.push(`<rect x="${gx1.toFixed(1)}" y="${gy1}" width="${(gx2 - gx1).toFixed(1)}" height="${gy2 - gy1}" fill="#eeeeee" stroke="#000000" stroke-width="1"/>`);
          for (let c = gx1 - (gy2 - gy1); c < gx2; c += 9) {
            // đoạn thẳng y = -x + const, cắt theo hình chữ nhật
            const sx = Math.max(gx1, c), ex = Math.min(gx2, c + (gy2 - gy1));
            if (ex - sx < 0.5) continue;
            out.push(`<line x1="${sx.toFixed(1)}" y1="${(gy2 - (sx - c)).toFixed(1)}" x2="${ex.toFixed(1)}" y2="${(gy2 - (ex - c)).toFixed(1)}" stroke="#555555" stroke-width="0.8"/>`);
          }
        }
      } else if (s === '||') {
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
        let nx = x;
        if (e.open) {
          // Đầu mút không thuộc tập xác định: vạch kép ||, giá trị giới hạn đặt lệch vào trong khoảng
          out.push(`<line x1="${(x - 2.5).toFixed(1)}" y1="${y0 + hX}" x2="${(x - 2.5).toFixed(1)}" y2="${y0 + H}" stroke="#000000" stroke-width="1.3"/>`);
          out.push(`<line x1="${(x + 2.5).toFixed(1)}" y1="${y0 + hX}" x2="${(x + 2.5).toFixed(1)}" y2="${y0 + H}" stroke="#000000" stroke-width="1.3"/>`);
          nx = i === 0 || e.gapBefore ? x + 26 : x - 26;
        }
        nodes.push({ x: nx, y: yOf(e.level), label: e.label, seg });
        if (e.gapAfter) seg++;
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

  global.BBT = {
    analyzeFunction, renderBBT, verifyBBT, niceNumber, findRoots, texToText, normalizeFnExpr,
    // tiện ích dùng chung cho graph.js
    makeFunction, limitAt, limitInf, findDomain, findPoles,
  };
})(typeof window !== 'undefined' ? window : globalThis);
