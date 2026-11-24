// Google AI Studio key: "AIza..." (thường là "AIzaSy..."); Agent Platform/Express key: "AQ..."
export const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIza|AQ)\S{10,}$/;

// Làm sạch key người dùng dán vào: bỏ khoảng trắng, xuống dòng, dấu nháy, và tiền tố "key=" / "GEMINI_API_KEY=" thường bị copy kèm
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

export const maskGoogleAiApiKey = (key: string): string => {
  const trimmedKey = (key || '').trim();
  if (!trimmedKey || trimmedKey.length < 8) return '***';

  const prefix = trimmedKey.startsWith('AIzaSy')
    ? 'AIzaSy'
    : trimmedKey.startsWith('AQ')
      ? 'AQ'
      : trimmedKey.slice(0, 4);

  return `${prefix}...${trimmedKey.slice(-4)}`;
};
