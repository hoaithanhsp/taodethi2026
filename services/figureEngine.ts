import './engine/initMath';
import './engine/bbt.js';
import './engine/graph.js';
import './engine/geo3d.js';
import './engine/geo2d.js';
import './engine/export.js';

const g = typeof window !== 'undefined' ? (window as any) : (globalThis as any);

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeManualBbtSpec(spec: Record<string, any>): Record<string, any> {
  const rawXs: string[] = spec.xs || spec.x || ['-\\infty', '+\\infty'];
  const xs = rawXs.map((s) =>
    String(s)
      .replace(/^-oo$/i, '-\\infty')
      .replace(/^\+?oo$/i, '+\\infty')
  );
  const signs: string[] = (spec.signs || spec.dy || []).map(String);
  const rawYs: any[] = spec.ys || spec.y || [];

  const mapLevel = (lv: string): 'top' | 'bottom' | 'mid' => {
    const l = String(lv || '').toLowerCase();
    if (l === 'high' || l === 'top' || l === 'max') return 'top';
    if (l === 'low' || l === 'bottom' || l === 'min') return 'bottom';
    return 'mid';
  };

  const mapLabel = (lb: string): string =>
    String(lb ?? '')
      .replace(/^-oo$/i, '-\\infty')
      .replace(/^\+?oo$/i, '+\\infty');

  const ys = rawYs.map((item, idx) => {
    if (Array.isArray(item)) {
      return { label: mapLabel(item[0]), level: mapLevel(item[1]) };
    }
    if (item && typeof item === 'object') {
      if (item.pole) {
        return {
          pole: true,
          left: {
            label: mapLabel(item.left?.label ?? '-\\infty'),
            level: mapLevel(item.left?.level ?? 'bottom'),
          },
          right: {
            label: mapLabel(item.right?.label ?? '+\\infty'),
            level: mapLevel(item.right?.label ?? 'top'),
          },
        };
      }
      return {
        label: mapLabel(item.label ?? ''),
        level: mapLevel(item.level ?? (idx % 2 === 0 ? 'bottom' : 'top')),
      };
    }
    return {
      label: mapLabel(String(item)),
      level: idx % 2 === 0 ? 'bottom' : 'top',
    };
  });

  return { xs, signs, ys };
}

/**
 * Lọc bỏ các lệnh extra/marks tham chiếu tới các điểm không có trong đề bài (ví dụ điểm S, M bị AI copy nhầm từ mẫu)
 */
