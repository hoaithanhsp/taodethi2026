import { GoogleGenAI, Chat, Part, Content } from "@google/genai";
import { VariantFileData } from "../types";
import { getApiKey } from "./geminiService";

const VARIANTS_SYSTEM_INSTRUCTION = `
# ExamGen Pro - SINH ĐỀ THI ĐA MÔN TỰ ĐỘNG

## VAI TRÒ
Bạn là chuyên gia soạn đề thi Toán và Khoa học Tự nhiên hàng đầu.

## NHIỆM VỤ
Quy trình làm việc chia làm 3 bước độc lập. Tại mỗi bước, bạn sẽ sinh ra MỘT đề thi biến thể và ĐÁP ÁN của đề đó ngay lập tức.

---

## QUY TẮC TRÌNH BÀY (BẮT BUỘC)
1. **Định dạng Markdown:** Sử dụng Markdown chuẩn.
2. **Công thức:** BẮT BUỘC dùng LaTeX đặt trong dấu $ (ví dụ: $x^2 + 2x + 1 = 0$).
3. **Cấu trúc mỗi lần trả lời:**
   - **Phần 1: ĐỀ THI** (Ghi rõ ĐỀ SỐ [X]). Đầy đủ câu hỏi, trắc nghiệm A,B,C,D.
   - **Phần 2: ĐÁP ÁN & HƯỚNG DẪN GIẢI** (Ngay bên dưới đề thi).
     + Câu DỄ (Nhận biết/Thông hiểu): Chỉ ghi đáp án (Vd: 1.A, 2.B).
     + Câu KHÓ (Vận dụng/Vận dụng cao): Ghi đáp án + Lời giải vắn tắt/Key steps.

4. **Tuyệt đối không:** Không dùng ASCII art vẽ khung.

5. **Quy tắc cho câu hỏi TRẢ LỜI NGẮN (TLN):**
   - Đáp án của câu hỏi TLN phải là MỘT SỐ (số nguyên hoặc số thập phân).
   - Đáp án KHÔNG ĐƯỢC vượt quá 4 ký tự.
   - Nếu kết quả vượt quá 4 ký tự, đề bài phải yêu cầu làm tròn.
   - Thiết kế số liệu sao cho đáp án tự nhiên thỏa mãn điều kiện trên.
`;

export const VARIANT_MODELS = [
  { id: "gemini-3-flash-preview", name: "Gemini 3.0 Flash Preview" },
  { id: "gemini-3-pro-preview", name: "Gemini 3.0 Pro Preview" },
];

export const createVariantSession = (apiKey: string, model: string = "gemini-3-flash-preview"): Chat => {
  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: model,
    config: {
      systemInstruction: VARIANTS_SYSTEM_INSTRUCTION,
      maxOutputTokens: 8192,
    },
  });
};

export const cloneVariantSession = async (apiKey: string, oldChat: Chat, newModel: string): Promise<Chat> => {
  let history: Content[] = [];
  try {
    history = await oldChat.getHistory();
  } catch (e) {
    console.warn("[Variants] Could not retrieve history for cloning, starting fresh", e);
  }

  const ai = new GoogleGenAI({ apiKey });
  return ai.chats.create({
    model: newModel,
    history: history,
    config: {
      systemInstruction: VARIANTS_SYSTEM_INSTRUCTION,
      maxOutputTokens: 8192,
    },
  });
};

// Bước 1: Sinh Đề 1 & Đáp án 1 (Có File gốc)
export const generateVariantStep1 = async (
  chat: Chat,
  file: VariantFileData,
  onChunk: (text: string) => void
): Promise<void> => {
  const filePart: Part = {
    inlineData: {
      mimeType: file.type,
      data: file.data,
    },
  };

  const textPart: Part = {
    text: `BƯỚC 1:
Dựa vào file đề gốc, hãy sinh ra **ĐỀ BIẾN THỂ SỐ 1**.
Ngay sau đó, viết **ĐÁP ÁN CHI TIẾT CHO ĐỀ SỐ 1**.

Yêu cầu:
- Đề thi: Đủ số lượng câu như đề gốc. Đầy đủ nội dung.
- Đáp án: Câu dễ chỉ cần đáp án (1.A). Câu khó phải có lời giải vắn tắt.`
  };

  try {
    const result = await chat.sendMessageStream({
      message: [filePart, textPart]
    });

    for await (const chunk of result) {
      if (chunk.text) onChunk(chunk.text);
    }
  } catch (error) {
    console.error("[Variants] Error Step 1:", error);
    throw error;
  }
};

// Bước 2 & 3: Sinh Đề tiếp theo
export const generateVariantNextStep = async (
  chat: Chat,
  stepNumber: number,
  onChunk: (text: string) => void
): Promise<void> => {
  const prompt = `BƯỚC ${stepNumber}:
Tiếp tục sinh ra **ĐỀ BIẾN THỂ SỐ ${stepNumber}** (Khác số liệu/cách hỏi so với các đề trước).
Ngay sau đó, viết **ĐÁP ÁN CHI TIẾT CHO ĐỀ SỐ ${stepNumber}**.

Yêu cầu:
- Đề thi: Đủ số lượng câu.
- Đáp án: Câu dễ chỉ cần đáp án. Câu khó phải có lời giải vắn tắt.`;

  try {
    const result = await chat.sendMessageStream({
      message: prompt
    });

    for await (const chunk of result) {
      if (chunk.text) onChunk(chunk.text);
    }
  } catch (error) {
    console.error(`[Variants] Error Step ${stepNumber}:`, error);
    throw error;
  }
};
