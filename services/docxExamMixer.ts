/**
 * services/docxExamMixer.ts
 * ------------------------------------------------------------------
 * TRỘN ĐỀ WORD: nhận 1 file .docx có sẵn → tạo nhiều mã đề .docx + bảng đáp án .xlsx.
 * Chạy 100% trên trình duyệt, không gọi AI, không tải đề lên máy chủ.
 *
 * Nguyên tắc: KHÔNG chuyển đổi nội dung. Chỉ di chuyển các nút XML trong word/document.xml, nên
 * MathType (w:object), Word Equation (m:oMath), ảnh (w:drawing, w:pict), bảng và các liên kết rId
 * đi nguyên khối theo câu/phương án. Các phần khác trong file (media, embeddings, styles...)
 * được giữ y nguyên.
 *
 *  - Nhãn "A." "B." đứng yên tại chỗ, chỉ đổi nội dung sau nhãn → giữ được bố cục dòng/bảng.
 *  - Chỉ đảo trong cùng phần và cùng dạng câu; số câu đánh theo vị trí.
 *  - Có nguy cơ sai thì KHÔNG đảo: "Cả A và B", câu nhắc tới câu khác, câu dùng chung dữ kiện.
 *  - Đề học sinh được bỏ bảng đáp án, lời giải và dấu đánh đáp án đúng (gạch chân, tô màu...).
 *  - Mỗi mã đề được đọc lại và đối chiếu với đề gốc trước khi giao cho giáo viên.
 *  - Chuẩn hóa hình thức theo mẫu "trộn đề/mẫu kết quả sau khi trộn": phương án xếp 4/2/1 cột theo
 *    độ rộng thật của công thức, nhãn đậm, tab 284, cỡ 12 Times New Roman, chân trang có mã đề.
 * ------------------------------------------------------------------
 */
import JSZip from 'jszip';
import { ANSWER_RE, PART_RE, ALT_PART_RE, EN_PART_RE, ESSAY_HEADING_RE } from './examValidator';
import { AnswerBook, ExamQuestion, parseAnswerKey } from './examShuffle';

export type MixKind = 'mc' | 'tf' | 'short' | 'essay';
export type AnswerSource = 'key' | 'solution' | 'mark' | null;

export interface MixStats {
  /** Công thức MathType / đối tượng nhúng (w:object) */
  objects: number;
  /** Word Equation (m:oMath) */
  equations: number;
  /** Ảnh, hình vẽ (w:drawing, w:pict) */
  images: number;
  tables: number;
}

export interface MixQuestion {
  id: number;
  part: number;
  num: number;
  kind: MixKind;
  preview: string;
  optionPreviews: string[];
  stats: MixStats;
  /** Đáp án đề gốc: mc "A", tf "ĐSĐS", short tự do */
  answer: string;
  answerSource: AnswerSource;
  pinned: boolean;
  lockOptions: boolean;
  /** Mã nhóm câu dùng chung dữ kiện */
  group: number | null;
  warnings: string[];
}

export interface MixPart {
  index: number;
  title: string;
  kind: MixKind | null;
}

export interface MixDocument {
  fileName: string;
  zip: JSZip;
  xml: string;
  headerFooters: Record<string, string>;
  env: DocEnv;
  parts: MixPart[];
  questions: MixQuestion[];
  stats: MixStats;
  notes: string[];
  conflicts: string[];
  removedAnswerSection: boolean;
  removedSolutions: number;
  codeFound: boolean;
  /** Đề gốc đã có chân trang riêng */
  hasFooter: boolean;
  textWidth: number;
  /** Độ rộng vùng chữ sau khi đưa lề trang về mẫu, dùng cho chân trang */
  normalizedTextWidth: number;
  /** Thông tin đọc được từ tiêu đề của đề gốc */
  detectedInfo: Partial<ExamInfo>;
}

/** Thông tin giáo viên khai báo để dựng tiêu đề đề thi */
export interface ExamInfo {
  department: string;
  school: string;
  examName: string;
  schoolYear: string;
  subject: string;
  duration: string;
}

export const EMPTY_EXAM_INFO: ExamInfo = { department: '', school: '', examName: '', schoolYear: '', subject: '', duration: '' };

export const hasExamInfo = (info?: ExamInfo): info is ExamInfo => !!info && Object.values(info).some(v => v.trim());

export interface MixSettings {
  count: number;
  startCode: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  shuffleStatements: boolean;
  keepTogether: boolean;
  /** Chuẩn hóa hình thức theo file mẫu */
  normalizeFormat: boolean;
  /** Có khai báo thì thay phần tiêu đề của đề gốc bằng tiêu đề theo mẫu; để trống thì giữ nguyên */
  examInfo?: ExamInfo;
  seed: number;
}

/** Giáo viên chỉnh sau khi duyệt */
export interface MixOverrides {
  answers: Record<number, string>;
  pinned: Record<number, boolean>;
  lockOptions: Record<number, boolean>;
  /** Câu này đi liền với câu kế tiếp */
  linkNext: Record<number, boolean>;
}

export interface PlannedQuestion {
  id: number;
  part: number;
  origNum: number;
  newNum: number;
  kind: MixKind;
  /** perm[vị trí mới] = vị trí phương án trong đề gốc; null nếu không đảo */
  perm: number[] | null;
  /** Đáp án trong mã đề này; "?" nếu đề gốc chưa có */
  answer: string;
}

export interface VersionPlan {
  code: string;
  /** Câu theo thứ tự mới, nhóm theo phần */
  questions: PlannedQuestion[];
}

