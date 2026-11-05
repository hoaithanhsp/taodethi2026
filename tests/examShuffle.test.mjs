// Chạy: node tests/examShuffle.test.mjs
// Kiểm thử đảo đề: đọc đề + đáp án của 3 chế độ, đảo câu/phương án và giữ đúng đáp án theo NỘI DUNG.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = await build({
  stdin: {
    contents: `export * from './services/examShuffle.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error',
});
mkdirSync(new URL('../node_modules/.cache/', import.meta.url), { recursive: true });
const f = new URL('../node_modules/.cache/examShuffle.mjs', import.meta.url);
writeFileSync(f, out.outputFiles[0].text);
const m = await import(f.href);

let ok = 0;
const t = (name, fn) => { fn(); ok++; console.log('✓', name); };
const ALL = { count: 6, startCode: 101, shuffleQuestions: true, shuffleOptions: true, shuffleStatements: true };

const optionTexts = (exam, q) => q.slots.map(s => exam.source.slice(s.contentStart, s.contentEnd).replace(/<[^>]+>/g, '').trim());
const stemId = (exam, q) => exam.source.slice(q.numPos + q.numLen, q.end).match(/ID(\d+)/)?.[0];

/** Với mọi mã đề: phương án ghi là đúng phải có cùng NỘI DUNG với đề gốc; câu và số câu phải đủ. */
const assertVersionsCorrect = (exam, versions) => {
  const origByStem = new Map(exam.questions.map(q => [stemId(exam, q), q]));
  for (const v of versions) {
    const parsed = m.parseExamForShuffle(v.content);
    assert.equal(parsed.questions.length, exam.questions.length, `mã ${v.code}: đủ số câu`);
    assert.deepEqual(parsed.questions.map(q => q.num), exam.questions.map(q => q.num), `mã ${v.code}: số câu theo vị trí giữ nguyên`);
    parsed.questions.forEach((pq, i) => {
      const id = stemId(parsed, pq);
      const oq = origByStem.get(id);
      assert.ok(oq, `mã ${v.code}: tìm thấy câu ${id}`);
      assert.equal(pq.kind === 'essay' ? oq.kind : pq.kind, oq.kind);
      const vq = v.questions[i];
      assert.equal(vq.originalNum, oq.num, `mã ${v.code} câu ${pq.num}: đối chiếu câu gốc`);
      if (oq.kind === 'mc' && oq.slots) {
        const oOpts = optionTexts(exam, oq);
        const pOpts = optionTexts(parsed, pq);
        assert.deepEqual([...pOpts].sort(), [...oOpts].sort(), `mã ${v.code} câu ${pq.num}: đủ 4 phương án`);
        const correct = oOpts['ABCD'.indexOf(exam.answers.mc[oq.num])];
        assert.equal(pOpts['ABCD'.indexOf(vq.answer)], correct, `mã ${v.code} câu ${pq.num}: đáp án đúng theo nội dung`);
      }
      if (oq.kind === 'tf' && oq.slots) {
        const oOpts = optionTexts(exam, oq);
        const pOpts = optionTexts(parsed, pq);
        const vals = vq.answer.split(' ');
        pOpts.forEach((text, k) => {
          const origIdx = oOpts.indexOf(text);
          assert.ok(origIdx >= 0);
          assert.equal(vals[k], exam.answers.tf[oq.num]['abcd'[origIdx]], `mã ${v.code} câu ${pq.num} ý ${'abcd'[k]}: Đ/S theo nội dung`);
        });
      }
      if (oq.kind === 'short') assert.equal(vq.answer, exam.answers.short[oq.num]);
    });
  }
};

// --- Mẫu theo đúng định dạng prompt chế độ CV 7991 (HTML) ---
const HTML_EXAM = String.raw`<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Đề</title><style>.question-number{font-weight:bold}</style></head><body>
<h2 style="text-align:center">ĐỀ KIỂM TRA GIỮA KỲ 1 - MÔN TOÁN LỚP 12</h2>
<p>Họ tên: ............ SBD: ......</p>
<h3>PHẦN I. TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN</h3>
<p><span class="question-number">Câu 1.</span> ID1 Cho hàm số $y=\dfrac{x-1}{x+1}$. Giá trị $y(0)$ là</p>
<div class="options">
  <div class="option-item">A. $-1$</div>
  <div class="option-item">B. $0$</div>
  <div class="option-item">C. $1$</div>
  <div class="option-item">D. $2$</div>
</div>
<br> <!-- Dòng trống giữa các câu -->
<p><span class="question-number">Câu 2.</span> ID2 Thủ đô của Việt Nam là?</p>
<div class="options">
  <div class="option-item">A. Hà Nội</div>
  <div class="option-item">B. Huế</div>
  <div class="option-item">C. Đà Nẵng</div>
  <div class="option-item">D. Đáp án khác</div>
</div>
<br>
<p><span class="question-number">Câu 3.</span> ID3 Mệnh đề nào đúng? Bảng số liệu:</p>
<table border="1"><tr><td>A. giá trị</td><td>Câu 9</td></tr></table>
<div class="options">
  <div class="option-item">A. Mệnh đề một</div>
  <div class="option-item">B. Mệnh đề hai</div>
  <div class="option-item">C. Cả A và B</div>
  <div class="option-item">D. Mệnh đề bốn</div>
</div>
<p><span class="question-number">Câu 4.</span> ID4 Số nào lớn nhất?</p>
<div class="options">
  <div class="option-item"><strong>A.</strong> Mười</div>
  <div class="option-item"><strong>B.</strong> Hai mươi</div>
  <div class="option-item"><strong>C.</strong> Ba mươi</div>
  <div class="option-item"><strong>D.</strong> Bốn mươi</div>
</div>
<h3>PHẦN II. TRẮC NGHIỆM ĐÚNG SAI</h3>
<p><span class="question-number">Câu 1.</span> ID5 Cho hàm số $y=f(x)$. Xét tính đúng sai:</p>
<div class="options">
  <div class="option-item">a) Mệnh đề a của ID5</div>
  <div class="option-item">b) Mệnh đề b của ID5</div>
  <div class="option-item">c) Mệnh đề c của ID5</div>
  <div class="option-item">d) Mệnh đề d của ID5</div>
