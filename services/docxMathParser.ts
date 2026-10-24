/**
 * DOCX Math & Question Parser — Trích xuất siêu tốc văn bản, công thức Toán (OMML → LaTeX)
 * và phân tích câu hỏi tức thì (< 50ms) từ file Word (.docx/.doc).
 *
 * Chiến lược tối ưu tốc độ:
 * 1. JSZip giải nén trực tiếp word/document.xml (hỗ trợ Deflate chuẩn) + chuyển OMML → LaTeX (< 15ms)
 * 2. Chỉ gọi Mammoth khi thực sự có ảnh WMF/EMF (MathType) hoặc khi không có document.xml
 * 3. Bộ phân tích câu hỏi cục bộ (extractQuestionsLocally) bóc tách ngay lập tức Dạng I, II, III, Tự luận
 *    mà không cần chờ AI gọi API mạng.
 */

import JSZip from 'jszip';
import mammoth from 'mammoth';
import { ExtractedQuestion, QuestionConfig } from '../types';
import { analyzeTables, parseMatrixContract, TableKind } from './matrixContract';

export interface DocxParseResult {
  text: string;
  images: { base64: string; mimeType: string }[];
  method: 'xml' | 'mammoth' | 'hybrid';
  wmfCount: number;
}

// --- XML Entity Decoder ---
const decodeXmlEntities = (str: string): string =>
  str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)));

// --- OMML → LaTeX converter ---
const extractMathText = (xml: string): string => {
  let result = '';
  const textMatches = xml.matchAll(/<(?:m|w):t(?:\s[^>]*)?>([^<]*)<\/(?:m|w):t>/g);
  for (const match of textMatches) {
    result += decodeXmlEntities(match[1]);
  }
  if (result) return result;
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, '').trim());
};

// Các cấu trúc OMML được xử lý TỪ TRONG RA NGOÀI (khối không chứa cấu trúc con nào được đổi trước),
// nên phân số lồng phân số, luỹ thừa của ngoặc, hàm sin/cos… không còn bị cắt sai hay mất chữ.
const OMML_STRUCTS = 'sSubSup|sSup|sSub|sPre|f|rad|nary|d|func|acc|bar|limLow|limUpp|groupChr|box|borderBox|eqArr|m';
const OMML_INNERMOST_RE = new RegExp(
  `<m:(${OMML_STRUCTS})(?=[\\s>])[^>]*>((?:(?!<m:(?:${OMML_STRUCTS})(?=[\\s>/]))[\\s\\S])*?)<\\/m:\\1>`,
  'g'
);
const OMML_FUNC_NAMES = new Set(['sin', 'cos', 'tan', 'cot', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh']);
const OMML_ACCENTS: Record<string, string> = {
  '\u0302': '\\hat', '^': '\\hat', '\u0303': '\\tilde', '~': '\\tilde', '\u20d7': '\\vec', '\u2192': '\\vec',
  '\u0307': '\\dot', '\u0308': '\\ddot', '\u0304': '\\bar', '\u0305': '\\overline', '\u00af': '\\bar', '\u20d6': '\\overleftarrow',
};
const OMML_NARY: Record<string, string> = { '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap' };
const UNICODE_TO_LATEX: Array<[RegExp, string]> = [
  [/≤/g, '\\le '], [/≥/g, '\\ge '], [/≠/g, '\\ne '], [/∞/g, '\\infty '], [/π/g, '\\pi '], [/→/g, '\\to '],
  [/∈/g, '\\in '], [/∉/g, '\\notin '], [/±/g, '\\pm '], [/×/g, '\\times '], [/÷/g, '\\div '], [/⇒/g, '\\Rightarrow '],
  [/⇔/g, '\\Leftrightarrow '], [/∀/g, '\\forall '], [/∃/g, '\\exists '], [/∅/g, '\\varnothing '], [/∩/g, '\\cap '],
  [/∪/g, '\\cup '], [/⊂/g, '\\subset '], [/⊃/g, '\\supset '], [/°/g, '^{\\circ}'], [/·/g, '\\cdot '], [/[∆Δ]/g, '\\Delta '],
  [/α/g, '\\alpha '], [/β/g, '\\beta '], [/γ/g, '\\gamma '], [/θ/g, '\\theta '], [/λ/g, '\\lambda '], [/μ/g, '\\mu '],
  [/σ/g, '\\sigma '], [/φ/g, '\\varphi '], [/ω/g, '\\omega '], [/−/g, '-'],
];

const encMathText = (latex: string) => `<m:r><m:t>${latex.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</m:t></m:r>`;
const ommlChild = (inner: string, tag: string): string | null => {
  const m = new RegExp(`<m:${tag}(?=[\\s>])[^>]*>([\\s\\S]*?)<\\/m:${tag}>`).exec(inner);
  return m ? m[1] : null;
};
const ommlChildren = (inner: string, tag: string): string[] =>
  Array.from(inner.matchAll(new RegExp(`<m:${tag}(?=[\\s>])[^>]*>([\\s\\S]*?)<\\/m:${tag}>`, 'g'))).map(m => m[1]);
const ommlVal = (inner: string, tag: string): string | null => {
  const m = new RegExp(`<m:${tag}\\b[^>]*m:val="([^"]*)"`).exec(inner);
  return m ? decodeXmlEntities(m[1]) : null;
};
const tx = (xml: string | null) => (xml ? extractMathText(xml).trim() : '');
const delim = (ch: string, side: 'l' | 'r') => {
  if (ch === '') return side === 'l' ? '\\left.' : '\\right.';
  const map: Record<string, string> = { '{': '\\{', '}': '\\}', '〈': '\\langle', '⟨': '\\langle', '〉': '\\rangle', '⟩': '\\rangle', '‖': '\\|', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil' };
  return `${side === 'l' ? '\\left' : '\\right'}${map[ch] || ch}`;
};

const convertOmmlStruct = (tag: string, inner: string): string => {
  switch (tag) {
    case 'sSubSup': return `${tx(ommlChild(inner, 'e'))}_{${tx(ommlChild(inner, 'sub'))}}^{${tx(ommlChild(inner, 'sup'))}}`;
    case 'sSup': return `${tx(ommlChild(inner, 'e'))}^{${tx(ommlChild(inner, 'sup'))}}`;
    case 'sSub': return `${tx(ommlChild(inner, 'e'))}_{${tx(ommlChild(inner, 'sub'))}}`;
    case 'sPre': return `{}_{${tx(ommlChild(inner, 'sub'))}}^{${tx(ommlChild(inner, 'sup'))}}${tx(ommlChild(inner, 'e'))}`;
    case 'f': {
      const num = tx(ommlChild(inner, 'num'));
      const den = tx(ommlChild(inner, 'den'));
      const type = ommlVal(inner, 'type');
      if (type === 'lin') return `${num}/${den}`;
      if (type === 'noBar') return `\\binom{${num}}{${den}}`;
      return `\\frac{${num}}{${den}}`;
    }
    case 'rad': {
      const deg = tx(ommlChild(inner, 'deg'));
      const e = tx(ommlChild(inner, 'e'));
      return deg ? `\\sqrt[${deg}]{${e}}` : `\\sqrt{${e}}`;
    }
    case 'nary': {
      const chr = ommlVal(inner, 'chr');
      const op = OMML_NARY[chr ?? '∫'] || (chr ? chr : '\\int');
      const sub = tx(ommlChild(inner, 'sub'));
      const sup = tx(ommlChild(inner, 'sup'));
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${tx(ommlChild(inner, 'e'))}`;
    }
    case 'd': {
      const beg = ommlVal(inner, 'begChr');
      const end = ommlVal(inner, 'endChr');
      const sep = ommlVal(inner, 'sepChr');
      const items = ommlChildren(inner, 'e').map(x => tx(x));
      const body = items.join(sep ?? ',');
      const l = beg ?? '(';
      const r = end ?? ')';
      // Ngoặc thường → giữ ký tự gốc; ngoặc nhọn hệ phương trình / ngoặc rỗng → \left \right
      if ((l === '(' && r === ')') || (l === '[' && r === ']') || (l === '|' && r === '|')) return `${l}${body}${r}`;
      return `${delim(l, 'l')} ${body} ${delim(r, 'r')}`;
    }
    case 'func': {
      const name = tx(ommlChild(inner, 'fName'));
      const arg = tx(ommlChild(inner, 'e'));
      return OMML_FUNC_NAMES.has(name) ? `\\${name} ${arg}` : `${name} ${arg}`;
    }
    case 'acc': {
      const chr = ommlVal(inner, 'chr') ?? '\u0302';
      return `${OMML_ACCENTS[chr] || '\\hat'}{${tx(ommlChild(inner, 'e'))}}`;
    }
    case 'bar': return `${ommlVal(inner, 'pos') === 'bot' ? '\\underline' : '\\overline'}{${tx(ommlChild(inner, 'e'))}}`;
    case 'limLow': {
      const e = tx(ommlChild(inner, 'e'));
      return `${OMML_FUNC_NAMES.has(e) ? `\\${e}` : e}_{${tx(ommlChild(inner, 'lim'))}}`;
    }
    case 'limUpp': return `${tx(ommlChild(inner, 'e'))}^{${tx(ommlChild(inner, 'lim'))}}`;
    case 'eqArr': return `\\begin{array}{l} ${ommlChildren(inner, 'e').map(x => tx(x)).join(' \\\\ ')} \\end{array}`;
    case 'm': {
      const rows = ommlChildren(inner, 'mr').map(row => ommlChildren(row, 'e').map(x => tx(x)).join(' & '));
      return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`;
    }
    default: // groupChr, box, borderBox
      return tx(ommlChild(inner, 'e'));
  }
};

export const ommlToLatex = (ommlXml: string): string => {
  let latex = ommlXml;
  for (let pass = 0; pass < 60; pass++) {
    const prev = latex;
    latex = latex.replace(OMML_INNERMOST_RE, (_m, tag: string, inner: string) => encMathText(convertOmmlStruct(tag, inner)));
    if (latex === prev) break;
  }
  let out = extractMathText(latex);
  for (const [re, rep] of UNICODE_TO_LATEX) out = out.replace(re, rep);
  return out.replace(/[ ]{2,}/g, ' ');
};

// --- XML Parser: Extract text + OMML from word/document.xml ---
const processDocumentXml = (xmlContent: string): string => {
  const lines: string[] = [];
  const paragraphs = xmlContent.split(/<w:p(?=[ >])/);

  for (let i = 1; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    // Tokenize paragraph in document order: <m:oMath>, <w:t>, <w:tab/>, <w:br/>
    let paraText = '';
    const tokenRegex = /<m:oMath(?![P])[^>]*>[\s\S]*?<\/m:oMath>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>/g;

    for (const match of para.matchAll(tokenRegex)) {
      const token = match[0];
      if (token.startsWith('<m:oMath')) {
        const latex = ommlToLatex(token).trim();
        if (latex) {
          paraText += ` $${latex}$ `;
        }
      } else if (token.startsWith('<w:tab')) {
        paraText += '\t';
      } else if (token.startsWith('<w:br')) {
        paraText += '\n';
      } else if (match[1] !== undefined) {
        paraText += decodeXmlEntities(match[1]);
      }
    }

    const cleaned = paraText
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ ]{2,}/g, ' ')
      .trim();

    if (cleaned) {
      lines.push(cleaned);
    }
  }

  return lines.join('\n');
};

// --- Convert HTML / MHTML string to line-preserved plain text ---
const htmlToStructuredText = (html: string): string => {
  return decodeXmlEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<img[^>]*>/gi, ' ')
      .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '\t')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// --- Decode Quoted-Printable MHTML (e.g. word/afchunk.mht from html-docx-js) ---
