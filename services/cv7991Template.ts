/**
 * MẪU CHUẨN CV 7991 (template1)
 * Dựng khung bảng MA TRẬN & BẢN ĐẶC TẢ đúng theo Phụ lục kèm Công văn số
 * 7991/BGDĐT-GDTrH ngày 17/12/2024:
 *
 *  1. MA TRẬN: TT | Chủ đề/Chương | Nội dung/đơn vị kiến thức | Mức độ đánh giá
 *     (TNKQ: Nhiều lựa chọn – "Đúng – Sai" – Trả lời ngắn | Tự luận; mỗi dạng
 *     Biết – Hiểu – Vận dụng) | Tổng (Biết – Hiểu – Vận dụng) | Tỉ lệ % điểm.
 *     Footer: Tổng số câu | Tổng số điểm (gộp theo dạng) | Tỉ lệ %.
 *  2. BẢN ĐẶC TẢ: TT | Chủ đề/Chương | Nội dung/đơn vị kiến thức | Yêu cầu cần đạt |
 *     Số câu hỏi ở các mức độ đánh giá (cùng cấu trúc cột như ma trận, không có cột Tổng).
 *     Ô câu hỏi ghi mã câu + tên năng lực viết tắt.
 *
 * Header/footer được sinh bằng code (không để AI tự vẽ) và được áp lại lên output.
 */
import { getDungSaiQuestionCount, getDungSaiLevelTotals } from '../types';
import type { InputData, QuestionConfig } from '../types';

export type Cv7991TypeKey = 'type1' | 'type2' | 'type3' | 'essay';
type Level = 'biet' | 'hieu' | 'vd';

export interface Cv7991TypeInfo {
    key: Cv7991TypeKey;
    roman: 'I' | 'II' | 'III' | 'IV';
    label: string;            // tên hiển thị trong header
    isTNKQ: boolean;
    questions: number;        // số câu
    commands: number;         // số lệnh hỏi (Đ–S: 4 ý/câu)
    levels: Record<Level, number>; // số câu theo mức (theo cấu hình)
    points: number;           // tổng điểm của dạng
    pointPerCommand: number;  // điểm mỗi lệnh hỏi (Đ–S: mỗi ý); tự luận: điểm TB/câu
}

export interface Cv7991Layout {
    types: Cv7991TypeInfo[];  // chỉ các dạng có số câu > 0, theo thứ tự I, II, III, IV
    hasEssay: boolean;
    totalPoints: number;
}

const TYPE_META: Record<Cv7991TypeKey, { roman: Cv7991TypeInfo['roman']; label: string; isTNKQ: boolean }> = {
    type1: { roman: 'I', label: 'Nhiều lựa chọn', isTNKQ: true },
    type2: { roman: 'II', label: '“Đúng – Sai”', isTNKQ: true },
    type3: { roman: 'III', label: 'Trả lời ngắn', isTNKQ: true },
    essay: { roman: 'IV', label: 'Tự luận', isTNKQ: false },
};

const sumLevels = (c: { biet: number; hieu: number; van_dung: number; van_dung_cao: number }) =>
    (c?.biet || 0) + (c?.hieu || 0) + (c?.van_dung || 0) + (c?.van_dung_cao || 0);

/** Định dạng số kiểu Việt Nam theo CV: 3,0 | 0,25 | 1,5 */
export const fmtVN = (n: number, minDecimals = 1): string => {
    const r = Math.round(n * 100) / 100;
    let s = r.toFixed(2).replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
    const dec = s.includes('.') ? s.split('.')[1].length : 0;
    if (dec < minDecimals) s = r.toFixed(minDecimals);
    return s.replace('.', ',');
};

const fmtPct = (n: number): string => fmtVN(n, 0);

