---
name: google-ai-api-key-validation
description: Update codebases that validate Google AI Studio, Gemini, or Generative Language API keys so both legacy keys starting with AIzaSy and new keys starting with AQ are accepted. Use when an app rejects Gemini/Google AI API keys, shows "Invalid API Key", hard-codes startsWith("AIza") or startsWith("AIzaSy"), or needs a reusable regex/helper for API key format validation across frontend, backend, env parsing, settings modals, or key rotation managers.
---

# Google AI API Key Validation

## Goal

Update API key validation without changing actual Google API calls. The app should stop rejecting user-entered Google AI/Gemini keys that start with `AQ`, while still accepting legacy keys that start with `AIzaSy`.

## Recommended Regex & Helper Pattern

```ts
export const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIza|AQ)\S{10,}$/;

export const normalizeGoogleAiApiKey = (key: string): string => {
  return (key || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^(?:(?:vite_)?(?:gemini_)?api[_-]?key|key)\s*[=:]\s*/i, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\s+/g, '');
};

export const isValidGoogleAiApiKey = (key: string): boolean => {
  return GOOGLE_AI_API_KEY_PATTERN.test(normalizeGoogleAiApiKey(key));
};
```

## Guardrails

- Do not log full API keys. If display is needed, mask keys with prefix plus last four characters (`AIzaSy...xxxx` or `AQ...xxxx`).
- Do not hardcode raw API keys in client-side source files or commit `.env.local` to Git.
- Do not treat a real 401/403/503 response from Google as a format-validation issue.

---
name: gemini-model-overload-fallback
description: Update codebases that call Google AI Studio, Gemini, or Generative Language APIs so transient model overload (503) and quota/rate-limit (429) errors are handled gracefully with multi-key rotation and multi-model fallback across active Free Tier Gemini models.
---

# 📋 QUY TẮC PHÁT TRIỂN & TỐI ƯU GEMINI API & AGENT PLATFORM API

> **Phiên bản:** 5.0 — cập nhật **24/11/2026**
> **Mục đích:** Tài liệu chuẩn cho các app giáo dục và sinh SKKN/giáo án chi tiết bằng **Gemini API** hoặc **Agent Platform API**, cập nhật đầy đủ thế hệ **Gemini 4 (`gemini-4-hydrogen` miễn phí)**, loại bỏ các model đã khai bỏ/deprecated/auto-route, chuẩn hóa `thinkingLevel`, di trú `localStorage`, xoay vòng nhiều API key + fallback 2 tầng chống hết quota `429` và bảo mật key ngầm phía server.
> **Nguồn kiểm tra trực tiếp (24/11/2026):**
> - https://ai.google.dev/gemini-api/docs/models
> - https://ai.google.dev/gemini-api/docs/latest-model
> - https://ai.google.dev/gemini-api/docs/choosing-a-model
> - https://ai.google.dev/gemini-api/docs/deprecations
> - https://ai.google.dev/gemini-api/docs/pricing
> - https://ai.google.dev/gemini-api/docs/thinking
> - https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview

---

## I. MODEL HIỆN HÀNH VÀ CÁCH DÙNG (CẬP NHẬT 24/11/2026)

### 1. Chuỗi model **MIỄN PHÍ (Free Tier)** ổn định cho production (Gemini API)

Tất cả model dưới đây đều được Google xác nhận **hỗ trợ Free Tier (`Free of charge`)** và **không bị auto-route trùng nhau** trên cùng chuỗi fallback:

