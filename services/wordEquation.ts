/**
 * services/wordEquation.ts
 * ------------------------------------------------------------------
 * Xuất công thức dạng EQUATION gốc của Word (OMML) thay cho chữ $...$.
 *
 * Mở file bằng Word là có công thức sửa được ngay; muốn đổi sang MathType
 * chỉ cần: MathType > Convert Equations > chọn "Microsoft Word equations"
 * (Office 2007 trở lên) > Convert.
 *
 * Luồng: LaTeX --KaTeX--> MathML --(bộ chuyển bên dưới)--> OMML.
 * File .docx của app tạo bằng html-docx-js (Word nhập lại HTML qua altChunk),
 * nên OMML được viết đúng định dạng HTML mà chính Word dùng khi lưu trang web:
 *   <!--[if gte msEquation 12]><m:oMath>…</m:oMath><![endif]-->
 * (không khai báo namespace trong thẻ, <m:r> chứa chữ trực tiếp, chữ nghiêng
 * bằng <i>, font Cambria Math) — Word nhận đúng thành Equation.
 * Công thức KaTeX không đọc được → giữ nguyên $...$ (MathType vẫn đổi được
 * dạng TeX bằng Convert Equations).
 * ------------------------------------------------------------------
 */
import katex from 'katex';
import { normalizeMathForWord, encodeNonAsciiToEntities } from './mathExportUtils';

/** Cách ghi công thức khi xuất Word: 'latex' = chữ $...$ (như trước), 'equation' = Equation của Word. */
export type WordMathFormat = 'latex' | 'equation';
const MATH_FORMAT_KEY = 'word_math_format';

export const getWordMathFormat = (): WordMathFormat => {
  try {
    return localStorage.getItem(MATH_FORMAT_KEY) === 'equation' ? 'equation' : 'latex';
  } catch {
    return 'latex';
  }
};

export const setWordMathFormat = (format: WordMathFormat): void => {
  try {
    localStorage.setItem(MATH_FORMAT_KEY, format);
  } catch {
    /* trình duyệt chặn localStorage → chỉ áp dụng cho phiên hiện tại */
  }
};

type XElement = { tag: string; attrs: Record<string, string>; children: XNode[] };
type XNode = XElement | string;

/* ---------------------------- Đọc MathML ---------------------------- */

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos|nbsp);/g, (_m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[e];
  });

/** Bộ đọc XML tối giản cho MathML do KaTeX sinh ra (luôn đúng chuẩn XML). */
const parseXml = (xml: string): XElement => {
  const root: XElement = { tag: '#root', attrs: {}, children: [] };
  const stack: XElement[] = [root];
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      top.children.push(decodeEntities(m[5]));
    } else if (m[1]) {
      if (stack.length > 1) stack.pop();
    } else {
      const attrs: Record<string, string> = {};
      m[3].replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_a, k: string, v: string) => {
        attrs[k] = decodeEntities(v);
        return '';
      });
      const el: XElement = { tag: m[2], attrs, children: [] };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root;
};

const isEl = (n: XNode | undefined): n is XElement => !!n && typeof n !== 'string';
const textOf = (n: XNode | undefined): string =>
  !n ? '' : typeof n === 'string' ? n : n.children.map(textOf).join('');
/** Bỏ các lớp bọc không mang nghĩa (mrow/mstyle chỉ có 1 con) để nhận diện ký tự gốc. */
const unwrap = (n: XNode | undefined): XNode | undefined => {
  while (isEl(n) && ['mrow', 'mstyle', 'mpadded'].includes(n.tag) && n.children.filter(isEl).length === 1) {
    n = n.children.find(isEl);
  }
  return n;
};
const elChildren = (n: XElement): XElement[] => n.children.filter(isEl);

/* ---------------------------- Sinh OMML ---------------------------- */

const MATH_FONT = `font-family:"Cambria Math",serif`;
// "--" sẽ làm hỏng chú thích HTML <!-- … --> bao quanh công thức
const escXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/--/g, '-​-');