/**
 * Tính thang điểm theo CV 7991 + quy tắc hiện có của app (SYSTEM_INSTRUCTION):
 *  - Có tự luận: I 3,0 – II 2,0 – III 2,0 – IV 3,0
 *  - Không tự luận: I 3,0 – II 4,0 – III 3,0
 *  - Dạng có 0 câu: không tạo cột; điểm của "Trả lời ngắn" chuyển sang "Đúng – Sai"
 *    (chú thích 3 của Phụ lục), các dạng khác chuyển cho dạng còn lại theo thứ tự II, I, III, IV.
 */
export const computeCv7991Layout = (config: QuestionConfig, allowEssay: boolean): Cv7991Layout => {
    const counts: Record<Cv7991TypeKey, number> = {
        type1: sumLevels(config.type1),
        type2: getDungSaiQuestionCount(config),
        type3: sumLevels(config.type3),
        essay: allowEssay ? sumLevels(config.essay) : 0,
    };
    const hasEssay = counts.essay > 0;
    const type2LevelTotals = getDungSaiLevelTotals(config);
    const target: Record<Cv7991TypeKey, number> = hasEssay
        ? { type1: 3, type2: 2, type3: 2, essay: 3 }
        : { type1: 3, type2: 4, type3: 3, essay: 0 };

    const order: Cv7991TypeKey[] = ['type2', 'type1', 'type3', 'essay'];
    (['type3', 'type1', 'type2', 'essay'] as Cv7991TypeKey[]).forEach(k => {
        if (counts[k] > 0 || target[k] === 0) return;
        const receiver = order.find(o => o !== k && counts[o] > 0);
        if (receiver) target[receiver] += target[k];
        target[k] = 0;
    });

    const types: Cv7991TypeInfo[] = (['type1', 'type2', 'type3', 'essay'] as Cv7991TypeKey[])
        .filter(k => counts[k] > 0)
        .map(k => {
            const c = config[k];
            const commands = k === 'type2' ? counts[k] * 4 : counts[k];
            return {
                key: k,
                ...TYPE_META[k],
                questions: counts[k],
                commands,
                levels: k === 'type2'
                ? { biet: type2LevelTotals.biet, hieu: type2LevelTotals.hieu, vd: type2LevelTotals.van_dung }
                : { biet: c.biet || 0, hieu: c.hieu || 0, vd: (c.van_dung || 0) + (c.van_dung_cao || 0) },
                points: target[k],
                pointPerCommand: target[k] / commands,
            };
        });

    return { types, hasEssay, totalPoints: types.reduce((s, t) => s + t.points, 0) };
};

// ============================================
// HEADER (thead) — đúng Phụ lục CV 7991
// ============================================
const LEVEL_TH = '<th>Biết</th><th>Hiểu</th><th>Vận dụng</th>';

const buildTypeHeaderRows = (layout: Cv7991Layout): { row2: string; row3: string; row4: string } => {
    const tnkq = layout.types.filter(t => t.isTNKQ);
    const essay = layout.types.find(t => !t.isTNKQ);
    let row2 = '';
    let row3 = '';
    if (tnkq.length) {
        row2 += `<th colspan="${tnkq.length * 3}">TNKQ</th>`;
        row3 += tnkq.map(t => `<th colspan="3"><i>${t.label}</i></th>`).join('');
    }
    if (essay) {
        // Theo Phụ lục: "Tự luận" ở dòng 2, ô dòng 3 phía dưới để trống (gộp)
        row2 += `<th colspan="3" rowspan="2">Tự luận</th>`;
    }
    const row4 = layout.types.map(() => LEVEL_TH).join('');
    return { row2, row3, row4 };
};

/** Số cột của bảng ma trận */
export const cv7991MatrixColumnCount = (layout: Cv7991Layout) => 3 + layout.types.length * 3 + 3 + 1;
/** Số cột của bảng đặc tả */
export const cv7991SpecsColumnCount = (layout: Cv7991Layout) => 4 + layout.types.length * 3;