export interface BuiltVersion {
  plan: VersionPlan;
  blob: Blob;
  problems: string[];
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const R_NS_ATTRS = ['r:id', 'r:embed', 'r:link', 'r:pict', 'r:dm', 'r:lo', 'r:qs', 'r:cs'];
const PLACEHOLDER = '￼';
const MC_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TF_LETTERS = ['a', 'b', 'c', 'd'];

/* ---------------------------- Trợ giúp XML ---------------------------- */

const els = (n: Node): Element[] => {
  const out: Element[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
};
const kid = (n: Node, name: string): Element | null => els(n).find(e => e.nodeName === name) || null;
const tags = (root: Element | Document, name: string): Element[] => {
  const list = root.getElementsByTagName(name);
  const out: Element[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i] as Element);
  return out;
};
const removeNode = (n: Node) => n.parentNode?.removeChild(n);
const unwrap = (el: Element) => {
  const p = el.parentNode;
  if (!p) return;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  p.removeChild(el);
};
const parseXml = (xml: string): Document => {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (tags(dom, 'parsererror').length) throw new Error('File Word bị lỗi cấu trúc XML, không đọc được.');
  return dom;
};
const serializeXml = (dom: Document): string => {
  const s = new XMLSerializer().serializeToString(dom);
  return /^\s*<\?xml/.test(s) ? s : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`;
};
const wAttr = (el: Element | null, name: string): string | null => {
  if (!el) return null;
  return el.getAttribute(`w:${name}`);
};
const newW = (dom: Document, name: string): Element => dom.createElementNS(dom.documentElement.namespaceURI, `w:${name}`);
const setWAttr = (el: Element, name: string, value: string) => el.setAttributeNS(el.ownerDocument!.documentElement.namespaceURI, `w:${name}`, value);

/* ---------------------------- Môi trường tài liệu: danh sách tự đánh số ---------------------------- */

interface LevelInfo { fmt: string; text: string }
interface DocEnv {
  levels: Map<string, LevelInfo>;
  styleNum: Map<string, { numId: string; ilvl: string }>;
  rels: Set<string>;
}

const readEnv = async (zip: JSZip): Promise<DocEnv> => {
  const env: DocEnv = { levels: new Map(), styleNum: new Map(), rels: new Set() };
  const numbering = zip.file('word/numbering.xml');
  if (numbering) {
    const dom = parseXml(await numbering.async('string'));
    const readLvl = (lvl: Element): LevelInfo => ({ fmt: wAttr(kid(lvl, 'w:numFmt'), 'val') || '', text: wAttr(kid(lvl, 'w:lvlText'), 'val') || '' });
    const abstracts = new Map<string, Map<string, LevelInfo>>();
    for (const a of tags(dom, 'w:abstractNum')) {
      const m = new Map<string, LevelInfo>();
      for (const lvl of els(a).filter(e => e.nodeName === 'w:lvl')) m.set(wAttr(lvl, 'ilvl') || '0', readLvl(lvl));
      abstracts.set(wAttr(a, 'abstractNumId') || '', m);
    }
    for (const num of tags(dom, 'w:num')) {
      const numId = wAttr(num, 'numId') || '';
      const base = abstracts.get(wAttr(kid(num, 'w:abstractNumId'), 'val') || '');
      base?.forEach((info, ilvl) => env.levels.set(`${numId}:${ilvl}`, info));
      for (const o of els(num).filter(e => e.nodeName === 'w:lvlOverride')) {
        const lvl = kid(o, 'w:lvl');
        if (lvl) env.levels.set(`${numId}:${wAttr(o, 'ilvl') || '0'}`, readLvl(lvl));
      }
    }
  }
  const styles = zip.file('word/styles.xml');
  if (styles) {
    const dom = parseXml(await styles.async('string'));
    for (const st of tags(dom, 'w:style')) {
      const numPr = kid(kid(st, 'w:pPr') || st, 'w:numPr');
      const numId = wAttr(numPr ? kid(numPr, 'w:numId') : null, 'val');
      if (numId) env.styleNum.set(wAttr(st, 'styleId') || '', { numId, ilvl: wAttr(numPr ? kid(numPr, 'w:ilvl') : null, 'val') || '0' });
    }
  }
  const rels = zip.file('word/_rels/document.xml.rels');
  if (rels) {
    for (const m of (await rels.async('string')).matchAll(/\bId="([^"]+)"/g)) env.rels.add(m[1]);
  }
  return env;
};

const listLevelOf = (p: Element, env: DocEnv): LevelInfo | null => {
  const pPr = kid(p, 'w:pPr');
  if (!pPr) return null;
  const numPr = kid(pPr, 'w:numPr');
  let numId = numPr ? wAttr(kid(numPr, 'w:numId'), 'val') : null;
  let ilvl = numPr ? wAttr(kid(numPr, 'w:ilvl'), 'val') : null;
  if (!numId) {
    const style = wAttr(kid(pPr, 'w:pStyle'), 'val');
    const fromStyle = style ? env.styleNum.get(style) : undefined;
    if (fromStyle) {
      numId = fromStyle.numId;
      ilvl = ilvl ?? fromStyle.ilvl;
    }
  }
  if (!numId || numId === '0') return null;
  return env.levels.get(`${numId}:${ilvl || '0'}`) || null;
};
const listIdOf = (p: Element): string => {
  const numPr = kid(kid(p, 'w:pPr') || p, 'w:numPr');
  return wAttr(numPr ? kid(numPr, 'w:numId') : null, 'val') || 'style';
};

/* ---------------------------- Luồng ký tự của một đoạn văn ---------------------------- */

interface Seg { node: Element; start: number; end: number }
interface Stream { text: string; segs: Seg[]; chars: Array<{ t: Element; i: number } | null> }

/** Chữ thật ở đúng vị trí; công thức/hình là 1 ký tự giữ chỗ. */
const streamOf = (p: Element): Stream => {
  let text = '';
  const segs: Seg[] = [];
  const chars: Stream['chars'] = [];
  const push = (s: string) => { text += s; for (let i = 0; i < s.length; i++) chars.push(null); };
  for (const node of els(p)) {
    if (node.nodeName === 'w:pPr') continue;
    const start = text.length;
    if (node.nodeName === 'w:r') {
      for (const c of els(node)) {
        switch (c.nodeName) {
          case 'w:rPr': case 'w:instrText': case 'w:delInstrText': case 'w:delText': case 'w:fldChar':
          case 'w:softHyphen': case 'w:lastRenderedPageBreak': case 'w:annotationRef':
            break;
          case 'w:t': {
            const s = c.textContent || '';
            for (let i = 0; i < s.length; i++) chars.push({ t: c, i });
            text += s;
            break;
          }
          case 'w:tab': case 'w:ptab': push('\t'); break;
          case 'w:br': case 'w:cr': push('\n'); break;
          case 'w:noBreakHyphen': push('-'); break;
          default: push(PLACEHOLDER);
        }
      }
    } else if (node.nodeName === 'm:oMath' || node.nodeName === 'm:oMathPara') {
      push(PLACEHOLDER);
    } else if (node.nodeName === 'w:hyperlink' || node.nodeName === 'w:fldSimple') {
      push(tags(node, 'w:t').map(t => t.textContent || '').join(''));
    }
    segs.push({ node, start, end: text.length });
  }
  return { text, segs, chars };
};

const setText = (t: Element, s: string) => {
  t.textContent = s;
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
};

/** Mỗi w:r chỉ giữ 1 phần tử nội dung để có thể di chuyển chính xác từng phần. */
const atomizeRuns = (p: Element) => {
  for (const run of els(p)) {
    if (run.nodeName !== 'w:r') continue;
    const rPr = kid(run, 'w:rPr');
    const contents = els(run).filter(c => c.nodeName !== 'w:rPr');
    let cur: Node = run;
    for (let i = 1; i < contents.length; i++) {
      const nr = run.cloneNode(false) as Element;
      if (rPr) nr.appendChild(rPr.cloneNode(true));
      nr.appendChild(contents[i]);
      p.insertBefore(nr, cur.nextSibling);
      cur = nr;
    }
  }
};

/** Bảo đảm có ranh giới nút tại các vị trí ký tự. */
const cutAt = (p: Element, offsets: number[]) => {
  const sorted = Array.from(new Set(offsets)).sort((a, b) => b - a);
  for (const off of sorted) {
    const seg = streamOf(p).segs.find(s => s.start < off && off < s.end);
    if (!seg || seg.node.nodeName !== 'w:r') continue;
    const t = kid(seg.node, 'w:t');
    if (!t) continue;
    const s = t.textContent || '';
    const k = off - seg.start;
    const right = seg.node.cloneNode(true) as Element;
    setText(t, s.slice(0, k));
    setText(kid(right, 'w:t')!, s.slice(k));
    p.insertBefore(right, seg.node.nextSibling);
  }
};

/** Thay đoạn chữ [start, end) kể cả khi nó nằm rải trên nhiều w:t. */
const replaceRange = (p: Element, start: number, end: number, value: string) => {
  const { chars } = streamOf(p);
  const touched = new Map<Element, number[]>();
  let first: { t: Element; i: number } | null = null;
  for (let i = start; i < end; i++) {
    const c = chars[i];
    if (!c) continue;
    if (!first) first = c;
    if (!touched.has(c.t)) touched.set(c.t, []);
    touched.get(c.t)!.push(c.i);
  }
  if (!first) {
    const before = chars[start - 1];
    if (!before) return false;
    const s = before.t.textContent || '';
    setText(before.t, s.slice(0, before.i + 1) + value + s.slice(before.i + 1));
    return true;
  }
  touched.forEach((idx, t) => {
    const s = t.textContent || '';
    const drop = new Set(idx);
    let out = '';
    for (let i = 0; i <= s.length; i++) {
      if (t === first!.t && i === first!.i) out += value;
      if (i < s.length && !drop.has(i)) out += s[i];
    }
    setText(t, out);
  });
  return true;
};

const blockText = (b: Element): string => (b.nodeName === 'w:p' ? streamOf(b).text : '');
const isBlank = (b: Element) => b.nodeName === 'w:p' && !blockText(b).replace(/\s/g, '') && !hasFloating(b);
const hasFloating = (b: Element) => tags(b, 'w:drawing').length + tags(b, 'w:pict').length + tags(b, 'w:object').length > 0;
const tableRows = (tbl: Element): string[][] =>
  els(tbl).filter(e => e.nodeName === 'w:tr').map(tr =>
    els(tr).filter(e => e.nodeName === 'w:tc').map(tc =>
      els(tc).filter(e => e.nodeName === 'w:p').map(blockText).join(' ').replace(PLACEHOLDER, '').trim()));

const blockPlain = (b: Element): string =>
  b.nodeName === 'w:tbl'
    ? tableRows(b).map(r => `| ${r.join(' | ')} |`).join('\n')
    : blockText(b).split(PLACEHOLDER).join(' ').replace(/\s+/g, ' ').trim();

/* ---------------------------- Chuẩn hóa trước khi phân tích ---------------------------- */

const prepareBody = (body: Element, keepBookmarks: Set<string>) => {
  for (const name of ['w:del', 'w:moveFrom', 'w:proofErr', 'w:rPrChange', 'w:pPrChange', 'w:sectPrChange', 'w:tblPrChange', 'w:trPrChange', 'w:tcPrChange', 'w:lastRenderedPageBreak', 'w:moveFromRangeStart', 'w:moveFromRangeEnd', 'w:moveToRangeStart', 'w:moveToRangeEnd']) {
    tags(body, name).forEach(removeNode);
  }
  for (const name of ['w:ins', 'w:moveTo', 'w:smartTag', 'w:customXml']) {
    for (const el of tags(body, name)) {
      const parent = el.parentNode as Element | null;
      if (parent && ['w:rPr', 'w:trPr', 'w:tcPr'].includes(parent.nodeName)) removeNode(el);
      else unwrap(el);
    }
  }
  for (const sdt of tags(body, 'w:sdt')) {
    const content = kid(sdt, 'w:sdtContent');
    if (content && sdt.parentNode) {
      while (content.firstChild) sdt.parentNode.insertBefore(content.firstChild, sdt);
      removeNode(sdt);
    }
  }
  // Dấu trang đi cặp; câu bị di chuyển có thể làm cặp này đảo ngược nên bỏ các dấu không được tham chiếu
  const dropIds = new Set<string>();
  for (const b of tags(body, 'w:bookmarkStart')) {
    if (!keepBookmarks.has(wAttr(b, 'name') || '')) {
      dropIds.add(wAttr(b, 'id') || '');
      removeNode(b);
    }
  }
  for (const b of tags(body, 'w:bookmarkEnd')) {
    if (dropIds.has(wAttr(b, 'id') || '')) removeNode(b);
  }
  tags(body, 'w:p').forEach(atomizeRuns);
};

/* ---------------------------- Nhận diện ---------------------------- */

// "Câu 12.", "Câu 12:", "Câu 12 (NB)." kể cả phông cũ TCVN3 ("C©u") và chữ tổ hợp
const QUESTION_LABEL = /^([\s￼]*)((?:C(?:â|Â|â|Â|©|¢)[uU]|Question|QUESTION|Bài|BÀI)\s*)(\d{1,3})(?=\s*(?:\([^)]*\)|\[[^\]]*\])?\s*(?:[.:)\-–—]|\s|$|￼))/;
const GROUP_HEAD = /^\s*C(?:â|Â)[uU]\s*\d+\s*(?:và|đến|tới|,|-|–|—|&)\s*(?:c(?:â|Â)[uU]\s*)?\d+/;
const GROUP_REF = /c[âa]u\s*(?:hỏi\s*)?(?:số\s*)?(\d{1,3})((?:\s*(?:,|;|và|đến|tới|-|–|—|&)\s*(?:c[âa]u\s*(?:hỏi\s*)?(?:số\s*)?)?\d{1,3})+)/i;
const GROUP_COUNT = /(\d|hai|ba|bốn|năm|sáu)\s*c[âa]u\s*(?:hỏi\s*)?(?:tiếp\s*theo|kế\s*tiếp|sau|dưới\s*đây)/i;
const GROUP_CUE = /dựa|căn\s*cứ|sử\s*dụng|dùng|đọc|cho\s|thông\s*tin|dữ\s*kiện|bảng|hình|đoạn|đồ\s*thị|sơ\s*đồ|thí\s*nghiệm|trả\s*lời|từ\s*câu|c[âa]u\s*\d+\s*(?:và|đến|,)/i;
const GROUP_NOT = /thí\s*sinh|học\s*sinh|mỗi\s*câu/i;
const TAIL_END_RE = /^[\s\-–—_.*=~•·]*H[ẾE]T\b/i;
const TAIL_NOTE_RE = /^[\s\-–—_.*=~•·]*(?:Thí sinh|Cán bộ|Giám thị).{0,50}(?:không được|không giải thích)/i;
const PLAIN_PART = /^\s*(?:(?:[A-D]|[IVX]+)\s*[.:]\s*)?(?:PHẦN\s+)?(TRẮC\s*NGHIỆM|TỰ\s*LUẬN)\b/i;
const SOLUTION_RE = /^\s*(?:L[ờơ]i\s*gi[ảa]i|LỜI\s*GIẢI|H[ưƯ][ớỚ]ng\s*d[ẫẪ]n(?:\s*gi[ảa]i)?\s*(?:[:.]|$)|H[ưƯ][ớỚ]ng\s*d[ẫẪ]n\s*gi[ảa]i|HDG\b|Gi[ảa]i\s*[:.]|Ch[ọo]n\s*(?:đáp\s*án\s*)?[A-F](?=$|[\s,.;:)])|Đ[áa]p\s*[áa]n\s*(?:đúng\s*)?(?:là\s*)?(?:[:.]|[A-F](?=$|[\s,.;:)])|$)|ĐÁP\s*ÁN\s*[:.]?|Đ[áa]p\s*s[ốo]\s*[:.]|ĐS\s*[:.]|Tr[ảa]\s*l[ờơ]i\s*[:.]|K[ếe]t\s*qu[ảa]\s*[:.])/;
const SHORT_ANSWER_LINE = /^\s*A\s*[.:)]\s*(\S.*?)\s*$/;
const LOCK_OPTION_RE = /cả\s+(?:hai|ba|bốn|2|3|4|[A-F](?=$|[\s,.;:)]))|(?:^|[\s(])[A-F]\s*(?:và|,|hoặc|&)\s*[A-F](?:$|[\s,.;)])|^\s*tất\s*cả\s*(?:các\s*)?(?:đáp\s*án|phương\s*án|ý|câu|đều|trên)|tất\s*cả\s*(?:các\s*)?(?:đáp\s*án|phương\s*án|ý|câu)\s*(?:trên|đều)|không\s*có\s*(?:đáp\s*án|phương\s*án|ý|câu|chất|trường\s*hợp)|(?:đáp\s*án|phương\s*án|ý|câu)\s*(?:trên|còn\s*lại|khác)|(?:đều|cùng)\s*(?:đúng|sai)|both\b|all\s+of\s+the|none\s+of\s+the/i;
const LOCK_STATEMENT_RE = /(?:^|[\s(])(?:ý|mệnh\s*đề|phát\s*biểu|câu)\s*[a-d](?:$|[\s,.;:)])|(?:ý|mệnh\s*đề|kết\s*quả)\s*(?:trên|trước)|từ\s*(?:kết\s*quả\s*)?ý/i;
const REF_QUESTION_RE = /c[âa]u\s*(?:hỏi\s*)?(?:trên|trước|số?\s*\d+|\d+)/i;
const REF_FIGURE_RE = /(?:hình|bảng|đồ\s*thị|sơ\s*đồ)\s*(?:vẽ\s*)?(?:trên|trước)|(?:hình|bảng)\s*ở\s*(?:trên|câu)/i;

const RESTART_NOTE = 'Số câu được đánh lại từ đầu ở giữa file; app coi đó là phần riêng và không trộn lẫn sang nhau.';

const looksLikePartHeading = (t: string): boolean => {
  if (!t || t.length > 260 || QUESTION_LABEL.test(t)) return false;
  return PART_RE.test(t) || ALT_PART_RE.test(t) || ESSAY_HEADING_RE.test(t) || EN_PART_RE.test(t) || PLAIN_PART.test(t);
};

const partKindOf = (t: string): MixKind | null => {
  const s = t.toLowerCase();
  if (/đúng\s*[-–\/]?\s*sai/.test(s)) return 'tf';
  if (/trả\s*lời\s*ngắn/.test(s)) return 'short';
  if (/tự\s*luận/.test(s)) return 'essay';
  if (/trắc\s*nghiệm|nhiều\s*(?:phương\s*án|lựa\s*chọn)/.test(s)) return 'mc';
  return null;
};

const parseGroupRef = (t: string): { nums: number[]; count: number } | null => {
  const m = GROUP_REF.exec(t);
  if (m) {
    const parts = [...m[0].matchAll(/(đến|tới|-|–|—)?\s*(?:c[âa]u\s*(?:hỏi\s*)?(?:số\s*)?)?(\d{1,3})/gi)];
    const nums: number[] = [];
    for (const p of parts) {
      const v = parseInt(p[2], 10);
      if (p[1] && nums.length) {
        for (let k = nums[nums.length - 1] + 1; k <= v && nums.length < 30; k++) nums.push(k);
      } else {
        nums.push(v);
      }
    }
    if (nums.length >= 2) return { nums, count: nums.length };
  }
  const c = GROUP_COUNT.exec(t);
  if (c) {
    const word: Record<string, number> = { hai: 2, ba: 3, 'bốn': 4, 'năm': 5, 'sáu': 6 };
    const n = word[c[1].toLowerCase()] ?? parseInt(c[1], 10);
    if (n >= 2) return { nums: [], count: n };
  }
  return null;
};

/* ---------------------------- Phương án ---------------------------- */

interface Token { para: Element; letter: string; start: number; labelEnd: number; first: boolean; strong: boolean; star: boolean; auto: boolean }

const scanTokens = (p: Element, env: DocEnv, lower: boolean, skipLabelOf: Element | null): Token[] => {
  const text = streamOf(p).text;
  const out: Token[] = [];
  const isLetter = (c: string) => (lower ? c >= 'a' && c <= 'f' : c >= 'A' && c <= 'F');
  const begin = skipLabelOf === p ? (QUESTION_LABEL.exec(text)?.[0].length ?? 0) : 0;
  for (let i = begin; i < text.length; i++) {
    const c = text[i];
    if (!isLetter(c)) continue;
    const prev = i > begin ? text[i - 1] : '';
    if (prev && !/[\s￼*]/.test(prev)) continue;
    let j = i + 1;
    while (text[j] === ' ') j++;
    const punct = text[j];
    if (!(punct === '.' || punct === ')' || (!lower && punct === ':'))) continue;
    const next = text[j + 1];
    if (lower && next !== undefined && punct === '.' && !/[\s￼]/.test(next)) continue;
    const star = prev === '*';
    const start = star ? i - 1 : i;
    const before = text.slice(begin, start);
    const first = !before.replace(/[\s￼]/g, '');
    const strong = first || /\t|\n| {2,}$/.test(before.slice(-3)) || /\t\s*$/.test(before);
    out.push({ para: p, letter: c, start, labelEnd: j + 1, first, strong, star, auto: false });
  }
  return out;
};

const pickChain = (tokens: Token[], letters: string[], strictOnly: boolean): Token[] | null => {
  const usable = strictOnly ? tokens.filter(t => t.strong) : tokens;
  for (let s = usable.length - 1; s >= 0; s--) {
    const a = usable[s];
    if (a.letter !== letters[0] || !a.first) continue;
    const chain = [a];
    for (let k = s + 1; k < usable.length; k++) {
      const t = usable[k];
      const expected = letters[chain.length];
      if (t.letter === letters[0] && t.first) break;
      if (!expected || t.letter !== expected) continue;
      if (chain.length >= 4 && !t.first && !t.strong) continue; // "D. E. coli" không phải phương án E
      if (t.first || t.strong || t.para === chain[chain.length - 1].para) chain.push(t);
    }
    if (chain.length >= 3) return chain;
  }
  return null;
};

interface Slot {
  letter: string;
  para: Element;
  label: Element[];
  lead: Element[];
  content: Element[];
  trail: Element[];
  extra: Element[];
  star: boolean;
  auto: boolean;
  /** Trước nhãn đầu đoạn không có nội dung gì khác, có thể dựng lại đoạn */
  preOk: boolean;
}

const buildSlots = (chain: Token[], topBlocks: Element[]): Slot[] => {
  const slots: Slot[] = [];
  const paras: Element[] = [];
  for (const t of chain) if (!paras.includes(t.para)) paras.push(t.para);
  for (const para of paras) {
    const toks = chain.filter(t => t.para === para);
    const text = streamOf(para).text;
    const preOk = !text.slice(0, toks[0].start).trim();
    const cuts: number[] = [];
    const ranges = toks.map((t, k) => {
      const limit = k + 1 < toks.length ? toks[k + 1].start : text.length;
      let cs = t.labelEnd;
      while (cs < limit && /\s/.test(text[cs])) cs++;
      let ce = limit;
      while (ce > cs && /\s/.test(text[ce - 1])) ce--;
      cuts.push(t.start, t.labelEnd, cs, ce, limit);
      return { limit, cs, ce };
    });
    cutAt(para, cuts);
    const segs = streamOf(para).segs;
    toks.forEach((t, k) => {
      const { limit, cs, ce } = ranges[k];
      const inRange = (a: number, b: number) => segs.filter(s => s.end > s.start && s.start >= a && s.end <= b).map(s => s.node);
      const content = cs < ce
        ? segs.filter(s => (s.end > s.start ? s.start >= cs && s.end <= ce : s.node.nodeName === 'w:r' && s.start >= cs && s.start <= ce)).map(s => s.node)
        : [];
      slots.push({
        letter: t.letter,
        para,
        label: inRange(t.start, t.labelEnd),
        lead: inRange(t.labelEnd, cs),
        content,
        trail: inRange(ce, limit),
        extra: [],
        star: t.star,
        auto: t.auto,
        preOk,
      });
    });
  }

  // Đoạn nằm giữa hai phương án (phương án dạng hình, nhiều dòng) đi theo phương án đứng trước
  const lastOfPara = (i: number) => i + 1 === slots.length || slots[i + 1].para !== slots[i].para;
  slots.forEach((s, i) => {
    if (!lastOfPara(i)) return;
    const stop = i + 1 < slots.length ? slots[i + 1].para : null;
    for (let n = s.para.nextSibling as Node | null; n && n !== stop; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      const el = n as Element;
      if (s.para.parentNode?.nodeName === 'w:body' && !topBlocks.includes(el)) break;
      if (['w:tcPr', 'w:sectPr'].includes(el.nodeName)) continue;
      s.extra.push(el);
    }
    if (s.extra.every(isBlank)) s.extra = [];
  });
  // Khối sau phương án cuối chỉ thuộc phương án khi các phương án trước cũng có khối riêng;
  // còn lại là phần chung của câu (hình, ghi chú) và phải đứng yên.
  const last = slots[slots.length - 1];
  if (last.extra.length && !slots.slice(0, -1).some(s => s.extra.length)) last.extra = [];
  return slots;
};

/* ---------------------------- Dấu đánh đáp án đúng ---------------------------- */

type MarkProp = 'u' | 'color' | 'highlight' | 'shd' | 'b';
const MARK_TAG: Record<MarkProp, string> = { u: 'w:u', color: 'w:color', highlight: 'w:highlight', shd: 'w:shd', b: 'w:b' };

const runMark = (run: Element, prop: MarkProp): string | null => {
  const el = kid(kid(run, 'w:rPr') || run, MARK_TAG[prop]);
  if (!el) return null;
  if (prop === 'shd') {
    const fill = (wAttr(el, 'fill') || '').toUpperCase();
    return !fill || fill === 'AUTO' || fill === 'FFFFFF' ? null : fill;
  }
  const v = (wAttr(el, 'val') || '').toUpperCase();
  if (prop === 'color') return !v || v === 'AUTO' || v === '000000' ? null : v;
  if (prop === 'b') return v === '0' || v === 'FALSE' ? null : 'B';
  return v === 'NONE' ? null : (prop === 'u' ? 'U' : v || 'H');
};

const textRuns = (nodes: Element[]) => nodes.filter(n => n.nodeName === 'w:r' && (kid(n, 'w:t')?.textContent || '').trim());

const groupMark = (nodes: Element[], prop: MarkProp): string | null => {
  const runs = textRuns(nodes);
  if (!runs.length) return null;
  const weights = new Map<string, number>();
  let total = 0;
  for (const r of runs) {
    const n = (kid(r, 'w:t')?.textContent || '').trim().length;
    total += n;
    const v = runMark(r, prop);
    if (v) weights.set(v, (weights.get(v) || 0) + n);
  }
  let best: string | null = null;
  let bestW = 0;
  weights.forEach((w, v) => { if (w > bestW) { best = v; bestW = w; } });
  return best && bestW / total >= 0.7 ? best : null;
};

/** Dấu trên nhãn tính theo run chứa chữ cái A/B/a/b, vì giáo viên thường chỉ tô riêng chữ cái. */
const labelMark = (nodes: Element[], prop: MarkProp): string | null => {
  const run = textRuns(nodes).find(r => /[A-Fa-f]/.test(kid(r, 'w:t')?.textContent || ''));
  return run ? runMark(run, prop) : null;
};

interface MarkResult {
  marked: number[];
  props: Array<{ scope: 'label' | 'content'; prop: MarkProp }>;
}

const MC_MARK_ORDER: Array<{ scope: 'label' | 'content'; prop: MarkProp }> = [
  { scope: 'label', prop: 'u' }, { scope: 'label', prop: 'color' }, { scope: 'label', prop: 'highlight' }, { scope: 'label', prop: 'shd' },
  { scope: 'content', prop: 'u' }, { scope: 'content', prop: 'color' }, { scope: 'content', prop: 'highlight' }, { scope: 'content', prop: 'shd' },
  { scope: 'label', prop: 'b' },
];

const detectMarks = (slots: Slot[], kind: MixKind): MarkResult => {
  const res: MarkResult = { marked: [], props: [] };
  if (kind === 'mc') {
    const stars = slots.map((s, i) => (s.star ? i : -1)).filter(i => i >= 0);
    if (stars.length === 1) res.marked = stars;
  }
  for (const item of MC_MARK_ORDER) {
    const vals = slots.map(s => (item.scope === 'label' ? labelMark(s.label, item.prop) : groupMark(s.content, item.prop)));
    const present = vals.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
    if (!present.length) continue;
    const distinct = new Set(vals.map(v => v || ''));
    if (distinct.size === 1) {
      // Đ/S: cả 4 ý đều gạch chân/tô nền nghĩa là cả 4 đúng (màu chữ có thể chỉ là trang trí)
      if (kind === 'tf' && (item.prop === 'u' || item.prop === 'highlight') && item.scope === 'label') {
        if (!res.marked.length) res.marked = present;
        res.props.push(item);
      }
      continue;
    }
    if (kind === 'mc') {
      const minority = Array.from(distinct).filter(v => v && vals.filter(x => (x || '') === v).length === 1);
      if (distinct.size === 2 && minority.length === 1) {
        const idx = vals.findIndex(v => (v || '') === minority[0]);
        if (!res.marked.length) res.marked = [idx];
        res.props.push(item);
      } else if (item.prop !== 'b' && item.prop !== 'color' && present.length >= 2) {
        // Nhiều phương án cùng được đánh dấu: không dùng làm đáp án nhưng vẫn phải xóa dấu
        res.props.push(item);
      }
    } else {
      // Đ/S: ý được đánh dấu là ý đúng; nếu ý nào cũng có màu thì màu đỏ là dấu
      const hasNull = vals.some(v => !v);
      const marked = hasNull ? present : vals.map((v, i) => (v && /^(FF0000|C00000|E[0-9A-F]0000|F[0-9A-F]0000)$/.test(v) ? i : -1)).filter(i => i >= 0);
      if (marked.length) {
        if (!res.marked.length) res.marked = marked;
        res.props.push(item);
      }
    }
  }
  return res;
};

const removeRunMark = (run: Element, prop: MarkProp) => {
  const rPr = kid(run, 'w:rPr');
  const el = rPr ? kid(rPr, MARK_TAG[prop]) : null;
  if (el) removeNode(el);
  if (prop === 'b' && rPr) { const cs = kid(rPr, 'w:bCs'); if (cs) removeNode(cs); }
};

/** Xóa dấu đáp án: nhãn đưa về đúng định dạng nhãn thường, nội dung bỏ thuộc tính đánh dấu. */
const cleanMarks = (slots: Slot[], result: MarkResult) => {
  for (const s of slots) {
    if (!s.star) continue;
    const text = streamOf(s.para).text;
    const first = s.label.find(n => n.nodeName === 'w:r' && (kid(n, 'w:t')?.textContent || '').includes('*'));
    if (first) {
      const t = kid(first, 'w:t')!;
      setText(t, (t.textContent || '').replace('*', ''));
    } else if (text.includes('*')) {
      const at = text.indexOf('*');
      replaceRange(s.para, at, at + 1, '');
    }
  }
  if (!result.props.length) return;
  const marked = new Set(result.marked);
  const ref = slots.find((_, i) => !marked.has(i));
  for (const { scope, prop } of result.props) {
    slots.forEach((s, i) => {
      if (scope === 'label') {
        const refRun = ref ? textRuns(ref.label)[0] : null;
        const isMarked = !!labelMark(s.label, prop);
        for (const run of textRuns(s.label)) {
          if (prop === 'b' && !marked.has(i)) continue;
          if (refRun && marked.has(i) && run !== refRun) {
            const old = kid(run, 'w:rPr');
            const fresh = kid(refRun, 'w:rPr');
            if (old) removeNode(old);
            if (fresh) run.insertBefore(fresh.cloneNode(true), run.firstChild);
          } else if (isMarked && !refRun) {
            removeRunMark(run, prop);
          } else if (isMarked && prop !== 'color' && prop !== 'b') {
            removeRunMark(run, prop);
          }
        }
      } else if (marked.has(i) || groupMark(s.content, prop)) {
        const refVal = ref ? groupMark(ref.content, prop) : null;
        const runs = [...s.content.filter(n => n.nodeName === 'w:r'), ...s.extra.flatMap(block => tags(block, 'w:r'))];
        if (!refVal) {
          runs.forEach(run => removeRunMark(run, prop));
        } else if (prop === 'color' && groupMark(s.content, prop) !== refVal) {
          runs.forEach(run => {
            const el = kid(kid(run, 'w:rPr') || run, 'w:color');
            if (el) setWAttr(el, 'val', refVal);
          });
        }
      }
    });
  }
};

/* ---------------------------- Phân tích toàn văn bản ---------------------------- */

interface AQuestion {
  id: number;
  part: number;
  num: number;
  auto: boolean;
  /** Khối dùng chung đứng trước câu (chỉ ở câu đầu nhóm) */
  lead: Element[];
  blocks: Element[];
  retained: Element[];
  solution: Element[];
  kind: MixKind;
  slots: Slot[] | null;
  mark: MarkResult;
  group: number | null;
  groupRef: boolean;
  warnings: string[];
  pinned: boolean;
  lockOptions: boolean;
  markedAnswer: string;
  solutionAnswer: string;
  stemFp: string;
  optionFps: string[];
  position: number;
  /** Đoạn phương án đã dựng lại theo mẫu, không chỉnh thêm định dạng đoạn */
  rebuilt: Set<Element>;
}

interface APart {
  index: number;
  title: string;
  kind: MixKind | null;
  roman: string;
  heading: Element[];
  questions: AQuestion[];
  sects: Array<{ position: number; sect: Element }>;
  /** Dàn ý/hướng dẫn đầu file (như file mẫu), không phải nội dung đề */
  outline?: boolean;
}

interface Analysis {
  dom: Document;
  body: Element;
  finalSect: Element | null;
  front: Element[];
  tail: Element[];
  parts: APart[];
  questions: AQuestion[];
  answerBlocks: Element[];
  notes: string[];
}

const countStats = (blocks: Element[]): MixStats => {
  const s: MixStats = { objects: 0, equations: 0, images: 0, tables: 0 };
  for (const b of blocks) {
    s.objects += tags(b, 'w:object').length;
    s.equations += tags(b, 'm:oMath').length;
    s.images += tags(b, 'w:drawing').length + tags(b, 'w:pict').length;
    s.tables += tags(b, 'w:tbl').length + (b.nodeName === 'w:tbl' ? 1 : 0);
  }
  return s;
};

/** Dấu vân tay của nội dung: chữ + công thức + rId, không phụ thuộc định dạng. */
const fingerprint = (nodes: Element[], skip?: Set<Element>): string => {
  let out = '';
  const walk = (el: Element) => {
    if (skip?.has(el)) return;
    if (el.nodeName === 'w:rPr' || el.nodeName === 'w:pPr') return;
    if (el.nodeName === 'w:t' || el.nodeName === 'm:t') out += el.textContent || '';
    for (const a of R_NS_ATTRS) {
      const v = el.getAttribute(a);
      if (v) out += `{${v}}`;
    }
    els(el).forEach(walk);
  };
  nodes.forEach(walk);
  return out.replace(/\s+/g, '').normalize('NFC');
};

const answerTableLike = (tbl: Element): boolean => {
  const cells = tableRows(tbl).flat().filter(Boolean);
  if (cells.length < 5) return false;
  const letters = cells.filter(c => /^(?:[A-F]|Đ|S)\.?$/.test(c)).length;
  return letters / cells.length >= 0.3 && cells.some(c => /^\d{1,3}$|^Câu/i.test(c));
};

const collectBlockParagraphs = (blocks: Element[]): Element[] => {
  const out: Element[] = [];
  const add = (el: Element) => {
    if (el.nodeName === 'w:p') out.push(el);
    else if (el.nodeName === 'w:tbl') {
      for (const tr of els(el)) if (tr.nodeName === 'w:tr') for (const tc of els(tr)) if (tc.nodeName === 'w:tc') els(tc).forEach(add);
    }
  };
  blocks.forEach(add);
  return out;
};

const previewOf = (nodes: Element[], max = 150): string => {
  const parts = nodes.map(n => (n.nodeName === 'w:p' ? streamOf(n).text : n.nodeName === 'w:tbl' ? '[bảng]' : n.nodeName === 'm:oMath' || n.nodeName === 'm:oMathPara' ? PLACEHOLDER : (n.nodeName === 'w:r' ? (n.textContent || '') + (kid(n, 'w:t') || kid(n, 'w:tab') ? '' : PLACEHOLDER) : '')));
  const s = parts.join(' ').split(PLACEHOLDER).join(' ▢ ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const analyzeQuestion = (q: AQuestion, part: APart, env: DocEnv) => {
  // Bỏ ngắt trang/ngắt cột nằm trong câu: câu đổi chỗ thì ngắt trang sẽ sai vị trí
  for (const b of [...q.lead, ...q.blocks]) {
    for (const br of tags(b, 'w:br')) {
      const type = wAttr(br, 'type');
      if (type === 'page' || type === 'column') removeNode(br);
    }
    tags(b, 'w:pageBreakBefore').forEach(removeNode);
  }

  let solStart = -1;
  for (let i = 1; i < q.blocks.length; i++) {
    if (q.blocks[i].nodeName === 'w:p' && SOLUTION_RE.test(blockText(q.blocks[i]))) { solStart = i; break; }
  }
  if (part.kind === 'short') {
    const limit = solStart >= 0 ? solStart : q.blocks.length;
    for (let i = 1; i < limit; i++) {
      const m = q.blocks[i].nodeName === 'w:p' ? SHORT_ANSWER_LINE.exec(blockText(q.blocks[i])) : null;
      if (m) {
        solStart = i;
        if (!m[1].includes(PLACEHOLDER)) q.solutionAnswer = m[1].trim().replace(/\.$/, '');
        break;
      }
    }
  }
  const stemBlocks = solStart >= 0 ? q.blocks.slice(0, solStart) : q.blocks;
  q.solution = solStart >= 0 ? q.blocks.slice(solStart) : [];

  const paras = collectBlockParagraphs(stemBlocks);
  const autoTokens = (lower: boolean): Token[] => {
    const wanted = lower ? 'lowerLetter' : 'upperLetter';
    const tokens: Token[] = [];
    let n = 0;
    const letters = lower ? TF_LETTERS : MC_LETTERS;
    for (const p of paras) {
      const lvl = listLevelOf(p, env);
      if (lvl?.fmt === wanted && n < letters.length) {
        tokens.push({ para: p, letter: letters[n++], start: 0, labelEnd: 0, first: true, strong: true, star: false, auto: true });
      }
    }
    return tokens;
  };
  const findChain = (lower: boolean): Token[] | null => {
    const letters = lower ? TF_LETTERS : MC_LETTERS;
    const auto = autoTokens(lower);
    const need = lower ? 4 : 3;
    if (auto.length >= need) return auto;
    const toks = paras.flatMap(p => scanTokens(p, env, lower, q.blocks[0]));
    const strict = pickChain(toks, letters, true);
    if (strict && strict.length >= (lower ? 4 : 4)) return lower ? strict.slice(0, 4) : strict;
    const loose = pickChain(toks, letters, false);
    if (loose && (lower ? loose.length === 4 : true)) return loose;
    return strict && !lower ? strict : null;
  };

  const partKind = part.kind;
  let chain: Token[] | null = null;
  let kind: MixKind;
  if (partKind === 'essay') {
    kind = 'essay';
  } else if (partKind === 'short') {
    kind = 'short';
  } else if (partKind === 'tf') {
    chain = findChain(true);
    kind = chain ? 'tf' : 'essay';
    if (!chain) q.warnings.push('Không nhận ra đủ 4 ý a), b), c), d) nên giữ nguyên vị trí câu.');
  } else if (partKind === 'mc') {
    chain = findChain(false);
    kind = chain ? 'mc' : 'essay';
    if (!chain) q.warnings.push('Không nhận ra đủ phương án A, B, C, D nên giữ nguyên vị trí câu.');
  } else {
    chain = findChain(false);
    if (chain) kind = 'mc';
    else {
      chain = findChain(true);
      kind = chain ? 'tf' : (part.roman === 'III' || part.roman === '3' ? 'short' : 'essay');
    }
  }
  q.kind = kind;
  q.slots = chain ? buildSlots(chain, stemBlocks) : null;

  const slotNodes = new Set<Element>();
  q.slots?.forEach(s => { [...s.label, ...s.lead, ...s.content, ...s.trail, ...s.extra].forEach(n => slotNodes.add(n)); });
  q.retained = stemBlocks;
  q.stemFp = fingerprint(stemBlocks, slotNodes).replace(/\*/g, '').replace(/^((?:\{[^}]*\})*)(?:Câu|C©u|C¢u|Question|QUESTION|Bài|BÀI|CÂU)\d{1,3}[.:)\-–—]?/, '$1');
  q.optionFps = (q.slots || []).map(s => fingerprint([...s.content, ...s.extra]));

  q.mark = q.slots ? detectMarks(q.slots, kind) : { marked: [], props: [] };
  if (q.slots && q.mark.marked.length) {
    if (kind === 'mc') q.markedAnswer = q.slots[q.mark.marked[0]].letter;
    if (kind === 'tf' && q.slots.length === 4) q.markedAnswer = q.slots.map((_, i) => (q.mark.marked.includes(i) ? 'Đ' : 'S')).join('');
  }

  // Lời giải ngay trong câu: lấy đáp án
  if (q.solution.length) {
    const solText = q.solution.map(blockPlain).join('\n');
    if (kind === 'mc') {
      const m = /(?:Ch[ọo]n|[Đđ][áa]p\s*[áa]n(?:\s*đúng)?(?:\s*là)?|ĐÁP\s*ÁN)\s*(?:đáp\s*án\s*)?[:.]?\s*([A-F])(?=$|[\s,.;:)])/.exec(solText);
      if (m) q.solutionAnswer = m[1];
    } else if (kind === 'tf') {
      const row: Record<string, string> = {};
      for (const m of solText.matchAll(/(?:^|[\s,;(])([a-d])\s*[.)]\s*(Đúng|Sai|Đ|S)(?=$|[\s,.;:)|\-–])/g)) row[m[1]] = m[2].startsWith('Đ') ? 'Đ' : 'S';
      if (TF_LETTERS.every(l => row[l])) q.solutionAnswer = TF_LETTERS.map(l => row[l]).join('');
    } else if (kind === 'short' && !q.solutionAnswer) {
      const m = /(?:Đáp\s*án|Đáp\s*số|ĐS|Trả\s*lời|Kết\s*quả)\s*(?:là)?\s*[:=]?\s*([^\n]{1,40})/i.exec(solText);
      if (m && !blockText(q.solution[0]).includes(PLACEHOLDER)) q.solutionAnswer = m[1].trim().replace(/\.$/, '');
    }
  }

  // Khóa để an toàn
  const stemText = stemBlocks.filter(b => b.nodeName === 'w:p' && !q.slots?.some(s => s.para === b)).map(blockText).join(' ').replace(QUESTION_LABEL, '');
  q.pinned = kind === 'essay';
  q.lockOptions = false;
  if (REF_QUESTION_RE.test(stemText.replace(/nội\s*dung\s*c[âa]u\s*hỏi\s*\d*/gi, '')) && q.group === null) {
    q.pinned = true;
    q.warnings.push('Câu có nhắc tới câu khác nên giữ nguyên vị trí.');
  }
  const stats = countStats(stemBlocks);
  if (REF_FIGURE_RE.test(stemText) && !stats.images && !stats.tables && !stats.objects && q.group === null) {
    q.pinned = true;
    q.warnings.push('Câu nhắc tới hình/bảng "ở trên" nhưng không có hình/bảng riêng nên giữ nguyên vị trí.');
  }
  if (q.slots) {
    const optText = q.slots.map(s => previewOf(s.content, 400));
    if (kind === 'mc' && optText.some(t => LOCK_OPTION_RE.test(t))) {
      q.lockOptions = true;
      q.warnings.push('Có phương án kiểu "Cả A và B", "Tất cả..." nên giữ nguyên thứ tự phương án.');
    }
    if (kind === 'tf' && optText.some(t => LOCK_STATEMENT_RE.test(t))) {
      q.lockOptions = true;
      q.warnings.push('Có ý nhắc tới ý khác nên giữ nguyên thứ tự a, b, c, d.');
    }
    if (kind === 'mc' && q.slots.length !== 4) q.warnings.push(`Câu có ${q.slots.length} phương án, cần kiểm tra lại.`);
    const emptyOpts = q.slots.filter(s => !s.content.length && !s.extra.length).map(s => s.letter);
    if (emptyOpts.length) {
      q.lockOptions = true;
      q.warnings.push(`Phương án ${emptyOpts.join(', ')} không có nội dung nhận ra được nên không đảo phương án.`);
    }
    const lastPara = q.slots[q.slots.length - 1].para;
    const afterLast = stemBlocks.slice(stemBlocks.indexOf(lastPara) + 1).filter(b => !q.slots!.some(s => s.extra.includes(b)) && !isBlank(b));
    if (stemBlocks.includes(lastPara) && afterLast.length) {
      q.warnings.push('Có nội dung nằm sau phương án cuối. Nếu đó là dữ kiện cho câu sau, hãy kiểm tra lại.');
    }
    const firstPara = q.slots[0].para;
    const tableOption = !stemBlocks.includes(firstPara);
    if (tableOption && q.slots.some(s => stemBlocks.includes(s.para))) q.warnings.push('Phương án nằm lẫn trong và ngoài bảng, cần kiểm tra lại.');
  }
};

const analyze = (dom: Document, env: DocEnv): Analysis => {
  const body = tags(dom, 'w:body')[0];
  if (!body) throw new Error('Không tìm thấy nội dung văn bản trong file Word.');
  const refBookmarks = new Set<string>();
  for (const instr of tags(body, 'w:instrText')) {
    const m = /(?:REF|PAGEREF|NOTEREF)\s+(\S+)/.exec(instr.textContent || '');
    if (m) refBookmarks.add(m[1]);
  }
  prepareBody(body, refBookmarks);

  const blocks = els(body);
  const finalSect = blocks.length && blocks[blocks.length - 1].nodeName === 'w:sectPr' ? blocks[blocks.length - 1] : null;
  const list = finalSect ? blocks.slice(0, -1) : blocks;
  const texts = list.map(b => (b.nodeName === 'w:p' ? blockText(b) : ''));
  const autoCounters = new Map<string, number>();

  // Tiền xử lý: vị trí mọi nhãn câu
  const qAt = new Map<number, { num: number; auto: boolean }>();
  list.forEach((b, i) => {
    if (b.nodeName !== 'w:p') return;
    const lvl = listLevelOf(b, env);
    if (lvl && /^\s*(?:Câu|Question|Bài|C©u)\b/i.test(lvl.text) && lvl.text.includes('%')) {
      const id = listIdOf(b);
      const n = (autoCounters.get(id) || 0) + 1;
      autoCounters.set(id, n);
      qAt.set(i, { num: n, auto: true });
      return;
    }
    if (GROUP_HEAD.test(texts[i])) return;
    const m = QUESTION_LABEL.exec(texts[i]);
    if (m) qAt.set(i, { num: parseInt(m[3], 10), auto: false });
  });
  const nextQAfter = (i: number) => {
    for (let k = i + 1; k < list.length; k++) if (qAt.has(k)) return { index: k, num: qAt.get(k)!.num };
    return null;
  };

  const a: Analysis = { dom, body, finalSect, front: [], tail: [], parts: [], questions: [], answerBlocks: [], notes: [] };
  let state: 'front' | 'intro' | 'q' | 'tail' | 'answers' = 'front';
  let part: APart | null = null;
  let cur: AQuestion | null = null;
  let pendingLead: Element[] | null = null;
  let pendingRef: { nums: number[]; count: number } | null = null;
  let groupRemaining = 0;
  let groupId: number | null = null;
  let groupCounter = 0;
  let idCounter = 0;

  const ensurePart = (): APart => {
    if (!part) {
      part = { index: a.parts.length, title: '', kind: null, roman: '', heading: [], questions: [], sects: [] };
      a.parts.push(part);
    }
    return part;
  };
  const flushLead = () => {
    if (pendingLead) {
      if (cur) cur.blocks.push(...pendingLead);
      else if (part) part.heading.push(...pendingLead);
      else a.front.push(...pendingLead);
    }
    pendingLead = null;
    pendingRef = null;
  };

  list.forEach((b, i) => {
    const t = texts[i];
    if (state === 'answers') {
      a.answerBlocks.push(b);
      return;
    }
    const nq = nextQAfter(i);
    // Phần đáp án / lời giải ở cuối
    const short = t.trim().length > 0 && t.trim().length <= 120;
    if (short && ANSWER_RE.test(t) && !qAt.has(i)) {
      const upper = t === t.toUpperCase();
      const partBetween = nq ? texts.slice(i + 1, nq.index).some(looksLikePartHeading) : false;
      let section = false;
      if (/BẢNG\s*ĐÁP\s*ÁN/i.test(t) || state === 'tail' || !cur) section = true;
      else if (!nq) section = upper;
      else if (nq.num <= cur.num) section = upper || !partBetween;
      if (section) {
        flushLead();
        state = 'answers';
        cur = null;
        a.answerBlocks.push(b);
        return;
      }
    }
    if (b.nodeName === 'w:tbl' && (state === 'tail' || (state === 'q' && !nq)) && answerTableLike(b)) {
      flushLead();
      state = 'answers';
      cur = null;
      a.answerBlocks.push(b);
      return;
    }
    if (state === 'tail') {
      a.tail.push(b);
      return;
    }
    if (state === 'q' && t.trim().length <= 120 && (TAIL_END_RE.test(t) || (!nq && TAIL_NOTE_RE.test(t)))) {
      flushLead();
      state = 'tail';
      cur = null;
      a.tail.push(b);
      return;
    }
    if (looksLikePartHeading(t)) {
      flushLead();
      part = { index: a.parts.length, title: t.split(PLACEHOLDER).join(' ').replace(/\s+/g, ' ').trim(), kind: partKindOf(t), roman: PART_RE.exec(t)?.[1] || '', heading: [b], questions: [], sects: [] };
      a.parts.push(part);
      state = 'intro';
      cur = null;
      groupRemaining = 0;
      groupId = null;
      return;
    }
    if (qAt.has(i)) {
      const info = qAt.get(i)!;
      let owner = ensurePart();
      const lastQ = owner.questions[owner.questions.length - 1];
      if (lastQ && info.num <= lastQ.num) {
        // File gộp nhiều đề hoặc số câu đánh lại từ đầu: không trộn lẫn sang nhau
        owner = { index: a.parts.length, title: '', kind: owner.kind, roman: owner.roman, heading: [], questions: [], sects: [] };
        a.parts.push(owner);
        part = owner;
        if (!a.notes.includes(RESTART_NOTE)) a.notes.push(RESTART_NOTE);
      }
      const lead: Element[] = pendingLead || [];
      if (pendingRef) {
        groupId = ++groupCounter;
        groupRemaining = pendingRef.count;
      }
      const q: AQuestion = {
        id: idCounter++, part: owner.index, num: info.num, auto: info.auto, lead, blocks: [b], retained: [], solution: [],
        kind: 'essay', slots: null, mark: { marked: [], props: [] },
        group: groupRemaining > 0 ? groupId : null, groupRef: !!pendingRef, warnings: [], pinned: false, lockOptions: false,
        markedAnswer: '', solutionAnswer: '', stemFp: '', optionFps: [], position: owner.questions.length, rebuilt: new Set(),
      };
      if (groupRemaining > 0) groupRemaining--;
      owner.questions.push(q);
      a.questions.push(q);
      cur = q;
      pendingLead = null;
      pendingRef = null;
      state = 'q';
      return;
    }
    if (pendingLead) {
      pendingLead.push(b);
      return;
    }
    // Dữ kiện dùng chung: "Dựa vào thông tin sau để trả lời câu 5 và câu 6"
    if (b.nodeName === 'w:p' && (state === 'q' || state === 'intro') && !GROUP_NOT.test(t) && GROUP_CUE.test(t)) {
      const ref = parseGroupRef(t);
      if (ref && nq && (ref.nums.length === 0 ? nq.num > 0 : ref.nums[0] === nq.num)) {
        pendingLead = [b];
        pendingRef = ref;
        cur = cur && state === 'q' ? cur : null;
        return;
      }
    }
    if (cur) cur.blocks.push(b);
    else if (state === 'intro') part!.heading.push(b);
    else a.front.push(b);
  });
  flushLead();

  // Phần có tiêu đề nhưng dạng câu ghi ở dòng hướng dẫn kế tiếp
  for (const p of a.parts) {
    if (!p.kind && p.heading.length) p.kind = partKindOf(p.heading.map(blockText).join(' '));
  }

  // Dàn ý/hướng dẫn đầu file: phần không có câu nào mà "PHẦN I" đó còn xuất hiện lại phía sau.
  // Phần trống không lặp lại (ví dụ tự luận không ghi "Câu") vẫn là nội dung đề, phải giữ.
  a.parts.forEach((p, i) => {
    if (!p.questions.length && p.roman && a.parts.slice(i + 1).some(later => later.roman === p.roman)) p.outline = true;
  });
  if (a.parts.some(p => p.outline)) a.notes.push('Đã bỏ phần hướng dẫn soạn đề ở đầu file; đề học sinh sẽ không có phần này.');

  // Ngắt section nằm trong câu: giữ theo VỊ TRÍ, không để đi theo câu
  for (const p of a.parts) {
    for (const q of p.questions) {
      for (const block of [...q.lead, ...q.blocks]) {
        if (block.nodeName !== 'w:p') continue;
        const pPr = kid(block, 'w:pPr');
        const sect = pPr ? kid(pPr, 'w:sectPr') : null;
        if (sect) {
          removeNode(sect);
          p.sects.push({ position: q.position, sect });
        }
      }
    }
  }

  for (const p of a.parts) for (const q of p.questions) analyzeQuestion(q, p, env);
  return a;
};

/* ---------------------------- Đọc tài liệu ---------------------------- */

const toFakeQuestions = (qs: MixQuestion[]): ExamQuestion[] => qs.map(q => ({ num: q.num, kind: q.kind } as unknown as ExamQuestion));

const answerFromBook = (book: AnswerBook, q: AQuestion): string => {
  if (q.kind === 'mc') return book.mc[q.num] || '';
  if (q.kind === 'short') return book.short[q.num] || '';
  if (q.kind === 'tf') {
    const row = book.tf[q.num];
    if (row && TF_LETTERS.every(l => (row as Record<string, string>)[l])) return TF_LETTERS.map(l => (row as Record<string, string>)[l]).join('');
  }
  return '';
};

/** Đọc Sở, trường, tên bài thi, năm học, môn, thời gian từ tiêu đề đề gốc để giáo viên đỡ phải gõ. */
const detectExamInfo = (front: Element[]): Partial<ExamInfo> => {
  const info: Partial<ExamInfo> = {};
  const lines = collectBlockParagraphs(front)
    .flatMap(p => blockText(p).split(/[\n\t]+/))
    .map(l => l.split(PLACEHOLDER).join(' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!info.department && /^(?:SỞ|BỘ|PHÒNG)\s/i.test(line)) info.department = line;
    else if (!info.school && /^(?:TRƯỜNG|TỔ)\s/i.test(line)) info.school = line;
    const year = /N[ĂA]M\s*H[ỌO]C\s*:?\s*(\d{4})\s*[-–—/]\s*(\d{4})/i.exec(line);
    if (year && !info.schoolYear) info.schoolYear = `${year[1]} - ${year[2]}`;
    if (!info.examName && /^(?:BÀI\s+)?(?:ĐỀ\s+(?:KIỂM\s*TRA|THI|KT|ÔN)|KỲ\s+(?:THI|KIỂM\s*TRA)|KIỂM\s*TRA)/i.test(line)) {
      const name = line.split(/N[ĂA]M\s*H[ỌO]C/i)[0].replace(/[\s,:–—-]+$/, '');
      if (name) info.examName = name;
    }
    const subject = /^M[ÔO]N(?:\s+(?:THI|HỌC))?\s*[:.]\s*(.+)$/i.exec(line);
    if (subject && !info.subject) info.subject = subject[1].trim();
    const time = /Th[ờo]i\s*gian[^:\d]*:?\s*(\d+)\s*phút/i.exec(line);
    if (time && !info.duration) info.duration = `${time[1]} phút`;
  }
  return info;
};

const HEADER_FOOTER_RE = /^word\/(?:header|footer)\d*\.xml$/;
const CODE_RE = /(m[ãa]\s*(?:đ[ềe]|Đ[ỀE])(?:\s*(?:thi|THI))?(?:\s*(?:số|SỐ))?\s*[:.]?\s*)(\d{1,6}|[xX.…_\-]{2,})?/i;

const hasCodeLabel = (dom: Document) => tags(dom, 'w:p').some(p => CODE_RE.test(streamOf(p).text));

export const loadDocxExam = async (data: ArrayBuffer | Uint8Array | Blob, fileName: string): Promise<MixDocument> => {
  let zip: JSZip;
  try {
    // Kiểm tra CRC ngay khi mở để phát hiện file hỏng, thay vì lỗi kỹ thuật ở bước sau
    zip = await JSZip.loadAsync(data as ArrayBuffer, { checkCRC32: true });
  } catch (e: any) {
    throw new Error(/CRC32|size mismatch/i.test(String(e?.message || ''))
      ? 'File Word này bị hỏng hoặc chưa tải về đầy đủ nên không đọc được. Hãy mở file bằng Word, Lưu thành file mới rồi tải lên lại.'
      : 'Không mở được file. Hãy chọn đúng file Word .docx (file .doc cũ cần mở bằng Word rồi Lưu thành .docx). Nếu đúng là file Word thì có thể file đã bị hỏng hoặc chưa tải về đầy đủ.');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('File này không phải văn bản Word .docx hợp lệ.');
  const xml = await docFile.async('string');
  if (Object.keys(zip.files).some(n => /word\/.*\.mht$/i.test(n)) && !/Câu|Question/i.test(xml)) {
    throw new Error('File này được xuất từ web (nội dung nằm ở dạng nhúng). Hãy mở bằng Word, chọn Lưu thành .docx mới rồi tải lên lại.');
  }
  const env = await readEnv(zip);
  const headerFooters: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (HEADER_FOOTER_RE.test(name)) headerFooters[name] = await zip.file(name)!.async('string');
  }

  const dom = parseXml(xml);
  const a = analyze(dom, env);

  if (!a.questions.length) {
    const inTables = tags(a.body, 'w:tc').some(tc => els(tc).some(e => e.nodeName === 'w:p' && QUESTION_LABEL.test(blockText(e))));
    throw new Error(inTables
      ? 'Các câu hỏi đang nằm trong bảng nên chưa trộn được. Hãy đưa câu hỏi ra ngoài bảng (Table → Convert to Text) rồi tải lên lại.'
      : 'Không tìm thấy câu hỏi nào. Mỗi câu cần bắt đầu bằng "Câu 1.", "Câu 2:"... ở đầu dòng.');
  }

  const qs: MixQuestion[] = a.questions.map(q => ({
    id: q.id,
    part: q.part,
    num: q.num,
    kind: q.kind,
    preview: previewOf(q.retained.filter(b => !q.slots?.some(s => s.para === b && !s.auto)).slice(0, 3), 170).replace(QUESTION_LABEL, '').replace(LABEL_TAIL_RE, '').trim() || previewOf(q.blocks.slice(0, 1)),
    optionPreviews: (q.slots || []).map(s => previewOf([...s.content, ...s.extra], 70)),
    stats: countStats([...q.lead, ...q.retained]),
    answer: '',
    answerSource: null,
    pinned: q.pinned,
    lockOptions: q.lockOptions,
    group: q.group,
    warnings: q.warnings,
  }));

  const notes = [...a.notes];
  const conflicts: string[] = [];
  const keyText = a.answerBlocks.map(blockPlain).join('\n');
  const { answers: book, conflicts: keyConflicts } = parseAnswerKey(keyText, toFakeQuestions(qs));
  conflicts.push(...keyConflicts);
  a.questions.forEach((q, i) => {
    const m = qs[i];
    const fromKey = answerFromBook(book, q);
    const candidates: Array<[string, AnswerSource]> = [[fromKey, 'key'], [q.solutionAnswer, 'solution'], [q.markedAnswer, 'mark']];
    const found = candidates.find(c => c[0]);
    if (found) {
      m.answer = found[0];
      m.answerSource = found[1];
    }
    const distinct = new Set(candidates.map(c => c[0]).filter(Boolean));
    if (distinct.size > 1 && q.kind !== 'short') {
      conflicts.push(`Câu ${q.num}: đề ghi nhiều đáp án khác nhau (${Array.from(distinct).join(', ')})`);
    }
  });

  const stats = countStats(a.questions.flatMap(q => [...q.lead, ...q.retained]));
  const groups = new Set(qs.filter(q => q.group !== null).map(q => q.group));
  if (groups.size) notes.push(`Có ${groups.size} nhóm câu dùng chung dữ kiện, sẽ đi liền nhau khi trộn.`);
  const removedSolutions = a.questions.filter(q => q.solution.length).length;
  if (removedSolutions) notes.push(`Đã nhận ra lời giải ở ${removedSolutions} câu; đề học sinh sẽ không có phần này.`);
  if (a.answerBlocks.length) notes.push('Đã nhận ra phần đáp án/lời giải ở cuối file; đề học sinh sẽ không có phần này.');

  let codeFound = hasCodeLabel(dom);
  if (!codeFound) {
    codeFound = Object.values(headerFooters).some(x => hasCodeLabel(parseXml(x)));
  }
  if (!codeFound) notes.push('Đề gốc không ghi "Mã đề"; app sẽ thêm dòng "Mã đề: ..." ở đầu trang 1.');
  const hasFooter = tags(dom, 'w:footerReference').length > 0;
  const textWidth = textWidthOf(dom);

  return {
    fileName, zip, xml, headerFooters, env,
    parts: a.parts.map(p => ({ index: p.index, title: p.title, kind: p.kind })),
    questions: qs,
    stats,
    notes,
    conflicts: Array.from(new Set(conflicts)),
    removedAnswerSection: a.answerBlocks.length > 0,
    removedSolutions,
    codeFound,
    hasFooter,
    textWidth,
    normalizedTextWidth: normalizedPageWidth(dom),
    detectedInfo: detectExamInfo(a.front),
  };
};

export const defaultOverrides = (doc: MixDocument): MixOverrides => {
  const ov: MixOverrides = { answers: {}, pinned: {}, lockOptions: {}, linkNext: {} };
  doc.questions.forEach((q, i) => {
    ov.answers[q.id] = q.answer;
    ov.pinned[q.id] = q.pinned;
    ov.lockOptions[q.id] = q.lockOptions;
    const next = doc.questions[i + 1];
    ov.linkNext[q.id] = !!next && next.part === q.part && q.group !== null && next.group === q.group;
  });
  return ov;
};

/** Câu còn thiếu đáp án (không tính tự luận). */
export const missingMixAnswers = (doc: MixDocument, ov: MixOverrides): MixQuestion[] =>
  doc.questions.filter(q => {
    if (q.kind === 'essay') return false;
    const v = (ov.answers[q.id] || '').trim();
    if (q.kind === 'tf') return v.length !== 4;
    return !v;
  });

/* ---------------------------- Lập kế hoạch trộn ---------------------------- */

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffled = <T,>(arr: T[], rand: () => number): T[] => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/**
 * Đảo các đơn vị trong một vùng mà câu bị khóa vẫn giữ đúng SỐ CÂU, kể cả khi nhóm nhiều câu đổi chỗ.
 * Thử xếp ngẫu nhiên trên toàn vùng; nếu nhóm không vừa khoảng trống thì chỉ đảo giữa hai câu khóa.
 */
const arrangeRegion = <T extends unknown[]>(region: T[], isPinned: (u: T) => boolean, rand: () => number): T[] => {
  const movable = region.filter(u => !isPinned(u));
  const pinnedAt = new Map<number, T>();
  let offset = 0;
  for (const u of region) {
    if (isPinned(u)) pinnedAt.set(offset, u);
    offset += u.length;
  }
  if (!pinnedAt.size) return shuffled(movable, rand);

  const place = (seq: T[]): T[] | null => {
    const out: T[] = [];
    const queue = [...seq];
    let at = 0;
    while (at < offset) {
      const fixed = pinnedAt.get(at);
      const next: T | undefined = fixed || queue.shift();
      if (!next) return null;
      if (!fixed) {
        for (let k = 1; k < next.length; k++) if (pinnedAt.has(at + k)) return null;
      }
      out.push(next);
      at += next.length;
    }
    return out;
  };
  for (let tries = 0; tries < 60; tries++) {
    const placed = place(shuffled(movable, rand));
    if (placed) return placed;
  }
  const out: T[] = [];
  let gap: T[] = [];
  for (const u of region) {
    if (isPinned(u)) {
      out.push(...shuffled(gap, rand), u);
      gap = [];
    } else {
      gap.push(u);
    }
  }
  out.push(...shuffled(gap, rand));
  return out;
};

const planOne = (doc: MixDocument, s: MixSettings, ov: MixOverrides, code: string, rand: () => number): VersionPlan => {
  const questions: PlannedQuestion[] = [];
  for (const part of doc.parts) {
    const qs = doc.questions.filter(q => q.part === part.index);
    // Gom thành đơn vị: câu lẻ hoặc nhóm câu đi liền nhau
    const units: MixQuestion[][] = [];
    qs.forEach((q, i) => {
      if (i > 0 && ov.linkNext[qs[i - 1].id]) units[units.length - 1].push(q);
      else units.push([q]);
    });
    // Vùng liên tiếp cùng dạng: chỉ đảo trong vùng, đơn vị bị khóa giữ nguyên chỗ
    const orderedUnits: MixQuestion[][] = [];
    let i = 0;
    while (i < units.length) {
      const kind = units[i][0].kind;
      let j = i;
      while (j < units.length && units[j][0].kind === kind) j++;
      const region = units.slice(i, j);
      const isPinned = (u: MixQuestion[]) => u.some(q => ov.pinned[q.id]);
      orderedUnits.push(...(s.shuffleQuestions ? arrangeRegion(region, isPinned, rand) : region));
      i = j;
    }
    const flat = orderedUnits.flat();
    flat.forEach((q, pos) => {
      const newNum = qs[pos].num;
      let perm: number[] | null = null;
      const n = q.optionPreviews.length;
      const shouldShuffle = !ov.lockOptions[q.id] && ((q.kind === 'mc' && s.shuffleOptions) || (q.kind === 'tf' && s.shuffleStatements));
      if (n > 1 && shouldShuffle) perm = shuffled(Array.from({ length: n }, (_, x) => x), rand);
      const base = (ov.answers[q.id] || '').trim();
      let answer = base;
      if (q.kind === 'mc') {
        const orig = MC_LETTERS.indexOf(base);
        if (orig < 0 || orig >= n) answer = '?';
        else answer = MC_LETTERS[perm ? perm.indexOf(orig) : orig];
      } else if (q.kind === 'tf') {
        if (base.length !== 4) answer = '?';
        else answer = perm ? perm.map(x => base[x]).join('') : base;
      } else if (q.kind === 'short') {
        answer = base || '?';
      } else {
        answer = '';
      }
      questions.push({ id: q.id, part: part.index, origNum: q.num, newNum, kind: q.kind, perm, answer });
    });
  }
  return { code, questions };
};

const planSignature = (p: VersionPlan) => p.questions.map(q => `${q.id}:${q.perm ? q.perm.join('') : ''}`).join('|');

export const planVersions = (doc: MixDocument, s: MixSettings, ov: MixOverrides): VersionPlan[] => {
  const seen = new Set<string>();
  const identity = doc.questions.map(q => `${q.id}:${q.optionPreviews.map((_, i) => i).join('')}`).join('|');
  seen.add(identity);
  const plans: VersionPlan[] = [];
  const rand = mulberry32(s.seed >>> 0);
  for (let i = 0; i < s.count; i++) {
    const code = String(s.startCode + i);
    let plan = planOne(doc, s, ov, code, rand);
    for (let tries = 0; tries < 30 && seen.has(planSignature(plan)); tries++) plan = planOne(doc, s, ov, code, rand);
    seen.add(planSignature(plan));
    plans.push(plan);
  }
  return plans;
};

/* ---------------------------- Chuẩn hóa hình thức theo mẫu ---------------------------- */

const FONT = 'Times New Roman';
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'].map(n => `w:${n}`);
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'].map(n => `w:${n}`);

/** Thêm hoặc thay phần tử con, giữ đúng thứ tự Word yêu cầu. */
const putOrdered = (parent: Element, el: Element, order: string[]) => {
  const old = kid(parent, el.nodeName);
  if (old) parent.removeChild(old);
  const rank = order.indexOf(el.nodeName);
  const before = els(parent).find(c => order.indexOf(c.nodeName) > rank) || null;
  parent.insertBefore(el, before);
};
const wEl = (dom: Document, name: string, attrs: Record<string, string> = {}): Element => {
  const el = newW(dom, name);
  Object.entries(attrs).forEach(([k, v]) => setWAttr(el, k, v));
  return el;
};
const dropKid = (parent: Element, name: string) => {
  const el = kid(parent, name);
  if (el) parent.removeChild(el);
};

const setParagraph = (p: Element, opt: { before: number; jc: string; hanging?: boolean; tabs?: number[]; keepInd?: boolean }) => {
  const dom = p.ownerDocument!;
  let pPr = kid(p, 'w:pPr');
  if (!pPr) {
    pPr = newW(dom, 'pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  putOrdered(pPr, wEl(dom, 'spacing', { before: String(opt.before), after: '0', line: '276', lineRule: 'auto' }), PPR_ORDER);
  putOrdered(pPr, wEl(dom, 'jc', { val: opt.jc }), PPR_ORDER);
  dropKid(pPr, 'w:contextualSpacing');
  if (opt.hanging) putOrdered(pPr, wEl(dom, 'ind', { left: '284', hanging: '284' }), PPR_ORDER);
  else if (!opt.keepInd) dropKid(pPr, 'w:ind');
  if (opt.tabs) {
    const tabs = newW(dom, 'tabs');
    opt.tabs.forEach(pos => tabs.appendChild(wEl(dom, 'tab', { val: 'left', pos: String(pos) })));
    putOrdered(pPr, tabs, PPR_ORDER);
  } else {
    dropKid(pPr, 'w:tabs');
  }
};

const LEGACY_FONT = /^(?:\.Vn|VNI|VK|Symbol|Wingdings|Webdings|MT Extra|Cambria Math|MathType)/i;

/** Đưa chữ về Times New Roman cỡ 12; phông cũ (TCVN3, VNI) phải giữ nguyên, đổi sẽ lỗi chữ. */
const normalizeRunFont = (run: Element) => {
  if (!kid(run, 'w:t') && !kid(run, 'w:tab')) return;
  const dom = run.ownerDocument!;
  let rPr = kid(run, 'w:rPr');
  if (!rPr) {
    rPr = newW(dom, 'rPr');
    run.insertBefore(rPr, run.firstChild);
  }
  const fonts = kid(rPr, 'w:rFonts');
  if (fonts && LEGACY_FONT.test(wAttr(fonts, 'ascii') || wAttr(fonts, 'hAnsi') || '')) return;
  const eastAsia = wAttr(fonts, 'eastAsia');
  const fresh = wEl(dom, 'rFonts', { ascii: FONT, hAnsi: FONT, cs: FONT });
  if (eastAsia) setWAttr(fresh, 'eastAsia', eastAsia);
  putOrdered(rPr, fresh, RPR_ORDER);
  putOrdered(rPr, wEl(dom, 'sz', { val: '24' }), RPR_ORDER);
  putOrdered(rPr, wEl(dom, 'szCs', { val: '24' }), RPR_ORDER);
};
const normalizeParagraphFonts = (p: Element) => els(p).filter(n => n.nodeName === 'w:r').forEach(normalizeRunFont);

const textRun = (dom: Document, text: string, bold = false): Element => {
  const r = newW(dom, 'r');
  const rPr = newW(dom, 'rPr');
  rPr.appendChild(wEl(dom, 'rFonts', { ascii: FONT, eastAsia: FONT, hAnsi: FONT, cs: FONT }));
  if (bold) rPr.appendChild(newW(dom, 'b'));
  rPr.appendChild(wEl(dom, 'sz', { val: '24' }));
  rPr.appendChild(wEl(dom, 'szCs', { val: '24' }));
  r.appendChild(rPr);
  if (text === '\t') r.appendChild(newW(dom, 'tab'));
  else {
    const t = newW(dom, 't');
    setText(t, text);
    r.appendChild(t);
  }
  return r;
};

/** Độ rộng vùng chữ của trang (twip), tính cả bố cục nhiều cột. */
const textWidthOf = (dom: Document): number => {
  const sects = tags(dom, 'w:sectPr');
  const sect = sects[sects.length - 1];
  if (!sect) return 10205;
  const size = kid(sect, 'w:pgSz');
  const mar = kid(sect, 'w:pgMar');
  const w = parseInt(wAttr(size, 'w') || '11906', 10);
  const left = parseInt(wAttr(mar, 'left') || '1134', 10);
  const right = parseInt(wAttr(mar, 'right') || '567', 10);
  const gutter = parseInt(wAttr(mar, 'gutter') || '0', 10);
  const total = w - left - right - gutter;
  const cols = kid(sect, 'w:cols');
  const num = parseInt(wAttr(cols, 'num') || '1', 10);
  if (num <= 1) return total;
  const space = parseInt(wAttr(cols, 'space') || '720', 10);
  return Math.floor((total - space * (num - 1)) / num);
};

const SAMPLE_MARGINS: Record<string, string> = { top: '567', right: '567', bottom: '567', left: '1134', header: '284', footer: '567', gutter: '0' };
const isPortrait = (sect: Element | undefined): boolean => {
  const size = sect ? kid(sect, 'w:pgSz') : null;
  return !!size && wAttr(size, 'orient') !== 'landscape' && parseInt(wAttr(size, 'w') || '0', 10) < parseInt(wAttr(size, 'h') || '0', 10);
};

/** Đưa lề trang về đúng file mẫu; trang ngang giữ nguyên. */
const normalizePageMargins = (sect: Element) => {
  if (!isPortrait(sect)) return;
  const mar = kid(sect, 'w:pgMar');
  if (mar) Object.entries(SAMPLE_MARGINS).forEach(([k, v]) => setWAttr(mar, k, v));
};

/** Độ rộng vùng chữ cả trang sau chuẩn hóa lề; chân trang trải hết chiều ngang, không tính theo cột. */
const normalizedPageWidth = (dom: Document): number => {
  const sects = tags(dom, 'w:sectPr');
  const sect = sects[sects.length - 1];
  if (!sect) return 10205;
  const w = parseInt(wAttr(kid(sect, 'w:pgSz'), 'w') || '11906', 10);
  if (isPortrait(sect)) return w - 1134 - 567;
  const mar = kid(sect, 'w:pgMar');
  return w - parseInt(wAttr(mar, 'left') || '1134', 10) - parseInt(wAttr(mar, 'right') || '567', 10);
};

const lengthPt = (style: string | null, prop: string): number => {
  const m = new RegExp(`(?:^|;|\\s)${prop}:\\s*([\\d.]+)(pt|in|cm|mm|px)?`, 'i').exec(style || '');
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const unit = (m[2] || 'pt').toLowerCase();
  return v * ({ pt: 1, in: 72, cm: 28.35, mm: 2.835, px: 0.75 } as Record<string, number>)[unit];
};
const charPt = (c: string): number => {
  if (/\s/.test(c)) return 3;
  if (/[.,;:'|!ịìíl]/i.test(c)) return 3.5;
  if (/[A-ZĐ]/.test(c)) return 8.2;
  if (/\d/.test(c)) return 6;
  return 5.6;
};
const textPt = (s: string) => Array.from(s.normalize('NFC')).reduce((sum, c) => sum + charPt(c), 0);

/** Ước lượng độ rộng nội dung phương án (pt): công thức MathType đo theo kích thước thật. */
const contentWidthPt = (nodes: Element[]): number => {
  let sum = 0;
  for (const n of nodes) {
    if (n.nodeName === 'm:oMath' || n.nodeName === 'm:oMathPara') {
      sum += tags(n, 'm:t').reduce((acc, t) => acc + textPt(t.textContent || ''), 0) * 1.1 + 6;
      continue;
    }
    if (n.nodeName !== 'w:r') {
      sum += textPt(tags(n, 'w:t').map(t => t.textContent || '').join(''));
      continue;
    }
    for (const c of els(n)) {
      if (c.nodeName === 'w:t') sum += textPt(c.textContent || '');
      else if (c.nodeName === 'w:tab') sum += 36;
      else if (c.nodeName === 'w:br') sum += 1000;
      else if (c.nodeName === 'w:object') {
        const shape = tags(c, 'v:shape')[0];
        const w = lengthPt(shape ? shape.getAttribute('style') : null, 'width');
        const dxa = parseInt(wAttr(c, 'dxaOrig') || '0', 10);
        sum += w || dxa / 20 || 30;
      } else if (c.nodeName === 'w:pict') {
        const shape = els(c)[0];
        sum += lengthPt(shape ? shape.getAttribute('style') : null, 'width') || 60;
      } else if (c.nodeName === 'w:drawing' || c.nodeName === 'mc:AlternateContent') {
        const ext = tags(c, 'wp:extent')[0];
        sum += ext ? parseInt(ext.getAttribute('cx') || '0', 10) / 12700 : 60;
      } else if (c.nodeName !== 'w:rPr') {
        sum += 6;
      }
    }
  }
  return sum;
};

const topBlockOf = (node: Node, body: Element): Element => {
  let cur: Node = node;
  while (cur.parentNode && cur.parentNode !== body) cur = cur.parentNode;
  return cur as Element;
};

const canRebuild = (q: AQuestion, body: Element): boolean => {
  if (!q.slots) return false;
  if (q.slots.some(s => !s.preOk)) return false;
  if (q.slots.some(s => !q.retained.includes(topBlockOf(s.para, body)))) return false;
  const slotParas = new Set(q.slots.map(s => s.para));
  // Bảng/đoạn chứa phương án chỉ được chứa phương án, không có dữ liệu khác
  for (const s of q.slots) {
    const top = topBlockOf(s.para, body);
    if (top.nodeName === 'w:tbl') {
      if (s.extra.length) return false;
      if (tags(top, 'w:p').some(p => !slotParas.has(p) && !isBlank(p))) return false;
    }
  }
  return true;
};

/** Dựng lại các đoạn phương án theo đúng bố cục mẫu: 4 cột, 2 cột hoặc mỗi phương án một dòng. */
const rebuildOptions = (q: AQuestion, perm: number[] | null, body: Element, textWidth: number) => {
  const slots = q.slots!;
  const dom = body.ownerDocument!;
  const order = perm || slots.map((_, i) => i);
  const contents = slots.map(s => s.content);
  const extras = slots.map(s => s.extra);
  const n = slots.length;
  const step = Math.floor(textWidth / 4);
  const indent = 284;
  const maxWidth = Math.max(...contents.map(contentWidthPt));
  const hasExtra = extras.some(e => e.length > 0);
  const stepPt = step / 20;
  // Ngưỡng đối chiếu từ mẫu: 4 cột khi nội dung rất ngắn, 2 cột khi vừa nửa dòng
  let perLine = 1;
  if (q.kind === 'mc' && n === 4 && !hasExtra) {
    if (maxWidth <= stepPt - 57) perLine = 4;
    else if (maxWidth <= stepPt * 2 - 50) perLine = 2;
  }

  const tops: Element[] = [];
  for (const s of slots) {
    const top = topBlockOf(s.para, body);
    if (!tops.includes(top)) tops.push(top);
  }
  const anchor = dom.createComment('options');
  body.insertBefore(anchor, tops[0]);
  // Khối trống và các đoạn cũ giữa các phương án không còn cần thiết
  const firstIdx = q.retained.indexOf(tops[0]);
  const lastIdx = q.retained.indexOf(tops[tops.length - 1]);
  const between = q.retained.slice(firstIdx, lastIdx + 1).filter(b => !tops.includes(b) && isBlank(b));
  [...contents.flat(), ...extras.flat()].forEach(removeNode);
  [...tops, ...between].forEach(removeNode);

  const tabStops = perLine === 4 ? [indent, indent + step, indent + step * 2, indent + step * 3]
    : perLine === 2 ? [indent, indent + step * 2] : [indent];
  const created: Element[] = [];
  for (let i = 0; i < n; i += perLine) {
    const p = newW(dom, 'p');
    setParagraph(p, { before: 0, jc: q.kind === 'tf' ? 'both' : 'left', hanging: perLine === 1, tabs: tabStops });
    for (let k = i; k < Math.min(i + perLine, n); k++) {
      p.appendChild(textRun(dom, '\t'));
      const punct = q.kind === 'tf' ? ')' : '.';
      p.appendChild(textRun(dom, `${slots[k].letter}${punct} `, true));
      contents[order[k]].forEach(node => p.appendChild(node));
    }
    body.insertBefore(p, anchor);
    created.push(p);
    if (perLine === 1) {
      for (const block of extras[order[i]]) {
        body.insertBefore(block, anchor);
        created.push(block);
      }
    }
  }
  removeNode(anchor);
  created.forEach(b => q.rebuilt.add(b));
  const gone = new Set<Element>([...tops, ...between, ...extras.flat()]);
  q.retained = [...q.retained.slice(0, firstIdx).filter(b => !gone.has(b)), ...created, ...q.retained.slice(lastIdx + 1).filter(b => !gone.has(b))];
};

const SUB_ITEM_RE = /^\s*[a-d]\s*\)/;
const LABEL_TAIL_RE = /^\s*(?:\([^)]*\)|\[[^\]]*\])?\s*[.:)\-–—]?\s*/;

/** Câu dẫn: khoảng cách đoạn, in đậm nhãn "Câu n.", ý a), b) của câu tự luận lùi đầu dòng. */
const normalizeQuestionBlocks = (q: AQuestion, newNum: number, env: DocEnv) => {
  const dom = q.blocks[0].ownerDocument!;
  if (q.auto) {
    // Số câu tự động mang theo màu và thụt lề của danh sách Word: đổi thành chữ "Câu 1." như mẫu
    const first = q.blocks[0];
    const pattern = listLevelOf(first, env)?.text || 'Câu %1';
    const label = `${pattern.replace(/%\d/, String(newNum)).replace(/[\s.:)]*$/, '')}. `;
    const pPr = kid(first, 'w:pPr');
    if (pPr) {
      dropKid(pPr, 'w:numPr');
      // Kiểu đoạn tự đánh số: bỏ để không hiện số lần hai
      const style = wAttr(kid(pPr, 'w:pStyle'), 'val');
      if (style && env.styleNum.has(style)) dropKid(pPr, 'w:pStyle');
    }
    first.insertBefore(textRun(dom, label, true), els(first).find(n => n.nodeName !== 'w:pPr') || null);
  }
  q.retained = q.retained.filter(b => b === q.blocks[0] || !isBlank(b));
  const slotted = new Set((q.slots || []).map(s => s.para));
  q.lead.forEach(b => {
    if (b.nodeName !== 'w:p') return;
    normalizeParagraphFonts(b);
    setParagraph(b, { before: 60, jc: 'both' });
  });
  q.retained.forEach((b, i) => {
    if (b.nodeName !== 'w:p') return;
    if (slotted.has(b) || q.rebuilt.has(b)) {
      normalizeParagraphFonts(b);
      return;
    }
    if (!els(b).some(n => n.nodeName === 'w:r' && kid(n, 'w:t')?.textContent) && !hasFloating(b)) return;
    const text = streamOf(b).text;
    const onlyVisual = !text.replace(/[\s\uFFFC]/g, '') && text.includes(PLACEHOLDER);
    normalizeParagraphFonts(b);
    if (i === 0) {
      setParagraph(b, { before: 60, jc: 'both' });
      const m = QUESTION_LABEL.exec(text);
      if (m) {
        const after = LABEL_TAIL_RE.exec(text.slice(m[0].length))?.[0].length || 0;
        const start = m[1].length;
        const end = m[0].length + after;
        cutAt(b, [start, end]);
        for (const seg of streamOf(b).segs) {
          if (seg.node.nodeName === 'w:r' && seg.start >= start && seg.end <= end && seg.end > seg.start) {
            const rPr = kid(seg.node, 'w:rPr');
            if (rPr) putOrdered(rPr, newW(dom, 'b'), RPR_ORDER);
          }
        }
      }
    } else if (onlyVisual) {
      setParagraph(b, { before: 0, jc: 'center' });
    } else if (SUB_ITEM_RE.test(text)) {
      setParagraph(b, { before: 0, jc: 'both', hanging: true, tabs: [284] });
      if (!text.startsWith('\t')) b.insertBefore(textRun(dom, '\t'), els(b).find(n => n.nodeName !== 'w:pPr') || null);
    } else {
      setParagraph(b, { before: 0, jc: 'both' });
    }
  });
};

/** Tiêu đề đề thi đúng như mẫu: 2 cột thông tin, dòng họ tên, số báo danh và mã đề. */
const examHeaderXml = (info: ExamInfo, code: string, textWidth: number, ns: string): string => {
  const esc = (v: string) => v.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fonts = `<w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>`;
  const normal = `<w:rPr>${fonts}<w:sz w:val="24"/></w:rPr>`;
  const bold = `<w:rPr>${fonts}<w:b/><w:sz w:val="24"/></w:rPr>`;
  const italic = `<w:rPr>${fonts}<w:i/></w:rPr>`;
  const lines = (items: Array<[string, string]>) => items.map(([rPr, inner], i) => `<w:r>${rPr}${i ? '<w:br/>' : ''}${inner}</w:r>`).join('');
  const t = (v: string) => `<w:t xml:space="preserve">${v}</w:t>`;
  // Số trang đổi theo thứ tự câu: w:dirty để Word tự tính lại khi mở file
  const pages = `<w:r>${italic}<w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r>${italic}<w:instrText xml:space="preserve">NUMPAGES \\# "0#"</w:instrText></w:r><w:r>${italic}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${italic}${t('01')}</w:r><w:r>${italic}<w:fldChar w:fldCharType="end"/></w:r>`;

