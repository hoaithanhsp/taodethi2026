import { Type, ThinkingLevel } from "@google/genai";
import { SimilarExamResult, SimilarExamOptions } from "../types";
import { callWithFallback, createGeminiConfig, getAiProvider, wasTruncated, UserFacingError } from "./geminiService";
import { AiProvider } from "../constants";
import { FIGURE_JSON_MARKDOWN_INSTRUCTIONS } from "./figureEngine";

const SIMILAR_SYSTEM_INSTRUCTION = `Bạn là trợ lý tạo đề thi THPT chuyên nghiệp. Nhiệm vụ của bạn là phân tích đề thi mẫu và sinh ra 1 đề thi tương tự.

═══════════════════════════════════════
CHỨC NĂNG CHÍNH
═══════════════════════════════════════

Khi nhận được file PDF/Ảnh đề thi mẫu, bạn sẽ:

1. **PHÂN TÍCH ĐỀ MẪU**:
   - Xác định số lượng câu hỏi.
   - Phân loại dạng toán của từng câu.
   - Xác định mức độ khó (Nhận biết/Thông hiểu/Vận dụng/Vận dụng cao).
   - Ghi nhận cấu trúc câu hỏi, bối cảnh, thông số.

2. **SINH 1 ĐỀ MỚI (2 BƯỚC)**:
   - **Bước 1 (Đề thi)**: Sinh nội dung câu hỏi hoàn chỉnh, không kèm lời giải. Giữ nguyên cấu trúc, chỉ thay số liệu/bối cảnh.
   - **Bước 2 (Lời giải)**: Sinh lời giải chi tiết cho đề thi vừa tạo ở Bước 1.

═══════════════════════════════════════
QUY TẮC SINH ĐỀ
═══════════════════════════════════════

### Nguyên tắc bất biến:
✓ Giữ nguyên loại câu hỏi (trắc nghiệm/tự luận).
✓ Giữ nguyên số điểm từng câu.
✓ Giữ nguyên thứ tự chủ đề.
✓ Giữ nguyên độ phức tạp tính toán.

### Nguyên tắc thay đổi:
✓ Thay số liệu: Đảm bảo đáp án là số đẹp, hợp lý.
✓ Thay bối cảnh: Dùng tình huống thực tế khác nhưng logic tương đương.
✓ Thay thông số hình học: Đảm bảo hình vẽ vẫn hợp lệ.
✓ Thay tên riêng: Người, địa điểm, vật thể.

═══════════════════════════════════════
QUY TẮC CÔNG THỨC TOÁN HỌC (BẮT BUỘC)
═══════════════════════════════════════

⚠️ ĐÂY LÀ QUY TẮC QUAN TRỌNG NHẤT:
- BẮT BUỘC bọc TẤT CẢ công thức toán trong $...$ (inline) hoặc $$...$$ (display/riêng dòng).
- KHÔNG BAO GIỜ viết công thức toán dưới dạng text thuần (plain text).

### Ví dụ ĐÚNG ✅:
- "Cho hàm số $f(x) = 3x^2 + 2x$, tìm $f'(x)$"
- "Tính $\\int_0^1 (2x+1) dx$"
- "Phương trình $x^2 - 5x + 6 = 0$ có hai nghiệm $x_1 = 2$, $x_2 = 3$"
- "Tập nghiệm của bất phương trình $\\frac{x-1}{x+2} \\geq 0$ là $(-\\infty; -2) \\cup [1; +\\infty)$"
- Display math riêng dòng: $$V = \\pi \\int_a^b [f(x)]^2 dx$$

### Ví dụ SAI ❌:
- "Cho hàm số f(x) = 3x^2 + 2x" (thiếu $...$)
- "Tính tích phân từ 0 đến 1 của (2x+1)dx" (không dùng LaTeX)
- "extsinx + Cx3" (công thức bị vỡ)

### Các lệnh LaTeX phổ biến:
- Phân số: $\\frac{a}{b}$
- Căn bậc hai: $\\sqrt{x}$, $\\sqrt[3]{x}$
- Tích phân: $\\int_a^b f(x)dx$
- Giới hạn: $\\lim_{x \\to 0} f(x)$
- Tổng: $\\sum_{i=1}^{n} a_i$
- Lũy thừa: $x^2$, chỉ số: $a_n$
- Lượng giác: $\\sin x$, $\\cos x$, $\\tan x$, $\\cot x$
- Logarit: $\\log_a x$, $\\ln x$
- Vector: $\\vec{a}$, tập hợp: $\\mathbb{R}$
- Dấu: $\\leq$, $\\geq$, $\\neq$, $\\infty$, $\\pm$, $\\cdot$

### ⛔ LỖI NGHIÊNG TRỌNG CẦN TRÁNH:
- KHÔNG ĐƯỢC dùng \\text{sin}, \\text{cos}, \\text{tan}, \\text{cot}, \\text{log}, \\text{ln}
  → PHẢI dùng \\sin, \\cos, \\tan, \\cot, \\log, \\ln (lệnh LaTeX chuẩn)
- KHÔNG ĐƯỢC viết: $\\text{sin}x$ ❌ → PHẢI viết: $\\sin x$ ✅
- KHÔNG ĐƯỢC viết: $\\text{cos}x$ ❌ → PHẢI viết: $\\cos x$ ✅
- KHÔNG ĐƯỢC viết: $\\text{log}x$ ❌ → PHẢI viết: $\\log x$ ✅
- KHÔNG ĐƯỢC dùng \\text{} để bọc tên hàm toán học. \\text{} chỉ dùng cho chữ tiếng Việt bình thường.

═══════════════════════════════════════
ĐỊNH DẠNG XUẤT RA
═══════════════════════════════════════

Ứng dụng sẽ yêu cầu theo 2 LƯỢT riêng (để đề dài không bị cắt):
- LƯỢT 1: trả về JSON { "analysis": "...", "examContent": "..." } — phân tích đề mẫu + ĐỀ MỚI (chỉ câu hỏi, chưa có lời giải).
- LƯỢT 2: chỉ trả về Markdown của LỜI GIẢI cho đề mới (không JSON).
Mỗi lượt làm ĐÚNG phần được yêu cầu trong lượt đó.

## BƯỚC 1: ĐỀ THI (field 'examContent')
Trình bày rõ ràng, phân chia các phần:
**Câu 1:** ...
**Câu 2:** ...

## BƯỚC 2: HƯỚNG DẪN GIẢI CHI TIẾT (field 'detailedSolution')

#### I. BẢNG ĐÁP ÁN NHANH (BẮT BUỘC CÓ)
**1. Trắc nghiệm nhiều phương án:**
Câu 1: A | Câu 2: B | Câu 3: C | ...

**2. Trắc nghiệm Đúng - Sai (Đ/S) (BẮT BUỘC LẬP BẢNG ĐỦ 4 ĐÁP ÁN a, b, c, d):**
| Câu | Ý a) | Ý b) | Ý c) | Ý d) |
| :---: | :---: | :---: | :---: | :---: |
| **Câu 1** | **Đ** | **S** | **Đ** | **S** |
| **Câu 2** | **S** | **Đ** | **S** | **Đ** |

**3. Trả lời ngắn:**
Câu ...: Đáp số là ...

#### II. LỜI GIẢI CHI TIẾT (BẮT BUỘC GIẢI TẤT CẢ CÁC CÂU)
- **ĐẶC BIỆT CHÚ Ý PHẦN ĐÚNG - SAI (Đ/S):** Bắt buộc trình bày dưới dạng **Bảng thông tin hướng dẫn giải và 4 đáp án** cho từng câu Đúng - Sai (để khi xuất ra file Word có bảng đầy đủ 4 đáp án a, b, c, d và lời giải chi tiết cho từng ý):
| Câu | Ý | Đáp án (Đ/S) | Hướng dẫn giải chi tiết |
| :---: | :---: | :---: | :--- |
| **Câu 1** | **a)** | **Đ** | Giải thích / lời giải chi tiết cho ý a)... |
| **Câu 1** | **b)** | **S** | Giải thích / lời giải chi tiết cho ý b)... |
| **Câu 1** | **c)** | **Đ** | Giải thích / lời giải chi tiết cho ý c)... |
| **Câu 1** | **d)** | **S** | Giải thích / lời giải chi tiết cho ý d)... |

## Quy tắc Markdown & Hình vẽ trực quan:
- Công thức: Inline: $x^2 + y^2 = r^2$ | Display: $$ \\\\int_{a}^{b} f(x)dx $$
${FIGURE_JSON_MARKDOWN_INSTRUCTIONS}
`;