export const buildCv7991MatrixThead = (layout: Cv7991Layout): string => {
    const { row2, row3, row4 } = buildTypeHeaderRows(layout);
    const levelCols = layout.types.length * 3;
    return [
        '<thead>',
        `<tr><th rowspan="4" style="width:3%">TT</th><th rowspan="4" style="width:10%">Chủ đề/Chương</th><th rowspan="4" style="width:14%">Nội dung/đơn vị kiến thức</th>`
        + `<th colspan="${levelCols}">Mức độ đánh giá</th><th colspan="3" rowspan="3">Tổng</th><th rowspan="4" style="width:5%">Tỉ lệ % điểm</th></tr>`,
        `<tr>${row2}</tr>`,
        row3 ? `<tr>${row3}</tr>` : '<tr></tr>',
        `<tr>${row4}${LEVEL_TH}</tr>`,
        '</thead>',
    ].join('\n');
};

export const buildCv7991SpecsThead = (layout: Cv7991Layout): string => {
    const { row2, row3, row4 } = buildTypeHeaderRows(layout);
    const levelCols = layout.types.length * 3;
    return [
        '<thead>',
        `<tr><th rowspan="4" style="width:3%">TT</th><th rowspan="4" style="width:9%">Chủ đề/Chương</th><th rowspan="4" style="width:12%">Nội dung/đơn vị kiến thức</th>`
        + `<th rowspan="4" style="width:30%">Yêu cầu cần đạt</th><th colspan="${levelCols}">Số câu hỏi ở các mức độ đánh giá</th></tr>`,
        `<tr>${row2}</tr>`,
        row3 ? `<tr>${row3}</tr>` : '<tr></tr>',
        `<tr>${row4}</tr>`,
        '</thead>',
    ].join('\n');
};

// ============================================
// FOOTER (2 dòng cuối tính sẵn bằng code)
// ============================================
const SHADE = 'style="background:#d9d9d9"';

/** Mẫu footer ma trận: "Tổng số câu" để AI điền; "Tổng số điểm" và "Tỉ lệ %" theo dạng đã tính sẵn. */
export const buildCv7991MatrixFooterTemplate = (layout: Cv7991Layout): string => {
    const n = layout.types.length * 3;
    const blanks = (k: number, ph: string) => Array.from({ length: k }, () => `<td>${ph}</td>`).join('');
    const pointsByType = layout.types.map(t => `<td colspan="3" class="bold">${fmtVN(t.points)}</td>`).join('');
    const pctByType = layout.types.map(t => `<td colspan="3" class="bold">${fmtPct(t.points * 10)}</td>`).join('');
    return [
        `<tr class="cv-footer"><td colspan="3" class="bold" style="text-align:right">Tổng số câu</td>${blanks(n, '{số lệnh hỏi của cột}')}${blanks(3, '{tổng lệnh hỏi theo mức}')}<td ${SHADE}></td></tr>`,
        `<tr class="cv-footer"><td colspan="3" class="bold" style="text-align:right">Tổng số điểm</td>${pointsByType}<td class="bold">{điểm Biết}</td><td class="bold">{điểm Hiểu}</td><td class="bold">{điểm Vận dụng}</td><td ${SHADE}></td></tr>`,
        `<tr class="cv-footer"><td colspan="3" class="bold" style="text-align:right">Tỉ lệ %</td>${pctByType}<td class="bold">{% Biết}</td><td class="bold">{% Hiểu}</td><td class="bold">{% Vận dụng}</td><td ${SHADE}></td></tr>`,
    ].join('\n');
};

