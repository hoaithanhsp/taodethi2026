
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_INSTRUCTION, MODEL_NAME, FALLBACK_MODELS } from '../constants';
import { InputData, QuestionConfig, ExtractedQuestion } from '../types';

// --- API Key Management (localStorage-based) ---
const API_KEY_STORAGE_KEY = 'examcraft_api_key';
const MODEL_STORAGE_KEY = 'examcraft_selected_model';

export const getApiKey = (): string | null => {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
};

export const setApiKey = (key: string): void => {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
};

export const removeApiKey = (): void => {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
};

export const getSelectedModel = (): string | null => {
  return localStorage.getItem(MODEL_STORAGE_KEY);
};

export const setSelectedModel = (model: string): void => {
  localStorage.setItem(MODEL_STORAGE_KEY, model);
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
  const userModel = getSelectedModel();
  const primaryModel = userModel || MODEL_NAME;
  const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];
  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      console.log(`[ExamCraft] Trying model: ${model}`);
      return await promptFn(ai, model);
    } catch (err: any) {
      lastError = err;
      console.warn(`[ExamCraft] Model ${model} failed:`, err.message || err);
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
          { inlineData: { mimeType: file.type || 'application/octet-stream', data: base64Data } },
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

// Convert extracted DOCX text + images to HTML table
export const convertMatrixTextToHtml = async (
  text: string,
  images?: { base64: string; mimeType: string }[]
): Promise<string> => {
  const hasImages = images && images.length > 0;
  
  const prompt = `
    Bạn là một chuyên gia chuyển đổi dữ liệu.
    Nội dung dưới đây là **MA TRẬN ĐỀ THI** được trích xuất từ file Word (.docx).
    ${hasImages ? `Có ${images!.length} hình ảnh đính kèm (bao gồm công thức toán đã chuyển thành hình). Hãy đọc kỹ các hình để hiểu nội dung.` : ''}
    
    Nhiệm vụ của bạn là:
    1. Đọc nội dung ma trận từ text dưới đây.
    2. Chuyển đổi toàn bộ thành một bảng **HTML Table** chuẩn.
    
    YÊU CẦU KỸ THUẬT:
    - Giữ nguyên cấu trúc merge cells (rowspan, colspan) của bản gốc.
    - Font chữ: Times New Roman, size 13pt.
    - Table border: 1px solid black.
    - Output: Chỉ trả về mã HTML của bảng (<table>...</table>) hoặc (<!DOCTYPE html>...), KHÔNG bao gồm markdown \`\`\`.
    - Nếu text chứa LaTeX ($...$), giữ nguyên LaTeX trong bảng.
    
    **NỘI DUNG MA TRẬN:**
    ${text.substring(0, 20000)}
  `;

  const parts: any[] = [];
  
  // Add images first (if any)
  if (hasImages) {
    const imagesToSend = images!.slice(0, 10);
    for (const img of imagesToSend) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.base64,
        }
      });
    }
  }
  
  // Add text prompt
  parts.push({ text: prompt });

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
    });
    const resultText = response.text || "";
    return resultText.replace(/```html/g, '').replace(/```/g, '');
  });
};

