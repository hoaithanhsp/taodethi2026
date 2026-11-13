// Chạy: node tests/subjectFigures.test.mjs
// Kiểm thử Studio hình theo môn (Hóa, Lí, Sinh): vẽ được, số liệu vật lí/di truyền đúng, đi qua bộ hiển thị chung.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = await build({
  stdin: {
    contents: `export * from './services/subjectFigures/index.ts'; export { parsePedigreeText, gametesOf, parseFoodWebText } from './services/subjectFigures/biologyFigures.ts'; export { parseCircuitElements } from './services/subjectFigures/physicsFigures.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error',
});
mkdirSync(new URL('../node_modules/.cache/', import.meta.url), { recursive: true });
const f = new URL('../node_modules/.cache/subjectFigures.mjs', import.meta.url);
writeFileSync(f, out.outputFiles[0].text);
const m = await import(f.href);

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('✓', name); };
const isSvg = s => assert.match(s, /^<svg [\s\S]*<\/svg>$/);

t('Nhận diện môn có Studio riêng', () => {
  assert.equal(m.studioSubjectOf('Hóa học'), 'chemistry');
  assert.equal(m.studioSubjectOf('Hoá học'), 'chemistry');
  assert.equal(m.studioSubjectOf('Vật lí'), 'physics');
  assert.equal(m.studioSubjectOf('Vật lý'), 'physics');
  assert.equal(m.studioSubjectOf('Sinh học'), 'biology');
  assert.equal(m.studioSubjectOf('Toán học'), 'math');
  assert.equal(m.studioSubjectOf('Ngữ văn'), null);
  assert.equal(m.studioSubjectOf(''), null);
});

t('Hóa học: vẽ đủ 8 loại hình chuyển từ app Hóa', () => {
  for (const spec of [
    { type: 'apparatus', preset: 'distillation' }, { type: 'glassware', items: ['burette', 'beaker'] },
    { type: 'ir', peaks: [{ wavenumber: 1710, transmittance: 10 }] }, { type: 'ms', peaks: [{ mz: 58, intensity: 30 }] },
    { type: 'structure', smiles: 'c1ccccc1' }, { type: 'haworth', sugar: 'alpha-glucose' },
    { type: 'peptide', residues: ['Gly', 'Ala'] }, { type: 'polymer', preset: 'pvc' },
  ]) isSvg(m.renderSubjectFigure(spec));
});

t('Vật lí: mạch nối tiếp, song song, lực, đồ thị, dao động', () => {
  isSvg(m.renderSubjectFigure({ type: 'circuit', elements: [{ kind: 'resistor', label: 'R1' }, 'ammeter', 'switch'] }));
  const par = m.renderSubjectFigure({ type: 'circuit', elements: ['ammeter'], branches: [[{ kind: 'resistor', label: 'R1' }], [{ kind: 'bulb', label: 'Đ' }, 'voltmeter']] });
  isSvg(par);
  assert.match(par, />R<\/tspan><tspan dy="\d+" font-size="\d+">1</, 'R1 viết 1 nhỏ dưới');
  isSvg(m.renderSubjectFigure({ type: 'forces', setup: 'incline', angle: 30, forces: ['P', 'N', 'Fms', 'F'] }));
  isSvg(m.renderSubjectFigure({ type: 'forces', setup: 'horizontal', fAngle: 30, forces: ['P', 'N', 'F', 'Fms'] }));
  isSvg(m.renderSubjectFigure({ type: 'motion-graph', points: [[0, 0], [2, 10], [6, 10], [8, 0]] }));
  isSvg(m.renderSubjectFigure({ type: 'oscillation', amplitude: 4, period: 2, phasePi: 0.5 }));
  assert.throws(() => m.renderSubjectFigure({ type: 'circuit', elements: ['tia-laze'] }), /không có/);
});

t('Mạch điện viết gọn: R1, Rb, Đ, A, V, C, L, K', () => {
  assert.deepEqual(m.parseCircuitElements('R1, Rb, Đ1, A, V2, C, L, K').map(e => e.kind),
    ['resistor', 'rheostat', 'bulb', 'ammeter', 'voltmeter', 'capacitor', 'inductor', 'switch']);
  assert.equal(m.parseCircuitElements('A')[0].label, '');
  assert.throws(() => m.parseCircuitElements('X9'), /Không nhận ra/);
});

t('Thấu kính: ảnh thật / ảo đúng công thức 1/f = 1/d + 1/d\'', () => {
  // Hội tụ f = 20, d = 30 → d' = 60 (ảnh thật, ngược chiều, nét liền)
  const real = m.renderSubjectFigure({ type: 'lens', lens: 'converging', f: 20, d: 30 });
  isSvg(real);
  assert.doesNotMatch(real, /stroke-width="2" stroke-dasharray/, 'ảnh thật vẽ nét liền');
  // Hội tụ f = 20, d = 10 → d' = −20 (ảnh ảo, nét đứt)
  assert.match(m.renderSubjectFigure({ type: 'lens', lens: 'converging', f: 20, d: 10 }), /stroke-width="2" stroke-dasharray/);
  // Phân kì luôn cho ảnh ảo
  assert.match(m.renderSubjectFigure({ type: 'lens', lens: 'diverging', f: 20, d: 30 }), /stroke-width="2" stroke-dasharray/);
  // d = f: ảnh ở vô cực
  assert.match(m.renderSubjectFigure({ type: 'lens', lens: 'converging', f: 20, d: 20 }), /vô cực/);
});

t('Sinh học: giao tử và khung Punnett', () => {
  assert.deepEqual(m.gametesOf('AaBb').map(g => g.join('')), ['AB', 'Ab', 'aB', 'ab']);
  assert.deepEqual(m.gametesOf('AABb').map(g => g.join('')), ['AB', 'Ab']);
  assert.deepEqual(m.gametesOf('XAXa').map(g => g.join('')), ['XA', 'Xa']);
  assert.deepEqual(m.gametesOf('XaY').map(g => g.join('')), ['Xa', 'Y']);
  const p = m.renderSubjectFigure({ type: 'punnett', mother: 'Aa', father: 'Aa' });
  isSvg(p);
  // Ô aA phải viết Aa (alen trội trước)
  assert.ok((p.match(/>Aa</g) || []).length >= 2 && !/>aA</.test(p));
  isSvg(m.renderSubjectFigure({ type: 'punnett', mother: 'XAXa', father: 'XaY' }));
  assert.throws(() => m.renderSubjectFigure({ type: 'punnett', mother: 'Ab', father: 'Aa' }), /không cùng một gen/);
});

t('Sinh học: phả hệ viết gọn → sơ đồ', () => {
  const spec = m.parsePedigreeText('I: 1M = 2F\nII: [1-2] 3M* 4F = 5M\nIII: [4-5] 6F 7M*');
  assert.deepEqual(spec.couples, [['1', '2'], ['4', '5']]);
  assert.deepEqual(spec.generations[1].map(p => [p.id, p.sex, p.affected, p.parents]), [['3', 'M', true, ['1', '2']], ['4', 'F', false, ['1', '2']], ['5', 'M', false, null]]);
  const svg = m.renderSubjectFigure(spec);
  isSvg(svg);
  assert.match(svg, /Nam bị bệnh/);
  assert.throws(() => m.parsePedigreeText('I: 1M = '), /thiếu người/);
});

t('Sinh học: lưới thức ăn tự xếp bậc, biểu đồ cột và đường', () => {
  const web = m.parseFoodWebText('Cỏ -> Thỏ, Châu chấu\nChâu chấu -> Ếch\nThỏ, Ếch -> Rắn -> Đại bàng');
  assert.ok(web.links.some(([a, b]) => a === 'Rắn' && b === 'Đại bàng'));
  isSvg(m.renderSubjectFigure(web));
  isSvg(m.renderSubjectFigure({ type: 'chart', kind: 'bar', categories: ['2020', '2021'], series: [{ name: 'A', values: [3, 5] }, { name: 'B', values: [4, 2] }] }));
  isSvg(m.renderSubjectFigure({ type: 'chart', kind: 'line', categories: ['0', '1', '2'], series: [{ name: 'N', values: [10, 40, 160] }] }));
});

console.log(`\n${ok} kiểm thử đạt.`);