export const buildCv7991SpecsFooterTemplate = (layout: Cv7991Layout): string => {
    const n = layout.types.length * 3;
    const blanks = Array.from({ length: n }, () => '<td>{số lệnh hỏi của cột}</td>').join('');
    const pointsByType = layout.types.map(t => `<td colspan="3" class="bold">${fmtVN(t.points)}</td>`).join('');
    const pctByType = layout.types.map(t => `<td colspan="3" class="bold">${fmtPct(t.points * 10)}</td>`).join('');
    return [
        `<tr class="cv-footer"><td colspan="3" class="bold" style="text-align:right">Tổng số câu</td><td></td>${blanks}</tr>`,
        `<tr class="cv-footer"><td colspan="3" class="bold" style="text-align:right">Tổng số điểm</td><td></td>${pointsByType}</tr>`,
        `<tr class="cv-footer"><td colspan="3" class="bold" style="text-align:right">Tỉ lệ %</td><td></td>${pctByType}</tr>`,
    ].join('\n');
};

// ============================================
// NĂNG LỰC (ghi tắt trong ô đặc tả — chú thích 6 của Phụ lục)
// ============================================
export interface CompetencyItem { code: string; name: string }

const SUBJECT_COMPETENCY_CODES: Record<string, string[]> = {
    'Toán': ['TD', 'MH', 'GQ'],
};

export const getCv7991Competencies = (subject: string, footnotes: string): CompetencyItem[] => {
    const names = footnotes
        .split('\n')
        .map(l => l.trim())
        .filter(l => /^\(\d+\)\s*:/.test(l))
        .map(l => l.replace(/^\(\d+\)\s*:\s*/, ''));
    const codes = SUBJECT_COMPETENCY_CODES[subject] || names.map((_, i) => `NL${i + 1}`);
    return names.map((name, i) => ({ code: codes[i] || `NL${i + 1}`, name }));
};

export const CV7991_CSS = `
body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.3; margin: 20px; }
h2 { text-align: center; font-weight: bold; text-transform: uppercase; margin: 6px 0 12px; font-size: 14pt; }
table { width: 100%; border-collapse: collapse; margin-bottom: 0.6rem; }
th, td { border: 1px solid black; padding: 3px 5px; text-align: center; vertical-align: middle; }
th { font-weight: bold; }
.left-align, .text-left { text-align: left; padding: 4px 6px; vertical-align: top; }
.bold { font-weight: bold; }
.note { font-size: 11pt; margin: 2px 0; }`;

// ============================================
// PROMPT BUILDERS
// ============================================
interface PromptCommon {
    data: InputData;
    layout: Cv7991Layout;
    footnotes: string;
}

const examLabels = (data: InputData) => {
    const isGiuaKy = data.examType.includes('Giữa');
    return {
        examTypeLabel: isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ',
        semesterNum: data.examType.includes('1') ? 'I' : 'II',
    };
};

const describeTypes = (layout: Cv7991Layout): string => layout.types.map(t => {
    const unit = t.key === 'type2'
        ? `${t.questions} câu × 4 ý (a, b, c, d) = ${t.commands} lệnh hỏi; mỗi ý ${fmtVN(t.pointPerCommand, 2)} điểm (mỗi câu ${fmtVN(t.pointPerCommand * 4)} điểm)`
        : t.key === 'essay'
            ? `${t.questions} câu; tổng ${fmtVN(t.points)} điểm, chia cho từng câu/ý theo độ khó (bội số 0,25)`
            : `${t.questions} câu = ${t.commands} lệnh hỏi; mỗi câu ${fmtVN(t.pointPerCommand, 2)} điểm`;
    const lv = t.key === 'type2'
        ? `cấu hình mức chính của các câu: Biết ${t.levels.biet}, Hiểu ${t.levels.hieu}, VD ${t.levels.vd} câu`
        : `Biết ${t.levels.biet} – Hiểu ${t.levels.hieu} – Vận dụng ${t.levels.vd}`;
    return `  | ${t.roman}. ${t.label.replace(/[“”]/g, '"')} | ${unit} | ${lv} | ${fmtVN(t.points)} điểm (${fmtPct(t.points * 10)}%) |`;
}).join('\n');