  const left: Array<[string, string]> = [];
  if (info.department.trim()) left.push([normal, t(esc(info.department))]);
  if (info.school.trim()) left.push([bold, t(esc(info.school))]);
  left.push([bold, '']);
  left.push([italic, t('-----------------------')]);
  left.push([italic, t('(Đề thi có ')]);

  const duration = info.duration.trim();
  const durationText = /^\d+$/.test(duration) ? `${duration} phút` : duration;
  const right: Array<[string, string]> = [];
  if (info.examName.trim()) right.push([bold, t(esc(info.examName))]);
  if (info.schoolYear.trim()) right.push([bold, t(`NĂM HỌC: ${esc(info.schoolYear)}`)]);
  if (info.subject.trim()) right.push([bold, t(`MÔN: ${esc(info.subject)}`)]);
  if (duration) {
    right.push([italic, t(`Thời gian làm bài: ${esc(durationText)}`)]);
    right.push([italic, t('(không kể thời gian phát đề)')]);
  }

  const col = Math.floor(textWidth / 2);
  const dots = '.'.repeat(Math.max(20, Math.min(64, Math.floor((col / 20 - 58) / 3))));
  const para = (inner: string, extra = '<w:jc w:val="center"/>') => `<w:p><w:pPr><w:spacing w:after="0" w:line="276" w:lineRule="auto"/><w:contextualSpacing/>${extra}</w:pPr>${inner}</w:p>`;
  const noBorder = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>';
  const lineBorder = '<w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/><w:right w:val="nil"/>';
  const cell = (borders: string, margin: string, inner: string, tail = '') => `<w:tc><w:tcPr><w:tcW w:w="${col}" w:type="dxa"/><w:tcBorders>${borders}</w:tcBorders><w:tcMar>${margin}</w:tcMar>${tail}</w:tcPr>${inner}</w:tc>`;
  const tabPos = Math.max(1200, col - 1842);
  return `<w:tbl xmlns:w="${ns}"><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="${col}"/><w:gridCol w:w="${col}"/></w:tblGrid>`
    + `<w:tr>${cell(noBorder, '<w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>', para(`${lines(left)}${pages}<w:r>${italic}${t(' trang)')}</w:r>`))}`
    + `${cell(noBorder, '<w:top w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>', para(lines(right)))}</w:tr>`
    + `<w:tr><w:trPr><w:trHeight w:val="567"/></w:trPr>${cell(lineBorder, '<w:top w:w="80" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/>', para(`<w:r>${bold}${t(`Họ và tên: ${dots}`)}</w:r>`, ''), '<w:vAlign w:val="bottom"/>')}`
    + `${cell(lineBorder, '<w:top w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>', para(`<w:r>${bold}<w:tab/>${t('Số báo danh: ...................')}</w:r><w:r>${bold}<w:tab/>${t(`Mã đề ${esc(code)}`)}</w:r>`, `<w:tabs><w:tab w:val="left" w:pos="567"/><w:tab w:val="left" w:pos="${tabPos}"/></w:tabs>`), '<w:vAlign w:val="bottom"/>')}</w:tr></w:tbl>`;
};

