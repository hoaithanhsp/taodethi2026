---
name: google-ai-api-key-validation
description: Update codebases that validate Google AI Studio, Gemini, or Generative Language API keys so both legacy keys starting with AIzaSy and new keys starting with AQ are accepted. Use when an app rejects Gemini/Google AI API keys, shows "Invalid API Key", hard-codes startsWith("AIza") or startsWith("AIzaSy"), or needs a reusable regex/helper for API key format validation across frontend, backend, env parsing, settings modals, or key rotation managers.
---

# Google AI API Key Validation

## Goal

Update API key validation without changing actual Google API calls. The app should stop rejecting user-entered Google AI/Gemini keys that start with `AQ`, while still accepting legacy keys that start with `AIzaSy`.

## Workflow

1. Search the codebase for likely validators and user-facing copy:
   - `AIza`, `AIzaSy`, `AQ`
   - `Invalid API Key`, `API Key khong hop le`, `Key phai bat dau`
   - `startsWith`, regex literals, `apiKey`, `api_key`, `GEMINI_API_KEY`, `VITE_GEMINI_API_KEYS`
2. Inspect every validation path, not only the visible input modal:
   - settings or API key modal
   - localStorage/sessionStorage migration
   - env key parsing
   - key manager or key rotation logic
   - backend request validation, if present
   - bundled production output only if the project commits build artifacts
3. Replace prefix-only checks such as `key.startsWith("AIza")` with a shared helper where the project style allows it.
4. Update UI copy and placeholders so users see `AIzaSy... or AQ...`, not only `AIza...`.
5. Build or run the narrowest available validation command. If there are pre-existing unrelated type or lint failures, report them clearly.

## Recommended Regex

Prefer a permissive prefix validator:

```ts
const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIzaSy|AQ)\S{8,}$/;
```

Use the same pattern in JavaScript, TypeScript, Python, or other languages:

- Accepts `AIzaSy...`
- Accepts `AQ...`
- Rejects empty strings, whitespace-containing keys, and unrelated prefixes
- Avoids overfitting the unknown tail of the newer `AQ` format

If an existing app intentionally validates a stricter character set and there is confirmed product documentation for the key body, keep the stricter body but still include both prefixes:

```ts
const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIzaSy|AQ)[A-Za-z0-9_-]{8,}$/;
```

## Helper Pattern

For TypeScript/JavaScript projects, prefer a small shared helper instead of duplicating regexes:

```ts
export const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIzaSy|AQ)\S{8,}$/;

export const isValidGoogleAiApiKey = (key: string): boolean => {
  return GOOGLE_AI_API_KEY_PATTERN.test(key.trim());
};
```

For Python:

```python
import re

GOOGLE_AI_API_KEY_PATTERN = re.compile(r"^(?:AIzaSy|AQ)\S{8,}$")

def is_valid_google_ai_api_key(key: str) -> bool:
    return bool(GOOGLE_AI_API_KEY_PATTERN.match(key.strip()))
```

## Guardrails

- Do not log full API keys. If display is needed, mask keys with prefix plus last four characters.
- Do not remove server-side authentication or actual API error handling.
- Do not treat a real 401/403 response from Google as a format-validation issue.
- Do not edit unrelated generated bundles unless the repository clearly commits and serves `dist` or equivalent build output.
- Do not run destructive git commands. Preserve user changes.

## Script

Use `scripts/scan_google_ai_key_validation.py <project-root>` to find likely files that still hard-code `AIza` validation or old API key copy. The script is read-only and prints file, line number, and matching pattern.

---
name: gemini-model-overload-fallback
description: Update codebases that call Google AI Studio, Gemini, or Generative Language APIs so transient model overload errors are handled correctly. Use when an app logs or displays 503, UNAVAILABLE, "This model is currently experiencing high demand", "model overloaded", "try again later", or when Gemini calls use a single selected model without fallback and incorrectly surface the issue as Invalid API Key, quota, or a hard failure.
---

# Gemini Model Overload Fallback

## Goal

Make Gemini-powered apps resilient to temporary Google model overloads. A `503 UNAVAILABLE` or "high demand" response is a model/service availability issue, not an API key format, auth, or quota problem.

## Workflow

1. Search the codebase for Gemini call sites and error handling:
   - `503`, `UNAVAILABLE`, `high demand`, `overloaded`, `try again later`
   - `generateContent`, `generateContentStream`, `sendMessageStream`
   - `parseApiError`, `getFriendlyErrorMessage`, `Invalid API Key`, `INVALID_API_KEY`
   - `FALLBACK_MODELS`, `selectedModel`, `model`, `apiKeyManager`, `markKeyError`
2. Run `scripts/scan_gemini_model_overload.py <project-root>` for a quick read-only scan.
3. Confirm the error category:
   - `401`, `API_KEY_INVALID`, `PERMISSION_DENIED` => auth/key issue.
   - `429`, `RESOURCE_EXHAUSTED`, quota text => quota/rate limit issue.
   - `503`, `UNAVAILABLE`, `high demand`, `overloaded` => model overload; do not blame the API key.