| Ưu tiên | Model ID | Tên hiển thị | Trạng thái (11/2026) | Free Tier | Context / Max Output | Thinking Levels | Vai trò trong app |
|---|---|---|---|---|---|---|---|
| **1** | **`gemini-4-hydrogen`** | **Gemini 4 Hydrogen** | **New Stable / GA (12/11/2026)** | ✅ **Miễn phí** | 1M (unified) / 64K (1M long decode) | `low`, `medium`, `high` (default), `xhigh` | **Mặc định khuyên dùng mới** của Google; giảm >5x ảo giác/bịa đặt so với 3.8 Flash, viết SKKN & đa bước xuất sắc |
| **2** | **`gemini-3.8-flash`** | **Gemini 3.8 Flash** | Stable / GA (02/09/2026) | ✅ **Miễn phí** | 1M / 64K | `low`, `medium` (default), `high` | Dự phòng #2 chất lượng cao, rất ổn định cho văn bản dài |
| **3** | **`gemini-3.5-flash-lite`** | **Gemini 3.5 Flash-Lite** | Stable / GA (21/07/2026) | ✅ **Miễn phí** | 1M / 64K | `minimal` (default), `low`, `medium`, `high` | Nhanh nhất, chịu tải (throughput/capacity) cực lớn, quota rộng, rất tốt khi cao điểm |
| **4** | **`gemini-3.6-flash`** | **Gemini 3.6 Flash** | Stable / GA (21/07/2026) | ✅ **Miễn phí** | 1M / 64K | `minimal`, `low`, `medium` (default), `high` | Dự phòng cân bằng đa bước, có hạn mức Free Tier riêng biệt |
| **5** | **`gemini-3.1-flash-lite`** | **Gemini 3.1 Flash-Lite** | Stable (shutdown sớm nhất 07/05/2027) | ✅ **Miễn phí** | 1M / 64K | `minimal` (default), `low`, `medium`, `high` | Dự phòng nhẹ, chi phí thấp, tách riêng hạn mức |
| **6** | **`gemini-3-flash-preview`** | **Gemini 3 Flash (Preview)** | Preview (chưa có lịch shutdown) | ✅ **Miễn phí** | 1M / 64K | `minimal`, `low`, `medium`, `high` (default) | Dự phòng cuối cùng dòng 3 có Free Tier |

> **Lưu ý về `gemini-2.5-flash-lite`:** Model này chưa deprecated và vẫn có Free Tier, **nhưng Google đang giới hạn chỉ cho tài khoản đã từng dùng dòng 2.5 trước đây**. Key tạo mới trên dự án mới sẽ không gọi được, vì vậy **không đặt vào chuỗi fallback mặc định của Gemini API** (chỉ giữ cho Agent Platform hoặc tài khoản cũ).

```ts
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';

export const FALLBACK_MODELS: string[] = [
  'gemini-4-hydrogen',      // New GA (11/2026): mặc định khuyên dùng, Free Tier
  'gemini-3.8-flash',       // Stable GA (09/2026): dự phòng chất lượng cao, Free Tier
  'gemini-3.5-flash-lite',  // Stable GA (07/2026): nhanh nhất, chịu tải cao, Free Tier
  'gemini-3.6-flash',       // Stable GA (07/2026): dự phòng cân bằng, Free Tier
  'gemini-3.1-flash-lite',  // Stable GA (05/2026): dự phòng nhẹ (đến >= 05/2027), Free Tier
  'gemini-3-flash-preview', // Preview: dự phòng cuối Free Tier
];
```

### 2. Model ĐÃ KHAI BỎ / DEPRECATED / AUTO-ROUTE — PHẢI XÓA KHỎI CHUỖI FALLBACK

