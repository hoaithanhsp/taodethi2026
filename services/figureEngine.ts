import './engine/initMath';
import './engine/bbt.js';
import './engine/graph.js';
import './engine/geo3d.js';
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
            level: mapLevel(item.right?.level ?? 'top'),
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
 * Chuyển đổi cấu hình JSON (chuỗi hoặc object) thành mã SVG chuẩn SGK
 * Hỗ trợ 3 loại:
 *  - type: "bbt"   (Bảng biến thiên chuẩn SGK kiểu tkz-tab, tự tính đạo hàm/cực trị/tiệm cận bằng mathjs)
 *  - type: "graph" (Đồ thị hàm số, tiệm cận đứng/ngang/xiên, điểm cực trị, miền tô tích phân)
 *  - type: "geo3d" (Hình học không gian 3D chiếu song song, tự xác định nét đứt/nét liền)
 */
export function renderFigureSpecToSvg(specInput: string | Record<string, any>): string {
  try {
    let spec: Record<string, any>;
    if (typeof specInput === 'string') {
      const cleaned = decodeHtmlEntities(specInput.trim())
        .replace(/^```(?:figure-json|json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      spec = JSON.parse(cleaned);
    } else {
      spec = specInput;
    }

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

    if (type === 'geo3d') {
      return g.Geo3D.renderGeo3D(spec);
    }

    // Tự nhận diện nếu thiếu trường type
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
    (full, jsonBody) => {
      const svg = renderFigureSpecToSvg(jsonBody);
      return svg ? wrapSvg(svg) : full;
    }
  );

  // 2. <pre><code class="language-figure-json">...</code></pre> (do markdown-it sinh ra)
  out = out.replace(
    /<pre[^>]*>\s*<code[^>]*class=["'][^"']*language-figure-json[^"']*["'][^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (full, jsonBody) => {
      const svg = renderFigureSpecToSvg(jsonBody);
      return svg ? wrapSvg(svg) : full;
    }
  );

  // 3. <div class="figure-json">...</div> hoặc <pre class="figure-json">...</pre>
  out = out.replace(
    /<(div|pre)[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
    (full, _tag, jsonBody) => {
      const svg = renderFigureSpecToSvg(jsonBody);
      return svg ? wrapSvg(svg) : full;
    }
  );

  // 4. Khối ```figure-json ... ``` còn sót trong HTML/text
  out = out.replace(/```figure-json\s*([\s\S]*?)```/gi, (full, jsonBody) => {
    const svg = renderFigureSpecToSvg(jsonBody);
    return svg ? wrapSvg(svg) : full;
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

  // Trước tiên đảm bảo mọi khối figure-json đã được chuyển thành <svg>
  const withSvgs = renderFiguresInHtml(html);

  const svgRegex = /<svg\b[\s\S]*?<\/svg>/gi;
  const matches = withSvgs.match(svgRegex);
  if (!matches || matches.length === 0) return withSvgs;

  let result = withSvgs;
  for (const svgStr of matches) {
    try {
      const { blob, width, height } = await g.FigExport.svgToPngBlob(svgStr, dpi);
      const dataUrl = await blobToDataUrl(blob);
      // Co kích thước hiển thị vừa đẹp trang A4 Word (tối đa rộng 460px)
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
  figures: Array<{ kind: 'json' | 'svg'; payload: string }>;
} {
  if (!content) return { text: content, figures: [] };

  const figures: Array<{ kind: 'json' | 'svg'; payload: string }> = [];
  const makePh = (kind: 'json' | 'svg', payload: string) => {
    const idx = figures.length;
    figures.push({ kind, payload });
    return `\n\n<div data-fig-ph="${idx}"></div>\n\n`;
  };

  let out = content;

  // 1. <script type="application/json" class="figure-json">...</script>
  out = out.replace(
    /<script[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi,
    (_full, jsonBody) => makePh('json', jsonBody)
  );

  // 2. ```figure-json ... ```
  out = out.replace(/```figure-json\s*([\s\S]*?)```/gi, (_full, jsonBody) =>
    makePh('json', jsonBody)
  );

  // 3. <div class="figure-json">...</div> hoặc <pre class="figure-json">...</pre>
  out = out.replace(
    /<(div|pre)[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi,
    (_full, _tag, jsonBody) => makePh('json', jsonBody)
  );

  // 4. Thẻ <svg>...</svg> có sẵn
  out = out.replace(/<svg\b[\s\S]*?<\/svg>/gi, (svgStr) => makePh('svg', svgStr));

  return { text: out, figures };
}

export async function restoreFiguresAsPngForWord(
  html: string,
  figures: Array<{ kind: 'json' | 'svg'; payload: string }>,
  dpi = 300
): Promise<string> {
  if (!html || figures.length === 0) return html;

  let out = html;
  for (let i = 0; i < figures.length; i++) {
    const item = figures[i];
    const svgStr = item.kind === 'json' ? renderFigureSpecToSvg(item.payload) : item.payload;
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

export async function downloadSvgAsPng(svgEl: SVGElement | string, filename = 'hinh-ve.png'): Promise<void> {
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
   QUY TẮC VẼ HÌNH MINH HỌA TỰ ĐỘNG (BẢNG BIẾN THIÊN, ĐỒ THỊ, HÌNH 3D)
   ================================================================
   Ứng dụng đã tích hợp BỘ VẼ HÌNH TẤT ĐỊNH (MathJS + SVG Engine chuẩn SGK Việt Nam).
   Khi câu hỏi hoặc lời giải có **Bảng biến thiên**, **Đồ thị hàm số / Diện tích hình phẳng**, hoặc **Hình học không gian 3D**, BẠN PHẢI NHÚNG thẻ \`<script type="application/json" class="figure-json">...JSON...</script>\` ngay dưới câu dẫn (trước các phương án A, B, C, D).
   Hệ thống sẽ TỰ ĐỘNG tính toán đạo hàm, nghiệm, cực trị, tiệm cận, nét đứt/nét liền và vẽ thành hình SVG/PNG 300 DPI chuẩn SGK!

   1. **BẢNG BIẾN THIÊN (\`type: "bbt"\`)**:
      - Chỉ cần truyền biểu thức hàm số \`fn\` (theo biến \`x\`), hệ thống tự tính $y'$, nghiệm, dấu, giới hạn, cực trị và vẽ bảng biến thiên chuẩn \`tkz-tab\` có mũi tên chéo và ký hiệu tiệm cận đứng \`||\`:
      <script type="application/json" class="figure-json">
      {"type": "bbt", "fn": "x^3 - 3*x^2 + 2"}
      </script>
      - Ví dụ hàm phân thức bậc nhất / bậc nhất hoặc bậc hai / bậc nhất:
      <script type="application/json" class="figure-json">
      {"type": "bbt", "fn": "(2*x + 1)/(x - 1)"}
      </script>
      - Nếu câu hỏi cho bảng biến thiên của hàm $y = f(x)$ tổng quát (không cho công thức tường minh nhưng biết các điểm cực trị), hãy đưa vào một hàm đại diện có đúng các điểm cực trị và giá trị đó, hoặc truyền trực tiếp cấu trúc:
      <script type="application/json" class="figure-json">
      {"type": "bbt", "xs": ["-\\\\infty", "-1", "1", "+\\\\infty"], "signs": ["-", "0", "+", "0", "-"], "ys": [{"label": "+\\\\infty", "level": "top"}, {"label": "-2", "level": "bottom"}, {"label": "2", "level": "top"}, {"label": "-\\\\infty", "level": "bottom"}]}
      </script>

   2. **ĐỒ THỊ HÀM SỐ & MIỀN TÍCH PHÂN (\`type: "graph"\`)**:
      - Tự động vẽ hệ trục tọa độ $Oxy$, đường cong, đường tiệm cận nét đứt, đường gióng cực trị và tô miền diện tích:
      <script type="application/json" class="figure-json">
      {"type": "graph", "fn": ["(2*x+1)/(x-1)"], "xRange": [-4, 5], "yRange": [-4, 7], "asymptotes": "auto", "points": "extrema+intercepts"}
      </script>
      - Ví dụ bài toán diện tích hình phẳng (tô miền giới hạn bởi 2 đồ thị từ $x=a$ đến $x=b$):
      <script type="application/json" class="figure-json">
      {"type": "graph", "fn": ["x^2", "2*x"], "xRange": [-1, 3], "yRange": [-1, 5], "shade": {"fn": "2*x", "fn2": "x^2", "from": 0, "to": 2}, "names": ["y=x²", "y=2x"]}
      </script>

   3. **HÌNH HỌC KHÔNG GIAN 3D (\`type: "geo3d"\`)**:
      - Phép chiếu song song chuẩn SGK Việt Nam, TỰ ĐỘNG XÁC ĐỊNH NÉT ĐỨT (cạnh khuất) và NÉT LIỀN:
      - Các \`preset\` hỗ trợ: \`"pyramid-tri"\` (chóp tam giác), \`"pyramid-square"\` (chóp tứ giác đáy vuông/hình bình hành), \`"pyramid-rect"\`, \`"tetra-right"\` (tứ diện vuông O.ABC), \`"prism-tri"\` (lăng trụ tam giác), \`"box"\` (hình hộp), \`"cube"\` (lập phương), \`"cone"\` (nón), \`"cylinder"\` (trụ), \`"sphere"\` (mặt cầu).
      - Nếu chóp có cạnh bên $SA \\perp$ đáy, thêm \`"apexOver": "A"\` trong \`params\`.
      - Thêm điểm phụ bằng \`"point M midpoint(S,C)"\`, \`"point O center(ABCD)"\`, \`"point G centroid(A,B,C)"\`, \`"point H foot(A,S,B)"\` và nối đoạn thẳng bằng \`"segment S O"\`, đánh dấu góc vuông bằng \`"marks": ["rightangle S O B"]\`.
      - Ví dụ hình chóp tứ giác đều $S.ABCD$ có tâm đáy $O$, trung điểm $M$ của $SC$:
      <script type="application/json" class="figure-json">
      {"type": "geo3d", "preset": "pyramid-square", "params": {"a": 2, "h": 2.6}, "extra": ["point O center(ABCD)", "point M midpoint(S,C)", "segment S O", "segment A C", "segment B D", "segment O M"], "marks": ["rightangle S O B"]}
      </script>
      - Ví dụ hình chóp $S.ABC$ có $SA \\perp (ABC)$:
      <script type="application/json" class="figure-json">
      {"type": "geo3d", "preset": "pyramid-tri", "params": {"a": 2.4, "h": 2.4, "apexOver": "A"}, "extra": ["point M midpoint(B,C)", "segment A M", "segment S M"], "marks": ["rightangle S A B", "rightangle S A C"]}
      </script>

   ⚠️ YÊU CẦU BẮT BUỘC VỚI MÔN TOÁN:
   - Trong đề thi Toán (đặc biệt Lớp 10, 11, 12), hãy CHỦ ĐỘNG tạo các câu hỏi có hình minh họa trực quan (Bảng biến thiên cho câu hỏi đồng biến/nghịch biến/cực trị/tiệm cận; Đồ thị hàm số cho câu hỏi nhận diện đồ thị/tương giao/diện tích hình phẳng; Hình không gian 3D cho câu hỏi thể tích/góc/khoảng cách/tọa độ Oxyz) bằng thẻ \`<script type="application/json" class="figure-json">...</script>\`.
   - Khi đã dùng \`<script type="application/json" class="figure-json">{"type":"bbt",...}</script>\` để vẽ Bảng biến thiên SVG chuẩn SGK, KHÔNG cần viết lặp lại bảng HTML \`.bbt-table\` cho cùng câu hỏi đó.
`;

export const FIGURE_JSON_MARKDOWN_INSTRUCTIONS = `
================================================================
QUY TẮC VẼ HÌNH MINH HỌA TỰ ĐỘNG (BẢNG BIẾN THIÊN, ĐỒ THỊ, HÌNH 3D)
================================================================
Khi câu hỏi có **Bảng biến thiên**, **Đồ thị hàm số**, hoặc **Hình học không gian 3D**, BẠN PHẢI chèn khối code \`\`\`figure-json ... \`\`\` ngay dưới nội dung câu hỏi (trước các phương án A, B, C, D).
Hệ thống sẽ tự động tính toán bằng MathJS và vẽ hình SVG/PNG 300 DPI chuẩn SGK Việt Nam (tự động phân biệt nét đứt / nét liền, vẽ mũi tên chéo bảng biến thiên chuẩn tkz-tab):

1. **Bảng biến thiên (\`type: "bbt"\`)**:
\`\`\`figure-json
{"type": "bbt", "fn": "x^3 - 3*x^2 + 2"}
\`\`\`
Hoặc bảng biến thiên khai báo tường minh (khi đề cho bảng biến thiên của $f(x)$ không rõ công thức):
\`\`\`figure-json
{"type": "bbt", "xs": ["-\\infty", "-1", "1", "+\\infty"], "signs": ["-", "0", "+", "0", "-"], "ys": [{"label": "+\\infty", "level": "top"}, {"label": "-2", "level": "bottom"}, {"label": "2", "level": "top"}, {"label": "-\\infty", "level": "bottom"}]}
\`\`\`

2. **Đồ thị hàm số & miền tích phân (\`type: "graph"\`)**:
\`\`\`figure-json
{"type": "graph", "fn": ["(2*x+1)/(x-1)"], "xRange": [-4, 5], "yRange": [-4, 7], "asymptotes": "auto", "points": "extrema+intercepts"}
\`\`\`

3. **Hình học không gian 3D (\`type: "geo3d"\`)**:
- Hỗ trợ \`preset\`: \`"pyramid-tri"\`, \`"pyramid-square"\`, \`"pyramid-rect"\`, \`"tetra-right"\`, \`"prism-tri"\`, \`"box"\`, \`"cube"\`, \`"cone"\`, \`"cylinder"\`, \`"sphere"\`.
- Tự động xác định nét đứt / nét liền chuẩn SGK:
\`\`\`figure-json
{"type": "geo3d", "preset": "pyramid-square", "params": {"a": 2, "h": 2.6}, "extra": ["point O center(ABCD)", "point M midpoint(S,C)", "segment S O", "segment A C", "segment B D", "segment O M"], "marks": ["rightangle S O B"]}
\`\`\`
`;