4. Add or reuse a model fallback list. Keep the user's selected model first, then try stable/cheaper fallbacks.
5. Add a dedicated error type such as `MODEL_OVERLOADED` before generic `UNKNOWN` handling.
6. Apply fallback loops to every Gemini path, especially one-off analysis helpers that call `ai.models.generateContent` directly.
7. Keep API key rotation separate. Do not mark keys invalid, error, or cooldown for `MODEL_OVERLOADED`.
8. Update user-facing copy so the app says the model is temporarily overloaded and suggests retrying or selecting a lighter model.
9. Build or run the narrowest validation command.

## Current Gemini Models (Free & Paid General Text/Multimodal)

Last checked against official Google AI Gemini API docs and pricing on 2026-10-18.

For general `generateContent` / `generateContentStream` fallback in production apps, prefer the latest stable text-output models prioritized by Google capacity:

```ts
const GENERAL_GEMINI_MODELS = [
  'gemini-3.8-flash',      // New Stable (09/2026): strongest & most intelligent Flash model; default recommended by Google
  'gemini-3.7-flash',      // Stable (08/2026): high-speed, reliable multi-step execution
  'gemini-3.5-flash-lite', // Stable (07/2026): ultra-fast, high-throughput, high capacity & lowest cost
  'gemini-3.6-flash',      // Stable (07/2026): balanced multimodal fallback
  'gemini-3.5-flash',      // Stable: legacy 3.5 Flash fallback
  'gemini-3.1-flash-lite', // Stable: backward-compatible lightweight fallback
  'gemini-2.5-flash',      // Stable: final fallback in chain
];
```

If the project explicitly needs lightweight/low-cost extraction first, `gemini-3.5-flash-lite` or `gemini-3.1-flash-lite` can be placed first, followed by `gemini-3.8-flash` and `gemini-3.7-flash`.

Do not add paid-only or specialized models to a generic free fallback list unless the app explicitly uses that modality:

- `gemini-3.1-pro-preview` and `gemini-3.1-pro-preview-customtools` are not available on the Free tier.
- `gemini-omni-flash-preview`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, and `gemini-3-pro-image` are paid-only or specialized media endpoints.
- TTS (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`), Live (`gemini-3.8-live`), Live Translate, image generation, embeddings, and video models should have separate routing because their request/response shapes and pricing differ from normal text-output `generateContent`.
- Gemini 2.0 models are shut down; do not keep `gemini-2.0-flash` or `gemini-2.0-flash-lite` in fallback arrays.

When editing apps, keep the user's selected model first, then append this ordered fallback list without duplicates. Check the live Google AI pricing and models pages again before changing this list because model availability and free-tier access can change.

## TypeScript Pattern

Use the existing model constants if the app already has them. Otherwise define a conservative ordered list:

```ts
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const FALLBACK_MODELS = [
  DEFAULT_GEMINI_MODEL,
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];
```

Detect overload and transient network/gateway errors separately from auth and quota:

```ts
export const parseApiError = (error: any): string => {
  const message = error?.message || error?.toString() || '';
  const serialized = JSON.stringify(error) || '';
  const combined = `${message} ${serialized}`.toLowerCase();

  if (
    combined.includes('429') ||
    combined.includes('resource_exhausted') ||
    combined.includes('quota') ||
    combined.includes('rate limit')
  ) return 'QUOTA_EXCEEDED';

  if (
    combined.includes('503') ||
    combined.includes('unavailable') ||
    combined.includes('high demand') ||
    combined.includes('overloaded') ||
    combined.includes('try again later')
  ) return 'MODEL_OVERLOADED';

  if (
    combined.includes('500') ||
    combined.includes('502') ||
    combined.includes('504') ||
    combined.includes('deadline_exceeded') ||
    combined.includes('bad gateway') ||
    combined.includes('fetch failed') ||
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('econnreset') ||
    combined.includes('etimedout')
  ) return 'TRANSIENT_SERVER_ERROR';

  if (
    combined.includes('api_key_invalid') ||
    combined.includes('401') ||
    combined.includes('permission_denied')
  ) return 'INVALID_API_KEY';

  return 'UNKNOWN';
};
```

For non-streaming `generateContent` helpers:

```ts
const getOrderedModels = (selectedModel?: string): string[] => {
  const preferred = selectedModel?.trim() || DEFAULT_GEMINI_MODEL;
  return [preferred, ...FALLBACK_MODELS].filter(
    (model, index, models) => models.indexOf(model) === index
  );
};

const generateContentWithModelFallback = async ({
  apiKey,
  selectedModel,
  contents,
  config,
}: {
  apiKey: string;
  selectedModel?: string;
  contents: any;
  config?: any;
}) => {
  const ai = new GoogleGenAI({ apiKey });
  let lastError: any = null;

  for (const model of getOrderedModels(selectedModel)) {
    try {
      return await ai.models.generateContent({
        model,
        contents,
        ...(config ? { config } : {}),
      });
    } catch (error: any) {
      lastError = error;
      const errType = parseApiError(error);
      if (errType !== 'MODEL_OVERLOADED' && errType !== 'TRANSIENT_SERVER_ERROR') {
        break;
      }
    }
  }

  throw lastError || new Error('All Gemini models failed. Please try again later.');
};
```

For streaming calls, the same loop is appropriate, but preserve chat history only after a full successful response. If partial chunks already reached the UI before a stream fails, clear or annotate the partial output before retrying with another model.

## Key Rotation Guard

If the app has an API key manager, keep overload errors from poisoning key state:

```ts
if (errorType === 'MODEL_OVERLOADED') {
  keyInfo.lastError = errorType;
  saveToStorage();
  return {
    success: false,
    hasMoreKeys: hasAvailableKeys(),
    message: 'Model is temporarily overloaded; API key remains active.',
  };
}
```

Only rotate or cooldown keys for quota and rate limit errors. Only mark keys invalid for authentication errors.

## Validation

After edits:

1. Run the scan script again and inspect remaining direct `generateContent` call sites.
2. Run the project build, for example `npm run build`.
3. Confirm the app no longer shows "Invalid API Key" for a `503` overload.
4. Confirm logs show fallback attempts across models.

Build warnings about bundle size or third-party `eval` are not overload fixes unless they fail the build.

# 📋 QUY TẮC PHÁT TRIỂN & TỐI ƯU GEMINI API & AGENT PLATFORM API

> **Phiên bản:** 4.2 — cập nhật 18/10/2026  
> **Mục đích:** Tài liệu chuẩn cho các app giáo dục và sinh giáo án chi tiết bằng Gemini API hoặc Agent Platform API, gồm chọn nhà cung cấp, chọn model thế hệ mới (`gemini-3.8-flash`), tối ưu `thinkingLevel` giảm quá tải `503`, di trú `localStorage`, quy trình tạo nội dung và fallback tự động.  
> **Nguồn kiểm tra:** tài liệu chính thức Google AI Models, Latest models, Deprecations, Pricing và Troubleshooting (10/2026).

---

## I. MODEL HIỆN HÀNH VÀ CÁCH DÙNG

### Chuỗi model ổn định cho production

| Ưu tiên | Model | Trạng thái | Context | Output tối đa | Vai trò trong app |
|---|---|---|---:|---:|---|
| 1 | `gemini-3.8-flash` | New Stable/GA (09/2026) | 1,048,576 | 65,536 | **Mặc định**; model flagship mới nhất, tốc độ cao, ưu đãi giá và tải (capacity) tốt nhất |
| 2 | `gemini-3.7-flash` | Stable/GA (08/2026) | 1,048,576 | 65,536 | Dự phòng chất lượng cao thế hệ liền kề |
| 3 | `gemini-3.5-flash-lite` | Stable/GA (21/07/2026) | 1,048,576 | 65,536 | Dự phòng tốc độ rất cao, dung lượng chịu tải (capacity) cực lớn, đọc/trích xuất tài liệu tốt |
| 4 | `gemini-3.6-flash` | Stable/GA (21/07/2026) | 1,048,576 | 65,536 | Dự phòng thế hệ 3.6 (chuyển xuống vị trí 4 để tránh nghẽn tải khi được gọi mặc định) |
| 5 | `gemini-3.5-flash` | Stable/GA | 1,048,576 | 65,536 | Dự phòng ổn định thế hệ 3.5 |
| 6 | `gemini-3.1-flash-lite` | Stable; dự kiến ngừng sớm nhất 07/05/2027 | 1,048,576 | 65,536 | Tương thích ngược |
| 7 | `gemini-2.5-flash` | Stable | 1,048,576 | 65,536 | Dự phòng cuối chuỗi |

### Kết luận lựa chọn model

- **Mặc định bắt buộc dùng `gemini-3.8-flash`**: Đây là bản phát hành ổn định mới nhất (09/2026) được Google khuyến nghị chuyển đổi để có hạ tầng chịu tải tốt nhất và giá ưu đãi đến hết 31/12/2026.
- **Đặt `gemini-3.7-flash` ở vị trí số 2 và `gemini-3.5-flash-lite` ở vị trí số 3**: Theo khuyến nghị chính thức của Google cho các đợt cao điểm lưu lượng, `gemini-3.8-flash` kết hợp với `gemini-3.5-flash-lite` mang lại thông lượng (throughput) và khả năng chống lỗi `503 Model Overloaded` cao nhất.
- **Hạ `gemini-3.6-flash` xuống vị trí số 4**: Tránh để các trình duyệt cũ hoặc mặc định dồn toàn bộ lưu lượng vào `gemini-3.6-flash` gây ra thông báo fallback liên tục.
- Không đặt `gemini-3.1-pro-preview` vào fallback production mặc định vì là Preview, có thể có giới hạn rate/billing khác và không có free tier API.
- Không dùng alias `gemini-flash-latest` trong production nếu cần hành vi ổn định; alias có thể được chuyển sang phiên bản mới bất kỳ lúc nào.

### Model cũ/preview cần tránh trong các app

| Model | Lý do | Thay bằng |
|---|---|---|
| `gemini-3-pro-preview` | Đã shutdown 09/03/2026 | `gemini-3.1-pro-preview` khi thực sự cần Pro |
| `gemini-3.1-flash-lite-preview` | Đã shutdown 25/05/2026 | `gemini-3.5-flash-lite` |
| `gemini-2.0-flash`, `gemini-2.0-flash-lite` | Đã shutdown 01/06/2026 | `gemini-3.8-flash` hoặc `gemini-3.5-flash-lite` |
| `gemini-3-flash-preview` | Preview, đã có bản thay thế GA | `gemini-3.8-flash` |

### Giá paid tier tham khảo (10/2026)

| Model | Input / 1M token | Output / 1M token | Ghi chú |
|---|---:|---:|---|
| `gemini-3.8-flash` | $0.75 (ưu đãi) / $1.50 | $3.75 (ưu đãi) / $7.50 | Giá ưu đãi ra mắt áp dụng đến hết 31/12/2026 |
| `gemini-3.7-flash` | $1.50 | $7.50 | |
| `gemini-3.6-flash` | $1.50 | $7.50 | |
| `gemini-3.5-flash` | $1.50 | $9.00 | |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 | Rẻ nhất và chịu tải cao cho tác vụ trích xuất/phụ trợ |

Giá có thể thay đổi; luôn kiểm tra trang Pricing trước release lớn.

### Danh mục các model Gemini mới nhất (Trả phí & Miễn phí)

Dưới đây là danh sách cập nhật các model khả dụng nếu dùng **Gemini API Key trả phí (Google AI Studio Paid)** hoặc được cấp quyền truy cập các phiên bản mới.

**1. Dòng Gemini 3.x (Thế hệ mới nhất, Agentic & Hiệu suất Token cao)**
Các model 3.x mang lại khả năng lập kế hoạch (agentic), viết code và hiệu quả token vượt trội.
| Model | Model ID | Ghi chú |
|---|---|---|
| ⭐⭐ Gemini 3.8 Flash | `gemini-3.8-flash` | **Khuyên dùng mặc định cho mọi app mới** (GA 09/2026) |
| ⭐ Gemini 3.7 Flash | `gemini-3.7-flash` | Bản ổn định tốc độ cao (GA 08/2026) |
| ⭐ Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite` | Tốc độ cực nhanh, giá rẻ, chịu tải cao (GA 07/2026) |
| ⭐ Gemini 3.6 Flash | `gemini-3.6-flash` | Bản ổn định thế hệ 3.6 (GA 07/2026) |
| ⭐ Gemini 3.5 Flash | `gemini-3.5-flash` | Bản ổn định thế hệ 3.5 |
| Gemini 3.1 Pro | `gemini-3.1-pro-preview` | Suy luận phức tạp (Preview) |
| Gemini 3.1 Flash Lite | `gemini-3.1-flash-lite` | Tương thích ngược |

**2. Dòng Gemini 2.5 (Ổn định, tương thích Agent Platform)**
| Model | Model ID | Nên dùng khi |
|---|---|---|
| ⭐ Gemini 2.5 Pro | `gemini-2.5-pro` | Suy luận mạnh trên Agent Platform, xử lý tài liệu dài |
| ⭐ Gemini 2.5 Flash | `gemini-2.5-flash` | Mặc định cho Agent Platform API, tốc độ nhanh, giá rẻ |
| ⭐ Gemini 2.5 Flash Lite | `gemini-2.5-flash-lite` | Chatbot số lượng lớn, automation, chi phí thấp |
| Gemini 2.5 Flash Live | `gemini-2.5-flash-live-preview` | Voice realtime |
| Gemini 2.5 Flash TTS | `gemini-2.5-flash-tts-preview` | Text to Speech |
| Gemini 2.5 Pro TTS | `gemini-2.5-pro-tts-preview` | Giọng đọc chất lượng cao |

**3. Model Tạo Ảnh, Video & Âm Thanh Thế Hệ Mới**
| Loại | Model | Model ID |
|---|---|---|
| Tạo ảnh | ⭐ Nano Banana 2 | `nano-banana` (`gemini-3.1-flash-image-preview`) |
| Tạo ảnh | Nano Banana Pro | `nano-banana-pro` (`gemini-3-pro-image-preview`) |
| Video | Veo 3.1 | `veo-3.1-generate-preview` |
| Video | Veo 3.1 Fast | `veo-3.1-fast-generate-preview` |
| Video | Veo 3.1 Lite | `veo-3.1-lite-generate-preview` |
| Âm thanh | ⭐ Gemini 3.8 Live | `gemini-3.8-live-preview` |
| Âm thanh | ⭐ Gemini 3.8 Flash TTS | `gemini-3.8-flash-tts-preview` |
| Âm thanh | Gemini 3.8 Flash-Lite TTS | `gemini-3.8-flash-lite-tts-preview` |
| Âm thanh | Gemini 3.5 Live Translate | `gemini-3.5-live-translate-preview` |

### Gợi ý chọn Model cho các App Giáo Viên (giaovienai.vercel.app)

Để tối ưu hóa chi phí, tốc độ và tránh lỗi quá tải khi xây dựng hoặc nâng cấp các ứng dụng giáo dục:

| Chức năng / Ứng dụng | Model khuyên dùng | Lý do |
|---|---|---|
| Viết giáo án, KHBD, NLS, Tạo phiếu học tập | `gemini-3.8-flash` (mặc định) | Đa bước mạnh mẽ, bám sát cấu trúc sư phạm, nhanh và ít bị quá tải 503. |
| Phân tích giáo án, Lập bản đồ nội dung, Dịch thuật | `gemini-3.8-flash` (`thinkingLevel: LOW`) hoặc `gemini-3.5-flash-lite` | Giảm thời gian chờ bước trung gian, không chiếm dụng ngân sách suy luận của bước chính. |
| Viết code HTML/JS, App Mô phỏng, Toán học/TikZ | `gemini-3.8-flash` hoặc `gemini-3.7-flash` | Mạnh mẽ trong logic lập trình, lập luận đa bước khi sinh mã. |
| Chat AI thông thường, Hỏi đáp nhanh, Trích xuất JSON | `gemini-3.5-flash-lite` hoặc `gemini-3.8-flash` | Tốc độ phản hồi tức thì, tiết kiệm chi phí và dung lượng chịu tải rất cao. |
| App chạy qua Agent Platform API | `gemini-2.5-flash` hoặc `gemini-2.5-pro` | Tương thích hoàn toàn với endpoint `aiplatform.googleapis.com`. |
| Tạo ảnh minh họa bài học | `nano-banana` | Tạo và chỉnh sửa ảnh trực tiếp, phù hợp làm tài nguyên học liệu. |
| Tạo video bài giảng, minh họa | `veo-3.1-generate-preview` | Sinh video chất lượng cao từ text prompt. |

*Mẹo: Để kiểm tra chính xác API Key của bạn đang được phép sử dụng những model nào, hãy chạy đoạn code Python sau:*
```python
from google import genai
client = genai.Client(api_key="YOUR_API_KEY")
for model in client.models.list():
    print(model.name)
```

---

## II. CƠ CHẾ FALLBACK TỰ ĐỘNG & XỬ LÝ QUÁ TẢI MƯỢT MÀ

### Thứ tự thực tế

```txt
[Model người dùng chọn]
→ gemini-3.8-flash
→ gemini-3.7-flash
→ gemini-3.5-flash-lite
→ gemini-3.6-flash
→ gemini-3.5-flash
→ gemini-3.1-flash-lite
→ gemini-2.5-flash
```

Danh sách được loại trùng. Model người dùng chọn luôn được thử trước, kể cả khi không nằm trong chuỗi mặc định.

### Lỗi được phép chuyển model (Fallback-Eligible)

- `500 INTERNAL`
- `502 BAD GATEWAY`
- `503 UNAVAILABLE`
- `504 DEADLINE_EXCEEDED`
- Lỗi mạng/kết nối tạm thời: `fetch failed`, `failed to fetch`, `networkerror`, `econnreset`, `etimedout`, `bad gateway`
- Text chứa `overloaded`, `high demand`, `try again later`, `temporarily unavailable`, `deadline exceeded`
- `404 NOT_FOUND` khi model/endpoint không còn khả dụng

### Lỗi phải dừng ngay, không chuyển model

- `401`, `API_KEY_INVALID`: key sai/hết hạn (đánh dấu key `invalid`).
- `403`, `PERMISSION_DENIED`: key không có quyền (nếu dùng Gemini API; riêng Agent Platform API cho phép thử model tương thích tiếp theo trước khi dừng).
- `429`, `RESOURCE_EXHAUSTED`: quota/rate limit; chỉ xoay sang API key tiếp theo (cooldown key hiện tại), **tuyệt đối không** đánh dấu key là invalid.
- `400`, `INVALID_ARGUMENT`: payload hoặc tham số model sai (ví dụ truyền `thinkingLevel: "minimal"` vào `gemini-3.8-flash`).
- Lỗi không xác định: dừng để không phát sinh nhiều request ngoài ý muốn.

### Yêu cầu triển khai bắt buộc cho mọi App

1. **Tập trung hóa lệnh gọi**: Mọi `generateContent` đều phải đi qua một hàm wrapper `generateContentWithModelFallback` duy nhất, gồm cả phân tích mẫu, trích lịch, gợi ý phương pháp, lập bản đồ nội dung, viết và sửa giáo án.
2. **Thông báo nhẹ nhàng & tự ẩn khi hoàn tất**:
   - Khi đang trong quá trình xử lý mà gặp quá tải ở bước phụ hoặc bước chính, hiển thị thông báo ngắn gọn: *"Đang tự động chuyển từ `model_cũ` sang `model_mới` (do `model_cũ` đang bận)..."*.
   - **BẮT BUỘC**: Ngay khi tác vụ hoàn thành thành công (`setResult(...)`), phải gọi `setFallbackNotice(null)` để **xóa cảnh báo màu vàng** trên màn hình, tránh làm người dùng hiểu lầm rằng app đang bị lỗi sau khi đã nhận được kết quả hoàn chỉnh.
3. Không hiển thị lỗi `503` thành “API key không hợp lệ”.
4. Không log full API key.

```ts
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export const FALLBACK_GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
] as const;

for (const model of getOrderedModels(selectedModel)) {
  try {
    return await callGemini(model, request);
  } catch (error) {
    const parsed = parseGeminiApiError(error);
    if (!isFallbackEligibleError(parsed)) throw error;
  }
}
```

---

## III. QUY TRÌNH THÊM AGENT PLATFORM API CHO APP MỚI

### Nguyên tắc bắt buộc

- Trong cửa sổ **Cài đặt API Key**, luôn có hai lựa chọn rõ ràng: **Gemini API** và **Agent Platform API**.
- Người dùng phải tự chọn dịch vụ. **Không tự động suy đoán nhà cung cấp từ tiền tố API key**.
- Key bắt đầu bằng `AQ...` có thể được người dùng dùng cho Gemini API hoặc Agent Platform API; định dạng key không quyết định endpoint.
- Lưu key riêng theo từng dịch vụ để chuyển đổi qua lại không làm ghi đè key:
  - Gemini API: `gemini_api_key`
  - Agent Platform API: `agent_platform_api_key`
- Lưu nhà cung cấp bằng `google_ai_provider` với giá trị `gemini` hoặc `agent-platform`.
- Chỉ coi lựa chọn là hợp lệ khi người dùng đã chọn thủ công; có thể lưu thêm `google_ai_provider_selection_source=manual`.
- Nếu app cũ từng lưu `vertex`, phải chuyển về Gemini mặc định và yêu cầu người dùng xác nhận lại, không tự động đổi thành Agent Platform API.

### Kiểu dữ liệu và client factory dùng chung

```ts
import { GoogleGenAI } from '@google/genai';

export type AiProvider = 'gemini' | 'agent-platform';

export const createGoogleAiClient = (
  apiKey: string,
  provider: AiProvider,
): GoogleGenAI => {
  if (provider === 'agent-platform') {
    // Cờ kỹ thuật của Google Gen AI SDK để định tuyến tới
    // aiplatform.googleapis.com trong chế độ API key.
    return new GoogleGenAI({ vertexai: true, apiKey });
  }

  return new GoogleGenAI({ apiKey });
};
```

`vertexai: true` chỉ là cờ định tuyến bắt buộc của Google Gen AI SDK cho Agent Platform API. Không dùng cờ này để suy đoán loại key và không hiển thị tên “Vertex AI Express” trên giao diện.

### Model Agent Platform API

Danh sách khởi đầu an toàn cho các app giáo dục:

```ts
export const AGENT_PLATFORM_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-3.1-pro-preview',
] as const;

export const AGENT_PLATFORM_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;
```

- Model mặc định của Agent Platform API: `gemini-2.5-flash`.
- Khi chuyển từ Gemini API sang Agent Platform API, nếu model đang chọn không tương thích thì tự đưa về `gemini-2.5-flash`.
- Chỉ hiển thị model Agent Platform hỗ trợ trong giao diện của dịch vụ này.
- Danh sách model có thể thay đổi; phải kiểm tra tài liệu Agent Platform chính thức trước mỗi đợt release lớn.

### Bắt buộc định tuyến toàn bộ tác vụ qua client chung

Mọi lệnh gọi AI phải đi qua `createGoogleAiClient()` và hàm fallback chung, gồm:

- chat và sinh nội dung streaming;
- lập dàn ý, viết từng phần và tạo phụ lục;
- phân tích đề tài, tài liệu tham khảo và mẫu DOCX/PDF;
- thẩm định tài liệu cũ;
- gợi ý tên đề tài, phương pháp và hoạt động;
- các yêu cầu JSON có `responseMimeType: "application/json"`;
- biên tập hoặc rút gọn nội dung trong DOCX.

Không được tạo `new GoogleGenAI(...)` trực tiếp tại từng component hoặc từng tính năng. Chỉ client factory được phép khởi tạo SDK.

Với Agent Platform API, không bật `googleSearch` mặc định cho đến khi endpoint/model đã được xác nhận hỗ trợ. Các tác vụ văn bản, JSON và streaming vẫn chạy bình thường mà không cần công cụ này.

### Quy trình giao diện cài đặt

1. Hiển thị hai thẻ lựa chọn **Gemini API** và **Agent Platform API**.
2. Khi đổi thẻ, tải đúng key đã lưu của dịch vụ đó; không sao chép key giữa hai vùng lưu trữ.
3. Lọc lại danh sách model theo dịch vụ đang chọn.
4. Chấp nhận cả `AIzaSy...` và `AQ...` bằng một helper xác thực dùng chung.
5. Khi bấm **Lưu cấu hình**, lưu key, provider, dấu xác nhận thủ công và model đã được chuẩn hóa.
6. Khởi tạo lại phiên AI ngay sau khi lưu để mọi tác vụ tiếp theo dùng đúng endpoint.
7. Sau khi tải lại trang, phải giữ nguyên dịch vụ người dùng đã chọn.
8. Key từ `VITE_GEMINI_API_KEYS` chỉ dùng cho Gemini API. Nếu cần key Agent Platform mặc định, phải tạo biến môi trường riêng và đặt tên rõ ràng.

### Fallback và thông báo lỗi Agent Platform

- Có thể fallback model khi gặp `500`, `502`, `503`, `504`, `NOT_FOUND` hoặc model quá tải.
- Với Agent Platform API, có thể thử model tương thích tiếp theo khi gặp `403 PERMISSION_DENIED`, sau đó mới hiển thị lỗi quyền.
- Không báo `403` là “key sai”. Thông báo nên nêu rõ Google đã nhận key nhưng dự án/key chưa được cấp quyền gọi Agent Platform API hoặc model đó.
- Gợi ý người dùng kiểm tra: Agent Platform API đã bật, billing, API restrictions và quyền sử dụng model.
- Chỉ xoay vòng danh sách key Gemini khi provider là `gemini`. Agent Platform dùng vùng key riêng, không được lấy nhầm key từ bộ xoay Gemini.

### Kiểm thử bắt buộc trước khi bàn giao

- Chọn Gemini API, nhập key `AQ...`, lưu và tải lại: provider vẫn phải là Gemini.
- Chọn Agent Platform API, nhập key `AQ...`, lưu và tải lại: provider vẫn phải là Agent Platform.
- Key `AIzaSy...` và `AQ...` đều vượt qua kiểm tra định dạng.
- Không còn chữ “Vertex AI Express” trên giao diện.
- Không còn call site `new GoogleGenAI(...)` bên ngoài client factory.
- Chạy `npx tsc --noEmit` và `npm run build`.
- Mở app thật, kiểm tra console không có lỗi JavaScript.
- Nếu chưa có key thật, phải ghi rõ mới kiểm thử luồng giao diện và chưa xác nhận request live.

---

## IV. CẤU HÌNH API, THINKING LEVEL VÀ CHỐNG NGHẼN QUY TRÌNH ĐA BƯỚC

### 1. Quy tắc `thinkingConfig.thinkingLevel` trên dòng Gemini 3.x

- SDK: `@google/genai`.
- **Mặc định dùng `ThinkingLevel.MEDIUM`** cho các bước sinh nội dung chính (`generation`). Không dùng `ThinkingLevel.HIGH` làm mặc định cho mọi request vì `HIGH` tiêu tốn nhiều token suy luận ngầm, làm tăng mạnh độ trễ (latency) và dễ bị máy chủ ngắt giữa chừng (`503` / `504`) khi tạo tài liệu dài.
- **Dùng `ThinkingLevel.LOW`** cho các bước phụ trợ như: lập bản đồ nội dung (`planning`), dịch song ngữ theo lô (`bilingual translation`), trích xuất JSON, hoặc gợi ý nhanh.
- **CẢNH BÁO QUAN TRỌNG**: `gemini-3.8-flash` và `gemini-3.7-flash` chỉ hỗ trợ 3 mức `low`, `medium`, `high` (**không hỗ trợ `minimal`**; nếu gửi `minimal` sẽ bị lỗi `400 INVALID_ARGUMENT`).
- **Không gửi `temperature`, `topP`, `topK`** cho mọi model `gemini-3*` (`gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`...); các tham số sampling này đã deprecated trên Gemini 3.x.
- Không dùng prefilled model turn ở cuối hội thoại.
- Trích JSON: dùng `responseMimeType: "application/json"`.
- Planning: `maxOutputTokens: 8192` với `thinkingLevel: ThinkingLevel.LOW`.
- Giáo án hoàn chỉnh: `maxOutputTokens: 32768` với `thinkingLevel: ThinkingLevel.MEDIUM`.

```ts
const createGeminiConfig = ({
  provider,
  model,
  systemInstruction,
  responseMimeType,
  maxOutputTokens,
  thinkingLevel = ThinkingLevel.MEDIUM,
}) => {
  const isGemini3 = model.startsWith('gemini-3');
  return {
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    // Chỉ truyền temperature cho dòng 2.5 trở xuống
    ...(!isGemini3 ? { temperature: 0.3 } : {}),
    ...(provider === 'gemini' && isGemini3
      ? { thinkingConfig: { thinkingLevel } }
      : {}),
  };
};
```

### 2. Bọc an toàn (Non-blocking) cho các bước phụ trợ (Planning / Pre-analysis)

Trong các app có quy trình 2 bước (Bước 1: Lập dàn ý/bản đồ nội dung → Bước 2: Viết nội dung chi tiết), nếu Bước 1 gọi API bắt buộc thành công mới chạy Bước 2 thì xác suất gặp quá tải tăng gấp đôi.

**Quy tắc bắt buộc**: Luôn bọc bước `planning` trong khối `try...catch` không chặn (non-blocking). Nếu bước `planning` gặp lỗi quá tải hoặc thất bại, app chỉ ghi `console.warn` và chuyển thẳng sang bước `generation` chính (sử dụng trực tiếp nội dung đầu vào của người dùng).

```ts
let contentMap = '';
try {
  const planResponse = await runWithFallback('planning', (activeModel) =>
    ai.models.generateContent({
      model: activeModel,
      contents: planningPrompt,
      config: createGeminiConfig({
        provider,
        model: activeModel,
        maxOutputTokens: 8192,
        thinkingLevel: ThinkingLevel.LOW,
      }),
    }),
  );
  contentMap = planResponse.text?.trim() || '';
} catch (planErr) {
  console.warn('[Gemini] Bước lập bản đồ nội dung tạm bỏ qua để ưu tiên bước chính:', planErr);
  contentMap = '';
}
```

---

## V. QUẢN LÝ API KEY & DI TRÚ MODEL TRONG LOCALSTORAGE

### 1. Tự động di trú (Migration) Model mặc định trong `localStorage`

Khi nâng cấp một app đang chạy từ model cũ (`gemini-3.6-flash` hoặc `gemini-2.5-flash`) lên `gemini-3.8-flash`, nếu giữ nguyên tên khóa `localStorage` cũ (ví dụ `GEMINI_MODEL_ID`), trình duyệt của người dùng cũ sẽ tiếp tục đọc giá trị `gemini-3.6-flash` đã lưu từ trước và không bao giờ nhận được model mới.

**Quy tắc bắt buộc khi nâng cấp model mặc định**:
- Đổi khóa lưu trữ sang tên có hậu tố phiên bản, ví dụ `GEMINI_MODEL_STORAGE_KEY = "gemini_model_id_v38"`.
- Xóa khóa cũ `LEGACY_GEMINI_MODEL_STORAGE_KEY = "GEMINI_MODEL_ID"` khi khởi tạo để trình duyệt tự động chuyển sang `gemini-3.8-flash`.

```ts
export const GEMINI_MODEL_STORAGE_KEY = 'gemini_model_id_v38';
export const LEGACY_GEMINI_MODEL_STORAGE_KEY = 'GEMINI_MODEL_ID';

// Trong hàm khởi tạo state của App.tsx:
localStorage.removeItem(LEGACY_GEMINI_MODEL_STORAGE_KEY);
const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
```

### 2. Lưu trữ và xác thực API Key

- Lưu Gemini API bằng `gemini_api_key`; lưu Agent Platform API bằng `agent_platform_api_key`.
- Lưu provider riêng bằng `google_ai_provider`; không suy đoán provider từ tiền tố key.
- Chỉ gửi key tới Google API; không đưa vào log, prompt hoặc file xuất.
- Chấp nhận cả key cũ `AIzaSy...` và auth key mới `AQ...`.
- Link Gemini API key: https://aistudio.google.com/apikey
- Link Agent Platform API key: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys

```ts
const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIzaSy|AQ)\S{8,}$/;
```

| Trường hợp | Thông báo |
|---|---|
| Chưa nhập key | `Vui lòng cấu hình API Key trước khi sử dụng tính năng này.` |
| Key sai/hết hạn | `API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại trong Cài đặt.` |
| Không có quyền | `API key không có quyền truy cập Gemini API.` |
| Quota/rate limit | `Đã hết quota hoặc vượt giới hạn tốc độ API. Vui lòng đợi rồi thử lại.` |
| Model quá tải | `Đang tự động chuyển từ [model_cũ] sang [model_mới] (do [model_cũ] đang bận)...` |

---

## VI. CHECKLIST RELEASE KHI ÁP DỤNG CHO APP KHÁC

- [ ] Model mặc định là `gemini-3.8-flash`.
- [ ] Chuỗi fallback theo đúng thứ tự: `gemini-3.8-flash` → `gemini-3.7-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3.5-flash` → `gemini-3.1-flash-lite` → `gemini-2.5-flash`.
- [ ] Đã đổi khóa `localStorage` sang `gemini_model_id_v38` và xóa khóa cũ `GEMINI_MODEL_ID` để trình duyệt người dùng cũ tự nâng cấp lên `gemini-3.8-flash`.
- [ ] Tất cả call site Gemini đi qua hàm fallback chung `generateContentWithModelFallback`.
- [ ] `ThinkingLevel.MEDIUM` là mặc định cho bước sinh chính; `ThinkingLevel.LOW` cho bước `planning`/phụ trợ; không truyền `minimal` vào `gemini-3.8-flash` hoặc `gemini-3.7-flash`.
- [ ] Không còn `temperature`, `topP`, `topK` trong request gửi tới các model `gemini-3*`.
- [ ] Bước `planning` (nếu có) được bọc `try...catch` non-blocking để không làm gãy quy trình khi máy chủ bận.
- [ ] Cảnh báo `fallbackNotice` tự động được xóa (`setFallbackNotice(null)`) ngay khi sinh kết quả hoàn tất.
- [ ] Lỗi `502`, `503`, `504` và lỗi mạng tạm thời (`fetch failed`) được tự động fallback chứ không báo thành lỗi API key.
- [ ] Lỗi `429` chỉ kích hoạt xoay key / cooldown chứ không làm key bị đánh dấu `invalid`.
- [ ] Validator key chấp nhận cả `AIzaSy...` và `AQ...`.
- [ ] Có lựa chọn thủ công giữa Gemini API và Agent Platform API; key hai bên lưu tách biệt.
- [ ] Không còn chữ “Vertex AI Express” trên giao diện.
- [ ] Chạy test và `npm run build` thành công.

---

## VII. THAM KHẢO CHÍNH THỨC

- Latest models: https://ai.google.dev/gemini-api/docs/latest-model
- Models: https://ai.google.dev/gemini-api/docs/models
- Deprecations: https://ai.google.dev/gemini-api/docs/deprecations
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Thinking: https://ai.google.dev/gemini-api/docs/generate-content/thinking
- Troubleshooting: https://ai.google.dev/gemini-api/docs/troubleshooting
- API key: https://ai.google.dev/gemini-api/docs/api-key
- Agent Platform Express mode overview: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview
- Agent Platform API quickstart: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/vertex-ai-express-mode-api-quickstart
- Agent Platform API key: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys
- Agent Platform REST API: https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest
