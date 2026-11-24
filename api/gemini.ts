/**
 * Vercel Edge Function Proxy — Giữ kho API key dự phòng NGẦM phía máy chủ (100% không lộ ra trình duyệt)
 *
 * Cách cấu hình trên Vercel:
 *   Project → Settings → Environment Variables → Thêm biến:
 *   GEMINI_API_KEYS = AIzaSyKey1,AIzaSyKey2,AIzaSyKey3,...
 *   (KHÔNG dùng tiền tố VITE_ để Vite tuyệt đối không đóng gói key vào JS trình duyệt)
 */

export const config = {
  runtime: 'edge',
};

const MODEL_ID_REGEX = /^gemini-[a-z0-9._-]+$/i;

const getServerKeys = (): string[] => {
  const raw =
    typeof process !== 'undefined' && process.env
      ? process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || ''
      : '';
  if (!raw) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(/[\r\n,;\s]+/)) {
    const clean = part
      .trim()
      .replace(/^['"`]+|['"`]+$/g, '')
      .replace(/^(?:(?:vite_)?(?:gemini_)?api[_-]?key|key)\s*[=:]\s*/i, '')
      .replace(/^['"`]+|['"`]+$/g, '');
    if (/^(?:AIza|AQ)\S{10,}$/.test(clean) && !seen.has(clean)) {
      seen.add(clean);
      keys.push(clean);
    }
  }
  return keys;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

export default async function handler(req: Request): Promise<Response> {
  const keys = getServerKeys();

  // Kiểm tra trạng thái kho key ngầm trên server (KHÔNG bao giờ trả về giá trị key)
  if (req.method === 'GET') {
    return jsonResponse({
      available: keys.length > 0,
      keyCount: keys.length,
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: { message: 'Method not allowed' } }, 405);
  }

  if (keys.length === 0) {
    return jsonResponse(
      { error: { code: 503, message: 'Server chưa cấu hình biến môi trường GEMINI_API_KEYS.' } },
      503
    );
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: { code: 400, message: 'Invalid JSON body' } }, 400);
  }

  const model = String(payload?.model || '').trim();
  if (!MODEL_ID_REGEX.test(model)) {
    return jsonResponse({ error: { code: 400, message: 'Invalid model ID' } }, 400);
  }

  const stream = Boolean(payload?.stream);
  const googleBody: Record<string, any> = {
    contents: payload.contents,
  };
  if (payload.systemInstruction) {
    googleBody.systemInstruction =
      typeof payload.systemInstruction === 'string'
        ? { parts: [{ text: payload.systemInstruction }] }
        : payload.systemInstruction;
  }
  if (payload.generationConfig && typeof payload.generationConfig === 'object') {
    googleBody.generationConfig = payload.generationConfig;
  }

  const endpoint = stream
    ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`
    : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  // Chọn điểm bắt đầu ngẫu nhiên để phân tải đều giữa nhiều người dùng đồng thời
  const startOffset = Math.floor(Math.random() * keys.length);
  let lastStatus = 502;
  let lastErrorText = JSON.stringify({ error: { message: 'Không thể kết nối Google AI.' } });

  for (let i = 0; i < keys.length; i++) {
    const key = keys[(startOffset + i) % keys.length];
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(googleBody),
      });

      if (upstream.ok) {
        if (stream) {
          return new Response(upstream.body, {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
            },
          });
        }
        const text = await upstream.text();
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      lastStatus = upstream.status;
      lastErrorText = await upstream.text();

      // Chỉ xoay sang server key tiếp theo khi lỗi liên quan key/quota (429, 401, 403)
      if (upstream.status === 429 || upstream.status === 401 || upstream.status === 403) {
        continue;
      }

      // Các lỗi 400/404/500/503 trả về luôn để client chuyển model fallback
      return new Response(lastErrorText, {
        status: lastStatus,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (err: any) {
      lastStatus = 502;
      lastErrorText = JSON.stringify({
        error: { code: 502, message: err?.message || 'Upstream fetch failed' },
      });
    }
  }

  return new Response(lastErrorText, {
    status: lastStatus,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
