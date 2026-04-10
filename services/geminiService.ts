
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_INSTRUCTION, MODEL_NAME, FALLBACK_MODELS, GRADE_NO_ESSAY, getSubjectFootnotes } from '../constants';
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

// --- Retry helper for 503/overloaded errors ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetryableError = (err: any): boolean => {
  const msg = (err.message || '').toLowerCase();
  const status = err.status || err.code || 0;
  return (
    status === 503 ||
    status === 429 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('high demand') ||
    msg.includes('quota') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted')
  );
};

const callWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  label: string = ''
): Promise<T> => {
  let lastError: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
        console.log(`[ExamCraft] ${label} Retry ${attempt}/${maxRetries} sau ${waitMs / 1000}s...`);
        await delay(waitMs);
      }
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (isRetryableError(err) && attempt < maxRetries) {
        console.warn(`[ExamCraft] ${label} Lỗi tạm thời (${err.status || err.code || '503'}), sẽ thử lại...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
};

// --- Fallback wrapper: try models in order with retry ---
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
      return await callWithRetry(
        () => promptFn(ai, model),
        2,
        `[${model}]`
      );
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
  if (isRetryableError(lastError)) {
    throw new Error("Hệ thống Gemini đang quá tải. Vui lòng đợi 1-2 phút rồi thử lại.");
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

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType: file.type || 'application/octet-stream', data: base64Data } },
          { text: prompt }
        ]
      },
    });
    const text = response.text || "";
    return text.replace(/```html/g, '').replace(/```/g, '');
  });
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

  const resultText = await callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        responseMimeType: "application/json",
      }
    });
    return response.text || "{}";
  });

  try {
    let jsonToParse = resultText;
    const start = resultText.indexOf('{');
    const end = resultText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end >= start) {
      jsonToParse = resultText.substring(start, end + 1);
    }
    return JSON.parse(jsonToParse);
  } catch (e) {
    console.error("Failed to parse JSON. Raw text:", resultText);
    throw new Error("Không thể nhận diện nội dung file. Vui lòng kiểm tra lại định dạng hoặc thử file khác.");
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
  const isGradeNoEssay = GRADE_NO_ESSAY.includes(data.grade);
  const hasEssay = !isGradeNoEssay && totalEssayQuestions > 0;

  // Gộp VD + VDC thành 3 mức: Biết, Hiểu, VD (theo chuẩn CV 7991)
  const type1Total = { biet: config.type1.biet, hieu: config.type1.hieu, vd: config.type1.van_dung + config.type1.van_dung_cao };
  const type2Total = { biet: config.type2.biet, hieu: config.type2.hieu, vd: config.type2.van_dung + config.type2.van_dung_cao };
  const type3Total = { biet: config.type3.biet, hieu: config.type3.hieu, vd: config.type3.van_dung + config.type3.van_dung_cao };
  const essayTotal = { biet: config.essay.biet, hieu: config.essay.hieu, vd: config.essay.van_dung + config.essay.van_dung_cao };

  let scoringInstructions = "";

  if (hasEssay) {
    scoringInstructions = `
    **KỊCH BẢN A: CÓ TỰ LUẬN (Tổng 10 điểm)**
    - Dạng I (TNKQ nhiều lựa chọn): 3.0 điểm. Mỗi câu **0.25 điểm**.
    - Dạng II (Đúng-Sai): 2.0 điểm. Mỗi câu **1.0 điểm** (4 ý a,b,c,d).
    - Dạng III (Trả lời ngắn): 2.0 điểm. Mỗi câu **0.5 điểm**.
    - Tự luận (IV): 3.0 điểm. Mỗi câu tùy độ khó.
    - **TỈ LỆ %:** Dạng I: 30% | Dạng II: 20% | Dạng III: 20% | Tự luận: 30%
    - **TỈ LỆ NGANG:** Biết: 40% | Hiểu: 30% | VD: 30%
    `;
  } else {
    scoringInstructions = `
    **KỊCH BẢN B: KHÔNG TỰ LUẬN (Tổng 10 điểm) — BẮT BUỘC cho Lớp 12**
    - Dạng I (TNKQ nhiều lựa chọn): 3.0 điểm.
    - Dạng II (Đúng-Sai): 4.0 điểm. (QUAN TRỌNG: Tăng lên 4.0)
    - Dạng III (Trả lời ngắn): 3.0 điểm. (QUAN TRỌNG: Tăng lên 3.0)
    - Tự luận: 0.0 điểm (TUYỆT ĐỐI KHÔNG TẠO).
    `;
  }

  const isGiuaKy = data.examType.includes('Giữa');
  const examTypeLabel = isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ';
  const semesterNum = data.examType.includes('1') ? 'I' : 'II';
  const footnotes = getSubjectFootnotes(data.subject);

  const prompt = `
  Hãy tạo **MA TRẬN ĐỀ KIỂM TRA** (HTML Table) cho môn **${data.subject}**, khối **Lớp ${data.grade}**.
  
  **CẤU HÌNH ĐỀ THI:**
  - Loại đề: ${data.examType} (Kiểm tra ${examTypeLabel} ${semesterNum})
  - Thời gian: ${data.duration} phút
  - Tổng số tiết trọng tâm: ${totalSelectedPeriods} tiết
  
  **⚠️⚠️⚠️ CẤU TRÚC SỐ LƯỢNG CÂU HỎI — BẢNG BẮT BUỘC (KHÔNG ĐƯỢC SAI DÙ 1 CÂU) ⚠️⚠️⚠️**
  **3 mức: Biết, Hiểu, VD (VD = Vận dụng + Vận dụng cao gộp lại)**

  | Dạng câu hỏi         | Biết | Hiểu | VD  | TỔNG |
  |---------------------|------|------|-----|------|
  | Dạng I (4 lựa chọn)  | ${type1Total.biet}    | ${type1Total.hieu}    | ${type1Total.vd}   | ${type1Total.biet + type1Total.hieu + type1Total.vd}    |
  | Dạng II (Đúng-Sai) (ý) | ${type2Total.biet}    | ${type2Total.hieu}    | ${type2Total.vd}   | ${type2Total.biet + type2Total.hieu + type2Total.vd}    |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet}    | ${type3Total.hieu}    | ${type3Total.vd}   | ${type3Total.biet + type3Total.hieu + type3Total.vd}    |
  ${hasEssay ? `| Tự luận (IV)       | ${essayTotal.biet}    | ${essayTotal.hieu}    | ${essayTotal.vd}   | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd}    |` : '| Tự luận            | 0    | 0    | 0   | 0 — TUYỆT ĐỐI KHÔNG TẠO CỘT TỰ LUẬN |'}

  **RÀNG BUỘC NGHIÊM NGẶT:** Tổng số câu/ý ở mỗi ô trong bảng trên phải KHỚP CHÍNH XÁC trong ma trận output. Nếu sai dù 1 câu → ma trận KHÔNG HỢP LỆ.
  
  ${scoringInstructions}

  **===== ĐỊNH DẠNG BẢNG BẮT BUỘC (Theo mẫu chuẩn CV 7991) =====**

  Tiêu đề bảng (in đậm, căn giữa, ở trên bảng):
  **MA TRẬN ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} – NĂM HỌC 20... - 20...**

  **QUY TẮC NĂM HỌC (BẮT BUỘC):** Thông tin năm học phải ĐỂ TRỐNG dạng: "NĂM HỌC 20... - 20...". TUYỆT ĐỐI KHÔNG điền sẵn bất kỳ năm cụ thể nào.

  **CẤU TRÚC CỘT QUAN TRỌNG — CHỈ 3 MỨC ĐỘ: Biết | Hiểu | VD**
  Mỗi dạng câu hỏi CHỈ CÓ 3 cột mức độ: Biết, Hiểu, VD (Vận dụng).
  KHÔNG tạo cột VDC (Vận dụng cao) riêng. VD bao gồm cả vận dụng và vận dụng cao.

  **HEADER BẢNG (2 dòng):**
  - Dòng header 1: TT(rowspan=2) | Chương(rowspan=2) | ĐVKT(rowspan=2) | Mức độ đánh giá(colspan=tổng cột dạng) | Tổng(rowspan=2) | Tỉ lệ % điểm(rowspan=2)
  - Dòng header 2: 
    + TNKQ nhiều lựa chọn (I): Biết | Hiểu | VD
    + "Đúng – sai" (II): Biết | Hiểu | VD
    + Trả lời ngắn (III): Biết | Hiểu | VD
    ${hasEssay ? '+ Tự luận (IV): Biết | Hiểu | VD' : ''}
    + Biết | Hiểu | VD (3 cột tổng)

  ${hasEssay ? '' : 'KHÔNG CÓ tự luận => KHÔNG tạo cột Tự luận.'}

  **NỘI DUNG BẢNG — MỖI BÀI HỌC:**
  Với mỗi bài học:
  - Ô "Đơn vị kiến thức" ghi: Tên bài
  - Các ô Biết/Hiểu/VD của từng dạng: Ghi MÃ CÂU (ví dụ: I.1, I.2, II.1a II.1b, III.1, IV.1a)
  - DẠNG I: mã "I.1", "I.2", "I.3"...
  - DẠNG II: mã "II.1a II.1b" (ở cột Biết), "II.1c" (ở cột Hiểu), "II.1d" (ở cột VD). Mỗi câu Đ/S có 4 ý a,b,c,d chia vào các mức.
  - DẠNG III: mã "III.1", "III.2"...
  - TỰ LUẬN: mã "IV.1a", "IV.1b", "IV.2a IV.2b"...
  - Ô Tổng: tính TỔNG SỐ CÂU/ý theo hàng (3 cột: Biết, Hiểu, VD)

  **FOOTER BẢNG (3 dòng cuối):**
  1. **Tổng số câu (Lệnh hỏi):** Tổng cộng theo từng cột Biết/Hiểu/VD + tổng của từng dạng + tổng cuối.
  2. **Tổng số điểm:** Tổng điểm theo từng cột + tổng cuối = 10.
  3. **Tỉ lệ %:** ${hasEssay ? '30 | 20 | 20 | 30 | 40 | 30 | 30' : 'Tỉ lệ % theo dạng + 100%'}

  **QUY TẮC ĐIỂM SỐ VÀNG (BẮT BUỘC):**
  1. Mọi điểm số PHẢI là bội số của 0.25.
  2. TUYỆT ĐỐI KHÔNG dùng 0.33, 0.42...
  3. Tổng điểm toàn bảng = 10.
  4. Nếu số lượng câu hỏi của một Dạng = 0, thì KHÔNG TẠO cột cho dạng đó.

  **DỮ LIỆU ĐẦU VÀO:**
  ${JSON.stringify(selectedChapters, null, 2)}

  **YÊU CẦU OUTPUT:**
  1. Xuất ra Full HTML Document (<!DOCTYPE html>...). 
  2. Tiêu đề bảng (h2, căn giữa, in đậm): "MA TRẬN ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()}"
  3. Phân bổ câu hỏi theo tỷ lệ số tiết: bài nhiều tiết hơn → nhiều câu hơn.
  4. **QUAN TRỌNG VỚI DẠNG II (Đúng/Sai):** Mỗi câu có 4 ý (a,b,c,d). Các ý phân bổ vào các mức: ví dụ II.1a II.1b ở Biết, II.1c ở Hiểu, II.1d ở VD.
  5. Đảm bảo tổng số câu/ý của mỗi dạng khớp chính xác cấu hình.
  6. **Ghi chú cuối bảng:** "Ghi chú: Các con số trong bảng thể hiện số lượng lệnh hỏi. Mỗi câu hỏi tại phần I và phần III là một lệnh hỏi; mỗi ý hỏi tại Phần II là một lệnh hỏi."

  **Style CSS (Include in <style>):**
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.3; margin: 20px; }
  h2 { text-align: center; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th, td { border: 1px solid black; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { font-weight: bold; }
  .left-align { text-align: left; padding-left: 8px; }
  .bold { font-weight: bold; }

  **CHÚ THÍCH NĂNG LỰC (Cuối bảng):**
  ${footnotes}

  **⚠️ KIỂM TRA CUỐI CÙNG TRƯỚC KHI TRẢ OUTPUT (BẮT BUỘC):**
  1. Đếm tổng số mã câu Dạng I (I.1, I.2...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${type1Total.biet}, Hiểu=${type1Total.hieu}, VD=${type1Total.vd}
  2. Đếm tổng số ý Dạng II (II.1a, II.1b...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${type2Total.biet}, Hiểu=${type2Total.hieu}, VD=${type2Total.vd}
  3. Đếm tổng số mã câu Dạng III (III.1, III.2...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${type3Total.biet}, Hiểu=${type3Total.hieu}, VD=${type3Total.vd}
  ${hasEssay ? `4. Đếm tổng số mã câu Tự luận (IV.1a...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${essayTotal.biet}, Hiểu=${essayTotal.hieu}, VD=${essayTotal.vd}` : ''}
  Nếu bất kỳ số nào KHAI BÁO TRONG BẢNG TRÊN không khớp → SỬA LẠI ma trận cho đúng trước khi trả kết quả.
  `;

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1,
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

  const config = data.questionConfig;
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

  const prompt = `
  Dựa trên **Ma trận đề kiểm tra** (HTML) đã tạo, hãy tạo **BẢNG ĐẶC TẢ ĐỀ KIỂM TRA** (Full HTML Document).
  Phân tích HTML ma trận để lấy số lượng câu hỏi, mã câu, cấu trúc cột chính xác.

  **MA TRẬN ĐẦU VÀO:**
  ${matrixContent}

  **DỮ LIỆU YÊU CẦU CẦN ĐẠT:**
  ${objectivesMap.join('\\n')}

  **===== BẢNG SỐ LƯỢNG GỐC (PHẢI KHỚP 100% - ƯU TIÊN HƠN MA TRẬN NẾU CÓ XUNG ĐỘT) =====**
  | Dạng câu hỏi         | Biết | Hiểu | VD  | TỔNG |
  |---------------------|------|------|-----|------|
  | Dạng I (4 lựa chọn)  | ${type1Total.biet}    | ${type1Total.hieu}    | ${type1Total.vd}   | ${type1Total.biet + type1Total.hieu + type1Total.vd}    |
  | Dạng II (Đúng-Sai) (ý) | ${type2Total.biet}    | ${type2Total.hieu}    | ${type2Total.vd}   | ${type2Total.biet + type2Total.hieu + type2Total.vd}    |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet}    | ${type3Total.hieu}    | ${type3Total.vd}   | ${type3Total.biet + type3Total.hieu + type3Total.vd}    |
  ${hasEssay ? `| Tự luận (IV)       | ${essayTotal.biet}    | ${essayTotal.hieu}    | ${essayTotal.vd}   | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd}    |` : ''}

  **===== ĐỊNH DẠNG BẢNG ĐẶC TẢ BẮT BUỘC (Tuân thủ 100%) =====**

  Tiêu đề bảng (in đậm, căn giữa, ở trên bảng):
   **ĐẶC TẢ ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} - NĂM HỌC 20... - 20...**

  **QUY TẮC NĂM HỌC (BẮT BUỘC):** Thông tin năm học phải ĐỂ TRỐNG dạng: "NĂM HỌC 20... - 20...". TUYỆT ĐỐI KHÔNG điền sẵn bất kỳ năm cụ thể nào.

  **HEADER BẢNG (2 dòng):**
  - Dòng header 1: TT(rowspan=2) | Chương(rowspan=2) | Nội dung/đơn vị kiến thức(rowspan=2) | **Cấp độ tư duy**(rowspan=2) | **Yêu cầu cần đạt**(rowspan=2) | Số lượng câu hỏi ở các mức độ(colspan=...)
  - Dòng header 2 (chia nhỏ cột "Số lượng câu hỏi"):
    + Trắc nghiệm: Nhiều lựa chọn | Đúng-Sai | Trả lời ngắn
    + Tự luận: (nếu có)

  CẤU TRÚC CỘT PHẢI **KHỚP** với Ma trận. Nếu Ma trận không có Tự luận thì Đặc tả cũng không có.

  **NỘI DUNG BẢNG (Quan trọng nhất):**
  Với mỗi bài học/nội dung kiến thức, tạo CÁC DÒNG theo mức độ:

  - Ô "TT" và "Chương/chủ đề": Merge theo chương (rowspan)
  - Ô "Nội dung/ĐVKT": Tên bài
  - Ô "Cấp độ tư duy": Ghi **NB** (Nhận biết), **TH** (Thông hiểu), hoặc **VD** (Vận dụng) - mỗi mức là 1 dòng riêng
  - Ô "Yêu cầu cần đạt": Nội dung CHI TIẾT yêu cầu cần đạt ở mức độ tương ứng. Text-align: left.
  - Các ô mã câu: Ghi mã câu tương ứng (I.1, I.2, II.1a II.1b, III.1, IV.1a...) - PHẢI KHỚP 100% với Ma trận

  **QUAN TRỌNG - FORMAT TỪNG HÀNG:**
  Mỗi bài học có 3 dòng (NB, TH, VD):
  | Nội dung (rowspan=3) | NB | Yêu cầu cần đạt mức NB | I.1 I.2 | | | III.1 | ... |
  | | TH | Yêu cầu cần đạt mức TH | | II.1c | | ... |
  | | VD | Yêu cầu cần đạt mức VD | I.11 | | II.1d | III.2 | ... |

  **QUAN TRỌNG:**
  - Cột "Yêu cầu cần đạt" phải đủ rộng, text-align: left, chứa nội dung chi tiết
  - Số câu hỏi và mã câu PHẢI khớp 100% với BẢNG SỐ LƯỢNG GỐC ở trên (ưu tiên hơn Ma trận nếu có sai lệch)
  - Nếu Ma trận không có cột Tự luận thì Đặc tả cũng KHÔNG có

  **ĐỂ KIỂM TRA CUỐI CÙNG:** Đếm tổng số mã câu trong đặc tả cho mỗi dạng và mức độ. Phải khớp CHÍNH XÁC: Dạng I: B=${type1Total.biet}/H=${type1Total.hieu}/VD=${type1Total.vd}, Dạng II: B=${type2Total.biet}/H=${type2Total.hieu}/VD=${type2Total.vd} (ý), Dạng III: B=${type3Total.biet}/H=${type3Total.hieu}/VD=${type3Total.vd}${totalEssayQuestions > 0 ? `, Tự luận: B=${essayTotal.biet}/H=${essayTotal.hieu}/VD=${essayTotal.vd}` : ''}. Nếu sai thì sửa lại trước khi trả output.

  **QUY TẮC CHÚ THÍCH (FOOTNOTES) - BẮT BUỘC:**
  Cuối bảng thêm:
  ${footnotes}

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
        temperature: 0.1,
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
     - /* CSS cho bảng biến thiên */
     - .bbthien { border-collapse: collapse; margin: 10px auto; font-size: 13pt; }
     - .bbthien td, .bbthien th { border: 1px solid black; padding: 4px 8px; text-align: center; vertical-align: middle; min-width: 40px; }
     - .bbthien .header-row { background-color: #f0f0f0; font-weight: bold; }
     - .bbthien .label-col { text-align: left; font-weight: bold; padding-left: 8px; width: 60px; }

  **===== BẢNG BIẾN THIÊN (CỰC KỲ QUAN TRỌNG - TUÂN THỦ 100%) =====**
  
  Khi đề thi có câu hỏi liên quan đến hàm số cần bảng biến thiên, PHẢI dùng HTML TABLE với cấu trúc CHÍNH XÁC sau:

  **NGUYÊN TẮC VÀNG:**
  1. Mỗi phần tử (x, dấu f'(x), mũi tên, giá trị f(x)) là MỘT Ô RIÊNG BIỆT (<td>).
  2. Số cột phải ĐỒNG NHẤT giữa tất cả các hàng. Dùng colspan nếu cần.
  3. TUYỆT ĐỐI KHÔNG dùng text thuần, ký tự đặc biệt hay ASCII art để vẽ bảng biến thiên.
  4. Mỗi khoảng đồng biến/nghịch biến cần CÓ ô mũi tên: ↗ (đồng biến lên), ↘ (nghịch biến xuống).
  5. Hàng x: liệt kê các giá trị đặc biệt (−∞, điểm cực trị, +∞).
  6. Hàng f'(x): ghi dấu +, 0, − tương ứng với từng khoảng.
  7. Hàng f(x): ghi giá trị cực trị và chiều mũi tên.

  **MẪU HTML BẢNG BIẾN THIÊN (ví dụ hàm bậc 3 có 2 cực trị x=a, x=b):**
  <table class="bbthien">
    <tr>
      <td class="label-col">x</td>
      <td>−∞</td><td></td><td>a</td><td></td><td>b</td><td></td><td>+∞</td>
    </tr>
    <tr>
      <td class="label-col">f'(x)</td>
      <td></td><td>+</td><td>0</td><td>−</td><td>0</td><td>+</td><td></td>
    </tr>
    <tr>
      <td class="label-col">f(x)</td>
      <td>−∞</td><td>↗</td><td>f(a)</td><td>↘</td><td>f(b)</td><td>↗</td><td>+∞</td>
    </tr>
  </table>
  
  **QUY TẮC ĐẾM Ô (BẮT BUỘC):**
  - Nếu hàng x có N ô (kể cả ô label) thì TẤT CẢ các hàng đều phải có ĐÚNG N ô.
  - Ô trống dùng <td></td>, KHÔNG được bỏ qua.
  - Khoảng giữa 2 giá trị x đặc biệt cần 1 ô cho dấu/mũi tên.
  
  **CÁC LOẠI BẢNG BIẾN THIÊN:**
  - Hàm bậc 2: 1 đỉnh = hàng x có 5 cột nội dung (−∞, trống, đỉnh, trống, +∞) + 1 label = 6 cột
  - Hàm bậc 3: 2 cực trị = hàng x có 7 cột nội dung + 1 label = 8 cột
  - Hàm phân thức có tiệm cận đứng: thêm cột cho tiệm cận, dùng || hoặc ∥
  - KIỂM TRA: Đếm số <td> trong mỗi <tr>, phải BẰNG NHAU. Nếu không bằng thì SỬA NGAY.

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