const run = (text: string, italic = false, bold = false): string => {
  if (!text) return '';
  // KaTeX đổi | thành ∣ (U+2223, quan hệ "chia hết") khiến Word chèn khoảng trắng: |x − 1| → ∣ x − 1 ∣
  let r = `<span style='${MATH_FONT}'><m:r>${escXml(text.replace(/∣/g, '|'))}</m:r></span>`;
  if (italic) r = `<i>${r}</i>`;
  if (bold) r = `<b>${r}</b>`;
  return r;
};

const NARY = new Set(['∫', '∬', '∭', '∮', '∯', '∰', '∑', '∏', '∐', '⋃', '⋂', '⋁', '⋀', '⨁', '⨂']);
const INTEGRALS = new Set(['∫', '∬', '∭', '∮', '∯', '∰']);
const LIM_LIKE =/^(lim|max|min|sup|inf|lim sup|lim inf|limsup|liminf)$/;
const INVISIBLE_OPS = /^[⁡-⁤]$/;
const FUNC_APPLY = '⁡';
/** Chữ nhìn thấy được (bỏ ký tự ẩn U+2061… mà KaTeX gắn sau tên hàm như lim, sin). */
const visibleText = (n: XNode | undefined): string => textOf(n).replace(/[⁡-⁤]/g, '').trim();

/** \mathbb{R} → ℝ (Word không có thuộc tính double-struck cho run trong HTML) */
const DOUBLE_STRUCK: Record<string, string> = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };
const toDoubleStruck = (t: string): string =>
  Array.from(t)
    .map(ch => {
      if (DOUBLE_STRUCK[ch]) return DOUBLE_STRUCK[ch];
      const c = ch.charCodeAt(0);
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d538 + c - 65);
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d552 + c - 97);
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7d8 + c - 48);
      return ch;
    })
    .join('');

const baseNaryChar = (n: XNode | undefined): string | null => {
  const b = unwrap(n);
  if (isEl(b) && b.tag === 'mo') {
    const t = textOf(b).trim();
    if (NARY.has(t)) return t;
  }
  return null;
};

const sepTag = (tag: string, inner: string) => `<m:${tag}>${inner}</m:${tag}>`;

const naryXml = (chr: string, sub: string | null, sup: string | null, undOvr: boolean, body: string): string =>
  `<m:nary><m:naryPr><m:chr m:val="${escXml(chr)}"></m:chr><m:limLoc m:val="${undOvr ? 'undOvr' : 'subSup'}"></m:limLoc>` +
  `${sub === null ? '<m:subHide m:val="on"></m:subHide>' : ''}${sup === null ? '<m:supHide m:val="on"></m:supHide>' : ''}</m:naryPr>` +
  `${sepTag('sub', sub || '')}${sepTag('sup', sup || '')}${sepTag('e', body)}</m:nary>`;

/** Ngoặc co giãn \left( … \right) / \begin{cases} → m:d */
const fenceChar = (n: XNode | undefined): string | null =>
  isEl(n) && n.tag === 'mo' && n.attrs.fence === 'true' ? textOf(n).trim().replace(/∣/g, '|') : null;