</div>
<p><span class="question-number">Câu 2.</span> ID6 Xét tính đúng sai:</p>
<div class="options">
  <div class="option-item">a) Một của ID6</div>
  <div class="option-item">b) Từ ý a suy ra ID6</div>
  <div class="option-item">c) Ba của ID6</div>
  <div class="option-item">d) Bốn của ID6</div>
</div>
<h3>PHẦN III. TRẮC NGHIỆM TRẢ LỜI NGẮN</h3>
<p><span class="question-number">Câu 1.</span> ID7 Tính $1+1$.</p>
<p><span class="question-number">Câu 2.</span> ID8 Tính $\dfrac{1}{2}$ dạng số thập phân.</p>
<p><span class="question-number">Câu 3.</span> ID9 Tính $2^3$.</p>
<p style="text-align:center">--- HẾT ---</p>
<div style="page-break-before: always"></div>
<h2>ĐÁP ÁN VÀ HƯỚNG DẪN CHẤM</h2>
<h3>PHẦN I. Trắc nghiệm nhiều phương án</h3>
<table class="answer-table"><tr><th>Câu</th><th>1</th><th>2</th><th>3</th><th>4</th></tr><tr><td>Đáp án</td><td>A</td><td>A</td><td>C</td><td>D</td></tr></table>
<h3>PHẦN II. Đúng - Sai</h3>
<table class="answer-table"><thead><tr><th>Câu</th><th>Ý a)</th><th>Ý b)</th><th>Ý c)</th><th>Ý d)</th></tr></thead><tbody>
<tr><td>Câu 1</td><td>Đ</td><td>S</td><td>Đ</td><td>S</td></tr>
<tr><td>Câu 2</td><td>S</td><td>S</td><td>Đ</td><td>Đ</td></tr></tbody></table>
<table class="answer-table"><thead><tr><th>Câu</th><th>Ý</th><th>Đáp án (Đ/S)</th><th>Hướng dẫn giải chi tiết</th></tr></thead><tbody>
<tr><td rowspan="4">Câu 1</td><td>a)</td><td>Đ</td><td>Vì ...</td></tr>
<tr><td>b)</td><td>S</td><td>Vì ...</td></tr><tr><td>c)</td><td>Đ</td><td>Vì ...</td></tr><tr><td>d)</td><td>S</td><td>Vì ...</td></tr></tbody></table>
<h3>PHẦN III. Trả lời ngắn</h3>
<table class="answer-table"><tr><th>Câu</th><th>Đáp án</th><th>Hướng dẫn giải chi tiết</th></tr>
<tr><td>Câu 1</td><td>2</td><td>Cộng lại</td></tr><tr><td>Câu 2</td><td>0,5</td><td>Chia</td></tr><tr><td>Câu 3</td><td>8</td><td>Lũy thừa</td></tr></table>
</body></html>`;

// --- Mẫu chế độ Đề tương tự (Markdown, lời giải tách riêng) ---
const MD_EXAM = String.raw`**ĐỀ KIỂM TRA CUỐI KỲ**