const codeRules = (layout: Cv7991Layout): string => {
    const lines: string[] = [];
    layout.types.forEach(t => {
        if (t.key === 'type1') lines.push(`  - Nhiều lựa chọn: mã "I.1", "I.2", ... (đánh số liên tục 1 → ${t.questions}).`);
        if (t.key === 'type2') lines.push(`  - "Đúng – Sai": mỗi câu có 4 ý → mã "II.1a", "II.1b", "II.1c", "II.1d" ... đến "II.${t.questions}d". Bốn ý của cùng 1 câu nằm cùng 1 hàng (cùng đơn vị kiến thức) nhưng có thể chia vào các cột Biết/Hiểu/Vận dụng khác nhau (thường a, b: Biết; c: Hiểu; d: Vận dụng — câu có mức chính cao hơn thì dịch ý lên mức cao hơn). Mỗi ý là 1 lệnh hỏi.`);
        if (t.key === 'type3') lines.push(`  - Trả lời ngắn: mã "III.1", "III.2", ... đến "III.${t.questions}".`);
        if (t.key === 'essay') lines.push(`  - Tự luận: mã "IV.1", "IV.2" ... (câu có nhiều ý: "IV.1a", "IV.1b"). Đếm lệnh hỏi theo số câu tự luận.`);
    });
    return lines.join('\n');
};