const decodeMhtContent = (mhtRaw: string): string => {
  // Strip soft line breaks =\r?\n and decode =XX hex UTF-8 bytes
  const strippedSoft = mhtRaw.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  let i = 0;
  while (i < strippedSoft.length) {
    if (
      strippedSoft[i] === '=' &&
      i + 2 < strippedSoft.length &&
      /^[0-9A-Fa-f]{2}$/.test(strippedSoft.slice(i + 1, i + 3))
    ) {
      bytes.push(parseInt(strippedSoft.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const code = strippedSoft.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        const encoded = new TextEncoder().encode(strippedSoft[i]);
        for (const b of encoded) bytes.push(b);
      }
      i++;
    }
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  const htmlStart = decoded.search(/<!DOCTYPE|<html|<body|<table|<p/i);
  const htmlPart = htmlStart !== -1 ? decoded.slice(htmlStart) : decoded;
  return htmlToStructuredText(htmlPart);
};

// --- Extract DOCX via JSZip (Fast Path < 15ms) ---
const extractDocxViaJsZip = async (arrayBuffer: ArrayBuffer): Promise<{
  text: string;
  images: { base64: string; mimeType: string }[];
  wmfCount: number;
} | null> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    let text = '';
    let wmfCount = 0;
    const images: { base64: string; mimeType: string }[] = [];

    // 1. Standard word/document.xml
    const docXmlFile = zip.file('word/document.xml');
    if (docXmlFile) {
      const xmlContent = await docXmlFile.async('string');
      text = processDocumentXml(xmlContent);
    }

    // 2. Fallback for altChunk MHTML (files exported by html-docx-js)
    if (!text || text.trim().length < 10) {
      const mhtFile = zip.file('word/afchunk.mht') || zip.file(/afchunk.*\.mht$/i)[0];
      if (mhtFile) {
        const mhtRaw = await mhtFile.async('string');
        text = decodeMhtContent(mhtRaw);
      }
    }

    // 3. Inspect media files
    const mediaFiles: { name: string; entry: JSZip.JSZipObject }[] = [];
    zip.forEach((relativePath, fileEntry) => {
      if (fileEntry.dir) return;
      if (/\.(wmf|emf)$/i.test(relativePath)) {
        wmfCount++;
      } else if (/^word\/media\/.+\.(png|jpe?g|gif|webp)$/i.test(relativePath)) {
        mediaFiles.push({ name: relativePath, entry: fileEntry });
      }
    });

    // Extract up to 10 standard images directly via JSZip (much faster than mammoth)
    for (const media of mediaFiles.slice(0, 10)) {
      const base64 = await media.entry.async('base64');
      const ext = media.name.split('.').pop()?.toLowerCase() || 'png';
      const mimeType =
        ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : ext === 'gif'
            ? 'image/gif'
            : ext === 'webp'
              ? 'image/webp'
              : 'image/png';
      images.push({ base64, mimeType });
    }

    return { text, images, wmfCount };
  } catch (err) {
    console.warn('[DocxMathParser] JSZip parse failed (file may not be a ZIP archive):', err);
    return null;
  }
};