## PHẦN I. Trắc nghiệm nhiều lựa chọn

**Câu 1:** ID1 Giá trị của $\sin 0$ là
A. $0$
B. $1$
C. $-1$
D. $2$

**Câu 2:** ID2 Đạo hàm của $x^2$ là
**A.** $2x$
**B.** $x$
**C.** $x^2$
**D.** $2$

**Câu 3:** ID3 Nguyên hàm của $1$ là A. $x$  B. $2x$  C. $x^2$  D. $0$

## PHẦN II. Đúng - Sai

**Câu 1:** ID4 Cho $f(x)=x$.
a) Ý một của ID4
b) Ý hai của ID4
c) Ý ba của ID4
d) Ý bốn của ID4

## PHẦN III. Trả lời ngắn

**Câu 1:** ID5 Tính $2+2$.

**Câu 2:** ID6 Tính $3+3$.
`;
const MD_SOLUTION = String.raw`#### I. BẢNG ĐÁP ÁN NHANH (BẮT BUỘC CÓ)
**1. Trắc nghiệm nhiều phương án:**
Câu 1: A | Câu 2: A | Câu 3: A

**2. Trắc nghiệm Đúng - Sai (Đ/S) (BẮT BUỘC LẬP BẢNG ĐỦ 4 ĐÁP ÁN a, b, c, d):**
| Câu | Ý a) | Ý b) | Ý c) | Ý d) |
| :---: | :---: | :---: | :---: | :---: |
| **Câu 1** | **Đ** | **S** | **S** | **Đ** |

**3. Trả lời ngắn:**
Câu 1: Đáp số là 4
Câu 2: 6

#### II. LỜI GIẢI CHI TIẾT (BẮT BUỘC GIẢI TẤT CẢ CÁC CÂU)
**Câu 1:** Ta có $\sin 0 = 0$. Chọn A.
| Câu | Ý | Đáp án (Đ/S) | Hướng dẫn giải chi tiết |
| :---: | :---: | :---: | :--- |
| **Câu 1** | **a)** | **Đ** | Vì ... |
| **Câu 1** | **b)** | **S** | Vì ... |
`;

// --- Mẫu chế độ Đề biến thể (đề + đáp án chung, đánh số liên tục) ---
const VARIANT = String.raw`# Phần 1: ĐỀ THI

**ĐỀ SỐ 1**

**Câu 1.** ID1 Hỏi một?
A. Một 1
B. Một 2
C. Một 3
D. Một 4

**Câu 2.** ID2 Hỏi hai?
A. Hai 1
B. Hai 2
C. Hai 3
D. Hai 4

**Câu 3.** ID3 Xét đúng sai:
a) ID3 ý một
b) ID3 ý hai
c) ID3 ý ba
d) ID3 ý bốn

**Câu 4.** ID4 Tính $5+5$.

---

# Phần 2: ĐÁP ÁN & HƯỚNG DẪN GIẢI

1.B, 2.D

**Câu 3:** a) Đúng, b) Sai, c) Sai, d) Đúng

