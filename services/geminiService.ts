
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import {
  SYSTEM_INSTRUCTION,
  MODEL_NAME,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_AGENT_PLATFORM_MODEL,
  GEMINI_MODEL_STORAGE_KEY,
  LEGACY_GEMINI_MODEL_STORAGE_KEYS,
  GEMINI_MODELS,
  AGENT_PLATFORM_MODELS,
  PROVIDER_FALLBACK_MODELS,
  GRADE_NO_ESSAY,
  getSubjectFootnotes,
  getSystemInstruction,
  AiProvider,
} from '../constants';
import { InputData, QuestionConfig, ExtractedQuestion, MatrixTemplate, ReferenceUsageMode, describeDungSaiLevels, MATRIX_FULL_COLUMNS_RULE, getDungSaiQuestionCount, getDungSaiLevelTotals } from '../types';
import { fetchTemplateHtml, buildMatrixPromptForCustomTemplate, buildSpecsPromptForCustomTemplate } from './matrixTemplates';
import { FIGURE_JSON_HTML_INSTRUCTIONS, renderFiguresInHtml } from './figureEngine';
import {
  computeCv7991Layout, buildCv7991MatrixPrompt, buildCv7991SpecsPrompt,
  buildCv7991MatrixThead, buildCv7991SpecsThead, cv7991MatrixColumnCount, cv7991SpecsColumnCount, applyCv7991Thead,
} from './cv7991Template';
import { extractQuestionsLocally } from './docxMathParser';
import {
  MatrixContract, QTYPES, TYPE_LABEL, fmtNum, parseMatrixContract, resolveContracts,
  buildContractPromptBlock, buildSpecsTheadFromContract, contractMatchesConfig,
} from './matrixContract';
import { validateExamHtml, hasBlockingIssues, ExamIssue, TRUNCATION_MARKER } from './examValidator';

// --- Dual AI Provider & Storage Keys ---
const GOOGLE_AI_PROVIDER_KEY = 'google_ai_provider';
const GOOGLE_AI_PROVIDER_SELECTION_SOURCE_KEY = 'google_ai_provider_selection_source';
const GEMINI_API_KEY_STORAGE_KEY = 'gemini_api_key';
const AGENT_PLATFORM_API_KEY_STORAGE_KEY = 'agent_platform_api_key';
const LEGACY_API_KEY_STORAGE_KEY = 'examcraft_api_key';
const LEGACY_USER_API_KEY_STORAGE_KEY = 'user_gemini_api_key';
const MODEL_STORAGE_KEY = GEMINI_MODEL_STORAGE_KEY;

const MODEL_ALIASES: Record<string, string> = {
  'gemini-3-flash-preview': 'gemini-3.8-flash',
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview': 'gemini-3.5-flash-lite',
  'gemini-2.0-flash': 'gemini-3.8-flash',
  'gemini-2.0-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-1.5-flash': 'gemini-2.5-flash',
};

export const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIzaSy|AQ)\S{8,}$/;

export type GeminiApiErrorType =
  | 'INVALID_API_KEY'
  | 'PERMISSION_DENIED'
  | 'QUOTA_EXCEEDED'
  | 'MODEL_OVERLOADED'
  | 'TRANSIENT_SERVER_ERROR'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN';

// --- Tự động di trú (Migration) Model mặc định & Provider trong localStorage ---
const runStorageMigrationOnce = (() => {
  let migrated = false;
  return () => {
    if (migrated || typeof window === 'undefined' || typeof localStorage === 'undefined') return;
    migrated = true;
    try {
      for (const legacyKey of LEGACY_GEMINI_MODEL_STORAGE_KEYS) {
        localStorage.removeItem(legacyKey);
      }
      const rawProvider = localStorage.getItem(GOOGLE_AI_PROVIDER_KEY);
      if (rawProvider === 'vertex') {
        localStorage.setItem(GOOGLE_AI_PROVIDER_KEY, 'gemini');
        localStorage.removeItem(GOOGLE_AI_PROVIDER_SELECTION_SOURCE_KEY);
      }
    } catch {
      // Ignore storage access errors in private/restricted mode
    }
  };
})();

runStorageMigrationOnce();

// --- Fallback Notice Pub/Sub (Thông báo nhẹ nhàng khi tự động chuyển model & tự ẩn khi hoàn tất) ---
type FallbackNoticeListener = (notice: string | null) => void;
const fallbackNoticeListeners = new Set<FallbackNoticeListener>();
let currentFallbackNotice: string | null = null;

export const setFallbackNotice = (notice: string | null): void => {
  currentFallbackNotice = notice;
  fallbackNoticeListeners.forEach(listener => {
    try {
      listener(notice);
    } catch {
      // ignore listener errors
    }
  });
};

export const getFallbackNotice = (): string | null => currentFallbackNotice;

export const subscribeFallbackNotice = (listener: FallbackNoticeListener): (() => void) => {
  fallbackNoticeListeners.add(listener);
  listener(currentFallbackNotice);
  return () => {
    fallbackNoticeListeners.delete(listener);
  };
};

export const getAiProvider = (): AiProvider => {
  runStorageMigrationOnce();
  const provider = localStorage.getItem(GOOGLE_AI_PROVIDER_KEY);
  if (provider === 'agent-platform') return 'agent-platform';
  return 'gemini';
};

export const setAiProvider = (provider: AiProvider): void => {
  localStorage.setItem(GOOGLE_AI_PROVIDER_KEY, provider);
  localStorage.setItem(GOOGLE_AI_PROVIDER_SELECTION_SOURCE_KEY, 'manual');
};

export const getApiKey = (provider: AiProvider = getAiProvider()): string | null => {
  if (provider === 'agent-platform') {
    return localStorage.getItem(AGENT_PLATFORM_API_KEY_STORAGE_KEY);
  }
  return (
    localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) ||
    localStorage.getItem(LEGACY_USER_API_KEY_STORAGE_KEY) ||
    localStorage.getItem(LEGACY_API_KEY_STORAGE_KEY) ||
    null
  );
};

export const setApiKey = (key: string, provider: AiProvider = getAiProvider()): void => {
  const trimmed = key.trim();
  if (provider === 'agent-platform') {
    localStorage.setItem(AGENT_PLATFORM_API_KEY_STORAGE_KEY, trimmed);
  } else {
    localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    localStorage.setItem(LEGACY_API_KEY_STORAGE_KEY, trimmed);
  }
};

export const removeApiKey = (provider: AiProvider = getAiProvider()): void => {
  if (provider === 'agent-platform') {
    localStorage.removeItem(AGENT_PLATFORM_API_KEY_STORAGE_KEY);
  } else {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_USER_API_KEY_STORAGE_KEY);
    localStorage.removeItem(LEGACY_API_KEY_STORAGE_KEY);
  }
};

export const isValidGoogleAiApiKey = (key: string): boolean => {
  return GOOGLE_AI_API_KEY_PATTERN.test(key.trim());
};

export const isValidApiKey = (key: string, _provider: AiProvider = getAiProvider()): boolean => {
  return isValidGoogleAiApiKey(key);
};

const normalizeGeminiModel = (model: string | null): string | null => {
  if (!model) return null;
  const trimmed = model.trim();
  if (!trimmed) return null;
  return MODEL_ALIASES[trimmed] || trimmed;
};

export const getSelectedModel = (provider: AiProvider = getAiProvider()): string => {
  runStorageMigrationOnce();
  const storedModel = localStorage.getItem(MODEL_STORAGE_KEY);
  const normalizedModel = normalizeGeminiModel(storedModel);
  if (storedModel && normalizedModel && normalizedModel !== storedModel) {
    localStorage.setItem(MODEL_STORAGE_KEY, normalizedModel);
  }

  if (provider === 'agent-platform') {
    const isAgentPlatformCompatible = AGENT_PLATFORM_MODELS.some(m => m.id === normalizedModel);
    return isAgentPlatformCompatible && normalizedModel ? normalizedModel : DEFAULT_AGENT_PLATFORM_MODEL;
  }

  const isGeminiCompatible = GEMINI_MODELS.some(m => m.id === normalizedModel);
  return isGeminiCompatible && normalizedModel ? normalizedModel : DEFAULT_GEMINI_MODEL;
};

export const setSelectedModel = (model: string): void => {
  runStorageMigrationOnce();
  localStorage.setItem(MODEL_STORAGE_KEY, normalizeGeminiModel(model) || DEFAULT_GEMINI_MODEL);
};

export const getGeminiModelsToTry = (
  preferredModel?: string | null,
  provider: AiProvider = getAiProvider()
): string[] => {
  const fallbackList = PROVIDER_FALLBACK_MODELS[provider] || PROVIDER_FALLBACK_MODELS['gemini'];
  const defaultModel = provider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : MODEL_NAME;
  const normalizedPreferred = normalizeGeminiModel(preferredModel || null);
  const primaryModel = normalizedPreferred || getSelectedModel(provider) || defaultModel;

  // Đối với Agent Platform, đảm bảo model đầu tiên tương thích với Agent Platform
  if (provider === 'agent-platform' && !AGENT_PLATFORM_MODELS.some(m => m.id === primaryModel)) {
    return Array.from(new Set([DEFAULT_AGENT_PLATFORM_MODEL, ...fallbackList]));
  }

  return Array.from(new Set([primaryModel, ...fallbackList]));
};

/**
 * Chuẩn hóa config gọi Gemini 3.x & 2.5 theo API.md v4.2:
 * - Không truyền temperature/topP/topK cho các model gemini-3*
 * - Mặc định dùng ThinkingLevel.MEDIUM cho bước sinh chính; ThinkingLevel.LOW cho bước trích xuất/phụ trợ
 * - Không bao giờ gửi 'minimal' cho gemini-3.8-flash / gemini-3.7-flash
 */
