/**
 * Chuẩn bị ĐỀ GỐC gửi cho AI (Tạo đề tương tự / Sinh 3 đề biến thể).
 *  - PDF / ảnh: gửi nguyên file (Gemini đọc trực tiếp).
 *  - Word .docx: Gemini KHÔNG đọc được file Word → app tự đọc: giữ bảng, công thức Equation → LaTeX,
 *    vị trí hình [HÌNH k] + ảnh kèm theo. Công thức MathType (ảnh WMF) không đọc được → báo rõ cách xử lý.
 */
import type { Part } from '@google/genai';
import { docxToExamSource, isLegacyBinaryDoc } from './docxMathParser';
import { UserFacingError } from './errors';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const isDocxSource = (mimeType?: string, name?: string): boolean =>
  mimeType === DOCX_MIME || /\.docx$/i.test(name || '');

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

export const MATHTYPE_MESSAGE =
  'File Word này dùng công thức MathType (lưu dạng ảnh WMF) nên AI không đọc được công thức. Cách xử lý: mở file bằng Word → "Lưu thành" (Save As) → chọn PDF, rồi tải file PDF lên. (Hoặc trong MathType chọn "Convert Equations" sang Office Math rồi lưu .docx.)';

/** Chuyển file đề gốc thành các phần nội dung gửi cho Gemini. Ném UserFacingError nếu không dùng được. */
export const prepareExamSourceParts = async (base64: string, mimeType: string, name?: string): Promise<Part[]> => {
  if (!isDocxSource(mimeType, name)) {
    return [{ inlineData: { mimeType, data: base64 } }];
  }
  const buffer = base64ToArrayBuffer(base64);
  if (isLegacyBinaryDoc(buffer)) {
    throw new UserFacingError('File .doc đời cũ không đọc được. Hãy mở bằng Word → "Lưu thành" (Save As) → chọn .docx hoặc PDF rồi tải lại.');
  }
  let src;
  try {
    src = await docxToExamSource(buffer);
  } catch {
    throw new UserFacingError('Không đọc được file Word này. Hãy lưu lại thành .docx chuẩn hoặc xuất PDF rồi tải lại.');
  }
  // Phần lớn công thức là MathType → đề gửi đi sẽ mất công thức → dừng và hướng dẫn
  if (src.mathTypeCount >= 2 && src.mathTypeCount > src.ommlCount) {
    throw new UserFacingError(MATHTYPE_MESSAGE);
  }
  const plain = src.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length < 10) {
    throw new UserFacingError('File Word gần như không có chữ (có thể đề được dán dưới dạng ảnh chụp). Hãy xuất file sang PDF rồi tải lên.');
  }

  const parts: Part[] = [{
    text:
      `ĐỀ GỐC (chuyển từ file Word${name ? ` "${name}"` : ''}). Công thức đã ở dạng LaTeX ($...$). ` +
      `Ký hiệu [HÌNH k] là vị trí hình thứ k; ảnh của từng hình được đính kèm ngay sau đây theo đúng số thứ tự.` +
      (src.skippedImages ? ` Có ${src.skippedImages} hình không gửi được — hãy suy luận từ nội dung câu hỏi.` : '') +
      `\n\n${src.html}`,
  }];
  for (const img of src.images) {
    parts.push({ text: `[HÌNH ${img.index}]` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  return parts;
};