**Câu 4.** Đáp số: 10
`;

t('CV 7991 (HTML): nhận đúng phần, dạng câu và đáp án từ các bảng', () => {
  const e = m.parseExamForShuffle(HTML_EXAM);
  assert.deepEqual(e.sections.map(s => s.type), ['I', 'II', 'III']);
  assert.deepEqual(e.questions.map(q => q.kind), ['mc', 'mc', 'mc', 'mc', 'tf', 'tf', 'short', 'short', 'short']);
  assert.deepEqual(e.answers.mc, { 1: 'A', 2: 'A', 3: 'C', 4: 'D' });
  assert.deepEqual(e.answers.tf[1], { a: 'Đ', b: 'S', c: 'Đ', d: 'S' });
  assert.deepEqual(e.answers.tf[2], { a: 'S', b: 'S', c: 'Đ', d: 'Đ' });
  assert.deepEqual(e.answers.short, { 1: '2', 2: '0,5', 3: '8' });
  assert.deepEqual(m.missingAnswers(e), []);
  assert.deepEqual(e.conflicts, []);
});

t('CV 7991 (HTML): đảo đúng đáp án, không còn phần đáp án trong mã đề', () => {
  const e = m.parseExamForShuffle(HTML_EXAM);
  const vs = m.generateExamVersions(e, e.answers, ALL, 42);
  assert.equal(vs.length, 6);
  assertVersionsCorrect(e, vs);
  for (const v of vs) {
    assert.ok(!/ĐÁP ÁN|Hướng dẫn giải chi tiết|answer-table/.test(v.content), 'mã đề không chứa đáp án');
    assert.match(v.content, /--- HẾT ---/);
    assert.ok(!/page-break/.test(v.content), 'không để lại ngắt trang của phần đáp án (dư trang trắng)');
    assert.match(v.content, /<\/body>\s*<\/html>\s*$/);
    assert.match(v.content, new RegExp(`Mã đề: ${v.code}`));
    assert.match(v.content, /\$y=\\dfrac\{x-1\}\{x\+1\}\$/, 'công thức nguyên vẹn');
    assert.equal((v.content.match(/<div class="option-item">/g) || []).length, 4 * 4 + 2 * 4, 'giữ khung HTML');
  }
});

t('Giữ nguyên thứ tự khi phương án / ý có tham chiếu', () => {
  const e = m.parseExamForShuffle(HTML_EXAM);
  const q3 = e.questions.find(q => q.kind === 'mc' && q.num === 3);
  assert.equal(q3.keepInner, true, '"Cả A và B"');
  const tf2 = e.questions.find(q => q.kind === 'tf' && q.num === 2);
  assert.equal(tf2.keepInner, true, '"Từ ý a"');
  const q2 = e.questions.find(q => q.kind === 'mc' && q.num === 2);
  assert.equal(q2.keepInner, true, '"Đáp án khác"');
  const vs = m.generateExamVersions(e, e.answers, ALL, 7);
  for (const v of vs) {
    const i = v.questions.findIndex(q => q.kind === 'mc' && q.originalNum === 3);
    assert.equal(v.questions[i].answer, 'C');
  }
});

t('Bảng số liệu trong câu không bị nhầm là phương án / câu hỏi', () => {
  const e = m.parseExamForShuffle(HTML_EXAM);
  const q3 = e.questions.find(q => q.kind === 'mc' && q.num === 3);
  const opts = optionTexts(e, q3);
  assert.deepEqual(opts, ['Mệnh đề một', 'Mệnh đề hai', 'Cả A và B', 'Mệnh đề bốn']);
  assert.equal(e.questions.length, 9);
});

t('Đề tương tự (Markdown + lời giải riêng): đọc đáp án và đảo đúng', () => {
  const e = m.parseExamForShuffle(MD_EXAM, MD_SOLUTION);
  assert.deepEqual(e.questions.map(q => q.kind), ['mc', 'mc', 'mc', 'tf', 'short', 'short']);
  assert.deepEqual(e.answers.mc, { 1: 'A', 2: 'A', 3: 'A' });
  assert.deepEqual(e.answers.tf[1], { a: 'Đ', b: 'S', c: 'S', d: 'Đ' });
  assert.deepEqual(e.answers.short, { 1: '4', 2: '6' });
  assert.deepEqual(optionTexts(e, e.questions[2]), ['$x$', '$2x$', '$x^2$', '$0$'], 'phương án trên cùng một dòng');
  assert.deepEqual(e.conflicts, []);
  const vs = m.generateExamVersions(e, e.answers, ALL, 3);
  assertVersionsCorrect(e, vs);
  // Đáp án đều là A ở đề gốc: sau khi đảo phải có câu đổi sang chữ khác
  assert.ok(vs.some(v => v.questions.filter(q => q.kind === 'mc').some(q => q.answer !== 'A')));
  assert.match(vs[0].content, /\*\*Mã đề: 101\*\*/);
});

t('Đề biến thể (đáp án kiểu 1.B, 2.D; đánh số liên tục)', () => {
  const e = m.parseExamForShuffle(VARIANT);
  assert.deepEqual(e.questions.map(q => q.kind), ['mc', 'mc', 'tf', 'short']);
  assert.deepEqual(e.answers.mc, { 1: 'B', 2: 'D' });
  assert.deepEqual(e.answers.tf[3], { a: 'Đ', b: 'S', c: 'S', d: 'Đ' });
  assert.equal(e.answers.short[4], '10');
  const vs = m.generateExamVersions(e, e.answers, ALL, 11);
  assertVersionsCorrect(e, vs);
  for (const v of vs) {
    assert.ok(!/ĐÁP ÁN/.test(v.content));
    assert.ok(!/\n---\s*$/.test(v.content), 'không để lại đường kẻ cuối');
    // Câu 1, 2 đảo với nhau; câu 3 (Đ/S), 4 (ngắn) giữ số câu theo dạng
    assert.deepEqual(v.questions.map(q => q.num), [1, 2, 3, 4]);
    assert.deepEqual(v.questions.slice(2).map(q => q.originalNum), [3, 4]);
  }
});

t('Các mã đề khác nhau; tắt lựa chọn thì không đảo phần tương ứng', () => {
  const e = m.parseExamForShuffle(HTML_EXAM);
  const vs = m.generateExamVersions(e, e.answers, ALL, 5);
  assert.equal(new Set(vs.map(v => v.content.replace(/Mã đề: \d+/, ''))).size, vs.length);
  const onlyQ = m.generateExamVersions(e, e.answers, { ...ALL, shuffleOptions: false, shuffleStatements: false }, 5)[0];
  for (const q of onlyQ.questions.filter(x => x.kind === 'mc')) assert.equal(q.answer, e.answers.mc[q.originalNum]);
  const noQ = m.generateExamVersions(e, e.answers, { ...ALL, shuffleQuestions: false }, 5)[0];
  assert.deepEqual(noQ.questions.map(q => q.originalNum), e.questions.map(q => q.num));
});

t('Câu dùng chung ngữ liệu / nhắc tới câu khác giữ nguyên vị trí; tự luận không đảo', () => {
  const src = String.raw`## PHẦN I. Trắc nghiệm nhiều lựa chọn