// --- Mammoth fallback (only used when WMF conversion is needed or XML is empty) ---
const extractViaMammoth = async (arrayBuffer: ArrayBuffer): Promise<{
  text: string;
  images: { base64: string; mimeType: string }[];
} | null> => {
  try {
    const images: { base64: string; mimeType: string }[] = [];
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement((image: any) => {
          return image.read('base64').then((imageBase64: string) => {
            const mimeType = image.contentType || 'image/png';
            if (
              images.length < 12 &&
              ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)
            ) {
              images.push({ base64: imageBase64, mimeType });
            }
            return { src: '' };
          });
        }),
      }
    );
    return {
      text: htmlToStructuredText(result.value),
      images,
    };
  } catch (err) {
    console.warn('[DocxMathParser] Mammoth fallback failed:', err);
    return null;
  }
};

// --- Fallback for non-ZIP .doc / HTML-as-.doc / RTF files ---
const extractFallbackRawText = (arrayBuffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(arrayBuffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  // Case 1: HTML or XML saved with .doc / .docx extension
  if (/<(!DOCTYPE|html|body|table|p|div|span|w:document)/i.test(utf8)) {
    return htmlToStructuredText(utf8);
  }

  // Case 2: MHTML saved with .doc / .docx extension
  if (/MIME-Version:|Content-Type:\s*multipart\/related/i.test(utf8)) {
    return decodeMhtContent(utf8);
  }

  // Case 3: Plain UTF-8 text
  const printableRatio =
    utf8.slice(0, 2000).replace(/[^\x20-\x7E\u00A0-\u1EF9\r\n\t]/g, '').length /
    Math.max(1, Math.min(utf8.length, 2000));
  if (printableRatio > 0.7) {
    return utf8.trim();
  }

  // Case 4: Legacy binary .doc (OLE2 Compound Document 0xD0 0xCF) — extract UTF-16LE text runs
  const utf16 = new TextDecoder('utf-16le', { fatal: false }).decode(bytes);
  const runs = utf16.match(/[\x20-\x7E\u00A0-\u1EF9\r\n\t]{12,}/g);
  if (runs && runs.length > 0) {
    return runs.join('\n').trim();
  }

  return '';
};

// --- Main DOCX Parser (Fast Hybrid) ---
export const parseDocxWithMath = async (arrayBuffer: ArrayBuffer): Promise<DocxParseResult> => {
  const t0 = performance.now();

  // Step 1: Fast JSZip extraction (< 15ms)
  const zipResult = await extractDocxViaJsZip(arrayBuffer);

  if (zipResult && zipResult.text.trim().length > 20) {
    // Only invoke Mammoth if there are WMF/EMF MathType formulas AND no standard images were extracted
    let images = zipResult.images;
    if (zipResult.wmfCount > 0 && images.length === 0) {
      const mammothRes = await extractViaMammoth(arrayBuffer);
      if (mammothRes && mammothRes.images.length > 0) {
        images = mammothRes.images;
      }
    }

    console.log(
      `[DocxMathParser] Fast ZIP parsed in ${Math.round(performance.now() - t0)}ms: ${zipResult.text.length} chars, ${images.length} images, ${zipResult.wmfCount} WMF`
    );

    return {
      text: zipResult.text,
      images,
      method: zipResult.wmfCount > 0 ? 'hybrid' : 'xml',
      wmfCount: zipResult.wmfCount,
    };
  }

  // Step 2: Mammoth fallback (if ZIP had no document.xml or very short text)
  const mammothResult = await extractViaMammoth(arrayBuffer);
  if (mammothResult && (mammothResult.text.trim().length > 0 || mammothResult.images.length > 0)) {
    return {
      text: mammothResult.text,
      images: mammothResult.images,
      method: 'mammoth',
      wmfCount: zipResult?.wmfCount || 0,
    };
  }

  // Step 3: Non-ZIP fallback (.doc / HTML / MHTML / UTF-16LE)
  const fallbackText = extractFallbackRawText(arrayBuffer);
  if (fallbackText.trim().length > 0) {
    return {
      text: fallbackText,
      images: [],
      method: 'xml',
      wmfCount: 0,
    };
  }

  throw new Error('Không thể đọc nội dung file Word. Vui lòng lưu file dưới dạng .docx chuẩn hoặc .pdf.');
};

// ============================================================================
// INSTANT LOCAL QUESTION PARSER (< 5ms, 0 API latency)
// ============================================================================

const detectSectionType = (line: string): 'type1' | 'type2' | 'type3' | 'essay' | null => {
  const clean = line.replace(/[*_#]+/g, '').trim();
  if (clean.length > 140) return null;

  if (
    /^(?:PHẦN|DẠNG|MỤC)\s*(?:I|1)\b/i.test(clean) ||
    /TRẮC\s*NGHIỆM\s*(?:NHIỀU\s*LỰA\s*CHỌN|4\s*LỰA\s*CHỌN|KHÁCH\s*QUAN)/i.test(clean)
  ) {
    return 'type1';
  }
  if (
    /^(?:PHẦN|DẠNG|MỤC)\s*(?:II|2)\b/i.test(clean) ||
    /(?:TRẮC\s*NGHIỆM\s*)?ĐÚNG\s*[-/–]?\s*SAI/i.test(clean)
  ) {
    return 'type2';
  }
  if (
    /^(?:PHẦN|DẠNG|MỤC)\s*(?:III|3)\b/i.test(clean) ||
    /TRẢ\s*LỜI\s*NGẮN/i.test(clean)
  ) {
    return 'type3';
  }
  if (
    /^(?:PHẦN|DẠNG|MỤC)\s*(?:IV|4)\b/i.test(clean) ||
    /^(?:[IVX]+\.\s*)?TỰ\s*LUẬN\b/i.test(clean)
  ) {
    return 'essay';
  }
  return null;
};

const isAnswerKeySectionHeader = (line: string): boolean => {
  const clean = line.replace(/[*_#]+/g, '').trim();
  if (clean.length > 100) return false;
  return /^(?:BẢNG\s*ĐÁP\s*ÁN|ĐÁP\s*ÁN\s*VÀ\s*HƯỚNG\s*DẪN|HƯỚNG\s*DẪN\s*CHẤM|ĐÁP\s*ÁN\s*THAM\s*KHẢO|---\s*HẾT\s*---)/i.test(
    clean
  );
};

const extractAnswerKeyMap = (answerSectionText: string): Record<number, string> => {
  const map: Record<number, string> = {};
  if (!answerSectionText) return map;

  // Match patterns like "Câu 1. A", "1. A", "1-B", "1: C", "1A"
  const pairs = answerSectionText.matchAll(/(?:Câu\s*)?(\d{1,3})\s*[.:\-)\s]\s*([A-D])\b/gi);
  for (const m of pairs) {
    const num = parseInt(m[1], 10);
    if (!map[num]) {
      map[num] = m[2].toUpperCase();
    }
  }
  return map;
};

const detectQuestionLevel = (
  text: string,
  indexInSection: number,
  totalInSection: number
): 'biet' | 'hieu' | 'van_dung' | 'van_dung_cao' => {
  if (/(\[|\()\s*(?:VDC|Mức\s*4|Vận\s*dụng\s*cao)\s*(\]|\))/i.test(text)) return 'van_dung_cao';
  if (/(\[|\()\s*(?:VD|Mức\s*3|Vận\s*dụng)\s*(\]|\))/i.test(text)) return 'van_dung';
  if (/(\[|\()\s*(?:TH|Mức\s*2|Thông\s*hiểu)\s*(\]|\))/i.test(text)) return 'hieu';
  if (/(\[|\()\s*(?:NB|Mức\s*1|Nhận\s*biết)\s*(\]|\))/i.test(text)) return 'biet';

  const ratio = (indexInSection + 1) / Math.max(1, totalInSection);
  if (ratio <= 0.5) return 'biet';
  if (ratio <= 0.8) return 'hieu';
  return 'van_dung';
};

/**
 * Trích xuất câu hỏi TỨC THÌ (< 5ms) từ văn bản đề thi / ngân hàng câu hỏi tiếng Việt
 * mà không cần gọi API AI.
 */
export const extractQuestionsLocally = (rawText: string): ExtractedQuestion[] => {
  if (!rawText || rawText.trim().length < 20) return [];

  const allLines = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('=== TÀI LIỆU'));

  // Separate main exam body from trailing answer key section (only after at least 2 questions appeared)
  const bodyLines: string[] = [];
  const answerLines: string[] = [];
  let inAnswerSection = false;
  let seenQuestionCount = 0;
  const questionStartPattern = /^(?:\*\*|__)?(?:Câu|Bài|Question)\s*(\d+)\s*(?:[.:)\-]|(?=\s|\(|\[))(?:\*\*|__)?\s*(.*)$/i;

  for (const line of allLines) {
    if (!inAnswerSection && seenQuestionCount >= 2 && isAnswerKeySectionHeader(line)) {
      inAnswerSection = true;
    }
    if (inAnswerSection) {
      answerLines.push(line);
    } else {
      if (questionStartPattern.test(line)) seenQuestionCount++;
      bodyLines.push(line);
    }
  }

  const answerKeyMap = extractAnswerKeyMap(answerLines.join('\n'));

  interface RawQuestionBlock {
    qNum: number;
    sectionType: 'type1' | 'type2' | 'type3' | 'essay';
    lines: string[];
  }

  const blocks: RawQuestionBlock[] = [];
  let currentSection: 'type1' | 'type2' | 'type3' | 'essay' = 'type1';
  let currentBlock: RawQuestionBlock | null = null;

  for (const line of bodyLines) {
    const detectedSec = detectSectionType(line);
    if (detectedSec) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      currentSection = detectedSec;
      continue;
    }

    const qMatch = line.match(questionStartPattern);
    if (qMatch) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      const qNum = parseInt(qMatch[1], 10);
      const firstLineRest = qMatch[2].trim();
      const isBai = /^(\*\*|__)?Bài\s+/i.test(line);
      currentBlock = {
        qNum,
        sectionType: isBai && currentSection === 'type1' ? 'essay' : currentSection,
        lines: firstLineRest ? [firstLineRest] : [],
      };
      continue;
    }

    if (currentBlock) {
      currentBlock.lines.push(line);
    }
  }
  if (currentBlock) {
    blocks.push(currentBlock);
  }

  if (blocks.length === 0) return [];

  const extracted: ExtractedQuestion[] = [];

  blocks.forEach((block, idx) => {
    const fullBlockText = block.lines.join('\n').trim();
    if (!fullBlockText) return;

    // Strip inline "Lời giải:" / "Hướng dẫn giải:" if present, capturing inline answer
    let inlineAnswer: string | undefined;
    const inlineAnsMatch = fullBlockText.match(
      /(?:^|\n)\s*(?:Đáp\s*án|Đáp\s*số|Chọn)\s*[:.]?\s*([A-D]|[^\n]{1,30})/i
    );
    if (inlineAnsMatch) {
      inlineAnswer = inlineAnsMatch[1].trim();
    }

    const cleanedText = fullBlockText
      .replace(/(?:^|\n)\s*(?:Lời\s*giải|Hướng\s*dẫn\s*giải)\s*[:.]?[\s\S]*$/i, '')
      .replace(/(?:^|\n)\s*(?:Đáp\s*án|Đáp\s*số)\s*[:.]\s*[^\n]+$/i, '')
      .trim();

    // Try extracting A. B. C. D. options (supports both multi-line and inline options)
    const optionRegex = /(?:^|\n|\t|\s{2,})(\*?[A-D])\s*[.:)]\s*(.+?)(?=(?:\n|\t|\s{2,})\*?[A-D]\s*[.:)]\s*|$)/gs;
    const optionMatches = Array.from(cleanedText.matchAll(optionRegex));
    const optionLetters = optionMatches.map(m => m[1].replace('*', '').toUpperCase());
    const hasABCD =
      optionLetters.includes('A') &&
      optionLetters.includes('B') &&
      (optionLetters.includes('C') || optionLetters.includes('D'));

    // Try extracting a) b) c) d) sub-items (True/False - Dạng II)
    const subItemRegex = /(?:^|\n|\t|\s{2,})(\*?[a-d])\s*[).]\s*(.+?)(?=(?:\n|\t|\s{2,})\*?[a-d]\s*[).]\s*|$)/gs;
    const subItemMatches = Array.from(cleanedText.matchAll(subItemRegex));
    const subLetters = subItemMatches.map(m => m[1].replace('*', '').toLowerCase());
    const hasSubItems =
      subLetters.includes('a') &&
      subLetters.includes('b') &&
      subLetters.includes('c') &&
      (block.sectionType === 'type2' || !hasABCD);

    let qType: 'type1' | 'type2' | 'type3' | 'essay' = block.sectionType;
    let stem = cleanedText;
    let options: string[] | undefined;
    let subItems: string[] | undefined;
    let answer = inlineAnswer || answerKeyMap[block.qNum];

    if (hasSubItems) {
      qType = 'type2';
      const firstSubIdx = subItemMatches[0].index ?? 0;
      stem = cleanedText.slice(0, firstSubIdx).trim();
      subItems = subItemMatches.map(m => {
        const letter = m[1].replace('*', '').toLowerCase();
        return `${letter}) ${m[2].trim()}`;
      });
    } else if (hasABCD) {
      qType = 'type1';
      const firstOptIdx = optionMatches[0].index ?? 0;
      stem = cleanedText.slice(0, firstOptIdx).trim();
      options = optionMatches.map(m => {
        const rawLetter = m[1];
        const letter = rawLetter.replace('*', '').toUpperCase();
        if (rawLetter.startsWith('*') && !answer) {
          answer = letter;
        }
        return `${letter}. ${m[2].trim()}`;
      });
    }

    const level = detectQuestionLevel(stem, idx, blocks.length);

    extracted.push({
      id: `q${idx + 1}`,
      type: qType,
      level,
      topic: 'Tài liệu tham khảo',
      content: stem || cleanedText,
      options,
      subItems,
      answer,
    });
  });

  return extracted;
};