/** Prompt bước 1 — MA TRẬN theo mẫu chuẩn CV 7991 */
export const buildCv7991MatrixPrompt = (
    p: PromptCommon & { selectedChapters: any[]; totalSelectedPeriods: number },
): string => {
    const { data, layout, footnotes, selectedChapters, totalSelectedPeriods } = p;
    const { examTypeLabel, semesterNum } = examLabels(data);
    const cols = cv7991MatrixColumnCount(layout);
    return `
  Hãy tạo **MA TRẬN ĐỀ KIỂM TRA ĐỊNH KÌ** (Full HTML Document) cho môn **${data.subject}**, **Lớp ${data.grade}**,
  theo ĐÚNG mẫu "1. MA TRẬN ĐỀ KIỂM TRA ĐỊNH KÌ" trong Phụ lục kèm Công văn số 7991/BGDĐT-GDTrH ngày 17/12/2024.

  **CẤU HÌNH ĐỀ:** ${data.examType} (Kiểm tra ${examTypeLabel} ${semesterNum}) — ${data.duration} phút — tổng ${totalSelectedPeriods} tiết trọng tâm.

  **SỐ LƯỢNG CÂU HỎI & ĐIỂM (đã tính sẵn — PHẢI KHỚP CHÍNH XÁC):**
  | Dạng | Số câu / lệnh hỏi, điểm mỗi lệnh hỏi | Phân bổ mức độ | Tổng điểm dạng |
  |---|---|---|---|
${describeTypes(layout)}
  Tổng điểm toàn bài = ${fmtVN(layout.totalPoints)}. ${layout.hasEssay ? '' : 'KHÔNG có Tự luận → KHÔNG tạo cột Tự luận.'}
  Dạng nào không có trong bảng trên thì KHÔNG tạo cột cho dạng đó.

  **===== CẤU TRÚC BẢNG BẮT BUỘC (đúng Phụ lục CV 7991) =====**
  Bảng có đúng **${cols} cột**. Dùng NGUYÊN VĂN phần <thead> sau (không sửa, không thêm/bớt cột):
\`\`\`
${buildCv7991MatrixThead(layout)}
\`\`\`

  **PHẦN THÂN (<tbody>) — mỗi đơn vị kiến thức (bài học) là 1 hàng:**
  - Cột "TT": số thứ tự chủ đề/chương (1, 2, 3...), gộp ô (rowspan) theo số bài của chương.
  - Cột "Chủ đề/Chương": tên chương, gộp ô (rowspan) giống cột TT. class="left-align".
  - Cột "Nội dung/đơn vị kiến thức": tên bài học (class="left-align").
  - Các ô Biết/Hiểu/Vận dụng của từng dạng: ghi **mã câu hỏi** (theo chú thích 4 của Phụ lục: "thể hiện số câu hỏi hoặc câu hỏi số bao nhiêu"). Nhiều mã trong 1 ô thì cách nhau bằng dấu phẩy hoặc <br>. Ô không có câu để trống.
${codeRules(layout)}
  - 3 ô "Tổng" (Biết | Hiểu | Vận dụng): SỐ LỆNH HỎI của hàng ở từng mức (cộng tất cả các dạng). Ô bằng 0 để trống.
  - Ô "Tỉ lệ % điểm": tỉ lệ % điểm của hàng = (tổng điểm các lệnh hỏi trong hàng) × 10, viết dạng số thập phân dấu phẩy, không kèm ký hiệu % (ví dụ: 12,5).
  - Phân bổ câu hỏi theo tỉ lệ số tiết: bài nhiều tiết → nhiều lệnh hỏi hơn.

  **3 DÒNG CUỐI (footer) — dùng đúng khung sau, thay phần {…} bằng số tính được:**
\`\`\`
${buildCv7991MatrixFooterTemplate(layout)}
\`\`\`
  - "Tổng số câu": số lệnh hỏi của từng cột (Đ–S đếm theo ý), 3 ô Tổng = tổng lệnh hỏi theo mức của cả bài.
  - "Tổng số điểm" ở 3 cột Tổng: tổng điểm các lệnh hỏi ở mức Biết / Hiểu / Vận dụng (tính bằng số lệnh hỏi × điểm mỗi lệnh hỏi đã cho ở trên). Ba số này cộng lại = ${fmtVN(layout.totalPoints)}.
  - "Tỉ lệ %" ở 3 cột Tổng = điểm mức × 10 (không kèm ký hiệu %). Định hướng CV: Biết ≈ 40, Hiểu ≈ 30, Vận dụng ≈ 30.
  - Ô cuối cột "Tỉ lệ % điểm" ở 3 dòng footer để trống, tô xám (giữ nguyên style).
  - Viết số theo kiểu Việt Nam: dấu phẩy thập phân (3,0; 0,25; 12,5).

  **DỮ LIỆU ĐẦU VÀO (Chương → Bài học, số tiết):**
  ${JSON.stringify(selectedChapters, null, 2)}

  **YÊU CẦU OUTPUT:**
  1. Full HTML Document (<!DOCTYPE html>...), CSS đặt trong <style>:
${CV7991_CSS}
  2. Trên bảng: <h2>MA TRẬN ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} – NĂM HỌC 20... - 20...</h2>
     (Năm học BẮT BUỘC để trống dạng "20... - 20...").
  3. Dưới bảng (class="note"):
     - "Ghi chú: Các con số/mã câu trong bảng thể hiện lệnh hỏi. Mỗi câu hỏi ở dạng Nhiều lựa chọn, Trả lời ngắn${layout.hasEssay ? ', Tự luận' : ''} là một lệnh hỏi; mỗi ý hỏi ở dạng “Đúng – Sai” là một lệnh hỏi."
     - "“Đúng – Sai”: mỗi câu hỏi gồm 4 ý nhỏ, mỗi ý học sinh phải chọn đúng hoặc sai."
  4. Chỉ trả về HTML, không giải thích.

  **KIỂM TRA TRƯỚC KHI TRẢ KẾT QUẢ:** đếm mã câu từng dạng phải đủ và không trùng; mỗi hàng đúng ${cols} cột (tính cả rowspan); tổng điểm = ${fmtVN(layout.totalPoints)}.
  `;
};

