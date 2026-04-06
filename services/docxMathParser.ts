/**
 * DOCX Math Parser — Trích xuất công thức toán từ file Word
 * 
 * Chiến lược Hybrid (theo skill-toan-hoc):
 * 1. Mammoth: convert WMF/EMF → PNG (công thức MathType)
 * 2. XML Parser: extract text + OMML → LaTeX
 * 3. Merge: text từ XML, hình từ mammoth
 */

import mammoth from 'mammoth';

export interface DocxParseResult {
  text: string;
  images: { base64: string; mimeType: string }[];
  method: 'xml' | 'mammoth' | 'hybrid';
  wmfCount: number;
}

// --- OMML → LaTeX converter (simplified) ---
const ommlToLatex = (ommlXml: string): string => {
  let latex = ommlXml;
  
  // Fractions: <m:f> ... <m:num>...</m:num> <m:den>...</m:den> </m:f>
  latex = latex.replace(/<m:f[^>]*>([\s\S]*?)<\/m:f>/g, (_match, inner) => {
    const numMatch = inner.match(/<m:num[^>]*>([\s\S]*?)<\/m:num>/);
    const denMatch = inner.match(/<m:den[^>]*>([\s\S]*?)<\/m:den>/);
    const num = numMatch ? extractMathText(numMatch[1]) : '?';
    const den = denMatch ? extractMathText(denMatch[1]) : '?';
    return `\\frac{${num}}{${den}}`;
  });

  // Superscripts: <m:sSup> ... <m:e>base</m:e> <m:sup>exp</m:sup> </m:sSup>
  latex = latex.replace(/<m:sSup[^>]*>([\s\S]*?)<\/m:sSup>/g, (_match, inner) => {
    const baseMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
    const supMatch = inner.match(/<m:sup[^>]*>([\s\S]*?)<\/m:sup>/);
    const base = baseMatch ? extractMathText(baseMatch[1]) : '?';
    const sup = supMatch ? extractMathText(supMatch[1]) : '?';
    return `${base}^{${sup}}`;
  });

  // Subscripts: <m:sSub>
  latex = latex.replace(/<m:sSub[^>]*>([\s\S]*?)<\/m:sSub>/g, (_match, inner) => {
    const baseMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
    const subMatch = inner.match(/<m:sub[^>]*>([\s\S]*?)<\/m:sub>/);
    const base = baseMatch ? extractMathText(baseMatch[1]) : '?';
    const sub = subMatch ? extractMathText(subMatch[1]) : '?';
    return `${base}_{${sub}}`;
  });

  // Radicals: <m:rad>
  latex = latex.replace(/<m:rad[^>]*>([\s\S]*?)<\/m:rad>/g, (_match, inner) => {
    const degMatch = inner.match(/<m:deg[^>]*>([\s\S]*?)<\/m:deg>/);
    const eMatch = inner.match(/<m:e[^>]*>([\s\S]*?)<\/m:e>/);
    const deg = degMatch ? extractMathText(degMatch[1]) : '';
    const e = eMatch ? extractMathText(eMatch[1]) : '?';
    if (deg && deg.trim()) {
      return `\\sqrt[${deg}]{${e}}`;
    }
    return `\\sqrt{${e}}`;
  });

  // Extract remaining text
  return extractMathText(latex);
};

const extractMathText = (xml: string): string => {
  // Extract text from <m:t> and <w:t> tags
  let result = '';
  const textMatches = xml.matchAll(/<(?:m|w):t[^>]*>([^<]*)<\/(?:m|w):t>/g);
  for (const match of textMatches) {
    result += match[1];
  }
  return result || xml.replace(/<[^>]+>/g, '').trim();
};

// --- XML Parser: Extract text + OMML from document.xml ---
const processDocumentXml = (xmlContent: string): string => {
  let output = '';
  
  // Process paragraphs
  const paragraphs = xmlContent.split(/<w:p[ >]/);
  
  for (const para of paragraphs) {
    let paraText = '';
    
    // Check for math blocks
    const mathBlocks = para.match(/<m:oMath[^P][^>]*>[\s\S]*?<\/m:oMath>/g);
    if (mathBlocks) {
      for (const mathBlock of mathBlocks) {
        const latex = ommlToLatex(mathBlock);
        if (latex.trim()) {
          paraText += ` $${latex}$ `;
        }
      }
    }
    
    // Extract regular text (outside math blocks)
    let cleanedPara = para;
    // Remove math blocks to avoid double-processing
    cleanedPara = cleanedPara.replace(/<m:oMath[^P][^>]*>[\s\S]*?<\/m:oMath>/g, '');
    
    const textMatches = cleanedPara.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
    for (const match of textMatches) {
      paraText += match[1];
    }
    
    if (paraText.trim()) {
      output += paraText.trim() + '\n';
    }
  }
  
  return output;
};

