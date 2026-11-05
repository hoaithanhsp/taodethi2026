// Chạy: node tests/docxMixer.test.mjs
// Kiểm thử trộn đề Word: giữ nguyên công thức/hình, đáp án đi theo nội dung, không lộ đáp án,
// và kết quả đúng định dạng các file mẫu trong "trộn đề/mẫu kết quả sau khi trộn".
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;
globalThis.XMLSerializer = XMLSerializer;

const out = await build({
  stdin: { contents: `export * from './services/docxExamMixer.ts';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error', external: ['jszip'],
});
mkdirSync(new URL('../node_modules/.cache/', import.meta.url), { recursive: true });
const cacheFile = new URL('../node_modules/.cache/docxExamMixer.mjs', import.meta.url);
writeFileSync(cacheFile, out.outputFiles[0].text);
const m = await import(cacheFile.href);

let ok = 0;
const t = async (name, fn) => { await fn(); ok++; console.log('✓', name); };

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const R = (text, rPr = '') => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const TAB = '<w:r><w:tab/></w:r>';
const P = (...runs) => `<w:p>${runs.join('')}</w:p>`;
const OBJ = (id, w = 40) => `<w:r><w:object w:dxaOrig="800" w:dyaOrig="300"><v:shape id="s${id}" style="width:${w}pt;height:15pt" o:ole=""><v:imagedata r:id="rIdI${id}" o:title=""/></v:shape><o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="s${id}" DrawAspect="Content" ObjectID="_${id}" r:id="rIdE${id}"/></w:object></w:r>`;
const OMATH = tx => `<m:oMath><m:r><m:t>${tx}</m:t></m:r></m:oMath>`;
const IMG = id => `<w:r><w:drawing><wp:inline><wp:extent cx="1270000" cy="635000"/><wp:docPr id="${id}" name="Pic${id}"/><a:graphic><a:graphicData uri="x"><pic:pic><pic:blipFill><a:blip r:embed="rIdP${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const U = '<w:u w:val="single"/>';
const SECT = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="1134" w:header="284" w:footer="567" w:gutter="0"/></w:sectPr>';

const makeDocx = async body => {
  const zip = new JSZip();
  const ids = [...body.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map(x => x[1]);
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${SECT}</w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[...new Set(ids)].map(i => `<Relationship Id="${i}" Type="x" Target="media/${i}"/>`).join('')}</Relationships>`);
  return zip.generateAsync({ type: 'uint8array' });
};

const SETTINGS = { count: 6, startCode: 101, shuffleQuestions: true, shuffleOptions: true, shuffleStatements: true, keepTogether: true, normalizeFormat: true, seed: 2026 };

const readXml = async blob => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return { zip, xml: await zip.file('word/document.xml').async('string') };
};
const plain = xml => xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');

const mixedBody = [
  P(R('SỞ GD&ĐT THỬ NGHIỆM')),
  P(R('Mã đề thi: 000')),
  P(R('PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn. Thí sinh trả lời từ câu 1 đến câu 6.', '<w:b/>')),
  // Mỗi phương án một dòng, đáp án gạch chân
  P(R('Câu 1. ', '<w:b/>'), R('Công thức '), OBJ(1), R(' đúng là')),
  P(R('A. ', '<w:b/>'), OBJ(2), R('.')),
  P(R('B. ', `<w:b/>${U}`), OBJ(3), R('.')),
  P(R('C. ', '<w:b/>'), OBJ(4), R('.')),
  P(R('D. ', '<w:b/>'), OBJ(5), R('.')),
  // Cùng một dòng, nhãn bị tách run, Word Equation, đáp án tô đỏ
  P(R('Câ'), R('u 2'), R(': Giá trị là')),
  P(R('A'), R('. '), OMATH('x+1'), TAB, R('B. '), OMATH('x+2'), TAB, R('C. ', '<w:color w:val="FF0000"/>'), OMATH('x+3'), TAB, R('D. '), OMATH('x+4')),
  // Phương án trong bảng, có hình; đáp án ghi ở bảng cuối
  P(R('Câu 3. Hình nào đúng?'), IMG(1)),
  `<w:tbl><w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc>${P(R('A. Hình một'))}</w:tc><w:tc>${P(R('B. Hình hai'))}</w:tc></w:tr><w:tr><w:tc>${P(R('C. Hình ba'))}</w:tc><w:tc>${P(R('D. Hình bốn'))}</w:tc></w:tr></w:tbl>`,
  // Không được đảo phương án
  P(R('Câu 4. Phát biểu đúng là')),
  P(R('A. Thứ nhất.')), P(R('B. Thứ hai.')), P(R('C. Thứ ba.')), P(R('D. Cả A và B.')),
  // Dữ kiện dùng chung
  P(R('Dựa vào thông tin sau để trả lời câu 5 và câu 6: Một vật rơi tự do.')),
  P(R('Câu 5. Gia tốc là')),
  P(R('A. a5.')), P(R('B. b5.')), P(R('C. c5.')), P(R('D. d5.')),
  P(R('Lời giải')),
  P(R('Chọn C')),
  P(R('Câu 6. Vận tốc là')),
  P(R('A. a6.')), P(R('B. b6.')), P(R('C. c6.')), P(R('D. d6.')),
  P(R('PHẦN II. Câu trắc nghiệm đúng sai.', '<w:b/>')),
  P(R('Câu 1. Cho hàm số. Xét các ý sau:')),
  P(R('a) ', U), R('Ý một.')), P(R('b) '), R('Ý hai.')), P(R('c) ', U), R('Ý ba.')), P(R('d) '), R('Ý bốn.')),
  P(R('Câu 2. Cho dãy số.')),
  P(R('a) P.')), P(R('b) Q.')), P(R('c) R.')), P(R('d) Từ ý a suy ra S.')),
  P(R('PHẦN III. Câu trắc nghiệm trả lời ngắn.', '<w:b/>')),
  P(R('Câu 1. Bài ngắn thứ nhất.')),
  P(R('Câu 2. Bài ngắn thứ hai.')),
  P(R('Câu 3. Bài ngắn thứ ba.')),
  P(R('PHẦN IV. TỰ LUẬN', '<w:b/>')),
  P(R('Câu 1: Bài tự luận một.')),
  P(R('a) Ý nhỏ.')),
  P(R('Câu 2: Bài tự luận hai.')),
  P(R('---------- HẾT ----------')),
  P(R('BẢNG ĐÁP ÁN')),
  `<w:tbl><w:tr><w:tc>${P(R('Câu'))}</w:tc><w:tc>${P(R('3'))}</w:tc><w:tc>${P(R('4'))}</w:tc><w:tc>${P(R('6'))}</w:tc></w:tr><w:tr><w:tc>${P(R('Đáp án'))}</w:tc><w:tc>${P(R('D'))}</w:tc><w:tc>${P(R('D'))}</w:tc><w:tc>${P(R('A'))}</w:tc></w:tr></w:tbl>`,
].join('');

const doc = await m.loadDocxExam(await makeDocx(mixedBody), 'de.docx');
const ov = m.defaultOverrides(doc);
const byNum = (part, num) => doc.questions.find(q => q.part === part && q.num === num);

await t('nhận diện phần, dạng câu và thống kê công thức/hình', () => {
  assert.equal(doc.parts.length, 4);
  assert.equal(doc.questions.length, 13);
  assert.deepEqual(doc.questions.map(q => q.kind).join(','), 'mc,mc,mc,mc,mc,mc,tf,tf,short,short,short,essay,essay');
  assert.equal(doc.stats.objects, 5);
  assert.equal(doc.stats.equations, 4);
  assert.equal(doc.stats.images, 1);
});

await t('đọc đáp án từ gạch chân, màu chữ, bảng cuối, lời giải và đáp án Đ/S', () => {
  assert.equal(byNum(0, 1).answer, 'B');
  assert.equal(byNum(0, 1).answerSource, 'mark');
  assert.equal(byNum(0, 2).answer, 'C');
  assert.equal(byNum(0, 3).answer, 'D');
  assert.equal(byNum(0, 3).answerSource, 'key');
  assert.equal(byNum(0, 5).answer, 'C');
  assert.equal(byNum(0, 5).answerSource, 'solution');
  assert.equal(byNum(1, 1).answer, 'ĐSĐS');
  assert.equal(m.missingMixAnswers(doc, ov).filter(q => q.part === 0).length, 0);
});

await t('tự khóa "Cả A và B", ý nhắc ý khác và nhóm dùng chung dữ kiện', () => {
  assert.equal(byNum(0, 4).lockOptions, true);
  assert.equal(byNum(1, 2).lockOptions, true);
  assert.equal(byNum(0, 5).group, byNum(0, 6).group);
  assert.notEqual(byNum(0, 5).group, null);
  assert.equal(ov.linkNext[byNum(0, 5).id], true);
});

const plans = m.planVersions(doc, SETTINGS, ov);
const built = [];
for (const p of plans) built.push(await m.buildVersion(doc, p, SETTINGS));

await t('mọi mã đề qua được bước tự kiểm tra đối chiếu đề gốc', () => {
  built.forEach(b => assert.deepEqual(b.problems, [], `mã ${b.plan.code}`));
  assert.equal(new Set(plans.map(p => JSON.stringify(p.questions.map(q => [q.id, q.perm])))).size, 6);
});

await t('đáp án mới đi theo nội dung phương án', () => {
  for (const b of built) {
    const q = b.plan.questions.find(x => x.id === byNum(0, 1).id);
    const orig = 'ABCD'.indexOf('B');
    assert.equal('ABCD'[q.perm ? q.perm.indexOf(orig) : orig], q.answer);
  }
});

await t('giữ nguyên MathType, Word Equation, hình và liên kết rId', async () => {
  for (const b of built) {
    const { xml } = await readXml(b.blob);
    for (let i = 1; i <= 5; i++) {
      assert.equal(xml.split(`r:id="rIdE${i}"`).length, 2, `đối tượng ${i}`);
      assert.equal(xml.split(`r:id="rIdI${i}"`).length, 2, `ảnh công thức ${i}`);
    }
    assert.equal(xml.split('<m:oMath>').length - 1, 4);
    assert.equal(xml.split('r:embed="rIdP1"').length, 2);
  }
});

await t('đề học sinh không còn đáp án, lời giải, dấu đánh dấu; mã đề đã đổi', async () => {
  for (const b of built) {
    const { xml } = await readXml(b.blob);
    const text = plain(xml);
    assert.ok(!/BẢNG ĐÁP ÁN/.test(text));
    assert.ok(!/Lời giải|Chọn C/.test(text));
    assert.ok(!xml.includes('w:u '), 'không còn gạch chân');
    assert.ok(!xml.includes('FF0000'), 'không còn tô đỏ');
    assert.ok(text.includes(`Mã đề thi: ${b.plan.code}`));
    assert.ok(!text.includes('000'));
  }
});

await t('nhóm câu đi liền nhau, số câu trong dữ kiện được đánh lại', async () => {
  for (const b of built) {
    const ids = b.plan.questions.filter(q => q.part === 0).map(q => q.id);
    const a = ids.indexOf(byNum(0, 5).id);
    const c = ids.indexOf(byNum(0, 6).id);
    assert.equal(c, a + 1);
    const { xml } = await readXml(b.blob);
    assert.ok(plain(xml).includes(`trả lời câu ${a + 1} và câu ${a + 2}:`), `mã ${b.plan.code}`);
  }
});

await t('chỉ đảo trong cùng phần; tự luận giữ nguyên; số câu theo vị trí', () => {
  for (const p of plans) {
    assert.deepEqual(p.questions.filter(q => q.part === 0).map(q => q.newNum), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(p.questions.filter(q => q.part === 3).map(q => q.origNum), [1, 2]);
    assert.equal(p.questions.find(q => q.id === byNum(0, 4).id).perm, null);
  }
});

await t('cùng hạt giống cho kết quả giống hệt, khác hạt giống thì khác', () => {
  const again = m.planVersions(doc, SETTINGS, ov);
  assert.deepEqual(again, plans);
  const other = m.planVersions(doc, { ...SETTINGS, seed: 7 }, ov);
  assert.notDeepEqual(other, plans);
});

await t('giáo viên có thể khóa câu và ghép nhóm tay', () => {
  const ov2 = { ...m.defaultOverrides(doc) };
  ov2.pinned = { ...ov2.pinned, [byNum(0, 2).id]: true };
  ov2.linkNext = { ...ov2.linkNext, [byNum(2, 1).id]: true };
  for (const p of m.planVersions(doc, SETTINGS, ov2)) {
    assert.equal(p.questions.filter(q => q.part === 0)[1].id, byNum(0, 2).id);
    const ids = p.questions.filter(q => q.part === 2).map(q => q.id);
    assert.equal(ids.indexOf(byNum(2, 2).id), ids.indexOf(byNum(2, 1).id) + 1);
  }
});

await t('tắt chuẩn hóa: vẫn đảo đúng và giữ bố cục gốc', async () => {
  const s = { ...SETTINGS, normalizeFormat: false, count: 2 };
  for (const p of m.planVersions(doc, s, ov)) {
    const b = await m.buildVersion(doc, p, s);
    assert.deepEqual(b.problems, []);
    assert.ok((await readXml(b.blob)).xml.includes('<w:tbl>'));
  }
});

await t('báo lỗi rõ khi không có câu hỏi hoặc câu hỏi nằm trong bảng', async () => {
  await assert.rejects(m.loadDocxExam(await makeDocx(P(R('Một văn bản thường.'))), 'x.docx'), /Không tìm thấy câu hỏi/);
  await assert.rejects(m.loadDocxExam(await makeDocx(`<w:tbl><w:tr><w:tc>${P(R('Câu 1. Trong bảng'))}</w:tc></w:tr></w:tbl>`), 'x.docx'), /nằm trong bảng/);
  await assert.rejects(m.loadDocxExam(new Uint8Array([1, 2, 3]), 'x.docx'), /Không mở được file/);
});

await t('file Word bị hỏng: báo lỗi tiếng Việt dễ hiểu, không hiện lỗi kỹ thuật', async () => {
  const good = await makeDocx(P(R('Câu 1. Hỏi')) + P(R('A. a')) + P(R('B. b')) + P(R('C. c')) + P(R('D. d')));
  const at = Buffer.from(good).indexOf('Câu 1');
  assert.ok(at > 0);
  const bad = Uint8Array.from(good);
  bad[at] ^= 0xff;
  await assert.rejects(m.loadDocxExam(bad, 'hong.docx'), err => {
    assert.match(err.message, /bị hỏng hoặc chưa tải về đầy đủ/);
    assert.doesNotMatch(err.message, /Bug|CRC|mismatch/);
    return true;
  });
  await m.loadDocxExam(good, 'tot.docx');
});

await t('thêm chân trang và dòng HẾT như mẫu khi đề gốc chưa có', async () => {
  const d = await m.loadDocxExam(await makeDocx(P(R('Câu 1. Hỏi')) + P(R('A. a')) + P(R('B. b')) + P(R('C. c')) + P(R('D. d'))), 'n.docx');
  const [p] = m.planVersions(d, { ...SETTINGS, count: 1 }, m.defaultOverrides(d));
  const b = await m.buildVersion(d, p, { ...SETTINGS, count: 1 });
  assert.deepEqual(b.problems, []);
  const { zip, xml } = await readXml(b.blob);
  assert.ok(plain(xml).includes('HẾT'));
  assert.ok(plain(xml).includes('Mã đề: 101'));
  assert.ok(xml.includes('<w:footerReference'));
  assert.ok((await zip.file('word/footerMix.xml').async('string')).includes('Mã đề 101'));
  assert.ok((await zip.file('[Content_Types].xml').async('string')).includes('footerMix'));
  assert.ok((await zip.file('word/_rels/document.xml.rels').async('string')).includes('rIdMixFooter'));
});

await t('đề thật: dấu chỉ đặt trên chữ cái của nhãn vẫn đọc được và bị xóa khỏi đề', async () => {
  const red = '<w:b/><w:color w:val="FF0000"/>';
  const line = (mark, letter) => (letter === mark ? R(letter, red) : R(letter, '<w:b/>'));
  const body = ['A', 'B', 'C', 'D'].flatMap((ans, i) => [
    P(R(`Câu ${i + 1}. Hỏi ${ans}`)),
    P(line(ans, 'A'), R('. ', '<w:b/>'), R('1'), TAB, line(ans, 'B'), R('. ', '<w:b/>'), R('2'), TAB, line(ans, 'C'), R('. ', '<w:b/>'), R('3'), TAB, line(ans, 'D'), R('. ', '<w:b/>'), R('4')),
  ]).join('') + P(R('PHẦN II. Câu trắc nghiệm đúng sai.')) + P(R('Câu 1. Xét')) + P(R('a', U), R(') P')) + P(R('b) Q')) + P(R('c', U), R(') R')) + P(R('d) S'));
  const d = await m.loadDocxExam(await makeDocx(body), 'mau.docx');
  assert.deepEqual(d.questions.map(q => q.answer), ['A', 'B', 'C', 'D', 'ĐSĐS']);
  const [p] = m.planVersions(d, { ...SETTINGS, count: 1 }, m.defaultOverrides(d));
  const b = await m.buildVersion(d, p, { ...SETTINGS, count: 1 });
  assert.deepEqual(b.problems, []);
  const { xml } = await readXml(b.blob);
  assert.ok(!xml.includes('FF0000') && !xml.includes('w:u '));
});

await t('đề thật: mẫu TN MIX ghi đáp án trả lời ngắn dạng "A. 22,4" và không đưa vào đề', async () => {
  const body = P(R('PHẦN III. Câu trắc nghiệm trả lời ngắn.')) + P(R('Câu 1. Tính x.')) + P(R('A. 22,4')) + P(R('Câu 2. Tính y.')) + P(R('A. -6,5'));
  const d = await m.loadDocxExam(await makeDocx(body), 'mau.docx');
  assert.deepEqual(d.questions.map(q => q.answer), ['22,4', '-6,5']);
  const [p] = m.planVersions(d, { ...SETTINGS, count: 1 }, m.defaultOverrides(d));
  const b = await m.buildVersion(d, p, { ...SETTINGS, count: 1 });
  assert.deepEqual(b.problems, []);
  const text = plain((await readXml(b.blob)).xml);
  assert.ok(!text.includes('22,4') && !text.includes('-6,5'));
});

await t('đề thật: "tập hợp tất cả các phần tử" không bị khóa nhầm; "Tất cả đều đúng" thì khóa', async () => {
  const opts = (d) => P(R('A. tập hợp tất cả các phần tử.')) + P(R('B. b.')) + P(R('C. c.')) + P(R(`D. ${d}`));
  const body = P(R('Câu 1. Hỏi')) + opts('d.') + P(R('Câu 2. Hỏi')) + opts('Tất cả đều đúng.');
  const d = await m.loadDocxExam(await makeDocx(body), 'mau.docx');
  assert.equal(d.questions[0].lockOptions, false);
  assert.equal(d.questions[1].lockOptions, true);
});

await t('đề thật: file gộp nhiều đề, số câu đánh lại từ 1 thì không trộn lẫn', async () => {
  const q = n => P(R(`Câu ${n}. Hỏi ${n}`)) + P(R('A. a')) + P(R('B. b')) + P(R('C. c')) + P(R('D. d'));
  const d = await m.loadDocxExam(await makeDocx(q(1) + q(2) + q(3) + q(1) + q(2)), 'mau.docx');
  assert.equal(d.parts.length, 2);
  for (const p of m.planVersions(d, SETTINGS, m.defaultOverrides(d))) {
    const b = await m.buildVersion(d, p, SETTINGS);
    assert.deepEqual(b.problems, []);
    assert.deepEqual(p.questions.filter(x => x.part === 0).map(x => x.origNum).sort(), [1, 2, 3]);
  }
});

await t('đề thật: hình neo trước chữ "Câu" đi theo câu và không báo lỗi giả', async () => {
  const q = n => P(IMG(n), R(`Câu ${n}. Hỏi ${n}`)) + P(R('A. a')) + P(R('B. b')) + P(R('C. c')) + P(R('D. d'));
  const d = await m.loadDocxExam(await makeDocx(q(1) + q(2) + q(3)), 'mau.docx');
  for (const p of m.planVersions(d, SETTINGS, m.defaultOverrides(d))) {
    const b = await m.buildVersion(d, p, SETTINGS);
    assert.deepEqual(b.problems, []);
    const xml = (await readXml(b.blob)).xml;
    p.questions.forEach(x => assert.ok(new RegExp(`r:embed="rIdP${x.origNum}"(?:(?!</w:p>).)*Câu ${x.newNum}\\.`, 's').test(xml), `hình câu ${x.origNum}`));
  }
});

await t('đề thật: phương án chỉ có công thức không bị coi là đáp án; tô đỏ giữa màu xanh vẫn được xóa', async () => {
  const blue = '<w:color w:val="0000FF"/>';
  const d1 = await m.loadDocxExam(await makeDocx(P(R('Câu 1. Hỏi')) + P(R('A. '), OBJ(1), R('.', blue)) + P(R('B. '), OBJ(2), R('.', blue)) + P(R('C. '), OBJ(3), R('.', blue)) + P(R('D. '), OBJ(4))), 'a.docx');
  assert.equal(d1.questions[0].answer, '');
  const d2 = await m.loadDocxExam(await makeDocx(P(R('Câu 1. Hỏi')) + P(R('A. một', blue)) + P(R('B. hai', blue)) + P(R('C. ba', '<w:color w:val="FF0000"/>')) + P(R('D. bốn', blue))), 'b.docx');
  assert.equal(d2.questions[0].answer, 'C');
  const [p] = m.planVersions(d2, { ...SETTINGS, count: 1 }, m.defaultOverrides(d2));
  const b = await m.buildVersion(d2, p, { ...SETTINGS, count: 1 });
  assert.deepEqual(b.problems, []);
  assert.ok(!(await readXml(b.blob)).xml.includes('FF0000'));
});

await t('thông tin khai báo: dựng tiêu đề theo mẫu, thay tiêu đề gốc; để trống thì giữ nguyên', async () => {
  const info = { department: 'SỞ GD-ĐT THÁI BÌNH', school: 'TRƯỜNG THPT HƯNG NHÂN', examName: 'KỲ THI TUYỂN SINH LỚP 10', schoolYear: '2024 - 2025', subject: 'Toán', duration: '60' };
  const s = { ...SETTINGS, count: 2, examInfo: info };
  const ps = m.planVersions(doc, s, ov);
  for (const p of ps) {
    const b = await m.buildVersion(doc, p, s);
    assert.deepEqual(b.problems, []);
    const { xml } = await readXml(b.blob);
    const text = plain(xml);
    for (const v of ['SỞ GD-ĐT THÁI BÌNH', 'TRƯỜNG THPT HƯNG NHÂN', 'KỲ THI TUYỂN SINH LỚP 10', 'NĂM HỌC: 2024 - 2025', 'MÔN: Toán', 'Thời gian làm bài: 60 phút', '(không kể thời gian phát đề)', 'Họ và tên:', 'Số báo danh:', `Mã đề ${p.code}`]) {
      assert.ok(text.includes(v), v);
    }
    assert.ok(!text.includes('SỞ GD&amp;ĐT THỬ NGHIỆM'), 'đã thay tiêu đề gốc');
    assert.ok(xml.indexOf('SỞ GD-ĐT THÁI BÌNH') < xml.indexOf('PHẦN I.'), 'tiêu đề ở đầu đề');
    assert.ok(/w:dirty="true"/.test(xml) && xml.includes('NUMPAGES'), 'số trang tự tính lại');
  }
  const partial = { ...SETTINGS, count: 1, examInfo: { department: '', school: 'A & B <THPT>', examName: '', schoolYear: '', subject: '', duration: '45 phút' } };
  const [pp] = m.planVersions(doc, partial, ov);
  const bp = await m.buildVersion(doc, pp, partial);
  assert.deepEqual(bp.problems, []);
  const partialXml = (await readXml(bp.blob)).xml;
  assert.ok(partialXml.includes('A &amp; B &lt;THPT&gt;'), 'thoát ký tự đặc biệt');
  assert.ok(plain(partialXml).includes('Thời gian làm bài: 45 phút'));
  const blank = { ...SETTINGS, count: 1, examInfo: { department: ' ', school: '', examName: '', schoolYear: '', subject: '', duration: '' } };
  const [pb] = m.planVersions(doc, blank, ov);
  const kept = plain((await readXml((await m.buildVersion(doc, pb, blank)).blob)).xml);
  assert.ok(kept.includes('SỞ GD&amp;ĐT THỬ NGHIỆM') && !kept.includes('Họ và tên:'), 'để trống thì giữ tiêu đề gốc');
});

await t('đề giáo viên soạn: số câu tự động, dán từ web, lề khác mẫu vẫn chuẩn hóa được', async () => {
  const numbering = `<?xml version="1.0"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Câu %1:"/><w:pPr><w:ind w:left="992" w:hanging="992"/></w:pPr><w:rPr><w:b/><w:color w:val="0000FF"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const stem = text => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr><w:divId w:val="735"/></w:pPr>${R(text)}</w:p>`;
  const opts = n => P(R(`A. a${n}`), TAB, R(`B. b${n}`)) + P(R(`C. c${n}`), TAB, R(`D. d${n}`));
  const head = `<w:tbl><w:tr><w:tc>${P(R('SỞ GD&ĐT HẢI PHÒNG'))}${P(R('TRƯỜNG THPT THỬ'))}${P(R('(Đề gồm 3 trang)'))}</w:tc><w:tc>${P(R('ĐỀ KIỂM TRA GIỮA HKI NĂM HỌC 2026 – 2027'))}${P(R('Môn: Toán – Khối 11'))}${P(R('Thời gian làm bài: 90 phút, không kể giao đề'))}${P(R('ĐỀ GỐC'))}</w:tc></w:tr></w:tbl>`;
  const body = head + P(R('PHẦN I. Câu trắc nghiệm nhiều phương án lựa chọn.')) + stem('Hỏi một') + opts(1) + stem('Hỏi hai') + opts(2) + stem('Hỏi ba') + opts(3)
    + P(R('HƯỚNG DẪN CHẤM VÀ ĐÁP ÁN')) + `<w:tbl><w:tr><w:tc>${P(R('Câu'))}</w:tc><w:tc>${P(R('1'))}</w:tc><w:tc>${P(R('2'))}</w:tc><w:tc>${P(R('3'))}</w:tc></w:tr><w:tr><w:tc>${P(R('Đáp án'))}</w:tc><w:tc>${P(R('B'))}</w:tc><w:tc>${P(R('C'))}</w:tc><w:tc>${P(R('D'))}</w:tc></w:tr></w:tbl>`;
  const raw = await JSZip.loadAsync(await makeDocx(body));
  raw.file('word/numbering.xml', numbering);
  raw.file('word/document.xml', (await raw.file('word/document.xml').async('string')).replace('w:right="567"', 'w:right="849"').replace('w:top="567"', 'w:top="1134"'));
  const bytes = await raw.generateAsync({ type: 'uint8array' });
  const d = await m.loadDocxExam(bytes, 'gv.docx');
  assert.deepEqual(d.questions.map(q => [q.num, q.kind, q.answer]), [[1, 'mc', 'B'], [2, 'mc', 'C'], [3, 'mc', 'D']]);
  assert.deepEqual(d.detectedInfo, { department: 'SỞ GD&ĐT HẢI PHÒNG', school: 'TRƯỜNG THPT THỬ', examName: 'ĐỀ KIỂM TRA GIỮA HKI', schoolYear: '2026 - 2027', subject: 'Toán – Khối 11', duration: '90 phút' });
  const s = { ...SETTINGS, count: 3 };
  for (const p of m.planVersions(d, s, m.defaultOverrides(d))) {
    const b = await m.buildVersion(d, p, s);
    assert.deepEqual(b.problems, [], `mã ${p.code}`);
    const { xml } = await readXml(b.blob);
    const text = plain(xml);
    assert.ok(!xml.includes('<w:numPr>'), 'đã bỏ số tự động');
    assert.ok(!xml.includes('w:divId'), 'đã bỏ định dạng web');
    assert.ok(xml.includes('w:top="567"') && xml.includes('w:right="567"') && xml.includes('w:left="1134"'), 'lề theo mẫu');
    p.questions.forEach(q => assert.ok(text.includes(`Câu ${q.newNum}. Hỏi ${['một', 'hai', 'ba'][q.origNum - 1]}`), `câu ${q.newNum}`));
    assert.ok(!text.includes('HƯỚNG DẪN CHẤM'));
  }
  const off = { ...SETTINGS, count: 1, normalizeFormat: false };
  const [po] = m.planVersions(d, off, m.defaultOverrides(d));
  const bo = await m.buildVersion(d, po, off);
  assert.deepEqual(bo.problems, []);
  assert.ok((await readXml(bo.blob)).xml.includes('<w:numPr>'), 'tắt chuẩn hóa thì giữ số tự động');
});

await t('file mẫu tải về: trộn được ngay, không in hướng dẫn vào đề, không lộ thông tin ẩn', async () => {
  const bytes = readFileSync(new URL('../public/templates/Mau_de_tron_de.docx', import.meta.url));
  const meta = await JSZip.loadAsync(bytes);
  const core = await meta.file('docProps/core.xml').async('string');
  assert.ok(!/falundafa|<dc:creator>[^<]+|<cp:lastModifiedBy>[^<]+/.test(core), 'không còn thông tin tác giả');
  const d = await m.loadDocxExam(bytes, 'mau.docx');
  assert.deepEqual(d.questions.map(q => q.answer), ['A', 'B', 'C', 'D', 'ĐSSĐ', 'SĐSĐ', '22,4', '-6,5', '2025', '-86']);
  assert.ok(d.questions.every(q => !q.pinned && !q.warnings.length), 'không khóa nhầm câu');
  const s = { ...SETTINGS, count: 2 };
  for (const p of m.planVersions(d, s, m.defaultOverrides(d))) {
    const b = await m.buildVersion(d, p, s);
    assert.deepEqual(b.problems, []);
    const text = plain((await readXml(b.blob)).xml);
    for (const leak of ['Đáp án đúng PHẦN I', 'Nhận định đúng ở PHẦN II', '(Các câu hỏi phần', '22,4', '-86']) assert.ok(!text.includes(leak), leak);
    assert.equal(text.split('PHẦN I.').length, 2, 'chỉ còn 1 tiêu đề PHẦN I');
  }
});

await t('phần không ghi "Câu" và không lặp lại vẫn được giữ trong đề', async () => {
  const q = P(R('Câu 1. Hỏi')) + P(R('A. a')) + P(R('B. b')) + P(R('C. c')) + P(R('D. d'));
  const d = await m.loadDocxExam(await makeDocx(P(R('PHẦN I. Trắc nghiệm')) + q + P(R('PHẦN IV. TỰ LUẬN')) + P(R('Chứng minh rằng tổng ba góc bằng 180 độ.'))), 'tl.docx');
  const s = { ...SETTINGS, count: 1 };
  const [p] = m.planVersions(d, s, m.defaultOverrides(d));
  const text = plain((await readXml((await m.buildVersion(d, p, s)).blob)).xml);
  assert.ok(text.includes('Chứng minh rằng tổng ba góc') && text.includes('PHẦN IV'));
});

/* ------------------- Đề Tiếng Anh: nhóm, thẻ, số câu liên tục ------------------- */
const EN = { ...SETTINGS, count: 4, startCode: 8385, shuffleGroups: true };
const inlineQ = (n, opts) => P(R(`Question ${n}. `, '<w:b/>'), R('A. ' + opts[0]), TAB, R('B. ' + opts[1]), TAB, R('C. ' + opts[2]), TAB, R('D. ' + opts[3]));
const stemQ = (n, stem) => P(R(`Question ${n}. ${stem}`)) + P(R('A. a' + n)) + P(R('B. b' + n)) + P(R('C. c' + n)) + P(R('D. d' + n));

await t('Tiếng Anh: đọc thẻ nhóm, mức trộn đúng, thẻ không còn trong đề', async () => {
  const body = P(R('<g3> ')) + P(R('Mark the letter A, B, C or D to indicate the word.')) + inlineQ(1, ['plants', 'fields', 'gardens', 'papers']) + inlineQ(2, ['one', 'two', 'three', 'four'])
    + P(R('<g2>')) + P(R('Read the passage and choose for blanks from ###s to ###e.')) + P(R('The city (####) ____ and (####) ____ there.')) + inlineQ(3, ['as', 'for', 'with', 'to']) + inlineQ(4, ['in', 'on', 'at', 'by'])
    + P(R('<g1>')) + stemQ(5, 'Cau nam') + stemQ(6, 'Cau sau')
    + P(R('<#g0>')) + P(R('Four sentences removed from the text. Mark the letter on your answer sheet.')) + P(R('Text (7) ____ here (8) ____.')) + P(R('A. first')) + P(R('B. second')) + P(R('C. third')) + P(R('D. fourth')) + P(R('Question 7. A')) + P(R('Question 8. B'));
  const d = await m.loadDocxExam(await makeDocx(body), 'en.docx', 'english');
  assert.deepEqual(d.parts.map(p => [p.level, p.fixed, p.tagged]), [[3, false, true], [2, false, true], [1, false, true], [0, true, true]]);
  assert.deepEqual(d.parts.map(p => d.questions.filter(q => q.part === p.index).length), [2, 2, 2, 2]);
  const ov2 = m.defaultOverrides(d);
  assert.deepEqual(d.questions.slice(6).map(q => [q.kind, q.lockOptions, q.answer]), [['mc', true, ''], ['mc', true, '']], 'câu tô phiếu không lấy chữ cái làm đáp án');
  const orders = new Set();
  for (const p of m.planVersions(d, EN, ov2)) {
    const b = await m.buildVersion(d, p, EN);
    assert.deepEqual(b.problems, [], `mã ${p.code}`);
    assert.deepEqual(p.questions.map(q => q.newNum), [1, 2, 3, 4, 5, 6, 7, 8], 'số câu liên tục toàn đề');
    assert.equal(p.partOrder[3], 3, 'nhóm có # đứng yên');
    orders.add(p.partOrder.join());
    const g2 = p.questions.filter(q => q.part === 1);
    assert.deepEqual(g2.map(q => q.origNum), [3, 4], 'g2 giữ thứ tự câu');
    assert.ok(g2.every(q => q.perm), 'g2 đảo phương án');
    assert.ok(p.questions.filter(q => q.part === 2).every(q => !q.perm), 'g1 không đảo phương án');
    assert.deepEqual(p.questions.filter(q => q.part === 3).map(q => q.origNum), [7, 8], 'g0 giữ nguyên');
    const text = plain((await readXml(b.blob)).xml);
    assert.ok(!/<#?g\d|###/.test(text.replace(/&lt;/g, '<')), 'không còn thẻ và ###');
    const [s0, s1] = g2.map(q => q.newNum);
    assert.ok(text.includes(`for blanks from ${s0} to ${s1}.`), 'thay ###s ###e');
    assert.ok(text.includes(`The city (${s0}) ____ and (${s1}) ____ there.`), 'thay (####)');
    assert.ok(text.includes('Question 7. A') && text.includes('Question 8. B'));
    assert.ok(text.includes('THE END'));
  }
  assert.ok(orders.size > 1, 'nhóm không có # đổi chỗ giữa các mã đề');
  const off = { ...EN, shuffleGroups: false, count: 1 };
  assert.deepEqual(m.planVersions(d, off, ov2)[0].partOrder, [0, 1, 2, 3], 'tắt đảo nhóm');
});

await t('Tiếng Anh: gạch chân phát âm giữ nguyên, chỉ bỏ màu đáp án; A, C / B, D theo cột', async () => {
  const red = '<w:color w:val="FF0000"/>';
  const list = `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="37"/></w:numPr></w:pPr>`;
  const body = P(R('<g3>')) + P(R('Question 1. A. pl'), R('a', U), R('nts'), TAB, R('B. ', red), R('f', red), R('ie', `${red}${U}`), R('lds', red), TAB, R('C. g'), R('a', U), R('rdens'), TAB, R('D. n'), R('e', U), R('ws'))
    + P(R('Question 2. Tom asks a question.')) + `<w:p>${list}${R('Yes, I could.')}${TAB}${R('C. ', red)}${R('Sure, press it.', red)}</w:p>` + `<w:p>${list}${R('No, I could not.')}${TAB}${R('D. No washing machine.')}</w:p>`;
  const raw = await JSZip.loadAsync(await makeDocx(body));
  raw.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="37"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
  const d = await m.loadDocxExam(await raw.generateAsync({ type: 'uint8array' }), 'en.docx', 'english');
  assert.deepEqual(d.questions.map(q => q.answer), ['B', 'C']);
  assert.deepEqual(d.questions[1].optionPreviews, ['Yes, I could.', 'No, I could not.', 'Sure, press it.', 'No washing machine.']);
  for (const p of m.planVersions(d, EN, m.defaultOverrides(d))) {
    const b = await m.buildVersion(d, p, EN);
    assert.deepEqual(b.problems, []);
    const { xml } = await readXml(b.blob);
    assert.ok(!xml.includes('FF0000'), 'bỏ màu đáp án');
    assert.equal(xml.split('w:u w:val="single"').length - 1, 4, 'giữ gạch chân phần phát âm');
    assert.ok(!xml.includes('<w:numPr>'));
  }
});

await t('Tiếng Anh: đề không có thẻ tự chia nhóm; True/False 2 phương án; nhập nhanh đáp án', async () => {
  const body = P(R('Listen to a talk and decide whether the statements are true or false.')) + P(R('Question 1. Emily is a writer.')) + P(R('A. True'), TAB, R('B. False')) + P(R('Question 2. She lives abroad.')) + P(R('A. True'), TAB, R('B. False'))
    + P(R('Read the following leaflet and mark the letter on your answer sheet to indicate the option that best fits each of the numbered blanks.')) + P(R('Join (3)___ and (4)___ now.')) + inlineQ(3, ['one', 'two', 'three', 'four']) + inlineQ(4, ['five', 'six', 'seven', 'eight'])
    + P(R('Mark the letter on your answer sheet to indicate the best arrangement of sentences.')) + stemQ(5, 'Dear Sarah,') + stemQ(6, 'Hi Anna,') + P(R('------ THE END ------'));
  const d = await m.loadDocxExam(await makeDocx(body), 'en.docx', 'english');
  assert.deepEqual(d.parts.map(p => [p.level, p.fixed, p.tagged]), [[2, false, false], [2, false, false], [3, false, false]]);
  assert.deepEqual(d.questions.slice(0, 2).map(q => q.optionPreviews), [['True', 'False'], ['True', 'False']]);
  assert.deepEqual(Object.values(m.parseAnswerText(d, '1.A 2.B 3.C 4.D 5.A 6.B')), ['A', 'B', 'C', 'D', 'A', 'B']);
  assert.deepEqual(Object.values(m.parseAnswerText(d, 'Q1: B, Question 2 - A')), ['B', 'A']);
  assert.deepEqual(Object.values(m.parseAnswerText(d, 'A B C D A B')), ['A', 'B', 'C', 'D', 'A', 'B']);
  assert.deepEqual(Object.values(m.parseAnswerText(d, 'ABCDAB')), ['A', 'B', 'C', 'D', 'A', 'B']);
  const ov2 = m.defaultOverrides(d);
  Object.assign(ov2.answers, m.parseAnswerText(d, 'ABCDAB'));
  const built = [];
  for (const p of m.planVersions(d, EN, ov2)) {
    const b = await m.buildVersion(d, p, EN);
    built.push(b);
    assert.deepEqual(b.problems, [], `mã ${p.code}`);
    const text = plain((await readXml(b.blob)).xml);
    const blanks = p.questions.filter(q => q.part === 1).map(q => q.newNum);
    assert.ok(text.includes(`Join (${blanks[0]})___ and (${blanks[1]})___ now.`), 'đánh lại số chỗ trống');
    p.questions.forEach(q => {
      const orig = 'ABCD'.indexOf(q.baseAnswer);
      assert.equal(q.answer, 'ABCD'[q.perm ? q.perm.indexOf(orig) : orig]);
    });
  }
  const wb = await JSZip.loadAsync(await (await m.buildAnswerWorkbook(d, built, EN)).arrayBuffer());
  const rows = [...(await wb.file('xl/worksheets/sheet1.xml').async('string')).matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map(r => [...r[1].matchAll(/<c [^>]*?(?:><is><t[^>]*>(.*?)<\/t><\/is>|><v>(.*?)<\/v>)<\/c>/g)].map(c => c[1] ?? c[2]));
  assert.match(rows[0][0], /^ĐÁP ÁN/);
  assert.deepEqual(rows[1], ['Đề\\câu', '1', '2', '3', '4', '5', '6']);
  assert.deepEqual(rows[2].slice(1), ['A', 'B', 'C', 'D', 'A', 'B'], 'hàng đề gốc');
  assert.deepEqual(rows.slice(3).map(r => r[0]), ['8385', '8386', '8387', '8388']);
});

await t('Tiếng Anh: file mẫu tải về đã xóa thông tin tác giả và trộn được', async () => {
  const bytes = readFileSync(new URL('../public/templates/Mau_de_tieng_anh.docx', import.meta.url));
  const core = await (await JSZip.loadAsync(bytes)).file('docProps/core.xml').async('string');
  assert.ok(!/<dc:creator>[^<]+|<cp:lastModifiedBy>[^<]+/.test(core), 'không còn thông tin tác giả');
  const d = await m.loadDocxExam(bytes, 'mau.docx', 'english');
  assert.equal(d.questions.length, 40);
  assert.equal(d.parts.length, 11);
  assert.equal(d.questions.slice(0, 36).map(q => q.answer).join(''), 'ACDCBDDCACCBBBDBDAAAABABBABBBDBBCBCB');
  for (const p of m.planVersions(d, { ...EN, count: 2 }, m.defaultOverrides(d))) {
    const b = await m.buildVersion(d, p, { ...EN, count: 2 });
    assert.deepEqual(b.problems, []);
    assert.equal(p.partOrder[10], 10, 'nhóm #g0 cuối đề đứng yên');
  }
});

/* ------------------- Đối chiếu file mẫu thật (MathType, hình, bảng) ------------------- */
const SAMPLE_DIR = fileURLToPath(new URL('../trộn đề/mẫu kết quả sau khi trộn/', import.meta.url));
if (existsSync(SAMPLE_DIR)) {
  const sampleBytes = code => readFileSync(`${SAMPLE_DIR}Mã Đề_${code}.docx`);
  const sample = await m.loadDocxExam(sampleBytes(1206), 'Mã Đề_1206.docx');

  // Đọc đáp án mẫu cho mã 1206 từ file Excel mẫu
  const wbName = readdirSync(SAMPLE_DIR).find(n => n.endsWith('.xlsx'));
  const wb = await JSZip.loadAsync(readFileSync(`${SAMPLE_DIR}${wbName}`));
  const ss = [...(await wb.file('xl/sharedStrings.xml').async('string')).matchAll(/<si>(.*?)<\/si>/gs)].map(x => x[1].replace(/<[^>]+>/g, ''));
  const rowsXml = [...(await wb.file('xl/worksheets/sheet1.xml').async('string')).matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map(x => x[1]);
  const table = rowsXml.map(r => [...r.matchAll(/<c ([^>]*)><v>(.*?)<\/v><\/c>/g)].map(c => (c[1].includes('t="s"') ? ss[+c[2]] : c[2])));
  const col1206 = table[0].indexOf('1206');

  await t('mẫu: đọc đúng cấu trúc đề thật (12 + 2 + 4 + 3 câu, 150 MathType, hình, bảng)', () => {
    assert.equal(sample.parts.length, 4);
    assert.deepEqual(sample.parts.map(p => p.kind), ['mc', 'tf', 'short', 'essay']);
    assert.deepEqual(sample.parts.map(p => sample.questions.filter(q => q.part === p.index).length), [12, 2, 4, 3]);
    assert.ok(sample.stats.objects >= 145, `MathType: ${sample.stats.objects}`);
    assert.equal(sample.stats.images, 1);
    assert.equal(sample.stats.tables, 1);
    sample.questions.filter(q => q.part < 2).forEach(q => assert.equal(q.lockOptions, false, `câu ${q.num}`));
    assert.ok(sample.questions.filter(q => q.kind !== 'essay').every(q => !q.pinned), 'không khóa nhầm câu nào');
  });

  const sov = m.defaultOverrides(sample);
  const answerable = sample.questions.filter(q => q.kind !== 'essay');
  answerable.forEach((q, i) => { sov.answers[q.id] = table[i + 1][col1206]; });
  const sSet = { ...SETTINGS, startCode: 1206 };
  const sPlans = m.planVersions(sample, sSet, sov);
  const sBuilt = [];
  for (const p of sPlans) sBuilt.push(await m.buildVersion(sample, p, sSet));

  await t('mẫu: 6 mã đề đều đạt kiểm tra, đủ MathType và media', async () => {
    for (const b of sBuilt) {
      assert.deepEqual(b.problems, [], `mã ${b.plan.code}`);
      const { zip, xml } = await readXml(b.blob);
      assert.equal(xml.split('<w:object').length - 1, 150);
      assert.equal(Object.keys(zip.files).filter(n => n.startsWith('word/embeddings/')).length, 150);
      assert.equal(xml.split('<w:drawing').length - 1, 1);
    }
  });

  // Bố cục mẫu: dấu hiệu định dạng của từng đoạn
  const signature = xml => {
    const paras = [...xml.matchAll(/<w:p(?: [^>]*)?>.*?<\/w:p>/gs)].map(x => x[0]).filter(p => /<w:t[^>]*>\s*(?:[A-D]\.|[a-d]\))/.test(p) && p.includes('<w:tabs>'));
    return paras.map(p => {
      const tabs = [...p.matchAll(/<w:tab w:val="left" w:pos="(\d+)"/g)].map(x => x[1]).join(',');
      const ind = /<w:ind w:left="284" w:hanging="284"/.test(p) ? 'H' : '';
      const sp = /<w:spacing w:before="0" w:after="0" w:line="276" w:lineRule="auto"/.test(p) ? 'S' : '';
      const jc = /<w:jc w:val="(\w+)"/.exec(p)?.[1];
      return `${tabs}|${ind}|${sp}|${jc}`;
    }).sort();
  };

  await t('mẫu: bố cục phương án trùng khớp file mẫu (tab, thụt lề, khoảng cách, canh lề)', async () => {
    const want = signature((await JSZip.loadAsync(sampleBytes(1206))).file('word/document.xml') && await (await JSZip.loadAsync(sampleBytes(1206))).file('word/document.xml').async('string'));
    const got = signature((await readXml(sBuilt[0].blob)).xml);
    assert.deepEqual(got, want);
  });

  await t('mẫu: mã đề ở đầu đề và chân trang đều được đổi', async () => {
    for (const b of sBuilt) {
      const { zip, xml } = await readXml(b.blob);
      assert.ok(plain(xml).includes(`Mã đề ${b.plan.code}`));
      assert.ok(plain(await zip.file('word/footer1.xml').async('string')).includes(`Mã đề ${b.plan.code}`));
    }
  });

  await t('mẫu: nhãn đậm, câu giữ liền nhau, đoạn cuối của câu không keepNext', async () => {
    const { xml } = await readXml(sBuilt[0].blob);
    const paras = [...xml.matchAll(/<w:p(?: [^>]*)?>.*?<\/w:p>/gs)].map(x => x[0]);
    const lastOption = paras.findIndex(p => />D\. </.test(p) && p.includes('w:pos="284"'));
    assert.ok(!paras[lastOption].includes('<w:keepNext'), 'đoạn phương án cuối');
    assert.ok(paras[lastOption - 1].includes('<w:keepNext'), 'đoạn đứng trước');
    assert.ok(sample.questions[0].preview.startsWith('Cho'), sample.questions[0].preview);
    assert.ok(/<w:b\/>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t[^>]*>Câu 1\. /s.test(xml));
    assert.ok(/<w:b\/>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t[^>]*>A\. /s.test(xml));
  });

  await t('mẫu: bảng Excel đúng dạng "Câu\\Mã Đề", mã lớn trước, không có tự luận', async () => {
    const blob = await m.buildAnswerWorkbook(sample, sBuilt, sSet);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const rows = [...sheet.matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map(r => [...r[1].matchAll(/<c [^>]*?(?:><is><t[^>]*>(.*?)<\/t><\/is>|><v>(.*?)<\/v>)<\/c>/g)].map(c => c[1] ?? c[2]));
    assert.deepEqual(rows[0], ['Câu\\Mã Đề', '1211', '1210', '1209', '1208', '1207', '1206']);
    assert.equal(rows.length, table.length, 'cùng số hàng với mẫu');
    assert.deepEqual(rows.map(r => r[0]), table.map(r => r[0]));
    assert.match((await zip.file('xl/workbook.xml').async('string')), /name="Sheet1"/);
    rows.slice(13, 15).forEach(r => r.slice(1).forEach(v => assert.match(v, /^[ĐS]{4}$/)));
  });

  await t('mẫu: đáp án trả lời ngắn đi theo câu', () => {
    for (const p of sPlans) {
      const shortQs = p.questions.filter(q => q.kind === 'short');
      assert.deepEqual(shortQs.map(q => q.answer).sort(), ['-7', '11', '16', '75,9'].sort());
    }
  });
} else {
  console.log('(bỏ qua phần đối chiếu file mẫu: không có thư mục mẫu)');
}

console.log(`\nĐạt ${ok} kiểm thử`);