const convRow = (nodes: XNode[]): string => {
  const kids = nodes.filter(n => isEl(n) || n.trim() !== '');
  let out = '';
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (!isEl(k)) {
      out += run(k);
      continue;
    }
    // Tích phân / tổng / tích: phần còn lại của nhóm là biểu thức dưới dấu
    const scripted = ['msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover'].includes(k.tag);
    const chr = scripted ? baseNaryChar(k.children.filter(isEl)[0]) : k.tag === 'mo' ? baseNaryChar(k) : null;
    if (chr) {
      const c = elChildren(k);
      let sub: string | null = null;
      let sup: string | null = null;
      if (k.tag === 'msub' || k.tag === 'munder') sub = conv(c[1]);
      else if (k.tag === 'msup' || k.tag === 'mover') sup = conv(c[1]);
      else if (k.tag === 'msubsup' || k.tag === 'munderover') { sub = conv(c[1]); sup = conv(c[2]); }
      // Cận trên/dưới dấu (∑, ∏, ∫ ở display) hay cạnh dấu (∫ inline)
      const undOvr = k.tag.startsWith('mu') || (k.tag === 'mo' && !INTEGRALS.has(chr));
      out += naryXml(chr, sub, sup, undOvr, convRow(kids.slice(i + 1)));
      break;
    }
    // sin x, log_2 8, lim_{x→0} f(x): KaTeX đặt U+2061 sau tên hàm → m:func để Word giãn cách đúng
    const next = kids[i + 1];
    if (isEl(next) && next.tag === 'mo' && textOf(next) === FUNC_APPLY && kids[i + 2] !== undefined) {
      out += `<m:func>${sepTag('fName', conv(k))}${sepTag('e', conv(kids[i + 2]))}</m:func>`;
      i += 2;
      continue;
    }
    out += conv(k);
  }
  return out;
};

const ACC_TOP: Record<string, string> = {
  '→': '⃗', '⃗': '⃗', '⟶': '⃗', '←': '⃖', '↔': '⃡',
  '^': '̂', 'ˆ': '̂', '̂': '̂',
  '~': '̃', '˜': '̃', '̃': '̃',
  '˙': '̇', '̇': '̇', '¨': '̈', '̈': '̈',
  'ˇ': '̌', '˘': '̆', '´': '́', '`': '̀',
};
const BAR_CHARS = new Set(['‾', '¯', 'ˉ', '_', '̅', '̲', '−']);

