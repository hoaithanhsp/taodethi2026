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

export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function encodeBase64Utf8(str: string): string {
  try {
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
      return window.btoa(unescape(encodeURIComponent(str)));
    }
  } catch {
    // ignore
  }
  return encodeURIComponent(str);
}

function decodeBase64Utf8(encoded: string): string {
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function' && !encoded.includes('%')) {
      return decodeURIComponent(escape(window.atob(encoded)));
    }
  } catch {
    // ignore
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function normalizeManualBbtSpec(spec: Record<string, any>): Record<string, any> {
  const rawXs: string[] = spec.xs || spec.x || ['-\\infty', '+\\infty'];
  const xs = rawXs.map((s) =>
    String(s)
      .replace(/^\$+|\$+$/g, '')
      .trim()
      .replace(/^-\s*oo$/i, '-\\infty')
      .replace(/^\+?\s*oo$/i, '+\\infty')
      .replace(/^∞$/, '+\\infty')
      .replace(/^[−-]∞$/, '-\\infty')
  );
  const signs: string[] = (spec.signs || spec.dy || []).map((s: any) =>
    String(s)
      .replace(/^\$+|\$+$/g, '')
      .trim()
      .replace(/^−$/, '-')
  );
  const rawYs: any[] = spec.ys || spec.y || [];

  const mapLevel = (lv: string): 'top' | 'bottom' | 'mid' => {
    const l = String(lv || '').toLowerCase();
    if (l === 'high' || l === 'top' || l === 'max') return 'top';
    if (l === 'low' || l === 'bottom' || l === 'min') return 'bottom';
    return 'mid';
  };

  const mapLabel = (lb: string): string =>
    String(lb ?? '')
      .replace(/^\$+|\$+$/g, '')
      .trim()
      .replace(/^-\s*oo$/i, '-\\infty')
      .replace(/^\+?\s*oo$/i, '+\\infty')
      .replace(/^∞$/, '+\\infty')
      .replace(/^[−-]∞$/, '-\\infty');

  const inferLevelAt = (idx: number): 'top' | 'bottom' | 'mid' => {
    const sBefore = idx > 0 ? signs[2 * idx - 2] : undefined;
    const sAfter = idx < xs.length - 1 ? signs[2 * idx] : undefined;
    if (idx === 0) return sAfter === '-' ? 'top' : 'bottom';
    if (idx === xs.length - 1) return sBefore === '+' ? 'top' : 'bottom';
    if (sBefore === '+' && sAfter === '-') return 'top';
    if (sBefore === '-' && sAfter === '+') return 'bottom';
    return idx % 2 === 0 ? 'bottom' : 'top';
  };

  const ys = rawYs.map((item, idx) => {
    const isPoleSign = idx > 0 && idx < xs.length - 1 && signs[2 * idx - 1] === '||';
    if (Array.isArray(item)) {
      if (isPoleSign && item.length >= 2 && !['top', 'bottom', 'mid', 'high', 'low', 'max', 'min'].includes(String(item[1]).toLowerCase())) {
        const sBefore = signs[2 * idx - 2];
        const sAfter = signs[2 * idx];
        return {
          pole: true,
          left: { label: mapLabel(item[0]), level: sBefore === '+' ? 'top' : 'bottom' },
          right: { label: mapLabel(item[1]), level: sAfter === '+' ? 'bottom' : 'top' },
        };
      }
      return {
        label: mapLabel(item[0]),
        level: item[1] ? mapLevel(item[1]) : inferLevelAt(idx),
      };
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
            level: mapLevel(item.right?.level ?? 'top'),
          },
        };
      }
      return {
        label: mapLabel(item.label ?? ''),
        level: item.level ? mapLevel(item.level) : inferLevelAt(idx),
      };
    }
    return {
      label: mapLabel(String(item)),
      level: inferLevelAt(idx),
    };
  });

  return { xs, signs, ys };
}

/**
 * Chuyển đổi bảng HTML `<table class="bbt-table">...</table>` thành spec chuẩn của BBT Engine
 */
