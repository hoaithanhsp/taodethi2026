// Chạy: node tests/variantsExam.test.mjs
// Kiểm thử "Sinh 3 đề biến thể": mỗi bước gửi đúng mục tiêu riêng, và dòng đối chiếu không làm sai đáp án khi đảo đề.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = await build({
  stdin: {
    contents: `export * from './services/variantsExamService.ts'; export { parseExamForShuffle, generateExamVersions } from './services/examShuffle.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error',
  external: ['mammoth', 'katex', '@google/genai'],
});
mkdirSync(new URL('../node_modules/.cache/', import.meta.url), { recursive: true });
const f = new URL('../node_modules/.cache/variantsExam.mjs', import.meta.url);
writeFileSync(f, out.outputFiles[0].text);
const m = await import(f.href);

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('✓', name); };

/** Phiên chat giả: ghi lại yêu cầu đã gửi và trả về 1 đoạn đề. */
const fakeChat = () => {
  const sent = [];
  return {
    sent,
    sendMessageStream: async ({ message }) => {
      sent.push(message);
      return (async function* () { yield { text: 'nội dung', candidates: [{ finishReason: 'STOP' }] }; })();
    },
  };
};

const P1 = m.buildVariantStepPrompt(1);
const P2 = m.buildVariantStepPrompt(2);
const P3 = m.buildVariantStepPrompt(3);

await t('Đề 1: tương tự, chỉ thay số và bối cảnh, không đảo chiều, cùng mức độ', () => {
  assert.match(P1, /ĐỀ TƯƠNG TỰ/);
  assert.match(P1, /CÙNG dạng toán/);
  assert.match(P1, /cùng mức độ/);
  assert.match(P1, /Chỉ thay số liệu/);
  assert.match(P1, /bối cảnh tương tự/);
  assert.match(P1, /KHÔNG đảo chiều/);
});

await t('Đề 2: dạng ngược hoặc bổ sung, thay số đơn thuần không đạt, độ khó tương đương', () => {
  assert.match(P2, /DẠNG NGƯỢC \/ BỔ SUNG/);
  assert.match(P2, /Thay số đơn thuần là KHÔNG đạt/);
  assert.match(P2, /Dạng ngược/);
  assert.match(P2, /Bổ sung dạng toán tương tự/);
  assert.match(P2, /TƯƠNG ĐƯƠNG/);
  assert.match(P2, /Không lặp lại .* Đề 1/);
});

await t('Đề 3: khó hơn cả Đề 1 và Đề 2, nâng từng câu, không tính đổi số to, vẫn đúng chương trình', () => {
  assert.match(P3, /ĐỀ NÂNG CAO/);
  assert.match(P3, /khó hơn RÕ RỆT so với cả Đề 1 và Đề 2/);
  assert.match(P3, /ít nhất một bậc/);
  assert.match(P3, /KHÔNG được coi là khó hơn/);
  assert.match(P3, /không dùng kiến thức lớp trên/);
});

await t('Cả 3 đề giữ khung đề gốc; yêu cầu 3 bước khác nhau', () => {
  for (const p of [P1, P2, P3]) assert.match(p, /đúng khung đề gốc/);
  assert.equal(new Set([P1, P2, P3]).size, 3);
  // Lời nhắc hệ thống không còn bắt mọi đề cùng mức độ (mâu thuẫn với Đề 3)
  const sys = m.VARIANTS_SYSTEM_INSTRUCTION;
  assert.ok(!/cùng thang điểm và mức độ từng câu/.test(sys));
  assert.match(sys, /ĐỀ NÂNG CAO/);
});

await t('Mỗi bước thực sự gửi đúng yêu cầu của đề đó, theo thứ tự 1 → 2 → 3', async () => {
  const chat = fakeChat();
  const file = { name: 'de.pdf', type: 'application/pdf', data: 'QUJD' };
  await m.generateVariantStep1(chat, file, () => {});
  await m.generateVariantNextStep(chat, 2, () => {});
  await m.generateVariantNextStep(chat, 3, () => {});
  assert.equal(chat.sent.length, 3);
  assert.deepEqual(chat.sent[0][0], { inlineData: { mimeType: 'application/pdf', data: 'QUJD' } });
  assert.equal(chat.sent[0][1].text, P1);
  assert.equal(chat.sent[1], P2);
  assert.equal(chat.sent[2], P3);
});

await t('Môn học giáo viên khai báo được gửi kèm yêu cầu Đề 1', async () => {
  const chat = fakeChat();
  await m.generateVariantStep1(chat, { name: 'de.pdf', type: 'application/pdf', data: 'QUJD' }, () => {}, 'Hóa học');
  assert.match(chat.sent[0][1].text, /^MÔN HỌC \(giáo viên đã khai báo\): Hóa học\./);
  assert.ok(chat.sent[0][1].text.endsWith(P1));
});

const exam = (note) => `**ĐỀ SỐ 2**

**PHẦN I. Trắc nghiệm**

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

**PHẦN II. Đúng – Sai**

**Câu 3.** ID3 Xét đúng sai:
a) ý một
b) ý hai
c) ý ba
d) ý bốn

**PHẦN III. Trả lời ngắn**

**Câu 4.** ID4 Tính $5+5$.

---

## ĐÁP ÁN VÀ HƯỚNG DẪN GIẢI

**PHẦN I.**

1.B, 2.D

**PHẦN II.**

| Câu | Ý | Đáp án (Đ/S) | Hướng dẫn giải chi tiết |
| :---: | :---: | :---: | :--- |
| **Câu 3** | **a)** | **Đ** | giải a |
| **Câu 3** | **b)** | **S** | giải b |
| **Câu 3** | **c)** | **S** | giải c |
| **Câu 3** | **d)** | **Đ** | giải d |

**PHẦN III.**

Câu 4: 10

${note}
`;

const NOTES = {
  'Đề 2': '**Đối chiếu với đề gốc:** C1 – ngược; C2 – bổ sung; C3 – ngược; C4 – bổ sung',
  'Đề 3': '**Đối chiếu độ khó với đề gốc:** C1 – Biết → Hiểu; C2 – Hiểu → Vận dụng; C3 – Vận dụng → Vận dụng cao; C4 – Vận dụng cao → Vận dụng cao',
};

for (const [name, note] of Object.entries(NOTES)) {
  await t(`${name}: dòng đối chiếu không ảnh hưởng đáp án khi đảo đề, không lọt vào mã đề`, () => {
    const withNote = m.parseExamForShuffle(exam(note));
    const without = m.parseExamForShuffle(exam(''));
    assert.deepEqual(withNote.questions.map(q => q.kind), ['mc', 'mc', 'tf', 'short']);
    assert.deepEqual(withNote.answers, without.answers);
    assert.deepEqual(withNote.answers.mc, { 1: 'B', 2: 'D' });
    assert.equal(withNote.answers.short[4], '10');
    const versions = m.generateExamVersions(withNote, withNote.answers, { count: 2, startCode: 101, shuffleQuestions: true, shuffleOptions: true, shuffleStatements: true }, 7);
    for (const v of versions) assert.ok(!/Đối chiếu/.test(v.content));
  });
}

console.log(`\n${ok} kiểm thử đạt.`);
