// Kiểm thử các engine vẽ hình (chạy: npm test  hoặc  node tests/engines.test.mjs)
import { BBT, Graph, Geo3D, Geo2D } from './_load.mjs';

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error('điều kiện sai');
    pass++;
  } catch (e) {
    fail++;
    console.log('✗', name, '—', e.message);
  }
}
const eq = (a, b) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`mong đợi ${JSON.stringify(b)}, nhận ${JSON.stringify(a)}`);
};
const yl = (s) => s.ys.map((y) => (y.pole ? `${y.left.label}||${y.right.label}` : y.label));
const near = (a, b, t = 1e-6) => { if (Math.abs(a - b) > t) throw new Error(`${a} ≠ ${b}`); };
const svgOk = (s) => typeof s === 'string' && s.startsWith('<svg') && !/NaN|undefined/.test(s);

/* ---------- BBT: các hàm cũ (hồi quy) ---------- */
check('BBT x^3-3x+1', () => {
  const s = BBT.analyzeFunction('x^3-3x+1');
  eq(s.xs, ['-\\infty', '-1', '1', '+\\infty']); eq(s.signs, ['+', '0', '-', '0', '+']); eq(yl(s), ['-\\infty', '3', '-1', '+\\infty']);
});
check('BBT x^4-2x^2', () => {
  const s = BBT.analyzeFunction('x^4-2x^2');
  eq(s.xs, ['-\\infty', '-1', '0', '1', '+\\infty']); eq(yl(s), ['+\\infty', '-1', '0', '-1', '+\\infty']);
});
check('BBT (2x+1)/(x-1)', () => {
  const s = BBT.analyzeFunction('(2x+1)/(x-1)');
  eq(s.xs, ['-\\infty', '1', '+\\infty']); eq(s.signs, ['-', '||', '-']); eq(yl(s), ['2', '-\\infty||+\\infty', '2']);
});
check('BBT \\frac{x^2+1}{x}', () => {
  const s = BBT.analyzeFunction('\\frac{x^2+1}{x}');
  eq(s.xs, ['-\\infty', '-1', '0', '1', '+\\infty']); eq(yl(s), ['-\\infty', '-2', '-\\infty||+\\infty', '2', '+\\infty']);
});
check('BBT -x^3+3x^2-4', () => eq(yl(BBT.analyzeFunction('-x^3+3x^2-4')), ['+\\infty', '-4', '0', '-\\infty']));
check('BBT x+4/x', () => eq(BBT.analyzeFunction('x+\\frac{4}{x}').xs, ['-\\infty', '-2', '0', '2', '+\\infty']));
check('BBT 1/(x^2-1)', () => eq(BBT.analyzeFunction('1/(x^2-1)').signs, ['+', '||', '+', '0', '-', '||', '-']));
check('BBT x^3 (điểm uốn, không cực trị)', () => eq(BBT.analyzeFunction('x^3').signs, ['+', '0', '+']));

/* ---------- BBT: lỗi 1 — tập xác định bị giới hạn ---------- */
check('BBT sqrt(4-x^2)', () => {
  const s = BBT.analyzeFunction('sqrt(4-x^2)');
  eq(s.xs, ['-2', '0', '2']); eq(s.signs, ['+', '0', '-']); eq(yl(s), ['0', '2', '0']);
});
for (const f of ['ln(x)', '\\ln x', 'ln x', 'log(x)']) {
  check(`BBT ${f}`, () => {
    const s = BBT.analyzeFunction(f);
    eq(s.xs, ['0', '+\\infty']); eq(s.signs, ['+']); eq(yl(s), ['-\\infty', '+\\infty']); eq(s.ys[0].open, true);
  });
}
check('BBT x*ln(x)', () => {
  const s = BBT.analyzeFunction('x\\ln x');
  eq(s.xs, ['0', '\\frac{1}{e}', '+\\infty']); eq(s.signs, ['-', '0', '+']); eq(yl(s), ['0', '-\\frac{1}{e}', '+\\infty']);
});
check('BBT sqrt(x) và x-2sqrt(x)', () => {
  eq(BBT.analyzeFunction('\\sqrt{x}').xs, ['0', '+\\infty']);
  eq(yl(BBT.analyzeFunction('x-2sqrt(x)')), ['0', '-1', '+\\infty']);
});
check('BBT sqrt(x^2-1) có khoảng không xác định', () => {
  const s = BBT.analyzeFunction('sqrt(x^2-1)');
  eq(s.xs, ['-\\infty', '-1', '1', '+\\infty']); eq(s.signs[2], 'gap');
  if (!svgOk(BBT.renderBBT(s))) throw new Error('SVG lỗi');
});
check('BBT e^x, x e^{-x}', () => {
  eq(BBT.analyzeFunction('e^x').xs, ['-\\infty', '+\\infty']);
  eq(yl(BBT.analyzeFunction('x*e^(-x)')), ['-\\infty', '\\frac{1}{e}', '0']);
});

/* ---------- BBT: lỗi 2 — cực trị ngoài [-25; 25] ---------- */
check('BBT (x-40)^2(x+1)', () => {
  const s = BBT.analyzeFunction('(x-40)^2*(x+1)');
  eq(s.xs, ['-\\infty', '\\frac{38}{3}', '40', '+\\infty']); eq(s.signs, ['+', '0', '-', '0', '+']);
});