/** Số trang đổi theo thứ tự câu: yêu cầu Word tính lại trường NUMPAGES trong thân đề khi mở file. */
const markPageCountDirty = (root: Element) => {
  for (const instr of tags(root, 'w:instrText')) {
    if (!/NUMPAGES/.test(instr.textContent || '')) continue;
    for (let n = instr.parentNode?.previousSibling as Node | null | undefined; n; n = n.previousSibling) {
      if (n.nodeType !== 1) continue;
      const fld = kid(n, 'w:fldChar');
      if (fld && wAttr(fld, 'fldCharType') === 'begin') {
        setWAttr(fld, 'dirty', 'true');
        break;
      }
      if (fld && wAttr(fld, 'fldCharType') === 'end') break;
    }
  }
};

/** Chân trang như mẫu: đường kẻ, "Mã đề ..." bên trái, "Trang x/y" bên phải. */
const FOOTER_PART = 'word/footerMix.xml';
const FOOTER_RID = 'rIdMixFooter';
const footerXml = (code: string, textWidth: number): string => {
  const rPr = `<w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="24"/></w:rPr>`;
  const field = (name: string, shown: string) =>
    `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr}<w:instrText>${name}</w:instrText></w:r><w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr}<w:t>${shown}</w:t></w:r><w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${textWidth - 20}"/></w:tabs><w:spacing w:after="0" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:pict><v:line id="_x0000_s2049" style="position:absolute;z-index:251658240" from="0,0" to="${textWidth / 20}pt,0"/></w:pict></w:r><w:r>${rPr}<w:t>Mã đề ${code}</w:t></w:r><w:r>${rPr}<w:tab/><w:t xml:space="preserve">Trang </w:t></w:r>${field('PAGE', '1')}<w:r>${rPr}<w:t>/</w:t></w:r>${field('NUMPAGES', '1')}</w:p></w:ftr>`;
};

