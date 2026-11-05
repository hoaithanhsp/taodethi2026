import { Chat, Part, Content, ThinkingLevel } from "@google/genai";
import { VariantFileData } from "../types";
import { createGoogleAiClient, getAiProvider, createGeminiConfig, wasTruncated } from "./geminiService";
import { AiProvider, GEMINI_MODELS, AGENT_PLATFORM_MODELS } from "../constants";
import { FIGURE_JSON_MARKDOWN_INSTRUCTIONS } from "./figureEngine";
import { prepareExamSourceParts } from "./examSourceService";

export const VARIANTS_SYSTEM_INSTRUCTION = `
# ExamGen Pro - SINH ĐỀ THI ĐA MÔN TỰ ĐỘNG

## VAI TRÒ
Bạn là chuyên gia soạn đề thi các môn phổ thông (Toán, Khoa học tự nhiên, Khoa học xã hội, Ngữ văn, Ngoại ngữ…).
Đề biến thể PHẢI cùng MÔN, cùng KHỐI LỚP, cùng phạm vi kiến thức với đề gốc.

## NHIỆM VỤ
Quy trình làm việc chia làm 3 bước độc lập. Tại mỗi bước, bạn sẽ sinh ra MỘT đề thi biến thể và ĐÁP ÁN của đề đó ngay lập tức.
Mỗi bước có MỤC TIÊU RIÊNG, không được làm 3 đề giống nhau về cách biến đổi:
- Đề 1 – ĐỀ TƯƠNG TỰ: cùng dạng toán, cùng mức độ; chỉ thay số liệu và bối cảnh tương tự.
- Đề 2 – ĐỀ DẠNG NGƯỢC / BỔ SUNG: đảo chiều bài toán hoặc bổ sung dạng toán tương tự; độ khó tương đương đề gốc.
- Đề 3 – ĐỀ NÂNG CAO: khó hơn rõ rệt so với Đề 1 và Đề 2.
Cả 3 đề giữ NGUYÊN KHUNG đề gốc: cùng số phần, cùng số câu từng phần, cùng hình thức câu (trắc nghiệm 4 phương án, Đúng – Sai 4 ý a–d, trả lời ngắn, tự luận) và cùng thang điểm. "Hình thức câu" được giữ nguyên, còn "dạng toán" và "mức độ" làm theo yêu cầu của từng bước.
Với môn không phải Toán, hiểu "dạng toán" là dạng bài / dạng câu hỏi của môn đó.
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

export type VariantStep = 1 | 2 | 3;

/** Loại của từng đề: dùng chung cho nhãn trên giao diện. */
export const VARIANT_PROFILES: Record<VariantStep, { label: string; description: string }> = {
  1: { label: 'Đề tương tự', description: 'Cùng dạng toán, cùng mức độ; chỉ thay số liệu và bối cảnh tương tự' },
  2: { label: 'Đề dạng ngược / bổ sung', description: 'Đảo chiều bài toán hoặc bổ sung dạng toán tương tự với đề gốc' },
  3: { label: 'Đề nâng cao', description: 'Cùng cấu trúc nhưng khó hơn rõ rệt so với Đề 1 và Đề 2' },
};

const COMMON_REQUIREMENTS = `Yêu cầu chung:
- Đủ số câu và đúng khung đề gốc (số phần, số câu từng phần, hình thức câu, thang điểm); không ít hơn, không nhiều hơn.
- Đúng môn học, khối lớp và phạm vi kiến thức của đề gốc.
- Tiêu đề đề thi chỉ ghi "ĐỀ SỐ [X]", không ghi loại đề vì đề sẽ phát cho học sinh.
- Tự giải lại từng câu trước khi xuất: đề phải có lời giải hợp lệ, trắc nghiệm có đúng 1 phương án đúng, đáp án khớp với đề.
- Đáp án: Câu dễ chỉ cần đáp án (1.A). Câu khó phải có lời giải vắn tắt.`;

const VARIANT_STEP_GOALS: Record<VariantStep, string> = {
  1: `ĐỀ 1 LÀ **ĐỀ TƯƠNG TỰ** với đề gốc. Bám sát đề gốc theo từng câu, đúng thứ tự:
- Câu k của đề mới có CÙNG dạng toán, cùng kiến thức, cùng phương pháp giải và cùng mức độ với câu k của đề gốc.
- Chỉ thay số liệu (hàm số, hệ số, tọa độ, dữ kiện…) và thay bối cảnh bằng bối cảnh tương tự (ví dụ: bể nước → bồn xăng). Câu nào cũng phải khác đề gốc về số liệu hoặc bối cảnh.
- KHÔNG đổi yêu cầu của câu hỏi, KHÔNG đảo chiều bài toán, KHÔNG thêm bước giải: học sinh làm được đề gốc thì làm được đề này theo đúng cách đó.
- Môn không phải Toán: thay ngữ liệu, ví dụ, sự kiện, tình huống bằng nội dung tương đương, kiểm tra cùng kiến thức và kỹ năng.`,

  2: `ĐỀ 2 LÀ **ĐỀ DẠNG NGƯỢC / BỔ SUNG**. Thay số đơn thuần là KHÔNG đạt. Với mỗi câu k, giữ chủ đề của câu k trong đề gốc và làm theo 1 trong 2 cách:
- **Cách A – Dạng ngược (ưu tiên):** đổi chiều bài toán, điều đã cho thành điều cần tìm và ngược lại. Ví dụ: đề gốc cho hàm số, tìm cực trị → đề mới cho điểm cực trị, tìm tham số; cho phương trình, tìm nghiệm → cho nghiệm, tìm hệ số; cho dữ liệu, tính số trung bình → cho số trung bình, tìm dữ liệu còn thiếu.
- **Cách B – Bổ sung dạng toán tương tự:** chỉ dùng khi câu đó không đảo chiều tự nhiên được. Ra một dạng toán KHÁC cùng chủ đề mà đề gốc chưa hỏi. Ví dụ: đề gốc tìm số hạng của cấp số cộng → đề mới tính tổng n số hạng đầu.
Lưu ý:
- Độ khó của mỗi câu TƯƠNG ĐƯƠNG câu k của đề gốc, không nâng độ khó (nâng độ khó là việc của Đề 3).
- Không lặp lại câu hỏi hay số liệu của Đề 1.
- Bài ngược dễ sinh đề vô lý: phải giải xuôi lại để chắc chắn dữ kiện đủ, không mâu thuẫn và đáp án đúng.
- Môn không phải Toán: dạng ngược là đổi chiều câu hỏi (cho hiện tượng hỏi nguyên nhân thay vì cho nguyên nhân hỏi hiện tượng; cho ví dụ hỏi khái niệm thay vì cho khái niệm hỏi ví dụ); bổ sung là thêm dạng câu hỏi khác cùng chủ đề.
Dòng cuối cùng của phần đáp án, sau toàn bộ lời giải, viết đúng 1 dòng theo mẫu (không dùng bảng, không viết chữ "Câu"):
**Đối chiếu với đề gốc:** C1 – ngược; C2 – bổ sung; C3 – ngược; …`,

  3: `ĐỀ 3 LÀ **ĐỀ NÂNG CAO**, phải khó hơn RÕ RỆT so với cả Đề 1 và Đề 2 đã sinh ở trên, nhưng vẫn giữ nguyên khung đề gốc:
- Mỗi câu k khó hơn câu k tương ứng ít nhất một bậc: Biết → Hiểu, Hiểu → Vận dụng, Vận dụng → Vận dụng cao; câu đã ở mức Vận dụng cao thì thêm bước suy luận.
- Cách nâng độ khó: thêm bước giải, kết hợp hai mảng kiến thức, thêm tham số hoặc điều kiện ẩn, yêu cầu tự lập mô hình từ tình huống thực tế, dùng phương án nhiễu từ sai lầm thường gặp.
- KHÔNG được coi là khó hơn: chỉ đổi số to hơn hoặc số lẻ hơn, chỉ viết câu chữ dài hơn.
- Vẫn nằm trong chương trình của khối lớp và phạm vi kiến thức của đề gốc; không dùng kiến thức lớp trên; học sinh khá giỏi vẫn làm kịp trong thời gian làm bài.
- Không lặp lại câu hỏi hay số liệu của Đề 1 và Đề 2.
- Môn không phải Toán: nâng từ nhận biết lên phân tích, so sánh, đánh giá, vận dụng vào tình huống mới.
- Đáp án: mọi câu từ mức Vận dụng trở lên đều có lời giải vắn tắt.
Dòng cuối cùng của phần đáp án, sau toàn bộ lời giải, viết đúng 1 dòng theo mẫu (không dùng bảng, không viết chữ "Câu"):
**Đối chiếu độ khó với đề gốc:** C1 – Biết → Hiểu; C2 – Hiểu → Vận dụng; …`,
};

/** Yêu cầu gửi cho AI ở từng bước: mỗi đề có mục tiêu biến đổi riêng. */
export const buildVariantStepPrompt = (step: VariantStep): string => `BƯỚC ${step}:
Dựa vào file đề gốc, hãy sinh ra **ĐỀ BIẾN THỂ SỐ ${step}**.
Ngay sau đó, viết **ĐÁP ÁN CHI TIẾT CHO ĐỀ SỐ ${step}**.

${VARIANT_STEP_GOALS[step]}

${COMMON_REQUIREMENTS}`;

// Bước 1: Sinh Đề 1 & Đáp án 1 (Có File gốc)
export const generateVariantStep1 = async (
  chat: Chat,
  file: VariantFileData,
  onChunk: (text: string) => void
): Promise<void> => {
  // PDF/ảnh gửi nguyên file; Word .docx được app đọc trước (bảng, công thức LaTeX, hình)
  const sourceParts = await prepareExamSourceParts(file.data, file.type, file.name);
  const textPart: Part = { text: buildVariantStepPrompt(1) };

  try {
    await streamWithContinuation(chat, [...sourceParts, textPart], onChunk);
  } catch (error) {
    console.error("[Variants] Error Step 1:", error);
    throw error;
  }
};

// Bước 2 & 3: Sinh Đề tiếp theo (đề gốc đã nằm trong lịch sử phiên chat)
export const generateVariantNextStep = async (
  chat: Chat,
  stepNumber: 2 | 3,
  onChunk: (text: string) => void
): Promise<void> => {
  try {
    await streamWithContinuation(chat, buildVariantStepPrompt(stepNumber), onChunk);
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