// ============================================================================
// EXACT DOCX TABLE → HTML CONVERTER (Preserves rowspan/vMerge, colspan/gridSpan, OMML)
// ============================================================================

const escapeHtmlText = (str: string): string =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const extractParagraphHtml = (paraXml: string): { html: string; isBold: boolean; isCentered: boolean } => {
  const pPrMatch = paraXml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  const pPr = pPrMatch ? pPrMatch[1] : '';
  const isCentered = /<w:jc[^>]*w:val="center"/i.test(pPr);

  let text = '';
  let boldRuns = 0;
  let totalRuns = 0;

  const tokenRegex =
    /<m:oMath(?![P])[^>]*>[\s\S]*?<\/m:oMath>|<w:r(?=[ >])[^>]*>([\s\S]*?)<\/w:r>|<w:tab\s*\/>|<w:br(?:\s[^>]*)?\/>/g;

  for (const match of paraXml.matchAll(tokenRegex)) {
    const token = match[0];
    if (token.startsWith('<m:oMath')) {
      const latex = ommlToLatex(token).trim();
      if (latex) {
        text += ` $${escapeHtmlText(latex)}$ `;
      }
    } else if (token.startsWith('<w:tab')) {
      text += ' ';
    } else if (token.startsWith('<w:br')) {
      text += '<br>';
    } else if (match[1] !== undefined) {
      const rXml = match[1];
      let rText = '';
      for (const tm of rXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
        rText += decodeXmlEntities(tm[1]);
      }
      if (rText) {
        totalRuns++;
        const hasBold = /<w:b\b(?![^>]*w:val="(?:false|0)")/i.test(rXml);
        if (hasBold) boldRuns++;
        text += escapeHtmlText(rText);
      }
    }
  }

  const cleaned = text.replace(/[ ]{2,}/g, ' ').trim();
  const isBold = totalRuns > 0 && boldRuns === totalRuns;
  return { html: cleaned, isBold, isCentered };
};

