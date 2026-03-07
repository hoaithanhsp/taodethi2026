
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_INSTRUCTION, MODEL_NAME, FALLBACK_MODELS } from '../constants';
import { InputData, QuestionConfig } from '../types';

// --- API Key Management (localStorage-based) ---
const API_KEY_STORAGE_KEY = 'examcraft_api_key';

export const getApiKey = (): string | null => {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
};

export const setApiKey = (key: string): void => {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
};

export const removeApiKey = (): void => {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
};

const getAI = (): GoogleGenAI => {
  const key = getApiKey();
  if (!key) throw new Error("Chưa có API Key. Vui lòng nhập API Key trong phần Settings.");
  return new GoogleGenAI({ apiKey: key });
};

// --- Fallback wrapper: try models in order ---
const callWithFallback = async (
  promptFn: (ai: GoogleGenAI, model: string) => Promise<string>
): Promise<string> => {
  const ai = getAI();
  const modelsToTry = [MODEL_NAME, ...FALLBACK_MODELS.filter(m => m !== MODEL_NAME)];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[ExamCraft] Trying model: ${model}`);
      return await promptFn(ai, model);
    } catch (err: any) {
      lastError = err;
      console.warn(`[ExamCraft] Model ${model} failed:`, err.message || err);
      // Check if it's a quota error
      if (err.message?.includes('quota') || err.message?.includes('429') || err.status === 429) {
        console.warn(`[ExamCraft] Quota exceeded for ${model}, trying next model...`);
      }
      continue;
    }
  }

  // All models failed
  if (lastError?.message?.includes('quota') || lastError?.message?.includes('429')) {
    throw new Error("Tất cả model đều hết quota. Vui lòng lấy API key của Gmail khác để dán vào dùng tiếp, hoặc chờ đến hôm sau.");
  }
  throw new Error(`Lỗi API Gemini: ${lastError?.message || 'Không xác định'}`);
};

// --- File utilities ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// --- Service Functions ---

export const convertMatrixFileToHtml = async (file: File): Promise<string> => {
  const base64Data = await fileToBase64(file);

  const prompt = `
    Bạn là một chuyên gia chuyển đổi dữ liệu.
    Tài liệu đính kèm là một **MA TRẬN ĐỀ THI** (dạng ảnh, PDF hoặc Word).
    Nhiệm vụ của bạn là:
    1. Đọc nội dung bảng ma trận trong tài liệu.
    2. Chuyển đổi toàn bộ nội dung đó thành một bảng **HTML Table** chuẩn.
    
    YÊU CẦU KỸ THUẬT:
    - Giữ nguyên cấu trúc merge cells (rowspan, colspan) của bản gốc.
    - Font chữ: Times New Roman, size 13pt.
    - Table border: 1px solid black.
    - Output: Chỉ trả về mã HTML của bảng (<table>...</table>) hoặc (<!DOCTYPE html>...), KHÔNG bao gồm markdown \`\`\`.
    - Nếu không đọc được, hãy trả về thông báo lỗi trong thẻ <p>.
  `;

  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg', data: base64Data } },
          { text: prompt }
        ]
      },
    });
    const text = response.text || "";
    return text.replace(/```html/g, '').replace(/```/g, '');
  } catch (error) {
    console.error("Error converting matrix:", error);
    throw new Error("Không thể chuyển đổi file ma trận này. Vui lòng thử lại.");
  }
};