const addFooterReference = (dom: Document) => {
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  if (!dom.documentElement.getAttribute('xmlns:r')) dom.documentElement.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:r', R_NS);
  const sects = tags(dom, 'w:sectPr');
  for (const sect of sects) {
    if (els(sect).some(e => e.nodeName === 'w:footerReference')) continue;
    const ref = wEl(dom, 'footerReference', { type: 'default' });
    ref.setAttributeNS(R_NS, 'r:id', FOOTER_RID);
    sect.insertBefore(ref, sect.firstChild);
  }
};

/* ---------------------------- Xuất mã đề ---------------------------- */

const applyPerm = (slots: Slot[], perm: number[], dom: Document) => {
  const contents = slots.map(s => s.content);
  const extras = slots.map(s => s.extra);
  const anchors: Array<{ content: Comment; extra: Comment }> = slots.map(s => {
    const c = dom.createComment('slot');
    const ref = s.content[0] || s.trail[0] || (() => {
      const lastFixed = s.lead[s.lead.length - 1] || s.label[s.label.length - 1];
      return lastFixed ? lastFixed.nextSibling : null;
    })();
    s.para.insertBefore(c, ref);
    const e = dom.createComment('slot-extra');
    const blockRef = s.extra[0] || s.para.nextSibling;
    s.para.parentNode!.insertBefore(e, blockRef);
    return { content: c, extra: e };
  });
  slots.forEach(s => { s.content.forEach(removeNode); s.extra.forEach(removeNode); });
  slots.forEach((_, i) => {
    const a = anchors[i];
    for (const node of contents[perm[i]]) a.content.parentNode!.insertBefore(node, a.content);
    for (const node of extras[perm[i]]) a.extra.parentNode!.insertBefore(node, a.extra);
  });
  anchors.forEach(a => { removeNode(a.content); removeNode(a.extra); });
};