| Model ID | Trạng thái hiện tại (24/11/2026) | Lý do phải xóa | Thay bằng |
|---|---|---|---|
| `gemini-3.7-flash` | **Deprecated / Auto-route** | Đã gỡ khỏi AI Studio; endpoint tự định tuyến về `gemini-3.8-flash` (gọi trùng quota) | `gemini-4-hydrogen` hoặc `gemini-3.8-flash` |
| `gemini-3.5-flash` | **Deprecated / Auto-route** | Đã gỡ khỏi AI Studio; endpoint tự định tuyến về `gemini-3.6-flash` (gọi trùng quota) | `gemini-4-hydrogen` hoặc `gemini-3.6-flash` |
| `gemini-2.5-flash` | **Deprecated (route từ 01/12/2026)** | Đã gỡ khỏi AI Studio, giới hạn user cũ; từ 01/12/2026 auto-route sang `gemini-3.5-flash-lite` | `gemini-4-hydrogen` hoặc `gemini-3.5-flash-lite` |
| `gemini-2.5-pro` | **Deprecated (route từ 01/12/2026)** | Đã gỡ khỏi AI Studio, giới hạn user cũ; từ 01/12/2026 auto-route sang `gemini-3.8-flash` | `gemini-4-hydrogen` (Free) hoặc `gemini-4-neon` / `gemini-4-carbon` (Paid) |
| `gemini-2.0-flash`, `gemini-2.0-flash-lite` | **Đã shutdown (01/06/2026)** | Ngừng hoạt động hoàn toàn | `gemini-4-hydrogen` / `gemini-3.5-flash-lite` |
| `gemini-3-pro-preview` | **Đã shutdown (09/03/2026)** | Ngừng hoạt động hoàn toàn | `gemini-4-neon` / `gemini-4-carbon` / `gemini-3.1-pro-preview` |
| `gemini-3.1-flash-lite-preview` | **Đã shutdown (25/05/2026)** | Ngừng hoạt động hoàn toàn | `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite` |
| `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview` | **Đã shutdown (22/10/2026)** | Ngừng hoạt động trên Gemini Developer API | `gemini-omni-1.2-flash` |
| `gemini-omni-flash-preview` | **Đã shutdown (22/10/2026)** | Đã có bản GA thay thế | `gemini-omni-1.2-flash` |
| `gemini-omni-1.1-flash` | **Sắp auto-route (03/12/2026)** | Tự định tuyến sang `gemini-omni-1.2-flash` | `gemini-omni-1.2-flash` |
| `gemini-3.1-flash-image-preview`, `gemini-3-pro-image-preview` | **Đã shutdown (25/06/2026)** | Đã có bản GA thay thế | `gemini-nano-banana-2.1` / `gemini-3.1-flash-image` / `gemini-3-pro-image` |
| `imagen-4.0-*` | **Đã shutdown (17/08/2026)** | Đã ngừng hoạt động | `gemini-nano-banana-2.1` |
| `gemini-embedding-2-preview` | **Đã shutdown (06/11/2026)** | Auto-route sang bản GA | `gemini-embedding-2` |
| `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.1-flash-tts-preview` | **Sắp shutdown (18/12/2026)** | Đã có bản GA 3.8 TTS thay thế | `gemini-3.8-flash-tts` / `gemini-3.8-flash-lite-tts` |
| `deep-research-pro-preview-12-2025`, `antigravity-preview-05-2026` | **Đã shutdown (10/2026)** | Đã có phiên bản mới | `deep-research-preview-04-2026` / `antigravity-preview-09-2026` |

### 3. Danh mục mở rộng các model Gemini mới nhất (Paid Tier, Media & Chuyên biệt — tham khảo)

> ⚠️ **Cảnh báo:** Các model **Paid Tier Only** dưới đây **KHÔNG** đưa vào chuỗi fallback Free Tier mặc định (sẽ gây lỗi `429` / `limit: 0` trên key miễn phí).

**A. Dòng Gemini 4 — Suy luận Frontier (Paid Tier Only):**
| Model | Model ID | Free Tier | Giá Paid (Input / Output / 1M token) | Ghi chú |
|---|---|---|---|---|
| Gemini 4 Carbon | `gemini-4-carbon` | ❌ Paid only | $2.00 / $10.00 (đến 30/11/2026), sau đó $4.00 / $20.00 | Mạnh nhất cho suy luận sâu, kiểm chứng dài hạn (`low`/`medium`/`high`) |
| Gemini 4 Neon | `gemini-4-neon` | ❌ Paid only | $3.00 / $15.00 | Thông minh cấp frontier, hoàn thành nhanh hơn Carbon (`low`/`medium`/`high`/`xhigh`) |
| Gemini 4 Argon | `gemini-4-argon` | ❌ Paid only | $2.00 / $10.00 (đến 30/11/2026), sau đó $4.00 / $20.00 | Tối ưu tốc độ & tiết kiệm token hơn Carbon (`low`/`medium`/`high`) |
| Gemini 3.1 Pro Preview | `gemini-3.1-pro-preview` | ❌ Paid only | $2.00 / $12.00 (<=200K) | Preview thế hệ 3 Pro (Google khuyên nâng lên `gemini-4-neon` hoặc `gemini-4-carbon`) |

