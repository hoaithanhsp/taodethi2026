/**
 * Studio hình theo môn: Hóa học, Vật lí, Sinh học.
 * Hình được lưu trong đề dưới dạng khối ```figure-json``` như hình Toán, nên hiện trên web
 * và xuất Word (ảnh PNG) bằng cùng một đường như các hình sẵn có.
 */
import { renderChemFigure, CHEM_FIGURE_TYPES } from './chemFigures';
import { renderPhysicsFigure, PHYSICS_FIGURE_TYPES } from './physicsFigures';
import { renderBiologyFigure, BIOLOGY_FIGURE_TYPES } from './biologyFigures';

export type StudioSubject = 'math' | 'chemistry' | 'physics' | 'biology';

/** Danh sách môn dùng chung cho các ô chọn môn. */
export const SUBJECT_OPTIONS = ['Toán học', 'Ngữ văn', 'Tiếng Anh', 'Vật lí', 'Hóa học', 'Sinh học', 'Lịch sử', 'Địa lí', 'Tin học', 'Công nghệ', 'Giáo dục công dân'];

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/hoá/g, 'hóa').replace(/\s+/g, ' ').trim();

/** Nhận diện môn có Studio riêng; trả null nếu môn không có Studio hình. */
export const studioSubjectOf = (subject?: string | null): StudioSubject | null => {
  const s = norm(subject || '');
  if (!s) return null;
  if (/^toán/.test(s)) return 'math';
  if (/hóa/.test(s)) return 'chemistry';
  if (/vật l[ýí]|^lý|^lí/.test(s)) return 'physics';
  if (/sinh/.test(s)) return 'biology';
  return null;
};

const CHEM = new Set<string>(CHEM_FIGURE_TYPES);
const PHYS = new Set<string>(PHYSICS_FIGURE_TYPES);
const BIO = new Set<string>(BIOLOGY_FIGURE_TYPES);

/** Loại hình thuộc Studio theo môn (Hóa, Lí, Sinh) — vẽ thẳng, không qua bộ sửa hình Toán. */
export const isSubjectFigureType = (type: unknown): boolean => {
  const t = String(type || '').toLowerCase();
  return CHEM.has(t) || PHYS.has(t) || BIO.has(t);
};

export const renderSubjectFigure = (spec: any): string => {
  const t = String(spec?.type || '').toLowerCase();
  if (CHEM.has(t)) return renderChemFigure(spec);
  if (PHYS.has(t)) return renderPhysicsFigure(spec);
  if (BIO.has(t)) return renderBiologyFigure(spec);
  throw new Error(`Loại hình "${spec?.type}" không thuộc Studio theo môn.`);
};