const conv = (n: XNode | undefined): string => {
  if (n === undefined) return '';
  if (!isEl(n)) return n.trim() ? run(n) : '';
  const c = elChildren(n);
  switch (n.tag) {
    case 'annotation':
    case 'annotation-xml':
    case 'mphantom':
    case 'none':
    case 'mprescripts':
      return '';
    case 'mi': {
      const t = textOf(n);
      const variant = n.attrs.mathvariant || '';
      if (variant === 'double-struck') return run(toDoubleStruck(t));
      const italic = variant ? variant.includes('italic') : Array.from(t).length === 1;
      return run(t, italic, variant.includes('bold'));
    }
    case 'mn':
      return run(textOf(n), false, (n.attrs.mathvariant || '').includes('bold'));
    case 'mo': {
      const t = textOf(n);
      return INVISIBLE_OPS.test(t) ? '' : run(t);
    }
    case 'mtext':
    case 'ms':
      return run(textOf(n).replace(/ /g, ' '), (n.attrs.mathvariant || '').includes('italic'), (n.attrs.mathvariant || '').includes('bold'));
    case 'mspace': {
      const w = parseFloat(n.attrs.width || '0');
      if (w >= 0.9) return run(' ');
      if (w >= 0.2) return run(' ');
      if (w > 0.1) return run(' ');
      return '';
    }
    case 'mfrac': {
      const noBar = /^0(\.0*)?([a-z]+)?$/.test((n.attrs.linethickness || '').trim());
      return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"></m:type></m:fPr>' : ''}${sepTag('num', conv(c[0]))}${sepTag('den', conv(c[1]))}</m:f>`;
    }
    case 'msqrt':
      return `<m:rad><m:radPr><m:degHide m:val="on"></m:degHide></m:radPr><m:deg></m:deg>${sepTag('e', convRow(n.children))}</m:rad>`;
    case 'mroot':
      return `<m:rad><m:radPr></m:radPr>${sepTag('deg', conv(c[1]))}${sepTag('e', conv(c[0]))}</m:rad>`;
    case 'msup':
      return `<m:sSup>${sepTag('e', conv(c[0]))}${sepTag('sup', conv(c[1]))}</m:sSup>`;
    case 'msub': {
      // \lim_{x→0} ở dòng chữ: KaTeX đặt cận bên cạnh; trong Word cận luôn nằm dưới chữ lim
      const bt = visibleText(c[0]);
      if (LIM_LIKE.test(bt)) return `<m:limLow>${sepTag('e', run(bt))}${sepTag('lim', conv(c[1]))}</m:limLow>`;
      return `<m:sSub>${sepTag('e', conv(c[0]))}${sepTag('sub', conv(c[1]))}</m:sSub>`;
    }
    case 'msubsup':
      return `<m:sSubSup>${sepTag('e', conv(c[0]))}${sepTag('sub', conv(c[1]))}${sepTag('sup', conv(c[2]))}</m:sSubSup>`;
    case 'mover': {
      const over = unwrap(c[1]);
      const ot = isEl(over) && over.tag === 'mo' ? textOf(over).trim() : '';
      if (ot && BAR_CHARS.has(ot)) return `<m:bar><m:barPr><m:pos m:val="top"></m:pos></m:barPr>${sepTag('e', conv(c[0]))}</m:bar>`;
      if (ot === '⏞' || ot === '︷') return `<m:groupChr><m:groupChrPr><m:chr m:val="⏞"></m:chr><m:pos m:val="top"></m:pos><m:vertJc m:val="bot"></m:vertJc></m:groupChrPr>${sepTag('e', conv(c[0]))}</m:groupChr>`;
      if (ot && (ACC_TOP[ot] || n.attrs.accent === 'true')) {
        return `<m:acc><m:accPr><m:chr m:val="${escXml(ACC_TOP[ot] || ot)}"></m:chr></m:accPr>${sepTag('e', conv(c[0]))}</m:acc>`;
      }
      return `<m:limUpp>${sepTag('e', conv(c[0]))}${sepTag('lim', conv(c[1]))}</m:limUpp>`;
    }
    case 'munder': {
      const under = unwrap(c[1]);
      const ut = isEl(under) && under.tag === 'mo' ? textOf(under).trim() : '';
      if (ut && BAR_CHARS.has(ut)) return `<m:bar><m:barPr><m:pos m:val="bot"></m:pos></m:barPr>${sepTag('e', conv(c[0]))}</m:bar>`;
      if (ut === '⏟' || ut === '︸') return `<m:groupChr><m:groupChrPr><m:chr m:val="⏟"></m:chr></m:groupChrPr>${sepTag('e', conv(c[0]))}</m:groupChr>`;
      const bt = visibleText(c[0]);
      const baseXml = LIM_LIKE.test(bt) ? run(bt) : conv(c[0]);
      return `<m:limLow>${sepTag('e', baseXml)}${sepTag('lim', conv(c[1]))}</m:limLow>`;
    }
    case 'munderover':
      return `<m:limUpp>${sepTag('e', `<m:limLow>${sepTag('e', conv(c[0]))}${sepTag('lim', conv(c[1]))}</m:limLow>`)}${sepTag('lim', conv(c[2]))}</m:limUpp>`;
    case 'mtable': {
      const rows = c.filter(r => r.tag === 'mtr' || r.tag === 'mlabeledtr');
      const cells = rows.map(r => elChildren(r).filter(d => d.tag === 'mtd'));
      const ncols = Math.max(1, ...cells.map(r => r.length));
      const jc = (n.attrs.columnalign || '').trim().startsWith('left') ? 'left' : (n.attrs.columnalign || '').trim().startsWith('right') ? 'right' : 'center';
      const body = cells
        .map(r => `<m:mr>${Array.from({ length: ncols }, (_x, i) => sepTag('e', r[i] ? convRow(r[i].children) : '')).join('')}</m:mr>`)
        .join('');
      return `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${ncols}"></m:count><m:mcJc m:val="${jc}"></m:mcJc></m:mcPr></m:mc></m:mcs></m:mPr>${body}</m:m>`;
    }
    case 'menclose':
      return `<m:borderBox>${sepTag('e', convRow(n.children))}</m:borderBox>`;
    case 'mrow': {
      const kids = n.children.filter(isEl);
      const open = fenceChar(kids[0]);
      if (open !== null) {
        const last = kids.length > 1 ? fenceChar(kids[kids.length - 1]) : null;
        const inner = kids.slice(1, last !== null ? -1 : undefined);
        return `<m:d><m:dPr><m:begChr m:val="${escXml(open)}"></m:begChr><m:endChr m:val="${escXml(last ?? '')}"></m:endChr></m:dPr>${sepTag('e', convRow(inner))}</m:d>`;
      }
      return convRow(n.children);
    }
    default:
      // math, semantics, mstyle, mpadded, … → chỉ duyệt nội dung
      return convRow(n.children);
  }
};