const renumberQuestion = (first: Element, num: number) => {
  const text = streamOf(first).text;
  const m = QUESTION_LABEL.exec(text);
  if (!m) return;
  const start = m[1].length + m[2].length;
  if (m[3] !== String(num)) replaceRange(first, start, start + m[3].length, String(num));
};

/** Sửa "câu 5 và câu 6" trong dữ kiện dùng chung theo số câu mới. */
const renumberLead = (lead: Element[], map: Map<number, number>) => {
  for (const p of lead) {
    if (p.nodeName !== 'w:p') continue;
    const text = streamOf(p).text;
    const m = GROUP_REF.exec(text);
    if (!m) continue;
    const reps: Array<[number, number, string]> = [];
    for (const n of m[0].matchAll(/\d{1,3}/g)) {
      const old = parseInt(n[0], 10);
      const fresh = map.get(old);
      if (fresh !== undefined && fresh !== old) reps.push([m.index + n.index!, n[0].length, String(fresh)]);
    }
    for (const [start, len, v] of reps.reverse()) replaceRange(p, start, start + len, v);
    return;
  }
};

const ensurePPr = (p: Element): Element => {
  let pPr = kid(p, 'w:pPr');
  if (!pPr) {
    pPr = newW(p.ownerDocument!, 'pPr');
    p.insertBefore(pPr, p.firstChild);
  }
  return pPr;
};
const setKeepNext = (p: Element) => {
  const pPr = ensurePPr(p);
  // Không để một đoạn câu dẫn bị cắt đôi sang trang sau
  if (!kid(pPr, 'w:keepLines')) putOrdered(pPr, newW(p.ownerDocument!, 'keepLines'), PPR_ORDER);
  if (kid(pPr, 'w:keepNext')) return;
  const el = newW(p.ownerDocument!, 'keepNext');
  const style = kid(pPr, 'w:pStyle');
  pPr.insertBefore(el, style ? style.nextSibling : pPr.firstChild);
};
const attachSect = (body: Element, sect: Element) => {
  const lastEl = els(body).pop();
  let target = lastEl && lastEl.nodeName === 'w:p' && !kid(kid(lastEl, 'w:pPr') || lastEl, 'w:sectPr') ? lastEl : null;
  if (!target) {
    target = newW(body.ownerDocument!, 'p');
    body.appendChild(target);
  }
  ensurePPr(target).appendChild(sect);
};