export const createGeminiConfig = ({
  provider = getAiProvider(),
  model,
  systemInstruction,
  responseMimeType,
  responseSchema,
  maxOutputTokens,
  thinkingLevel = ThinkingLevel.MEDIUM,
  temperature = 0.3,
}: {
  provider?: AiProvider;
  model: string;
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: any;
  maxOutputTokens?: number;
  thinkingLevel?: ThinkingLevel;
  temperature?: number;
}) => {
  const isGemini3 = model.startsWith('gemini-3');
  const safeThinkingLevel =
    thinkingLevel === ThinkingLevel.MINIMAL ? ThinkingLevel.LOW : thinkingLevel;

  return {
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(responseSchema ? { responseSchema } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    // Chỉ truyền temperature cho dòng 2.5 trở xuống (Gemini 3.x đã deprecated temperature/topP/topK)
    ...(!isGemini3 ? { temperature } : {}),
    ...(provider === 'gemini' && isGemini3
      ? { thinkingConfig: { thinkingLevel: safeThinkingLevel } }
      : {}),
  };
};

const getErrorText = (error: any): string => {
  const message = error?.message || error?.toString?.() || '';
  let serialized = '';
  try {
    serialized = JSON.stringify(error) || '';
  } catch {
    serialized = '';
  }
  return `${message} ${serialized}`.toLowerCase();
};

export const parseApiError = (error: any): GeminiApiErrorType => {
  // Lỗi đọc JSON (thường do AI bị cắt giữa chừng) hoặc lỗi nội dung đã giải thích → không phải lỗi máy chủ.
  // Trước đây "…JSON at position 15003" bị coi là lỗi 500 vì chứa chuỗi "500" → thử lại mọi model rồi báo "AI quá tải".
  if (error instanceof SyntaxError || error instanceof UserFacingError) return 'UNKNOWN';
  const text = getErrorText(error);
  const status = String(error?.status || error?.code || '').toLowerCase();
  // Mã HTTP phải đứng riêng (không nằm trong một số dài hơn như 15003, 40021)
  const hasCode = (code: string) => new RegExp(`(^|[^0-9.,])${code}(?![0-9])`).test(text);

  if (
    status === '429' ||
    hasCode('429') ||
    text.includes('resource_exhausted') ||
    text.includes('quota') ||
    text.includes('rate limit') ||
    text.includes('too many requests')
  ) {
    return 'QUOTA_EXCEEDED';
  }

  if (
    status === '503' ||
    hasCode('503') ||
    text.includes('unavailable') ||
    text.includes('service unavailable') ||
    text.includes('high demand') ||
    text.includes('overloaded') ||
    text.includes('try again later') ||
    text.includes('temporarily unavailable')
  ) {
    return 'MODEL_OVERLOADED';
  }

  if (
    status === '500' ||
    status === '502' ||
    status === '504' ||
    status === '404' ||
    hasCode('500') ||
    hasCode('502') ||
    hasCode('504') ||
    hasCode('404') ||
    text.includes('not_found') ||
    text.includes('deadline_exceeded') ||
    text.includes('deadline exceeded') ||
    text.includes('bad gateway') ||
    text.includes('fetch failed') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('econnreset') ||
    text.includes('etimedout')
  ) {
    return 'TRANSIENT_SERVER_ERROR';
  }

  if (status === '403' || text.includes('permission_denied') || hasCode('403')) {
    return 'PERMISSION_DENIED';
  }

  if (
    status === '401' ||
    hasCode('401') ||
    text.includes('api_key_invalid') ||
    text.includes('api key not valid') ||
    text.includes('invalid api key')
  ) {
    return 'INVALID_API_KEY';
  }

  if (status === '400' || text.includes('invalid_argument') || hasCode('400')) {
    return 'INVALID_ARGUMENT';
  }

  return 'UNKNOWN';
};

export const isFallbackEligibleError = (
  errorType: GeminiApiErrorType,
  provider: AiProvider = getAiProvider()
): boolean => {
  if (
    errorType === 'MODEL_OVERLOADED' ||
    errorType === 'TRANSIENT_SERVER_ERROR' ||
    errorType === 'QUOTA_EXCEEDED'
  ) {
    return true;
  }
  // Với Agent Platform API, cho phép thử model tương thích tiếp theo khi gặp 403 PERMISSION_DENIED
  if (provider === 'agent-platform' && errorType === 'PERMISSION_DENIED') {
    return true;
  }
  return false;
};

export const getFriendlyGeminiErrorMessage = (
  error: any,
  provider: AiProvider = getAiProvider()
): string => {
  if (error instanceof UserFacingError) return error.message;
  const errorType = parseApiError(error);
  if (/payload size|request entity too large|exceeds the (?:maximum|limit)/i.test(getErrorText(error))) {
    return 'File quá lớn để gửi cho AI (giới hạn khoảng 14 MB). Hãy nén PDF, giảm độ phân giải ảnh hoặc tách đề thành nhiều phần.';
  }
  if (errorType === 'INVALID_API_KEY') {
    return 'API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại trong Cài đặt.';
  }
  if (errorType === 'PERMISSION_DENIED') {
    if (provider === 'agent-platform') {
      return 'Google đã nhận API Key nhưng dự án/key chưa được cấp quyền gọi Agent Platform API hoặc model này. Vui lòng kiểm tra Agent Platform API đã bật, billing, API restrictions và quyền sử dụng model.';
    }
    return 'API key không có quyền truy cập Gemini API. Vui lòng kiểm tra lại trong Cài đặt.';
  }
  if (errorType === 'QUOTA_EXCEEDED') {
    return 'Đã hết quota hoặc vượt giới hạn tốc độ API. Vui lòng đợi rồi thử lại hoặc đổi API Key.';
  }
  if (errorType === 'MODEL_OVERLOADED' || errorType === 'TRANSIENT_SERVER_ERROR') {
    return 'Hệ thống AI đang tạm thời quá tải ở tất cả các model dự phòng. Vui lòng đợi 1-2 phút rồi thử lại hoặc chọn model nhẹ hơn (như Gemini 3.5 Flash-Lite).';
  }
  return `Lỗi API AI: ${error?.message || 'Không xác định'}`;
};

export function createGoogleAiClient(
  apiKey?: string | null,
  provider: AiProvider = getAiProvider()
): GoogleGenAI {
  const key = apiKey || getApiKey(provider);
  if (!key) {
    throw new Error('Vui lòng cấu hình API Key trước khi sử dụng tính năng này.');
  }

  if (provider === 'agent-platform') {
    // Cờ kỹ thuật của Google Gen AI SDK để định tuyến tới aiplatform.googleapis.com trong chế độ API key
    return new GoogleGenAI({ vertexai: true, apiKey: key });
  }
  return new GoogleGenAI({ apiKey: key });
}

// --- Retry helper for transient / overloaded errors ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetryableError = (err: any): boolean => {
  const errorType = parseApiError(err);
  return errorType === 'MODEL_OVERLOADED' || errorType === 'TRANSIENT_SERVER_ERROR';
};

const callWithRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 1,
  label: string = ''
): Promise<T> => {
  let lastError: any = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = Math.min(1200 * Math.pow(2, attempt - 1), 4000);
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

/** Lỗi về nội dung/định dạng: không thử lại bằng model khác, hiển thị nguyên văn cho người dùng. */
export class UserFacingError extends Error {}

// --- Centralized Fallback Wrapper: try models in order and manage fallbackNotice ---
export const callWithFallback = async <T = string>(
  promptFn: (ai: GoogleGenAI, model: string) => Promise<T>,
  preferredModel?: string | null,
  provider: AiProvider = getAiProvider()
): Promise<T> => {
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    throw new Error('Vui lòng cấu hình API Key trước khi sử dụng tính năng này.');
  }
  const ai = createGoogleAiClient(apiKey, provider);
  const modelsToTry = getGeminiModelsToTry(preferredModel, provider);
  let lastError: any = null;

  try {
    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      try {
        console.log(`[ExamCraft] (${provider}) Trying model: ${model}`);
        const result = await callWithRetry(
          () => promptFn(ai, model),
          1,
          `[${provider}:${model}]`
        );
        // BẮT BUỘC: Xóa cảnh báo fallback ngay khi tác vụ hoàn thành thành công
        setFallbackNotice(null);
        return result;
      } catch (err: any) {
        if (err instanceof UserFacingError) throw err;
        lastError = err;
        const errorType = parseApiError(err);
        console.warn(`[ExamCraft] (${provider}) Model ${model} failed (${errorType}):`, err.message || err);

        if (!isFallbackEligibleError(errorType, provider)) {
          break;
        }

        if (i < modelsToTry.length - 1) {
          const nextModel = modelsToTry[i + 1];
          setFallbackNotice(
            `Đang tự động chuyển từ ${model} sang ${nextModel} (do ${model} đang bận)...`
          );
        }
      }
    }
  } finally {
    // Đảm bảo xóa cảnh báo vàng khi kết thúc chuỗi gọi
    setFallbackNotice(null);
  }

  throw new Error(getFriendlyGeminiErrorMessage(lastError, provider));
};

export const generateContentWithModelFallback = async ({
  contents,
  config,
  preferredModel,
  provider = getAiProvider(),
  thinkingLevel = ThinkingLevel.MEDIUM,
  maxOutputTokens,
  temperature = 0.3,
}: {
  contents: any;
  config?: {
    systemInstruction?: string;
    responseMimeType?: string;
    responseSchema?: any;
    maxOutputTokens?: number;
    temperature?: number;
  };
  preferredModel?: string | null;
  provider?: AiProvider;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number;
  temperature?: number;
}) => {
  return callWithFallback(
    async (ai, model) => {
      return await ai.models.generateContent({
        model,
        contents,
        config: createGeminiConfig({
          provider,
          model,
          systemInstruction: config?.systemInstruction,
          responseMimeType: config?.responseMimeType,
          responseSchema: config?.responseSchema,
          maxOutputTokens: config?.maxOutputTokens ?? maxOutputTokens,
          thinkingLevel,
          temperature: config?.temperature ?? temperature,
        }),
      });
    },
    preferredModel,
    provider
  );
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

// --- Kiểm tra output bị cắt do hết token (finishReason = MAX_TOKENS) ---
export const getFinishReason = (response: any): string =>
  String(response?.candidates?.[0]?.finishReason || response?.candidates?.[0]?.finish_reason || '');
export const wasTruncated = (response: any): boolean => /MAX_TOKENS/i.test(getFinishReason(response));
const stripCodeFences = (text: string): string => text.replace(/```html/gi, '').replace(/```/g, '');


const MATRIX_CONVERSION_RULES = `
    YÊU CẦU KỸ THUẬT (BẮT BUỘC):
    - Chép NGUYÊN VĂN mọi ô: tên chương/bài, mã câu (I.1, II.1a, Câu 1, C1a,b…), các con số, điểm, tỉ lệ %. KHÔNG tóm tắt, KHÔNG làm tròn, KHÔNG tự sửa số liệu.
    - Giữ nguyên cấu trúc gộp ô (rowspan, colspan) và đủ số cột ở mọi dòng (ô trống vẫn phải có <td></td>).
    - Các dòng tiêu đề cột đặt trong <thead> dùng <th>; dữ liệu đặt trong <tbody>.
    - Nếu tài liệu có CẢ "Ma trận" VÀ "Bản đặc tả" thì xuất THÀNH 2 BẢNG RIÊNG, mỗi bảng có tiêu đề <h2> ngay phía trên (VD: <h2>MA TRẬN ĐỀ KIỂM TRA…</h2> và <h2>BẢN ĐẶC TẢ ĐỀ KIỂM TRA…</h2>). Giữ các dòng tiêu đề / ghi chú (Môn, Lớp, Kỳ kiểm tra, Thời gian) dưới dạng <p>.
    - Font Times New Roman 13pt; border 1px solid black.
    - Output: chỉ mã HTML (<!DOCTYPE html>…), KHÔNG kèm markdown \`\`\`, KHÔNG giải thích.
    - Nếu không đọc được, trả về thông báo lỗi trong thẻ <p>.`;

const TRUNCATED_MATRIX_MESSAGE =
  'Bảng quá dài nên AI chỉ chuyển được một phần (bị cắt giữa bảng). Hãy: (a) tải lên file Word .docx gốc (app đọc trực tiếp, không qua AI), hoặc (b) tách riêng Ma trận và Đặc tả thành 2 file rồi dùng lối tắt "Ma trận + Đặc tả".';

// --- Service Functions ---

export const convertMatrixFileToHtml = async (file: File): Promise<string> => {
  const lowerName = (file.name || '').toLowerCase();
  if (/\.docx?$/.test(lowerName) || /wordprocessingml|msword/.test(file.type || '')) {
    // Gemini không đọc được Word qua inlineData → báo rõ thay vì gửi bytes rồi nhận bảng rác
    throw new UserFacingError(
      'Không đọc được file Word này. Nếu là file .doc đời cũ, hãy mở bằng Word → "Lưu thành" (Save As) định dạng .docx rồi tải lại; hoặc xuất ra PDF.'
    );
  }
  const base64Data = await fileToBase64(file);
  const mimeType = file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');

  const prompt = `
    Bạn là một chuyên gia chuyển đổi dữ liệu.
    Tài liệu đính kèm là **MA TRẬN ĐỀ KIỂM TRA** (có thể kèm **BẢN ĐẶC TẢ**) dạng ảnh hoặc PDF.
    Nhiệm vụ: đọc các bảng trong tài liệu và chuyển thành **HTML Table** chuẩn, giống hệt bản gốc.
    ${MATRIX_CONVERSION_RULES}
  `;

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: prompt }
        ]
      },
      config: createGeminiConfig({
        model,
        thinkingLevel: ThinkingLevel.LOW,
        maxOutputTokens: 32768,
        temperature: 0,
      }),
    });
    if (wasTruncated(response)) throw new UserFacingError(TRUNCATED_MATRIX_MESSAGE);
    return stripCodeFences(response.text || "");
  });
};

