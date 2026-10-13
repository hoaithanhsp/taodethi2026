/**
 * services/mathExportUtils.ts
 * ------------------------------------------------------------------
 * Chuẩn hoá LaTeX trước khi xuất DOCX bằng html-docx-js-typescript.
 *
 * Mục tiêu:
 *  1) Mọi công thức được bọc đúng $...$ (inline) / $$...$$ (display).
 *  2) Công thức inline KHÔNG dính vào chữ  -> chèn ranh giới NBSP.
 *  3) Công thức display đứng riêng dòng, canh giữa.
 *  4) Chuyển ký tự non-ASCII sang numeric HTML entity để Word đọc
 *     qua altChunk (afchunk.mht) không bị lỗi dấu tiếng Việt.
 *
 * Hàm normalizeMathForWord là IDEMPOTENT (gọi nhiều lần không lồng thẻ).
 * ------------------------------------------------------------------
 */

export interface NormalizeMathOptions {
  /** Bọc công thức inline trong <span class="math-inline">. Mặc định: true */
  wrapInline?: boolean;
  /** Chèn NBSP quanh công thức inline để không dính chữ. Mặc định: true */
  padInlineBoundaries?: boolean;
  /** Chuyển ký tự non-ASCII sang entity &#...; . Mặc định: true */
  encodeEntities?: boolean;
}

/**
 * Escape ký tự & và < bên trong công thức để không phá cấu trúc HTML.
 * - Không escape lại entity đã có sẵn (markdown-it đã render &amp; &lt; ...)
 *   để tránh lỗi double-escape (Word hiện nguyên chữ "&lt;").
 * - Không đụng tới thẻ HTML thật (<tag ...>, </tag>, <br/>, <!-- -->);
 *   còn "$x<y$" thì < được escape thành &lt;.
 * - Dấu > để nguyên: HTML chấp nhận > trần trong nội dung văn bản.
 */
function escapeMathBody(tex: string): string {
  return tex
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/<(?!\/?[a-zA-Z][a-zA-Z0-9-]*[\s>\/]|!)/g, '&lt;');
}

/**
 * Đưa mọi ký tự ngoài ASCII về numeric entity (an toàn cho MHT/altChunk).
 * Đồng thời loại bỏ ký tự điều khiển mà Word không nhận.
 */
export function encodeNonAsciiToEntities(html: string): string {
  return html
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[^\x00-\x7F]/gu, (ch) => `&#${ch.codePointAt(0)!};`);
}

/* ------------------------------------------------------------------
 * Bảo vệ công thức khỏi markdown-it
 * ------------------------------------------------------------------
 * markdown-it coi "\" là ký tự escape của Markdown nên làm hỏng LaTeX:
 *   \\  -> \      (xuống dòng trong cases/matrix/align bị mất)
 *   \{  -> {      (\left\{ ... bị hỏng)
 *   \[ \( -> [ (  (mất delimiter công thức)
 *   |x| trong bảng -> bị hiểu là ranh giới cột; _ * -> in nghiêng...
 * Cách xử lý: tạm thay mọi công thức bằng placeholder (ký tự vùng
 * Private Use U+E000/U+E001 mà markdown-it không đụng tới), render,
 * rồi trả công thức NGUYÊN VĂN về chỗ cũ (escape & < > cho HTML).
 * ------------------------------------------------------------------ */

const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';

/** Các mẫu công thức, theo thứ tự ưu tiên (display trước inline). */
const MATH_PATTERNS: RegExp[] = [
  // $$ ... $$ (có thể nhiều dòng)
  /(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$/g,
  // \[ ... \]  (bỏ qua \\[2mm])
  /(?<!\\)\\\[[\s\S]+?(?<!\\)\\\]/g,
  // \begin{env} ... \end{env} đứng ngoài $ (env display)
  /\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}[\s\S]*?\\end\{\1\}/g,
  // \( ... \)
  /(?<!\\)\\\([\s\S]+?(?<!\\)\\\)/g,
  // $ ... $ trên một dòng (bỏ qua \$ đã escape)
  /(?<![\\$])\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)/g,
];

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render Markdown -> HTML mà KHÔNG để markdown-it chạm vào LaTeX.
 * Kết quả vẫn giữ delimiter $...$ / $$...$$ / \[...\] / \(...\) để
 * normalizeMathForWord xử lý tiếp.
 */