**B. Giá Paid Tier các model có hỗ trợ Free Tier (11/2026):**
| Model ID | Free Tier | Input / 1M token | Output / 1M token | Ghi chú |
|---|---|---|---|---|
| `gemini-4-hydrogen` | ✅ Miễn phí | $1.50 | $7.50 | Mặc định khuyên dùng (GA 12/11/2026), implicit caching miễn phí ở Free Tier |
| `gemini-3.8-flash` | ✅ Miễn phí | $0.75 (ưu đãi đến 31/12/2026) / $1.50 | $3.75 (ưu đãi) / $7.50 | Chất lượng cao, dự phòng #2 |
| `gemini-3.6-flash` | ✅ Miễn phí | $0.75 (ưu đãi đến 31/12/2026) / $1.50 | $3.75 (ưu đãi) / $7.50 | Dự phòng cân bằng |
| `gemini-3.5-flash-lite` | ✅ Miễn phí | $0.30 | $2.50 | Rẻ, nhanh nhất, chịu tải cực cao |
| `gemini-3.1-flash-lite` | ✅ Miễn phí | $0.25 | $1.50 | Nhẹ, shutdown sớm nhất 07/05/2027 |
| `gemini-3-flash-preview` | ✅ Miễn phí | $0.50 | $3.00 | Preview |

**C. Model Ảnh, Video, Âm Thanh & Chuyên biệt hiện hành (GA mới nhất):**
| Loại | Model | Model ID | Free Tier | Ghi chú |
|---|---|---|---|---|
| Tạo ảnh | ⭐ Nano Banana 2.1 | `gemini-nano-banana-2.1` | ❌ Paid only | Mới nhất (06/10/2026), chữ & nhất quán đa lượt tốt nhất |
| Tạo ảnh | Nano Banana 2 | `gemini-3.1-flash-image` | ❌ Paid only | GA, tốc độ cao |
| Tạo ảnh | Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | ❌ Paid only | GA, độ trễ thấp, giá rẻ nhất |
| Tạo ảnh | Nano Banana Pro | `gemini-3-pro-image` | ❌ Paid only | GA, thiết kế 4K chuyên nghiệp |
| Video | ⭐ Gemini Omni 1.2 Flash | `gemini-omni-1.2-flash` | ❌ Paid only | Mới nhất (05/11/2026), thay thế Veo 3.1; sinh/sửa video 15s kèm âm thanh |
| Thế giới 3D | Genie 4 | `genie-4` | ❌ Paid only | Mới (19/11/2026), stream 24fps qua Interactions API |
| Voice Live | ⭐ Gemini 3.8 Live | `gemini-3.8-live` | ✅ Miễn phí | GA (15/09/2026), đàm thoại thời gian thực (bỏ hậu tố `-preview`) |
| Voice Live | Gemini 3.8 Live Thinking | `gemini-3.8-live-extended-thinking` | ✅ Miễn phí | GA, voice có suy luận sâu |
| TTS | ⭐ Gemini 3.8 Flash TTS | `gemini-3.8-flash-tts` | ✅ Miễn phí | GA (22/09/2026), 130 ngôn ngữ (thay các bản TTS 2.5/3.1) |
| TTS | Gemini 3.8 Flash-Lite TTS | `gemini-3.8-flash-lite-tts` | ✅ Miễn phí | GA, chi phí thấp, 101 ngôn ngữ |
| Speech-to-Text | Gemini 3.5 Transcribe | `gemini-3.5-transcribe` / `gemini-3.5-transcribe-live` | ✅ Miễn phí | GA (08/2026) |
| Âm nhạc | Lyria 3.5 | `lyria-3.5` | Tùy gói | GA (03/09/2026) |
| Phân loại / Chấm điểm | ⭐ Gemini Decision 1 | `gemini-decision-1` | ✅ Miễn phí (10K RPD!) | Mới (11/11/2026), Decisions API, 0 output tokens |
| Embeddings | Gemini Embedding 2 | `gemini-embedding-2` | Tùy gói | GA (22/04/2026), đa phương thức |
| Managed Agents | Antigravity / Deep Research | `antigravity-preview-09-2026`, `deep-research-preview-04-2026` | Free + Paid | Interactions API |

### 4. Gợi ý chọn Model cho các App Giáo Viên