// Convert extracted DOCX text + images to HTML table
export const convertMatrixTextToHtml = async (
  text: string,
  images?: { base64: string; mimeType: string }[]
): Promise<string> => {
  const hasImages = images && images.length > 0;

  const MAX_CHARS = 60000;
  if (text.length > MAX_CHARS) {
    console.warn(`[MatrixUpload] Văn bản ma trận dài ${text.length} ký tự, chỉ gửi ${MAX_CHARS} ký tự đầu cho AI.`);
  }
  const prompt = `
    Bạn là một chuyên gia chuyển đổi dữ liệu.
    Nội dung dưới đây là **MA TRẬN ĐỀ KIỂM TRA** (có thể kèm **BẢN ĐẶC TẢ**) được trích xuất từ file Word.
    ${hasImages ? `Có ${images!.length} hình ảnh đính kèm (bao gồm công thức toán đã chuyển thành hình). Hãy đọc kỹ các hình để hiểu nội dung.` : ''}
    Nhiệm vụ: dựng lại các bảng thành **HTML Table** chuẩn, giống hệt bản gốc.
    ${MATRIX_CONVERSION_RULES}
    - Nếu text chứa LaTeX ($...$), giữ nguyên LaTeX trong bảng.

    **NỘI DUNG FILE:**
    ${text.substring(0, MAX_CHARS)}
    ${text.length > MAX_CHARS ? '\n[... phần cuối file quá dài đã bị lược bớt ...]' : ''}
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
      config: createGeminiConfig({
        model,
        thinkingLevel: ThinkingLevel.LOW,
        maxOutputTokens: 32768,
        temperature: 0,
      }),
    });
    if (wasTruncated(response)) throw new UserFacingError(TRUNCATED_MATRIX_MESSAGE);
    return stripCodeFences(response.text || "");
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
      config: createGeminiConfig({
        model,
        responseMimeType: "application/json",
        thinkingLevel: ThinkingLevel.LOW,
        maxOutputTokens: 16384,
      }),
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
    const parsed = JSON.parse(jsonToParse);
    // Chuẩn hoá: AI có thể trả "objectives": null / "lessons": null cho bài Ôn tập, Kiểm tra, Thực hành...
    const chapters = Array.isArray(parsed?.chapters)
      ? parsed.chapters.map((c: any) => ({
          ...c,
          lessons: Array.isArray(c?.lessons)
            ? c.lessons.map((l: any) => ({
                ...l,
                objectives: l?.objectives && typeof l.objectives === 'object'
                  ? l.objectives
                  : { biet: '', hieu: '', van_dung: '', van_dung_cao: '' },
              }))
            : [],
        }))
      : [];
    return { ...parsed, chapters };
  } catch (e) {
    console.error("Failed to parse JSON. Raw text:", resultText);
    throw new Error("Không thể nhận diện nội dung file. Vui lòng kiểm tra lại định dạng hoặc thử file khác.");
  }
};

export const generateStep1Matrix = async (
  data: InputData,
  selectedLessonIds: Set<string>,
  template: MatrixTemplate = 'template1'
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
  const hasEssay = totalEssayQuestions > 0; // Tự luận luôn được tính khi người dùng nhập > 0
  void isGradeNoEssay;

  // Gộp VD + VDC thành 3 mức: Biết, Hiểu, VD (theo chuẩn CV 7991)
  const type1Total = { biet: config.type1.biet, hieu: config.type1.hieu, vd: config.type1.van_dung + config.type1.van_dung_cao };
  const type2QuestionsCount = getDungSaiQuestionCount(config);
  const type2SubItemsTotal = type2QuestionsCount * 4; // Mỗi câu Dạng II gồm 4 ý/lệnh hỏi (a, b, c, d)
  const type2LevelTotals = getDungSaiLevelTotals(config);
  const type2Total = { biet: type2LevelTotals.biet, hieu: type2LevelTotals.hieu, vd: type2LevelTotals.van_dung };
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
  - **QUY ƯỚC QUAN TRỌNG VỀ DẠNG II (Đúng/Sai):**
    + Cấu hình đề yêu cầu **${type2QuestionsCount} câu** Dạng II.
    + Theo quy định chuẩn CV 7991 của Bộ GD&ĐT: Mỗi câu Dạng II gồm **4 lệnh hỏi/ý (a, b, c, d)**.
    + Tổng số lệnh hỏi/ý Dạng II trong ma trận là **${type2SubItemsTotal} ý** (gồm các mã từ II.1a -> II.${type2QuestionsCount}d).
    + Các ý a, b, c, d được phân bổ vào các mức độ Biết, Hiểu, VD của các bài học tương ứng (thông thường ý a, b ở Nhận biết, ý c ở Thông hiểu, ý d ở Vận dụng).
    + ${describeDungSaiLevels(config)}
  ${MATRIX_FULL_COLUMNS_RULE}

  | Dạng câu hỏi | Số câu | Số lệnh hỏi (ý) | Quy cách chi tiết |
  |---|---|---|---|
  | Dạng I (4 lựa chọn) | ${type1Total.biet + type1Total.hieu + type1Total.vd} câu | ${type1Total.biet + type1Total.hieu + type1Total.vd} | 4 phương án A,B,C,D (Biết: ${type1Total.biet}, Hiểu: ${type1Total.hieu}, VD: ${type1Total.vd}) |
  | Dạng II (Đúng - Sai) | ${type2QuestionsCount} câu | ${type2SubItemsTotal} ý | Mỗi câu gồm 4 ý a,b,c,d (Tổng: ${type2SubItemsTotal} ý/lệnh hỏi phân bổ vào Biết, Hiểu, VD) |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet + type3Total.hieu + type3Total.vd} câu | ${type3Total.biet + type3Total.hieu + type3Total.vd} | Điền kết quả số (Biết: ${type3Total.biet}, Hiểu: ${type3Total.hieu}, VD: ${type3Total.vd}) |
  ${hasEssay ? `| Tự luận (IV) | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} câu | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} | Tự luận có thang điểm (Biết: ${essayTotal.biet}, Hiểu: ${essayTotal.hieu}, VD: ${essayTotal.vd}) |` : '| Tự luận | 0 câu | 0 | ⛔ TUYỆT ĐỐI KHÔNG TẠO CỘT TỰ LUẬN |'}

  **RÀNG BUỘC NGHIÊM NGẶT:** Tổng số câu/lệnh hỏi ở mỗi dạng trong bảng trên phải KHỚP CHÍNH XÁC trong ma trận output. Nếu sai dù 1 câu → ma trận KHÔNG HỢP LỆ.
  
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
  1. Đếm tổng số mã câu Dạng I (I.1, I.2...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${type1Total.biet}, Hiểu=${type1Total.hieu}, VD=${type1Total.vd} (Tổng = ${type1Total.biet + type1Total.hieu + type1Total.vd} câu)
  2. Đếm tổng số câu Dạng II: Phải có đủ ${type2QuestionsCount} câu (tương ứng đủ ${type2SubItemsTotal} ý từ II.1a..d đến II.${type2QuestionsCount}a..d) phân bổ trong bảng.
  3. Đếm tổng số mã câu Dạng III (III.1, III.2...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${type3Total.biet}, Hiểu=${type3Total.hieu}, VD=${type3Total.vd} (Tổng = ${type3Total.biet + type3Total.hieu + type3Total.vd} câu)
  ${hasEssay ? `4. Đếm tổng số mã câu Tự luận (IV.1a...) ở cột Biết, Hiểu, VD → phải khớp: Biết=${essayTotal.biet}, Hiểu=${essayTotal.hieu}, VD=${essayTotal.vd}` : ''}
  Nếu bất kỳ số nào KHAI BÁO TRONG BẢNG TRÊN không khớp → SỬA LẠI ma trận cho đúng trước khi trả kết quả.
  `;

  // --- TEMPLATE 2 or 3: Use custom prompt + template file (parsed as HTML) ---
  if (template !== 'template1') {
    const customPrompt = buildMatrixPromptForCustomTemplate(
      template, data, selectedChapters, totalSelectedPeriods, config
    );
    const templateHtml = await fetchTemplateHtml(template);

    // Embed the parsed template HTML directly in the prompt text
    const fullPrompt = templateHtml
      ? customPrompt + `\n\n**===== NỘI DUNG FILE MẪU (HTML đã parse từ .docx) =====**\n${templateHtml}`
      : customPrompt;

    return callWithFallback(async (ai, model) => {
      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: createGeminiConfig({
          model,
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingLevel: ThinkingLevel.MEDIUM,
          maxOutputTokens: 16384,
          temperature: 0.1,
        }),
      });
      const text = response.text || "Lỗi tạo ma trận.";
      return text.replace(/```html/g, '').replace(/```/g, '');
    });
  }

  // --- TEMPLATE 1: Mẫu chuẩn CV 7991 (đúng Phụ lục CV 7991/BGDĐT-GDTrH) ---
  const cvLayout = computeCv7991Layout(config, true);
  const useCv = cvLayout.types.length > 0;
  const cvPrompt = useCv
    ? buildCv7991MatrixPrompt({ data, layout: cvLayout, footnotes, selectedChapters, totalSelectedPeriods })
    : prompt;
  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: cvPrompt,
      config: createGeminiConfig({
        model,
        systemInstruction: SYSTEM_INSTRUCTION,
        thinkingLevel: ThinkingLevel.MEDIUM,
        maxOutputTokens: 16384,
        temperature: 0.1,
      }),
    });
    const text = (response.text || "Lỗi tạo ma trận.").replace(/```html/g, '').replace(/```/g, '');
    return useCv
      ? applyCv7991Thead(text, buildCv7991MatrixThead(cvLayout), cv7991MatrixColumnCount(cvLayout))
      : text;
  });
};




const CV7991_CSS_INLINE = 'body { font-family: "Times New Roman", serif; font-size: 13pt; margin: 20px; } h2 { text-align: center; font-weight: bold; text-transform: uppercase; } table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid black; padding: 3px 5px; text-align: center; vertical-align: middle; } .left-align { text-align: left; vertical-align: top; } .bold { font-weight: bold; }';

/**
 * BẢN ĐẶC TẢ cho MA TRẬN NGƯỜI DÙNG TẢI LÊN:
 * giữ đúng cấu trúc cột (dạng × mức độ, kể cả VDC), đúng hàng bài học, chép nguyên mã/số câu;
 * <thead> dựng bằng code từ chính ma trận (không ép khung CV 7991 / mẫu 2-3-4).
 */
const generateSpecsFromUploadedMatrix = async (
  matrixContent: string,
  data: InputData,
  selectedLessonIds: Set<string>,
): Promise<string> => {
  const contract = parseMatrixContract(matrixContent, { prefer: 'matrix' });
  const head = contract.ok ? buildSpecsTheadFromContract(contract) : null;
  const footnotes = getSubjectFootnotes(data.subject);
  const objectivesMap: string[] = [];
  data.chapters.forEach(c => (c.lessons || []).forEach(l => {
    if (selectedLessonIds.has(l.id)) {
      objectivesMap.push(`- Bài "${l.name}": Biết: ${l.objectives?.biet || '...'} | Hiểu: ${l.objectives?.hieu || '...'} | Vận dụng: ${l.objectives?.van_dung || '...'} | Vận dụng cao: ${l.objectives?.van_dung_cao || '...'}`);
    }
  }));
  const levelNames = contract.hasVDC ? 'Biết / Hiểu / Vận dụng / Vận dụng cao' : 'Biết / Hiểu / Vận dụng';
  const cellExample = contract.codeStyle === 'roman' ? 'VD: "I.1, I.2", "II.1a, II.1b"'
    : contract.codeStyle === 'cau' ? 'VD: "Câu 1, 2", "Câu 1a, 1b"'
    : contract.codeStyle === 'count' ? 'VD: số lệnh hỏi "2", "1"' : '';

  const prompt = `
  Dựa trên **MA TRẬN ĐỀ KIỂM TRA do người dùng tải lên** (HTML) dưới đây, hãy lập **BẢN ĐẶC TẢ ĐỀ KIỂM TRA** (Full HTML Document)
  cho môn **${data.subject || '(theo tiêu đề ma trận)'}**, **lớp ${data.grade || '(theo tiêu đề ma trận)'}**, ${data.examType}.

  **NGUYÊN TẮC BẮT BUỘC — BÁM 100% MA TRẬN TẢI LÊN:**
  1. Giữ NGUYÊN danh sách Chủ đề/Chương và Nội dung/đơn vị kiến thức (đúng tên, đúng thứ tự, không thêm/bớt/gộp).
  2. Giữ NGUYÊN các dạng câu hỏi và các cột mức độ của ma trận (${levelNames}); không thêm dạng, không bỏ cột${contract.hasVDC ? ', cột Vận dụng cao giữ RIÊNG' : ''}.
  3. Mỗi ô câu hỏi (cùng hàng bài học, cùng dạng, cùng mức) ghi Y NGUYÊN nội dung ô tương ứng trong ma trận${cellExample ? ` (${cellExample})` : ''}; ô trống để trống. Không đổi cách đánh mã.
  4. Thêm cột **"Yêu cầu cần đạt"** (class="left-align") cho mỗi đơn vị kiến thức: ghi yêu cầu cần đạt cho TỪNG mức độ có câu hỏi ở hàng đó, mỗi mức một dòng bắt đầu bằng <b>- Biết:</b> / <b>- Hiểu:</b> / <b>- Vận dụng:</b>${contract.hasVDC ? ' / <b>- Vận dụng cao:</b>' : ''}; dùng động từ đo được, đúng Chương trình GDPT 2018 môn ${data.subject || 'học'} lớp ${data.grade || ''}.
  5. KHÔNG có cột Tổng / Tỉ lệ % theo hàng. Cuối bảng thêm các dòng "Tổng số câu", "Tổng số điểm", "Tỉ lệ %" chép đúng số liệu tương ứng của ma trận cho các cột mức độ.
  ${head ? `6. Bảng có đúng **${head.columnCount} cột**. Dùng NGUYÊN VĂN phần <thead> sau (không sửa, không thêm/bớt cột):
\`\`\`
${head.thead}
\`\`\`` : ''}

  ${contract.ok ? buildContractPromptBlock(contract, { maxYccd: 0 }) : ''}

  **MA TRẬN ĐẦU VÀO (NGUỒN CHUẨN DUY NHẤT):**
  ${matrixContent}

  ${objectivesMap.length ? `**YÊU CẦU CẦN ĐẠT THAM KHẢO THEO BÀI:**\n  ${objectivesMap.join('\n  ')}` : ''}

  **YÊU CẦU OUTPUT:**
  1. Full HTML Document (<!DOCTYPE html>…), CSS trong <style>: ${CV7991_CSS_INLINE}
  2. Trên bảng: <h2>BẢN ĐẶC TẢ ĐỀ KIỂM TRA …</h2> — giữ đúng môn/lớp/kỳ kiểm tra như tiêu đề ma trận; năm học giữ như ma trận (nếu ma trận để trống thì ghi "20... - 20...").
  3. Dưới bảng: chú thích năng lực — nếu ma trận có chú thích năng lực thì chép lại đúng như ma trận, nếu không thì dùng: ${footnotes.replace(/\n/g, ' ')}
  4. Chỉ trả về HTML, không giải thích.

  **KIỂM TRA TRƯỚC KHI TRẢ KẾT QUẢ:** tập mã câu/số câu ở từng cột của đặc tả phải TRÙNG KHỚP với ma trận; danh sách bài học trùng khớp ma trận.
  `;

  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: createGeminiConfig({
        model,
        systemInstruction: getSystemInstruction(true),
        thinkingLevel: ThinkingLevel.MEDIUM,
        maxOutputTokens: 32768,
        temperature: 0.1,
      }),
    });
    if (wasTruncated(response)) {
      throw new UserFacingError('Bản đặc tả quá dài nên AI bị cắt giữa chừng. Vui lòng bấm tạo lại hoặc chọn model Pro trong Cài đặt.');
    }
    const text = stripCodeFences(response.text || 'Lỗi tạo đặc tả.');
    return head ? applyCv7991Thead(text, head.thead, head.columnCount) : text;
  });
};

export const generateStep2Specs = async (
  matrixContent: string,
  data: InputData,
  selectedLessonIds: Set<string>,
  template: MatrixTemplate = 'template1',
  isUploadedMatrix: boolean = false
): Promise<string> => {
  // Ma trận do người dùng tải lên → đặc tả theo đúng cấu trúc của ma trận đó (bỏ qua mẫu/thang điểm mặc định)
  if (isUploadedMatrix && matrixContent && /<table/i.test(matrixContent)) {
    return generateSpecsFromUploadedMatrix(matrixContent, data, selectedLessonIds);
  }

  const objectivesMap: string[] = [];
  data.chapters.forEach(c => (c.lessons || []).forEach(l => {
    if (selectedLessonIds.has(l.id)) {
      objectivesMap.push(`- Bài "${l.name}": \n   + Biết: ${l.objectives?.biet || '...'}\n   + Hiểu: ${l.objectives?.hieu || '...'}\n   + Vận dụng: ${l.objectives?.van_dung || '...'}\n   + Vận dụng cao: ${l.objectives?.van_dung_cao || '...'}`);
    }
  }));

  const config = data.questionConfig;
  const totalEssayQuestions = config.essay.biet + config.essay.hieu + config.essay.van_dung + config.essay.van_dung_cao;
  const isGradeNoEssay = GRADE_NO_ESSAY.includes(data.grade);
  const allowEssay = totalEssayQuestions > 0; void isGradeNoEssay;
  const hasEssay = allowEssay && totalEssayQuestions > 0;

  const type1Total = { biet: config.type1.biet, hieu: config.type1.hieu, vd: config.type1.van_dung + config.type1.van_dung_cao };
  const type2QuestionsCount = getDungSaiQuestionCount(config);
  const type2SubItemsTotal = type2QuestionsCount * 4; // Mỗi câu Dạng II gồm 4 ý/lệnh hỏi (a, b, c, d)
  const type3Total = { biet: config.type3.biet, hieu: config.type3.hieu, vd: config.type3.van_dung + config.type3.van_dung_cao };
  const essayTotal = { biet: config.essay.biet, hieu: config.essay.hieu, vd: config.essay.van_dung + config.essay.van_dung_cao };

  const isGiuaKy = data.examType.includes('Giữa');
  const examTypeLabel = isGiuaKy ? 'GIỮA HỌC KÌ' : 'CUỐI KÌ';
  const semesterNum = data.examType.includes('1') ? 'I' : 'II';
  const footnotes = getSubjectFootnotes(data.subject);

  const prompt = `
  Dựa trên **Ma trận đề kiểm tra** (HTML) đã có, hãy tạo **BẢNG ĐẶC TẢ ĐỀ KIỂM TRA** (Full HTML Document).
  Phân tích HTML ma trận để lấy chính xác toàn bộ Chủ đề/Chương, Nội dung/đơn vị kiến thức, số lượng câu hỏi, mã câu, điểm số và cấu trúc cột.

  **MA TRẬN ĐẦU VÀO (NGUỒN CHUẨN DUY NHẤT - BẮT BUỘC KHỚP 100%):**
  ${matrixContent}

  **DỮ LIỆU YÊU CẦU CẦN ĐẠT THAM KHẢO:**
  ${objectivesMap.length ? objectivesMap.join('\n') : '(Tự suy luận Yêu cầu cần đạt chuẩn GDPT 2018 cho từng Nội dung/Đơn vị kiến thức có trong Ma trận đầu vào)'}

  **===== BẢNG SỐ LƯỢNG TỔNG HỢP TỪ MA TRẬN =====**
  - **QUY ƯỚC DẠNG II (Đúng/Sai):**
    + Gồm **${type2QuestionsCount} câu** Đúng/Sai. Mỗi câu gồm **4 ý lệnh hỏi (a, b, c, d)**.
    + Tổng số ý Dạng II cần đặc tả là **${type2SubItemsTotal} ý** (tương ứng các mã từ II.1a -> II.${type2QuestionsCount}d).
    + Mỗi dòng đặc tả (NB, TH, VD) gắn với các ý tương ứng theo đúng ô của Ma trận đầu vào.
    + ${describeDungSaiLevels(config)}
  ${MATRIX_FULL_COLUMNS_RULE}

  | Dạng câu hỏi | Số câu | Số lệnh hỏi (ý) | Quy cách |
  |---|---|---|---|
  | Dạng I (4 lựa chọn) | ${type1Total.biet + type1Total.hieu + type1Total.vd} câu | ${type1Total.biet + type1Total.hieu + type1Total.vd} | Biết: ${type1Total.biet}, Hiểu: ${type1Total.hieu}, VD: ${type1Total.vd} |
  | Dạng II (Đúng - Sai) | ${type2QuestionsCount} câu | ${type2SubItemsTotal} ý | Mỗi câu gồm 4 ý a,b,c,d. Tổng: ${type2SubItemsTotal} ý phân bổ vào các mức |
  | Dạng III (Trả lời ngắn) | ${type3Total.biet + type3Total.hieu + type3Total.vd} câu | ${type3Total.biet + type3Total.hieu + type3Total.vd} | Biết: ${type3Total.biet}, Hiểu: ${type3Total.hieu}, VD: ${type3Total.vd} |
  ${hasEssay ? `| Tự luận (IV) | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} câu | ${essayTotal.biet + essayTotal.hieu + essayTotal.vd} | Biết: ${essayTotal.biet}, Hiểu: ${essayTotal.hieu}, VD: ${essayTotal.vd} |` : '| Tự luận | 0 câu | 0 | ⛔ TUYỆT ĐỐI KHÔNG TẠO CỘT TỰ LUẬN |'}

  **===== ĐỊNH DẠNG BẢNG ĐẶC TẢ BẮT BUỘC (Tuân thủ 100%) =====**

  Tiêu đề bảng (in đậm, căn giữa, ở trên bảng):
   **ĐẶC TẢ ĐỀ KIỂM TRA ${examTypeLabel} ${semesterNum} - LỚP ${data.grade} - MÔN ${data.subject.toUpperCase()} - NĂM HỌC 20... - 20...**

  **QUY TẮC NĂM HỌC (BẮT BUỘC):** Thông tin năm học phải ĐỂ TRỐNG dạng: "NĂM HỌC 20... - 20...". TUYỆT ĐỐI KHÔNG điền sẵn bất kỳ năm cụ thể nào.

  **HEADER BẢNG:**
  CẤU TRÚC CỘT PHẢI **KHỚP 100%** với Ma trận đầu vào. Nếu Ma trận không có Tự luận thì Đặc tả cũng không có.

  **NỘI DUNG BẢNG (Quan trọng nhất):**
  Giữ nguyên 100% danh sách Chương/chủ đề và Nội dung/Đơn vị kiến thức từ Ma trận đầu vào (không tự ý thêm/bớt hay đổi tên bài học):
  - Ô "TT" và "Chương/chủ đề": Merge theo chương (rowspan)
  - Ô "Nội dung/ĐVKT": Tên bài (khớp y hệt Ma trận)
  - Ô "Yêu cầu cần đạt": Nội dung CHI TIẾT yêu cầu cần đạt ở từng mức độ (Nhận biết, Thông hiểu, Vận dụng). Text-align: left.
  - Các ô số lượng/mã câu: Ghi số lượng hoặc mã câu tương ứng - PHẢI KHỚP 100% ở từng hàng và từng cột với Ma trận đầu vào!

  **QUAN TRỌNG:**
  - Cột "Yêu cầu cần đạt" phải đủ rộng, text-align: left, chứa nội dung chi tiết
  - Số câu hỏi, mã câu và vị trí từng ô PHẢI khớp 100% với **MA TRẬN ĐẦU VÀO** ở trên.
  - Nếu Ma trận không có cột Tự luận thì Đặc tả cũng KHÔNG có.

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

  // --- TEMPLATE 2, 3 or 4: Use custom prompt + template file (parsed as HTML) ---
  if (template !== 'template1') {
    const customPrompt = buildSpecsPromptForCustomTemplate(
      template, matrixContent, data, selectedLessonIds, config, isUploadedMatrix
    );
    const templateHtml = await fetchTemplateHtml(template);

    // Embed the parsed template HTML directly in the prompt text
    const fullPrompt = templateHtml
      ? customPrompt + `\n\n**===== NỘI DUNG FILE MẪU (HTML đã parse từ .docx) =====**\n${templateHtml}`
      : customPrompt;

    return callWithFallback(async (ai, model) => {
      const response = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: createGeminiConfig({
          model,
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingLevel: ThinkingLevel.MEDIUM,
          maxOutputTokens: 16384,
          temperature: 0.1,
        }),
      });
      const text = response.text || "Lỗi tạo đặc tả.";
      return text.replace(/```html/g, '').replace(/```/g, '');
    });
  }

  // --- TEMPLATE 1: Mẫu chuẩn CV 7991 (đúng Phụ lục CV 7991/BGDĐT-GDTrH) ---
  const cvLayout = computeCv7991Layout(config, allowEssay);
  const useCv = cvLayout.types.length > 0;
  const cvPrompt = useCv
    ? buildCv7991SpecsPrompt({ data, layout: cvLayout, footnotes, matrixContent, objectivesMap, isUploadedMatrix })
    : prompt;
  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: cvPrompt,
      config: createGeminiConfig({
        model,
        systemInstruction: SYSTEM_INSTRUCTION,
        thinkingLevel: ThinkingLevel.MEDIUM,
        maxOutputTokens: 16384,
        temperature: 0.1,
      }),
    });
    const text = (response.text || "Lỗi tạo đặc tả.").replace(/```html/g, '').replace(/```/g, '');
    return useCv
      ? applyCv7991Thead(text, buildCv7991SpecsThead(cvLayout), cv7991SpecsColumnCount(cvLayout))
      : text;
  });
};

// --- Extract questions from reference document (Instant local parser + Fast AI fallback for PDF/Images) ---
export const extractQuestionsFromReference = async (
  text: string,
  images: { base64: string; mimeType: string }[],
  _specsHtml: string,
  subject: string,
  grade: string,
  forceAi: boolean = false
): Promise<ExtractedQuestion[]> => {
  const hasImages = images && images.length > 0;
  const hasPdfOrImageOnly = hasImages && (!text || text.replace(/\[Tài liệu PDF\/Hình ảnh đính kèm:[^\]]*\]/g, '').trim().length < 50);

  // Fast Path (< 5ms): Use local deterministic parser first when text is available
  if (!forceAi && !hasPdfOrImageOnly && text && text.trim().length > 20) {
    const localQuestions = extractQuestionsLocally(text);
    if (localQuestions.length > 0) {
      console.log(`[ExamCraft] Instant local parser extracted ${localQuestions.length} questions in <5ms`);
      return localQuestions;
    }
  }

  const prompt = `
  Trích xuất nhanh danh sách câu hỏi từ tài liệu môn ${subject || 'THPT'} lớp ${grade || ''}.
  ${hasImages ? `Có ${images.length} tệp/hình đính kèm, hãy chuyển công thức trong hình sang LaTeX $...$.` : ''}

  QUY TẮC:
  1. Giữ nguyên văn câu hỏi và công thức LaTeX $...$.
  2. Phân loại:
     - "type": "type1" (4 lựa chọn A,B,C,D), "type2" (Đúng/Sai a,b,c,d), "type3" (Trả lời ngắn), "essay" (Tự luận)
     - "level": "biet" | "hieu" | "van_dung" | "van_dung_cao"

  NỘI DUNG TÀI LIỆU:
  ${text.substring(0, 18000)}

  OUTPUT JSON Array:
  [
    {
      "id": "q1",
      "type": "type1",
      "level": "biet",
      "topic": "Chủ đề",
      "content": "Nội dung câu hỏi",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "A",
      "subItems": null
    }
  ]
  `;

  const parts: any[] = [];

  if (hasImages) {
    const imagesToSend = images.slice(0, 8);
    for (const img of imagesToSend) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
  }

  parts.push({ text: prompt });

  const resultText = await callWithFallback(async (ai, model) => {
    console.log(`[ExamCraft] Fast AI question extraction with model: ${model}`);
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: createGeminiConfig({
        model,
        responseMimeType: 'application/json',
        thinkingLevel: ThinkingLevel.LOW,
        maxOutputTokens: 16384,
        temperature: 0.1,
      }),
    });
    return response.text || '[]';
  });

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
};

/**
 * Chọn HỢP ĐỒNG SỐ LIỆU dùng để sinh đề:
 *  - Ma trận tải lên: luôn dùng (đọc được) — đặc tả khớp ma trận thì ưu tiên đặc tả vì có Yêu cầu cần đạt.
 *  - Ma trận do AI sinh: chỉ dùng khi số câu trong bảng khớp đúng cấu hình (để lấy thêm bài học/mức của từng câu).
 */
export const pickExamContract = (
  matrixContent: string | undefined,
  specsContent: string | undefined,
  questionConfig: QuestionConfig,
  isUploadedMatrix: boolean
): MatrixContract | null => {
  const { primary } = resolveContracts(matrixContent, specsContent);
  if (!primary || !primary.ok) return null;
  if (isUploadedMatrix) return primary;
  return contractMatchesConfig(primary, questionConfig) ? primary : null;
};

const TYPE_KEY_TO_ROMAN: Record<string, 'I' | 'II' | 'III' | 'IV'> = { type1: 'I', type2: 'II', type3: 'III', essay: 'IV' };

const buildContractStructureInstructions = (contract: MatrixContract): string => {
  // Điểm từng phần: theo file; file không ghi điểm → thang mặc định CV 7991
  const pts: Partial<Record<'I' | 'II' | 'III' | 'IV', number>> = { ...contract.points.byType };
  if (!contract.points.fromFile && contract.questionConfig) {
    computeCv7991Layout(contract.questionConfig, true).types.forEach(t => { pts[TYPE_KEY_TO_ROMAN[t.key]] = t.points; });
  }
  const p = (t: 'I' | 'II' | 'III' | 'IV') => (pts[t] !== undefined ? ` (${fmtNum(pts[t]!)} điểm)` : '');
  const q = contract.questionCount;
  const lines: string[] = [];
  lines.push(buildContractPromptBlock(contract));
  lines.push('');
  lines.push('**CẤU TRÚC ĐỀ BẮT BUỘC (đúng theo hợp đồng số liệu trên):**');
  if (q.I) lines.push(`- **PHẦN I. ${TYPE_LABEL.I.toUpperCase()}${p('I')}:** đúng ${q.I} câu (Câu 1 → Câu ${q.I}); mỗi câu có đúng 4 phương án A, B, C, D và chỉ 1 phương án đúng.`);
  if (q.II) lines.push(`- **PHẦN II. ${TYPE_LABEL.II.toUpperCase()}${p('II')}:** đúng ${q.II} câu (Câu 1 → Câu ${q.II}); mỗi câu gồm 1 đề dẫn chung và ĐÚNG 4 ý a), b), c), d); mức độ từng ý đúng như hợp đồng.`);
  if (q.III) lines.push(`- **PHẦN III. ${TYPE_LABEL.III.toUpperCase()}${p('III')}:** đúng ${q.III} câu (Câu 1 → Câu ${q.III}); mỗi câu có đáp án ngắn, xác định duy nhất (ưu tiên đáp án là số).`);
  if (q.IV) lines.push(`- **PHẦN IV. ${TYPE_LABEL.IV.toUpperCase()}${p('IV')}:** đúng ${q.IV} câu (Câu 1 → Câu ${q.IV}); câu có nhiều ý thì ghi a), b)… đúng số ý trong hợp đồng; ghi điểm từng câu theo hợp đồng.`);
  lines.push('- Tiêu đề mỗi phần ghi đúng dạng "PHẦN I. …", "PHẦN II. …" (giữ số La Mã theo dạng câu hỏi như trên, kể cả khi ma trận không có một phần nào đó).');
  lines.push('- Mỗi câu hỏi PHẢI đúng đơn vị kiến thức, đúng mức độ (và đúng Yêu cầu cần đạt nếu có) đã ghi cho câu đó trong hợp đồng.');
  return lines.join('\n') + '\n';
};

const generateStep3ExamRaw = async (
  specsContent: string,
  questionConfig: QuestionConfig,
  inputData: InputData,
  referenceText?: string,
  referenceImages?: { base64: string; mimeType: string }[],
  extractedQuestions?: ExtractedQuestion[],
  referenceMode: ReferenceUsageMode = 'exact',
  matrixContent?: string,
  isUploadedMatrix: boolean = false,
  opts: { concise?: boolean } = {}
): Promise<{ raw: string; contract: MatrixContract | null; counts: { type1: number; type2: number; type3: number; essay: number } }> => {

  const counts = {
    type1: questionConfig.type1.biet + questionConfig.type1.hieu + questionConfig.type1.van_dung + questionConfig.type1.van_dung_cao,
    type2: getDungSaiQuestionCount(questionConfig),
    type3: questionConfig.type3.biet + questionConfig.type3.hieu + questionConfig.type3.van_dung + questionConfig.type3.van_dung_cao,
    essay: questionConfig.essay.biet + questionConfig.essay.hieu + questionConfig.essay.van_dung + questionConfig.essay.van_dung_cao,
  };

  // ===== HỢP ĐỒNG SỐ LIỆU: nguồn chuẩn số câu / mức độ / bài học của từng câu =====
  const contract = pickExamContract(matrixContent, specsContent, questionConfig, isUploadedMatrix);
  if (contract) {
    counts.type1 = contract.questionCount.I;
    counts.type2 = contract.questionCount.II;
    counts.type3 = contract.questionCount.III;
    counts.essay = contract.questionCount.IV; // số CÂU tự luận (không phải số lệnh hỏi)
  }

  // Build a clear whitelist of allowed parts
  const allowedParts: string[] = [];
  if (counts.type1 > 0) allowedParts.push('PHẦN I (Trắc nghiệm nhiều lựa chọn)');
  if (counts.type2 > 0) allowedParts.push('PHẦN II (Đúng/Sai)');
  if (counts.type3 > 0) allowedParts.push('PHẦN III (Trả lời ngắn)');
  if (counts.essay > 0) allowedParts.push('PHẦN IV (Tự luận)');

  let structureInstructions = "**CẤU TRÚC ĐỀ THI & ĐÁP ÁN CẦN TẠO (BÁM SÁT 100% MA TRẬN & ĐẶC TẢ):**\n";

  if (contract) {
    structureInstructions += buildContractStructureInstructions(contract);
  } else if (isUploadedMatrix) {
    // Ma trận tải lên nhưng máy không đọc được số liệu → để AI bám trực tiếp bảng, KHÔNG dùng cấu hình mặc định
    structureInstructions += `- Đọc KỸ Ma trận và Bảng đặc tả ở trên: tạo ĐÚNG số phần, số câu, số ý và mức độ như trong bảng (mỗi mã câu / mỗi lệnh hỏi trong bảng tương ứng đúng 1 câu / 1 ý trong đề).\n- Dạng nào bảng không có thì KHÔNG tạo. Thang điểm theo dòng "Tổng số điểm" của bảng (nếu có).\n- Tiêu đề phần ghi dạng "PHẦN I. …", "PHẦN II. …"; Phần I mỗi câu 4 phương án A–D; Phần II mỗi câu 4 ý a) b) c) d).\n`;
  } else {
  if (counts.type1 > 0) {
    structureInstructions += `- **PHẦN I (Trắc nghiệm nhiều lựa chọn):** Tạo đúng ${counts.type1} câu hỏi (Nhận biết: ${questionConfig.type1.biet}, Thông hiểu: ${questionConfig.type1.hieu}, Vận dụng: ${questionConfig.type1.van_dung + questionConfig.type1.van_dung_cao}) và Đáp án Phần I.\n`;
  } else {
    structureInstructions += `- **PHẦN I:** KHÔNG ĐƯỢC TẠO (Số câu = 0). Bỏ qua hoàn toàn.\n`;
  }

  if (counts.type2 > 0) {
    structureInstructions += `- **PHẦN II (Đúng/Sai):** Tạo đúng ${counts.type2} câu hỏi (mỗi câu 4 ý a,b,c,d) và Đáp án Phần II (BẮT BUỘC có bảng thông tin hướng dẫn giải chi tiết và đủ 4 đáp án a, b, c, d cho mỗi câu).\n`;
    const dsLevels = describeDungSaiLevels(questionConfig);
    if (dsLevels) structureInstructions += `  ${dsLevels}\n`;
  } else {
    structureInstructions += `- **PHẦN II:** KHÔNG ĐƯỢC TẠO (Số câu = 0). Bỏ qua hoàn toàn.\n`;
  }

  if (counts.type3 > 0) {
    structureInstructions += `- **PHẦN III (Trả lời ngắn):** Tạo đúng ${counts.type3} câu hỏi (Nhận biết: ${questionConfig.type3.biet}, Thông hiểu: ${questionConfig.type3.hieu}, Vận dụng: ${questionConfig.type3.van_dung + questionConfig.type3.van_dung_cao}) và Đáp án Phần III.\n`;
  } else {
    structureInstructions += `- **PHẦN III:** KHÔNG ĐƯỢC TẠO (Số câu = 0). Bỏ qua hoàn toàn.\n`;
  }

  if (counts.essay > 0) {
    structureInstructions += `- **PHẦN IV (Tự luận):** Tạo đúng ${counts.essay} câu hỏi (Nhận biết: ${questionConfig.essay.biet}, Thông hiểu: ${questionConfig.essay.hieu}, Vận dụng: ${questionConfig.essay.van_dung + questionConfig.essay.van_dung_cao}) và Đáp án/Hướng dẫn chấm chi tiết Phần IV.\n`;
  } else {
    structureInstructions += `- **PHẦN IV (Tự luận):** ⛔ CẤM TẠO. Số câu = 0. TUYỆT ĐỐI KHÔNG SINH RA BẤT KỲ CÂU TỰ LUẬN NÀO.\n`;
  }
  } // end: không có hợp đồng số liệu
  if (opts.concise) {
    structureInstructions += `\n**⚠️ GIỚI HẠN ĐỘ DÀI:** Lần trước đề bị cắt cụt vì quá dài. Lần này viết lời giải/hướng dẫn chấm NGẮN GỌN (chỉ các bước chính), KHÔNG lặp lại đề bài trong phần đáp án — nhưng vẫn phải ĐỦ tất cả câu và đủ đáp án.\n`;
  }

  structureInstructions += `\n**⚠️ DANH SÁCH PHẦN ĐƯỢC PHÉP TẠO (WHITELIST):** ${allowedParts.length > 0 ? allowedParts.join(', ') : 'Theo đúng các phần có trong Ma trận & Bảng đặc tả'}.\n`;
  structureInstructions += `**⛔ NGHIÊM CẤM:** Bất kỳ phần nào KHÔNG có trong Ma trận/Bảng đặc tả và whitelist trên đều KHÔNG ĐƯỢC TẠO.\n`;
  structureInstructions += `**🎯 BẮT BUỘC TUÂN THỦ MA TRẬN & ĐẶC TẢ:** Từng câu hỏi (Câu 1, Câu 2...) ở mỗi phần PHẢI khớp chính xác với **Đơn vị kiến thức/Bài học**, **Mức độ tư duy (Nhận biết / Thông hiểu / Vận dụng)** và **Yêu cầu cần đạt** tại đúng dòng/cột tương ứng trong Ma trận và Bảng đặc tả!\n`;

  // Build reference section
  let referenceSection = '';
  const hasExtractedQuestions = extractedQuestions && extractedQuestions.length > 0;
  const hasRawReference = (referenceText && referenceText.trim().length > 0) || (referenceImages && referenceImages.length > 0);

  if (hasExtractedQuestions) {
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

    if (referenceMode === 'adapt') {
      referenceSection = `
  **===== NGÂN HÀNG CÂU HỎI MẪU — CHẾ ĐỘ: THAM KHẢO DẠNG CÂU HỎI, THAY SỐ HOẶC BỐI CẢNH (BẮT BUỘC TUÂN THỦ) =====**
  
  Dưới đây là ${extractedQuestions!.length} câu hỏi mẫu từ tài liệu tham khảo của người dùng.
  Phân bổ: Dạng I: ${questionsByType.type1.length}, Dạng II: ${questionsByType.type2.length}, Dạng III: ${questionsByType.type3.length}, Tự luận: ${questionsByType.essay.length}
  
  **CÁCH SỬ DỤNG NGÂN HÀNG CÂU HỎI MẪU (BẮT BUỘC TUÂN THỦ):**
  1. **THAM KHẢO DẠNG CÂU HỎI:** Chọn các câu hỏi mẫu bên dưới có dạng toán/dạng bài phù hợp với từng yêu cầu trong Ma trận và Bảng đặc tả (đúng dạng câu hỏi, đúng mức độ Nhận biết / Thông hiểu / Vận dụng, đúng chủ đề).
  2. **THAY SỐ LIỆU HOẶC BỐI CẢNH CHO PHÙ HỢP:**
     - TUYỆT ĐỐI KHÔNG chép nguyên xi số liệu của câu hỏi gốc.
     - Hãy **thay đổi số liệu, hệ số, hàm số, biểu thức toán học hoặc bối cảnh thực tế** dựa trên cấu trúc/dạng của câu hỏi mẫu để tạo thành câu hỏi mới tương đương về mức độ tư duy và phù hợp chặt chẽ với Bảng đặc tả.
     - Tính toán lại chính xác **các phương án A, B, C, D, các mệnh đề Đúng/Sai a), b), c), d), đáp án trả lời ngắn và lời giải chi tiết** theo số liệu/bối cảnh mới.
  3. Nếu ngân hàng mẫu chưa có câu hỏi cho một nội dung nào đó trong Bảng đặc tả → tự biên soạn câu hỏi mới bám sát Bảng đặc tả theo phong cách tương tự.
  4. Sắp xếp lại số thứ tự câu hỏi (Câu 1, Câu 2...) cho liên tục.
  
  **DANH SÁCH CÂU HỎI MẪU THAM KHẢO:**
  ${questionsListing}
  
  **===== HẾT NGÂN HÀNG CÂU HỎI MẪU =====**
  `;
    } else {
      referenceSection = `
  **===== NGÂN HÀNG CÂU HỎI ĐÃ TRÍCH XUẤT — CHẾ ĐỘ: TRÍCH XUẤT CHÍNH XÁC (BẮT BUỘC SỬ DỤNG) =====**
  
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
    }
  } else if (hasRawReference) {
    const hasImages = referenceImages && referenceImages.length > 0;
    const safeText = referenceText || '';
    if (referenceMode === 'adapt') {
      referenceSection = `
  **===== TÀI LIỆU THAM KHẢO — CHẾ ĐỘ: THAM KHẢO DẠNG CÂU HỎI, THAY SỐ HOẶC BỐI CẢNH =====**
  
  Dưới đây là nội dung tài liệu tham khảo được người dùng tải lên. ${hasImages ? `Có ${referenceImages!.length} tệp/hình ảnh đính kèm (bao gồm PDF hoặc công thức toán).` : ''}
  
  **CÁCH SỬ DỤNG TÀI LIỆU THAM KHẢO:**
  - Tham khảo cấu trúc, dạng câu hỏi, dạng bài toán trong tài liệu tham khảo phù hợp với Ma trận và Bảng đặc tả.
  - **THAY SỐ HOẶC BỐI CẢNH CHO PHÙ HỢP:** Không chép y nguyên câu hỏi gốc; hãy thay đổi số liệu, hàm số, dữ kiện hoặc bối cảnh thực tế và tính toán lại đáp án, lời giải chi tiết thật chính xác.
  - Bổ sung câu hỏi mới nếu tài liệu tham khảo chưa có đủ dạng bài cho một mục trong Bảng đặc tả.
  ${hasImages ? '- Đọc KỸ các tệp/hình ảnh đính kèm — chuyển đổi mọi công thức sang LaTeX chuẩn $...$.' : ''}
  
  **NỘI DUNG TÀI LIỆU THAM KHẢO:**
  ${safeText.substring(0, 15000)}
  ${safeText.length > 15000 ? '\n[... Nội dung đã được cắt ngắn do quá dài ...]' : ''}
  
  **===== HẾT TÀI LIỆU THAM KHẢO =====**
  `;
    } else {
      referenceSection = `
  **===== TÀI LIỆU THAM KHẢO (ĐỀ MẪU / NGÂN HÀNG CÂU HỎI) — CHẾ ĐỘ: TRÍCH XUẤT CHÍNH XÁC =====**
  
  Dưới đây là nội dung tài liệu tham khảo được người dùng tải lên. ${hasImages ? `Có ${referenceImages!.length} tệp/hình ảnh đính kèm (bao gồm PDF hoặc công thức toán).` : ''}
  
  **CÁCH SỬ DỤNG TÀI LIỆU THAM KHẢO:**
  - Sử dụng CHÍNH XÁC NGUYÊN VĂN các câu hỏi có sẵn trong tài liệu tham khảo nếu phù hợp với ma trận, đặc tả.
  - Ưu tiên lấy nguyên văn câu hỏi thay vì tạo mới.
  - Chỉ tạo câu hỏi MỚI khi tài liệu tham khảo không đủ câu cho một dạng/mức độ cụ thể.
  ${hasImages ? '- Đọc KỸ các tệp/hình ảnh đính kèm — đặc biệt là hình công thức toán. Chuyển đổi nội dung hình sang LaTeX khi cần.' : ''}
  
  **NỘI DUNG TÀI LIỆU THAM KHẢO:**
  ${safeText.substring(0, 15000)}
  ${safeText.length > 15000 ? '\n[... Nội dung đã được cắt ngắn do quá dài ...]' : ''}
  
  **===== HẾT TÀI LIỆU THAM KHẢO =====**
  `;
    }
  }

  const matrixSection = matrixContent && matrixContent.trim().length > 0
    ? `\n  Dựa trên **Ma trận đề kiểm tra** ${isUploadedMatrix ? '(Ma trận gốc do người dùng tải lên - BẮT BUỘC TUÂN THỦ 100%)' : ''} sau (HTML):\n  ${matrixContent}\n`
    : '';

  const prompt = `
  **===== THÔNG TIN ĐỀ THI BẮT BUỘC (CỰC KỲ QUAN TRỌNG) =====**
  - **Môn học:** ${inputData.subject}
  - **Khối lớp:** Lớp ${inputData.grade}
  - **Loại đề:** ${inputData.examType}
  - **Thời gian:** ${inputData.duration} phút

  **===== RÀNG BUỘC MÔN HỌC & PHẠM VI KIẾN THỨC =====**
  - TUYỆT ĐỐI CHỈ tạo câu hỏi về nội dung **môn ${inputData.subject} lớp ${inputData.grade}** theo đúng các Chủ đề/Bài học có trong Ma trận và Bảng đặc tả bên dưới.
  - KHÔNG ĐƯỢC tạo câu hỏi thuộc môn học khác hoặc nằm ngoài các đơn vị kiến thức của Ma trận & Bảng đặc tả.
  ${matrixSection}
  Và dựa trên **Bảng đặc tả đề kiểm tra** sau (HTML):
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
     - .answer-table { width: 100%; border-collapse: collapse; margin: 10px 0 18px 0; font-family: "Times New Roman", serif; font-size: 13pt; }
     - .answer-table th, .answer-table td { border: 1px solid #000; padding: 6px 8px; vertical-align: middle; }
     - .answer-table th { font-weight: bold; background-color: #f2f2f2; text-align: center; }
     - .answer-table td.center { text-align: center; }
     - .answer-table td.left { text-align: left; }
     /* CSS BẢNG BIẾN THIÊN CHUẨN SGK (GIỐNG WORD/LATEX - KHÔNG ĐƯỜNG KẺ DỌC NỘI BỘ) */
     - .bbt-table { 
         border-collapse: collapse; 
         margin: 15px auto; 
         font-family: "Times New Roman", serif; 
         font-size: 13pt; 
         border: 1px solid #000; 
         min-width: 420px; 
       }
     - .bbt-table td { 
         padding: 5px 8px; 
         text-align: center; 
         vertical-align: middle; 
         border: none; /* QUAN TRỌNG: Mặc định KHÔNG kẻ ô */
       }
     - .bbt-table .label-col { 
         font-weight: bold; 
         font-style: italic; 
         border-right: 1px solid #000; 
         width: 50px; 
         text-align: center; 
       }
     - .bbt-table .row-border { 
         border-bottom: 1px solid #000; 
       }

  **===== QUY TẮC BẢNG BIẾN THIÊN CHUẨN SÁCH GIÁO KHOA (TỰ ĐỘNG TẠO ẢNH & DÁN VÀO CÂU HỎI) =====**
  
  Khi câu hỏi hoặc lời giải có **Bảng biến thiên**, TUYỆT ĐỐI KHÔNG tự kẻ bảng HTML thủ công bằng ký tự mũi tên rời rạc.
  Thay vào đó, **BẮT BUỘC** nhúng thẻ \`<script type="application/json" class="figure-json">...</script>\` ngay tại vị trí cần hiển thị bảng biến thiên trong câu hỏi (ngay dưới câu dẫn, trước các phương án A, B, C, D). Hệ thống sẽ tự động tính toán, vẽ thành **ảnh Bảng biến thiên chuẩn SGK 300 DPI** (kiểu \`tkz-tab\` LaTeX) và dán trực tiếp vào câu hỏi tương ứng!
  
  1. **Trường hợp 1 — Biết công thức hàm số cụ thể (ví dụ $y = x^3 - 3x$, $y = -x^4 + 2x^2 + 3$, $y = \\frac{2x+1}{x-1}$):**
     Chỉ cần khai báo trường \`"fn"\`, hệ thống sẽ tự tính đạo hàm, nghiệm, cực trị, giới hạn, vạch đôi không xác định và vẽ ảnh:
     <script type="application/json" class="figure-json">
     {"type": "bbt", "fn": "x^3 - 3*x"}
     </script>
     
  2. **Trường hợp 2 — Câu hỏi cho bảng biến thiên của hàm $y = f(x)$ tổng quát (không cho công thức $f(x)$):**
     Khai báo trực tiếp các mốc \`"xs"\`, dấu đạo hàm \`"signs"\` (dùng \`"||"\` tại điểm không xác định), và giá trị \`"ys"\`:
     <script type="application/json" class="figure-json">
     {"type": "bbt", "xs": ["-\\infty", "-1", "1", "+\\infty"], "signs": ["+", "0", "-", "0", "+"], "ys": [["-\\infty", "bottom"], ["2", "top"], ["-2", "bottom"], ["+\\infty", "top"]]}
     </script>
     *(Nếu tại mốc có tiệm cận đứng / không xác định \`"||"\`, khai báo phần tử \`ys\` tại mốc đó là \`{"pole": true, "left": {"level": "bottom", "label": "-\\infty"}, "right": {"level": "top", "label": "+\\infty"}}\`).*

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
     - Nếu Bảng đặc tả ghi **C13a,b** (hoặc **II.1a, II.1b**) ở Biết và **C13c** ở Hiểu, **C13d** ở VD, hãy gộp thành **MỘT CÂU DUY NHẤT** có đề dẫn chung và đủ **4 ý lệnh hỏi a), b), c), d)**.
     - Ví dụ:
       <p><span class="question-number">Câu 1.</span> Cho hàm số $y = f(x)$... Xét tính đúng sai của các mệnh đề sau:</p>
       <div class="options">
         <div class="option-item">a) Hàm số đồng biến...</div>
         <div class="option-item">b) Đồ thị đi qua...</div>
         <div class="option-item">c) Giá trị lớn nhất...</div>
         <div class="option-item">d) Phương trình...</div>
       </div>

  5. **ĐÁP ÁN VÀ HƯỚNG DẪN CHẤM (ĐẶC BIỆT CHÚ Ý KHI XUẤT RA FILE WORD):**
     - Phải trình bày đầy đủ đáp án cho tất cả các phần có trong đề thi bằng bảng HTML có khung viền rõ ràng (\`<table class="answer-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width: 100%;">\`).
     - **ĐỐI VỚI PHẦN I (Trắc nghiệm nhiều lựa chọn - nếu có):**
       + Lập bảng đáp án nhanh Phần I (hàng Câu 1, 2, 3... và hàng Đáp án A, B, C, D).
     - **⚠️ ĐỐI VỚI PHẦN II — TRẮC NGHIỆM ĐÚNG - SAI (Đ/S) (BẮT BUỘC TUÂN THỦ 100%):**
       + Mỗi câu hỏi Đúng - Sai gồm **4 ý lệnh hỏi (a, b, c, d)** tương ứng với **4 đáp án (Đ hoặc S)**.
       + Trong phần Đáp án / Hướng dẫn giải của Phần II, **BẮT BUỘC PHẢI CÓ BẢNG THÔNG TIN HƯỚNG DẪN GIẢI VÀ 4 ĐÁP ÁN** theo đúng 2 bảng chuẩn dưới đây để khi xuất ra file Word hiển thị đầy đủ:
       
       **(a) Bảng tổng hợp 4 đáp án Đúng - Sai (Đ/S) cho từng câu:**
       <table class="answer-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width: 100%;">
         <thead>
           <tr>
             <th style="width: 20%; text-align: center;">Câu</th>
             <th style="width: 20%; text-align: center;">Ý a)</th>
             <th style="width: 20%; text-align: center;">Ý b)</th>
             <th style="width: 20%; text-align: center;">Ý c)</th>
             <th style="width: 20%; text-align: center;">Ý d)</th>
           </tr>
         </thead>
         <tbody>
           <tr>
             <td class="center" style="text-align: center; font-weight: bold;">Câu 1</td>
             <td class="center" style="text-align: center; font-weight: bold;">Đ</td>
             <td class="center" style="text-align: center; font-weight: bold;">S</td>
             <td class="center" style="text-align: center; font-weight: bold;">Đ</td>
             <td class="center" style="text-align: center; font-weight: bold;">S</td>
           </tr>
         </tbody>
       </table>

       **(b) Bảng thông tin hướng dẫn giải chi tiết và 4 đáp án (a, b, c, d) cho từng câu Đúng - Sai:**
       <table class="answer-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse: collapse; width: 100%;">
         <thead>
           <tr>
             <th style="width: 12%; text-align: center;">Câu</th>
             <th style="width: 10%; text-align: center;">Ý</th>
             <th style="width: 15%; text-align: center;">Đáp án (Đ/S)</th>
             <th style="width: 63%; text-align: center;">Hướng dẫn giải chi tiết</th>
           </tr>
         </thead>
         <tbody>
           <tr>
             <td rowspan="4" class="center" style="text-align: center; font-weight: bold;">Câu 1</td>
             <td class="center" style="text-align: center; font-weight: bold;">a)</td>
             <td class="center" style="text-align: center; font-weight: bold;">Đ</td>
             <td class="left" style="text-align: left;">Giải thích / trình bày lời giải chi tiết vì sao ý a) Đúng...</td>
           </tr>
           <tr>
             <td class="center" style="text-align: center; font-weight: bold;">b)</td>
             <td class="center" style="text-align: center; font-weight: bold;">S</td>
             <td class="left" style="text-align: left;">Giải thích / trình bày lời giải chi tiết vì sao ý b) Sai...</td>
           </tr>
           <tr>
             <td class="center" style="text-align: center; font-weight: bold;">c)</td>
             <td class="center" style="text-align: center; font-weight: bold;">Đ</td>
             <td class="left" style="text-align: left;">Giải thích / trình bày lời giải chi tiết vì sao ý c) Đúng...</td>
           </tr>
           <tr>
             <td class="center" style="text-align: center; font-weight: bold;">d)</td>
             <td class="center" style="text-align: center; font-weight: bold;">S</td>
             <td class="left" style="text-align: left;">Giải thích / trình bày lời giải chi tiết vì sao ý d) Sai...</td>
           </tr>
         </tbody>
       </table>
       *(Lặp lại đủ 4 dòng a, b, c, d cho mọi câu hỏi thuộc Phần II. TUYỆT ĐỐI KHÔNG bỏ sót bất kỳ đáp án nào trong 4 đáp án a, b, c, d và KHÔNG bỏ trống cột Hướng dẫn giải chi tiết).*

     - **ĐỐI VỚI PHẦN III (Trả lời ngắn - nếu có):**
       + Lập bảng gồm các cột: Câu | Đáp án | Hướng dẫn giải chi tiết.
     - **ĐỐI VỚI PHẦN IV (Tự luận - nếu có):**
       + Lập bảng Hướng dẫn chấm gồm các cột: Câu | Nội dung / Hướng dẫn giải chi tiết | Điểm.

  **NGUYÊN TẮC CHUNG (BẮT BUỘC TUÂN THỦ):**
  1. **⛔ CẤM TẠO PHẦN THỪA (QUAN TRỌNG NHẤT):** Đề thi CHỈ ĐƯỢC CHỨA các phần có trong WHITELIST ở trên: [${allowedParts.join(', ')}]. Nếu PHẦN IV (Tự luận) KHÔNG có trong whitelist → TUYỆT ĐỐI KHÔNG tạo câu tự luận, không tạo tiêu đề "PHẦN IV", không nhắc đến tự luận.
  2. **CÔNG THỨC TOÁN (BẮT BUỘC — vì đề sẽ được chuyển sang MathType trong Word):**
     - MỌI công thức và ký hiệu toán/lý/hoá PHẢI viết bằng LaTeX, bọc trong dấu $ ... $ (công thức trong dòng) hoặc $$ ... $$ (công thức đứng riêng một dòng).
     - TUYỆT ĐỐI KHÔNG dùng ký tự Unicode để thay cho công thức: không viết x², √x, ≤, ≥, ≠, ≈, π, a⁻¹, ½... Thay vào đó viết $x^2$, $\\sqrt{x}$, $\\le$, $\\ge$, $\\ne$, $\\approx$, $\\pi$, $a^{-1}$, $\\frac{1}{2}$.
     - QUY TẮC RANH GIỚI (chống dính chữ): công thức trong dòng $ ... $ PHẢI có đúng một dấu cách trước và sau dấu $. ĐÚNG: "Cho tam giác đều $ABC$ có cạnh $a$." SAI: "$ABC$.a)" hoặc "cạnh$a$".
     - Công thức $$ ... $$ PHẢI đứng trên dòng riêng: trước và sau nó luôn xuống dòng, KHÔNG nằm chung một đoạn văn với câu chữ.
     - KHÔNG đặt công thức trong khối code (code fence), KHÔNG thêm ký tự lạ quanh dấu $, KHÔNG được bỏ hoặc đổi dấu $.
     - Kết thúc: tự kiểm tra; nếu còn ký tự Unicode thay công thức hoặc còn công thức dính liền chữ thì sửa lại trước khi trả kết quả.
  3. **LƯU Ý MÔN HỌC:** Toàn bộ câu hỏi PHẢI thuộc phạm vi kiến thức môn ${inputData.subject} lớp ${inputData.grade}. KHÔNG được ra câu hỏi thuộc môn khác.
  4. **KIỂM TRA CUỐI CÙNG:** Trước khi trả output, hãy tự kiểm tra:
     - Đề thi có chứa phần nào KHÔNG nằm trong whitelist không? Nếu có → XÓA phần đó.
      - Phần Đáp án Đúng - Sai (Đ/S) đã có đủ bảng 4 đáp án (a, b, c, d) và bảng thông tin hướng dẫn giải chi tiết cho cả 4 ý chưa? Nếu chưa → BỔ SUNG đầy đủ.
  ${FIGURE_JSON_HTML_INSTRUCTIONS}
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
      config: createGeminiConfig({
        model,
        systemInstruction: getSystemInstruction(isUploadedMatrix),
        thinkingLevel: ThinkingLevel.MEDIUM,
        maxOutputTokens: 32768,
        temperature: 0.7,
      }),
    });
    const text = response.text || "Lỗi tạo đề thi.";
    const cleaned = text.replace(/^```html\s*/i, '').replace(/\s*```$/i, '');
    return { raw: wasTruncated(response) ? cleaned + TRUNCATION_MARKER : cleaned, contract, counts };
  });
};

/** Sửa đề theo danh sách lỗi cụ thể do bộ kiểm tra phát hiện (1 lần). */
export const repairStep3Exam = async (
  rawExamHtml: string,
  issues: ExamIssue[],
  inputData: InputData,
  structureBlock: string,
  isUploadedMatrix: boolean = false
): Promise<string> => {
  const prompt = `
  Đề kiểm tra (HTML) dưới đây của môn **${inputData.subject}** lớp **${inputData.grade}** (${inputData.examType}) đã được máy kiểm tra và phát hiện các lỗi cấu trúc sau:
  ${issues.map(i => `- ${i.message}`).join('\n  ')}

  ${structureBlock}

  **NHIỆM VỤ:** Trả về TOÀN BỘ đề đã sửa (Full HTML Document), sao cho hết các lỗi trên:
  - Giữ nguyên các câu đã đúng (nội dung, công thức LaTeX, các thẻ <script type="application/json" class="figure-json"> nếu có).
  - Bổ sung câu/ý/phương án còn thiếu, xoá câu/phần thừa, đánh số lại Câu 1, Câu 2… liên tục trong từng phần.
  - Cập nhật phần ĐÁP ÁN / HƯỚNG DẪN CHẤM cho khớp đề sau khi sửa.
  - Chỉ trả về HTML, không giải thích.

  **ĐỀ CẦN SỬA:**
  ${rawExamHtml.replace(TRUNCATION_MARKER, '')}
  `;
  return callWithFallback(async (ai, model) => {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: createGeminiConfig({
        model,
        systemInstruction: getSystemInstruction(isUploadedMatrix),
        thinkingLevel: ThinkingLevel.MEDIUM,
        maxOutputTokens: 32768,
        temperature: 0.2,
      }),
    });
    const text = (response.text || '').replace(/^```html\s*/i, '').replace(/\s*```$/i, '');
    return wasTruncated(response) ? text + TRUNCATION_MARKER : text;
  });
};

export interface ExamGenerationResult {
  html: string;
  issues: ExamIssue[];
  repaired: boolean;
  usedContract: boolean;
}

const issueScore = (issues: ExamIssue[]) => issues.reduce((s, i) => s + (i.severity === 'error' ? 10 : 1), 0);

/**
 * Sinh đề + KIỂM TRA HẬU SINH bằng code + tự sửa 1 lần nếu sai cấu trúc.
 * Trả về cả danh sách lỗi còn lại để giao diện hiển thị cho người dùng.
 */
export const generateStep3ExamChecked = async (
  specsContent: string,
  questionConfig: QuestionConfig,
  inputData: InputData,
  referenceText?: string,
  referenceImages?: { base64: string; mimeType: string }[],
  extractedQuestions?: ExtractedQuestion[],
  referenceMode: ReferenceUsageMode = 'exact',
  matrixContent?: string,
  isUploadedMatrix: boolean = false
): Promise<ExamGenerationResult> => {
  const args = [specsContent, questionConfig, inputData, referenceText, referenceImages, extractedQuestions, referenceMode, matrixContent, isUploadedMatrix] as const;
  let { raw, contract, counts } = await generateStep3ExamRaw(...args);
  // Ma trận tải lên mà không đọc được số liệu → không áp số câu (có thể sai), chỉ kiểm tra định dạng
  const expect = {
    counts: isUploadedMatrix && !contract ? null : { I: counts.type1, II: counts.type2, III: counts.type3, IV: counts.essay },
  };
  let issues = validateExamHtml(raw, expect);
  let repaired = false;

  if (hasBlockingIssues(issues)) {
    try {
      let candidate: string;
      if (issues.some(i => i.code === 'TRUNCATED')) {
        // Bị cắt do quá dài → sinh lại với lời giải ngắn gọn
        candidate = (await generateStep3ExamRaw(...args, { concise: true })).raw;
      } else {
        const block = contract
          ? buildContractStructureInstructions(contract)
          : expect.counts
            ? `Cấu trúc yêu cầu: ${QTYPES.filter(t => expect.counts![t] > 0).map(t => `Phần ${t} (${TYPE_LABEL[t]}): ${expect.counts![t]} câu`).join('; ')}. Không có phần nào khác.`
            : 'Cấu trúc yêu cầu: đúng như Ma trận / Bảng đặc tả đã cung cấp (đủ 4 phương án A–D cho Phần I, đủ 4 ý a–d cho Phần II, có đáp án).';
        candidate = await repairStep3Exam(raw, issues, inputData, block, isUploadedMatrix);
      }
      const candidateIssues = validateExamHtml(candidate, expect);
      if (issueScore(candidateIssues) < issueScore(issues)) {
        raw = candidate;
        issues = candidateIssues;
        repaired = true;
      }
    } catch (err) {
      console.warn('[ExamCraft] Tự sửa đề thất bại, giữ bản đầu tiên:', err);
    }
  }

  return { html: renderFiguresInHtml(raw.replace(TRUNCATION_MARKER, '')), issues, repaired, usedContract: !!contract };
};

/** Giữ API cũ: chỉ trả về HTML đề (đã kiểm tra + tự sửa). */
export const generateStep3Exam = async (
  ...args: Parameters<typeof generateStep3ExamChecked>
): Promise<string> => (await generateStep3ExamChecked(...args)).html;