/** Prompt bước 2 — BẢN ĐẶC TẢ theo mẫu chuẩn CV 7991 */
export const buildCv7991SpecsPrompt = (
    p: PromptCommon & { matrixContent: string; objectivesMap: string[]; isUploadedMatrix?: boolean },
): string => {
    const { data, layout, footnotes, matrixContent, objectivesMap, isUploadedMatrix } = p;
    const { examTypeLabel, semesterNum } = examLabels(data);
    const cols = cv7991SpecsColumnCount(layout);
    const comps = getCv7991Competencies(data.subject, footnotes);
    const compList = comps.map(c => `${c.code}: ${c.name}`).join('; ');
    return `
  Dựa trên **MA TRẬN** (HTML) dưới đây, hãy tạo **BẢN ĐẶC TẢ ĐỀ KIỂM TRA ĐỊNH KÌ** (Full HTML Document)
  theo ĐÚNG mẫu "2. BẢN ĐẶC TẢ ĐỀ KIỂM TRA ĐỊNH KÌ" trong Phụ lục kèm Công văn số 7991/BGDĐT-GDTrH ngày 17/12/2024.

  **⚠️ NGUYÊN TẮC TỐI THƯỢNG: TUÂN THỦ 100% MA TRẬN ĐẦU VÀO ⚠️**
  - Mọi Chương/Chủ đề, Nội dung/Đơn vị kiến thức, các dạng câu hỏi, số câu/lệnh hỏi ở từng mức độ (Biết, Hiểu, Vận dụng), mã câu hỏi và tổng điểm PHẢI GIỮ NGUYÊN 100% theo **MA TRẬN ĐẦU VÀO** bên dưới.
  - TUYỆT ĐỐI KHÔNG tự ý thêm/bớt bài học hoặc thay đổi số lượng câu hỏi khác với Ma trận đầu vào.

  **MA TRẬN ĐẦU VÀO (CHUẨN GỐC BẮT BUỘC TUÂN THỦ 100%):**
  ${matrixContent}

  ${objectivesMap.length > 0 ? `**YÊU CẦU CẦN ĐẠT THEO BÀI (tham khảo, viết lại cho phù hợp mã câu):**\n  ${objectivesMap.join('\n')}` : '**YÊU CẦU CẦN ĐẠT:** Tự biên soạn chi tiết Yêu cầu cần đạt (Biết / Hiểu / Vận dụng) chuẩn Chương trình GDPT 2018 sát với từng Nội dung/Đơn vị kiến thức và mức độ câu hỏi có trong Ma trận đầu vào.'}

  ${isUploadedMatrix ? '**LƯU Ý ĐẶC BIỆT:** Đây là Ma trận do người dùng tải lên. Hãy lấy chính xác số câu, số lệnh hỏi, điểm số và cấu trúc các dạng câu hỏi thực tế trong Ma trận đầu vào làm chuẩn tuyệt đối.' : `**THÔNG TIN CẤU HÌNH ĐỒNG BỘ VỚI MA TRẬN:**\n${describeTypes(layout)}`}

  **===== CẤU TRÚC BẢNG BẮT BUỘC =====**
  Bảng có đúng **${cols} cột** (KHÔNG có cột "Cấp độ tư duy", KHÔNG có cột Tổng). Dùng NGUYÊN VĂN <thead> sau:
\`\`\`
${buildCv7991SpecsThead(layout)}
\`\`\`

  **PHẦN THÂN — mỗi đơn vị kiến thức (bài học) là 1 hàng, đúng thứ tự & cùng bài như ma trận:**
  - "TT" và "Chủ đề/Chương": gộp ô (rowspan) theo chương; tên chương in đậm (<b>), class="left-align".
  - "Nội dung/đơn vị kiến thức": tên bài đúng nguyên văn như trong Ma trận đầu vào (class="left-align").
  - "Yêu cầu cần đạt" (class="left-align"): liệt kê theo 3 mức, mỗi mức bắt đầu bằng gạch đầu dòng:
      <b>- Biết:</b> … <br><b>- Hiểu:</b> … <br><b>- Vận dụng:</b> …
    Chỉ ghi mức nào hàng đó thực sự có lệnh hỏi trong Ma trận; nội dung là các động từ hành động đo được, khớp với câu hỏi được giao.
  - Các ô câu hỏi: ghi **mã câu / số câu** đúng y như ô tương ứng trong Ma trận (cùng hàng, cùng dạng, cùng mức), và ngay dưới ghi **tên năng lực viết tắt** trong ngoặc đơn (chú thích 6 của Phụ lục), ví dụ: "I.1, I.2<br>(${comps[0]?.code || 'NL1'})".
    Năng lực viết tắt được dùng: ${compList}.
  - Ô không có câu hỏi để trống.

  **3 DÒNG CUỐI (footer) — đồng bộ 100% với 3 dòng cuối của Ma trận đầu vào:**
\`\`\`
${buildCv7991SpecsFooterTemplate(layout)}
\`\`\`

  **YÊU CẦU OUTPUT:**
  1. Full HTML Document, CSS trong <style>:
${CV7991_CSS}
  2. Trên bảng: <h2>BẢN ĐẶC TẢ ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum}${data.grade ? ` - LỚP ${data.grade}` : ''}${data.subject ? ` - MÔN ${data.subject.toUpperCase()}` : ''} – NĂM HỌC 20... - 20...</h2> (nếu Ma trận đầu vào đã có tiêu đề môn/lớp/kỳ kiểm tra cụ thể, hãy giữ đúng môn/lớp/kỳ kiểm tra của Ma trận đầu vào; năm học để trống).
  3. Dưới bảng (class="note"): "Chú thích năng lực: ${compList}."
  4. Chỉ trả về HTML, không giải thích.

  **KIỂM TRA TRƯỚC KHI TRẢ KẾT QUẢ:** tập mã câu/số câu và danh sách bài học trong đặc tả phải TRÙNG KHỚP 100% với Ma trận đầu vào.
  `;
};