**Câu 1.** ID1 Hỏi?
A. a1
B. a2
C. a3
D. a4

**Câu 2.** ID2 Hỏi?
A. b1
B. b2
C. b3
D. b4

Dùng thông tin sau để trả lời câu 3 và câu 4: Một đoạn ngữ liệu dài.

**Câu 3.** ID3 Hỏi?
A. c1
B. c2
C. c3
D. c4

**Câu 4.** ID4 Theo kết quả câu 3, hỏi?
A. d1
B. d2
C. d3
D. d4

**Câu 5.** ID5 Hỏi?
A. e1
B. e2
C. e3
D. e4

## PHẦN IV. Tự luận

**Câu 1.** ID6 Giải phương trình.

**Câu 2.** ID7 Chứng minh.

# ĐÁP ÁN

1.A 2.A 3.A 4.A 5.A
`;
  const e = m.parseExamForShuffle(src);
  const nums = e.questions.filter(q => q.kind === 'mc');
  assert.deepEqual(nums.map(q => q.pinned), [false, false, true, true, false]);
  assert.deepEqual(e.questions.filter(q => q.kind === 'essay').map(q => q.pinned), [true, true]);
  const vs = m.generateExamVersions(e, e.answers, ALL, 9);
  for (const v of vs) {
    const mc = v.questions.filter(q => q.kind === 'mc').map(q => q.originalNum);
    assert.equal(mc[2], 3);
    assert.equal(mc[3], 4);
    // Ngữ liệu đi liền trước câu 3
    assert.match(v.content, /Dùng thông tin sau[\s\S]*?\*\*Câu 3\.\*\* ID3/);
    assert.match(v.content, /\*\*Câu 1\.\*\* ID6[\s\S]*\*\*Câu 2\.\*\* ID7/);
  }
  const key = m.buildAnswerKeyDocument(e, vs, 'Đề mẫu');
  assert.match(key, /Tự luận/);
});

t('Thiếu / mâu thuẫn đáp án được báo; ô thiếu hiện dấu ?', () => {
  const src = `**Câu 1.** ID1 Hỏi?
A. a1
B. a2
C. a3
D. a4

