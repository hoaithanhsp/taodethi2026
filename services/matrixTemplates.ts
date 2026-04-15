
import { MatrixTemplate, InputData, QuestionConfig } from '../types';
import { SYSTEM_INSTRUCTION, GRADE_NO_ESSAY, getSubjectFootnotes } from '../constants';

// ============================================
// TEMPLATE FILE PATHS (stored in public/templates/)
// ============================================
const TEMPLATE_FILES: Record<string, string> = {
    template2: '/templates/01_ma_tran_dac_ta.docx',
    template3: '/templates/02_ma_tran_dac_ta.docx',
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
];

// ============================================
// PROMPT BUILDERS FOR TEMPLATE 2 & 3
// ============================================

/**
 * Build prompt cho generateStep1Matrix khi dùng mẫu 2 hoặc 3
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
    const type2Total = { biet: config.type2.biet, hieu: config.type2.hieu, vd: config.type2.van_dung + config.type2.van_dung_cao };
    const type3Total = { biet: config.type3.biet, hieu: config.type3.hieu, vd: config.type3.van_dung + config.type3.van_dung_cao };
    const essayTotal = { biet: config.essay.biet, hieu: config.essay.hieu, vd: config.essay.van_dung + config.essay.van_dung_cao };

    const isGiuaKy = data.examType.includes('Giữa');
    const examTypeLabel = isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ';
    const semesterNum = data.examType.includes('1') ? 'I' : 'II';
    const footnotes = getSubjectFootnotes(data.subject);

    const templateName = template === 'template2' ? 'Mẫu 2 (file 01 MA TRẬN ĐẶC TẢ)' : 'Mẫu 3 (file 02 MA TRẬN ĐẶC TẢ)';

    return `
  Hãy tạo **MA TRẬN ĐỀ KIỂM TRA** (HTML Table) cho môn **${data.subject}**, khối **Lớp ${data.grade}**.

  **⚠️ QUAN TRỌNG: SINH THEO MẪU HTML BÊN DƯỚI ⚠️**
  Cuối prompt có phần "NỘI DUNG FILE MẪU" chứa HTML của **${templateName}**.
  BẠN PHẢI:
  1. ĐỌc KĨ nội dung HTML mẫu để hiểu cấu trúc bảng ma trận: header, cách chia cột, cách merge cell, cách ghi mã câu, cách tính điểm, format footer.
  2. SINH MA TRẬN MỚI **THEO ĐÚNG CẤU TRÚC BẢN MẪU** (giữ nguyên format bảng, cách chia cột, cách ghi header, cách ghi mã câu, cách tính điểm).
  3. CHỈ THAY ĐỔI nội dung (tên chương, bài học, phân bổ câu hỏi) dựa trên DỮ LIỆU ĐẦU VÀO bên dưới.
  4. GIỮ NGUYÊN style CSS, kiểu merge cell, kiểu header y hệt file mẫu.

  **CẤU HÌNH ĐỀ THI:**
  - Loại đề: ${data.examType} (Kiểm tra ${examTypeLabel} ${semesterNum})
  - Thời gian: ${data.duration} phút
  - Tổng số tiết trọng tâm: ${totalSelectedPeriods} tiết

  **CẤU TRÚC SỐ LƯỢNG CÂU HỎI (PHẢI KHỚP CHÍNH XÁC):**
  | Dạng câu hỏi         | Biết | Hiểu | VD  | TỔNG |
  |---------------------|------|------|-----|------|
  | Dạng I (4 lựa chọn)  | ${type1Total.biet}    | ${type1Total.hieu}    | ${type1Total.vd}   | ${type1Total.biet + type1Total.hieu + type1Total.vd}    |
  | Dạng II (Đúng-Sai) (ý) | ${type2Total.biet}    | ${type2Total.hieu}    | ${type2Total.vd}   | ${type2Total.biet + type2Total.hieu + type2Total.vd}    |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet}    | ${type3Total.hieu}    | ${type3Total.vd}   | ${type3Total.biet + type3Total.hieu + type3Total.vd}    |
  ${hasEssay ? `| Tự luận (IV)       | ${essayTotal.biet}    | ${essayTotal.hieu}    | ${essayTotal.vd}   | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd}    |` : '| Tự luận            | 0    | 0    | 0   | 0 — KHÔNG TẠO |'}

  **DỮ LIỆU ĐẦU VÀO (Chương + Bài học):**
  ${JSON.stringify(selectedChapters, null, 2)}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra Full HTML Document (<!DOCTYPE html>...).
  2. Tiêu đề: "MA TRẬN ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} – NĂM HỌC 20... - 20..."
  3. **QUY TẮC NĂM HỌC:** Thông tin năm học phải ĐỂ TRỐNG: "NĂM HỌC 20... - 20...".
  4. Phân bổ câu hỏi theo tỷ lệ số tiết.
  5. Tổng số câu/ý phải khớp chính xác cấu hình.
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
 * Build prompt cho generateStep2Specs khi dùng mẫu 2 hoặc 3
 */
