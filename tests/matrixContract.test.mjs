// Chạy: node tests/matrixContract.test.mjs
// Kiểm thử hồi quy luồng: file Word Ma trận/Đặc tả → bảng HTML → hợp đồng số liệu → kiểm tra đề.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

// mammoth không cần cho các test này → thay bằng stub để chạy được trong mọi môi trường
const stubMammoth = {
  name: 'stub-mammoth',
  setup(b) {
    b.onResolve({ filter: /^mammoth$/ }, () => ({ path: 'mammoth', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export default { convertToHtml: async () => ({ value: "" }), images: { imgElement: f => f } };',
      loader: 'js',
    }));
  },
};
const out = await build({
  stdin: {
    contents: `export * from './services/docxMathParser.ts'; export * from './services/matrixContract.ts'; export * from './services/examValidator.ts'; export { prepareExamSourceParts } from './services/examSourceService.ts';`,
    // fileURLToPath giải mã %20 / chữ có dấu trong đường dẫn (vd. "DÁN VÀO CÁC APP")
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    loader: 'ts',
  },
  bundle: true, format: 'esm', write: false, platform: 'node', plugins: [stubMammoth], logLevel: 'error',
});
mkdirSync(new URL('../node_modules/.cache/', import.meta.url), { recursive: true });
const f = new URL('../node_modules/.cache/matrixContract.mjs', import.meta.url);
writeFileSync(f, out.outputFiles[0].text);
const m = await import(f.href);

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('✓', name); };
const lv = (b, h, v, c = 0) => ({ biet: b, hieu: h, van_dung: v, van_dung_cao: c });
const readDocx = async (name) => {
  const buf = readFileSync(new URL(`../${name}`, import.meta.url));
  return m.extractDocxTablesAndHtml(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
};

// ---------------------------------------------------------------- 3 file mẫu thật
await t('01 MA TRẬN ĐẶC TẢ (Địa lí 11, ghi SỐ lượng): tách 2 bảng, đọc đúng số câu & điểm', async () => {
  const x = await readDocx('01 MA TRẬN ĐẶC TẢ.docx');
  assert.deepEqual(x.tableKinds, ['matrix', 'specs']);
  assert.ok(x.specsHtml && /Yêu cầu cần đạt/.test(x.specsHtml));
  assert.ok(/Ghi chú/.test(x.matrixHtml) && !/Ghi chú: - TN/.test(x.specsHtml), 'ghi chú ma trận phải ở lại phần ma trận');
  const r = m.resolveContracts(x.matrixHtml, x.specsHtml);
  const c = r.primary;
  assert.equal(r.warnings.length, 0);
  assert.deepEqual(c.meta, { subject: 'Địa lí', grade: '11', examType: 'Cuối kỳ 1' });
  assert.deepEqual(c.commands.I, lv(10, 1, 1));
  assert.deepEqual(c.commands.II, lv(6, 1, 1));
  assert.deepEqual(c.commands.III, lv(0, 1, 3));
  assert.deepEqual(c.commands.IV, lv(0, 1, 1));
  assert.deepEqual(c.questionCount, { I: 12, II: 2, III: 4, IV: 2 });
  assert.deepEqual(c.points.byType, { I: 3, II: 2, III: 2, IV: 3 });
  assert.equal(c.questionConfig.type2QuestionCount, 2);
  assert.deepEqual(c.questionConfig.dungSaiLevelConfigs[0], { yA: 'nhan_biet', yB: 'nhan_biet', yC: 'nhan_biet', yD: 'thong_hieu' });
  assert.ok(c.questions.I[0].yccd, 'dùng đặc tả (có Yêu cầu cần đạt) khi khớp ma trận');
});

await t('02 MA TRẬN ĐẶC TẢ (Toán 10, mã "Câu 1, 2"): đọc đúng + phát hiện đặc tả KHÔNG khớp ma trận', async () => {
  const x = await readDocx('02 MA TRẬN ĐẶC TẢ.docx');
  assert.deepEqual(x.tableKinds, ['matrix', 'specs']);
  const r = m.resolveContracts(x.matrixHtml, x.specsHtml);
  const c = r.matrix;
  assert.deepEqual(c.meta, { subject: 'Toán học', grade: '10', examType: 'Giữa kỳ 2' });
  assert.equal(c.codeStyle, 'cau');
  assert.deepEqual(c.commands.I, lv(10, 2, 0));
  assert.deepEqual(c.commands.II, lv(4, 2, 2));
  assert.deepEqual(c.commands.III, lv(1, 1, 2));
  assert.deepEqual(c.commands.IV, lv(0, 2, 2));
  assert.equal(c.questionCount.IV, 3, 'Tự luận: 3 câu (câu 2 có 2 ý)');
  assert.equal(c.questions.IV[1].items.length, 2);
  assert.equal(c.totalCommands, 28);
  assert.ok(r.warnings.some(w => /không khớp Ma trận ở Dạng I/.test(w)), 'đặc tả trong file 02 là của đề khác → phải cảnh báo');
  assert.equal(r.primarySource, 'matrix');
});

await t('03 Ma trận (Lịch sử 7, mã I.1/II.1a/IV.1, không có Dạng III, thang 1,5-2-6,5)', async () => {
  const x = await readDocx('03 Ma trận.docx');
  assert.deepEqual(x.tableKinds, ['matrix']);
  assert.equal(x.specsHtml, null);
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.deepEqual(c.meta, { subject: 'Lịch sử', grade: '7', examType: 'Giữa kỳ 1' });
  assert.equal(c.codeStyle, 'roman');
  assert.deepEqual(c.questionCount, { I: 6, II: 2, III: 0, IV: 2 });
  assert.deepEqual(c.points.byType, { I: 1.5, II: 2, IV: 6.5 });
  assert.equal(c.questions.IV[0].points, 3);
  assert.equal(c.questions.IV[1].points, 3.5);
  assert.equal(c.confidence, 'high');
  const block = m.buildContractPromptBlock(c);
  assert.ok(/KHÔNG có \(TUYỆT ĐỐI KHÔNG TẠO\): Phần III/.test(block));
});

// ---------------------------------------------------------------- file Word tổng hợp (các ca lỗi trong báo cáo)
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const P = (text, bold) => `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const TC = (content = '', o = {}) => `<w:tc><w:tcPr>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.vm === 'r' ? '<w:vMerge w:val="restart"/>' : o.vm === 'c' ? '<w:vMerge/>' : ''}</w:tcPr>${content.startsWith('<w:') ? content : P(content)}</w:tc>`;
const TR = (cells, o = {}) => `<w:tr>${o.before ? `<w:trPr><w:gridBefore w:val="${o.before}"/></w:trPr>` : ''}${cells.join('')}</w:tr>`;
const TBL = (rows, cols) => `<w:tbl><w:tblPr/><w:tblGrid>${'<w:gridCol w:w="600"/>'.repeat(cols)}</w:tblGrid>${rows.join('')}</w:tbl>`;
const makeDocx = async (body) => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return m.extractDocxTablesAndHtml(await zip.generateAsync({ type: 'arraybuffer' }));
};

// Ma trận 17 cột: TT | Chương | Bài | NLC(B H VD VDC) | ĐS(B H VD) | TL(B H VD) | Tổng(B H VD) | %
const L = ['Biết', 'Hiểu', 'VD'];
const header = [
  TR([TC('TT', { vm: 'r' }), TC('Chương/Chủ đề', { vm: 'r' }), TC('Nội dung/đơn vị kiến thức', { vm: 'r' }), TC('Mức độ đánh giá', { span: 10 }), TC('Tổng', { span: 3, vm: 'r' }), TC('Tỉ lệ % điểm', { vm: 'r' })]),
  TR([TC('', { vm: 'c' }), TC('', { vm: 'c' }), TC('', { vm: 'c' }), TC('Nhiều lựa chọn', { span: 4 }), TC('“Đúng – Sai”', { span: 3 }), TC('Tự luận', { span: 3 }), TC('', { span: 3, vm: 'c' }), TC('', { vm: 'c' })]),
  TR([TC('', { vm: 'c' }), TC('', { vm: 'c' }), TC('', { vm: 'c' }), ...['Biết', 'Hiểu', 'Vận dụng', 'Vận dụng cao'].map(x => TC(x)), ...L.map(x => TC(x)), ...L.map(x => TC(x)), ...L.map(x => TC(x)), TC('', { vm: 'c' })]),
];
const nestedCell = `<w:tc><w:tcPr/>${TBL([TR([TC('I.5')]), TR([TC('I.6')])], 1)}<w:p/></w:tc>`;
const body1 = [
  TR([TC('1', { vm: 'r' }), TC('Chương 1. Hàm số', { vm: 'r' }), TC('Bài 1. Đơn điệu'), TC('I.1, I.2'), TC('I.3'), TC(''), TC('I.4'), TC('II.1a II.1b'), TC('II.1c'), TC('II.1d'), TC(''), TC(''), TC(''), TC('4'), TC('2'), TC('1'), TC('20')]),
  // ô chứa BẢNG LỒNG (trước đây làm cắt cụt cả bảng)
  TR([TC('', { vm: 'c' }), TC('', { vm: 'c' }), TC('Bài 2. Cực trị'), nestedCell, TC(''), TC(''), TC(''), TC(''), TC(''), TC(''), TC(''), TC('IV.1a'), TC('IV.1b'), TC('2'), TC('1'), TC('1'), TC('35')]),
  // dòng tiêu đề bị chép lặp lại (copy từ PDF) → phải bỏ
  header[2],
  // dòng có gridBefore=2: 2 cột đầu không có <w:tc> → không được dồn trái
  TR([TC('Bài 3. Tiệm cận'), TC(''), TC('I.7'), TC(''), TC(''), TC('II.2a, b'), TC('II.2c'), TC('II.2d'), TC(''), TC(''), TC(''), TC('2'), TC('2'), TC('1'), TC('45')], { before: 2 }),
];
const footer = [
  TR([TC('Tổng số câu', { span: 3 }), TC('4'), TC('2'), TC('0'), TC('1'), TC('4'), TC('2'), TC('2'), TC('0'), TC('1'), TC('1'), TC('8'), TC('5'), TC('3'), TC('')]),
  TR([TC('Tổng số điểm', { span: 3 }), TC('3,5', { span: 4 }), TC('4,0', { span: 3 }), TC('2,5', { span: 3 }), TC(''), TC(''), TC(''), TC('10')]),
];
const synthMatrix = TBL([...header, ...body1, ...footer], 17);
const specsTbl = TBL([
  TR([TC('TT'), TC('Chương'), TC('Nội dung'), TC('Yêu cầu cần đạt'), TC('Nhiều lựa chọn', { span: 4 }), TC('Đúng – Sai', { span: 3 }), TC('Tự luận', { span: 3 })]),
  TR([TC(''), TC(''), TC(''), TC(''), ...['B', 'H', 'VD', 'VDC'].map(x => TC(x)), ...['B', 'H', 'VD'].map(x => TC(x)), ...['B', 'H', 'VD'].map(x => TC(x))]),
  TR([TC('1'), TC('Chương 1'), TC('Bài 1'), TC('Nhận biết: nêu được…'), TC('I.1'), TC(''), TC(''), TC(''), TC(''), TC(''), TC(''), TC(''), TC(''), TC('')]),
], 14);

await t('Word tổng hợp: bảng lồng + gridBefore + dòng tiêu đề chép lặp + cột Vận dụng cao', async () => {
  const x = await makeDocx(P('MA TRẬN ĐỀ KIỂM TRA CUỐI HỌC KÌ I – MÔN TOÁN – LỚP 12', true) + synthMatrix + P('Ghi chú: mỗi ý Đúng – Sai là 1 lệnh hỏi.') + P('ĐẶC TẢ ĐỀ KIỂM TRA CUỐI KÌ I', true) + specsTbl);
  assert.deepEqual(x.tableKinds, ['matrix', 'specs']);
  assert.ok(x.specsHtml && /ĐẶC TẢ ĐỀ KIỂM TRA CUỐI KÌ I/.test(x.specsHtml), 'tách được Đặc tả dù tiêu đề không có chữ "BẢN"');
  assert.ok(/Ghi chú/.test(x.matrixHtml));
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.deepEqual(c.meta, { subject: 'Toán học', grade: '12', examType: 'Cuối kỳ 1' });
  assert.deepEqual(c.commands.I, lv(4, 2, 0, 1), 'I.5, I.6 trong bảng lồng ở cột Biết; I.7 ở cột Hiểu (không lệch cột)');
  assert.deepEqual(c.commands.II, lv(4, 2, 2));
  assert.deepEqual(c.commands.IV, lv(0, 1, 1));
  assert.deepEqual(c.questionCount, { I: 7, II: 2, III: 0, IV: 1 });
  assert.equal(c.hasVDC, true);
  assert.deepEqual(c.questionConfig.dungSaiLevelConfigs[1], { yA: 'nhan_biet', yB: 'nhan_biet', yC: 'thong_hieu', yD: 'van_dung' });
  assert.deepEqual(c.points.byType, { I: 3.5, II: 4, IV: 2.5 });
  assert.equal(c.warnings.length, 0, c.warnings.join(' | '));
  assert.equal(c.questions.I[6].unit, 'Bài 3. Tiệm cận');
  // Khung đặc tả dựng từ ma trận giữ cột VDC riêng
  const head = m.buildSpecsTheadFromContract(c);
  assert.equal(head.columnCount, 4 + 10);
  assert.ok(/Vận dụng cao/.test(head.thead));
});

await t('Cột "Tự luận" có nhưng để trống → KHÔNG tự bịa câu tự luận', async () => {
  const x = await makeDocx(P('MA TRẬN – MÔN VẬT LÍ 11. Tự luận: Không') + TBL([
    TR([TC('TT'), TC('Nội dung'), TC('Nhiều lựa chọn', { span: 3 }), TC('Tự luận', { span: 3 })]),
    TR([TC(''), TC(''), ...L.map(x => TC(x)), ...L.map(x => TC(x))]),
    TR([TC('1'), TC('Dao động điều hoà – bài toán con lắc'), TC('2'), TC('1'), TC('1'), TC(''), TC(''), TC('')]),
  ], 8));
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.equal(c.meta.subject, 'Vật lí', '"bài toán" trong nội dung không được nhận nhầm thành môn Toán');
  assert.deepEqual(c.questionCount, { I: 4, II: 0, III: 0, IV: 0 });
  assert.deepEqual(c.questionConfig.essay, lv(0, 0, 0));
});

await t('Bảng bìa / ký duyệt không phải ma trận → không ghi đè cấu hình', async () => {
  const x = await makeDocx(TBL([TR([TC('Giáo viên ra đề'), TC('Tổ trưởng duyệt')]), TR([TC('Nguyễn Văn A'), TC('Trần Thị B')])], 2));
  assert.equal(x.hasTable, true);
  assert.equal(x.hasMatrixTable, false);
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.equal(c.ok, false);
  assert.equal(c.questionConfig, null);
  assert.ok(c.warnings.length > 0);
});

await t('Ma trận Ngữ văn theo KĨ NĂNG (không có cột dạng câu): chia phần Đọc hiểu / Viết, điểm theo %', async () => {
  const x = await makeDocx(P('MA TRẬN ĐỀ KIỂM TRA CUỐI KÌ I – MÔN NGỮ VĂN LỚP 10', true) + TBL([
    TR([TC('TT', { vm: 'r' }), TC('Kĩ năng', { vm: 'r' }), TC('Nội dung/đơn vị kiến thức', { vm: 'r' }), TC('Mức độ nhận thức', { span: 4 }), TC('Tổng % điểm', { vm: 'r' })]),
    TR([TC('', { vm: 'c' }), TC('', { vm: 'c' }), TC('', { vm: 'c' }), TC('Nhận biết'), TC('Thông hiểu'), TC('Vận dụng'), TC('Vận dụng cao'), TC('', { vm: 'c' })]),
    TR([TC('1'), TC('Đọc hiểu'), TC('Thơ trữ tình'), TC('3'), TC('2'), TC('1'), TC(''), TC('40')]),
    TR([TC('2'), TC('Viết'), TC('Viết bài văn nghị luận phân tích một tác phẩm thơ'), TC(''), TC(''), TC(''), TC('1'), TC('60')]),
    TR([TC('Tổng', { span: 3 }), TC('3'), TC('2'), TC('1'), TC('1'), TC('100')]),
  ], 8));
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.equal(c.ok, true);
  assert.equal(c.meta.subject, 'Ngữ văn');
  assert.deepEqual(c.sections.map(s => [s.name, s.questions.length, s.points]), [['Đọc hiểu', 6, 4], ['Viết', 1, 6]]);
  assert.deepEqual(c.sections[1].questions.map(q => q.num), [1], 'mỗi phần đánh số lại từ Câu 1');
  assert.equal(c.sections[1].questions[0].items[0].level, 'van_dung_cao');
  const block = m.buildContractPromptBlock(c);
  assert.ok(/PHẦN I\. ĐỌC HIỂU \(4,0 điểm\): 6 câu/.test(block) && /PHẦN II\. VIẾT \(6,0 điểm\): 1 câu/.test(block), block);
  assert.ok(!/Tự luận/.test(m.buildSpecsTheadFromContract(c).thead));
});

await t('Ma trận mẫu cũ: mức độ ở TRÊN, "TNKQ | TL" ở dưới', async () => {
  const lvTop = ['Nhận biết', 'Thông hiểu', 'Vận dụng'];
  const x = await makeDocx(P('MA TRẬN KIỂM TRA GIỮA KÌ II – MÔN SINH HỌC 11', true) + TBL([
    TR([TC('TT', { vm: 'r' }), TC('Chủ đề', { vm: 'r' }), ...lvTop.map(l => TC(l, { span: 2 })), TC('Tổng', { span: 2, vm: 'r' })]),
    TR([TC('', { vm: 'c' }), TC('', { vm: 'c' }), ...lvTop.flatMap(() => [TC('TNKQ'), TC('TL')]), TC('', { span: 2, vm: 'c' })]),
    TR([TC('1'), TC('Sinh trưởng ở thực vật'), TC('4'), TC(''), TC('2'), TC('1'), TC(''), TC('1'), TC('8'), TC('')]),
    TR([TC('2'), TC('Sinh sản ở động vật'), TC('4'), TC(''), TC('2'), TC(''), TC(''), TC('1'), TC('8'), TC('')]),
    TR([TC('Tổng số câu', { span: 2 }), TC('8'), TC('0'), TC('4'), TC('1'), TC('0'), TC('2'), TC(''), TC('')]),
  ], 10));
  assert.ok(/<thead>[\s\S]*TNKQ[\s\S]*<\/thead>/.test(x.matrixHtml), 'dòng TNKQ | TL thuộc tiêu đề bảng');
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.equal(c.meta.subject, 'Sinh học');
  assert.deepEqual(c.commands.I, lv(8, 4, 0));
  assert.deepEqual(c.commands.IV, lv(0, 1, 2));
  assert.equal(c.sections, null);
  assert.equal(c.warnings.length, 0, c.warnings.join(' | '));
});

await t('Ma trận có cột phụ "Số câu | Tỉ lệ %" dưới mỗi mức độ: chỉ đếm cột Số câu', async () => {
  const lvTop = ['Nhận biết', 'Thông hiểu', 'Vận dụng'];
  const x = await makeDocx(P('MA TRẬN – MÔN NGỮ VĂN 8', true) + TBL([
    TR([TC('TT', { vm: 'r' }), TC('Kĩ năng', { vm: 'r' }), ...lvTop.map(l => TC(l, { span: 2 })), TC('Tổng %', { vm: 'r' })]),
    TR([TC('', { vm: 'c' }), TC('', { vm: 'c' }), ...lvTop.flatMap(() => [TC('Số câu'), TC('Tỉ lệ %')]), TC('', { vm: 'c' })]),
    TR([TC('1'), TC('Đọc hiểu'), TC('4'), TC('20'), TC('3'), TC('15'), TC('1'), TC('10'), TC('45')]),
    TR([TC('2'), TC('Viết'), TC(''), TC(''), TC(''), TC(''), TC('1'), TC('55'), TC('55')]),
  ], 9));
  const c = m.parseMatrixContract(x.matrixHtml);
  assert.deepEqual(c.sections.map(s => [s.name, s.questions.length, s.points]), [['Đọc hiểu', 8, 4.5], ['Viết', 1, 5.5]]);
  assert.deepEqual(c.commands.IV, lv(4, 3, 2));
});

// ---------------------------------------------------------------- đọc ô & môn học
await t('Đọc ô: mã La Mã, mã "Câu", khoảng, số lượng', () => {
  const codes = s => m.parseCellContent(s).codes.map(c => `${c.type || ''}${c.num}${c.letter || ''}`);
  assert.deepEqual(codes('I.1I.2'), ['I1', 'I2']);
  assert.deepEqual(codes('II.1aII.1b'), ['II1a', 'II1b']);
  assert.deepEqual(codes('II.3a, b'), ['II3a', 'II3b']);
  assert.deepEqual(codes('Câu 1, 2'), ['1', '2']);
  assert.deepEqual(codes('Câu 1a, 1b'), ['1a', '1b']);
  assert.deepEqual(codes('C1a,b (1)'), ['1a', '1b']);
  assert.deepEqual(codes('C7(1),'), ['7']);
  assert.deepEqual(codes('Câu 3 - 5'), ['3', '4', '5']);
  assert.equal(m.parseCellContent('1TN').count, 1);
  assert.equal(m.parseCellContent('2 câu').count, 2);
  assert.equal(m.parseCellContent('2,5').style, 'none');
});

await t('Nhận diện môn có dấu tiếng Việt (lỗi \\b cũ) & so sánh tên môn', () => {
  assert.equal(m.normalizeSubjectName('ĐỊA LÍ LỚP 11'), 'Địa lí');
  assert.equal(m.normalizeSubjectName('LỊCH SỬ'), 'Lịch sử');
  assert.equal(m.normalizeSubjectName('Hoá học'), 'Hóa học');
  assert.equal(m.normalizeSubjectName('GDKT&PL'), 'Giáo dục công dân');
  assert.equal(m.sameSubject('Toán học', 'TOÁN'), true);
  assert.equal(m.sameSubject('Toán học', 'Hóa học'), false);
});

// ---------------------------------------------------------------- kiểm tra đề sau khi sinh
const exam = (opts = {}) => `<!DOCTYPE html><html><body>
<h3>PHẦN I. TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN</h3>
<p><span class="question-number">Câu 1.</span> Hỏi 1?</p><div class="option-item">A. a</div><div class="option-item">B. b</div><div class="option-item">C. c</div>${opts.missingD ? '' : '<div class="option-item">D. d</div>'}
<p><span class="question-number">Câu 2.</span> Hỏi 2?</p><p>A. a  B. b  C. c  D. d</p>
<h3>PHẦN II. TRẮC NGHIỆM ĐÚNG SAI</h3>
<p><span class="question-number">Câu 1.</span> Cho hàm số…</p><div>a) x</div><div>b) y</div><div>c) z</div><div>d) t</div>
${opts.extraEssay ? '<h3>PHẦN IV. TỰ LUẬN</h3><p>Câu 1. Giải phương trình.</p>' : ''}
<h3>ĐÁP ÁN VÀ HƯỚNG DẪN CHẤM</h3>
<h4>PHẦN I</h4><table><tr><td>Câu 1</td><td>Câu 2</td></tr><tr><td>A</td><td>B</td></tr></table>
<h4>PHẦN II</h4><p>Câu 1: a) Đ b) S c) Đ d) S</p>
</body></html>`;
const expect = { counts: { I: 2, II: 1, III: 0, IV: 0 } };

await t('Kiểm tra đề: đề đúng cấu trúc → không lỗi', () => {
  const issues = m.validateExamHtml(exam(), expect);
  assert.equal(issues.filter(i => i.severity === 'error').length, 0, issues.map(i => i.message).join(' | '));
});

await t('Kiểm tra đề: thiếu phương án, thừa phần Tự luận, sai số câu, bị cắt cụt', () => {
  const codes = h => m.validateExamHtml(h, expect).map(i => i.code);
  assert.ok(codes(exam({ missingD: true })).includes('OPTIONS_I'));
  assert.ok(codes(exam({ extraEssay: true })).includes('EXTRA_IV'));
  assert.ok(m.validateExamHtml(exam(), { counts: { I: 3, II: 1, III: 0, IV: 0 } }).some(i => i.code === 'COUNT_I'));
  assert.ok(codes(exam() + m.TRUNCATION_MARKER).includes('TRUNCATED'));
  assert.ok(codes(exam().replace(/<h3>ĐÁP ÁN[\s\S]*$/, '</body></html>')).includes('NO_KEY'));
});

await t('Kiểm tra đề: tiêu đề kiểu "I. Trắc nghiệm nhiều lựa chọn / B. TỰ LUẬN" & chế độ không biết số câu', () => {
  const h = exam({ extraEssay: true }).replace('PHẦN I. TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN', 'I. Trắc nghiệm nhiều lựa chọn').replace('PHẦN II. TRẮC NGHIỆM ĐÚNG SAI', 'II. Câu trắc nghiệm đúng sai').replace('PHẦN IV. TỰ LUẬN', 'B. TỰ LUẬN (3,0 điểm)').replace('A. a</div>', 'A. Tự luận</div>');
  const issues = m.validateExamHtml(h, { counts: { I: 2, II: 1, III: 0, IV: 1 } });
  assert.equal(issues.filter(i => i.severity === 'error').length, 0, issues.map(i => i.message).join(' | '));
  assert.equal(m.validateExamHtml(exam({ extraEssay: true }), { counts: null }).filter(i => i.severity === 'error').length, 0);
  assert.ok(m.validateExamHtml(exam({ missingD: true }), { counts: null }).some(i => i.code === 'OPTIONS_I'));
});

await t('Kiểm tra đề Ngữ văn (Đọc hiểu / Viết) & Tiếng Anh (Part / Question / Answer key): không báo nhầm', () => {
  const van = `<html><body><h3>PHẦN I. ĐỌC HIỂU (4,0 điểm)</h3><p>Đọc văn bản sau và trả lời câu hỏi: …</p>