**Câu 2.** ID2 Hỏi?
A. b1
B. b2
C. b3
D. b4

# ĐÁP ÁN
Câu 1: A
**Câu 1.** Lời giải. Chọn B.
`;
  const e = m.parseExamForShuffle(src);
  assert.equal(e.answers.mc[1], 'A');
  assert.equal(e.conflicts.length, 1);
  assert.match(e.conflicts[0], /câu 1.*A.*B/);
  assert.deepEqual(m.missingAnswers(e), ['Trắc nghiệm câu 2']);
  const vs = m.generateExamVersions(e, e.answers, { ...ALL, count: 2 }, 1);
  const key = m.buildAnswerKeyDocument(e, vs, 'Đề mẫu');
  assert.match(key, /color:#c00;font-weight:bold;">\?/);
});

t('Bảng đáp án theo mã đề có đủ các dạng và bảng đối chiếu đề gốc', () => {
  const e = m.parseExamForShuffle(HTML_EXAM);
  const vs = m.generateExamVersions(e, e.answers, { ...ALL, count: 10 }, 2);
  const key = m.buildAnswerKeyDocument(e, vs, 'Đề mẫu');
  assert.match(key, /Trắc nghiệm nhiều phương án lựa chọn/);
  assert.match(key, /Trắc nghiệm Đúng – Sai/);
  assert.match(key, /Trắc nghiệm trả lời ngắn/);
  assert.match(key, /Đối chiếu với đề gốc/);
  assert.match(key, /<th>110<\/th>/);
  assert.match(key, /[ĐS] [ĐS] [ĐS] [ĐS]/);
  assert.ok(!/Hướng dẫn giải chi tiết|Vì \.\.\./.test(key), 'không kèm lời giải');
});

const KEY_QUESTIONS = [
  { num: 1, kind: 'mc' }, { num: 2, kind: 'mc' },
  { num: 3, kind: 'tf' }, { num: 4, kind: 'tf' },
  { num: 5, kind: 'short' }, { num: 6, kind: 'short' },
];
const key = text => m.parseAnswerKey(text, KEY_QUESTIONS).answers;
const TF3 = { a: 'Đ', b: 'S', c: 'S', d: 'Đ' };
const TF4 = { a: 'S', b: 'S', c: 'Đ', d: 'Đ' };

t('Đáp án trắc nghiệm ghi cùng dòng với tiêu đề phần', () => {
  for (const line of [
    '**PHẦN I.** 1.B, 2.D',
    'PHẦN I: 1.B, 2.D',
    'PHẦN 1. 1B 2D',
    '### PHẦN I. 1.B, 2.D',
    'PHẦN I. TRẮC NGHIỆM (2 CÂU, 0,5 ĐIỂM): 1.B, 2.D',
    'PHẦN I (Câu 1 – 2): Câu 1: B | Câu 2: D',
    'Phần I. Trắc nghiệm nhiều lựa chọn: 1.B; 2.D',
  ]) assert.deepEqual(key(line).mc, { 1: 'B', 2: 'D' }, line);
});

t('Nhãn "Phần 2: ĐÁP ÁN & HƯỚNG DẪN GIẢI" không bị coi là Phần II Đúng – Sai', () => {
  for (const banner of ['**Phần 2: ĐÁP ÁN & HƯỚNG DẪN GIẢI**', '# Phần 2: ĐÁP ÁN & HƯỚNG DẪN GIẢI', 'Phần 2: ĐÁP ÁN']) {
    const a = key(`${banner}\n1.B, 2.D\nCâu 3: ĐSSĐ\nCâu 5. Đáp số: 10`);
    assert.deepEqual(a.mc, { 1: 'B', 2: 'D' }, banner);
    assert.deepEqual(a.tf[3], TF3, banner);
    assert.equal(a.short[5], '10', banner);
  }
  assert.deepEqual(key('Phần 2: ĐÁP ÁN: 1.B, 2.D').mc, { 1: 'B', 2: 'D' });
});

t('Dãy đáp án dài (trên 120 ký tự) ghi cùng dòng với tiêu đề phần', () => {
  const pairs = Array.from({ length: 40 }, (_, i) => `${i + 1}.${'ABCD'[i % 4]}`).join(', ');
  const mc = key(`PHẦN I. TRẮC NGHIỆM: ${pairs}`).mc;
  assert.equal(Object.keys(mc).length, 40);
  assert.equal(mc[1], 'A');
  assert.equal(mc[40], 'D');
});

t('Đáp án Đúng – Sai ghi cùng dòng với tiêu đề phần', () => {
  for (const line of [
    'PHẦN II. Câu 3: ĐSSĐ; Câu 4: SSĐĐ',
    '**PHẦN II.** 3. Đ S S Đ; 4. S S Đ Đ',
    'PHẦN II. Đúng – Sai: Câu 3: a) Đ b) S c) S d) Đ; Câu 4: a) S b) S c) Đ d) Đ',
    'Phần 2: Câu 3: Đúng, Sai, Sai, Đúng | Câu 4: Sai, Sai, Đúng, Đúng',
  ]) {
    const a = key(line);
    assert.deepEqual(a.tf[3], TF3, line);
    assert.deepEqual(a.tf[4], TF4, line);
    assert.deepEqual(a.mc, {}, line);
  }
});

t('Đáp án trả lời ngắn ghi cùng dòng với tiêu đề phần (giữ dấu phẩy thập phân, số âm)', () => {
  for (const [line, exp] of [
    ['PHẦN III. Câu 5: 10; Câu 6: 3,5', { 5: '10', 6: '3,5' }],
    ['**PHẦN III.** 5. 10; 6. 3,5', { 5: '10', 6: '3,5' }],
    ['PHẦN III. 5: -2 6: 0.5', { 5: '-2', 6: '0.5' }],
    ['PHẦN III. Trả lời ngắn: 5. 10, 6. 3,5', { 5: '10', 6: '3,5' }],
  ]) assert.deepEqual(key(line).short, exp, line);
});

t('Dòng chỉ là tiêu đề phần: không đọc nhầm thành đáp án, câu ở dòng sau vẫn đúng phần', () => {
  for (const line of [
    'PHẦN I. TRẮC NGHIỆM (24 CÂU, 6 ĐIỂM)',
    'PHẦN I. Câu trắc nghiệm 4 phương án',
    'PHẦN II. Đúng – Sai (Câu 13-16)',
    'PHẦN 2: Đúng sai',
    'PHẦN III. Trả lời ngắn (mỗi câu 0.5 điểm)',
    'PHẦN III. Trả lời ngắn (Câu 5-6): 2 điểm',
    'PHẦN IV. Tự luận: 1. 5 điểm',
  ]) {
    const a = key(line);
    assert.deepEqual([a.mc, a.tf, a.short], [{}, {}, {}], line);
  }
  const a = key('PHẦN I. TRẮC NGHIỆM (2 CÂU)\n1.B, 2.D\nPHẦN II. Đúng – Sai\nCâu 3: ĐSSĐ\nPHẦN III. Trả lời ngắn\nCâu 5: 10');
  assert.deepEqual(a.mc, { 1: 'B', 2: 'D' });
  assert.deepEqual(a.tf[3], TF3);
  assert.deepEqual(a.short, { 5: '10' });
});

t('Đề đầy đủ có đáp án cùng dòng tiêu đề phần: đọc đủ đáp án và đảo đề đúng', () => {
  const src = String.raw`**Câu 1.** ID1 Hỏi một?
A. Một 1
B. Một 2
C. Một 3
D. Một 4

**Câu 2.** ID2 Hỏi hai?
A. Hai 1
B. Hai 2
C. Hai 3
D. Hai 4

**PHẦN II. Đúng – Sai**

**Câu 3.** ID3 Xét đúng sai:
a) ý một
b) ý hai
c) ý ba
d) ý bốn

**PHẦN III. Trả lời ngắn**

**Câu 4.** ID4 Tính $5+5$.

## ĐÁP ÁN

**PHẦN I.** 1.B, 2.D

**PHẦN II.** Câu 3: ĐSSĐ

**PHẦN III.** Câu 4: 10
`;
  const e = m.parseExamForShuffle(src);
  assert.deepEqual(e.answers.mc, { 1: 'B', 2: 'D' });
  assert.deepEqual(e.answers.tf[3], TF3);
  assert.equal(e.answers.short[4], '10');
  assert.deepEqual(m.missingAnswers(e), []);
  assertVersionsCorrect(e, m.generateExamVersions(e, e.answers, ALL, 5));
});

console.log(`\n${ok} kiểm thử đạt.`);
