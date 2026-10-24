import { Chat, Part, Content, ThinkingLevel } from "@google/genai";
import { VariantFileData } from "../types";
import { createGoogleAiClient, getAiProvider, createGeminiConfig, wasTruncated } from "./geminiService";
import { AiProvider, GEMINI_MODELS, AGENT_PLATFORM_MODELS } from "../constants";
import { FIGURE_JSON_MARKDOWN_INSTRUCTIONS } from "./figureEngine";
import { prepareExamSourceParts } from "./examSourceService";

const VARIANTS_SYSTEM_INSTRUCTION = `
# ExamGen Pro - SINH ĐỀ THI ĐA MÔN TỰ ĐỘNG

## VAI TRÒ
Bạn là chuyên gia soạn đề thi các môn phổ thông (Toán, Khoa học tự nhiên, Khoa học xã hội, Ngữ văn, Ngoại ngữ…).
Đề biến thể PHẢI cùng MÔN, cùng KHỐI LỚP, cùng phạm vi kiến thức với đề gốc.

## NHIỆM VỤ
Quy trình làm việc chia làm 3 bước độc lập. Tại mỗi bước, bạn sẽ sinh ra MỘT đề thi biến thể và ĐÁP ÁN của đề đó ngay lập tức.
Mỗi đề biến thể giữ NGUYÊN cấu trúc đề gốc: cùng số phần, cùng số câu từng phần, cùng dạng câu (trắc nghiệm 4 phương án, Đúng – Sai 4 ý a–d, trả lời ngắn, tự luận), cùng thang điểm và mức độ từng câu; chỉ thay số liệu / bối cảnh / cách hỏi.
Đánh số câu "Câu 1", "Câu 2"… như đề gốc.

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
      maxOutputTokens: 32768,
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
      maxOutputTokens: 32768,
    }),
  });
};

const CONTINUE_PROMPT = 'Phần trả lời vừa rồi bị cắt do quá dài. Hãy VIẾT TIẾP ngay từ chỗ bị cắt (không lặp lại phần đã viết, không viết lại tiêu đề), cho tới hết đề và hết đáp án.';
const TRUNCATED_NOTE = '\n\n> ⚠️ Nội dung quá dài nên bị cắt ở đây. Hãy chọn model Pro trong Cài đặt rồi chạy lại, hoặc dùng đề gốc ngắn hơn.';

/**
 * Gửi 1 lượt trong phiên chat và stream kết quả.
 * Nếu AI dừng vì hết giới hạn độ dài (finishReason = MAX_TOKENS) → tự gửi "viết tiếp" (tối đa 2 lần)
 * để đề/đáp án không bị cụt (trước đây phần cuối đề bị mất mà không có thông báo).
 */
const streamWithContinuation = async (
  chat: Chat,
  message: string | Part[],
  onChunk: (text: string) => void
): Promise<void> => {
  let next: string | Part[] = message;
  for (let round = 0; round < 3; round++) {
    const result = await chat.sendMessageStream({ message: next });
    let last: any = null;
    for await (const chunk of result) {
      if (chunk.text) onChunk(chunk.text);
      last = chunk;
    }
    if (!wasTruncated(last)) return;
    if (round === 2) { onChunk(TRUNCATED_NOTE); return; }
    console.warn(`[Variants] Output bị cắt (MAX_TOKENS) → viết tiếp lần ${round + 1}`);
    next = CONTINUE_PROMPT;
  }
};

// Bước 1: Sinh Đề 1 & Đáp án 1 (Có File gốc)
export const generateVariantStep1 = async (
  chat: Chat,
  file: VariantFileData,
  onChunk: (text: string) => void
): Promise<void> => {
  // PDF/ảnh gửi nguyên file; Word .docx được app đọc trước (bảng, công thức LaTeX, hình)
  const sourceParts = await prepareExamSourceParts(file.data, file.type, file.name);

  const textPart: Part = {
    text: `BƯỚC 1:
Dựa vào file đề gốc, hãy sinh ra **ĐỀ BIẾN THỂ SỐ 1**.
Ngay sau đó, viết **ĐÁP ÁN CHI TIẾT CHO ĐỀ SỐ 1**.

Yêu cầu:
- Đề thi: Đủ số lượng câu như đề gốc, đúng môn học và khối lớp của đề gốc. Đầy đủ nội dung.
- Đáp án: Câu dễ chỉ cần đáp án (1.A). Câu khó phải có lời giải vắn tắt.`
  };

  try {
    await streamWithContinuation(chat, [...sourceParts, textPart], onChunk);
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
- Đề thi: Đủ số lượng câu và đúng cấu trúc như đề gốc (không ít hơn, không nhiều hơn).
- Đáp án: Câu dễ chỉ cần đáp án. Câu khó phải có lời giải vắn tắt.`;

  try {
    await streamWithContinuation(chat, prompt, onChunk);
  } catch (error) {
    console.error(`[Variants] Error Step ${stepNumber}:`, error);
    throw error;
  }
};

/**
 * Đếm số câu trong phần ĐỀ của 1 biến thể (trước phần ĐÁP ÁN) để so sánh giữa các đề.
 * Trả về null nếu không nhận ra câu nào.
 */
export const countVariantQuestions = (markdown: string): number | null => {
  if (!markdown) return null;
  const lines = markdown.split('\n').map(l => l.replace(/[*_#>`]/g, '').trim());
  let count = 0;
  let seenQuestion = false;
  for (const line of lines) {
    if (seenQuestion && /^(?:[IVX]+\.|Phần\s*\d+\s*[:.]|PHẦN\s*\d+\s*[:.])?\s*(ĐÁP\s*ÁN|HƯỚNG\s*DẪN\s*(GIẢI|CHẤM)|LỜI\s*GIẢI|BẢNG\s*ĐÁP\s*ÁN)/i.test(line)) break;
    if (/^Câu\s+\d{1,3}\s*[.:)\-–]/i.test(line)) { count++; seenQuestion = true; }
  }
  return count || null;
};