export const extractInfoFromDocument = async (file: File, selectedSubject?: string, selectedGrade?: string): Promise<Partial<InputData>> => {
  const isDocx = file.name.endsWith('.docx') || file.name.endsWith('.doc');

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
    Bạn là chuyên gia phân tích chương trình giáo dục Việt Nam. ${isDocx ? 'Nội dung dưới đây được trích xuất từ file Word (.docx).' : 'Hãy đọc file đính kèm (Kế hoạch dạy học/PPCT)'} và trích xuất dữ liệu cấu trúc cực kỳ chi tiết.

    **===== NGUYÊN TẮC VÀNG: CHỈ TRÍCH XUẤT, KHÔNG SÁNG TẠO =====**
    1. TUYỆT ĐỐI CHỈ trích xuất nội dung CÓ SẴN trong file đính kèm. KHÔNG ĐƯỢC tự bịa đặt, suy luận, hay thêm bất kỳ thông tin nào không có trong tài liệu.
    2. Tên môn học, tên chương, tên bài học, nội dung yêu cầu cần đạt PHẢI lấy NGUYÊN VĂN từ file gốc.
    3. KHÔNG ĐƯỢC nhầm lẫn nội dung giữa các môn học. Ví dụ: nếu file là PPCT Tin học thì chỉ được trích xuất nội dung Tin học, KHÔNG ĐƯỢC trả về nội dung của môn Toán, Lý, Hóa hay bất kỳ môn nào khác.
    4. Nếu không đọc được rõ một phần nào đó trong file, hãy ghi "Không đọc được" thay vì bịa nội dung.
    ${subjectConstraint}

    **===== QUY TẮC XÁC ĐỊNH MÔN HỌC (CỰC KỲ QUAN TRỌNG) =====**
    - Xác định môn học dựa trên TIÊU ĐỀ, HEADER của file (ví dụ: "KẾ HOẠCH DẠY HỌC MÔN CÔNG NGHỆ 8").
    - Nếu file chứa nội dung NHIỀU MÔN (ví dụ file tổng hợp PPCT cả trường), CHỈ trích xuất phần thuộc môn được chỉ định.
    - TUYỆT ĐỐI KHÔNG trộn lẫn nội dung các môn khác nhau.
    - Nếu không tìm thấy nội dung của môn được chỉ định trong file, hãy trả về chapters rỗng [] và ghi subject là môn bạn thực sự tìm thấy trong file.

    **NGÔN NGỮ BẮT BUỘC: TIẾNG VIỆT**
    - Toàn bộ output PHẢI bằng TIẾNG VIỆT, giữ nguyên như trong tài liệu gốc.
    - KHÔNG ĐƯỢC dịch sang tiếng Anh. Ví dụ: "Tin học" ≠ "Informatics", "Công nghệ" ≠ "Technology".

    Yêu cầu đầu ra: JSON Object (không markdown) với cấu trúc sau:
    {
      "subject": "Tên môn học CHÍNH XÁC như trong file (TIẾNG VIỆT) - phải khớp với nội dung thực tế trong file",
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
    6. Trường "subject" trong JSON output phải phản ánh ĐÚNG môn học mà bạn thực sự đọc được từ file, KHÔNG ĐƯỢC copy môn từ constraint mà không xác minh.
  `;

  const ai = getAI();
  try {
    // Build parts based on file type
    const parts: any[] = [];

    if (isDocx) {
      // DOCX: Parse text + images first, then send to AI
      const { parseDocxWithMath } = await import('./docxMathParser');
      const arrayBuffer = await file.arrayBuffer();
      const parsed = await parseDocxWithMath(arrayBuffer);
      console.log(`[ExtractInfo] DOCX parsed: ${parsed.text.length} chars, ${parsed.images.length} images, method=${parsed.method}`);
      
      // Send images inline (if any)
      if (parsed.images.length > 0) {
        const imagesToSend = parsed.images.slice(0, 10);
        for (const img of imagesToSend) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        }
      }
      
      // Send text prompt with DOCX content appended
      parts.push({ text: prompt + `\n\n**NỘI DUNG FILE DOCX:**\n${parsed.text.substring(0, 25000)}` });
    } else {
      // PDF/Image: Send binary directly (Gemini supports these)
      const base64Data = await fileToBase64(file);
      parts.push({ inlineData: { mimeType: file.type || 'application/octet-stream', data: base64Data } });
      parts.push({ text: prompt });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text || "{}";
    let jsonToParse = text;
    try {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end >= start) {
        jsonToParse = text.substring(start, end + 1);
      }
      return JSON.parse(jsonToParse);
    } catch (e) {
      console.error("Failed to parse JSON. Raw text:", text);
      throw new Error("Không thể nhận diện nội dung file. Vui lòng kiểm tra lại định dạng hoặc thử file khác.");
    }
  } catch (error: any) {
    console.error("Error extracting info:", error);
    throw new Error(error.message || "Đã xảy ra lỗi khi phân tích file.");
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

  const totalEssayQuestions = config.essay.biet + config.essay.hieu + config.essay.van_dung + config.essay.van_dung_cao;
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
  - Nhiều lựa chọn (Dạng I): Biết ${config.type1.biet}, Hiểu ${config.type1.hieu}, VD ${config.type1.van_dung}, VDC ${config.type1.van_dung_cao}
  - Đúng - Sai (Dạng II): Biết ${config.type2.biet}, Hiểu ${config.type2.hieu}, VD ${config.type2.van_dung}, VDC ${config.type2.van_dung_cao}
  - Trả lời ngắn (Dạng III): Biết ${config.type3.biet}, Hiểu ${config.type3.hieu}, VD ${config.type3.van_dung}, VDC ${config.type3.van_dung_cao}
  - Tự luận: Biết ${config.essay.biet}, Hiểu ${config.essay.hieu}, VD ${config.essay.van_dung}, VDC ${config.essay.van_dung_cao}
  
  ${scoringInstructions}

  **===== ĐỊNH DẠNG BẢNG BẮT BUỘC (Rất quan trọng - phải tuân thủ 100%) =====**

  Tiêu đề bảng (in đậm, căn giữa, ở trên bảng):
  **MA TRẬN ĐỀ KIỂM TRA ... - ${data.subject.toUpperCase()} ${data.grade.toUpperCase()}**

  **QUY TẮC NĂM HỌC (BẮT BUỘC):** Thông tin năm học phải ĐỂ TRỐNG dạng: "NĂM HỌC 20... - 20...". TUYỆT ĐỐI KHÔNG điền sẵn bất kỳ năm cụ thể nào.

  **HEADER BẢNG (4 tầng merge):**
  Thực tế header cần 4 dòng:
  - Dòng header 1: TT(rowspan=4) | Chương/chủ đề(rowspan=4) | Nội dung/đơn vị kiến thức(rowspan=4) | Mức độ đánh giá(colspan=${hasEssay ? 16 : 12}) | Tổng số câu(colspan=4, rowspan=2) | Tỉ lệ % điểm(rowspan=4)
  - Dòng header 2: TNKQ(colspan=${hasEssay ? 16 : 12})
  - Dòng header 3: Nhiều lựa chọn(colspan=4) | Đúng - Sai(colspan=4) | Trả lời ngắn(colspan=4) ${hasEssay ? '| Tự luận(colspan=4)' : ''} | Biết | Hiểu | VD | VDC
  - Dòng header 4: Biết | Hiểu | VD | VDC | Biết | Hiểu | VD | VDC | Biết | Hiểu | VD | VDC ${hasEssay ? '| Biết | Hiểu | VD | VDC' : ''}

  ${hasEssay ? 'Nếu CÓ tự luận: thêm cột "Tự luận" (colspan=4) sau "Trả lời ngắn".' : 'KHÔNG CÓ tự luận => KHÔNG tạo cột Tự luận.'}

  **NỘI DUNG BẢNG - MỖI BÀI HỌC CÓ 2 DÒNG (sub-row):**
  Với mỗi bài học (Nội dung/ĐVKT), tạo CHÍNH XÁC **2 dòng** (2 <tr>):

  **Dòng 1 (Số lượng câu hỏi):**
  - Ô "Nội dung" ghi: Tên bài + (X tiết) — dùng rowspan=2
  - Các ô Biết/Hiểu/VD/VDC của từng dạng: Ghi SỐ LƯỢNG câu hỏi (ví dụ: 2, 1, 0, ...)
  - Ô "Tổng số câu" Biết/Hiểu/VD/VDC: rowspan=2, tính tổng theo hàng ngang
  - Ô "Tỉ lệ % điểm": rowspan=2, ví dụ "15,0%", "25,0%"

  **Dòng 2 (Tên điểm / Mã câu):**
  - Với các ô thuộc cột "Biết" và "Hiểu": Ghi chữ "TD" (Tư duy).
  - Với các ô thuộc cột "VD" (Vận dụng) và "VDC" (Vận dụng cao): TUYỆT ĐỐI ghi chữ "GQVĐ" (Giải quyết vấn đề), KHÔNG ghi "TD".
  - Nếu KHÔNG có câu hỏi ở ô đó (0 câu), để TRỐNG.
  
  **Merge cells STT & Chương/chủ đề:** 
  - Nếu 1 chương có nhiều bài => cột TT dùng rowspan = (số bài × 2), cột Chương/chủ đề cũng rowspan = (số bài × 2).

  **FOOTER BẢNG (3 dòng cuối):**
  1. **Tổng số câu**: Tổng cộng số câu hỏi theo từng cột Biết/Hiểu/VD/VDC của từng dạng + tổng toàn bảng cuối.
  2. **Tổng số điểm**: Tổng điểm theo từng cột + tổng cuối = 10.
  3. **Tỉ lệ % điểm của ma trận**: cho mỗi nhóm dạng, cuối cùng 100%.

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
      objectivesMap.push(`- Bài "${l.name}": \n   + Biết: ${l.objectives.biet || '...'}\n   + Hiểu: ${l.objectives.hieu || '...'}\n   + Vận dụng: ${l.objectives.van_dung || '...'}\n   + Vận dụng cao: ${l.objectives.van_dung_cao || '...'}`);
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

   **QUY TẮC NĂM HỌC (BẮT BUỘC):** Thông tin năm học phải ĐỂ TRỐNG dạng: "NĂM HỌC 20... - 20...". TUYỆT ĐỐI KHÔNG điền sẵn bất kỳ năm cụ thể nào.

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
  - Các ô Biết/Hiểu: Ghi "TD". Các ô VD: Ghi "GQVĐ". Khớp và giống hệt Ma trận. Nếu 0 câu thì để trống.

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

// --- Extract questions from reference document ---
export const extractQuestionsFromReference = async (
  text: string,
  images: { base64: string; mimeType: string }[],
  specsHtml: string,
  subject: string,
  grade: string
): Promise<ExtractedQuestion[]> => {
  const hasImages = images && images.length > 0;

  const prompt = `
  Bạn là chuyên gia trích xuất câu hỏi từ tài liệu giáo dục Việt Nam.
  
  **NHIỆM VỤ:** Trích xuất CHÍNH XÁC từng câu hỏi trong tài liệu dưới đây.
  - Môn: ${subject}, Lớp: ${grade}
  ${hasImages ? `- Có ${images.length} hình ảnh đính kèm (gồm công thức MathType đã chuyển PNG). Hãy ĐỌC KỸ từng hình và CHUYỂN ĐỔI công thức trong hình sang LaTeX $...$.` : ''}
  
  **QUY TẮC TRÍCH XUẤT (CỰC KỲ QUAN TRỌNG):**
  1. Giữ NGUYÊN VĂN nội dung câu hỏi, KHÔNG sửa đổi, KHÔNG diễn giải lại.
  2. Nếu câu hỏi có công thức toán:
     - OMML đã chuyển LaTeX: giữ nguyên dạng $...$ hoặc $$...$$
     - MathType (hình ảnh): đọc hình → chuyển sang LaTeX $...$
  3. Phân loại mỗi câu theo:
     - **type**: "type1" (4 lựa chọn A/B/C/D), "type2" (Đúng/Sai 4 ý a,b,c,d), "type3" (Trả lời ngắn), "essay" (Tự luận)
     - **level**: "biet" (Nhận biết), "hieu" (Thông hiểu), "van_dung" (Vận dụng), "van_dung_cao" (Vận dụng cao)
  4. Nếu có đáp án trong tài liệu, trích xuất luôn.
  5. Trích xuất TẤT CẢ câu hỏi, kể cả câu hỏi không hoàn chỉnh.

  **BẢNG ĐẶC TẢ (ĐỂ THAM CHIẾU MỨC ĐỘ):**
  ${specsHtml.substring(0, 8000)}
  
  **NỘI DUNG TÀI LIỆU:**
  ${text.substring(0, 25000)}
  ${text.length > 25000 ? '\n[... Nội dung đã được cắt ngắn ...]' : ''}
  
  **OUTPUT:** JSON Array, mỗi phần tử là 1 câu hỏi:
  [
    {
      "id": "q1",
      "type": "type1",
      "level": "biet",
      "topic": "Tên chủ đề/chương",
      "content": "Nội dung câu hỏi NGUYÊN VĂN (bao gồm LaTeX nếu có)",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "subItems": null
    },
    {
      "id": "q2",
      "type": "type2",
      "level": "hieu",
      "topic": "...",
      "content": "Đề dẫn chung cho câu Đúng/Sai",
      "options": null,
      "answer": "a-Đ, b-S, c-Đ, d-S",
      "subItems": ["a) Mệnh đề 1...", "b) Mệnh đề 2...", "c) ...", "d) ..."]
    }
  ]
  
  CHỈ trả về JSON array, không markdown.
  `;

  const parts: any[] = [];

  // Send images first (mammoth-converted WMF→PNG + other images)
  if (hasImages) {
    const imagesToSend = images.slice(0, 15);
    for (const img of imagesToSend) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }

  parts.push({ text: prompt });

  const ai = getAI();
  const userModel = getSelectedModel();
  const primaryModel = userModel || MODEL_NAME;
  const modelsToTry = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];

  for (const model of modelsToTry) {
    try {
      console.log(`[ExamCraft] Extracting questions with model: ${model}`);
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const resultText = response.text || '[]';
      try {
        let jsonStr = resultText;
        if (jsonStr.includes('```')) {
          jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        }
        const start = jsonStr.indexOf('[');
        const end = jsonStr.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end >= start) {
          jsonStr = jsonStr.substring(start, end + 1);
        }
        const questions: ExtractedQuestion[] = JSON.parse(jsonStr);
        console.log(`[ExamCraft] Extracted ${questions.length} questions from reference`);
        return questions;
      } catch (e) {
        console.error('[ExamCraft] Failed to parse extracted questions:', resultText.substring(0, 500));
        return [];
      }
    } catch (err: any) {
      console.warn(`[ExamCraft] Model ${model} failed for extraction:`, err.message);
      continue;
    }
  }

  console.error('[ExamCraft] All models failed for question extraction');
  return [];
};