| Chức năng / Ứng dụng | Model khuyên dùng | Lý do |
|---|---|---|
| Viết SKKN, giáo án, KHBD, NLS, phiếu học tập | `gemini-4-hydrogen` (`thinkingLevel: MEDIUM`) | Mới nhất (GA 11/2026), miễn phí, giảm >5x bịa số liệu/nguồn, bám cấu trúc cực tốt |
| Phân tích mẫu Sở/Phòng, trích JSON, phân tích đề tài | `gemini-4-hydrogen` (`thinkingLevel: LOW`) hoặc `gemini-3.5-flash-lite` | Nhanh, ít tiêu tốn quota, tránh nghẽn bước phụ trợ |
| Khi giờ cao điểm / hết quota model chính | Tự xoay key → tự fallback `gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3.1-flash-lite` | Mỗi model có hạn mức RPM/RPD riêng, nhân nhiều lần hạn mức miễn phí |
| App chạy qua Agent Platform API | `gemini-3-flash-preview` hoặc `gemini-2.5-flash` | Tương thích trực tiếp endpoint Express Mode (`aiplatform.googleapis.com`) |

---

## II. CƠ CHẾ CHỐNG HẾT QUOTA (429) & FALLBACK QUÁ TẢI (503) ĐA TẦNG

### 1. Nguyên tắc vàng xử lý lỗi

| Loại lỗi | Mã / Dấu hiệu | Hành động bắt buộc |
|---|---|---|
| `MODEL_OVERLOADED` | `503`, `UNAVAILABLE`, `overloaded`, `high demand`, `try again later` | Chuyển **model dự phòng** tiếp theo; **KHÔNG** đánh dấu key lỗi hay cooldown |
| `TRANSIENT_SERVER_ERROR` / `NETWORK_ERROR` | `500`, `502`, `504`, `DEADLINE_EXCEEDED`, `fetch failed`, `networkerror` | Chuyển **model dự phòng** tiếp theo; **KHÔNG** đánh dấu key lỗi |
| `NOT_FOUND` | `404`, `NOT_FOUND`, `not supported for generateContent` | Bỏ qua model đó trong phiên hiện tại, chuyển model tiếp theo |
| `QUOTA_EXCEEDED` / `RATE_LIMIT` | `429`, `RESOURCE_EXHAUSTED`, `quota`, `rate limit`, `too many requests` | **KHÔNG** đánh dấu key `invalid`! Đưa cặp `(key, model)` vào cooldown thông minh (RPM: ~65s hoặc theo `retryDelay`; RPD: 15 phút) → **Tầng 1:** Xoay sang API key tiếp theo trên cùng model → **Tầng 2:** Nếu hết key trên model đó, tự chuyển sang **model Free Tier tiếp theo** (có hạn mức riêng!) → **Tầng 3:** Fallback sang **Server Proxy ngầm** (`/api/gemini`) nếu có → **Tầng 4:** Nếu chỉ là lỗi RPM ngắn (`<= 35s`), chờ ngắn có đếm ngược rồi thử lại |
| `INVALID_API_KEY` | `401`, `API_KEY_INVALID`, `API_KEY_EXPIRED` | Đánh dấu key `error` → tự động xoay sang key kế tiếp trong kho key |
| `PERMISSION_DENIED` | `403`, `PERMISSION_DENIED` | Gemini API: xoay sang key kế tiếp (nếu có) hoặc báo rõ lỗi quyền; Agent Platform: thử model tương thích tiếp theo |
| `INVALID_ARGUMENT` | `400`, `INVALID_ARGUMENT` | Nếu liên quan `thinkingConfig` → tự gửi lại không kèm `thinkingConfig`; các lỗi khác dừng ngay |

### 2. Chiến lược chống hết quota 2 tầng (Multi-Key × Multi-Model)

Vì Google áp dụng hạn mức RPM/RPD **riêng theo từng dự án (API key) VÀ riêng theo từng model**:
- 1 key miễn phí × 6 model Free Tier = **6 nguồn quota độc lập**.
- 5 key miễn phí (từ 5 Gmail/Project khác nhau) × 6 model Free Tier = **30 nguồn quota độc lập**!
- Thứ tự ưu tiên thử:
  1. Giữ chất lượng cao nhất: thử lần lượt tất cả **key sẵn sàng** trên **model đang chọn** (mặc định `gemini-4-hydrogen`).
  2. Chỉ khi tất cả key đã hết quota/tạm nghỉ trên model đó mới tự động hạ sang model Free Tier kế tiếp (`gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3.1-flash-lite` → `gemini-3-flash-preview`).
  3. Mọi điểm gọi AI trong app (**dàn ý, viết từng phần, tạo phụ lục, phân tích mẫu Sở/Phòng, phân tích đề tài, phân tích tài liệu tham khảo**) ĐỀU phải dùng chung cơ chế xoay key + chuyển model này.
  4. Xóa cảnh báo `fallbackNotice` (`setFallbackNotice(null)`) ngay khi tác vụ hoàn thành thành công.

