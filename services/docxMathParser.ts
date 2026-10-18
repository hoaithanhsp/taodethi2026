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
  const textMatches = xml.matchAll(/<(?:m|w):t[^>]*>([^<]*)<\/(?:m|w):t>/g);
  for (const match of textMatches) {
    result += decodeXmlEntities(match[1]);
  }
  if (result) return result;
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, '').trim());
};

const ommlToLatex = (ommlXml: string): string => {
  let latex = ommlXml;

  // Apply recursively up to 4 levels for nested fractions/superscripts/radicals
  for (let pass = 0; pass < 4; pass++) {
    const prev = latex;

    // Sub-superscript: <m:sSubSup>
    latex = latex.replace(/<m:sSubSup[^>]*>([\s\S]*?)<\/m:sSubSup>/g, (_match, inner) => {
      const baseMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
      const subMatch = inner.match(/<m:sub[^>]*>([\s\S]*?)<\/m:sub>/);
      const supMatch = inner.match(/<m:sup[^>]*>([\s\S]*?)<\/m:sup>/);
      const base = baseMatch ? ommlToLatex(baseMatch[1]) : '?';
      const sub = subMatch ? ommlToLatex(subMatch[1]) : '';
      const sup = supMatch ? ommlToLatex(supMatch[1]) : '';
      return `${base}_{${sub}}^{${sup}}`;
    });

    // Superscripts: <m:sSup>
    latex = latex.replace(/<m:sSup[^>]*>([\s\S]*?)<\/m:sSup>/g, (_match, inner) => {
      const baseMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
      const supMatch = inner.match(/<m:sup[^>]*>([\s\S]*?)<\/m:sup>/);
      const base = baseMatch ? ommlToLatex(baseMatch[1]) : '?';
      const sup = supMatch ? ommlToLatex(supMatch[1]) : '?';
      return `${base}^{${sup}}`;
    });

    // Subscripts: <m:sSub>
    latex = latex.replace(/<m:sSub[^>]*>([\s\S]*?)<\/m:sSub>/g, (_match, inner) => {
      const baseMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
      const subMatch = inner.match(/<m:sub[^>]*>([\s\S]*?)<\/m:sub>/);
      const base = baseMatch ? ommlToLatex(baseMatch[1]) : '?';
      const sub = subMatch ? ommlToLatex(subMatch[1]) : '?';
      return `${base}_{${sub}}`;
    });

    // Fractions: <m:f>
    latex = latex.replace(/<m:f[^>]*>([\s\S]*?)<\/m:f>/g, (_match, inner) => {
      const numMatch = inner.match(/<m:num[^>]*>([\s\S]*?)<\/m:num>/);
      const denMatch = inner.match(/<m:den[^>]*>([\s\S]*?)<\/m:den>/);
      const num = numMatch ? ommlToLatex(numMatch[1]) : '?';
      const den = denMatch ? ommlToLatex(denMatch[1]) : '?';
      return `\\frac{${num}}{${den}}`;
    });

    // Radicals: <m:rad>
    latex = latex.replace(/<m:rad[^>]*>([\s\S]*?)<\/m:rad>/g, (_match, inner) => {
      const degMatch = inner.match(/<m:deg[^>]*>([\s\S]*?)<\/m:deg>/);
      const eMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
      const deg = degMatch ? ommlToLatex(degMatch[1]).trim() : '';
      const e = eMatch ? ommlToLatex(eMatch[1]) : '?';
      return deg ? `\\sqrt[${deg}]{${e}}` : `\\sqrt{${e}}`;
    });

    // N-ary operators (integral, sum, product): <m:nary>
    latex = latex.replace(/<m:nary[^>]*>([\s\S]*?)<\/m:nary>/g, (_match, inner) => {
      const chrMatch = inner.match(/<m:chr[^>]*m:val="([^"]+)"/);
      const subMatch = inner.match(/<m:sub[^>]*>([\s\S]*?)<\/m:sub>/);
      const supMatch = inner.match(/<m:sup[^>]*>([\s\S]*?)<\/m:sup>/);
      const eMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
      const chr = chrMatch ? chrMatch[1] : '∫';
      const op = chr === '∑' ? '\\sum' : chr === '∏' ? '\\prod' : '\\int';
      const sub = subMatch ? ommlToLatex(subMatch[1]).trim() : '';
      const sup = supMatch ? ommlToLatex(supMatch[1]).trim() : '';
      const e = eMatch ? ommlToLatex(eMatch[1]) : '';
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${e}`;
    });

    // Delimiters (parentheses, brackets, braces): <m:d>
    latex = latex.replace(/<m:d(?:\s[^>]*)?>([\s\S]*?)<\/m:d>/g, (_match, inner) => {
      const begMatch = inner.match(/<m:begChr[^>]*m:val="([^"]*)"/);
      const endMatch = inner.match(/<m:endChr[^>]*m:val="([^"]*)"/);
      const beg = begMatch ? begMatch[1] : '(';
      const end = endMatch ? endMatch[1] : ')';
      const elements: string[] = [];
      for (const em of inner.matchAll(/<m:e[^>]*>([\s\S]*?)<\/m:e>/g)) {
        elements.push(ommlToLatex(em[1]));
      }
      return `${beg}${elements.join(', ')}${end}`;
    });

    if (latex === prev) break;
  }

  return extractMathText(latex);
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

  const trMatches = Array.from(tblXml.matchAll(/<w:tr(?=[ >])[^>]*>([\s\S]*?)<\/w:tr>/g));
  if (trMatches.length === 0) return '';

  const rows: ParsedCell[][] = [];

  for (const trMatch of trMatches) {
    const trXml = trMatch[1];
    const tcMatches = Array.from(trXml.matchAll(/<w:tc(?=[ >])[^>]*>([\s\S]*?)<\/w:tc>/g));
    const rowCells: ParsedCell[] = [];

    for (const tcMatch of tcMatches) {
      const tcXml = tcMatch[1];
      const tcPrMatch = tcXml.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/);
      const tcPr = tcPrMatch ? tcPrMatch[1] : '';

      const gridSpanMatch = tcPr.match(/<w:gridSpan[^>]*w:val="(\d+)"/i);
      const colspan = gridSpanMatch ? Math.max(1, parseInt(gridSpanMatch[1], 10)) : 1;

      let vMerge: 'restart' | 'continue' | null = null;
      const vMergeMatch = tcPr.match(/<w:vMerge(?:\s+[^>]*w:val="([^"]*)")?\s*\/?>/i);
      if (vMergeMatch) {
        vMerge = vMergeMatch[1] === 'restart' ? 'restart' : 'continue';
      }

      const paras = Array.from(tcXml.matchAll(/<w:p(?=[ >])[^>]*>([\s\S]*?)<\/w:p>/g));
      const paraStrings: string[] = [];
      let allBold = paras.length > 0;
      let anyCentered = false;

      for (const p of paras) {
        const { html, isBold, isCentered } = extractParagraphHtml(p[0]);
        if (html) {
          paraStrings.push(html);
          if (!isBold) allBold = false;
          if (isCentered) anyCentered = true;
        }
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

    if (rowCells.length > 0) {
      rows.push(rowCells);
    }
  }

  if (rows.length === 0) return '';

  // Resolve vertical merges (vMerge) across the 2D column grid
  const activeOriginByCol = new Map<number, { r: number; cIdx: number }>();

  for (let r = 0; r < rows.length; r++) {
    let colCursor = 0;
    const incrementedOrigins = new Set<string>();

    for (let cIdx = 0; cIdx < rows[r].length; cIdx++) {
      const cell = rows[r][cIdx];
      if (cell.vMerge === 'restart') {
        for (let k = 0; k < cell.colspan; k++) {
          activeOriginByCol.set(colCursor + k, { r, cIdx });
        }
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
          // Orphan vMerge continuation without restart above → treat as normal cell
          cell.vMerge = null;
        }
      } else {
        for (let k = 0; k < cell.colspan; k++) {
          activeOriginByCol.delete(colCursor + k);
        }
      }
      colCursor += cell.colspan;
    }
  }

  // Determine how many top rows belong to <thead>
  let headerRowCount = 0;
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const rowText = rows[r].map(c => c.html).join(' ').toLowerCase();
    if (
      r === 0 ||
      /\b(tt|stt|chương|chủ đề|nội dung|đơn vị kiến thức|mức độ|tnkq|nhiều lựa chọn|đúng|trả lời ngắn|tự luận|biết|hiểu|vận dụng|yêu cầu cần đạt|số câu)\b/i.test(
        rowText
      )
    ) {
      // Stop if first non-skipped cell is just row number "1"
      const firstCellText = rows[r][0]?.html?.replace(/<[^>]+>/g, '').trim() || '';
      if (r > 0 && /^1\.?$/.test(firstCellText)) break;
      headerRowCount = r + 1;
    } else {
      break;
    }
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
        const inner = c.isBold && !isHeader && !c.html.startsWith('<b>') ? `<b>${c.html}</b>` : c.html;
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

/**
 * Tách riêng phần Ma trận và phần Bản đặc tả nếu người dùng tải lên 1 file gộp cả 2 bảng.
 */
export const splitMatrixAndSpecsHtml = (
  fullHtml: string
): { matrixHtml: string; specsHtml: string | null } => {
  // Check if there are at least 2 tables and a "ĐẶC TẢ" heading between them
  const tables = Array.from(fullHtml.matchAll(/<table[\s\S]*?<\/table>/gi));
  if (tables.length < 2) {
    return { matrixHtml: fullHtml, specsHtml: null };
  }

  const firstTableEnd = (tables[0].index || 0) + tables[0][0].length;
  const secondTableStart = tables[1].index || 0;
  const betweenText = fullHtml.slice(firstTableEnd, secondTableStart);

  // Also check if second table itself has "Yêu cầu cần đạt"
  const secondTableHasSpecs = /yêu\s*cầu\s*cần\s*đạt/i.test(tables[1][0]);
  const headingMatch = betweenText.match(/<(?:h[1-4]|p)[^>]*>[^<]*(?:BẢNG|BẢN)\s*ĐẶC\s*TẢ[\s\S]*$/i);

  if (headingMatch || secondTableHasSpecs) {
    const splitIndex =
      headingMatch && headingMatch.index !== undefined
        ? firstTableEnd + headingMatch.index
        : secondTableStart;

    const bodyStartMatch = fullHtml.match(/<body[^>]*>/i);
    const bodyEndMatch = fullHtml.match(/<\/body>/i);
    const bodyStart = bodyStartMatch && bodyStartMatch.index !== undefined ? bodyStartMatch.index + bodyStartMatch[0].length : 0;
    const bodyEnd = bodyEndMatch && bodyEndMatch.index !== undefined ? bodyEndMatch.index : fullHtml.length;

    const matrixPart = fullHtml.slice(bodyStart, splitIndex).trim();
    const specsPart = fullHtml.slice(splitIndex, bodyEnd).trim();

    if (matrixPart.includes('<table') && specsPart.includes('<table')) {
      return {
        matrixHtml: wrapMatrixHtmlDocument(matrixPart),
        specsHtml: wrapMatrixHtmlDocument(specsPart),
      };
    }
  }

  return { matrixHtml: fullHtml, specsHtml: null };
};

/**
 * Chuyển đổi trực tiếp file Word (.docx / .doc) Ma trận hoặc Đặc tả sang HTML Table chuẩn xác 100%
 * (giữ nguyên toàn bộ hàng, cột, rowspan, colspan, ô trống và công thức toán), KHÔNG qua AI làm lệch bảng.
 */
export const extractDocxTablesAndHtml = async (
  arrayBuffer: ArrayBuffer
): Promise<{
  fullHtml: string;
  matrixHtml: string;
  specsHtml: string | null;
  hasTable: boolean;
}> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file('word/document.xml');

    if (docXmlFile) {
      const xmlContent = await docXmlFile.async('string');
      const bodyMatch = xmlContent.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
      const bodyXml = bodyMatch ? bodyMatch[1] : xmlContent;

      // Match top-level <w:tbl> and <w:p> in document order
      const blockRegex = /<w:tbl(?=[ >])[^>]*>[\s\S]*?<\/w:tbl>|<w:p(?=[ >])[^>]*>[\s\S]*?<\/w:p>/g;
      const htmlBlocks: string[] = [];
      let tableCount = 0;

      for (const m of bodyXml.matchAll(blockRegex)) {
        const block = m[0];
        if (block.startsWith('<w:tbl')) {
          const tblHtml = convertWordTableXmlToHtml(block);
          if (tblHtml) {
            htmlBlocks.push(tblHtml);
            tableCount++;
          }
        } else {
          const { html, isBold, isCentered } = extractParagraphHtml(block);
          if (html) {
            if (
              isCentered ||
              /^(?:\d+\.\s*)?(?:MA\s*TRẬN|BẢNG\s*ĐẶC\s*TẢ|BẢN\s*ĐẶC\s*TẢ|KHUNG\s*MA\s*TRẬN)/i.test(html)
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

      if (tableCount > 0) {
        const fullHtml = wrapMatrixHtmlDocument(htmlBlocks.join('\n'));
        const { matrixHtml, specsHtml } = splitMatrixAndSpecsHtml(fullHtml);
        return { fullHtml, matrixHtml, specsHtml, hasTable: true };
      }
    }

    // Fallback for altChunk MHTML (.docx exported by html-docx-js)
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
        const rawHtml = decoded.slice(htmlStart).trim();
        const { matrixHtml, specsHtml } = splitMatrixAndSpecsHtml(rawHtml);
        return { fullHtml: rawHtml, matrixHtml, specsHtml, hasTable: true };
      }
    }
  } catch (err) {
    console.warn('[DocxMathParser] Direct XML table extraction failed, checking HTML/Mammoth fallback:', err);
  }

  // Check if file is HTML saved with .doc/.docx extension
  const rawUtf8 = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(arrayBuffer));
  if (/<table[\s\S]*?<\/table>/i.test(rawUtf8)) {
    const htmlStart = rawUtf8.search(/<!DOCTYPE|<html|<table/i);
    const cleanHtml = htmlStart !== -1 ? rawUtf8.slice(htmlStart).trim() : rawUtf8;
    const { matrixHtml, specsHtml } = splitMatrixAndSpecsHtml(cleanHtml);
    return { fullHtml: cleanHtml, matrixHtml, specsHtml, hasTable: true };
  }

  return { fullHtml: '', matrixHtml: '', specsHtml: null, hasTable: false };
};

// ============================================================================
// MATRIX METADATA & QUESTION CONFIG ANALYZER (Syncs uploaded Matrix → App State)
// ============================================================================

export interface ParsedMatrixMetadata {
  subject?: string;
  grade?: string;
  examType?: string;
  duration?: number;
  questionConfig?: QuestionConfig;
  topicsSummary?: string;
}

const KNOWN_SUBJECTS: { pattern: RegExp; name: string }[] = [
  { pattern: /\b(?:MÔN|ĐỀ\s*KIỂM\s*TRA\s*MÔN)?\s*[:\-]?\s*TOÁN(?:\s*HỌC)?\b/i, name: 'Toán học' },
  { pattern: /\bNGỮ\s*VĂN\b/i, name: 'Ngữ văn' },
  { pattern: /\bTIẾNG\s*ANH\b/i, name: 'Tiếng Anh' },
  { pattern: /\bVẬT\s*L[ÍÝ]\b/i, name: 'Vật lí' },
  { pattern: /\bH[ÓO]A\s*HỌC\b/i, name: 'Hóa học' },
  { pattern: /\bSINH\s*HỌC\b/i, name: 'Sinh học' },
  { pattern: /\bLỊCH\s*SỬ\s*VÀ\s*ĐỊA\s*L[ÍÝ]\b/i, name: 'Lịch sử và Địa lí' },
  { pattern: /\bKHOA\s*HỌC\s*TỰ\s*NHIÊN|\bKHTN\b/i, name: 'Khoa học tự nhiên' },
  { pattern: /\bLỊCH\s*SỬ\b/i, name: 'Lịch sử' },
  { pattern: /\bĐỊA\s*L[ÍÝ]\b/i, name: 'Địa lí' },
  { pattern: /\bTIN\s*HỌC\b/i, name: 'Tin học' },
  { pattern: /\bCÔNG\s*NGHỆ\b/i, name: 'Công nghệ' },
  { pattern: /\b(?:GIÁO\s*DỤC\s*CÔNG\s*DÂN|GDCD|GIÁO\s*DỤC\s*KINH\s*TẾ\s*VÀ\s*PHÁP\s*LUẬT|GDKT\s*&\s*PL)\b/i, name: 'Giáo dục công dân' },
];

/**
 * Phân tích bảng Ma trận (hoặc Đặc tả) HTML người dùng tải lên để đồng bộ tự động:
 * - Môn học (subject), Khối lớp (grade), Kỳ kiểm tra (examType), Thời gian (duration)
 * - Số lượng câu hỏi từng phần (Dạng I, Dạng II, Dạng III, Tự luận) theo đúng mức độ Biết / Hiểu / Vận dụng
 */
export const parseMatrixMetadataAndConfig = (htmlOrText: string): ParsedMatrixMetadata => {
  const result: ParsedMatrixMetadata = {};
  if (!htmlOrText || !htmlOrText.trim()) return result;

  const plainText = htmlOrText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const headerArea = plainText.slice(0, 1500);

  // 1. Detect Subject (from header first, then fallback to content keywords)
  for (const s of KNOWN_SUBJECTS) {
    if (s.pattern.test(headerArea)) {
      result.subject = s.name;
      break;
    }
  }
  if (!result.subject) {
    if (/\b(hàm\s*số|đạo\s*hàm|nguyên\s*hàm|tích\s*phân|phương\s*trình|vectơ|toạ\s*độ|cấp\s*số|lượng\s*giác|đa\s*thức|tam\s*giác|xác\s*suất)\b/i.test(plainText)) {
      result.subject = 'Toán học';
    } else if (/\b(điện\s*trường|từ\s*trường|dao\s*động|sóng\s*cơ|quang\s*học|nhiệt\s*học|động\s*lực\s*học|con\s*lắc)\b/i.test(plainText)) {
      result.subject = 'Vật lí';
    } else if (/\b(nguyên\s*tử|bảng\s*tuần\s*hoàn|liên\s*kết\s*hóa\s*học|oxi\s*hóa|este|cacbohidrat|polime|hidrocacbon|kim\s*loại)\b/i.test(plainText)) {
      result.subject = 'Hóa học';
    } else if (/\b(tế\s*bào|di\s*truyền|nhiễm\s*sắc\s*thể|sinh\s*thái|tiến\s*hóa|quang\s*hợp|hô\s*hấp)\b/i.test(plainText)) {
      result.subject = 'Sinh học';
    } else if (/\b(thuật\s*toán|lập\s*trình|cơ\s*sở\s*dữ\s*liệu|mạng\s*máy\s*tính|python)\b/i.test(plainText)) {
      result.subject = 'Tin học';
    }
  }

  // 2. Detect Grade (Khối / Lớp 1..12)
  const gradeMatch =
    headerArea.match(/\b(?:LỚP|KHỐI(?:\s*LỚP)?)\s*[:\-]?\s*(1[0-2]|[1-9])\b/i) ||
    headerArea.match(/\b(?:TOÁN|VẬT\s*LÍ|HÓA\s*HỌC|SINH\s*HỌC|TIN\s*HỌC|CÔNG\s*NGHỆ|LỊCH\s*SỬ|ĐỊA\s*LÍ|NGỮ\s*VĂN|TIẾNG\s*ANH|KHTN)\s+(1[0-2]|[6-9])\b/i);
  if (gradeMatch) {
    result.grade = gradeMatch[1];
  }

  // 3. Detect Exam Type
  if (/GIỮA\s*(?:HỌC\s*)?K[ÌỲ]\s*(?:II|2)\b/i.test(headerArea)) {
    result.examType = 'Giữa kỳ 2';
  } else if (/CUỐI\s*(?:HỌC\s*)?K[ÌỲ]\s*(?:II|2)\b/i.test(headerArea)) {
    result.examType = 'Cuối kỳ 2';
  } else if (/GIỮA\s*(?:HỌC\s*)?K[ÌỲ]\s*(?:I|1)\b/i.test(headerArea)) {
    result.examType = 'Giữa kỳ 1';
  } else if (/CUỐI\s*(?:HỌC\s*)?K[ÌỲ]\s*(?:I|1)\b/i.test(headerArea)) {
    result.examType = 'Cuối kỳ 1';
  }

  // 4. Detect Duration
  const durMatch = headerArea.match(/(\d{2,3})\s*phút/i);
  if (durMatch) {
    const dur = parseInt(durMatch[1], 10);
    if (dur >= 15 && dur <= 180) {
      result.duration = dur;
    }
  }

  // 5. Parse QuestionConfig & Topics from HTML Table Grid
  try {
    if (typeof DOMParser !== 'undefined' && /<table/i.test(htmlOrText)) {
      const doc = new DOMParser().parseFromString(htmlOrText, 'text/html');
      const table = doc.querySelector('table');
      if (table && table.rows.length >= 2) {
        // Build 2D grid expanding rowSpan & colSpan
        interface GridCell {
          text: string;
          rOrigin: number;
          cOrigin: number;
        }
        const grid: GridCell[][] = [];
        const trList = Array.from(table.rows);

        for (let r = 0; r < trList.length; r++) {
          if (!grid[r]) grid[r] = [];
          let cCursor = 0;
          const cells = Array.from(trList[r].cells);

          for (const cell of cells) {
            while (grid[r][cCursor] !== undefined) {
              cCursor++;
            }
            const rs = Math.max(1, cell.rowSpan || 1);
            const cs = Math.max(1, cell.colSpan || 1);
            const cellText = (cell.textContent || '').replace(/\s+/g, ' ').trim();

            for (let dr = 0; dr < rs; dr++) {
              for (let dc = 0; dc < cs; dc++) {
                const rr = r + dr;
                const cc = cCursor + dc;
                if (!grid[rr]) grid[rr] = [];
                grid[rr][cc] = { text: cellText, rOrigin: r, cOrigin: cCursor };
              }
            }
            cCursor += cs;
          }
        }

        const numRows = grid.length;
        const numCols = Math.max(...grid.map(row => row.length));

        // Identify header row count (rows before first data row)
        let headerRows = 1;
        for (let r = 0; r < Math.min(5, numRows); r++) {
          const rowJoined = grid[r].map(c => c?.text || '').join(' ');
          const firstCol = grid[r][0]?.text || '';
          if (r > 0 && /^1\.?$/.test(firstCol)) break;
          if (
            /\b(tt|stt|chương|chủ đề|nội dung|đơn vị|mức độ|tnkq|nhiều lựa chọn|đúng|trả lời ngắn|tự luận|biết|hiểu|vận dụng|nb|th|vd|vdc)\b/i.test(
              rowJoined
            )
          ) {
            headerRows = r + 1;
          }
        }

        type QTypeKey = 'type1' | 'type2' | 'type3' | 'essay';
        type LevelKey = 'biet' | 'hieu' | 'van_dung' | 'van_dung_cao';
        const colMapping = new Map<number, { type: QTypeKey; level: LevelKey }>();
        const presentTypes = new Set<QTypeKey>();

        for (let c = 0; c < numCols; c++) {
          const headerStack: string[] = [];
          for (let r = 0; r < headerRows; r++) {
            const t = grid[r]?.[c]?.text || '';
            if (t && headerStack[headerStack.length - 1] !== t) {
              headerStack.push(t);
            }
          }
          const fullHeader = headerStack.join(' | ');
          const bottomHeader = headerStack[headerStack.length - 1] || '';

          // Skip summary / total / percentage / score columns
          if (/\b(tổng|tỉ\s*lệ|%|điểm|tt|stt|chương|chủ\s*đề|nội\s*dung|đơn\s*vị|yêu\s*cầu\s*cần\s*đạt)\b/i.test(bottomHeader)) {
            continue;
          }
          if (/\b(tổng\s*số|tổng\s*cộng|tỉ\s*lệ\s*%)\b/i.test(fullHeader) && !/\b(nhiều\s*lựa\s*chọn|đúng|trả\s*lời\s*ngắn|tự\s*luận)\b/i.test(fullHeader)) {
            continue;
          }

          let qType: QTypeKey | null = null;
          if (/nhiều\s*lựa\s*chọn|4\s*lựa\s*chọn|phần\s*i\b|dạng\s*i\b/i.test(fullHeader)) {
            qType = 'type1';
          } else if (/đúng\s*[-–/]\s*sai|đúng\s*sai|phần\s*ii\b|dạng\s*ii\b/i.test(fullHeader)) {
            qType = 'type2';
          } else if (/trả\s*lời\s*ngắn|điền\s*khuyết|phần\s*iii\b|dạng\s*iii\b/i.test(fullHeader)) {
            qType = 'type3';
          } else if (/tự\s*luận|phần\s*iv\b|dạng\s*iv\b/i.test(fullHeader)) {
            qType = 'essay';
          } else if (/\btnkq\b|trắc\s*nghiệm/i.test(fullHeader)) {
            qType = 'type1';
          }

          let level: LevelKey | null = null;
          if (/vận\s*dụng\s*cao|\bvdc\b/i.test(bottomHeader)) {
            level = 'van_dung_cao';
          } else if (/vận\s*dụng|\bvd\b/i.test(bottomHeader)) {
            level = 'van_dung';
          } else if (/thông\s*hiểu|\bhiểu\b|\bth\b/i.test(bottomHeader)) {
            level = 'hieu';
          } else if (/nhận\s*biết|\bbiết\b|\bnb\b/i.test(bottomHeader)) {
            level = 'biet';
          }

          if (qType && level) {
            colMapping.set(c, { type: qType, level });
            presentTypes.add(qType);
          }
        }

        if (colMapping.size > 0) {
          const config: QuestionConfig = {
            type1: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            type2: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            type3: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
          };

          // Find if there is a "Tổng số câu" / "Tổng số lệnh hỏi" footer row
          let totalCountRowIdx = -1;
          let firstFooterRowIdx = numRows;
          for (let r = headerRows; r < numRows; r++) {
            const rowLabel = `${grid[r]?.[0]?.text || ''} ${grid[r]?.[1]?.text || ''} ${grid[r]?.[2]?.text || ''}`;
            if (/\b(tổng\s*số\s*câu|tổng\s*số\s*lệnh\s*hỏi|số\s*câu|tổng\s*số\s*ý|tổng\s*điểm|tổng\s*số\s*điểm|tỉ\s*lệ)\b/i.test(rowLabel)) {
              if (firstFooterRowIdx === numRows) firstFooterRowIdx = r;
              if (totalCountRowIdx === -1 && /\b(tổng\s*số\s*câu|tổng\s*số\s*lệnh\s*hỏi|số\s*câu|tổng\s*cộng)\b/i.test(rowLabel) && !/điểm|tỉ\s*lệ/i.test(rowLabel)) {
                totalCountRowIdx = r;
              }
            }
          }

          // Extract topics list from body rows (columns 1 & 2)
          const topicsList: string[] = [];
          for (let r = headerRows; r < firstFooterRowIdx; r++) {
            const chap = grid[r]?.[1]?.text || '';
            const lesson = grid[r]?.[2]?.text || '';
            const line = lesson ? (chap ? `${chap}: ${lesson}` : lesson) : chap;
            if (line && !topicsList.includes(line)) {
              topicsList.push(line);
            }
          }
          if (topicsList.length > 0) {
            result.topicsSummary = topicsList.join('\n');
          }

          // Count questions per mapped column from body rows OR footer row
          const visitedCells = new Set<string>();
          const bodyCounts: QuestionConfig = {
            type1: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            type2: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            type3: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
          };
          const type2UniqueQuestionNums = new Set<string>();

          for (let r = headerRows; r < firstFooterRowIdx; r++) {
            for (const [c, mapInfo] of colMapping.entries()) {
              const cell = grid[r]?.[c];
              if (!cell || !cell.text) continue;
              const originKey = `${cell.rOrigin}_${cell.cOrigin}`;
              if (visitedCells.has(originKey)) continue;
              visitedCells.add(originKey);

              const txt = cell.text.trim();
              if (!txt || txt === '-' || txt === '–') continue;

              // Check for Roman question codes like I.1, II.1a, III.2, IV.1
              const romanCodes = Array.from(txt.matchAll(/\b(?:I|II|III|IV)\.\d+[a-d]?\b/gi));
              if (romanCodes.length > 0) {
                bodyCounts[mapInfo.type][mapInfo.level] += romanCodes.length;
                if (mapInfo.type === 'type2') {
                  for (const rc of romanCodes) {
                    const qNumMatch = rc[0].match(/II\.(\d+)/i);
                    if (qNumMatch) type2UniqueQuestionNums.add(qNumMatch[1]);
                  }
                }
                continue;
              }

              // Check for "Câu 1, Câu 2" codes
              const cauCodes = Array.from(txt.matchAll(/\b(?:Câu|C)\s*\d+[a-d]?\b/gi));
              if (cauCodes.length > 0) {
                bodyCounts[mapInfo.type][mapInfo.level] += cauCodes.length;
                continue;
              }

              // Check for integer count in cell (e.g. "2", "4 (1,0đ)", "2 câu", "1 (TD1)")
              const numMatch = txt.match(/^(\d{1,2})(?![.,]\d)/);
              if (numMatch) {
                bodyCounts[mapInfo.type][mapInfo.level] += parseInt(numMatch[1], 10);
              }
            }
          }

          // Also read footer row if available
          const footerCounts: QuestionConfig = {
            type1: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            type2: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            type3: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
            essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
          };
          if (totalCountRowIdx !== -1) {
            const visitedFooter = new Set<string>();
            for (const [c, mapInfo] of colMapping.entries()) {
              const cell = grid[totalCountRowIdx]?.[c];
              if (!cell || !cell.text) continue;
              const originKey = `${cell.rOrigin}_${cell.cOrigin}`;
              if (visitedFooter.has(originKey)) continue;
              visitedFooter.add(originKey);

              const m = cell.text.match(/(\d{1,2})/);
              if (m) {
                footerCounts[mapInfo.type][mapInfo.level] += parseInt(m[1], 10);
              }
            }
          }

          // Choose best count for each type (prefer bodyCounts if > 0, else footerCounts)
          (['type1', 'type2', 'type3', 'essay'] as QTypeKey[]).forEach(tKey => {
            const bSum =
              bodyCounts[tKey].biet +
              bodyCounts[tKey].hieu +
              bodyCounts[tKey].van_dung +
              bodyCounts[tKey].van_dung_cao;
            const fSum =
              footerCounts[tKey].biet +
              footerCounts[tKey].hieu +
              footerCounts[tKey].van_dung +
              footerCounts[tKey].van_dung_cao;

            const chosen = bSum > 0 ? bodyCounts[tKey] : footerCounts[tKey];
            config[tKey] = { ...chosen };
          });

          // Normalize type2 (Đúng - Sai): if counted in sub-items (4 ý = 1 câu), convert to question count
          const t2Sum =
            config.type2.biet +
            config.type2.hieu +
            config.type2.van_dung +
            config.type2.van_dung_cao;
          if (type2UniqueQuestionNums.size > 0 && t2Sum > type2UniqueQuestionNums.size) {
            const totalQ = type2UniqueQuestionNums.size;
            const bietQ = Math.round((config.type2.biet / t2Sum) * totalQ);
            const hieuQ = Math.round((config.type2.hieu / t2Sum) * totalQ);
            const vdQ = Math.max(0, totalQ - bietQ - hieuQ);
            config.type2 = { biet: bietQ, hieu: hieuQ, van_dung: vdQ, van_dung_cao: 0 };
          } else if (t2Sum >= 8 && t2Sum % 4 === 0) {
            const totalQ = t2Sum / 4;
            const bietQ = Math.round((config.type2.biet / t2Sum) * totalQ);
            const hieuQ = Math.round((config.type2.hieu / t2Sum) * totalQ);
            const vdQ = Math.max(0, totalQ - bietQ - hieuQ);
            config.type2 = { biet: bietQ, hieu: hieuQ, van_dung: vdQ, van_dung_cao: 0 };
          }

          const totalExtracted =
            config.type1.biet + config.type1.hieu + config.type1.van_dung + config.type1.van_dung_cao +
            config.type2.biet + config.type2.hieu + config.type2.van_dung + config.type2.van_dung_cao +
            config.type3.biet + config.type3.hieu + config.type3.van_dung + config.type3.van_dung_cao +
            config.essay.biet + config.essay.hieu + config.essay.van_dung + config.essay.van_dung_cao;

          if (totalExtracted > 0) {
            result.questionConfig = config;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DocxMathParser] Matrix table config parse warning:', err);
  }

  return result;
};