/** Đọc JSON trả về từ AI: chịu được code fence ```json và ký tự thừa trước/sau. */
const parseJsonLoose = <T,>(text: string): T => {
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw err;
  }
};

const buildCustomInstructions = (options?: SimilarExamOptions): string => {
  let customInstructions = "";
  if (!options) return customInstructions;
  if (options.diagramMode === 'detailed') {
    customInstructions += `\n\n### YÊU CẦU NÂNG CAO VỀ HÌNH VẼ (High Detail):
- BẮT BUỘC vẽ hình trực quan bằng khối \`\`\`figure-json ... \`\`\` cho mọi câu có Bảng biến thiên (type: "bbt"), Đồ thị hàm số / Diện tích hình phẳng (type: "graph"), Hình không gian 3D (type: "geo3d"), và Hình phẳng 2D (type: "geo2d").
- Với hình không gian 3D và hình phẳng 2D: Khai báo đầy đủ các điểm phụ (extra) và ký hiệu góc vuông (marks).
- Với đồ thị: Hiển thị đầy đủ tiệm cận, điểm cực trị và miền tô tích phân nếu có.`;
  } else {
    customInstructions += `\n\n### YÊU CẦU VỀ HÌNH VẼ (Standard):
- Sử dụng khối \`\`\`figure-json ... \`\`\` để vẽ tự động Bảng biến thiên (bbt), Đồ thị hàm số (graph), Hình không gian 3D (geo3d) và Hình phẳng 2D (geo2d).`;
  }
  if (options.solutionMode === 'concise') {
    customInstructions += `\n\n### YÊU CẦU VỀ LỜI GIẢI (Concise Mode):
- TRẢ LỜI NGẮN GỌN. Tập trung vào đáp số và 1-2 bước biến đổi chốt.`;
  } else if (options.solutionMode === 'very_detailed') {
    customInstructions += `\n\n### YÊU CẦU VỀ LỜI GIẢI (Deep Dive Mode):
- GIẢI CỰC KỲ CHI TIẾT. Mỗi bài gồm: Phân tích đề → Chiến lược → Lời giải → Sai lầm thường gặp.`;
  } else {
    customInstructions += `\n\n### YÊU CẦU VỀ LỜI GIẢI (Standard Mode):
- Lời giải chi tiết, đầy đủ các bước, trình bày sư phạm, dễ hiểu.`;
  }
  return customInstructions;
};