export function parseHtmlBbtTableToSpec(tableHtml: string): Record<string, any> | null {
  try {
    const trMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (trMatches.length < 3) return null;

    const rows: string[][] = trMatches.map((m) => {
      const cells = [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)];
      return cells.map((c) => {
        let txt = decodeHtmlEntities(stripHtmlTags(c[1]));
        txt = txt
          .replace(/^\$+|\$+$/g, '')
          .replace(/\\(?:nearrow|searrow|rightarrow|leftarrow|uparrow|downarrow)/g, '')
          .replace(/[↗↘→←↑↓]/g, '')
          .trim();
        return txt;
      });
    });

    const isLabelCell = (val: string) => /^(?:x|y'|y|f'\s*\(\s*x\s*\)|f\s*\(\s*x\s*\)|g'\s*\(\s*x\s*\)|g\s*\(\s*x\s*\))$/i.test(val.replace(/^\$+|\$+$/g, '').trim());

    const rowX = isLabelCell(rows[0][0] || '') ? rows[0].slice(1) : rows[0];
    const rowD = isLabelCell(rows[1][0] || '') ? rows[1].slice(1) : rows[1];
    const rowY1 = isLabelCell(rows[2][0] || '') ? rows[2].slice(1) : rows[2];
    const rowY2 = rows[3] ? (isLabelCell(rows[3][0] || '') ? rows[3].slice(1) : rows[3]) : null;

    // Xác định các cột có mốc x
    const xCols: Array<{ col: number; val: string }> = [];
    rowX.forEach((cell, col) => {
      if (cell) xCols.push({ col, val: cell });
    });
    if (xCols.length < 2) return null;

    const xs = xCols.map((c) => c.val);
    const signs: string[] = [];

    for (let i = 0; i < xCols.length - 1; i++) {
      const c1 = xCols[i].col;
      const c2 = xCols[i + 1].col;
      let intervalSign = '+';
      for (let c = c1; c <= c2; c++) {
        const v = (rowD[c] || '').replace(/−/g, '-').trim();
        if (v === '+' || v === '-') {
          intervalSign = v;
          break;
        }
      }
      signs.push(intervalSign);

      if (i < xCols.length - 2) {
        const ptCol = xCols[i + 1].col;
        const ptVal = (rowD[ptCol] || '').trim();
        if (ptVal === '||' || ptVal.includes('||')) signs.push('||');
        else signs.push('0');
      }
    }

    const ys: any[] = [];
    for (let i = 0; i < xCols.length; i++) {
      const col = xCols[i].col;
      const isPole = i > 0 && i < xCols.length - 1 && signs[2 * i - 1] === '||';
      const sBefore = i > 0 ? signs[2 * i - 2] : undefined;
      const sAfter = i < xCols.length - 1 ? signs[2 * i] : undefined;

      if (isPole) {
        const leftLevel = sBefore === '+' ? 'top' : 'bottom';
        const rightLevel = sAfter === '+' ? 'bottom' : 'top';
        const leftLabel = leftLevel === 'top' ? '+\\infty' : '-\\infty';
        const rightLabel = rightLevel === 'top' ? '+\\infty' : '-\\infty';
        ys.push({
          pole: true,
          left: { level: leftLevel, label: leftLabel },
          right: { level: rightLevel, label: rightLabel },
        });
        continue;
      }

      const vTop = (rowY1[col] || '').trim();
      const vBot = rowY2 ? (rowY2[col] || '').trim() : '';

      if (rowY2) {
        if (vTop && !vBot) {
          ys.push({ level: 'top', label: vTop });
        } else if (vBot && !vTop) {
          ys.push({ level: 'bottom', label: vBot });
        } else {
          const lv =
            i === 0
              ? sAfter === '-' ? 'top' : 'bottom'
              : i === xCols.length - 1
              ? sBefore === '+' ? 'top' : 'bottom'
              : sBefore === '+' && sAfter === '-'
              ? 'top'
              : 'bottom';
          ys.push({ level: lv, label: vTop || vBot || '0' });
        }
      } else {
        const lv =
          i === 0
            ? sAfter === '-' ? 'top' : 'bottom'
            : i === xCols.length - 1
            ? sBefore === '+' ? 'top' : 'bottom'
            : sBefore === '+' && sAfter === '-'
            ? 'top'
            : 'bottom';
        ys.push({ level: lv, label: vTop || '0' });
      }
    }

    return normalizeManualBbtSpec({ xs, signs, ys });
  } catch (e) {
    console.warn('[FigureEngine] Không thể parse HTML BBT table:', e);
    return null;
  }
}

/**
 * Tìm biểu thức hàm số tường minh (vd y = x^3 - 3x) trong ngữ cảnh câu hỏi
 */
function extractExplicitFunctionFromContext(ctx: string): string | null {
  if (!ctx) return null;
  const matches = [
    ...ctx.matchAll(/\$\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*([^$]+?)\s*\$/gi),
  ];
  for (const m of matches) {
    const rhs = m[1].trim();
    // Bỏ qua nếu chỉ là f(x) tổng quát hoặc có tham số m
    if (!/\bf\s*\(/.test(rhs) && !/\bm\b/.test(rhs) && /\bx\b/.test(rhs)) {
      return rhs.replace(/[.,;:]$/, '').trim();
    }
  }
  return null;
}

/**
 * Lọc bỏ các lệnh extra/marks tham chiếu tới các điểm không có trong đề bài
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

  const distMatches = [...ctx.matchAll(/(\d+(?:[.,]\d+)?)\s*(km|hải\s*lý|m\b)/gi)];
  const ab = distMatches[0] ? Number(distMatches[0][1].replace(',', '.')) : 20;
  const unit1 = distMatches[0] ? distMatches[0][2] : 'km';
  const bc = distMatches[1] ? Number(distMatches[1][1].replace(',', '.')) : 30;
  const unit2 = distMatches[1] ? distMatches[1][2] : unit1;

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
 * Kiểm tra ngữ nghĩa và tự động sửa lỗi khi AI sinh nhầm hình
 */
export function sanitizeAndValidateFigureSpec(
  rawSpec: Record<string, any>,
  contextHtml?: string
): Record<string, any> | null {
  if (!rawSpec || typeof rawSpec !== 'object') return null;

  const spec = { ...rawSpec };
  const ctx = contextHtml ? stripHtmlTags(contextHtml) : '';

  const pointsInContext = new Set<string>();
  if (ctx.length > 10) {
    const pointGroups: string[] = ctx.match(/\b(?:[A-Z]'?\.?)+\b/g) || [];
    pointGroups.forEach((grp: string) => {
      const tokens: string[] = grp.match(/[A-Z]'?/g) || [];
      tokens.forEach((t: string) => pointsInContext.add(t));
    });
  }

  const is3DContext =
    /(hình\s+chóp|khối\s+chóp|tứ\s+diện|lăng\s+trụ|hình\s+hộp|lập\s+phương|hình\s+nón|khối\s+nón|mặt\s+nón|nón\s+cụt|hình\s+trụ|khối\s+trụ|mặt\s+trụ|mặt\s+cầu|khối\s+cầu|khối\s+tròn\s+xoay|mặt\s+tròn\s+xoay|đa\s+diện|không\s+gian|Oxyz|mặt\s+phẳng|\bS\.[A-Z]{3,4}\b)/i.test(
      ctx
    );

  const type = String(spec.type || '').toLowerCase();

  // Nếu là BBT và chưa có fn lẫn xs, thử lấy hàm số từ câu dẫn
  if (type === 'bbt' && !spec.fn && !spec.xs && !spec.x && ctx) {
    const extractedFn = extractExplicitFunctionFromContext(contextHtml || ctx);
    if (extractedFn) {
      spec.fn = extractedFn;
    }
  }

  // Nếu AI khai báo geo3d nhưng đề bài KHÔNG phải bài toán không gian 3D
  if (
    type === 'geo3d' ||
    (!type &&
      /^(pyramid|tetra|prism|box|cube|cone|cylinder|sphere|frustum)/i.test(String(spec.preset || '')))
  ) {
    const preset = String(spec.preset || '').toLowerCase();
    const isRevolutionPreset = /^(cone|cylinder|sphere|frustum)/i.test(preset);
    const needsApexS = preset.startsWith('pyramid');
    const hasPointSInCtx = pointsInContext.size === 0 || pointsInContext.has('S');

    if (ctx.length > 10 && (!is3DContext || (needsApexS && !hasPointSInCtx))) {
      const navParams = extractNavigationParamsFromText(ctx);
      if (navParams) {
        return {
          type: 'geo2d',
          preset: 'navigation',
          params: navParams,
        };
      }

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

      return null;
    }

    if (pointsInContext.size >= 3 && !isRevolutionPreset) {
      const { extra, marks } = filterExtraByContext(spec.extra, spec.marks, pointsInContext);
      spec.extra = extra;
      spec.marks = marks;
    }
  }

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
 * Khung SVG nhỏ báo lỗi vẽ hình (chỉ dùng khi hiển thị trên màn hình, không đưa vào file xuất).
 */
export function figureErrorSvg(message: string): string {
  const esc = (t: string) =>
    t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const msg = String(message || 'Lỗi không xác định');
  const short = msg.length > 70 ? msg.slice(0, 67) + '...' : msg;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 64" width="440" height="64">' +
    '<rect x="1" y="1" width="438" height="62" rx="6" fill="#fff7f7" stroke="#e57373" stroke-dasharray="5,3"/>' +
    '<text x="220" y="26" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="#c62828">' +
    'Không vẽ được hình từ mô tả JSON</text>' +
    `<text x="220" y="46" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#8d6e63">${esc(short)}</text>` +
    '</svg>'
  );
}

/**
 * Chuyển đổi cấu hình JSON (chuỗi hoặc object) thành mã SVG chuẩn SGK.
 * Mặc định trả về '' khi gặp lỗi (giữ hành vi cũ cho xuất Word/ảnh);
 * truyền `{ showError: true }` để nhận khung SVG báo lỗi thay vì để hình biến mất.
 */
export function renderFigureSpecToSvg(
  specInput: string | Record<string, any>,
  contextHtml?: string,
  opts?: { showError?: boolean }
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
        try {
          const analyzed = g.BBT.analyzeFunction(spec.fn);
          return g.BBT.renderBBT(analyzed, spec);
        } catch (fnErr) {
          if (spec.xs || spec.x) {
            const manual = normalizeManualBbtSpec(spec);
            return g.BBT.renderBBT(manual, spec);
          }
          throw fnErr;
        }
      }
      const manual = normalizeManualBbtSpec(spec);
      return g.BBT.renderBBT(manual, spec);
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
    if (spec.fn && (spec.xRange || spec.yRange || spec.asymptotes || spec.shade || spec.revolve)) {
      return g.Graph.renderGraph({ ...spec, type: 'graph' });
    }
    if (spec.fn) {
      const analyzed = g.BBT.analyzeFunction(spec.fn);
      return g.BBT.renderBBT(analyzed, spec);
    }
    if (spec.xs || spec.x) {
      const manual = normalizeManualBbtSpec(spec);
      return g.BBT.renderBBT(manual, spec);
    }

    return '';
  } catch (err: any) {
    console.warn('[FigureEngine] Không thể vẽ hình từ JSON:', err?.message || err, specInput);
    return opts?.showError ? figureErrorSvg(err?.message || String(err)) : '';
  }
}

/**
 * Lấy ngữ cảnh câu hỏi nằm ngay trước khối hình vẽ để đối chiếu tính hợp lệ
 */
function extractPrecedingQuestionContext(fullText: string, matchOffset: number): string {
  const before = fullText.slice(Math.max(0, matchOffset - 600), matchOffset);
  const cauMatches = [...before.matchAll(/(?:Câu\s+\d+|Bài\s+\d+)/gi)];
  if (cauMatches.length > 0) {
    const lastCau = cauMatches[cauMatches.length - 1];
    return before.slice(lastCau.index ?? 0);
  }
  return before;
}

/**
 * Đóng gói SVG thành thẻ <img> trực tiếp (kèm dữ liệu SVG gốc để tự động nâng cấp lên ảnh PNG 300 DPI)
 * giúp dán thẳng ảnh Bảng biến thiên / Hình vẽ vào câu hỏi tương ứng.
 */
function wrapSvgAsImageInQuestion(svg: string): string {
  const wMatch = svg.match(/width="([\d.]+)"/);
  const hMatch = svg.match(/height="([\d.]+)"/);
  const w = wMatch ? Math.round(Number(wMatch[1]) * 0.85) : 440;
  const h = hMatch ? Math.round(Number(hMatch[1]) * 0.85) : 200;
  const dataUrl = svgToDataUrl(svg);
  const b64Svg = encodeBase64Utf8(svg);
  return `<div class="figure-svg-container" style="text-align: center; margin: 10pt auto; page-break-inside: avoid;"><img class="figure-auto-img" src="${dataUrl}" data-figure-svg-b64="${b64Svg}" width="${w}" height="${h}" style="display: inline-block; margin: 4pt auto; max-width: 100%; height: auto; border-radius: 4px;" alt="Bảng biến thiên / Hình minh họa" /></div>`;
}

/**
 * Tìm và thay thế mọi khối cấu hình hình vẽ (`figure-json`) VÀ bảng `<table class="bbt-table">`
 * trong chuỗi HTML/Markdown bằng ảnh Bảng biến thiên / Hình vẽ chuẩn SGK gắn thẳng vào câu hỏi.
 */
export function renderFiguresInHtml(content: string): string {
  if (!content) return content;

  let out = content;

  // 1. <script type="application/json" class="figure-json">...</script>
  out = out.replace(
    /<script[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi,
    (_full, jsonBody, offset) => {
      const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
      const svg = renderFigureSpecToSvg(jsonBody, ctx);
      return svg ? wrapSvgAsImageInQuestion(svg) : '';
    }
  );

  // 2. <pre><code class="language-figure-json">...</code></pre>
  out = out.replace(
    /<pre[^>]*>\s*<code[^>]*class=["'][^"']*language-figure-json[^"']*["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_full, jsonBody, offset) => {
      const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
      const svg = renderFigureSpecToSvg(jsonBody, ctx);
      return svg ? wrapSvgAsImageInQuestion(svg) : '';
    }
  );

  // 3. <div class="figure-json">...</div> hoặc <pre class="figure-json">...</pre>
  out = out.replace(
    /<(div|pre)[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
    (_full, _tag, jsonBody, offset) => {
      const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
      const svg = renderFigureSpecToSvg(jsonBody, ctx);
      return svg ? wrapSvgAsImageInQuestion(svg) : '';
    }
  );

  // 4. Khối ```figure-json ... ``` còn sót trong HTML/text
  out = out.replace(/```figure-json\s*([\s\S]*?)```/gi, (_full, jsonBody, offset) => {
    const ctx = extractPrecedingQuestionContext(out, Number(offset) || 0);
    const svg = renderFigureSpecToSvg(jsonBody, ctx);
    return svg ? wrapSvgAsImageInQuestion(svg) : '';
  });

  // 5. Tự động chuyển mọi bảng <table class="bbt-table">...</table> sang ảnh Bảng biến thiên chuẩn SGK
  out = out.replace(
    /<table[^>]*class=["'][^"']*bbt-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi,
    (fullTable) => {
      const spec = parseHtmlBbtTableToSpec(fullTable);
      if (spec) {
        const svg = g.BBT.renderBBT(spec);
        if (svg) return wrapSvgAsImageInQuestion(svg);
      }
      return fullTable;
    }
  );

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
 * Tự động nâng cấp toàn bộ thẻ <img class="figure-auto-img" data-figure-svg-b64="...">
 * trong DOM sang ảnh PNG 300 DPI thực sự (data:image/png;base64,...) để người dùng có thể
 * click phải "Sao chép hình ảnh" (Copy Image) hoặc kéo thả trực tiếp.
 */
export async function upgradeAutoFigureImagesInDom(
  root?: ParentNode | null,
  dpi = 300
): Promise<void> {
  if (typeof document === 'undefined' || !g.FigExport?.svgToPngBlob) return;
  const container = root || document;
  const imgs = container.querySelectorAll<HTMLImageElement>(
    'img.figure-auto-img[data-figure-svg-b64]:not([data-png-upgraded="true"])'
  );
  for (const img of Array.from(imgs)) {
    const b64 = img.getAttribute('data-figure-svg-b64');
    if (!b64) continue;
    img.setAttribute('data-png-upgraded', 'true');
    try {
      const svgStr = decodeBase64Utf8(b64);
      const { blob } = await g.FigExport.svgToPngBlob(svgStr, dpi);
      const pngDataUrl = await blobToDataUrl(blob);
      img.src = pngDataUrl;
    } catch (e) {
      console.warn('[FigureEngine] Không thể nâng cấp ảnh sang PNG:', e);
    }
  }
}

/**
 * Chuyển chuỗi SVG thành DataURL ảnh PNG 300 DPI
 */
export async function svgToPngDataUrl(svgStr: string, dpi = 300): Promise<string> {
  if (!svgStr) return '';
  try {
    const { blob } = await g.FigExport.svgToPngBlob(svgStr, dpi);
    return await blobToDataUrl(blob);
  } catch {
    return svgToDataUrl(svgStr);
  }
}

/**
 * Sao chép trực tiếp hình vẽ (dưới dạng ảnh PNG 300 DPI) vào Clipboard hệ thống
 */
export async function copySvgAsPngToClipboard(
  svgInput: SVGElement | string,
  dpi = 300
): Promise<boolean> {
  try {
    const { blob } = await g.FigExport.svgToPngBlob(svgInput, dpi);
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('[FigureEngine] Không thể copy ảnh vào clipboard:', err);
    return false;
  }
}

/**
 * Chuyển toàn bộ thẻ <svg>...</svg> trong HTML sang thẻ <img src="data:image/png;base64,..." />
 * độ phân giải 300 DPI để nhúng trực tiếp vào file Word (.docx).
 */
export async function convertSvgsToPngInHtml(html: string, dpi = 300): Promise<string> {
  if (!html) return html;

  const withSvgs = renderFiguresInHtml(html);

  const svgRegex = /<svg\b[\s\S]*?<\/svg>/gi;
  const matches = withSvgs.match(svgRegex);
  if (!matches || matches.length === 0) return withSvgs;

  let result = withSvgs;
  for (const svgStr of matches) {
    try {
      const { blob, width, height } = await g.FigExport.svgToPngBlob(svgStr, dpi);
      const dataUrl = await blobToDataUrl(blob);
      const maxDocWidth = 450;
      const scale = width > maxDocWidth ? maxDocWidth / width : 0.85;
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
 * Tách toàn bộ khối figure-json, bảng .bbt-table, thẻ <img> có data-figure-svg-b64 và thẻ <svg>
 * ra thành placeholder an toàn trước khi chạy markdown-it và normalizeMathForWord,
 * sau đó chuyển thành ảnh PNG 300 DPI để nhúng vào đúng câu hỏi trong Word (.docx).
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

  // 0. Thẻ <div class="figure-svg-container"><img ... data-figure-svg-b64="..." /></div> đã được render sẵn
  out = out.replace(
    /<div[^>]*class=["'][^"']*figure-svg-container[^"']*["'][^>]*>\s*<img[^>]*data-figure-svg-b64=["']([^"']+)["'][^>]*>\s*<\/div>/gi,
    (_full, b64, offset) => makePh('svg', decodeBase64Utf8(b64), Number(offset) || 0, out)
  );
  out = out.replace(
    /<img[^>]*data-figure-svg-b64=["']([^"']+)["'][^>]*>/gi,
    (_full, b64, offset) => makePh('svg', decodeBase64Utf8(b64), Number(offset) || 0, out)
  );

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

  // 4. Bảng <table class="bbt-table">...</table>
  out = out.replace(
    /<table[^>]*class=["'][^"']*bbt-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi,
    (fullTable, _inner, offset) => {
      const spec = parseHtmlBbtTableToSpec(fullTable);
      if (spec) {
        const svgStr = g.BBT.renderBBT(spec);
        if (svgStr) return makePh('svg', svgStr, Number(offset) || 0, out);
      }
      return fullTable;
    }
  );

  // 5. Thẻ <svg>...</svg> có sẵn
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
        const maxDocWidth = 440;
        const scale = width > maxDocWidth ? maxDocWidth / width : 0.82;
        const dispW = Math.round(width * scale);
        const dispH = Math.round(height * scale);
        replacement = `<div style="text-align: center; margin: 8pt auto; page-break-inside: avoid;"><img src="${dataUrl}" width="${dispW}" height="${dispH}" style="display: block; margin: 0 auto; max-width: 100%;" alt="Bảng biến thiên / Hình minh họa" /></div>`;
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
 */
export const FIGURE_JSON_HTML_INSTRUCTIONS = `
   ================================================================
   QUY TẮC VẼ BẢNG BIẾN THIÊN & HÌNH MINH HỌA TỰ ĐỘNG (DÁN ẢNH TRỰC TIẾP VÀO CÂU HỎI)
   ================================================================
   Ứng dụng tích hợp BỘ VẼ HÌNH TẤT ĐỊNH 4 ENGINE: Bảng biến thiên (\`bbt\`), Đồ thị (\`graph\`), Hình phẳng 2D (\`geo2d\`), và Hình không gian 3D (\`geo3d\`).
   Hệ thống sẽ tự động xuất ảnh PNG 300 DPI chuẩn SGK và dán trực tiếp vào câu hỏi tương ứng.

   ⛔ **3 NGUYÊN TẮC SỐNG CÒN (TUYỆT ĐỐI TUÂN THỦ):**
   1. **CHỈ VẼ KHI CẦN THIẾT VÀ ĐẶT ĐÚNG TRONG CÂU HỎI TƯƠNG ỨNG:**
      - Đặt thẻ \`<script type="application/json" class="figure-json">...</script>\` ngay dưới lời dẫn của câu hỏi cần hình (trước các phương án A, B, C, D hoặc a, b, c, d).
   2. **CẤM TUYỆT ĐỐI VẼ HÌNH 3D (\`geo3d\`) CHO BÀI TOÁN PHẲNG 2D:**
      - Bài toán Hình học phẳng 2D (tam giác $ABC$, giải tam giác, tàu thuyền đi từ $A \\to B \\to C$, hình bình hành $ABCD$, hình chữ nhật, hình vuông, hình thang, đường tròn, vectơ phẳng - đặc biệt ở **Toán 10**) **BẮT BUỘC dùng \`"type": "geo2d"\`**.
   3. **ĐÚNG TÊN ĐIỂM & ĐÚNG HÀM SỐ / SỐ LIỆU:**
      - Mọi đỉnh, cạnh, hàm số, mốc cực trị trong JSON phải khớp chính xác 100% với nội dung câu hỏi.

   --- CÚ PHÁP 4 LOẠI HÌNH ---

   1. **BẢNG BIẾN THIÊN CHUẨN SGK (\`type: "bbt"\` — Tự động tạo ảnh PNG 300 DPI dán vào câu hỏi):**
      - **Cách 1 (Khi biết công thức hàm số, vd $y = x^3 - 3x$ hoặc $y = \\frac{2x+1}{x-1}$):** Hệ thống tự tính đạo hàm, nghiệm, cực trị, tiệm cận và vẽ ảnh BBT:
        <script type="application/json" class="figure-json">
        {"type": "bbt", "fn": "x^3 - 3*x"}
        </script>
      - **Cách 2 (Khi câu hỏi cho bảng biến thiên của hàm $y = f(x)$ ẩn công thức):** Khai báo trực tiếp các mốc \`xs\`, dấu đạo hàm \`signs\` (dùng \`"||"\` nếu không xác định), và giá trị \`ys\`:
        <script type="application/json" class="figure-json">
        {"type": "bbt", "xs": ["-\\infty", "-1", "1", "+\\infty"], "signs": ["+", "0", "-", "0", "+"], "ys": [["-\\infty", "bottom"], ["2", "top"], ["-2", "bottom"], ["+\\infty", "top"]]}
        </script>

   2. **ĐỒ THỊ HÀM SỐ, MIỀN TÍCH PHÂN & KHỐI TRÒN XOAY QUANH TRỤC Ox (\`type: "graph"\`):**
      - Truyền đúng biểu thức hàm số \`fn\` của câu hỏi (nếu quay miền phẳng quanh trục $Ox$ tạo khối tròn xoay từ $x=a$ đến $x=b$, thêm \`"revolve": {"fn": "...", "from": a, "to": b}\`):
        <script type="application/json" class="figure-json">
        {"type": "graph", "fn": ["(2*x+1)/(x-1)"], "xRange": [-4, 5], "yRange": [-4, 7], "asymptotes": "auto", "points": "extrema+intercepts"}
        </script>

   3. **HÌNH HỌC PHẲNG 2D (\`type: "geo2d"\` — Dùng cho Tam giác, Tứ giác, Vectơ phẳng, Bài toán thực tế đo đạc/tàu thuyền):**
      - Các \`preset\` 2D hỗ trợ: \`"triangle"\`, \`"triangle-right"\`, \`"triangle-iso"\`, \`"triangle-equil"\`, \`"parallelogram"\`, \`"rectangle"\`, \`"square"\`, \`"rhombus"\`, \`"trapezoid"\`, \`"trapezoid-right"\`, \`"circle"\`, \`"navigation"\`.
        <script type="application/json" class="figure-json">
        {"type": "geo2d", "preset": "navigation", "params": {"ab": 20, "bc": 30, "bearingAB": "N45E", "bearingBC": "S30E", "labelAB": "20 km", "labelBC": "30 km", "labelAC": "?"}}
        </script>

   4. **HÌNH HỌC KHÔNG GIAN 3D & KHỐI TRÒN XOAY (\`type: "geo3d"\` — CHỈ dùng khi đề bài nêu rõ Hình chóp, Lăng trụ, Hình hộp, Tứ diện, Nón, Trụ, Cầu, Nón cụt, Oxyz):**
      - Các \`preset\` 3D: \`"pyramid-tri"\`, \`"pyramid-square"\`, \`"pyramid-rect"\` (thêm \`"apexOver": "A"\` nếu $SA \\perp$ đáy), \`"tetra-right"\`, \`"prism-tri"\`, \`"prism-quad"\` (lăng trụ tứ giác, đáy ABCD), \`"prism-hex"\` (lăng trụ lục giác đều ABCDEF.A'B'C'D'E'F'), \`"pyramid-hex"\` (chóp lục giác đều S.ABCDEF), \`"box"\`, \`"cube"\`, và các khối tròn xoay \`"cone"\` (hình nón), \`"cylinder"\` (hình trụ), \`"sphere"\` (mặt cầu/khối cầu), \`"frustum"\` (hình nón cụt).
        <script type="application/json" class="figure-json">
        {"type": "geo3d", "preset": "cone", "params": {"r": 1.6, "h": 2.6}}
        </script>
`;

export const FIGURE_JSON_MARKDOWN_INSTRUCTIONS = `
================================================================
QUY TẮC VẼ BẢNG BIẾN THIÊN & HÌNH MINH HỌA TỰ ĐỘNG (DÁN ẢNH VÀO CÂU HỎI)
================================================================
Khi câu hỏi cần Bảng biến thiên hoặc Hình minh họa trực quan, BẮT BUỘC chèn khối code \`\`\`figure-json ... \`\`\` ngay dưới lời dẫn của câu hỏi đó (trước các đáp án A, B, C, D). Hệ thống sẽ tự động tạo ảnh PNG 300 DPI chuẩn SGK và dán thẳng vào câu hỏi.

1. **Bảng biến thiên (\`type: "bbt"\`):**
- Nếu biết hàm số (vd $y = x^3 - 3x$):
\`\`\`figure-json
{"type": "bbt", "fn": "x^3 - 3*x"}
\`\`\`
- Nếu đề cho bảng biến thiên của hàm $y = f(x)$ tổng quát (không nêu công thức):
\`\`\`figure-json
{"type": "bbt", "xs": ["-\\infty", "-1", "1", "+\\infty"], "signs": ["+", "0", "-", "0", "+"], "ys": [["-\\infty", "bottom"], ["2", "top"], ["-2", "bottom"], ["+\\infty", "top"]]}
\`\`\`

2. **Đồ thị hàm số, miền tích phân & khối tròn xoay tích phân quanh $Ox$ (\`type: "graph"\`):**
\`\`\`figure-json
{"type": "graph", "fn": ["(2*x+1)/(x-1)"], "xRange": [-4, 5], "yRange": [-4, 7], "asymptotes": "auto", "points": "extrema+intercepts"}
\`\`\`

3. **Hình học phẳng 2D (\`type: "geo2d"\` — Tam giác, Hình bình hành, Hình chữ nhật, Phương hướng tàu thuyền):**
\`\`\`figure-json
{"type": "geo2d", "preset": "parallelogram", "params": {"center": true}}
\`\`\`

4. **Hình học không gian 3D & Khối tròn xoay (\`type: "geo3d"\` — Hình chóp, Lăng trụ, Hình hộp, Tứ diện, Nón \`cone\`, Trụ \`cylinder\`, Cầu \`sphere\`, Nón cụt \`frustum\`):**
\`\`\`figure-json
{"type": "geo3d", "preset": "pyramid-square", "params": {"a": 2, "h": 2.6}, "extra": ["point O center(ABCD)", "segment S O", "segment A C", "segment B D"], "marks": ["rightangle S O B"]}
\`\`\`
`;