const applyCodeToParagraphs = (dom: Document, code: string): boolean => {
  let found = false;
  const paras = tags(dom, 'w:p');
  paras.forEach((p, i) => {
    const text = streamOf(p).text;
    const m = CODE_RE.exec(text);
    if (!m) return;
    found = true;
    const valueStart = m.index + m[1].length;
    if (m[2]) {
      replaceRange(p, valueStart, valueStart + m[2].length, code);
      return;
    }
    // "Mã đề" ở ô này, số ở ô/đoạn kế tiếp
    const after = text.slice(valueStart).trim();
    if (!after) {
      const nextP = paras[i + 1];
      const nextText = nextP ? streamOf(nextP).text.trim() : '';
      if (nextP && /^(?:\d{1,6}|[xX.…_\-]{2,})$/.test(nextText)) {
        const st = streamOf(nextP).text.indexOf(nextText);
        replaceRange(nextP, st, st + nextText.length, code);
        return;
      }
      replaceRange(p, m.index + m[0].length, m.index + m[0].length, /[:.]\s*$/.test(m[1]) ? ` ${code}` : `: ${code}`);
    }
  });
  return found;
};

const buildVersionXml = (doc: MixDocument, plan: VersionPlan, s: MixSettings): string => {
  const dom = parseXml(doc.xml);
  const a = analyze(dom, doc.env);
  const byId = new Map(a.questions.map(q => [q.id, q]));

  if (s.normalizeFormat) {
    // Đoạn dán từ web mang theo lề và khoảng cách của trang web qua w:divId
    tags(a.body, 'w:divId').forEach(removeNode);
    tags(a.body, 'w:sectPr').forEach(normalizePageMargins);
    a.parts.forEach(p => p.sects.forEach(x => normalizePageMargins(x.sect)));
  }
  const textWidth = textWidthOf(dom);
  for (const pq of plan.questions) {
    const q = byId.get(pq.id)!;
    if (!q.slots) continue;
    cleanMarks(q.slots, q.mark);
    if (s.normalizeFormat && canRebuild(q, a.body)) rebuildOptions(q, pq.perm, a.body, textWidth);
    else if (pq.perm) applyPerm(q.slots, pq.perm, dom);
  }

  // Sau khi đổi phương án, các khối riêng của phương án đã đổi chỗ: lấy lại thứ tự theo tài liệu
  const docOrder = new Map(els(a.body).map((e, i) => [e, i]));
  const body = a.body;
  els(body).forEach(removeNode);
  if (hasExamInfo(s.examInfo)) {
    const ns = dom.documentElement.namespaceURI || '';
    const header = parseXml(examHeaderXml(s.examInfo, plan.code, textWidth, ns)).documentElement;
    body.appendChild(dom.importNode(header, true));
    // Ngắt section ở tiêu đề cũ (ví dụ tiêu đề 1 cột, thân đề 2 cột) vẫn phải được giữ
    for (const n of a.front) {
      const pPr = n.nodeName === 'w:p' ? kid(n, 'w:pPr') : null;
      const sect = pPr ? kid(pPr, 'w:sectPr') : null;
      if (sect) attachSect(body, sect);
    }
  } else {
    a.front.forEach(n => body.appendChild(n));
  }

  for (const part of a.parts) {
    if (part.outline) continue;
    part.heading.forEach((n, i) => {
      if (s.normalizeFormat && n.nodeName === 'w:p' && !isBlank(n)) {
        normalizeParagraphFonts(n);
        setParagraph(n, { before: i === 0 ? 100 : 0, jc: i === 0 ? 'left' : 'both' });
        const pPr = kid(n, 'w:pPr');
        if (pPr) putOrdered(pPr, newW(dom, 'keepNext'), PPR_ORDER);
      }
      if (!(s.normalizeFormat && isBlank(n))) body.appendChild(n);
    });
    const planned = plan.questions.filter(q => q.part === part.index);
    const numMap = new Map(planned.map(q => [q.origNum, q.newNum]));
    planned.forEach((pq, position) => {
      const q = byId.get(pq.id)!;
      if (q.lead.length) renumberLead(q.lead, numMap);
      const firstBlock = q.blocks[0];
      if (!q.auto) renumberQuestion(firstBlock, pq.newNum);
      if (s.normalizeFormat) normalizeQuestionBlocks(q, pq.newNum, doc.env);
      const retained = [...q.retained].sort((x, y) => (docOrder.get(x) ?? 0) - (docOrder.get(y) ?? 0));
      if (s.keepTogether) {
        const seq = [...q.lead, ...retained];
        let lastSolid = seq.length - 1;
        while (lastSolid > 0 && isBlank(seq[lastSolid])) lastSolid--;
        seq.slice(0, lastSolid).forEach(n => { if (n.nodeName === 'w:p') setKeepNext(n); });
      }
      [...q.lead, ...retained].forEach(n => body.appendChild(n));
      for (const sect of part.sects.filter(x => x.position === position)) attachSect(body, sect.sect);
    });
  }
  a.tail.forEach(n => {
    if (s.normalizeFormat && isBlank(n)) return;
    if (s.normalizeFormat && n.nodeName === 'w:p' && TAIL_END_RE.test(blockText(n))) {
      normalizeParagraphFonts(n);
      setParagraph(n, { before: 100, jc: 'center' });
    }
    body.appendChild(n);
  });

  // Bỏ phần đáp án có thể để lại dòng trống/ngắt trang và section thừa ở cuối
  let finalSect = a.finalSect;
  if (a.answerBlocks.length) {
    for (;;) {
      const last = els(body).pop();
      if (!last || last.nodeName !== 'w:p') break;
      const pPr = kid(last, 'w:pPr');
      const sect = pPr ? kid(pPr, 'w:sectPr') : null;
      const blank = !blockText(last).replace(/\s/g, '') && !hasFloating(last);
      if (sect) {
        removeNode(sect);
        finalSect = sect;
      }
      if (!blank) break;
      removeNode(last);
    }
  }
  if (s.normalizeFormat && !a.tail.some(n => TAIL_END_RE.test(blockText(n)))) {
    const end = newW(dom, 'p');
    setParagraph(end, { before: 100, jc: 'center' });
    const run = textRun(dom, '---------- HẾT ----------', true);
    putOrdered(kid(run, 'w:rPr')!, newW(dom, 'i'), RPR_ORDER);
    end.appendChild(run);
    body.appendChild(end);
  }
  if (finalSect) body.appendChild(finalSect);
  if (s.normalizeFormat && !doc.hasFooter) addFooterReference(dom);

  markPageCountDirty(body);
  if (!applyCodeToParagraphs(dom, plan.code) && !doc.codeFound) {
    const p = newW(dom, 'p');
    const pPr = newW(dom, 'pPr');
    const jc = newW(dom, 'jc');
    setWAttr(jc, 'val', 'right');
    pPr.appendChild(jc);
    p.appendChild(pPr);
    p.appendChild(textRun(dom, `Mã đề: ${plan.code}`, true));
    body.insertBefore(p, body.firstChild);
  }
  return serializeXml(dom);
};