// ============================================
// HẬU XỬ LÝ — áp lại thead chuẩn lên output của AI
// ============================================

/** Đếm số cột của 1 hàng <tr> (cộng colspan). */
const countRowColumns = (rowHtml: string): number => {
    let n = 0;
    const re = /<t[dh]\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rowHtml))) {
        const cs = /colspan\s*=\s*["']?(\d+)/i.exec(m[1]);
        n += cs ? parseInt(cs[1], 10) : 1;
    }
    return n;
};

/**
 * Thay <thead> đầu tiên của bảng chính bằng thead chuẩn CV 7991 nếu số cột của
 * hàng dữ liệu đầu tiên khớp với cấu trúc dự kiến. Không khớp → giữ nguyên output.
 */
export const applyCv7991Thead = (html: string, thead: string, expectedCols: number): string => {
    if (!html) return html;
    const tableStart = html.search(/<table\b/i);
    if (tableStart < 0) return html;
    const tableEnd = html.indexOf('</table>', tableStart);
    if (tableEnd < 0) return html;
    const table = html.slice(tableStart, tableEnd);

    // Hàng dữ liệu đầu tiên: trong <tbody> nếu có, hoặc sau </thead>
    const bodyStart = (() => {
        const tb = table.search(/<tbody\b/i);
        if (tb >= 0) return tb;
        const th = table.search(/<\/thead>/i);
        return th >= 0 ? th : -1;
    })();
    if (bodyStart < 0) return html;
    const firstRow = /<tr\b[^>]*>([\s\S]*?)<\/tr>/i.exec(table.slice(bodyStart));
    if (!firstRow || countRowColumns(firstRow[1]) !== expectedCols) return html;

    const theadRe = /<thead\b[\s\S]*?<\/thead>/i;
    if (!theadRe.test(table)) return html;
    const newTable = table.replace(theadRe, thead);
    return html.slice(0, tableStart) + newTable + html.slice(tableEnd);
};