export const buildSpecsPromptForCustomTemplate = (
    template: MatrixTemplate,
    matrixContent: string,
    data: InputData,
    selectedLessonIds: Set<string>,
    config: QuestionConfig,
): string => {
    const objectivesMap: string[] = [];
    data.chapters.forEach(c => c.lessons.forEach(l => {
        if (selectedLessonIds.has(l.id)) {
            objectivesMap.push(`- Bài "${l.name}": \n   + Biết: ${l.objectives.biet || '...'}\n   + Hiểu: ${l.objectives.hieu || '...'}\n   + Vận dụng: ${l.objectives.van_dung || '...'}\n   + Vận dụng cao: ${l.objectives.van_dung_cao || '...'}`);
        }
    }));

    const totalEssayQuestions = config.essay.biet + config.essay.hieu + config.essay.van_dung + config.essay.van_dung_cao;
    const hasEssay = totalEssayQuestions > 0;

    const type1Total = { biet: config.type1.biet, hieu: config.type1.hieu, vd: config.type1.van_dung + config.type1.van_dung_cao };
    const type2Total = { biet: config.type2.biet, hieu: config.type2.hieu, vd: config.type2.van_dung + config.type2.van_dung_cao };
    const type3Total = { biet: config.type3.biet, hieu: config.type3.hieu, vd: config.type3.van_dung + config.type3.van_dung_cao };
    const essayTotal = { biet: config.essay.biet, hieu: config.essay.hieu, vd: config.essay.van_dung + config.essay.van_dung_cao };

    const isGiuaKy = data.examType.includes('Giữa');
    const examTypeLabel = isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ';
    const semesterNum = data.examType.includes('1') ? 'I' : 'II';
    const footnotes = getSubjectFootnotes(data.subject);
    const templateName = template === 'template2' ? 'Mẫu 2 (file 01 MA TRẬN ĐẶC TẢ)' : 'Mẫu 3 (file 02 MA TRẬN ĐẶC TẢ)';

    return `
  Dựa trên **Ma trận đề kiểm tra** (HTML) đã tạo, hãy tạo **BẢNG ĐẶC TẢ ĐỀ KIỂM TRA** (Full HTML Document).

  **⚠️ QUAN TRỌNG: SINH THEO MẪU HTML BÊN DƯỚI ⚠️**
  Cuối prompt có phần "NỘI DUNG FILE MẪU" chứa HTML của **${templateName}**.
  BẠN PHẢI:
  1. ĐỌc KĨ nội dung HTML mẫu để hiểu cấu trúc bảng ĐẶC TẢ (nếu có bảng đặc tả trong file).
  2. SINH BẢNG ĐẶC TẢ MỚI **THEO ĐÚNG CẤU TRÚC BẢN MẪU** (giữ nguyên format, cách chia cột, header, merge cells).
  3. CHỈ THAY ĐỔI nội dung (tên chương, bài, yêu cầu cần đạt, phân bổ câu hỏi) dựa trên DỮ LIỆU ĐẦU VÀO.
  4. Nếu file mẫu không có bảng đặc tả riêng, hãy tạo bảng đặc tả phù hợp với cấu trúc ma trận trong file mẫu.

  **MA TRẬN ĐẦU VÀO:**
  ${matrixContent}

  **DỮ LIỆU YÊU CẦU CẦN ĐẠT:**
  ${objectivesMap.join('\\n')}

  **BẢNG SỐ LƯỢNG GỐC (PHẢI KHỚP 100%):**
  | Dạng câu hỏi         | Biết | Hiểu | VD  | TỔNG |
  |---------------------|------|------|-----|------|
  | Dạng I (4 lựa chọn)  | ${type1Total.biet}    | ${type1Total.hieu}    | ${type1Total.vd}   | ${type1Total.biet + type1Total.hieu + type1Total.vd}    |
  | Dạng II (Đúng-Sai) (ý) | ${type2Total.biet}    | ${type2Total.hieu}    | ${type2Total.vd}   | ${type2Total.biet + type2Total.hieu + type2Total.vd}    |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet}    | ${type3Total.hieu}    | ${type3Total.vd}   | ${type3Total.biet + type3Total.hieu + type3Total.vd}    |
  ${hasEssay ? `| Tự luận (IV)       | ${essayTotal.biet}    | ${essayTotal.hieu}    | ${essayTotal.vd}   | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd}    |` : ''}

  **YÊU CẦU OUTPUT:**
  1. Full HTML Document (<!DOCTYPE html>...).
  2. Tiêu đề: "ĐẶC TẢ ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} - NĂM HỌC 20... - 20..."
  3. **QUY TẮC NĂM HỌC:** Thông tin năm học phải ĐỂ TRỐNG: "NĂM HỌC 20... - 20...".
  4. Cột "Yêu cầu cần đạt" phải có nội dung chi tiết, text-align: left.
  5. Số câu hỏi và mã câu PHẢI khớp 100% với BẢNG SỐ LƯỢNG GỐC.
  6. CẤU TRÚC BẢNG HTML phải giống HTML mẫu ở cuối prompt.

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
  Dạng II: B=${type2Total.biet}/H=${type2Total.hieu}/VD=${type2Total.vd} (ý),
  Dạng III: B=${type3Total.biet}/H=${type3Total.hieu}/VD=${type3Total.vd}
  ${totalEssayQuestions > 0 ? `, Tự luận: B=${essayTotal.biet}/H=${essayTotal.hieu}/VD=${essayTotal.vd}` : ''}
  `;
};