export const extractInfoFromDocument = async (file: File, selectedSubject?: string, selectedGrade?: string): Promise<Partial<InputData>> => {
  const base64Data = await fileToBase64(file);

  let subjectConstraint = "";
  if (selectedSubject && selectedGrade) {
    subjectConstraint = `
    **ĐẶC BIỆT LƯU Ý MÔN VÀ LỚP BẮT BUỘC:** 
    - Người dùng ĐÃ CHỌN TRƯỚC: Môn học là "${selectedSubject}" và Khối lớp là "${selectedGrade}".
    - TUYỆT ĐỐI CHỈ trích xuất nội dung của môn "${selectedSubject}" lớp "${selectedGrade}". 
    - NẾU file có chứa nhiều môn khác hay khối lớp khác, HÃY BỎ QUA chúng.
    - Không được tự động đổi sang khối lớp khác hay môn học khác. Cố gắng tìm phần biểu diễn liên quan nhất.
    `;
  }

  const prompt = `
    Bạn là chuyên gia phân tích chương trình giáo dục Việt Nam. Hãy đọc file đính kèm (Kế hoạch dạy học/PPCT) và trích xuất dữ liệu cấu trúc cực kỳ chi tiết.

    **===== NGUYÊN TẮC VÀNG: CHỈ TRÍCH XUẤT, KHÔNG SÁNG TẠO =====**
    1. TUYỆT ĐỐI CHỈ trích xuất nội dung CÓ SẴN trong file đính kèm. KHÔNG ĐƯỢC tự bịa đặt, suy luận, hay thêm bất kỳ thông tin nào không có trong tài liệu.
    2. Tên môn học, tên chương, tên bài học, nội dung yêu cầu cần đạt PHẢI lấy NGUYÊN VĂN từ file gốc.
    3. KHÔNG ĐƯỢC nhầm lẫn nội dung giữa các môn học. Ví dụ: nếu file là PPCT Tin học thì chỉ được trích xuất nội dung Tin học, KHÔNG ĐƯỢC trả về nội dung của môn Toán, Lý, Hóa hay bất kỳ môn nào khác.
    4. Nếu không đọc được rõ một phần nào đó trong file, hãy ghi "Không đọc được" thay vì bịa nội dung.
    ${subjectConstraint}

    **NGÔN NGỮ BẮT BUỘC: TIẾNG VIỆT**
    - Toàn bộ output PHẢI bằng TIẾNG VIỆT, giữ nguyên như trong tài liệu gốc.
    - KHÔNG ĐƯỢC dịch sang tiếng Anh. Ví dụ: "Tin học" ≠ "Informatics", "Công nghệ" ≠ "Technology".

    Yêu cầu đầu ra: JSON Object (không markdown) với cấu trúc sau:
    {
      "subject": "Tên môn học chính xác như trong file (TIẾNG VIỆT)",
      "grade": "Khối lớp chính xác như trong file",
      "chapters": [
        {
          "id": "c1",
          "name": "Tên chương CHÍNH XÁC từ file gốc",
          "totalPeriods": 10,
          "lessons": [
            {
              "id": "c1_l1",
              "name": "Tên bài học CHÍNH XÁC từ file gốc",
              "periods": 2,
              "weekStart": 1,
              "weekEnd": 1,
              "objectives": {
                "biet": "Trích xuất nguyên văn yêu cầu cần đạt mức Biết từ file",
                "hieu": "Trích xuất nguyên văn yêu cầu cần đạt mức Hiểu từ file",
                "van_dung": "Trích xuất nguyên văn yêu cầu cần đạt mức Vận dụng từ file"
              }
            }
          ]
        }
      ]
    }

    Lưu ý quan trọng:
    1. Hãy cố gắng nhận diện số tiết và tuần học của từng bài. Nếu không ghi rõ, hãy ước lượng dựa trên tổng số tiết.
    2. Phần "objectives" (Yêu cầu cần đạt) là QUAN TRỌNG NHẤT. Hãy trích xuất NGUYÊN VĂN từ cột "Yêu cầu cần đạt" trong bảng PPCT. KHÔNG ĐƯỢC tự viết lại hay diễn giải.
    3. Nếu tài liệu là PDF dạng ảnh, hãy dùng khả năng Vision để đọc kỹ bảng biểu.
    4. Xác định chính xác môn học từ NỘI DUNG THỰC TẾ trong file (tiêu đề, header, nội dung bài học), không đoán mò.
    5. NHẮC LẠI: Toàn bộ giá trị JSON phải bằng TIẾNG VIỆT, trích xuất nguyên văn từ file, không bịa đặt.
  `;

  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType: file.type === 'application/pdf' ? 'application/pdf' : 'text/plain', data: base64Data } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text || "{}";
    try {
      const parsed = JSON.parse(text);
      return parsed;
    } catch (e) {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '');
      return JSON.parse(cleaned);
    }
  } catch (error) {
    console.error("Error extracting info:", error);
    return {};
  }
};