/* ----------------------------- API ----------------------------- */

/** LaTeX → chuỗi Equation dạng HTML của Word. Trả null nếu KaTeX không đọc được công thức. */
export function latexToWordEquationHtml(tex: string, display = false): string | null {
  const src = tex.trim();
  if (!src) return null;
  let mathml: string;
  try {
    mathml = katex.renderToString(src, { output: 'mathml', displayMode: display, throwOnError: true, strict: 'ignore' });
  } catch {
    return null;
  }
  const m = mathml.match(/<math[\s\S]*<\/math>/);
  if (!m) return null;
  const body = conv(parseXml(m[0]));
  if (!body) return null;
  const omath = `<m:oMath>${body}</m:oMath>`;
  return `<!--[if gte msEquation 12]>${display ? `<m:oMathPara>${omath}</m:oMathPara>` : omath}<![endif]-->`;
}

/** Khai báo namespace mà Word cần để hiểu các thẻ <m:…> trong HTML. */
export const WORD_HTML_NAMESPACES =
  'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"';

/**
 * Thay các công thức đã được normalizeMathForWord bọc
 * (<span class="math-inline" data-mw="i">$…$</span>, <span class="math-display" … data-mw="d">$$…$$</span>)
 * bằng Equation của Word. Gọi TRƯỚC khi chuyển ký tự non-ASCII sang entity.
 */
export function convertMathSpansToWordEquations(html: string): { html: string; converted: number; failed: number } {
  let converted = 0;
  let failed = 0;
  const toTex = (s: string) => decodeEntities(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''));
  const replace = (whole: string, body: string, display: boolean) => {
    const eq = latexToWordEquationHtml(toTex(body), display);
    if (!eq) {
      failed++;
      return whole;
    }
    converted++;
    return eq;
  };
  let out = html.replace(/<span class="math-display"[^>]*data-mw="d">\$\$([\s\S]*?)\$\$<\/span>/g, (w, b: string) => replace(w, b, true));
  out = out.replace(/<span class="math-inline" data-mw="i">\$([\s\S]*?)\$<\/span>/g, (w, b: string) => replace(w, b, false));

  // Word chỉ nhận <m:…> khi thẻ <html> khai báo namespace m:
  if (converted > 0 && !/xmlns:m=/.test(out)) {
    out = /<html\b/i.test(out)
      ? out.replace(/<html\b/i, `<html ${WORD_HTML_NAMESPACES}`)
      : `<html ${WORD_HTML_NAMESPACES}><body>${out}</body></html>`;
  }
  return { html: out, converted, failed };
}

/**
 * Chuẩn hoá công thức trong HTML trước khi tạo file Word, theo lựa chọn của giáo viên.
 * Thay cho lời gọi normalizeMathForWord(html) ở các hàm xuất Word.
 */
export function prepareMathForWord(html: string, format: WordMathFormat = getWordMathFormat()): string {
  if (format !== 'equation') return normalizeMathForWord(html);
  // Đổi sang Equation trước, rồi mới chuyển non-ASCII sang entity (Word giải mã được cả bên trong Equation)
  const { html: out, converted, failed } = convertMathSpansToWordEquations(normalizeMathForWord(html, { encodeEntities: false }));
  if (failed > 0) console.warn(`[WordEquation] ${converted} công thức → Equation; ${failed} công thức giữ dạng $...$ (KaTeX không đọc được).`);
  return encodeNonAsciiToEntities(out);
}