export function renderMarkdownPreservingMath(
  md: { render: (src: string) => string },
  src: string
): string {
  if (!src) return md.render(src || '');

  const store: string[] = [];
  let protectedSrc = src.replace(/[\uE000\uE001]/g, ''); // tránh trùng placeholder

  for (const re of MATH_PATTERNS) {
    protectedSrc = protectedSrc.replace(re, (m) => {
      store.push(m);
      return `${PH_OPEN}${store.length - 1}${PH_CLOSE}`;
    });
  }

  if (store.length === 0) return md.render(src);

  const html = md.render(protectedSrc);

  // Trả công thức về (lặp vì placeholder có thể lồng nhau, vd \( $..$ \))
  const restoreRe = new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g');
  let out = html;
  for (let guard = 0; guard < 5 && restoreRe.test(out); guard++) {
    restoreRe.lastIndex = 0;
    out = out.replace(restoreRe, (_m, i: string) => escapeHtmlText(store[Number(i)] ?? ''));
  }
  return out;
}

export function normalizeMathForWord(
  input: string,
  options: NormalizeMathOptions = {}
): string {
  if (!input || typeof input !== 'string') return input;

  const {
    wrapInline = true,
    padInlineBoundaries = true,
    encodeEntities = true,
  } = options;

  let out = input;

  // --- 1. Chuẩn hoá các delimiter LaTeX khác về $...$ / $$...$$ ---------
  // \[ ... \]  ->  display   (bỏ qua "\\[" của LaTeX như \\[2mm])
  out = out.replace(/(?<!\\)\\\[([\s\S]*?)\\\]/g, (_m, b: string) =>
    `\n\n$$${b.trim()}$$\n\n`
  );
  // \( ... \)  ->  inline    (bỏ qua "\\(...")
  out = out.replace(/(?<!\\)\\\(([\s\S]*?)\\\)/g, (_m, b: string) =>
    `$${b.trim()}$`
  );
  // \begin{equation|align|...} ... \end{...}  ->  display
  // (chỉ khi chưa nằm trong $$...$$, tránh bọc lồng)
  out = out.replace(
    /(?<!\$\$\s*)\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath)\}([\s\S]*?)\\end\{\1\}/g,
    (_m, _env: string, b: string) => `\n\n$$${b.trim()}$$\n\n`
  );

  // --- 2. Display math: $$...$$ -> đứng riêng dòng, canh giữa ------------
  // data-mw="d"> đặt SÁT trước $$ để lần gọi sau nhận diện và bỏ qua;
  // (?!<\/span>) chặn $$ ĐÓNG của công thức đã bọc bị hiểu nhầm là $$ MỞ.
  out = out.replace(
    /(?<!data-mw="d">)\$\$(?!<\/span>)([\s\S]+?)\$\$/g,
    (_m, b: string) =>
      `\n<br><span class="math-display" style="display:block;text-align:center" data-mw="d">$$${escapeMathBody(
        b.trim()
      )}$$</span><br>\n`
  );

  // --- 3. Inline math: $...$ -> bọc span + ranh giới NBSP ----------------
  const wrap = (tex: string) =>
    wrapInline
      ? `<span class="math-inline" data-mw="i">$${tex}$</span>`
      : `$${tex}$`;

  out = out.replace(
    /(^|[^\\$])(?<!data-mw="i">)\$(?!<\/span>)([^\n$]+?)\$(?!\$)/g,
    (_m, lead: string, b: string) => {
      const inner = wrap(escapeMathBody(b.trim()));
      return padInlineBoundaries
        ? `${lead}\u00A0${inner}\u00A0`
        : `${lead}${inner}`;
    }
  );

  // --- 4. Dọn khoảng trắng dư do bước 3 sinh ra --------------------------
  out = out.replace(/[ \t\u00A0]{2,}/g, (m) =>
    m.includes('\u00A0') ? '\u00A0' : ' '
  );
  // Bỏ NBSP ngay đầu đoạn khi công thức mở đầu một dòng
  out = out.replace(/>\u00A0(?=<span class="math-inline")/g, '>');

  // --- 5. Đưa non-ASCII về entity (guard lỗi dấu tiếng Việt) -------------
  if (encodeEntities) out = encodeNonAsciiToEntities(out);

  return out;
}