export const generateStep3Exam = async (
  specsContent: string,
  questionConfig: QuestionConfig,
  inputData: InputData,
  referenceText?: string,
  referenceImages?: { base64: string; mimeType: string }[],
  extractedQuestions?: ExtractedQuestion[]
): Promise<string> => {

  const counts = {
    type1: questionConfig.type1.biet + questionConfig.type1.hieu + questionConfig.type1.van_dung + questionConfig.type1.van_dung_cao,
    type2: questionConfig.type2.biet + questionConfig.type2.hieu + questionConfig.type2.van_dung + questionConfig.type2.van_dung_cao,
    type3: questionConfig.type3.biet + questionConfig.type3.hieu + questionConfig.type3.van_dung + questionConfig.type3.van_dung_cao,
    essay: questionConfig.essay.biet + questionConfig.essay.hieu + questionConfig.essay.van_dung + questionConfig.essay.van_dung_cao,
  };

  // Build a clear whitelist of allowed parts
  const allowedParts: string[] = [];
  if (counts.type1 > 0) allowedParts.push('PHẦN I (Trắc nghiệm nhiều lựa chọn)');
  if (counts.type2 > 0) allowedParts.push('PHẦN II (Đúng/Sai)');
  if (counts.type3 > 0) allowedParts.push('PHẦN III (Trả lời ngắn)');
  if (counts.essay > 0) allowedParts.push('PHẦN IV (Tự luận)');

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
    structureInstructions += `- **PHẦN IV (Tự luận):** ⛔ CẤM TẠO. Số câu = 0. TUYỆT ĐỐI KHÔNG SINH RA BẤT KỲ CÂU TỰ LUẬN NÀO.\n`;
  }

  structureInstructions += `\n**⚠️ DANH SÁCH PHẦN ĐƯỢC PHÉP TẠO (WHITELIST):** ${allowedParts.length > 0 ? allowedParts.join(', ') : 'Không có phần nào'}.\n`;
  structureInstructions += `**⛔ NGHIÊM CẤM:** Bất kỳ phần nào KHÔNG có trong whitelist trên đều KHÔNG ĐƯỢC TẠO. Nếu tự luận không nằm trong danh sách trên thì KHÔNG ĐƯỢC tạo phần tự luận.\n`;

  // Build reference section
  let referenceSection = '';
  const hasExtractedQuestions = extractedQuestions && extractedQuestions.length > 0;

  if (hasExtractedQuestions) {
    // === MODE 1: Có câu hỏi đã trích xuất → ƯU TIÊN DÙNG CHÍNH XÁC ===
    const questionsByType = {
      type1: extractedQuestions!.filter(q => q.type === 'type1'),
      type2: extractedQuestions!.filter(q => q.type === 'type2'),
      type3: extractedQuestions!.filter(q => q.type === 'type3'),
      essay: extractedQuestions!.filter(q => q.type === 'essay'),
    };

    let questionsListing = '';
    for (const [typeKey, questions] of Object.entries(questionsByType)) {
      if (questions.length === 0) continue;
      const typeName = typeKey === 'type1' ? 'Dạng I (4 lựa chọn)' : typeKey === 'type2' ? 'Dạng II (Đúng/Sai)' : typeKey === 'type3' ? 'Dạng III (Trả lời ngắn)' : 'Tự luận';
      questionsListing += `\n### ${typeName} (${questions.length} câu):\n`;
      for (const q of questions) {
        questionsListing += `\n**[${q.id}] Mức: ${q.level} | Chủ đề: ${q.topic}**\n`;
        questionsListing += `${q.content}\n`;
        if (q.options && q.options.length > 0) {
          questionsListing += q.options.join('\n') + '\n';
        }
        if (q.subItems && q.subItems.length > 0) {
          questionsListing += q.subItems.join('\n') + '\n';
        }
        if (q.answer) {
          questionsListing += `Đáp án: ${q.answer}\n`;
        }
      }
    }

    referenceSection = `
  **===== NGÂN HÀNG CÂU HỎI ĐÃ TRÍCH XUẤT (BẮT BUỘC SỬ DỤNG) =====**
  
  Dưới đây là ${extractedQuestions!.length} câu hỏi đã được trích xuất CHÍNH XÁC từ tài liệu tham khảo của người dùng.
  Phân bổ: Dạng I: ${questionsByType.type1.length}, Dạng II: ${questionsByType.type2.length}, Dạng III: ${questionsByType.type3.length}, Tự luận: ${questionsByType.essay.length}
  
  **CÁCH SỬ DỤNG NGÂN HÀNG CÂU HỎI (BẮT BUỘC TUÂN THỦ):**
  1. ƯU TIÊN SỐ 1: Sử dụng CHÍNH XÁC NGUYÊN VĂN các câu hỏi từ ngân hàng bên dưới.
  2. Chọn câu hỏi PHÙ HỢP với Ma trận và Đặc tả (đúng dạng, đúng mức độ, đúng chủ đề).
  3. KHÔNG ĐƯỢC thay đổi nội dung, số liệu, hay cách diễn đạt của câu hỏi gốc.
  4. Giữ nguyên công thức toán LaTeX $...$ hoặc $$...$$ như trong ngân hàng.
  5. Nếu ngân hàng KHÔNG ĐỦ câu hỏi cho một dạng/mức độ nào đó → BỔ SUNG thêm câu hỏi MỚI theo phong cách tương tự.
  6. Sắp xếp lại số thứ tự câu hỏi (Câu 1, Câu 2...) cho liên tục.
  
  **DANH SÁCH CÂU HỎI:**
  ${questionsListing}
  
  **===== HẾT NGÂN HÀNG CÂU HỎI =====**
  `;
  } else if (referenceText && referenceText.trim()) {
    // === MODE 2: Có text tham khảo nhưng chưa trích xuất → tham khảo phong cách ===
    const hasImages = referenceImages && referenceImages.length > 0;
    referenceSection = `
  **===== TÀI LIỆU THAM KHẢO (ĐỀ MẪU / NGÂN HÀNG CÂU HỎI) =====**
  
  Dưới đây là nội dung tài liệu tham khảo được người dùng upload. ${hasImages ? `Có ${referenceImages!.length} hình ảnh đính kèm (bao gồm công thức toán đã chuyển thành hình).` : ''}
  
  **CÁCH SỬ DỤNG TÀI LIỆU THAM KHẢO:**
  - Sử dụng CHÍNH XÁC các câu hỏi có sẵn trong tài liệu tham khảo nếu phù hợp với ma trận, đặc tả.
  - Ưu tiên lấy nguyên văn câu hỏi thay vì tạo mới.
  - Chỉ tạo câu hỏi MỚI khi tài liệu tham khảo không đủ câu cho một dạng/mức độ cụ thể.
  ${hasImages ? '- Đọc KỸ các hình ảnh đính kèm — đặc biệt là hình công thức toán. Chuyển đổi nội dung hình sang LaTeX khi cần.' : ''}
  
  **NỘI DUNG TÀI LIỆU THAM KHẢO:**
  ${referenceText.substring(0, 15000)}
  ${referenceText.length > 15000 ? '\n[... Nội dung đã được cắt ngắn do quá dài ...]' : ''}
  
  **===== HẾT TÀI LIỆU THAM KHẢO =====**
  `;
  }

  const prompt = `
  **===== THÔNG TIN ĐỀ THI BẮT BUỘC (CỰC KỲ QUAN TRỌNG) =====**
  - **Môn học:** ${inputData.subject}
  - **Khối lớp:** Lớp ${inputData.grade}
  - **Loại đề:** ${inputData.examType}
  - **Thời gian:** ${inputData.duration} phút

  **===== RÀNG BUỘC MÔN HỌC =====**
  - TUYỆT ĐỐI CHỈ tạo câu hỏi về nội dung **môn ${inputData.subject} lớp ${inputData.grade}**.
  - KHÔNG ĐƯỢC tạo câu hỏi thuộc môn học khác hoặc khối lớp khác.
  - Nội dung câu hỏi phải phù hợp với chương trình **${inputData.examType}** (${inputData.examType.includes('2') ? 'Học kỳ 2' : 'Học kỳ 1'}).
  - Nếu là đề Cuối kỳ 2 hoặc Giữa kỳ 2: CHỈ ra câu hỏi về kiến thức HỌC KỲ 2, KHÔNG ra kiến thức Học kỳ 1.

  Dựa trên **Bảng đặc tả** sau (HTML):
  ${specsContent}

  ${referenceSection}

  Hãy soạn thảo **ĐỀ THI HOÀN CHỈNH** và **HƯỚNG DẪN CHẤM** cho môn **${inputData.subject}** lớp **${inputData.grade}** — **${inputData.examType}**.
  
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
    - Tiêu đề phải ghi rõ: "ĐỀ KIỂM TRA ${inputData.examType.toUpperCase()} - MÔN ${inputData.subject.toUpperCase()} ${inputData.grade.toUpperCase()}"
    **QUY TẮC NĂM HỌC (BẮT BUỘC):** Thông tin năm học phải ĐỂ TRỐNG dạng: "NĂM HỌC 20... - 20...". TUYỆT ĐỐI KHÔNG điền sẵn bất kỳ năm cụ thể nào (ví dụ KHÔNG viết 2023-2024 hay 2024-2025). Tương tự, tên trường để dạng "TRƯỜNG THPT ...............".
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

  **NGUYÊN TẮC CHUNG (BẮT BUỘC TUÂN THỦ):**
  1. **⛔ CẤM TẠO PHẦN THỪA (QUAN TRỌNG NHẤT):** Đề thi CHỈ ĐƯỢC CHỨA các phần có trong WHITELIST ở trên: [${allowedParts.join(', ')}]. Nếu PHẦN IV (Tự luận) KHÔNG có trong whitelist → TUYỆT ĐỐI KHÔNG tạo câu tự luận, không tạo tiêu đề "PHẦN IV", không nhắc đến tự luận.
  2. **CÔNG THỨC:** Dùng LaTeX $...$ hoặc $$...$$ (Nhưng lưu ý HTML thuần không render LaTeX tự động, hãy cố gắng dùng ký tự Unicode nếu đơn giản, hoặc giữ nguyên LaTeX để người dùng convert sau bằng MathType trong Word).
  3. **LƯU Ý MÔN HỌC:** Toàn bộ câu hỏi PHẢI thuộc phạm vi kiến thức môn ${inputData.subject} lớp ${inputData.grade}. KHÔNG được ra câu hỏi thuộc môn khác.
  4. **KIỂM TRA CUỐI CÙNG:** Trước khi trả output, hãy tự kiểm tra: Đề thi có chứa phần nào KHÔNG nằm trong whitelist không? Nếu có → XÓA phần đó.
  `;

  return callWithFallback(async (ai, model) => {
    // Build content parts
    const parts: any[] = [];
    
    // Add reference images first (if any) — Gemini can "see" these
    if (referenceImages && referenceImages.length > 0) {
      // Limit to max 15 images to avoid token overflow
      const imagesToSend = referenceImages.slice(0, 15);
      console.log(`[ExamCraft] Sending ${imagesToSend.length} reference images to Gemini`);
      
      for (const img of imagesToSend) {
        parts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.base64,
          }
        });
      }
    }
    
    // Add text prompt
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      },
    });
    return response.text || "Lỗi tạo đề thi.";
  });
};