export const generateStep1Matrix = async (
  data: InputData,
  selectedLessonIds: Set<string>
): Promise<string> => {

  const selectedChapters: any[] = [];
  let totalSelectedPeriods = 0;

  data.chapters.forEach(chap => {
    const activeLessons = chap.lessons.filter(l => selectedLessonIds.has(l.id));
    if (activeLessons.length > 0) {
      selectedChapters.push({
        name: chap.name,
        lessons: activeLessons.map(l => ({
          name: l.name,
          periods: l.periods
        }))
      });
      totalSelectedPeriods += activeLessons.reduce((sum, l) => sum + (l.periods || 1), 0);
    }
  });

  const config = data.questionConfig;

  const totalEssayQuestions = config.essay.biet + config.essay.hieu + config.essay.van_dung;
  const hasEssay = totalEssayQuestions > 0;

  let scoringInstructions = "";
  let columnStructureInstructions = "";

  if (hasEssay) {
    scoringInstructions = `
    **KỊCH BẢN A: CÓ TỰ LUẬN (Tổng 10 điểm)**
    - Dạng I: 3.0 điểm. (Mỗi câu **0.25 điểm**).
    - Dạng II: 2.0 điểm. (Mỗi câu **0.5 điểm**).
    - Dạng III: 2.0 điểm. (Mỗi câu khoảng **0.33 điểm** -> Bắt buộc làm tròn tổng điểm hàng về bội 0.25).
    - Tự luận: 3.0 điểm. (Mỗi câu tùy độ khó).
    `;
    columnStructureInstructions = `
    **CẤU TRÚC BẢNG (16 Cột):**
    1. STT | 2. Chủ đề | 3. Nội dung/ĐVKT
    4-6. Dạng I (Biết, Hiểu, VD)
    7-9. Dạng II (Biết, Hiểu, VD)
    10-12. Dạng III (Biết, Hiểu, VD)
    13-15. Tự luận (Biết, Hiểu, VD)
    16. Tổng điểm (rowspan=3)
    `;
  } else {
    scoringInstructions = `
    **KỊCH BẢN B: KHÔNG TỰ LUẬN (Tổng 10 điểm)**
    - Dạng I: 3.0 điểm. (Mỗi câu **0.25 điểm**).
    - Dạng II: 4.0 điểm. (Mỗi câu **1.0 điểm**).
    - Dạng III: 3.0 điểm. (Mỗi câu **0.5 điểm**).
    - Tự luận: 0.0 điểm (KHÔNG CÓ PHẦN NÀY).
    `;
    columnStructureInstructions = `
    **CẤU TRÚC BẢNG (13 Cột):**
    1. STT | 2. Chủ đề | 3. Nội dung/ĐVKT
    4-6. Dạng I (Biết, Hiểu, VD)
    7-9. Dạng II (Biết, Hiểu, VD)
    10-12. Dạng III (Biết, Hiểu, VD)
    13. Tổng điểm (rowspan=3)
    `;
  }

  const prompt = `
  Hãy tạo **MA TRẬN ĐỀ KIỂM TRA** (HTML Table) cho môn **${data.subject}**, khối **${data.grade}**.
  
  **CẤU HÌNH ĐỀ THI:**
  - Loại đề: ${data.examType}
  - Thời gian: ${data.duration} phút
  - Tổng số tiết trọng tâm: ${totalSelectedPeriods} tiết
  
  **CẤU TRÚC SỐ LƯỢNG CÂU HỎI (Bắt buộc tuân thủ):**
  - Nhiều lựa chọn (Dạng I): Biết ${config.type1.biet}, Hiểu ${config.type1.hieu}, VD ${config.type1.van_dung}
  - Đúng - Sai (Dạng II): Biết ${config.type2.biet}, Hiểu ${config.type2.hieu}, VD ${config.type2.van_dung}
  - Trả lời ngắn (Dạng III): Biết ${config.type3.biet}, Hiểu ${config.type3.hieu}, VD ${config.type3.van_dung}
  - Tự luận: Biết ${config.essay.biet}, Hiểu ${config.essay.hieu}, VD ${config.essay.van_dung}
  
  ${scoringInstructions}

  **===== ĐỊNH DẠNG BẢNG BẮT BUỘC (Rất quan trọng - phải tuân thủ 100%) =====**

  Tiêu đề bảng (in đậm, căn giữa, ở trên bảng):
  **MA TRẬN ĐỀ KIỂM TRA ... - ${data.subject.toUpperCase()} ${data.grade.toUpperCase()}**

  **HEADER BẢNG (3 tầng merge):**
  - Tầng 1 (Row 1): 
    + TT (rowspan=3) | Chương/chủ đề (rowspan=3) | Nội dung/đơn vị kiến thức (rowspan=3) | "Mức độ đánh giá" (colspan= tổng cột TNKQ) | Tổng số câu (colspan=3) | Tỉ lệ % điểm (rowspan=3)
  - Tầng 2 (Row 2):
    + "TNKQ" (colspan= tổng cột TNKQ)
  - Tầng 3 (Row 3):
    + "Nhiều lựa chọn" (colspan=3) → rồi bên dưới nó: Biết | Hiểu | VD
    + "Đúng - Sai" (colspan=3) → bên dưới: Biết | Hiểu | VD  
    + "Trả lời ngắn" (colspan=3) → bên dưới: Biết | Hiểu | VD
    + Biết | Hiểu | VD (cho cột Tổng số câu)

  Thực tế header cần 4 dòng:
  - Dòng header 1: TT(rowspan=4) | Chương/chủ đề(rowspan=4) | Nội dung/đơn vị kiến thức(rowspan=4) | Mức độ đánh giá(colspan=9 hoặc 12 tùy có tự luận) | Tổng số câu(colspan=3, rowspan=2) | Tỉ lệ % điểm(rowspan=4)
  - Dòng header 2: TNKQ(colspan=9 hoặc 12)
  - Dòng header 3: Nhiều lựa chọn(colspan=3) | Đúng - Sai(colspan=3) | Trả lời ngắn(colspan=3) ${hasEssay ? '| Tự luận(colspan=3)' : ''} | Biết | Hiểu | VD
  - Dòng header 4: Biết | Hiểu | VD | Biết | Hiểu | VD | Biết | Hiểu | VD ${hasEssay ? '| Biết | Hiểu | VD' : ''}

  ${hasEssay ? 'Nếu CÓ tự luận: thêm cột "Tự luận" (colspan=3) sau "Trả lời ngắn", header TNKQ colspan tăng thêm 3.' : 'KHÔNG CÓ tự luận => KHÔNG tạo cột Tự luận.'}

  **NỘI DUNG BẢNG - MỖI BÀI HỌC CÓ 2 DÒNG (sub-row):**
  Với mỗi bài học (Nội dung/ĐVKT), tạo CHÍNH XÁC **2 dòng** (2 <tr>):

  **Dòng 1 (Số lượng câu hỏi):**
  - Ô "Nội dung" ghi: Tên bài + (X tiết) — dùng rowspan=2
  - Các ô Biết/Hiểu/VD của từng dạng: Ghi SỐ LƯỢNG câu hỏi (ví dụ: 2, 1, 0, ...)
  - Ô "Tổng số câu" Biết/Hiểu/VD: rowspan=2, tính tổng theo hàng ngang
  - Ô "Tỉ lệ % điểm": rowspan=2, ví dụ "15,0%", "25,0%"

  **Dòng 2 (Tên điểm / Mã câu):**
  - Các ô Biết/Hiểu/VD: Ghi viết tắt loại điểm, ví dụ:
    + "TD" (Tổng điểm) cho dạng Nhiều lựa chọn
    + "TD" cho Đúng - Sai, "GQVĐ" khi cần
    + Nếu có câu hỏi ở ô đó, ghi "TD" hoặc mã điểm. Nếu KHÔNG có ô đó (0 câu), để TRỐNG.
  
  **Merge cells STT & Chương/chủ đề:** 
  - Nếu 1 chương có nhiều bài => cột TT dùng rowspan = (số bài × 2), cột Chương/chủ đề cũng rowspan = (số bài × 2).

  **FOOTER BẢNG (3 dòng cuối):**
  1. **Tổng số câu**: Tổng cộng số câu hỏi theo từng cột Biết/Hiểu/VD của từng dạng + tổng toàn bảng cuối.
  2. **Tổng số điểm**: Tổng điểm theo từng cột + tổng cuối = 10.
  3. **Tỉ lệ % điểm của ma trận**: "30%", "40%", "30%"... cho mỗi nhóm dạng, cuối cùng 100%.

  **QUY TẮC ĐIỂM SỐ VÀNG (BẮT BUỘC):**
  1. Mọi điểm số PHẢI là bội số của 0.25.
  2. TUYỆT ĐỐI KHÔNG dùng 0.33, 0.42...
  3. Tổng điểm toàn bảng = 10.
  4. Nếu số lượng câu hỏi của một Dạng = 0, thì KHÔNG TẠO cột cho dạng đó.

  **DỮ LIỆU ĐẦU VÀO:**
  ${JSON.stringify(selectedChapters, null, 2)}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra Full HTML Document (<!DOCTYPE html>...). 
  2. Tiêu đề bảng (h2, căn giữa, in đậm): "MA TRẬN ĐỀ KIỂM TRA ... - ${data.subject.toUpperCase()} ${data.grade.toUpperCase()}"
  3. Phân bổ câu hỏi theo tỷ lệ số tiết: bài nhiều tiết hơn → nhiều câu hơn.
  4. **QUAN TRỌNG VỚI DẠNG II (Đúng/Sai):** Nếu 1 câu hỏi có nhiều ý chia ở các mức khác nhau, ghi rõ (C13a,b ở Biết, C13c,d ở Hiểu).
  5. Đảm bảo tổng số câu của mỗi dạng khớp chính xác cấu hình.

  **Style CSS (Include in <style>):**
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.3; margin: 20px; }
  h2 { text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { border: 1px solid black; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { font-weight: bold; }
  .left-align { text-align: left; padding-left: 8px; }
  .bold { font-weight: bold; }
  `;

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
      },
    });
    return response.text || "Lỗi tạo ma trận.";
  });
};