function filterExtraByContext(
  extra: string[] | undefined,
  marks: string[] | undefined,
  allowedPoints: Set<string>
): { extra: string[]; marks: string[] } {
  if (allowedPoints.size === 0) {
    return { extra: extra || [], marks: marks || [] };
  }

  const cleanExtra = (extra || []).filter((cmd) => {
    const parts = String(cmd).trim().split(/\s+/);
    const kw = parts[0]?.toLowerCase();
    if (kw === 'point') {
      const ptName = parts[1];
      if (!allowedPoints.has(ptName)) return false;
      // Kiểm tra các điểm tham chiếu bên trong biểu thức, vd midpoint(S,C)
      const upperTokens = String(cmd)
        .slice(parts[0].length + parts[1].length + 1)
        .match(/\b[A-Z]'?\b/g);
      if (upperTokens && upperTokens.some((tok) => !allowedPoints.has(tok))) {
        return false;
      }
      return true;
    }
    if (kw === 'segment' || kw === 'vector') {
      const p1 = parts[1];
      const p2 = parts[2];
      return allowedPoints.has(p1) && allowedPoints.has(p2);
    }
    return true;
  });

  const cleanMarks = (marks || []).filter((m) => {
    const parts = String(m).trim().split(/\s+/);
    if (parts[0]?.toLowerCase() === 'rightangle') {
      return (
        allowedPoints.has(parts[1]) &&
        allowedPoints.has(parts[2]) &&
        allowedPoints.has(parts[3])
      );
    }
    return true;
  });

  return { extra: cleanExtra, marks: cleanMarks };
}

/**
 * Trích xuất thông số bài toán phương hướng / tàu thuyền từ câu dẫn tiếng Việt
 */
function extractNavigationParamsFromText(ctx: string): Record<string, any> | null {
  const hasNavKeywords =
    /(đông\s+bắc|đông\s+nam|tây\s+bắc|tây\s+nam|hướng\s+bắc|hướng\s+nam|tàu\s+cá|tàu\s+thủy|thuyền|xuất\s+phát\s+từ\s+cảng)/i.test(
      ctx
    );
  if (!hasNavKeywords) return null;

  // Tìm khoảng cách (km, m, hải lý)
  const distMatches = [...ctx.matchAll(/(\d+(?:[.,]\d+)?)\s*(km|hải\s*lý|m\b)/gi)];
  const ab = distMatches[0] ? Number(distMatches[0][1].replace(',', '.')) : 20;
  const unit1 = distMatches[0] ? distMatches[0][2] : 'km';
  const bc = distMatches[1] ? Number(distMatches[1][1].replace(',', '.')) : 30;
  const unit2 = distMatches[1] ? distMatches[1][2] : unit1;

  // Tìm góc độ (° hoặc \circ)
  const angleMatches = [...ctx.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:°|\\circ|\^\{\\circ\}|độ)/gi)];
  const deg1 = angleMatches[0] ? Number(angleMatches[0][1].replace(',', '.')) : 45;
  const deg2 = angleMatches[1] ? Number(angleMatches[1][1].replace(',', '.')) : 30;

  let bearingAB = `N${deg1}E`;
  if (/tây\s+bắc/i.test(ctx.split(/sau\s+đó/i)[0] || '')) bearingAB = `N${deg1}W`;
  else if (/đông\s+nam/i.test(ctx.split(/sau\s+đó/i)[0] || '')) bearingAB = `S${deg1}E`;
  else if (/tây\s+nam/i.test(ctx.split(/sau\s+đó/i)[0] || '')) bearingAB = `S${deg1}W`;

  const secondPart = ctx.split(/sau\s+đó/i)[1] || ctx;
  let bearingBC = `S${deg2}E`;
  if (/đông\s+bắc/i.test(secondPart)) bearingBC = `N${deg2}E`;
  else if (/tây\s+bắc/i.test(secondPart)) bearingBC = `N${deg2}W`;
  else if (/tây\s+nam/i.test(secondPart)) bearingBC = `S${deg2}W`;

  return {
    ab,
    bc,
    bearingAB,
    bearingBC,
    labelAB: `${ab} ${unit1}`,
    labelBC: `${bc} ${unit2}`,
    labelAC: '?',
  };
}

/**
 * Kiểm tra ngữ nghĩa và tự động sửa lỗi khi AI sinh nhầm hình 3D (chóp S.ABC, S.ABCD)
 * cho bài toán Hình học phẳng 2D (tam giác ABC, hình bình hành ABCD, bài toán tàu thuyền...).
 */