const TRUNCATED_NOTE = '\n\n> ⚠️ Lời giải quá dài nên bị cắt ở đây. Hãy chọn "Chi tiết lời giải: Ngắn gọn" hoặc model Pro rồi tạo lại để có lời giải đầy đủ.';

/**
 * Tạo đề tương tự theo 2 lượt (tránh đề dài bị cắt cụt khi gộp tất cả vào 1 JSON):
 *  - Lượt 1 (JSON nhỏ): phân tích đề mẫu + đề mới.  → gọi onExamReady để hiện đề ngay.
 *  - Lượt 2 (Markdown): lời giải chi tiết cho đề mới; bị cắt do quá dài thì tự viết tiếp tối đa 2 lần.
 */
export const generateSimilarExam = async (
  base64Data: string,
  mimeType: string,
  options?: SimilarExamOptions,
  preferredModel?: string,
  provider: AiProvider = getAiProvider(),
  onExamReady?: (partial: SimilarExamResult) => void
): Promise<SimilarExamResult> => {
  const finalSystemInstruction = SIMILAR_SYSTEM_INSTRUCTION + buildCustomInstructions(options);

  // ---------- LƯỢT 1: phân tích + đề mới ----------
  const step1 = await callWithFallback(
    async (ai, modelName) => {
      console.log(`[SimilarExam] (${provider}) Lượt 1 – model: ${modelName}`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: base64Data } },
            { text: "LƯỢT 1: Hãy phân tích đề thi này và tạo 1 ĐỀ MỚI tương tự (giữ nguyên số câu, dạng câu, thứ tự phần, điểm). CHỈ trả về JSON gồm 'analysis' và 'examContent' — CHƯA viết lời giải." }
          ]
        },
        config: createGeminiConfig({
          provider,
          model: modelName,
          systemInstruction: finalSystemInstruction,
          thinkingLevel: ThinkingLevel.MEDIUM,
          maxOutputTokens: 32768,
          temperature: 0.5,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              analysis: { type: Type.STRING, description: "Phân tích chi tiết cấu trúc, ma trận đề thi mẫu." },
              examContent: { type: Type.STRING, description: "Nội dung ĐỀ THI mới (Bước 1) - Chỉ chứa câu hỏi." },
            },
            required: ["analysis", "examContent"]
          }
        })
      });

      const text = response.text;
      if (!text) throw new Error("AI không trả về nội dung.");
      if (wasTruncated(response)) {
        throw new UserFacingError('Đề mẫu quá dài nên AI bị cắt giữa chừng khi tạo đề mới. Hãy tách đề mẫu thành 2 phần (ví dụ phần trắc nghiệm và phần tự luận) rồi tạo lần lượt, hoặc chọn model Pro.');
      }
      try {
        const parsed = parseJsonLoose<{ analysis?: string; examContent?: string }>(text);
        if (!parsed.examContent || !parsed.examContent.trim()) throw new Error('missing examContent');
        return { analysis: parsed.analysis || '', examContent: parsed.examContent };
      } catch {
        throw new UserFacingError('AI trả về dữ liệu không đúng định dạng. Vui lòng bấm "Thử lại".');
      }
    },
    preferredModel,
    provider
  );

  onExamReady?.({ ...step1, detailedSolution: '' });

  // ---------- LƯỢT 2: lời giải chi tiết (Markdown, tự viết tiếp nếu bị cắt) ----------
  let solution = '';
  try {
  for (let round = 0; round < 3; round++) {
    const isContinuation = round > 0;
    const prompt = isContinuation
      ? `ĐỀ THI:\n${step1.examContent}\n\n===== LỜI GIẢI ĐÃ VIẾT (bị cắt do quá dài) =====\n${solution}\n\n===== YÊU CẦU =====\nHãy VIẾT TIẾP lời giải ngay từ chỗ bị cắt ở trên. KHÔNG lặp lại phần đã viết, KHÔNG viết lại tiêu đề. Chỉ trả về Markdown phần viết tiếp.`
      : `LƯỢT 2: Dưới đây là ĐỀ MỚI vừa tạo. Hãy viết HƯỚNG DẪN GIẢI CHI TIẾT cho đề này đúng định dạng "BƯỚC 2" (I. Bảng đáp án nhanh, II. Lời giải chi tiết cho TẤT CẢ các câu). CHỈ trả về nội dung Markdown của lời giải (không JSON, không chép lại đề).\n\nĐỀ MỚI:\n${step1.examContent}`;
    const { text, truncated } = await callWithFallback(
      async (ai, modelName) => {
        console.log(`[SimilarExam] (${provider}) Lượt 2${isContinuation ? ` (viết tiếp ${round})` : ''} – model: ${modelName}`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { role: 'user', parts: [{ text: prompt }] },
          config: createGeminiConfig({
            provider,
            model: modelName,
            systemInstruction: finalSystemInstruction,
            thinkingLevel: ThinkingLevel.MEDIUM,
            maxOutputTokens: 32768,
            temperature: 0.3,
          })
        });
        return {
          text: (response.text || '').replace(/^\s*```(?:markdown|md)?\s*/i, '').replace(/\s*```\s*$/i, ''),
          truncated: wasTruncated(response),
        };
      },
      preferredModel,
      provider
    );
    solution += text; // phần viết tiếp nối liền chỗ bị cắt
    if (!truncated) break;
    if (round === 2) solution += TRUNCATED_NOTE;
  }
  } catch (err: any) {
    // Đề mới đã có → không bỏ đi; chỉ báo lời giải chưa tạo xong
    console.warn('[SimilarExam] Lượt 2 (lời giải) lỗi:', err);
    solution += `\n\n> ⚠️ Chưa tạo xong lời giải: ${err?.message || 'lỗi không xác định'}. Bấm "Tạo đề mới" để thử lại.`;
  }

  return { ...step1, detailedSolution: solution };
};