/** Đọc lại file vừa tạo, đối chiếu với đề gốc: đúng câu, đúng phương án, đúng đáp án, không lộ đáp án. */
const verifyVersion = (doc: MixDocument, plan: VersionPlan, xml: string): string[] => {
  const problems: string[] = [];
  const orig = analyze(parseXml(doc.xml), doc.env);
  const out = analyze(parseXml(xml), doc.env);
  const origById = new Map(orig.questions.map(q => [q.id, q]));
  if (out.questions.length !== plan.questions.length) {
    problems.push(`Số câu sau khi trộn là ${out.questions.length}, đề gốc có ${plan.questions.length}.`);
    return problems;
  }
  plan.questions.forEach((pq, i) => {
    const q = out.questions[i];
    const o = origById.get(pq.id)!;
    const label = `Câu ${pq.newNum} (câu ${pq.origNum} đề gốc)`;
    if (q.num !== pq.newNum) problems.push(`${label}: số câu sai (${q.num}).`);
    if (q.stemFp !== o.stemFp) problems.push(`${label}: nội dung câu dẫn khác đề gốc.`);
    if (o.optionFps.length) {
      const expected = pq.perm ? pq.perm.map(x => o.optionFps[x]) : o.optionFps;
      if (q.optionFps.join('\u0001') !== expected.join('\u0001')) problems.push(`${label}: phương án khác đề gốc.`);
    }
    if (pq.kind === 'mc' && pq.answer !== '?') {
      const newIdx = MC_LETTERS.indexOf(pq.answer);
      const origIdx = pq.perm ? pq.perm[newIdx] : newIdx;
      if (q.optionFps[newIdx] !== o.optionFps[origIdx]) problems.push(`${label}: đáp án không khớp nội dung phương án.`);
    }
    if (q.markedAnswer) problems.push(`${label}: vẫn còn dấu đánh đáp án đúng trong đề.`);
    if (q.solution.length) problems.push(`${label}: vẫn còn lời giải trong đề.`);
  });
  if (out.answerBlocks.length) problems.push('Vẫn còn phần đáp án trong đề.');
  for (const name of R_NS_ATTRS) {
    for (const el of tags(out.body, '*')) {
      const v = el.getAttribute(name);
      if (v && v !== FOOTER_RID && doc.env.rels.size && !doc.env.rels.has(v)) problems.push(`Thiếu tài nguyên ${v}.`);
    }
  }
  return Array.from(new Set(problems));
};

/** Thêm phần chân trang vào gói Word; chỉ khai báo một lần trong rels và Content_Types. */
const addFooterPart = async (doc: MixDocument, code: string) => {
  doc.zip.file(FOOTER_PART, footerXml(code, doc.normalizedTextWidth));
  const relsName = 'word/_rels/document.xml.rels';
  const rels = await doc.zip.file(relsName)!.async('string');
  if (!rels.includes(FOOTER_RID)) {
    doc.zip.file(relsName, rels.replace('</Relationships>', `<Relationship Id="${FOOTER_RID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footerMix.xml"/></Relationships>`));
  }
  const typesName = '[Content_Types].xml';
  const types = await doc.zip.file(typesName)!.async('string');
  if (!types.includes('/word/footerMix.xml')) {
    doc.zip.file(typesName, types.replace('</Types>', '<Override PartName="/word/footerMix.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>'));
  }
};

export const buildVersion = async (doc: MixDocument, plan: VersionPlan, s: MixSettings): Promise<BuiltVersion> => {
  const xml = buildVersionXml(doc, plan, s);
  const problems = verifyVersion(doc, plan, xml);
  doc.zip.file('word/document.xml', xml);
  for (const [name, content] of Object.entries(doc.headerFooters)) {
    const dom = parseXml(content);
    const blankFooter = /footer/.test(name) && !['w:t', 'w:instrText', 'w:fldSimple', 'w:drawing', 'w:pict'].some(tag => tags(dom, tag).length > 0);
    if (s.normalizeFormat && blankFooter) doc.zip.file(name, footerXml(plan.code, doc.normalizedTextWidth));
    else doc.zip.file(name, applyCodeToParagraphs(dom, plan.code) ? serializeXml(dom) : content);
  }
  if (s.normalizeFormat && !doc.hasFooter) await addFooterPart(doc, plan.code);
  else if (doc.zip.file(FOOTER_PART)) doc.zip.remove(FOOTER_PART);
  const blob = await doc.zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { plan, blob, problems };
};

/* ---------------------------- Bảng đáp án Excel (.xlsx) ---------------------------- */

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (n: number): string => {
  let s = '';
  for (let x = n + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
type Cell = string | number;
const sheetXml = (rows: Cell[][], widths: number[], plainHeader = false): string => {
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const body = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      const style = r === 0 && !plainHeader ? ' s="1"' : '';
      if (typeof v === 'number') return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData></worksheet>`;
};

const KIND_LABEL: Record<MixKind, string> = { mc: 'Trắc nghiệm', tf: 'Đúng – Sai', short: 'Trả lời ngắn', essay: 'Tự luận' };

const buildWorkbook = async (sheets: Array<{ name: string; rows: Cell[][]; widths: number[]; plainHeader?: boolean }>): Promise<Blob> => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths, s.plainHeader)));
  return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
};

const partLabel = (doc: MixDocument, part: number): string => {
  if (doc.parts.length <= 1) return '';
  const title = doc.parts[part]?.title || '';
  const m = /^\s*(?:PHẦN|Phần|PART|Part)\s+(\S+?)[.:\s]/.exec(`${title} `);
  return m ? `Phần ${m[1]}` : `Phần ${part + 1}`;
};

/**
 * Bảng đáp án đúng theo file mẫu "ĐÁP ÁN CÁC MÃ ĐỀ.xlsx": cột đầu "Câu\\Mã Đề", mã đề từ lớn đến nhỏ,
 * số câu theo từng phần (Phần I, II, III đều bắt đầu từ 1), không có câu tự luận.
 */
export const answerRows = (plans: VersionPlan[]): Cell[][] => {
  const ordered = [...plans].sort((a, b) => Number(b.code) - Number(a.code));
  const rows: Cell[][] = [['Câu\\Mã Đề', ...ordered.map(p => Number(p.code))]];
  const first = plans[0];
  if (!first) return rows;
  const byPosition = ordered.map(p => p.questions);
  first.questions.forEach((q, i) => {
    if (q.kind === 'essay') return;
    rows.push([String(q.newNum), ...byPosition.map(list => list[i].answer)]);
  });
  return rows;
};

export const buildAnswerWorkbook = (doc: MixDocument, built: BuiltVersion[], settings: MixSettings): Promise<Blob> => {
  const plans = built.map(b => b.plan);
  const answerSheet = answerRows(plans);
  const mapping: Cell[][] = [['Mã đề', 'Phần', 'Câu trong mã đề', 'Câu ở đề gốc', 'Dạng', 'Đáp án đề gốc', 'Đáp án mã đề', 'Thứ tự phương án (mới ← gốc)']];
  const original = new Map(doc.questions.map(q => [q.id, q]));
  for (const p of plans) {
    for (const q of p.questions) {
      const letters = q.kind === 'tf' ? TF_LETTERS : MC_LETTERS;
      const arrows = q.perm ? q.perm.map((x, i) => `${letters[i]}←${letters[x]}`).join(' ') : '';
      mapping.push([p.code, partLabel(doc, q.part), q.newNum, q.origNum, KIND_LABEL[q.kind], original.get(q.id)?.answer || '', q.answer, arrows]);
    }
  }
  const info: Cell[][] = [['Thông tin', 'Giá trị'], ['Tên file gốc', doc.fileName], ['Số câu', doc.questions.length], ['Số mã đề', plans.length], ['Hạt giống ngẫu nhiên', settings.seed], ['Đảo câu', settings.shuffleQuestions ? 'Có' : 'Không'], ['Đảo phương án', settings.shuffleOptions ? 'Có' : 'Không'], ['Đảo ý Đúng – Sai', settings.shuffleStatements ? 'Có' : 'Không']];
  for (const b of built) info.push([`Kiểm tra mã ${b.plan.code}`, b.problems.length ? b.problems.join(' ') : 'Đạt']);
  return buildWorkbook([
    { name: 'Sheet1', rows: answerSheet, widths: [], plainHeader: true },
    { name: 'Doi chieu', rows: mapping, widths: [8, 10, 14, 12, 14, 13, 13, 34] },
    { name: 'Thong tin', rows: info, widths: [24, 50] },
  ]);
};