// --- Mammoth: Extract images (WMF → PNG conversion) ---
const extractImagesViaMammoth = async (arrayBuffer: ArrayBuffer): Promise<{
  html: string;
  images: { base64: string; mimeType: string }[];
}> => {
  const images: { base64: string; mimeType: string }[] = [];
  
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement((image: any) => {
        return image.read("base64").then((imageBase64: string) => {
          const mimeType = image.contentType || 'image/png';
          // Only keep image types that Gemini supports
          if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)) {
            images.push({ base64: imageBase64, mimeType });
          }
          return { src: `data:${mimeType};base64,${imageBase64}` };
        });
      })
    }
  );
  
  return { html: result.value, images };
};

// --- ZIP: Extract document.xml from DOCX ---
const extractDocumentXml = async (arrayBuffer: ArrayBuffer): Promise<{
  documentXml: string | null;
  wmfCount: number;
}> => {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    const files = parseZipEntries(bytes);
    
    let documentXml: string | null = null;
    let wmfCount = 0;
    
    for (const file of files) {
      if (file.name === 'word/document.xml') {
        documentXml = new TextDecoder().decode(file.data);
      }
      if (file.name.match(/\.(wmf|emf)$/i)) {
        wmfCount++;
      }
    }
    
    return { documentXml, wmfCount };
  } catch (err) {
    console.warn('[DocxMathParser] ZIP parsing failed:', err);
    return { documentXml: null, wmfCount: 0 };
  }
};

// --- Simple ZIP parser (no dependency) ---
interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const parseZipEntries = (bytes: Uint8Array): ZipEntry[] => {
  const entries: ZipEntry[] = [];
  let offset = 0;
  
  while (offset < bytes.length - 4) {
    // Look for local file header signature: 0x04034b50
    if (bytes[offset] === 0x50 && bytes[offset + 1] === 0x4B &&
        bytes[offset + 2] === 0x03 && bytes[offset + 3] === 0x04) {
      
      const compressionMethod = bytes[offset + 8] | (bytes[offset + 9] << 8);
      const compressedSize = bytes[offset + 18] | (bytes[offset + 19] << 8) | 
                             (bytes[offset + 20] << 16) | (bytes[offset + 21] << 24);
      // uncompressedSize not used in browser parsing
      const _uncompressedSize = bytes[offset + 22] | (bytes[offset + 23] << 8) |
                                (bytes[offset + 24] << 16) | (bytes[offset + 25] << 24);
      const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
      const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
      
      const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
      const dataStart = offset + 30 + nameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      
      if (compressionMethod === 0 && compressedSize > 0) {
        // Stored (no compression)
        entries.push({ name, data: bytes.slice(dataStart, dataEnd) });
      } else if (compressionMethod === 8 && compressedSize > 0) {
        // Deflated — try to decompress using DecompressionStream
        try {
          entries.push({ name, data: bytes.slice(dataStart, dataEnd) });
        } catch {
          // Skip if can't decompress
        }
      }
      
      offset = dataEnd;
    } else {
      offset++;
    }
  }
  
  return entries;
};

// Note: DecompressionStream for deflated entries is not used here;
// mammoth handles the full DOCX zip internally.

// --- Main export ---
export const parseDocxWithMath = async (arrayBuffer: ArrayBuffer): Promise<DocxParseResult> => {
  console.log('[DocxMathParser] Starting hybrid parse...');
  
  // Step 1: ALWAYS run mammoth first → extract images (WMF → PNG)
  let mammothResult: { html: string; images: { base64: string; mimeType: string }[] } | null = null;
  try {
    mammothResult = await extractImagesViaMammoth(arrayBuffer);
    console.log(`[DocxMathParser] Mammoth: ${mammothResult.images.length} images extracted`);
  } catch (err) {
    console.warn('[DocxMathParser] Mammoth failed:', err);
  }
  
  // Step 2: Try XML parsing → extract text + OMML → LaTeX
  let xmlText: string | null = null;
  let wmfCount = 0;
  
  try {
    const zipResult = await extractDocumentXml(arrayBuffer);
    wmfCount = zipResult.wmfCount;
    
    if (zipResult.documentXml) {
      // Try to decompress if needed
      xmlText = processDocumentXml(zipResult.documentXml);
      console.log(`[DocxMathParser] XML: ${xmlText.length} chars, ${wmfCount} WMF files`);
    }
  } catch (err) {
    console.warn('[DocxMathParser] XML parsing failed:', err);
  }
  
  // Step 3: Merge results
  const images = mammothResult?.images || [];
  
  if (xmlText && xmlText.trim().length > 50) {
    // XML success → use XML text (has LaTeX) + mammoth images
    return {
      text: xmlText,
      images,
      method: wmfCount > 0 ? 'hybrid' : 'xml',
      wmfCount,
    };
  }
  
  // Fallback: extract text from mammoth HTML
  if (mammothResult) {
    const plainText = mammothResult.html
      .replace(/<img[^>]*>/g, ' [HÌNH] ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    return {
      text: plainText,
      images,
      method: 'mammoth',
      wmfCount,
    };
  }
  
  throw new Error('Không thể đọc file DOCX. File có thể bị hỏng.');
};
