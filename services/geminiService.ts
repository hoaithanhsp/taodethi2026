
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

export const extractInfoFromDocument = async (file: File): Promise<Partial<InputData>> => {
  const base64Data = await fileToBase64(file);

  const prompt = `
    Bạn là chuyên gia phân tích chương trình giáo dục. Hãy đọc file đính kèm (Kế hoạch dạy học/PPCT) và trích xuất dữ liệu cấu trúc cực kỳ chi tiết.

    Yêu cầu đầu ra: JSON Object (không markdown) với cấu trúc sau:
    {
      "subject": "Tên môn học",
      "grade": "Khối lớp",
      "chapters": [
        {
          "id": "c1",
          "name": "Tên chương đầy đủ",
          "totalPeriods": 10,
          "lessons": [
            {
              "id": "c1_l1",
              "name": "Tên bài học",
              "periods": 2,
              "weekStart": 1,
              "weekEnd": 1,
              "objectives": {
                "biet": "Nội dung yêu cầu cần đạt mức Biết...",
                "hieu": "Nội dung yêu cầu cần đạt mức Hiểu...",
                "van_dung": "Nội dung yêu cầu cần đạt mức Vận dụng..."
              }
            }
          ]
        }
      ]
    }

    Lưu ý quan trọng:
    1. Hãy cố gắng nhận diện số tiết và tuần học của từng bài. Nếu không ghi rõ, hãy ước lượng dựa trên tổng số tiết.
    2. Phần "objectives" (Yêu cầu cần đạt) là QUAN TRỌNG NHẤT. Hãy trích xuất nguyên văn từ cột "Yêu cầu cần đạt" trong bảng PPCT.
    3. Nếu tài liệu là PDF dạng ảnh, hãy dùng khả năng Vision để đọc kỹ bảng biểu.
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
  Hãy tạo **MA TRẬN ĐỀ THI** (HTML Table) cho môn **${data.subject}**, khối **${data.grade}**.
  
  **CẤU HÌNH ĐỀ THI:**
  - Loại đề: ${data.examType}
  - Thời gian: ${data.duration} phút
  - Tổng số tiết trọng tâm: ${totalSelectedPeriods} tiết
  
  **CẤU TRÚC SỐ LƯỢNG CÂU HỎI (Bắt buộc tuân thủ):**
  - Dạng I (4 lựa chọn): Biết ${config.type1.biet}, Hiểu ${config.type1.hieu}, VD ${config.type1.van_dung}
  - Dạng II (Đúng/Sai): Biết ${config.type2.biet}, Hiểu ${config.type2.hieu}, VD ${config.type2.van_dung}
  - Dạng III (Trả lời ngắn): Biết ${config.type3.biet}, Hiểu ${config.type3.hieu}, VD ${config.type3.van_dung}
  - Tự luận: Biết ${config.essay.biet}, Hiểu ${config.essay.hieu}, VD ${config.essay.van_dung}
  
  ${scoringInstructions}
  
  ${columnStructureInstructions}

  **QUY TẮC ĐIỂM SỐ VÀNG (BẮT BUỘC):**
  1. **BỘI SỐ 0.25:** Mọi điểm số (từng câu và tổng dòng) PHẢI là bội số của 0.25.
  2. **KHÔNG DÙNG SỐ LẺ:** TUYỆT ĐỐI KHÔNG dùng 0.33, 0.42...
  3. **TÍNH TỔNG DÒNG:** Tại mỗi hàng nội dung, tính tổng điểm = (Số câu I * Điểm I) + (Số câu II * Điểm II) + ... **Làm tròn về bội 0.25 gần nhất**.
  4. **HIỂN THỊ CỘT:** Nếu số lượng câu hỏi của một Dạng = 0 (ví dụ Tự luận = 0), thì **KHÔNG TẠO** cột cho dạng đó trong bảng.

  **DỮ LIỆU ĐẦU VÀO (Chỉ phân bổ câu hỏi cho các bài này):**
  ${JSON.stringify(selectedChapters, null, 2)}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra một Full HTML Document (<!DOCTYPE html>...). 
     - Font: Times New Roman, size 13pt.
     - Bảng phải có border collapse, padding chuẩn.
  2. Cấu trúc bảng HTML:
     - Merge cells (rowspan) cho cột "Chủ đề" nếu chủ đề có nhiều bài học.
     - Cột "Nội dung/Đơn vị kiến thức" tương ứng với tên Bài học.
  3. Phân bổ số câu hỏi (C1, C2...) vào các ô dựa trên tỷ lệ số tiết của bài học đó so với tổng số tiết (${totalSelectedPeriods}).
     - Bài nào nhiều tiết hơn thì nhiều câu hỏi hơn.
     - **QUAN TRỌNG VỚI DẠNG II:** Nếu 1 câu hỏi có nhiều ý được chia nhỏ ở các mức độ khác nhau, hãy ghi rõ. Ví dụ: C13a,b ở cột Biết và C13c,d ở cột Hiểu.
     - Đảm bảo tổng số câu khớp với cấu hình ở trên.
  4. Cột Điểm: Tính toán CHÍNH XÁC theo cấu hình điểm số bên trên.
  
  **Style CSS (Include in <style>):**
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.3; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { border: 1px solid black; padding: 5px; text-align: center; vertical-align: middle; }
  th { background-color: #f0f0f0; font-weight: bold; }
  .left-align { text-align: left; }
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
  Dựa trên **Ma trận đề thi** (HTML) đã tạo (được cung cấp bên dưới hoặc đã có), hãy tạo **BẢNG ĐẶC TẢ CHI TIẾT** (Full HTML Document).
  Nếu bạn nhận được HTML của ma trận, hãy phân tích nó để lấy số lượng câu hỏi và mã câu hỏi chính xác.

  **MA TRẬN ĐẦU VÀO:**
  ${matrixContent}

  **DỮ LIỆU YÊU CẦU CẦN ĐẠT (Tham khảo nội dung):**
  ${objectivesMap.join('\n')}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra Full HTML Document (<!DOCTYPE html>...). Font Times New Roman 13pt.
  2. **CẤU TRÚC BẢNG:**
     - Phải khớp 100% với cấu trúc cột của Ma trận (nếu Ma trận không có Tự luận thì Bảng đặc tả cũng KHÔNG CÓ).
     - Header row 1: STT | Chủ đề | Nội dung | Mức độ KT, ĐG | [Các nhóm Dạng câu hỏi có số lượng > 0]
  3. **NỘI DUNG:**
     - Cột "Mức độ kiểm tra, đánh giá": Phải copy chính xác nội dung từ dữ liệu Yêu cầu cần đạt.
     - **QUAN TRỌNG:** Tại mỗi dòng Biết/Hiểu/Vận dụng, hãy THÊM một ví dụ dạng toán ngắn gọn (in nghiêng) minh họa.
     - Các cột Số câu hỏi: Điền chính xác mã câu (C1, C2...) khớp 100% với Ma trận.
     - **XỬ LÝ DẠNG II (Đúng/Sai):** Nếu ma trận ghi C13a,b ở cột Biết và C13c,d ở cột Hiểu, hãy giữ nguyên cách ghi này trong Bảng đặc tả. Đừng tách thành câu riêng biệt.

     - Thêm chú thích năng lực toán học (1), (2), (3).

  4. **QUY TẮC CHÚ THÍCH (FOOTNOTES) - BẮT BUỘC:**
     Cuối bảng đặc tả, hãy thêm phần chú thích năng lực toán học theo ĐÚNG FORMAT sau (giữ nguyên không đổi, mỗi dòng cách nhau 1 dòng trống):
     
     (1): Năng lực tư duy và lập luận toán học
     
     (2): Năng lực mô hình hóa toán học
     
     (3): Năng lực giải quyết vấn đề toán học

  **Style CSS:**
  body { font-family: "Times New Roman", serif; font-size: 13pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { border: 1px solid black; padding: 4px; text-align: center; vertical-align: middle; font-size: 12pt; }
  th { background-color: #E7F3FF; font-weight: bold; }
  .text-left { text-align: left; padding: 8px; }
  .math-example { font-style: italic; color: #444; display: block; margin-top: 2px; font-size: 11pt; }
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
