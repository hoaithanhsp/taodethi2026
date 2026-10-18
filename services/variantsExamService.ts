import { Chat, Part, Content, ThinkingLevel } from "@google/genai";
import { VariantFileData } from "../types";
import { createGoogleAiClient, getAiProvider, createGeminiConfig } from "./geminiService";
import { AiProvider, GEMINI_MODELS, AGENT_PLATFORM_MODELS } from "../constants";
import { FIGURE_JSON_MARKDOWN_INSTRUCTIONS } from "./figureEngine";

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
     + **ĐẶC BIỆT CHÚ Ý PHẦN ĐÚNG - SAI (Đ/S):** Bắt buộc trình bày **Bảng thông tin hướng dẫn giải và 4 đáp án (a, b, c, d)** cho từng câu Đúng - Sai:
       | Câu | Ý | Đáp án (Đ/S) | Hướng dẫn giải chi tiết |
       | :---: | :---: | :---: | :--- |
       | **Câu 1** | **a)** | **Đ** | Hướng dẫn giải ý a)... |
       | **Câu 1** | **b)** | **S** | Hướng dẫn giải ý b)... |
       | **Câu 1** | **c)** | **Đ** | Hướng dẫn giải ý c)... |
       | **Câu 1** | **d)** | **S** | Hướng dẫn giải ý d)... |

4. **Tuyệt đối không:** Không dùng ASCII art vẽ khung.

5. **Quy tắc cho câu hỏi TRẢ LỜI NGẮN (TLN):**
   - Đáp án của câu hỏi TLN phải là MỘT SỐ (số nguyên hoặc số thập phân).
   - Đáp án KHÔNG ĐƯỢC vượt quá 4 ký tự.
   - Nếu kết quả vượt quá 4 ký tự, đề bài phải yêu cầu làm tròn.
   - Thiết kế số liệu sao cho đáp án tự nhiên thỏa mãn điều kiện trên.

${FIGURE_JSON_MARKDOWN_INSTRUCTIONS}
`;

export const getVariantModels = (provider: AiProvider = getAiProvider()) => {
  if (provider === 'agent-platform') {
    return AGENT_PLATFORM_MODELS.map(m => ({ id: m.id, name: m.name }));
  }
  return GEMINI_MODELS.map(m => ({ id: m.id, name: m.name }));
};

export const VARIANT_MODELS = getVariantModels('gemini');

export const createVariantSession = (
  apiKey: string,
  model?: string,
  provider: AiProvider = getAiProvider()
): Chat => {
  const models = getVariantModels(provider);
  const selectedModel = model || models[0].id;
  const ai = createGoogleAiClient(apiKey, provider);
  return ai.chats.create({
    model: selectedModel,
    config: createGeminiConfig({
      provider,
      model: selectedModel,
      systemInstruction: VARIANTS_SYSTEM_INSTRUCTION,
      thinkingLevel: ThinkingLevel.MEDIUM,
      maxOutputTokens: 16384,
    }),
  });
};

export const cloneVariantSession = async (
  apiKey: string,
  oldChat: Chat,
  newModel: string,
  provider: AiProvider = getAiProvider()
): Promise<Chat> => {
  let history: Content[] = [];
  try {
    history = await oldChat.getHistory();
  } catch (e) {
    console.warn("[Variants] Could not retrieve history for cloning, starting fresh", e);
  }

  const ai = createGoogleAiClient(apiKey, provider);
  return ai.chats.create({
    model: newModel,
    history: history,
    config: createGeminiConfig({
      provider,
      model: newModel,
      systemInstruction: VARIANTS_SYSTEM_INSTRUCTION,
      thinkingLevel: ThinkingLevel.MEDIUM,
      maxOutputTokens: 16384,
    }),
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
