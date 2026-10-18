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
import { ExtractedQuestion } from '../types';

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