<p>Câu 1. Xác định thể thơ.</p><p>Câu 2. Nêu chủ đề.</p><p>Câu 3. Phân tích biện pháp tu từ.</p>
<h3>PHẦN II. VIẾT (6,0 điểm)</h3><p>Câu 1. Viết bài văn nghị luận…</p>
<h3>HƯỚNG DẪN CHẤM</h3><p>Câu 1: …</p></body></html>`;
  assert.deepEqual(m.validateExamHtml(van, { counts: null, total: 4 }).filter(i => i.severity === 'error'), []);
  assert.ok(m.validateExamHtml(van, { counts: null, total: 5 }).some(i => i.code === 'COUNT_TOTAL'));
  const en = `<html><body><h3>PART A. LISTENING</h3><p>Question 1. Choose the correct answer.</p><p>A. go B. goes C. went D. gone</p>
<h3>PART II. READING</h3><p>Question 2. What is the main idea?</p><p>A. x</p><p>B. y</p><p>C. z</p><p>D. t</p>
<h3>ANSWER KEY</h3><p>1. A 2. C</p></body></html>`;
  assert.deepEqual(m.validateExamHtml(en, { counts: { I: 2, II: 0, III: 0, IV: 0 } }).filter(i => i.severity === 'error'), []);
});

// ---------------------------------------------------------------- công thức Word (OMML → LaTeX)
await t('OMML → LaTeX: cấu trúc lồng nhau không bị cắt/mất chữ', () => {
  const r = x => `<m:r><m:t>${x}</m:t></m:r>`;
  const e = x => `<m:e>${x}</m:e>`;
  const sup = (b, s) => `<m:sSup><m:sSupPr/>${e(b)}<m:sup>${s}</m:sup></m:sSup>`;
  const frac = (n, d) => `<m:f><m:fPr/><m:num>${n}</m:num><m:den>${d}</m:den></m:f>`;
  const conv = x => m.ommlToLatex(`<m:oMath>${x}</m:oMath>`).trim();
  assert.equal(conv(sup(r('x'), sup(r('y'), r('z')))), 'x^{y^{z}}');
  assert.equal(conv(sup(`<m:d><m:dPr/>${e(r('x+1'))}</m:d>`, r('2'))), '(x+1)^{2}');
  assert.equal(conv(frac(frac(r('a'), r('b')), r('c'))), '\\frac{\\frac{a}{b}}{c}');
  assert.equal(conv(`<m:func><m:funcPr/><m:fName>${r('sin')}</m:fName>${e(r('x'))}</m:func>${r('+')}${frac(r('1'), r('2'))}`), '\\sin x+\\frac{1}{2}');
  assert.equal(conv(r('x≤2')), 'x\\le 2');
});

// ---------------------------------------------------------------- đề gốc dạng Word (Tạo đề tương tự / Sinh đề biến thể)
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const makeExamDocx = async ({ mathType = 0 } = {}) => {
  const zip = new JSZip();
  const omml = '<m:oMath><m:f><m:num><m:r><m:t>1</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:den></m:f></m:oMath>';
  const drawing = '<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const mt = '<w:r><w:object><v:shape><v:imagedata r:id="rId10"/></v:shape><o:OLEObject ProgID="Equation.DSMT4" r:id="rId11"/></w:object></w:r>';
  const body = P('ĐỀ KIỂM TRA MÔN TOÁN 10', true)
    + `<w:p><w:r><w:t xml:space="preserve">Câu 1. Tính </w:t></w:r>${omml}${'<w:r><w:t> hoặc </w:t></w:r>' + mt.repeat(mathType)}</w:p>`
    + `<w:p>${drawing}</w:p>`
    + TBL([TR([TC('x'), TC('1'), TC('2')]), TR([TC('y'), TC('3'), TC('5')])], 3)
    + P('A. 1   B. 2   C. 3   D. 4');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:m="m" xmlns:r="r"><w:body>${body}</w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="rId9" Type="image" Target="media/image1.png"/><Relationship Target="media/image2.wmf" Id="rId10" Type="image"/></Relationships>');
  zip.file('word/media/image1.png', PNG_1PX, { base64: true });
  zip.file('word/media/image2.wmf', 'x');
  return zip.generateAsync({ type: 'base64' });
};

await t('Đề gốc Word: giữ bảng, công thức → LaTeX, vị trí [HÌNH 1] + ảnh đính kèm', async () => {
  const parts = await m.prepareExamSourceParts(await makeExamDocx(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'de.docx');
  const text = parts[0].text;
  assert.ok(/\$\\frac\{1\}\{2\}\$/.test(text), 'công thức Equation chuyển sang LaTeX');
  assert.ok(/<table[\s\S]*<td>y<\/td>[\s\S]*<\/table>/.test(text), 'giữ bảng');
  assert.ok(/\[HÌNH 1\]/.test(text) && /A\. 1/.test(text));
  assert.equal(parts[1].text, '[HÌNH 1]');
  assert.equal(parts[2].inlineData.mimeType, 'image/png');
  const pdf = await m.prepareExamSourceParts('QUJD', 'application/pdf', 'de.pdf');
  assert.deepEqual(pdf, [{ inlineData: { mimeType: 'application/pdf', data: 'QUJD' } }]);
});

await t('Đề gốc Word dùng MathType (ảnh WMF) → báo rõ cách xử lý thay vì gửi đề mất công thức', async () => {
  await assert.rejects(
    m.prepareExamSourceParts(await makeExamDocx({ mathType: 3 }), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'de.docx'),
    e => /MathType/.test(e.message) && /PDF/.test(e.message)
  );
});

console.log(`\n${ok} kiểm thử đạt.`);