export const generateStep2Specs = async (
  matrixContent: string,
  data: InputData,
  selectedLessonIds: Set<string>
): Promise<string> => {

  const objectivesMap: string[] = [];
  data.chapters.forEach(c => c.lessons.forEach(l => {
    if (selectedLessonIds.has(l.id)) {
      objectivesMap.push(`- Bài "${l.name}": \n   + Biết: ${l.objectives.biet || '...'}\n   + Hiểu: ${l.objectives.hieu || '...'}\n   + Vận dụng: ${l.objectives.van_dung || '...'}`);
    }
  }));

  const prompt = `
  Dựa trên **Ma trận đề kiểm tra** (HTML) đã tạo, hãy tạo **BẢNG ĐẶC TẢ ĐỀ KIỂM TRA** (Full HTML Document).
  Phân tích HTML ma trận để lấy số lượng câu hỏi, mã câu, cấu trúc cột chính xác.

  **MA TRẬN ĐẦU VÀO:**
  ${matrixContent}

  **DỮ LIỆU YÊU CẦU CẦN ĐẠT:**
  ${objectivesMap.join('\\n')}

  **===== ĐỊNH DẠNG BẢNG ĐẶC TẢ BẮT BUỘC (Tuân thủ 100%) =====**

  Tiêu đề bảng (in đậm, căn giữa, ở trên bảng):
  **ĐẶC TẢ ĐỀ KIỂM TRA ... - ${data.subject.toUpperCase()} ${data.grade.toUpperCase()}**

  **HEADER BẢNG (4 dòng, giống hệt ma trận nhưng thêm cột "Yêu cầu cần đạt"):**
  - Dòng header 1: TT(rowspan=4) | Chương/chủ đề(rowspan=4) | Nội dung/đơn vị kiến thức(rowspan=4) | **Yêu cầu cần đạt**(rowspan=4) | Mức độ đánh giá(colspan=...) | Tổng số câu(colspan=3, rowspan=2) | Tỉ lệ % điểm(rowspan=4)
  - Dòng header 2: TNKQ(colspan=...)
  - Dòng header 3: Nhiều lựa chọn(colspan=3) | Đúng - Sai(colspan=3) | Trả lời ngắn(colspan=3) [+ Tự luận(colspan=3) nếu có] | Biết | Hiểu | VD
  - Dòng header 4: Biết | Hiểu | VD | Biết | Hiểu | VD | Biết | Hiểu | VD [+ Biết | Hiểu | VD nếu có tự luận]

  CẤU TRÚC CỘT PHẢI **KHỚP 100%** với Ma trận (nếu Ma trận không có Tự luận → Đặc tả cũng không có).

  **NỘI DUNG BẢNG - MỖI BÀI HỌC CÓ 2 DÒNG (sub-row):**
  Với mỗi bài học, tạo CHÍNH XÁC **2 dòng** (2 <tr>):

  **Dòng 1:**
  - Ô "Nội dung/ĐVKT" ghi: Tên bài + (X tiết) — dùng rowspan=2
  - Ô "Yêu cầu cần đạt" (rowspan=2): Ghi chi tiết nội dung yêu cầu cần đạt theo format:
    ***Nhận biết :***
    – Chi tiết nội dung biết...
    ***Thông hiểu:***
    – Chi tiết nội dung hiểu...
    ***Vận dụng :***
    – Chi tiết nội dung vận dụng...
    (Lấy nội dung từ DỮ LIỆU YÊU CẦU CẦN ĐẠT bên trên)
  - Các ô Biết/Hiểu/VD của từng dạng: SỐ LƯỢNG câu hỏi (khớp Ma trận)
  - Ô "Tổng số câu" + "Tỉ lệ %" : rowspan=2, giống Ma trận

  **Dòng 2:**
  - Các ô Biết/Hiểu/VD: Ghi "TD", "GQVĐ", hoặc để trống (giống Ma trận)

  **Merge cells STT & Chương/chủ đề:**
  - Nếu 1 chương có nhiều bài => cột TT rowspan = (số bài × 2), cột Chương/chủ đề cũng rowspan = (số bài × 2).

  **FOOTER BẢNG (3 dòng cuối - giống hệt Ma trận):**
  1. **Tổng số câu:** Tổng theo từng cột + tổng cuối
  2. **Tổng số điểm:** Tổng theo từng cột + tổng = 10
  3. **Tỉ lệ % điểm của ma trận:** 30%, 40%, 30%... cuối = 100%

  **QUAN TRỌNG:**
  - Cột "Yêu cầu cần đạt" phải đủ rộng, text-align: left, chứa nội dung chi tiết
  - Số câu hỏi và mã câu PHẢI khớp 100% với Ma trận
  - Nếu Ma trận ghi "GQVĐ" ở ô nào, Đặc tả cũng ghi y chang

  **QUY TẮC CHÚ THÍCH (FOOTNOTES) - BẮT BUỘC:**
  Cuối bảng thêm:
  (1): Năng lực tư duy và lập luận toán học
  (2): Năng lực mô hình hóa toán học
  (3): Năng lực giải quyết vấn đề toán học

  **Style CSS:**
  body { font-family: "Times New Roman", serif; font-size: 13pt; margin: 20px; }
  h2 { text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
  table { width: 100%; border-collapse: collapse; margin-top: 15px; }
  th, td { border: 1px solid black; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { font-weight: bold; }
  .left-align, .text-left { text-align: left; padding: 6px 8px; vertical-align: top; }
  .bold { font-weight: bold; }
  `;

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.2,
      },
    });
    return response.text || "Lỗi tạo đặc tả.";
  });
};