/* ---------- niceNumber: lỗi 4 — nghiệm vô tỉ ---------- */
check('niceNumber', () => {
  eq(BBT.niceNumber(1 - Math.SQRT2), '1-\\sqrt{2}');
  eq(BBT.niceNumber((3 - Math.sqrt(5)) / 2), '\\frac{3-\\sqrt{5}}{2}');
  eq(BBT.niceNumber(Math.PI / 3), '\\frac{\\pi}{3}');
  eq(BBT.niceNumber(-2.5), '-\\frac{5}{2}');
  eq(BBT.niceNumber(0.123456789), '0,12');
});
check('renderBBT các hàm', () => {
  for (const f of ['x^3-3x+1', '(2x+1)/(x-1)', 'sqrt(4-x^2)', 'ln(x)', 'x*ln(x)'])
    if (!svgOk(BBT.renderBBT(BBT.analyzeFunction(f)))) throw new Error(f);
});
check('renderBBT spec thủ công (định dạng cũ)', () => svgOk(BBT.renderBBT({
  xs: ['-\\infty', '-1', '1', '+\\infty'], signs: ['+', '0', '-', '0', '+'],
  ys: [{ level: 'bottom', label: '-\\infty' }, { level: 'top', label: '3' }, { level: 'bottom', label: '-1' }, { level: 'top', label: '+\\infty' }],
})));

/* ---------- Graph: lỗi 3, 5 ---------- */
check('Graph LaTeX \\frac{2x+1}{x-1}', () => {
  const a = Graph.analyzeGraph('\\frac{2x+1}{x-1}');
  eq(a.poles, [1]); eq(a.hAsym, 2); near(a.xIntercepts[0], -0.5);
});
check('Graph ln(x): tiệm cận đứng x = 0, cắt Ox tại 1', () => {
  const a = Graph.analyzeGraph('ln(x)');
  eq(a.poles, [0]); eq(a.hAsym, null); eq(a.xIntercepts.length, 1); near(a.xIntercepts[0], 1);
});
check('Graph e^x: không có giao điểm giả, TCN y = 0', () => {
  const a = Graph.analyzeGraph('e^x');
  eq(a.xIntercepts.length, 0); eq(a.hAsym, 0); eq(a.poles.length, 0);
});
check('Graph tan(x): có tiệm cận đứng', () => {
  const a = Graph.analyzeGraph('tan(x)', -4, 4);
  eq(a.poles.length, 2); near(a.poles[1], Math.PI / 2, 1e-6);
});
check('Graph atan(x): hai TCN', () => eq(Graph.analyzeGraph('atan(x)').hAsyms.length, 2));
check('Graph (x^2+1)/x: tiệm cận xiên y = x', () => eq(Graph.analyzeGraph('(x^2+1)/x').oblique, { a: 1, b: 0 }));
check('Graph x^3-3x+1: 3 giao điểm, 2 cực trị', () => {
  const a = Graph.analyzeGraph('x^3-3x+1');
  eq(a.xIntercepts.length, 3); eq(a.extrema.map((e) => e.kind), ['max', 'min']);
});
check('renderGraph', () => {
  for (const sp of [
    { fn: '\\frac{2x+1}{x-1}', xRange: [-4, 5], yRange: [-4, 7] },
    { fn: 'ln(x)', xRange: [-1, 6] },
    { fn: 'tan(x)', xRange: [-4, 4], yRange: [-5, 5] },
    { fn: ['e^x', 'x+1'], xRange: [-4, 3] },
    { fn: 'x^2', shade: { fn: 'x^2', from: 0, to: 2 }, xRange: [-1, 3] },
    { fn: 'sqrt(x)', revolve: { from: 0, to: 4 }, xRange: [-1, 5] },
  ]) if (!svgOk(Graph.renderGraph(sp))) throw new Error(JSON.stringify(sp.fn));
});
check('renderGraph ghi nhãn nghiệm vô tỉ dạng căn', () => /1−√2/.test(Graph.renderGraph({ fn: 'x^2-2x-1', xRange: [-2, 4] })));

/* ---------- Geo3D: lỗi 7 + hồi quy preset cũ ---------- */
for (const preset of ['pyramid-tri', 'pyramid-square', 'pyramid-rect', 'tetra-right', 'prism-tri', 'box', 'cube', 'cone', 'cylinder', 'sphere', 'frustum',
  'prism-quad', 'prism-hex', 'pyramid-hex']) {
  check(`Geo3D ${preset}`, () => svgOk(Geo3D.renderGeo3D({ type: 'geo3d', preset, params: {} })));
}
check('Geo3D prism-hex có 12 đỉnh', () => eq(Object.keys(Geo3D.preset('prism-hex').points).length, 12));
check('Geo3D pyramid-hex cạnh đáy = a', () => {
  const P = Geo3D.preset('pyramid-hex', { a: 3 }).points;
  near(Math.hypot(P.A[0] - P.B[0], P.A[1] - P.B[1]), 3);
});

/* ---------- Geo2D: lỗi 6 + hồi quy ---------- */
for (const preset of ['triangle', 'triangle-right', 'triangle-equil', 'triangle-iso', 'parallelogram', 'rectangle', 'square', 'rhombus', 'trapezoid', 'trapezoid-right', 'circle']) {
  check(`Geo2D ${preset}`, () => svgOk(Geo2D.renderGeo2D({ type: 'geo2d', preset, params: {} })));
}
check('Geo2D nhãn chứa & và <', () => {
  const s = Geo2D.renderGeo2D({ type: 'geo2d', preset: 'triangle', params: {}, edgeLabels: { AB: 'a < b & c' } });
  return svgOk(s) && !/a < b & c/.test(s) && /&lt;/.test(s);
});

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