---

## III. AGENT PLATFORM API (GOOGLE CLOUD EXPRESS MODE)

### Nguyên tắc bắt buộc

- Trong cửa sổ **Cài đặt API Key**, luôn có hai lựa chọn rõ ràng: **Gemini API** và **Agent Platform API**.
- Người dùng tự chọn dịch vụ; **không tự suy đoán dịch vụ từ tiền tố key (`AIza...` hay `AQ...`)**.
- Lưu key tách biệt tuyệt đối:
  - Gemini API: kho nhiều key `gemini_api_keys` (tương thích ngược `gemini_api_key`)
  - Agent Platform API: `agent_platform_api_key`
- Lưu dịch vụ tại `google_ai_provider` (`gemini` | `agent-platform`). Nếu gặp giá trị cũ `vertex`, tự đổi về `gemini`.
- Không hiển thị chữ "Vertex AI Express" trên giao diện.

### Danh sách Model Agent Platform Express Mode (cập nhật 11/2026)

Theo tài liệu chính thức Google Cloud Express Mode (`Available models and rate limits in express mode`):

```ts
export const AGENT_PLATFORM_MODELS = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-3.1-pro-preview',
] as const;

export const AGENT_PLATFORM_FALLBACK_MODELS = [
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;
```

### Client factory duy nhất

```ts
import { GoogleGenAI } from '@google/genai';

export type AiProvider = 'gemini' | 'agent-platform';

export const createGoogleAiClient = (
  apiKey: string,
  provider: AiProvider = 'gemini',
): GoogleGenAI => {
  if (provider === 'agent-platform') {
    return new GoogleGenAI({ vertexai: true, apiKey });
  }
  return new GoogleGenAI({ apiKey });
};
```

---

## IV. CẤU HÌNH API & `thinkingLevel` CHO GEMINI 4 VÀ GEMINI 3

### Quy tắc bắt buộc cho dòng `gemini-4*` và `gemini-3*`

1. Kiểm tra bằng regex **`/^gemini-[34]/`** (KHÔNG chỉ `startsWith('gemini-3')`, vì Gemini 4 cũng có cùng chuẩn API!).
2. **TUYỆT ĐỐI KHÔNG gửi `temperature`, `topP`, `topK`, `thinkingBudget`** cho cả **Gemini 4** và **Gemini 3** (đã deprecated; giá trị ngoài ngưỡng sẽ gây lỗi `400`).
3. **Quy tắc `thinkingConfig.thinkingLevel`**:
   - **`gemini-4-hydrogen` / `gemini-4-neon`**: hỗ trợ `low`, `medium`, `high` (mặc định của Google), `xhigh` — **KHÔNG hỗ trợ `minimal`**!
   - **`gemini-4-carbon` / `gemini-4-argon` / `gemini-3.8-flash`**: hỗ trợ `low`, `medium` (mặc định), `high` — **KHÔNG hỗ trợ `minimal`**!
   - **`gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`**: mặc định `minimal`; nên để mặc định (không cần truyền `thinkingLevel`) để đạt tốc độ cao nhất và tránh lỗi tương thích.
   - **Trong app sinh SKKN/giáo án**:
     - Tác vụ chính (viết dàn ý, viết nội dung từng phần, phụ lục): dùng **`ThinkingLevel.MEDIUM`** (`maxOutputTokens: 65536`) để cân bằng tốt nhất giữa độ sâu học thuật, tốc độ streaming và tiết kiệm quota (tránh `HIGH`/`XHIGH` mặc định dễ tốn nhiều thinking tokens và gây chậm/timeout).
     - Tác vụ phụ trợ (trích xuất cấu trúc mẫu, phân tích đề tài, phân tích tài liệu tham khảo): dùng **`ThinkingLevel.LOW`** (`maxOutputTokens <= 16384`).
