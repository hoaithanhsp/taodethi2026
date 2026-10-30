// Chạy: node tests/wordEquation.test.mjs
// Kiểm thử xuất công thức dạng Equation (OMML) cho Word / MathType Convert Equations.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = await build({
  stdin: {
    contents: `export * from './services/wordEquation.ts'; export * from './services/mathExportUtils.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error',
});
mkdirSync(new URL('../node_modules/.cache/', import.meta.url), { recursive: true });
const f = new URL('../node_modules/.cache/wordEquation.mjs', import.meta.url);
writeFileSync(f, out.outputFiles[0].text);
const m = await import(f.href);

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('✓', name); };
const eq = (tex, display = false) => m.latexToWordEquationHtml(tex, display);

t('Bọc đúng định dạng HTML của Word (chú thích msEquation, không namespace trong thẻ)', () => {
  const x = eq('x^2');
  assert.match(x, /^<!--\[if gte msEquation 12\]><m:oMath>/);
  assert.match(x, /<!\[endif\]-->$/);
  assert.ok(!/xmlns/.test(x));
  assert.match(x, /<m:sSup><m:e><i><span style='font-family:"Cambria Math",serif'><m:r>x<\/m:r><\/span><\/i><\/m:e><m:sup>.*<m:r>2<\/m:r>/);
  assert.match(eq('x', true), /<m:oMathPara><m:oMath>/);
});

t('Phân số, căn, căn bậc n', () => {
  assert.match(eq(String.raw`\dfrac{1}{2}`), /<m:f><m:num>.*1.*<\/m:num><m:den>.*2.*<\/m:den><\/m:f>/);
  assert.match(eq(String.raw`\sqrt{x}`), /<m:rad><m:radPr><m:degHide m:val="on"><\/m:degHide>/);
  assert.match(eq(String.raw`\sqrt[3]{8}`), /<m:deg>.*3.*<\/m:deg><m:e>.*8.*<\/m:e><\/m:rad>/);
});

t('Ngoặc co giãn và hệ phương trình → m:d', () => {
  assert.match(eq(String.raw`\left(\frac{1}{2}\right)`), /<m:begChr m:val="\("><\/m:begChr><m:endChr m:val="\)"><\/m:endChr>/);
  const cases = eq(String.raw`\begin{cases} x+y=3 \\ x-y=1 \end{cases}`);
  assert.match(cases, /<m:begChr m:val="\{"><\/m:begChr><m:endChr m:val=""><\/m:endChr>/);
  assert.equal((cases.match(/<m:mr>/g) || []).length, 2);
  assert.match(cases, /<m:mcJc m:val="left">/);
});

t('Tích phân / tổng → m:nary, biểu thức phía sau nằm dưới dấu', () => {
  const i = eq(String.raw`\int_0^1 (2x+1)\,dx`);
  assert.match(i, /<m:nary><m:naryPr><m:chr m:val="∫"><\/m:chr><m:limLoc m:val="subSup">/);
  assert.match(i, /<m:sub>.*0.*<\/m:sub><m:sup>.*1.*<\/m:sup><m:e>.*2.*<\/m:e><\/m:nary>/);
  assert.match(eq(String.raw`\sum_{k=1}^{n} k`, true), /<m:chr m:val="∑"><\/m:chr><m:limLoc m:val="undOvr">/);
});

t('Hàm sin, log, lim → m:func (có khoảng cách với đối số)', () => {
  assert.match(eq(String.raw`\sin x`), /<m:func><m:fName>.*<m:r>sin<\/m:r>.*<\/m:fName><m:e>.*<m:r>x<\/m:r>/);
  assert.ok(!/<i>[^]*<m:r>sin<\/m:r>/.test(eq(String.raw`\sin x`)), 'tên hàm phải đứng (không nghiêng)');
  assert.match(eq(String.raw`\lim_{x\to 0} f(x)`), /<m:limLow><m:e>.*lim.*<\/m:e><m:lim>.*→.*<\/m:lim><\/m:limLow>/);
  assert.match(eq(String.raw`\lim\limits_{x\to 0} f(x)`), /<m:limLow><m:e>.*lim.*<\/m:e><m:lim>/);
});

t('Véc-tơ, đoạn thẳng, góc, ℝ, trị tuyệt đối', () => {
  assert.match(eq(String.raw`\vec{u}`), /<m:acc><m:accPr><m:chr m:val="⃗">/);
  assert.match(eq(String.raw`\overrightarrow{AB}`), /<m:acc><m:accPr><m:chr m:val="⃗">/);
  assert.match(eq(String.raw`\overline{AB}`), /<m:bar><m:barPr><m:pos m:val="top">/);
  assert.match(eq(String.raw`\widehat{ABC}`), /<m:acc><m:accPr><m:chr m:val="̂">/);
  assert.match(eq(String.raw`x\in\mathbb{R}`), /<m:r>ℝ<\/m:r>/);
  assert.ok(!eq('|x-1|').includes('∣'), 'không dùng ký tự ∣ (U+2223)');
});

t('Ký tự đặc biệt được escape, không phá chú thích HTML', () => {
  const x = eq('a<b');
  assert.match(x, /<m:r>&lt;<\/m:r>/);
  assert.ok(!/--/.test(x.slice(4, -3)), 'không có "--" bên trong chú thích');
});

t('Công thức KaTeX không đọc được → giữ nguyên $...$', () => {
  assert.equal(eq(String.raw`\khongcolenhnay{x}`), null);
  const r = m.convertMathSpansToWordEquations(m.normalizeMathForWord('<html><body><p>A $x^2$ B $\\khongco{y}$</p></body></html>', { encodeEntities: false }));
  assert.equal(r.converted, 1);
  assert.equal(r.failed, 1);
  assert.match(r.html, /\$\\khongco\{y\}\$/);
  assert.match(r.html, /<html xmlns:o=.* xmlns:m="http:\/\/schemas.microsoft.com\/office\/2004\/12\/omml"/);
});

t('prepareMathForWord: chế độ LaTeX giữ nguyên như cũ, chế độ Equation chuyển hết sang ASCII', () => {
  const html = '<!DOCTYPE html><html lang="vi"><body><p>Cho hàm số $y=\\dfrac{1}{x}$ và $$\\int_0^1 x\\,dx$$</p></body></html>';
  assert.equal(m.prepareMathForWord(html, 'latex'), m.normalizeMathForWord(html));
  const e = m.prepareMathForWord(html, 'equation');
  assert.equal((e.match(/msEquation 12/g) || []).length, 2);
  assert.match(e, /<m:oMathPara>/);
  assert.ok(!/[^\x00-\x7F]/.test(e), 'mọi ký tự non-ASCII đã thành entity (an toàn cho altChunk)');
  assert.match(e, /h&#224;m s&#7889;/);
});

console.log(`\n${ok} kiểm thử đạt.`);
