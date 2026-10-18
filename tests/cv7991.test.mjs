// Chạy: node tests/cv7991.test.mjs  (dùng esbuild có sẵn trong node_modules để biên dịch TS)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = await build({ entryPoints: ['services/cv7991Template.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
mkdirSync('node_modules/.cache', { recursive: true });
const f = new URL('../node_modules/.cache/cv7991.mjs', import.meta.url);
writeFileSync(f, out.outputFiles[0].text);
const m = await import(f.href);

const cfg = (t1, t2, t3, e) => ({
  type1: { biet: t1[0], hieu: t1[1], van_dung: t1[2], van_dung_cao: 0 },
  type2: { biet: t2[0], hieu: t2[1], van_dung: t2[2], van_dung_cao: 0 },
  type3: { biet: t3[0], hieu: t3[1], van_dung: t3[2], van_dung_cao: 0 },
  essay: { biet: e[0], hieu: e[1], van_dung: e[2], van_dung_cao: 0 },
});
const countCols = (row) => [...row.matchAll(/<t[dh]\b([^>]*)>/g)].reduce((s, x) => s + (+(/colspan="(\d+)"/.exec(x[1])?.[1] || 1)), 0);
let ok = 0; const t = (name, fn) => { fn(); ok++; console.log('✓', name); };

t('fmtVN', () => { assert.equal(m.fmtVN(3), '3,0'); assert.equal(m.fmtVN(0.25, 2), '0,25'); assert.equal(m.fmtVN(30, 0), '30'); assert.equal(m.fmtVN(12.5, 0), '12,5'); });

t('Lớp 10 có tự luận: 3-2-2-3', () => {
  const L = m.computeCv7991Layout(cfg([8,4,0],[1,1,0],[2,2,0],[1,1,1]), true);
  assert.deepEqual(L.types.map(x => x.points), [3, 2, 2, 3]);
  assert.equal(L.types[0].pointPerCommand, 0.25);
  assert.equal(L.types[1].commands, 8); assert.equal(L.types[1].pointPerCommand, 0.25);
  assert.equal(L.totalPoints, 10);
  assert.equal(m.cv7991MatrixColumnCount(L), 19); assert.equal(m.cv7991SpecsColumnCount(L), 16);
});

t('Lớp 12 không tự luận: 3-4-3', () => {
  const L = m.computeCv7991Layout(cfg([6,4,2],[1,2,1],[2,2,2],[1,1,0]), false);
  assert.deepEqual(L.types.map(x => x.key), ['type1','type2','type3']);
  assert.deepEqual(L.types.map(x => x.points), [3, 4, 3]); assert.equal(L.hasEssay, false);
});

t('Không có Trả lời ngắn → điểm chuyển sang Đúng – Sai (chú thích 3)', () => {
  const L = m.computeCv7991Layout(cfg([8,4,0],[2,1,1],[0,0,0],[1,1,1]), true);
  assert.deepEqual(L.types.map(x => [x.key, x.points]), [['type1',3],['type2',4],['essay',3]]);
});

t('Header/footer: mọi dòng body/footer đúng số cột; thead 4 dòng', () => {
  for (const essay of [true, false]) {
    const L = m.computeCv7991Layout(cfg([8,4,0],[1,1,0],[2,2,0],[1,1,1]), essay);
    const th = m.buildCv7991MatrixThead(L);
    assert.equal((th.match(/<tr>/g) || []).length, 4);
    assert.match(th, /Mức độ đánh giá/); assert.match(th, /TNKQ/); assert.match(th, /Tỉ lệ % điểm/);
    assert.equal(th.includes('Tự luận'), essay);
    m.buildCv7991MatrixFooterTemplate(L).split('\n').forEach(r => assert.equal(countCols(r), m.cv7991MatrixColumnCount(L)));
    m.buildCv7991SpecsFooterTemplate(L).split('\n').forEach(r => assert.equal(countCols(r), m.cv7991SpecsColumnCount(L)));
    const sp = m.buildCv7991SpecsThead(L);
    assert.match(sp, /Yêu cầu cần đạt/); assert.ok(!sp.includes('Cấp độ tư duy')); assert.ok(!sp.includes('>Tổng<'));
  }
});

t('applyCv7991Thead: thay khi khớp cột, giữ nguyên khi lệch', () => {
  const L = m.computeCv7991Layout(cfg([8,4,0],[1,1,0],[2,2,0],[0,0,0]), false);
  const n = m.cv7991MatrixColumnCount(L);
  const row = `<tr>${'<td>x</td>'.repeat(n)}</tr>`;
  const html = `<html><table><thead><tr><th>AI</th></tr></thead><tbody>${row}</tbody></table></html>`;
  const fixed = m.applyCv7991Thead(html, m.buildCv7991MatrixThead(L), n);
  assert.ok(fixed.includes('Mức độ đánh giá') && !fixed.includes('<th>AI</th>') && fixed.includes(row));
  const bad = html.replace(row, '<tr><td>1</td></tr>');
  assert.equal(m.applyCv7991Thead(bad, m.buildCv7991MatrixThead(L), n), bad);
});

t('Prompt chứa thead chuẩn & không còn "Cấp độ tư duy" trong đặc tả', () => {
  const data = { subject: 'Toán', grade: '10', duration: 90, examType: 'Cuối kì 1', chapters: [], questionConfig: cfg([8,4,0],[1,1,0],[2,2,0],[1,1,1]) };
  const L = m.computeCv7991Layout(data.questionConfig, true);
  const p1 = m.buildCv7991MatrixPrompt({ data, layout: L, footnotes: '', selectedChapters: [], totalSelectedPeriods: 10 });
  assert.ok(p1.includes(m.buildCv7991MatrixThead(L)));
  const p2 = m.buildCv7991SpecsPrompt({ data, layout: L, footnotes: '(1): Tư duy và lập luận toán học\n(2): Mô hình hóa toán học\n(3): Giải quyết vấn đề toán học', matrixContent: '', objectivesMap: [] });
  assert.ok(p2.includes('TD: Tư duy và lập luận toán học'));
  assert.ok(p2.includes(m.buildCv7991SpecsThead(L)));
});
console.log(`\n${ok} test đạt`);