export function sanitizeAndValidateFigureSpec(
  rawSpec: Record<string, any>,
  contextHtml?: string
): Record<string, any> | null {
  if (!rawSpec || typeof rawSpec !== 'object') return null;

  const spec = { ...rawSpec };
  const ctx = contextHtml ? stripHtmlTags(contextHtml) : '';

  // Tập hợp các tên điểm viết hoa (A, B, C, D, S, O, M, N, H, I, K, G, P, Q...) xuất hiện trong đề bài
  const pointsInContext = new Set<string>();
  if (ctx.length > 10) {
    // Tách cả cụm điểm như ABCD, ABC, S.ABCD, A'B'C'D'
    const pointGroups: string[] = ctx.match(/\b(?:[A-Z]'?\.?)+\b/g) || [];
    pointGroups.forEach((grp: string) => {
      const tokens: string[] = grp.match(/[A-Z]'?/g) || [];
      tokens.forEach((t: string) => pointsInContext.add(t));
    });
  }

  const is3DContext =
    /(hình\s+chóp|khối\s+chóp|tứ\s+diện|lăng\s+trụ|hình\s+hộp|lập\s+phương|hình\s+nón|khối\s+nón|hình\s+trụ|khối\s+trụ|mặt\s+cầu|khối\s+cầu|đa\s+diện|không\s+gian|Oxyz|mặt\s+phẳng|\bS\.[A-Z]{3,4}\b)/i.test(
      ctx
    );

  const type = String(spec.type || '').toLowerCase();

  // Nếu AI khai báo geo3d nhưng đề bài KHÔNG phải bài toán không gian 3D (hoặc đề bài không hề có đỉnh S)
  if (
    type === 'geo3d' ||
    (!type &&
      /^(pyramid|tetra|prism|box|cube|cone|cylinder|sphere)/i.test(String(spec.preset || '')))
  ) {
    const preset = String(spec.preset || '').toLowerCase();
    const needsApexS = preset.startsWith('pyramid') || preset === 'cone';
    const hasPointSInCtx = pointsInContext.size === 0 || pointsInContext.has('S');

    if (ctx.length > 10 && (!is3DContext || (needsApexS && !hasPointSInCtx))) {
      // 1. Kiểm tra nếu là bài toán phương hướng / tàu thuyền đi từ A -> B -> C
      const navParams = extractNavigationParamsFromText(ctx);
      if (navParams) {
        return {
          type: 'geo2d',
          preset: 'navigation',
          params: navParams,
        };
      }

      // 2. Kiểm tra nếu là hình bình hành / hình chữ nhật / hình vuông / hình thoi / hình thang 2D
      const hasCenterO = /\btâm\s+O\b/i.test(ctx) || pointsInContext.has('O');
      if (/hình\s+bình\s+hành/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return {
          type: 'geo2d',
          preset: 'parallelogram',
          params: { ...(spec.params || {}), center: hasCenterO },
          extra,
          marks,
        };
      }
      if (/hình\s+chữ\s+nhật/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return {
          type: 'geo2d',
          preset: 'rectangle',
          params: { ...(spec.params || {}), center: hasCenterO },
          extra,
          marks,
        };
      }
      if (/hình\s+vuông/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return {
          type: 'geo2d',
          preset: 'square',
          params: { ...(spec.params || {}), center: hasCenterO },
          extra,
          marks,
        };
      }
      if (/hình\s+thoi/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return {
          type: 'geo2d',
          preset: 'rhombus',
          params: { ...(spec.params || {}), center: hasCenterO },
          extra,
          marks,
        };
      }
      if (/hình\s+thang\s+vuông/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return { type: 'geo2d', preset: 'trapezoid-right', params: spec.params || {}, extra, marks };
      }
      if (/hình\s+thang/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return { type: 'geo2d', preset: 'trapezoid', params: spec.params || {}, extra, marks };
      }

      // 3. Kiểm tra nếu là tam giác phẳng 2D (tam giác vuông, đều, cân, thường)
      if (/tam\s+giác\s+vuông/i.test(ctx)) {
        const rightMatch = ctx.match(/vuông\s+tại\s+\$?([A-C])\$?/i);
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return {
          type: 'geo2d',
          preset: 'triangle-right',
          params: { ...(spec.params || {}), rightAt: rightMatch ? rightMatch[1] : 'A' },
          extra,
          marks,
        };
      }
      if (/tam\s+giác\s+đều/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return { type: 'geo2d', preset: 'triangle-equil', params: spec.params || {}, extra, marks };
      }
      if (/tam\s+giác\s+cân/i.test(ctx)) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return { type: 'geo2d', preset: 'triangle-iso', params: spec.params || {}, extra, marks };
      }
      if (/tam\s+giác/i.test(ctx) || (pointsInContext.has('A') && pointsInContext.has('B') && pointsInContext.has('C') && !pointsInContext.has('D'))) {
        const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
        return { type: 'geo2d', preset: 'triangle', params: spec.params || {}, extra, marks };
      }

      // Nếu không nhận diện được hình phẳng nào tương ứng mà lại dùng hình 3D sai → bỏ qua không vẽ hình sai
      return null;
    }

    // Nếu thực sự là bài toán 3D, vẫn lọc bỏ các điểm phụ không tồn tại trong đề bài (vd điểm M copy từ mẫu)
    if (pointsInContext.size >= 3) {
      const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
      spec.extra = extra;
      spec.marks = marks;
    }
  }

  // Nếu là geo2d và đề bài là bài toán phương hướng tàu thuyền nhưng AI chỉ truyền triangle đơn giản
  if (type === 'geo2d' && ctx.length > 10) {
    const navParams = extractNavigationParamsFromText(ctx);
    if (navParams && (!spec.preset || spec.preset === 'triangle')) {
      return {
        type: 'geo2d',
        preset: 'navigation',
        params: { ...navParams, ...(spec.params || {}) },
      };
    }
    if (pointsInContext.size >= 3) {
      const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
      spec.extra = extra;
      spec.marks = marks;
    }
  }

  return spec;
}

/**
 * Chuyển đổi cấu hình JSON (chuỗi hoặc object) thành mã SVG chuẩn SGK
 * Hỗ trợ 4 loại:
 *  - type: "bbt"   (Bảng biến thiên chuẩn SGK kiểu tkz-tab, tự tính đạo hàm/cực trị/tiệm cận bằng mathjs)
 *  - type: "graph" (Đồ thị hàm số, tiệm cận đứng/ngang/xiên, điểm cực trị, miền tô tích phân)
 *  - type: "geo2d" (Hình học phẳng 2D: tam giác, hình bình hành, hình chữ nhật, hình vuông, phương hướng...)
 *  - type: "geo3d" (Hình học không gian 3D chiếu song song, tự xác định nét đứt/nét liền)
 */
export function renderFigureSpecToSvg(
  specInput: string | Record<string, any>,
  contextHtml?: string
): string {
  try {
    let rawSpec: Record<string, any>;
    if (typeof specInput === 'string') {
      const cleaned = decodeHtmlEntities(specInput.trim())
        .replace(/^```(?:figure-json|json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      rawSpec = JSON.parse(cleaned);
    } else {
      rawSpec = specInput;
    }

    const spec = sanitizeAndValidateFigureSpec(rawSpec, contextHtml);
    if (!spec || typeof spec !== 'object') {
      return '';
    }

    const type = String(spec.type || '').toLowerCase();

    if (type === 'bbt') {
      if (spec.fn && typeof spec.fn === 'string') {
        const analyzed = g.BBT.analyzeFunction(spec.fn);
        return g.BBT.renderBBT(analyzed);
      }
      const manual = normalizeManualBbtSpec(spec);
      return g.BBT.renderBBT(manual);
    }

    if (type === 'graph') {
      return g.Graph.renderGraph(spec);
    }

    if (type === 'geo2d') {
      return g.Geo2D.renderGeo2D(spec);
    }

    if (type === 'geo3d') {
      return g.Geo3D.renderGeo3D(spec);
    }

    // Tự nhận diện nếu thiếu trường type
    const preset = String(spec.preset || '').toLowerCase();
    if (
      /^(triangle|parallelogram|rectangle|square|rhombus|trapezoid|circle|navigation)/i.test(
        preset
      )
    ) {
      return g.Geo2D.renderGeo2D({ ...spec, type: 'geo2d' });
    }
    if (spec.preset || spec.points || spec.extra) {
      return g.Geo3D.renderGeo3D({ ...spec, type: 'geo3d' });
    }
    if (spec.fn && (spec.xRange || spec.yRange || spec.asymptotes || spec.shade)) {
      return g.Graph.renderGraph({ ...spec, type: 'graph' });
    }
    if (spec.fn) {
      const analyzed = g.BBT.analyzeFunction(spec.fn);
      return g.BBT.renderBBT(analyzed);
    }

    return '';
  } catch (err: any) {
    console.warn('[FigureEngine] Không thể vẽ hình từ JSON:', err?.message || err, specInput);
    return '';
  }
}

/**
 * Lấy ngữ cảnh câu hỏi nằm ngay trước khối hình vẽ để đối chiếu tính hợp lệ
 */
function extractPrecedingQuestionContext(fullText: string, matchOffset: number): string {
  const before = fullText.slice(Math.max(0, matchOffset - 600), matchOffset);
  // Tìm từ vị trí "Câu X" gần nhất trước hình vẽ
  const cauMatches = [...before.matchAll(/(?:Câu\s+\d+|Bài\s+\d+)/gi)];
  if (cauMatches.length > 0) {
    const lastCau = cauMatches[cauMatches.length - 1];
    return before.slice(lastCau.index ?? 0);
  }
  return before;
}

/**
 * Tìm và thay thế mọi khối cấu hình hình vẽ (`figure-json`) trong chuỗi HTML hoặc Markdown
 * bằng thẻ `<div class="figure-svg-container"><svg>...</svg></div>`.
 */
export function renderFiguresInHtml(content: string): string {
  if (!content) return content;

  let out = content;

  const wrapSvg = (svg: string) =>
    `<div class="figure-svg-container" style="text-align: center; margin: 10pt auto; page-break-inside: avoid;">${svg}</div>`;

  // 1. <script type="application/json" class="figure-json">...</script>
  out = out.replace(
    /<script[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi,
    (_full, jsonBody, offset) => {
      const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
      const svg = renderFigureSpecToSvg(jsonBody, ctx);
      return svg ? wrapSvg(svg) : '';
    }
  );

  // 2. <pre><code class="language-figure-json">...</code></pre> (do markdown-it sinh ra)
  out = out.replace(
    /<pre[^>]*>\s*<code[^>]*class=["'][^"']*language-figure-json[^"']*["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_full, jsonBody, offset) => {
      const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
      const svg = renderFigureSpecToSvg(jsonBody, ctx);
      return svg ? wrapSvg(svg) : '';
    }
  );

  // 3. <div class="figure-json">...</div> hoặc <pre class="figure-json">...</pre>
  out = out.replace(
    /<(div|pre)[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
    (_full, _tag, jsonBody, offset) => {
      const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
      const svg = renderFigureSpecToSvg(jsonBody, ctx);
      return svg ? wrapSvg(svg) : '';
    }
  );

  // 4. Khối ```figure-json ... ``` còn sót trong HTML/text
  out = out.replace(/```figure-json\s*([\s\S]*?)```/gi, (_full, jsonBody, offset) => {
    const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
    const svg = renderFigureSpecToSvg(jsonBody, ctx);
    return svg ? wrapSvg(svg) : '';
  });

  return out;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được Blob PNG'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Chuyển toàn bộ thẻ <svg>...</svg> trong HTML sang thẻ <img src="data:image/png;base64,..." />
 * độ phân giải 300 DPI để nhúng trực tiếp vào file Word (.docx).
 */
export async function convertSvgsToPngInHtml(html: string, dpi = 300): Promise<string> {
  if (!html || !html.includes('<svg')) return html;

  const withSvgs = renderFiguresInHtml(html);

  const svgRegex = /<svg\b[\s\S]*?<\/svg>/gi;
  const matches = withSvgs.match(svgRegex);
  if (!matches || matches.length === 0) return withSvgs;

  let result = withSvgs;
  for (const svgStr of matches) {
    try {
      const { blob, width, height } = await g.FigExport.svgToPngBlob(svgStr, dpi);
      const dataUrl = await blobToDataUrl(blob);
      const maxDocWidth = 460;
      const scale = width > maxDocWidth ? maxDocWidth / width : 0.88;
      const dispW = Math.round(width * scale);
      const dispH = Math.round(height * scale);
      const imgTag = `<img src="${dataUrl}" width="${dispW}" height="${dispH}" style="display: block; margin: 8pt auto; max-width: 100%;" alt="Hình minh họa" />`;
      result = result.replace(svgStr, imgTag);
    } catch (err) {
      console.warn('[FigureEngine] Lỗi chuyển SVG sang PNG cho Word:', err);
    }
  }

  return result;
}

/**
 * Tách toàn bộ khối figure-json và thẻ <svg> ra thành placeholder an toàn
 * trước khi chạy markdown-it và normalizeMathForWord, sau đó chuyển thành ảnh PNG 300 DPI
 * để nhúng vào Word (.docx).
 */
export function extractFiguresToPlaceholders(content: string): {
  text: string;
  figures: Array<{ kind: 'json' | 'svg'; payload: string; context?: string }>;
} {
  if (!content) return { text: content, figures: [] };

  const figures: Array<{ kind: 'json' | 'svg'; payload: string; context?: string }> = [];
  const makePh = (kind: 'json' | 'svg', payload: string, offset: number, src: string) => {
    const idx = figures.length;
    const context = extractPrecedingQuestionContext(src, offset);
    figures.push({ kind, payload, context });
    return `\n\n<div data-fig-ph="${idx}"></div>\n\n`;
  };

  let out = content;

  // 1. <script type="application/json" class="figure-json">...</script>
  out = out.replace(
    /<script[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi,
    (_full, jsonBody, offset) => makePh('json', jsonBody, Number(offset) || 0, out)
  );

  // 2. ```figure-json ... ```
  out = out.replace(/```figure-json\s*([\s\S]*?)```/gi, (_full, jsonBody, offset) =>
    makePh('json', jsonBody, Number(offset) || 0, out)
  );

  // 3. <div class="figure-json">...</div> hoặc <pre class="figure-json">...</pre>
  out = out.replace(
    /<(div|pre)[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
    (_full, _tag, jsonBody, offset) => makePh('json', jsonBody, Number(offset) || 0, out)
  );

  // 4. Thẻ <svg>...</svg> có sẵn
  out = out.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svgStr, offset) =>
    makePh('svg', svgStr, Number(offset) || 0, out)
  );

  return { text: out, figures };
}

export async function restoreFiguresAsPngForWord(
  html: string,
  figures: Array<{ kind: 'json' | 'svg'; payload: string; context?: string }>,
  dpi = 300
): Promise<string> {
  if (!html || figures.length === 0) return html;

  let out = html;
  for (let i = 0; i < figures.length; i++) {
    const item = figures[i];
    const svgStr =
      item.kind === 'json'
        ? renderFigureSpecToSvg(item.payload, item.context)
        : item.payload;
    let replacement = '';
    if (svgStr && svgStr.startsWith('<svg')) {
      try {
        const { blob, width, height } = await g.FigExport.svgToPngBlob(svgStr, dpi);
        const dataUrl = await blobToDataUrl(blob);
        const maxDocWidth = 450;
        const scale = width > maxDocWidth ? maxDocWidth / width : 0.88;
        const dispW = Math.round(width * scale);
        const dispH = Math.round(height * scale);
        replacement = `<div style="text-align: center; margin: 8pt auto; page-break-inside: avoid;"><img src="${dataUrl}" width="${dispW}" height="${dispH}" style="display: block; margin: 0 auto; max-width: 100%;" alt="Hình minh họa" /></div>`;
      } catch (err) {
        console.warn('[FigureEngine] Lỗi chuyển SVG sang PNG cho Word:', err);
        replacement = `<div style="text-align: center; margin: 8pt auto;">${svgStr}</div>`;
      }
    }
    const phRegex = new RegExp(`<div\\s+data-fig-ph=["']${i}["']\\s*><\\/div>`, 'gi');
    out = out.replace(phRegex, replacement);
  }

  return out;
}

export async function downloadSvgAsPng(
  svgEl: SVGElement | string,
  filename = 'hinh-ve.png'
): Promise<void> {
  if (g.FigExport && g.FigExport.downloadPNG) {
    await g.FigExport.downloadPNG(svgEl, filename);
  }
}

/**
 * Hướng dẫn prompt chuẩn cho AI sinh hình vẽ tự động bằng JSON tất định
 * (dùng cho cả chế độ HTML CV 7991 và chế độ Markdown Đề tương tự / Biến thể)
 */
export const FIGURE_JSON_HTML_INSTRUCTIONS = `
   ================================================================
   QUY TẮC VẼ HÌNH MINH HỌA TỰ ĐỘNG (KHỚP 100% YÊU CẦU BÀI TOÁN)
   ================================================================
   Ứng dụng tích hợp BỘ VẼ HÌNH TẤT ĐỊNH 4 ENGINE: Bảng biến thiên (\`bbt\`), Đồ thị (\`graph\`), Hình phẳng 2D (\`geo2d\`), và Hình không gian 3D (\`geo3d\`).

   ⛔ **3 NGUYÊN TẮC SỐNG CÒN (TUYỆT ĐỐI TUÂN THỦ):**
   1. **CHỈ VẼ KHI CẦN THIẾT VÀ KHỚP 100% ĐỀ BÀI:**
      - Chỉ nhúng \`<script type="application/json" class="figure-json">...</script>\` khi câu hỏi thực sự cần hình minh họa trực quan (ví dụ: câu hỏi đọc Bảng biến thiên, đọc Đồ thị hàm số, bài toán Hình học có hình minh họa).
      - Nếu câu hỏi chỉ hỏi lý thuyết/đẳng thức đại số đơn giản không cần hình thì **KHÔNG chèn hình**.
   2. **CẤM TUYỆT ĐỐI VẼ HÌNH 3D (\`geo3d\`) CHO BÀI TOÁN PHẲNG 2D:**
      - Bài toán Hình học phẳng 2D (tam giác $ABC$, giải tam giác, tàu thuyền đi từ $A \\to B \\to C$, hình bình hành $ABCD$, hình chữ nhật, hình vuông, hình thang, đường tròn, vectơ phẳng - đặc biệt ở **Toán 10**) **BẮT BUỘC dùng \`"type": "geo2d"\`**.
      - **TUYỆT ĐỐI CẤM** dùng \`"type": "geo3d"\` hay \`"pyramid-tri"\` / \`"pyramid-square"\` (sẽ tự sinh ra đỉnh chóp $S$ sai lệch hoàn toàn đề bài!) cho bài toán mặt phẳng 2D!
   3. **ĐÚNG TÊN ĐIỂM & ĐÚNG SỐ LIỆU:**
      - Không bao giờ copy nguyên xi điểm phụ (như điểm $M$, điểm $S$) hay hàm số trong ví dụ mẫu nếu đề bài không có các điểm/hàm số đó. Mọi đỉnh, cạnh, hàm số trong JSON phải khớp chính xác 100% với câu hỏi.

   --- CÚ PHÁP 4 LOẠI HÌNH ---

   1. **HÌNH HỌC PHẲNG 2D (\`type: "geo2d"\` — Dùng cho Tam giác, Tứ giác, Vectơ phẳng, Bài toán thực tế đo đạc/tàu thuyền):**
      - Các \`preset\` 2D hỗ trợ:
        + \`"triangle"\` (tam giác thường, truyền độ dài \`params: {"ab": 20, "bc": 30, "angleB": 105}\` hoặc \`{"a": 5, "b": 6, "c": 7}\`)
        + \`"triangle-right"\` (tam giác vuông, \`params: {"rightAt": "A", "ab": 3, "ac": 4}\`)
        + \`"triangle-iso"\` (tam giác cân tại A), \`"triangle-equil"\` (tam giác đều)
        + \`"parallelogram"\` (hình bình hành $ABCD$, thêm \`"center": true\` nếu đề bài có tâm $O$)
        + \`"rectangle"\` (hình chữ nhật $ABCD$), \`"square"\` (hình vuông $ABCD$), \`"rhombus"\` (hình thoi $ABCD$), \`"trapezoid"\` (hình thang), \`"trapezoid-right"\` (hình thang vuông), \`"circle"\` (đường tròn tâm $O$).
        + \`"navigation"\` (bài toán thực tế tàu thuyền đi từ $A \\to B \\to C$ theo hướng Đông-Bắc / Đông-Nam...):
          <script type="application/json" class="figure-json">
          {"type": "geo2d", "preset": "navigation", "params": {"ab": 20, "bc": 30, "bearingAB": "N45E", "bearingBC": "S30E", "labelAB": "20 km", "labelBC": "30 km", "labelAC": "?"}}
          </script>
      - Ví dụ hình bình hành $ABCD$ tâm $O$ (2D phẳng, không có đỉnh $S$):
        <script type="application/json" class="figure-json">
        {"type": "geo2d", "preset": "parallelogram", "params": {"center": true}}
        </script>

   2. **BẢNG BIẾN THIÊN (\`type: "bbt"\` — Dùng cho Khảo sát hàm số Lớp 12):**
      - Truyền đúng biểu thức hàm số \`fn\` của câu hỏi:
        <script type="application/json" class="figure-json">
        {"type": "bbt", "fn": "x^3 - 3*x^2 + 2"}
        </script>

   3. **ĐỒ THỊ HÀM SỐ & MIỀN TÍCH PHÂN (\`type: "graph"\`):**
      - Truyền đúng biểu thức hàm số \`fn\` của câu hỏi:
        <script type="application/json" class="figure-json">
        {"type": "graph", "fn": ["(2*x+1)/(x-1)"], "xRange": [-4, 5], "yRange": [-4, 7], "asymptotes": "auto", "points": "extrema+intercepts"}
        </script>

   4. **HÌNH HỌC KHÔNG GIAN 3D (\`type: "geo3d"\` — CHỈ dùng khi đề bài nêu rõ Hình chóp, Lăng trụ, Hình hộp, Tứ diện, Nón, Trụ, Cầu, Oxyz):**
      - Các \`preset\` 3D: \`"pyramid-tri"\`, \`"pyramid-square"\`, \`"pyramid-rect"\` (thêm \`"apexOver": "A"\` nếu $SA \\perp$ đáy), \`"tetra-right"\`, \`"prism-tri"\`, \`"box"\`, \`"cube"\`, \`"cone"\`, \`"cylinder"\`, \`"sphere"\`.
      - Chỉ khai báo trong \`extra\` các điểm thực sự có trong đề bài:
        <script type="application/json" class="figure-json">
        {"type": "geo3d", "preset": "pyramid-square", "params": {"a": 2, "h": 2.6}, "extra": ["point O center(ABCD)", "segment S O", "segment A C", "segment B D"], "marks": ["rightangle S O B"]}
        </script>
`;

export const FIGURE_JSON_MARKDOWN_INSTRUCTIONS = `
================================================================
QUY TẮC VẼ HÌNH MINH HỌA TỰ ĐỘNG (KHỚP 100% YÊU CẦU BÀI TOÁN)
================================================================
Khi câu hỏi thực sự cần hình minh họa trực quan, chèn khối code \`\`\`figure-json ... \`\`\` ngay dưới câu dẫn.
⛔ **LƯU Ý BẮT BUỘC:**
- **TUYỆT ĐỐI KHÔNG** dùng \`"type": "geo3d"\` (hình chóp có đỉnh $S$) cho bài toán Hình học phẳng 2D (tam giác $ABC$, hình bình hành $ABCD$, vectơ phẳng, bài toán tàu thuyền đi từ $A \\to B \\to C$). Bài toán phẳng 2D bắt buộc dùng \`"type": "geo2d"\`.
- Mọi tên điểm, số đo cạnh/góc và hàm số trong JSON phải khớp chính xác 100% với nội dung câu hỏi (không chép lại điểm thừa từ ví dụ mẫu).

1. **Hình học phẳng 2D (\`type: "geo2d"\` — Tam giác, Hình bình hành, Hình chữ nhật, Phương hướng tàu thuyền):**
\`\`\`figure-json
{"type": "geo2d", "preset": "navigation", "params": {"ab": 20, "bc": 30, "bearingAB": "N45E", "bearingBC": "S30E", "labelAB": "20 km", "labelBC": "30 km", "labelAC": "?"}}
\`\`\`
Hoặc hình bình hành $ABCD$ tâm $O$:
\`\`\`figure-json
{"type": "geo2d", "preset": "parallelogram", "params": {"center": true}}
\`\`\`

2. **Bảng biến thiên (\`type: "bbt"\`):**
\`\`\`figure-json
{"type": "bbt", "fn": "x^3 - 3*x^2 + 2"}
\`\`\`

3. **Đồ thị hàm số & miền tích phân (\`type: "graph"\`):**
\`\`\`figure-json
{"type": "graph", "fn": ["(2*x+1)/(x-1)"], "xRange": [-4, 5], "yRange": [-4, 7], "asymptotes": "auto", "points": "extrema+intercepts"}
\`\`\`

4. **Hình học không gian 3D (\`type: "geo3d"\` — CHỈ dùng cho Hình chóp, Lăng trụ, Hình hộp, Tứ diện, Nón, Trụ, Cầu):**
\`\`\`figure-json
{"type": "geo3d", "preset": "pyramid-square", "params": {"a": 2, "h": 2.6}, "extra": ["point O center(ABCD)", "segment S O", "segment A C", "segment B D"], "marks": ["rightangle S O B"]}
\`\`\`
`;