// ---------------------------------------------------------------------------
// Bộ duyệt khối OOXML có ĐẾM ĐỘ SÂU (thay cho regex non-greedy):
//  - an toàn với bảng lồng trong ô (<w:tbl> trong <w:tc>), đoạn văn trong textbox…
//  - tìm được <w:tbl>/<w:tr>/<w:tc> nằm trong <w:sdt>/<w:customXml>
// ---------------------------------------------------------------------------
const blockTagRe = (tag: string) => new RegExp(`<(\\/?)${tag}(?=[\\s>/])[^>]*?(\\/?)>`, 'g');

/** Vị trí ngay sau thẻ đóng tương ứng của khối bắt đầu tại `start` (-1 nếu không đóng). */
const findBlockEnd = (xml: string, tag: string, start: number): number => {
  const re = blockTagRe(tag);
  re.lastIndex = start;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[1] === '/') {
      depth--;
      if (depth <= 0) return re.lastIndex;
    } else if (m[2] === '/') {
      if (depth === 0) return re.lastIndex; // <w:p/> tự đóng
    } else {
      depth++;
    }
  }
  return -1;
};

/** Các khối cấp ngoài cùng (theo thứ tự tài liệu) thuộc một trong các thẻ `tags`. */
const iterateBlocks = (xml: string, tags: string[]): Array<{ tag: string; xml: string }> => {
  const out: Array<{ tag: string; xml: string }> = [];
  const openRe = new RegExp(`<(${tags.join('|')})(?=[\\s>/])`, 'g');
  let pos = 0;
  while (pos < xml.length) {
    openRe.lastIndex = pos;
    const m = openRe.exec(xml);
    if (!m) break;
    const end = findBlockEnd(xml, m[1], m.index);
    if (end < 0) {
      out.push({ tag: m[1], xml: xml.slice(m.index) });
      break;
    }
    out.push({ tag: m[1], xml: xml.slice(m.index, end) });
    pos = end;
  }
  return out;
};

const readIntVal = (xml: string, tag: string): number => {
  const m = new RegExp(`<${tag}\\b[^>]*w:val="(\\d+)"`).exec(xml);
  return m ? parseInt(m[1], 10) || 0 : 0;
};