4. **Không truyền `cached_content` (explicit caching)** cho Gemini 4 — Gemini 4 dùng **Implicit Caching tự động** (giảm 95% chi phí input lặp lại cho prompt >= 4,096 tokens, miễn phí trên Free Tier).

---

## V. DI TRÚ `localStorage` & BẢO MẬT API KEY NGẦM

### 1. Tự động di trú (Migration) Model mặc định trong `localStorage`

Khi nâng cấp mặc định từ `gemini-3.8-flash` (`gemini_model_id_v38`) lên **`gemini-4-hydrogen` (`gemini_model_id_v4`)**:
- Đổi khóa lưu trữ thành **`GEMINI_MODEL_STORAGE_KEY = 'gemini_model_id_v4'`**.
- Xóa toàn bộ khóa cũ (`gemini_model_id_v38`, `GEMINI_MODEL_ID`, `selected_model`) khi khởi tạo để trình duyệt cũ tự nhận `gemini-4-hydrogen`.

### 2. Bảo mật API Key ngầm (KHÔNG hardcode key vào client!)

- **Tuyệt đối KHÔNG viết cứng API key (`AIzaSy...`) vào mã nguồn `.ts`/`.tsx` hay đẩy `.env.local` lên GitHub** — Google sẽ quét và thu hồi key tự động chỉ sau vài phút, đồng thời bất kỳ ai mở DevTools đều lấy cắp được key.
- **Cách chuẩn cho Production trên Vercel (Ẩn tuyệt đối 100%):**
  - Tạo Edge/Serverless Proxy `/api/gemini.ts` đọc biến môi trường server-side **`GEMINI_API_KEYS`** (KHÔNG có tiền tố `VITE_`).
  - Cài đặt `GEMINI_API_KEYS=key1,key2,key3,...` trong **Vercel Dashboard → Settings → Environment Variables**.
  - Trình duyệt gọi `/api/gemini` khi người dùng chưa nhập key hoặc khi key người dùng đã hết quota — key thật không bao giờ gửi xuống trình duyệt.
- **Cách cho môi trường Local (chạy cá nhân trên máy):**
  - Đặt trong `.env.local` (đã thêm vào `.gitignore`) với `VITE_GEMINI_API_KEYS=key1,key2,...`.
  - `apiKeyManager` chỉ nạp các key env này vào RAM (đánh dấu `source: 'env'`, `isHidden: true`), **KHÔNG ghi chép vào `localStorage`** và **KHÔNG hiển thị nguyên văn ra màn hình**.

---

## VI. CHECKLIST RELEASE (v5.0 — 24/11/2026)

- [ ] Model mặc định là **`gemini-4-hydrogen`** (GA 12/11/2026, Free Tier).
- [ ] Chuỗi fallback Free Tier sạch, không còn model deprecated/auto-route: `gemini-4-hydrogen` → `gemini-3.8-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash` → `gemini-3.1-flash-lite` → `gemini-3-flash-preview`.
- [ ] Đã xóa `gemini-3.7-flash`, `gemini-3.5-flash`, `gemini-2.5-flash`, `gemini-2.5-pro` khỏi chuỗi fallback Gemini API.
- [ ] Đã nâng cấp `GEMINI_MODEL_STORAGE_KEY = 'gemini_model_id_v4'` và dọn các khóa model cũ.
- [ ] Nhận diện đúng cả Gemini 3 và Gemini 4 (`/^gemini-[34]/`) để không truyền `temperature`/`topP`/`topK`/`thinkingBudget`.
- [ ] Người dùng có thể dán **nhiều API key cùng lúc** trong Cài đặt, xem trạng thái từng key, test key và xoay vòng không giới hạn 3 lần.
- [ ] Mọi lệnh gọi AI (lập dàn ý, viết phần, tạo phụ lục, phân tích mẫu, phân tích tài liệu, phân tích đề tài) đều đi qua cơ chế xoay key + fallback model 2 tầng.
- [ ] Hỗ trợ server-side proxy `/api/gemini` (biến `GEMINI_API_KEYS` trên Vercel) cho kho key ngầm bảo mật tuyệt đối.
- [ ] Chạy `npx tsc --noEmit` và `npm run build` thành công.
