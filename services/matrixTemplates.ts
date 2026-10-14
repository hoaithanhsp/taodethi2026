
import { MatrixTemplate, InputData, QuestionConfig } from '../types';
import { SYSTEM_INSTRUCTION, GRADE_NO_ESSAY, getSubjectFootnotes } from '../constants';

// ============================================
// TEMPLATE FILE PATHS (stored in public/templates/)
// ============================================
const TEMPLATE_FILES: Record<string, string> = {
    template2: '/templates/01_ma_tran_dac_ta.docx',
    template3: '/templates/02_ma_tran_dac_ta.docx',
    template4: '/templates/03_ma_tran.docx',
};

// Cache to avoid re-parsing on every call
const templateHtmlCache: Record<string, string> = {};

/**
 * Fetch file mẫu .docx từ public/templates/, parse bằng mammoth → trả về HTML string.
 * Gemini API không hỗ trợ .docx inline, nên phải convert sang HTML text trước.
 */
export const fetchTemplateHtml = async (template: MatrixTemplate): Promise<string | null> => {
    // Return cached if available
    if (templateHtmlCache[template]) return templateHtmlCache[template];

    const filePath = TEMPLATE_FILES[template];
    if (!filePath) return null;

    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        // Dynamic import mammoth to parse .docx → HTML
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer });
        const html = result.value;

        console.log(`[MatrixTemplates] Parsed template ${template}: ${html.length} chars HTML`);
        templateHtmlCache[template] = html;
        return html;
    } catch (err) {
        console.error(`[MatrixTemplates] Failed to parse template file for ${template}:`, err);
        return null;
    }
};

// ============================================
// TEMPLATE INFO (for UI display)
// ============================================
export interface TemplateInfo {
    id: MatrixTemplate;
    name: string;
    description: string;
    icon: string;
    badge?: string;
}

export const MATRIX_TEMPLATES: TemplateInfo[] = [
    {
        id: 'template1',
        name: 'Mẫu chuẩn CV 7991',
        description: 'Ma trận đặc tả theo chuẩn Công văn 7991 (3 mức: Biết – Hiểu – VD)',
        icon: '📋',
        badge: 'Mặc định',
    },
    {
        id: 'template2',
        name: 'Ma trận đặc tả mẫu 2',
        description: 'Sinh ma trận & đặc tả theo file mẫu 01 MA TRẬN ĐẶC TẢ',
        icon: '📊',
    },
    {
        id: 'template3',
        name: 'Ma trận đặc tả mẫu 3',
        description: 'Sinh ma trận & đặc tả theo file mẫu 02 MA TRẬN ĐẶC TẢ',
        icon: '📈',
    },
    {
        id: 'template4',
        name: 'Ma trận đặc tả mẫu 4',
        description: 'Sinh ma trận & đặc tả theo file mẫu 03 Ma trận',
        icon: '📑',
    },
];

// ============================================
// PROMPT BUILDERS FOR TEMPLATE 2, 3 & 4
// ============================================

const getTemplateDisplayName = (template: MatrixTemplate): string => {
    if (template === 'template2') return 'Mẫu 2 (file 01 MA TRẬN ĐẶC TẢ)';
    if (template === 'template3') return 'Mẫu 3 (file 02 MA TRẬN ĐẶC TẢ)';
    if (template === 'template4') return 'Mẫu 4 (file 03 Ma trận.docx)';
    return 'Mẫu chuẩn CV 7991';
};

/**
 * Build prompt cho generateStep1Matrix khi dùng mẫu 2, 3 hoặc 4
 */
export const buildMatrixPromptForCustomTemplate = (
    template: MatrixTemplate,
    data: InputData,
    selectedChapters: any[],
    totalSelectedPeriods: number,
    config: QuestionConfig,
): string => {
    const totalEssayQuestions = config.essay.biet + config.essay.hieu + config.essay.van_dung + config.essay.van_dung_cao;
    const isGradeNoEssay = GRADE_NO_ESSAY.includes(data.grade);
    const hasEssay = !isGradeNoEssay && totalEssayQuestions > 0;

    const type1Total = { biet: config.type1.biet, hieu: config.type1.hieu, vd: config.type1.van_dung + config.type1.van_dung_cao };
    const type2QuestionsCount = config.type2.biet + config.type2.hieu + config.type2.van_dung + config.type2.van_dung_cao;
    const type2SubItemsTotal = type2QuestionsCount * 4;
    const type2Total = { biet: config.type2.biet, hieu: config.type2.hieu, vd: config.type2.van_dung + config.type2.van_dung_cao };
    const type3Total = { biet: config.type3.biet, hieu: config.type3.hieu, vd: config.type3.van_dung + config.type3.van_dung_cao };
    const essayTotal = { biet: config.essay.biet, hieu: config.essay.hieu, vd: config.essay.van_dung + config.essay.van_dung_cao };

    const isGiuaKy = data.examType.includes('Giữa');
    const examTypeLabel = isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ';
    const semesterNum = data.examType.includes('1') ? 'I' : 'II';
    const footnotes = getSubjectFootnotes(data.subject);

    const templateName = getTemplateDisplayName(template);

    const template4SpecificRules = template === 'template4' ? `
  **===== QUY TẮC ĐẶC THÙ CỦA MẪU 4 (FILE 03 Ma trận.docx) — BẮT BUỘC TUÂN THỦ =====**
  1. **HEADER BẢNG (3 DÒNG):**
     - **Dòng 1:** \`TT\` (rowspan="3") | \`Chương / Chủ đề\` (rowspan="3") | \`Nội dung / Đơn vị kiến thức\` (rowspan="3") | \`Mức độ đánh giá\` (colspan = số dạng câu hỏi có sử dụng × 3) | \`Tổng số lệnh hỏi\` (colspan="3" rowspan="2") | \`% tổng điểm\` (rowspan="3")
     - **Dòng 2:** Chỉ liệt kê các dạng câu hỏi có số câu > 0 (mỗi dạng colspan="3"), ví dụ: \`TNKQ nhiều lựa chọn (I)\` | \`Trắc nghiệm Đúng - Sai (II)\` | \`Trả lời ngắn (III)\` (bỏ cột này nếu số câu Dạng III = 0) | \`Tự luận (IV)\` (bỏ cột này nếu số câu Tự luận = 0).
     - **Dòng 3:** Lặp lại 3 cột \`Biết | Hiểu | VD\` cho từng dạng câu hỏi + 3 cột \`Biết | Hiểu | VD\` dưới cột \`Tổng số lệnh hỏi\`.
  2. **CÁC DÒNG NỘI DUNG BÀI HỌC:**
     - Cột \`TT\`: đánh số 1, 2, 3...
     - Cột \`Chương / Chủ đề\`: ghi tên chương/chủ đề ở từng dòng bài học (không cần rowspan gộp chương, giống y hệt file 03 Ma trận.docx).
     - Cột \`Nội dung / Đơn vị kiến thức\`: ghi \`Tên bài học (X tiết)\` (có số tiết trong ngoặc đơn).
     - Các ô mức độ: ghi mã câu hỏi (ví dụ: \`I.1<br>I.2\`, \`II.1a<br>II.1b\`, \`II.1c\`, \`II.1d\`, \`III.1\`, \`IV.1\`...). Nếu nhiều mã câu trong cùng 1 ô thì xuống dòng bằng \`<br>\`.
     - 3 ô \`Tổng số lệnh hỏi\` (\`Biết | Hiểu | VD\`): ghi số lượng lệnh hỏi ở từng mức của hàng đó (ghi số \`0\` nếu mức đó không có lệnh hỏi, ví dụ: \`2 | 0 | 0\`, \`3 | 2 | 1\`).
     - Ô \`% tổng điểm\`: ghi tỉ lệ % điểm của hàng đó (ví dụ: \`5.0%\`, \`17.5%\`...).
  3. **FOOTER BẢNG (3 DÒNG CUỐI):**
     - **Dòng 1:** \`<td colspan="3" class="bold">Tổng số câu / lệnh hỏi</td>\` | tổng số lệnh hỏi theo từng cột Biết, Hiểu, VD của từng dạng (ghi \`0\` nếu trống) | tổng Biết | tổng Hiểu | tổng VD | \`X lệnh hỏi\` (ví dụ: \`16 lệnh hỏi\`).
     - **Dòng 2:** \`<td colspan="3" class="bold">Tổng số điểm</td>\` | điểm từng cột Biết, Hiểu, VD của từng dạng (ví dụ \`1.0\`, \`0.5\`, \`0.0\`) | điểm Biết | điểm Hiểu | điểm VD | \`10.0 điểm\`.
     - **Dòng 3:** \`<td colspan="3" class="bold">Tỉ lệ % điểm</td>\` | tỉ lệ % của từng dạng (mỗi dạng \`colspan="3"\`, ví dụ \`15%\`, \`20%\`, \`65%\`) | \`% Biết\` | \`% Hiểu\` | \`% VD\` | \`100%\`.
  4. **GHI CHÚ DƯỚI BẢNG:**
     - Dòng ghi chú: "Ghi chú: Các con số trong bảng thể hiện số lượng lệnh hỏi. Mỗi câu hỏi tại phần I là một lệnh hỏi; mỗi ý hỏi tại Phần II là một lệnh hỏi."
     - Tiếp theo là phần **CHÚ THÍCH NĂNG LỰC:** kèm (1), (2), (3).
` : '';

    return `
  Hãy tạo **MA TRẬN ĐỀ KIỂM TRA** (HTML Table) cho môn **${data.subject}**, khối **Lớp ${data.grade}**.

  **⚠️ QUAN TRỌNG: SINH THEO MẪU HTML BÊN DƯỚI ⚠️**
  Cuối prompt có phần "NỘI DUNG FILE MẪU" chứa HTML của **${templateName}**.
  BẠN PHẢI:
  1. ĐỌC KĨ nội dung HTML mẫu để hiểu cấu trúc bảng ma trận: header, cách chia cột, cách merge cell, cách ghi mã câu, cách tính điểm, format footer.
  2. SINH MA TRẬN MỚI **THEO ĐÚNG CẤU TRÚC BẢN MẪU** (giữ nguyên format bảng, cách chia cột, cách ghi header, cách ghi mã câu, cách tính điểm).
  3. CHỈ THAY ĐỔI nội dung (tên chương, bài học, phân bổ câu hỏi) dựa trên DỮ LIỆU ĐẦU VÀO bên dưới.
  4. GIỮ NGUYÊN style CSS, kiểu merge cell, kiểu header y hệt file mẫu.
  ${template4SpecificRules}

  **CẤU HÌNH ĐỀ THI:**
  - Loại đề: ${data.examType} (Kiểm tra ${examTypeLabel} ${semesterNum})
  - Thời gian: ${data.duration} phút
  - Tổng số tiết trọng tâm: ${totalSelectedPeriods} tiết

  **CẤU TRÚC SỐ LƯỢNG CÂU HỎI (PHẢI KHỚP CHÍNH XÁC):**
  - Lưu ý Dạng II (Đúng-Sai): Cấu hình có **${type2QuestionsCount} câu** Đúng-Sai, mỗi câu gồm **4 ý lệnh hỏi (a, b, c, d)** → Tổng cộng **${type2SubItemsTotal} ý lệnh hỏi** phân bổ vào Biết, Hiểu, VD.

  | Dạng câu hỏi         | Số câu | Số lệnh hỏi (ý) | Chi tiết phân bổ |
  |---------------------|--------|-----------------|------------------|
  | Dạng I (4 lựa chọn)  | ${type1Total.biet + type1Total.hieu + type1Total.vd} câu | ${type1Total.biet + type1Total.hieu + type1Total.vd} | Biết: ${type1Total.biet}, Hiểu: ${type1Total.hieu}, VD: ${type1Total.vd} |
  | Dạng II (Đúng-Sai)   | ${type2QuestionsCount} câu | ${type2SubItemsTotal} ý | Mỗi câu 4 ý a,b,c,d (Tổng ${type2SubItemsTotal} ý phân bổ vào Biết, Hiểu, VD) |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet + type3Total.hieu + type3Total.vd} câu | ${type3Total.biet + type3Total.hieu + type3Total.vd} | Biết: ${type3Total.biet}, Hiểu: ${type3Total.hieu}, VD: ${type3Total.vd} |
  ${hasEssay ? `| Tự luận (IV)       | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} câu | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} | Biết: ${essayTotal.biet}, Hiểu: ${essayTotal.hieu}, VD: ${essayTotal.vd} |` : '| Tự luận            | 0 câu | 0 | 0 — KHÔNG TẠO CỘT TỰ LUẬN |'}

  **DỮ LIỆU ĐẦU VÀO (Chương + Bài học):**
  ${JSON.stringify(selectedChapters, null, 2)}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra Full HTML Document (<!DOCTYPE html>...).
  2. Tiêu đề: "MA TRẬN ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} – NĂM HỌC 20... - 20..."
  3. **QUY TẮC NĂM HỌC:** Thông tin năm học phải ĐỂ TRỐNG: "NĂM HỌC 20... - 20...".
  4. Phân bổ câu hỏi theo tỷ lệ số tiết.
  5. Tổng số câu/ý phải khớp chính xác cấu hình. Nếu dạng câu hỏi nào có tổng số câu = 0 thì KHÔNG tạo cột cho dạng đó.
  6. Điểm số là bội số 0.25, tổng = 10.
  7. CẤU TRÚC BẢNG HTML phải giống HTML mẫu ở cuối prompt (header, merge cells, footer).

  **CHÚ THÍCH NĂNG LỰC (Cuối bảng):**
  ${footnotes}

  **Style CSS (Include in <style>):**
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.3; margin: 20px; }
  h2 { text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { border: 1px solid black; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { font-weight: bold; }
  .left-align { text-align: left; padding-left: 8px; }
  .bold { font-weight: bold; }
  `;
};