export const generateStep3Exam = async (
  specsContent: string,
  questionConfig: QuestionConfig
): Promise<string> => {

  const counts = {
    type1: questionConfig.type1.biet + questionConfig.type1.hieu + questionConfig.type1.van_dung,
    type2: questionConfig.type2.biet + questionConfig.type2.hieu + questionConfig.type2.van_dung,
    type3: questionConfig.type3.biet + questionConfig.type3.hieu + questionConfig.type3.van_dung,
    essay: questionConfig.essay.biet + questionConfig.essay.hieu + questionConfig.essay.van_dung,
  };

  let structureInstructions = "**CẤU TRÚC ĐỀ THI & ĐÁP ÁN CẦN TẠO (CHỈ TẠO CÁC PHẦN SAU):**\n";

  if (counts.type1 > 0) {
    structureInstructions += `- **PHẦN I (Trắc nghiệm nhiều lựa chọn):** Tạo ${counts.type1} câu hỏi và Đáp án Phần I.\n`;
  } else {
    structureInstructions += `- **PHẦN I:** KHÔNG ĐƯỢC TẠO (Số câu = 0). Bỏ qua hoàn toàn.\n`;
  }

  if (counts.type2 > 0) {
    structureInstructions += `- **PHẦN II (Đúng/Sai):** Tạo ${counts.type2} câu hỏi (mỗi câu 4 ý a,b,c,d) và Đáp án Phần II.\n`;
  } else {
    structureInstructions += `- **PHẦN II:** KHÔNG ĐƯỢC TẠO (Số câu = 0). Bỏ qua hoàn toàn.\n`;
  }

  if (counts.type3 > 0) {
    structureInstructions += `- **PHẦN III (Trả lời ngắn):** Tạo ${counts.type3} câu hỏi và Đáp án Phần III.\n`;
  } else {
    structureInstructions += `- **PHẦN III:** KHÔNG ĐƯỢC TẠO (Số câu = 0). Bỏ qua hoàn toàn.\n`;
  }

  if (counts.essay > 0) {
    structureInstructions += `- **PHẦN IV (Tự luận):** Tạo ${counts.essay} câu hỏi và Đáp án/Hướng dẫn chấm chi tiết Phần IV.\n`;
  } else {
    structureInstructions += `- **PHẦN IV:** KHÔNG ĐƯỢC TẠO (Số câu = 0). TUYỆT ĐỐI KHÔNG SINH RA PHẦN TỰ LUẬN.\n`;
  }

  const prompt = `
  Dựa trên **Bảng đặc tả** sau (HTML):
  ${specsContent}

  Hãy soạn thảo **ĐỀ THI HOÀN CHỈNH** và **HƯỚNG DẪN CHẤM**.
  
  ${structureInstructions}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra một **Full HTML Document** (<!DOCTYPE html>...). 
  2. **Style CSS (Include in <style>):**
     - body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.5; color: #000; }
     - h3, h4 { text-align: center; font-weight: bold; margin-top: 20px; }
     - p { margin-bottom: 10px; }
     - .question-number { font-weight: bold; }
     - .options { margin-left: 20px; }
     - .option-item { margin-bottom: 5px; }

  **QUY TẮC FORMAT NGHIÊM NGẶT ĐỂ XUẤT WORD:**
  
  1. **HEADER:** Sau tiêu đề ĐỀ THI, phải có thông tin: Thời gian, Họ tên, SBD...
  2. **PHẦN:** Sau tiêu đề mỗi PHẦN (PHẦN I, PHẦN II...), nội dung bắt đầu ở dòng tiếp theo.
  3. **CÂU HỎI TRẮC NGHIỆM:**
     - Sử dụng thẻ <p> cho mỗi câu hỏi.
     - Bắt đầu: <span class="question-number">Câu X.</span> Nội dung...
     - Các đáp án A, B, C, D phải được ngắt dòng rõ ràng (dùng <br> hoặc <div class="option-item">).
     - **VÍ DỤ:**
       <p><span class="question-number">Câu 1.</span> Thủ đô của Việt Nam là?</p>
       <div class="options">
         <div class="option-item">A. Hà Nội</div>
         <div class="option-item">B. Huế</div>
         <div class="option-item">C. Đà Nẵng</div>
         <div class="option-item">D. TP.HCM</div>
       </div>
       <br> <!-- Dòng trống giữa các câu -->

  4. **LOGIC DẠNG II (Đúng/Sai):**
     - Nếu Bảng đặc tả ghi **C13a,b** (Biết) và **C13c,d** (Hiểu), hãy gộp thành **MỘT CÂU 13 DUY NHẤT** có đề dẫn chung.
     - Ví dụ:
       <p><span class="question-number">Câu 13.</span> Cho hàm số y = f(x)... Xét tính đúng sai của các mệnh đề:</p>
       <div class="options">
         <div class="option-item">a) Hàm số đồng biến...</div>
         <div class="option-item">b) Đồ thị đi qua...</div>
         <div class="option-item">c) Giá trị lớn nhất...</div>
         <div class="option-item">d) Phương trình...</div>
       </div>

  5. **ĐÁP ÁN:**
     - Trình bày rõ ràng.
     - <p><strong>Câu 1:</strong> A</p>
     - <p><strong>Câu 2:</strong> C</p>

  **NGUYÊN TẮC CHUNG:**
  1. **KHÔNG TẠO PHẦN THỪA:** Nếu số lượng câu hỏi = 0, tuyệt đối không sinh ra phần đó.
  2. **CÔNG THỨC:** Dùng LaTeX $...$ hoặc $$...$$ (Nhưng lưu ý HTML thuần không render LaTeX tự động, hãy cố gắng dùng ký tự Unicode nếu đơn giản, hoặc giữ nguyên LaTeX để người dùng convert sau bằng MathType trong Word).
  `;

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      },
    });
    return response.text || "Lỗi tạo đề thi.";
  });
};