const plainOf = (html: string) =>
  decodeXmlEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const isHeaderLabelText = (t: string) =>
  /^(tnkq|tn|tl|tự\s*luận|trắc\s*nghiệm(\s*khách\s*quan)?|nhiều\s*lựa\s*chọn|đúng\s*[-–]?\s*sai|trả\s*lời\s*ngắn|số\s*câu(\s*hỏi)?|số\s*ý|tỉ\s*lệ(\s*%)?|tỷ\s*lệ(\s*%)?|%|điểm|thời\s*gian(\s*\(phút\))?)$/i.test(t.trim().replace(/[“”"]/g, ''));

const isLevelHeaderText = (t: string) =>
  /^(nhận\s*biết|biết|nb|b|thông\s*hiểu|hiểu|th|h|vận\s*dụng\s*cao|vận\s*dụng|vdc|vd|v|mức\s*[1-4])(\s*\([^)]*\))?$/i.test(t.trim());

const convertWordTableXmlToHtml = (tblXml: string): string => {
  interface ParsedCell {
    html: string;
    isBold: boolean;
    isCentered: boolean;
    colspan: number;
    rowspan: number;
    vMerge: 'restart' | 'continue' | null;
    skip: boolean;
  }
  const emptyCell = (colspan = 1): ParsedCell => ({
    html: '', isBold: false, isCentered: false, colspan, rowspan: 1, vMerge: null, skip: false,
  });

  const openEnd = tblXml.indexOf('>') + 1;
  const closeIdx = tblXml.lastIndexOf('</w:tbl>');
  const inner = tblXml.slice(openEnd, closeIdx >= openEnd ? closeIdx : undefined);

  // Số cột chuẩn của bảng theo <w:tblGrid>
  const gridXml = /<w:tblGrid\b[\s\S]*?<\/w:tblGrid>/.exec(inner)?.[0] || '';
  const gridCols = (gridXml.match(/<w:gridCol\b/g) || []).length;

  const rows: ParsedCell[][] = [];
  const headerFlags: boolean[] = [];

  for (const { xml: trXml } of iterateBlocks(inner, ['w:tr'])) {
    const firstTc = trXml.search(/<w:tc(?=[\s>/])/);
    const trHead = firstTc >= 0 ? trXml.slice(0, firstTc) : trXml;
    const trPr = /<w:trPr\b[^>]*>([\s\S]*?)<\/w:trPr>/.exec(trHead)?.[1] || '';
    const isHeaderRow = /<w:tblHeader\b(?![^>]*w:val="(?:false|0|off)")/.test(trPr);
    const gridBefore = readIntVal(trPr, 'w:gridBefore');
    const gridAfter = readIntVal(trPr, 'w:gridAfter');

    const rowCells: ParsedCell[] = [];
    // Ô trống đầu dòng mà Word không ghi <w:tc> (gridBefore) → bù lại để không lệch cột
    if (gridBefore > 0) rowCells.push(emptyCell(gridBefore));

    for (const { xml: tcXml } of iterateBlocks(trXml, ['w:tc'])) {
      const contentStart = tcXml.search(/<w:(?:p|tbl)(?=[\s>/])/);
      const tcHead = contentStart >= 0 ? tcXml.slice(0, contentStart) : tcXml;
      const tcPr = /<w:tcPr\b[^>]*>([\s\S]*?)<\/w:tcPr>/.exec(tcHead)?.[1] || '';

      const colspan = Math.max(1, readIntVal(tcPr, 'w:gridSpan') || 1);
      let vMerge: ParsedCell['vMerge'] = null;
      const vMergeMatch = /<w:vMerge\b([^>]*)\/?>/.exec(tcPr);
      if (vMergeMatch) vMerge = /w:val="restart"/.test(vMergeMatch[1]) ? 'restart' : 'continue';
      const hMergeMatch = /<w:hMerge\b([^>]*)\/?>/.exec(tcPr);
      const hMergeContinue = !!hMergeMatch && !/w:val="restart"/.test(hMergeMatch[1]);

      const paraStrings: string[] = [];
      let allBold = true;
      let anyCentered = false;
      for (const block of iterateBlocks(tcXml, ['w:p', 'w:tbl'])) {
        if (block.tag === 'w:tbl') {
          const nested = convertWordTableXmlToHtml(block.xml); // bảng lồng trong ô
          if (nested) { paraStrings.push(nested); allBold = false; }
          continue;
        }
        const { html, isBold, isCentered } = extractParagraphHtml(block.xml);
        if (html) {
          paraStrings.push(html);
          if (!isBold) allBold = false;
          if (isCentered) anyCentered = true;
        }
      }

      // hMerge kiểu cũ: ô "continue" thuộc về ô bên trái
      if (hMergeContinue && rowCells.length > 0) {
        rowCells[rowCells.length - 1].colspan += colspan;
        continue;
      }

      rowCells.push({
        html: paraStrings.join('<br>'),
        isBold: paraStrings.length > 0 && allBold,
        isCentered: anyCentered,
        colspan,
        rowspan: 1,
        vMerge,
        skip: false,
      });
    }
    if (gridAfter > 0) rowCells.push(emptyCell(gridAfter));

    if (rowCells.length > 0) {
      rows.push(rowCells);
      headerFlags.push(isHeaderRow);
    }
  }

  if (rows.length === 0) return '';

  // Dòng tiêu đề sơ bộ: dòng cuối (trong 8 dòng đầu) có ≥ 2 ô chỉ ghi mức độ (Biết/Hiểu/VD…)
  const rowPlain = (row: ParsedCell[]) => row.map(c => plainOf(c.html));
  let levelRow = -1;
  let lastLabelRow = -1;
  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const texts = rowPlain(rows[r]);
    const nLevel = texts.filter(isLevelHeaderText).length;
    const nLabel = nLevel + texts.filter(isHeaderLabelText).length;
    if (nLabel >= 2) {
      lastLabelRow = r;
      if (nLevel >= 2) levelRow = r;
    } else if (levelRow >= 0) break; // đã qua khối tiêu đề → gặp dòng dữ liệu thì dừng
  }
  // Mẫu cũ: dòng "TNKQ | TL" nằm DƯỚI dòng mức độ → vẫn thuộc tiêu đề
  if (levelRow >= 0 && lastLabelRow > levelRow) levelRow = lastLabelRow;

  // Bỏ các dòng tiêu đề bị CHÉP LẶP LẠI giữa bảng (thường do copy từ PDF / ngắt trang thủ công).
  // (Tính năng "Repeat header rows" của Word KHÔNG nhân bản dòng trong XML nên không bị ảnh hưởng.)
  if (levelRow >= 0) {
    const sig = (row: ParsedCell[]) => rowPlain(row).join('|');
    const headerSigs = new Set(rows.slice(0, levelRow + 1).map(sig).filter(s => s.replace(/\|/g, '').length > 0));
    for (let r = rows.length - 1; r > levelRow; r--) {
      const texts = rowPlain(rows[r]);
      const nonEmpty = texts.filter(Boolean).length;
      if (nonEmpty >= 2 && (headerSigs.has(sig(rows[r])) || texts.filter(isLevelHeaderText).length >= 2)) {
        rows.splice(r, 1);
        headerFlags.splice(r, 1);
      }
    }
  }

  // Giải vMerge (gộp dọc) trên lưới cột thực (đã tính gridBefore & gridSpan)
  const activeOriginByCol = new Map<number, { r: number; cIdx: number }>();
  for (let r = 0; r < rows.length; r++) {
    let colCursor = 0;
    const incrementedOrigins = new Set<string>();
    for (let cIdx = 0; cIdx < rows[r].length; cIdx++) {
      const cell = rows[r][cIdx];
      if (cell.vMerge === 'restart') {
        for (let k = 0; k < cell.colspan; k++) activeOriginByCol.set(colCursor + k, { r, cIdx });
      } else if (cell.vMerge === 'continue') {
        const origin = activeOriginByCol.get(colCursor);
        if (origin) {
          cell.skip = true;
          const key = `${origin.r}_${origin.cIdx}`;
          if (!incrementedOrigins.has(key)) {
            rows[origin.r][origin.cIdx].rowspan += 1;
            incrementedOrigins.add(key);
          }
        } else {
          // Ô "continue" không có ô "restart" phía trên (Word cho phép) → coi như ô mở đầu mới
          cell.vMerge = 'restart';
          for (let k = 0; k < cell.colspan; k++) activeOriginByCol.set(colCursor + k, { r, cIdx });
        }
      } else {
        for (let k = 0; k < cell.colspan; k++) activeOriginByCol.delete(colCursor + k);
      }
      colCursor += cell.colspan;
    }
  }

  // Bù ô trống ở cuối dòng nếu Word lược bớt (giữ đúng số cột theo tblGrid)
  if (gridCols > 0) {
    for (const row of rows) {
      const width = row.reduce((s, c) => s + c.colspan, 0);
      if (width < gridCols) row.push(emptyCell(gridCols - width));
    }
  }

  // Số dòng tiêu đề (<thead>): ưu tiên dòng mức độ; sau đó cờ <w:tblHeader>; cuối cùng rowspan ô đầu
  let headerRowCount = 0;
  if (levelRow >= 0) headerRowCount = levelRow + 1;
  else {
    let flagged = 0;
    while (flagged < headerFlags.length && headerFlags[flagged]) flagged++;
    const firstRs = rows[0][0]?.rowspan || 1;
    headerRowCount = Math.max(flagged, plainOf(rows[0][0]?.html || '').length <= 30 ? firstRs : 1, 1);
    if (headerRowCount >= rows.length) headerRowCount = Math.max(1, rows.length - 1);
  }

  const renderRow = (row: ParsedCell[], isHeader: boolean): string => {
    const tag = isHeader ? 'th' : 'td';
    const cellsHtml = row
      .filter(c => !c.skip)
      .map(c => {
        const attrs: string[] = [];
        if (c.colspan > 1) attrs.push(`colspan="${c.colspan}"`);
        if (c.rowspan > 1) attrs.push(`rowspan="${c.rowspan}"`);
        const plainLen = c.html.replace(/<[^>]+>/g, '').length;
        if (!isHeader && plainLen > 25 && !c.isCentered) {
          attrs.push('class="left-align"');
        } else if (c.isBold && !isHeader) {
          attrs.push('class="bold"');
        }
        const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
        const inner = c.isBold && !isHeader && !c.html.startsWith('<b>') && !c.html.includes('<table') ? `<b>${c.html}</b>` : c.html;
        return `<${tag}${attrStr}>${inner}</${tag}>`;
      })
      .join('');
    return `<tr>${cellsHtml}</tr>`;
  };

  const theadRows = rows.slice(0, headerRowCount).map(r => renderRow(r, true)).join('\n');
  const tbodyRows = rows.slice(headerRowCount).map(r => renderRow(r, false)).join('\n');

  return `<table border="1" cellspacing="0" cellpadding="5">\n${
    theadRows ? `<thead>\n${theadRows}\n</thead>\n` : ''
  }<tbody>\n${tbodyRows}\n</tbody>\n</table>`;
};

const wrapMatrixHtmlDocument = (bodyHtml: string): string => `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Times New Roman", serif; font-size: 13pt; line-height: 1.35; margin: 20px; color: #000; }
  h2, h3 { text-align: center; font-weight: bold; text-transform: uppercase; margin: 10px 0 12px; font-size: 14pt; }
  p { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; }
  th, td { border: 1px solid black; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { font-weight: bold; background-color: #f8fafc; }
  .left-align, .text-left { text-align: left; padding-left: 8px; vertical-align: top; }
  .bold { font-weight: bold; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const bodyBounds = (fullHtml: string) => {
  const bodyStartMatch = /<body[^>]*>/i.exec(fullHtml);
  const bodyEndMatch = /<\/body>/i.exec(fullHtml);
  return {
    start: bodyStartMatch ? bodyStartMatch.index + bodyStartMatch[0].length : 0,
    end: bodyEndMatch ? bodyEndMatch.index : fullHtml.length,
  };
};

/**
 * Điểm bắt đầu "phần" của một bảng: nếu ngay trước bảng (sau bảng trước) có đoạn tiêu đề
 * khớp `headingRe` (VD "BẢN ĐẶC TẢ…", "ĐẶC TẢ ĐỀ KIỂM TRA…", "KHUNG ĐẶC TẢ…") thì tách từ tiêu đề đó,
 * để ghi chú của bảng trước vẫn đi cùng bảng trước.
 */
const sectionStart = (fullHtml: string, gapFrom: number, tableStart: number, headingRe: RegExp): number => {
  const gap = fullHtml.slice(gapFrom, tableStart);
  const blockRe = /<(h[1-6]|p)\b[^>]*>[\s\S]*?<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(gap))) {
    const text = plainOf(m[0]);
    if (text.length > 0 && text.length <= 220 && headingRe.test(text)) return gapFrom + m.index;
  }
  return tableStart;
};

export type DocxTableKind = TableKind;

/**
 * Tách riêng phần Ma trận và phần Bản đặc tả khi 1 file chứa cả 2 bảng.
 * Nhận diện theo NỘI DUNG BẢNG (cột "Yêu cầu cần đạt"/"Mức độ kiểm tra, đánh giá", dòng "Nhận biết: …")
 * chứ không chỉ dựa vào tiêu đề "BẢN ĐẶC TẢ".
 */
export const splitMatrixAndSpecsHtml = (
  fullHtml: string
): { matrixHtml: string; specsHtml: string | null; kinds: DocxTableKind[] } => {
  const tables = analyzeTables(fullHtml);
  const kinds = tables.map(t => t.kind);
  if (tables.length < 2) return { matrixHtml: fullHtml, specsHtml: null, kinds };

  const { start: bodyStart, end: bodyEnd } = bodyBounds(fullHtml);
  const mIdx = tables.findIndex(t => t.kind === 'matrix');
  let sIdx = tables.findIndex((t, i) => t.kind === 'specs' && i !== mIdx);

  // Dự phòng: không nhận ra bảng đặc tả qua cột → dùng tiêu đề "ĐẶC TẢ" đứng giữa 2 bảng
  if (sIdx < 0) {
    for (let i = 1; i < tables.length; i++) {
      const s = sectionStart(fullHtml, tables[i - 1].end, tables[i].start, /đặc\s*tả/i);
      if (s !== tables[i].start) { sIdx = i; break; }
    }
  }
  if (sIdx < 0) return { matrixHtml: fullHtml, specsHtml: null, kinds };

  let matrixPart: string;
  let specsPart: string;
  if (mIdx < 0 || mIdx < sIdx) {
    const gapFrom = sIdx > 0 ? tables[sIdx - 1].end : bodyStart;
    const split = sectionStart(fullHtml, gapFrom, tables[sIdx].start, /đặc\s*tả/i);
    matrixPart = fullHtml.slice(bodyStart, split).trim();
    specsPart = fullHtml.slice(split, bodyEnd).trim();
  } else {
    // Đặc tả đứng trước ma trận
    const gapFrom = mIdx > 0 ? tables[mIdx - 1].end : bodyStart;
    const split = sectionStart(fullHtml, gapFrom, tables[mIdx].start, /ma\s*trận/i);
    specsPart = fullHtml.slice(bodyStart, split).trim();
    matrixPart = fullHtml.slice(split, bodyEnd).trim();
  }

  if (/<table/i.test(matrixPart) && /<table/i.test(specsPart)) {
    return { matrixHtml: wrapMatrixHtmlDocument(matrixPart), specsHtml: wrapMatrixHtmlDocument(specsPart), kinds };
  }
  return { matrixHtml: fullHtml, specsHtml: null, kinds };
};

export interface DocxTableExtraction {
  fullHtml: string;
  matrixHtml: string;
  specsHtml: string | null;
  /** Có ít nhất 1 bảng bất kỳ */
  hasTable: boolean;
  /** Có bảng mang cấu trúc ma trận/đặc tả (cột mức độ × dạng câu hỏi) */
  hasMatrixTable: boolean;
  tableKinds: DocxTableKind[];
}

const finishExtraction = (fullHtml: string): DocxTableExtraction => {
  const { matrixHtml, specsHtml, kinds } = splitMatrixAndSpecsHtml(fullHtml);
  return {
    fullHtml,
    matrixHtml,
    specsHtml,
    hasTable: kinds.length > 0,
    hasMatrixTable: kinds.some(k => k === 'matrix' || k === 'specs'),
    tableKinds: kinds,
  };
};

/** Thân tài liệu Word (XML) → các khối HTML (đoạn văn, tiêu đề, bảng) theo đúng thứ tự. */
const bodyXmlToHtmlBlocks = (bodyXml: string): { htmlBlocks: string[]; tableCount: number } => {
  const htmlBlocks: string[] = [];
  let tableCount = 0;
  for (const block of iterateBlocks(bodyXml, ['w:tbl', 'w:p'])) {
    if (block.tag === 'w:tbl') {
      const tblHtml = convertWordTableXmlToHtml(block.xml);
      if (tblHtml) {
        htmlBlocks.push(tblHtml);
        tableCount++;
      }
    } else {
      const { html, isBold, isCentered } = extractParagraphHtml(block.xml);
      if (html) {
        if (
          isCentered ||
          /^(?:[IVX\d]+\.\s*)?(?:MA\s*TRẬN|BẢNG\s*ĐẶC\s*TẢ|BẢN\s*ĐẶC\s*TẢ|ĐẶC\s*TẢ|KHUNG\s*MA\s*TRẬN|KHUNG\s*ĐẶC\s*TẢ)/i.test(plainOf(html))
        ) {
          htmlBlocks.push(`<h2>${html}</h2>`);
        } else if (isBold) {
          htmlBlocks.push(`<p class="bold">${html}</p>`);
        } else {
          htmlBlocks.push(`<p>${html}</p>`);
        }
      }
    }
  }
  return { htmlBlocks, tableCount };
};

export interface DocxExamSource {
  /** Nội dung đề dạng HTML (giữ bảng, công thức LaTeX $...$, vị trí hình [HÌNH k]) */
  html: string;
  /** Ảnh đọc được, theo đúng số thứ tự [HÌNH k] */
  images: Array<{ index: number; base64: string; mimeType: string }>;
  /** Số công thức Word chuẩn (Equation – OMML), đã chuyển sang LaTeX */
  ommlCount: number;
  /** Số công thức MathType (đối tượng OLE, chỉ có ảnh WMF) — AI KHÔNG đọc được */
  mathTypeCount: number;
  /** Ảnh WMF/EMF hoặc vượt giới hạn — không gửi được cho AI */
  skippedImages: number;
}

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const MAX_SOURCE_IMAGES = 16;

/**
 * Đọc ĐỀ THI từ file Word (.docx) để gửi cho AI (tạo đề tương tự / sinh đề biến thể):
 * giữ nguyên bảng, chuyển công thức Equation (OMML) sang LaTeX, đánh dấu vị trí hình [HÌNH k] và lấy ảnh kèm theo.
 */
export const docxToExamSource = async (arrayBuffer: ArrayBuffer): Promise<DocxExamSource> => {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('File Word không có nội dung (thiếu word/document.xml).');
  let xml = (await docXmlFile.async('string')).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');

  // Quan hệ rId → đường dẫn ảnh trong gói docx
  const relsXml = (await zip.file('word/_rels/document.xml.rels')?.async('string')) || '';
  const rels = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target);
  }

  const ommlCount = (xml.match(/<m:oMath(?=[\s>])/g) || []).length;
  let mathTypeCount = 0;
  // Đối tượng nhúng: công thức MathType / Equation 3.0 → đánh dấu; đối tượng khác → coi như hình
  xml = xml.replace(/<w:object\b[\s\S]*?<\/w:object>/g, obj => {
    if (/ProgID="(?:Equation\.|MathType)/i.test(obj)) {
      mathTypeCount++;
      return '<w:t>[CÔNG THỨC MathType – không đọc được]</w:t>';
    }
    const id = /<v:imagedata\b[^>]*r:id="([^"]+)"/.exec(obj)?.[1];
    return id ? `<w:t>⟦IMG:${id}⟧</w:t>` : '';
  });
  xml = xml.replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/g, d => {
    const id = /<a:blip\b[^>]*r:embed="([^"]+)"/.exec(d)?.[1];
    return id ? `<w:t>⟦IMG:${id}⟧</w:t>` : '';
  });
  xml = xml.replace(/<w:pict\b[\s\S]*?<\/w:pict>/g, pict => {
    const id = /<v:imagedata\b[^>]*r:id="([^"]+)"/.exec(pict)?.[1];
    return id ? `<w:t>⟦IMG:${id}⟧</w:t>` : '';
  });

  const bodyStart = xml.search(/<w:body\b/);
  const bodyEnd = xml.lastIndexOf('</w:body>');
  const bodyXml = bodyStart >= 0 ? xml.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined) : xml;
  let html = bodyXmlToHtmlBlocks(bodyXml).htmlBlocks.join('\n');

  // Thay dấu hình bằng [HÌNH k] và gom ảnh theo thứ tự xuất hiện
  const images: DocxExamSource['images'] = [];
  const indexOfRel = new Map<string, number>();
  let skippedImages = 0;
  let counter = 0;
  const markers = Array.from(html.matchAll(/⟦IMG:([^⟧]+)⟧/g)).map(m => m[1]);
  for (const relId of markers) {
    if (indexOfRel.has(relId)) continue;
    const k = ++counter;
    indexOfRel.set(relId, k);
    const target = rels.get(relId) || '';
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    const ext = (path.split('.').pop() || '').toLowerCase();
    const file = zip.file(path);
    if (file && IMAGE_MIME[ext] && images.length < MAX_SOURCE_IMAGES) {
      images.push({ index: k, base64: await file.async('base64'), mimeType: IMAGE_MIME[ext] });
    } else {
      skippedImages++;
    }
  }
  const sent = new Set(images.map(i => i.index));
  html = html.replace(/⟦IMG:([^⟧]+)⟧/g, (_m, relId: string) => {
    const k = indexOfRel.get(relId)!;
    return sent.has(k) ? ` [HÌNH ${k}] ` : ` [HÌNH ${k} – không gửi được (định dạng WMF/EMF hoặc quá nhiều hình)] `;
  });

  return { html, images, ommlCount, mathTypeCount, skippedImages };
};

/**
 * Chuyển đổi trực tiếp file Word (.docx) Ma trận / Đặc tả sang HTML Table chính xác
 * (giữ nguyên hàng, cột, rowspan, colspan, ô trống, bảng lồng và công thức toán), KHÔNG qua AI.
 */
export const extractDocxTablesAndHtml = async (arrayBuffer: ArrayBuffer): Promise<DocxTableExtraction> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');

    if (docXmlFile) {
      // mc:Fallback chứa bản sao nội dung textbox/hình → bỏ để không nhân đôi chữ
      const xmlContent = (await docXmlFile.async('string')).replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
      const bodyStart = xmlContent.search(/<w:body\b/);
      const bodyEnd = xmlContent.lastIndexOf('</w:body>');
      const bodyXml = bodyStart >= 0 ? xmlContent.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined) : xmlContent;

      const { htmlBlocks, tableCount } = bodyXmlToHtmlBlocks(bodyXml);

      if (tableCount > 0) {
        return finishExtraction(wrapMatrixHtmlDocument(htmlBlocks.join('\n')));
      }
    }

    // altChunk MHTML (.docx xuất bởi html-docx-js, ví dụ file do chính app này tải về)
    const mhtFile = zip.file('word/afchunk.mht') || zip.file(/afchunk.*\.mht$/i)[0];
    if (mhtFile) {
      const mhtRaw = await mhtFile.async('string');
      const strippedSoft = mhtRaw.replace(/=\r?\n/g, '');
      const bytes: number[] = [];
      let i = 0;
      while (i < strippedSoft.length) {
        if (
          strippedSoft[i] === '=' &&
          i + 2 < strippedSoft.length &&
          /^[0-9A-Fa-f]{2}$/.test(strippedSoft.slice(i + 1, i + 3))
        ) {
          bytes.push(parseInt(strippedSoft.slice(i + 1, i + 3), 16));
          i += 3;
        } else {
          const code = strippedSoft.charCodeAt(i);
          if (code < 128) bytes.push(code);
          else {
            const enc = new TextEncoder().encode(strippedSoft[i]);
            for (const b of enc) bytes.push(b);
          }
          i++;
        }
      }
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      const htmlStart = decoded.search(/<!DOCTYPE|<html|<table/i);
      if (htmlStart !== -1 && /<table/i.test(decoded)) {
        return finishExtraction(decoded.slice(htmlStart).trim());
      }
    }
  } catch (err) {
    console.warn('[DocxMathParser] Direct XML table extraction failed, checking HTML/Mammoth fallback:', err);
  }

  // File HTML được lưu với đuôi .doc/.docx
  const rawUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(arrayBuffer));
  if (/<table[\s\S]*?<\/table>/i.test(rawUtf8)) {
    const htmlStart = rawUtf8.search(/<!DOCTYPE|<html|<table/i);
    return finishExtraction(htmlStart !== -1 ? rawUtf8.slice(htmlStart).trim() : rawUtf8);
  }

  return { fullHtml: '', matrixHtml: '', specsHtml: null, hasTable: false, hasMatrixTable: false, tableKinds: [] };
};

/** Nhận diện file .doc nhị phân đời cũ (OLE2) — không đọc được bảng trực tiếp. */
export const isLegacyBinaryDoc = (arrayBuffer: ArrayBuffer): boolean => {
  const b = new Uint8Array(arrayBuffer.slice(0, 8));
  return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
};

// ============================================================================
// MATRIX METADATA & QUESTION CONFIG (giữ API cũ — nay dùng bộ đọc hợp đồng số liệu)
// ============================================================================

export interface ParsedMatrixMetadata {
  subject?: string;
  grade?: string;
  examType?: string;
  duration?: number;
  questionConfig?: QuestionConfig;
  topicsSummary?: string;
}

/**
 * Phân tích bảng Ma trận (hoặc Đặc tả) HTML: Môn, Lớp, Kỳ, Thời gian và số câu từng dạng × mức độ.
 * Chỉ trả về questionConfig khi đọc được số liệu đáng tin cậy (không còn đoán / bịa tự luận).
 */
export const parseMatrixMetadataAndConfig = (htmlOrText: string): ParsedMatrixMetadata => {
  const result: ParsedMatrixMetadata = {};
  if (!htmlOrText || !htmlOrText.trim()) return result;
  const contract = parseMatrixContract(htmlOrText);
  Object.assign(result, contract.meta);
  if (contract.ok && contract.questionConfig && contract.confidence !== 'low') {
    result.questionConfig = contract.questionConfig;
  }
  if (contract.topicsSummary) result.topicsSummary = contract.topicsSummary;
  return result;
};