/**
 * Build prompt cho generateStep2Specs khi dùng mẫu 2, 3 hoặc 4
 */
export const buildSpecsPromptForCustomTemplate = (
    template: MatrixTemplate,
    matrixContent: string,
    data: InputData,
    selectedLessonIds: Set<string>,
    config: QuestionConfig,
): string => {
    const objectivesMap: string[] = [];
    data.chapters.forEach(c => (c.lessons || []).forEach(l => {
        if (selectedLessonIds.has(l.id)) {
            objectivesMap.push(`- Bài "${l.name}": \n   + Biết: ${l.objectives?.biet || '...'}\n   + Hiểu: ${l.objectives?.hieu || '...'}\n   + Vận dụng: ${l.objectives?.van_dung || '...'}\n   + Vận dụng cao: ${l.objectives?.van_dung_cao || '...'}`);
        }
    }));

    const totalEssayQuestions = config.essay.biet + config.essay.hieu + config.essay.van_dung + config.essay.van_dung_cao;
    const isGradeNoEssay = GRADE_NO_ESSAY.includes(data.grade);
    const hasEssay = !isGradeNoEssay && totalEssayQuestions > 0;

    const type1Total = { biet: config.type1.biet, hieu: config.type1.hieu, vd: config.type1.van_dung + config.type1.van_dung_cao };
    const type2QuestionsCount = config.type2.biet + config.type2.hieu + config.type2.van_dung + config.type2.van_dung_cao;
    const type2SubItemsTotal = type2QuestionsCount * 4;
    const type2Total = { biet: config.type2.biet, hieu: config.type2.hieu, vd: config.type2.van_dung + config.type2.van_dung_cao };
    const type3Total = { biet: config.type3.biet, hieu: config.type3.hieu, vd: config.type3.van_dung + config.type3.van_dung_cao };
    const essayTotal = { biet: config.essay.biet, hieu: config.essay.hieu, vd: config.essay.van_dung + config.essay.van_dung_cao };

    const isGiuaKy = data.examType.includes('Giữa');
    const examTypeLabel = isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ';
    const semesterNum = data.examType.includes('1') ? 'I' : 'II';
    const footnotes = getSubjectFootnotes(data.subject);
    const templateName = getTemplateDisplayName(template);

    return `
  Dựa trên **Ma trận đề kiểm tra** (HTML) đã tạo, hãy tạo **BẢNG ĐẶC TẢ ĐỀ KIỂM TRA** (Full HTML Document).

  **⚠️ QUAN TRỌNG: SINH THEO MẪU HTML BÊN DƯỚI ⚠️**
  Cuối prompt có phần "NỘI DUNG FILE MẪU" chứa HTML của **${templateName}**.
  BẠN PHẢI:
  1. ĐỌC KĨ nội dung HTML mẫu để hiểu cấu trúc bảng ĐẶC TẢ (nếu có bảng đặc tả trong file).
  2. SINH BẢNG ĐẶC TẢ MỚI **THEO ĐÚNG CẤU TRÚC BẢN MẪU** (giữ nguyên format, cách chia cột, header, merge cells).
  3. CHỈ THAY ĐỔI nội dung (tên chương, bài, yêu cầu cần đạt, phân bổ câu hỏi) dựa trên DỮ LIỆU ĐẦU VÀO.
  4. Nếu file mẫu chỉ có bảng Ma trận mà không có bảng Đặc tả riêng (như Mẫu 4 - file 03 Ma trận.docx), hãy tạo Bảng Đặc tả có cấu trúc cột dạng câu hỏi, cách đánh mã câu (I.1, II.1a, II.1b, II.1c, II.1d, III.1, IV.1...) và các dòng footer đồng bộ 100% với bảng Ma trận đầu vào, đồng thời có thêm cột "Yêu cầu cần đạt" chi tiết theo 3 mức Biết / Hiểu / Vận dụng cho từng bài học.

  **MA TRẬN ĐẦU VÀO:**
  ${matrixContent}

  **DỮ LIỆU YÊU CẦU CẦN ĐẠT:**
  ${objectivesMap.join('\n')}

  **BẢNG SỐ LƯỢNG GỐC (PHẢI KHỚP 100%):**
  | Dạng câu hỏi         | Số câu | Số lệnh hỏi (ý) | Chi tiết |
  |---------------------|--------|-----------------|----------|
  | Dạng I (4 lựa chọn)  | ${type1Total.biet + type1Total.hieu + type1Total.vd} câu | ${type1Total.biet + type1Total.hieu + type1Total.vd} | Biết: ${type1Total.biet}, Hiểu: ${type1Total.hieu}, VD: ${type1Total.vd} |
  | Dạng II (Đúng-Sai)   | ${type2QuestionsCount} câu | ${type2SubItemsTotal} ý | Mỗi câu 4 ý a,b,c,d (Tổng ${type2SubItemsTotal} ý) |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet + type3Total.hieu + type3Total.vd} câu | ${type3Total.biet + type3Total.hieu + type3Total.vd} | Biết: ${type3Total.biet}, Hiểu: ${type3Total.hieu}, VD: ${type3Total.vd} |
  ${hasEssay ? `| Tự luận (IV)       | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} câu | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} | Biết: ${essayTotal.biet}, Hiểu: ${essayTotal.hieu}, VD: ${essayTotal.vd} |` : ''}

  **YÊU CẦU OUTPUT:**
  1. Full HTML Document (<!DOCTYPE html>...).
  2. Tiêu đề: "ĐẶC TẢ ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} - NĂM HỌC 20... - 20..."
  3. **QUY TẮC NĂM HỌC:** Thông tin năm học phải ĐỂ TRỐNG: "NĂM HỌC 20... - 20...".
  4. Cột "Yêu cầu cần đạt" phải có nội dung chi tiết, text-align: left.
  5. Số câu hỏi và mã câu PHẢI khớp 100% với Ma trận đầu vào và BẢNG SỐ LƯỢNG GỐC.
  6. CẤU TRÚC BẢNG HTML phải đồng bộ với Ma trận đầu vào và HTML mẫu ở cuối prompt.

  **CHÚ THÍCH NĂNG LỰC:**
  ${footnotes}

  **Style CSS:**
  body { font-family: "Times New Roman", serif; font-size: 13pt; margin: 20px; }
  h2 { text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
  table { width: 100%; border-collapse: collapse; margin-top: 15px; }
  th, td { border: 1px solid black; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { font-weight: bold; }
  .left-align, .text-left { text-align: left; padding: 6px 8px; vertical-align: top; }
  .bold { font-weight: bold; }

  **KIỂM TRA CUỐI CÙNG:** Đếm tổng mã câu mỗi dạng/mức phải khớp:
  Dạng I: B=${type1Total.biet}/H=${type1Total.hieu}/VD=${type1Total.vd},
  Dạng II: ${type2QuestionsCount} câu (${type2SubItemsTotal} ý a,b,c,d),
  Dạng III: B=${type3Total.biet}/H=${type3Total.hieu}/VD=${type3Total.vd}
  ${hasEssay ? `, Tự luận: B=${essayTotal.biet}/H=${essayTotal.hieu}/VD=${essayTotal.vd}` : ''}
  `;
};

