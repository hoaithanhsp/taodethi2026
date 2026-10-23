
export enum AppStep {
  INPUT = 0,
  MATRIX = 1,
  SPECS = 2,
  EXAM = 3,
}

export interface LearningObjectives {
  biet?: string;
  hieu?: string;
  van_dung?: string;
  van_dung_cao?: string;
}

export interface Lesson {
  id: string;
  name: string;
  periods: number;
  weekStart?: number;
  weekEnd?: number;
  objectives: LearningObjectives; // Yêu cầu cần đạt
}

export interface Chapter {
  id: string;
  name: string;
  lessons: Lesson[];
  totalPeriods: number;
}

// Configuration for question counts per Type and Level
export interface QuestionConfig {
  type1: { biet: number; hieu: number; van_dung: number; van_dung_cao: number }; // Trắc nghiệm 4 lựa chọn
  type2: { biet: number; hieu: number; van_dung: number; van_dung_cao: number }; // Đúng/Sai
  type3: { biet: number; hieu: number; van_dung: number; van_dung_cao: number }; // Trả lời ngắn
  essay: { biet: number; hieu: number; van_dung: number; van_dung_cao: number }; // Tự luận
  dungSaiLevelConfig?: DungSaiLevelConfig; // Cấp độ tư duy cho từng ý a,b,c,d của câu Đúng/Sai
}

export type DungSaiLevel = 'nhan_biet' | 'thong_hieu' | 'van_dung';
export interface DungSaiLevelConfig { yA: DungSaiLevel; yB: DungSaiLevel; yC: DungSaiLevel; yD: DungSaiLevel }
export const DEFAULT_DUNG_SAI_LEVELS: DungSaiLevelConfig = { yA: 'nhan_biet', yB: 'nhan_biet', yC: 'thong_hieu', yD: 'van_dung' };
export const DUNG_SAI_LEVEL_LABELS: Record<DungSaiLevel, string> = { nhan_biet: 'Nhận biết', thong_hieu: 'Thông hiểu', van_dung: 'Vận dụng' };

/** Mô tả cấu hình cấp độ ý a,b,c,d để chèn vào prompt AI */
export const describeDungSaiLevels = (config: QuestionConfig): string => {
  const c = config.dungSaiLevelConfig || DEFAULT_DUNG_SAI_LEVELS;
  const L = DUNG_SAI_LEVEL_LABELS;
  const n = config.type2.biet + config.type2.hieu + config.type2.van_dung + config.type2.van_dung_cao;
  if (n <= 0) return '';
  const count = (lv: DungSaiLevel) => [c.yA, c.yB, c.yC, c.yD].filter(x => x === lv).length * n;
  return `**CẤU HÌNH CẤP ĐỘ TỪNG Ý CÂU ĐÚNG/SAI (BẮT BUỘC, áp dụng cho MỌI câu Dạng II):** Ý a: ${L[c.yA]} | Ý b: ${L[c.yB]} | Ý c: ${L[c.yC]} | Ý d: ${L[c.yD]}. → Tổng số ý Dạng II: Biết ${count('nhan_biet')}, Hiểu ${count('thong_hieu')}, VD ${count('van_dung')}. Trong ma trận/đặc tả, mã II.ka đặt ở cột ${L[c.yA]}, II.kb ở cột ${L[c.yB]}, II.kc ở cột ${L[c.yC]}, II.kd ở cột ${L[c.yD]}; khi ra đề, độ khó từng ý phải đúng cấp độ này.`;
};

/** Quy tắc giữ đủ cột cho bảng ma trận/đặc tả */
export const MATRIX_FULL_COLUMNS_RULE = `**QUY TẮC ĐỦ CỘT (BẮT BUỘC):** Bảng phải có ĐẦY ĐỦ mọi cột như file mẫu: TT | Chương/Chủ đề | Nội dung/Đơn vị kiến thức | (bảng đặc tả: Yêu cầu cần đạt) | các cột Biết – Hiểu – Vận dụng của TỪNG dạng câu hỏi có số câu > 0 (kể cả Tự luận nếu > 0) | Tổng (Biết – Hiểu – Vận dụng) | Tỉ lệ % điểm. KHÔNG được bỏ, gộp hoặc rút gọn cột; mỗi hàng phải có đủ số ô bằng số cột ở dòng header cuối (ô trống ghi rỗng, cột tổng ghi 0). Nếu có câu Vận dụng cao thì tính vào cột Vận dụng.`;

export interface InputData {
  subject: string;
  grade: string;
  duration: number;
  examType: string;
  topics: string; // Legacy field, kept for fallback
  additionalNotes: string;

  // New structured data
  chapters: Chapter[];
  questionConfig: QuestionConfig;
}

export interface GenerationState {
  matrix: string;
  specs: string;
  exam: string;
  isLoading: boolean;
  error: string | null;
}

export interface ExamHistoryItem {
  id: string;
  createdAt: string;
  title: string;
  inputData: InputData;
  matrixTemplate: MatrixTemplate;
  selectedLessonIds: string[];
  matrix: string;
  specs: string;
  exam: string;
}

export type Role = 'user' | 'model';

export interface ChatMessage {
  role: Role;
  text: string;
}

// Extracted question from reference document
export interface ExtractedQuestion {
  id: string;
  type: 'type1' | 'type2' | 'type3' | 'essay'; // Dạng câu hỏi
  level: 'biet' | 'hieu' | 'van_dung' | 'van_dung_cao'; // Mức độ
  topic: string; // Chủ đề/Chương
  content: string; // Nội dung câu hỏi (full HTML hoặc text)
  options?: string[]; // Đáp án (A,B,C,D cho type1)
  answer?: string; // Đáp án đúng
  subItems?: string[]; // Các ý a,b,c,d cho type2
}

export type ReferenceUsageMode = 'exact' | 'adapt';

export interface ReferenceDocItem {
  id: string;
  fileName: string;
  text: string;
  images: { base64: string; mimeType: string }[];
  method: string;
  wmfCount: number;
}

// ============================================
// NGÂN HÀNG CÂU HỎI — Types
// ============================================

export interface BankQuestion {
  id: string;
  content: string;
  type: 'type1' | 'type2' | 'type3' | 'essay';
  options?: string[];
  answer: string;
  subject: string;
  topic: string;
  grade: string;
  level: 'NB' | 'TH' | 'VD' | 'VDC';
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AIExtractedQuestion {
  content: string;
  options?: string[];
  answer: string;
  detectedSubject?: string;
  detectedTopic?: string;
  detectedLevel?: 'NB' | 'TH' | 'VD' | 'VDC';
  detectedType?: 'type1' | 'type2' | 'type3' | 'essay';
}

export interface ParsedImportQuestion {
  content: string;
  type: 'type1' | 'type2' | 'type3' | 'essay';
  options?: string[];
  answer: string;
  selected: boolean;
  detectedSubject?: string;
  detectedTopic?: string;
  detectedLevel?: 'NB' | 'TH' | 'VD' | 'VDC';
}

// ============================================
// MA TRẬN ĐẶC TẢ — Mẫu template
// ============================================
export type MatrixTemplate = 'template1' | 'template2' | 'template3' | 'template4';

// ============================================
// APP MODE — Chế độ ứng dụng
// ============================================
export type AppMode = 'home' | 'cv7991' | 'similar' | 'variants';

// ============================================
// TẠO ĐỀ TƯƠNG TỰ — Types
// ============================================
export interface SimilarExamFileData {
  base64: string;
  mimeType: string;
  name: string;
}

export interface SimilarExamResult {
  analysis: string;
  examContent: string;
  detailedSolution: string;
}

export type DiagramMode = 'standard' | 'detailed';
export type SolutionMode = 'concise' | 'detailed' | 'very_detailed';

export interface SimilarExamOptions {
  diagramMode: DiagramMode;
  solutionMode: SolutionMode;
}

// ============================================
// SINH 3 ĐỀ BIẾN THỂ — Types
// ============================================
export interface VariantFileData {
  name: string;
  type: string;
  data: string; // Base64 string
}

export enum VariantState {
  IDLE = 0,
  PROCESSING_STEP_1 = 1,
  PROCESSING_STEP_2 = 2,
  PROCESSING_STEP_3 = 3,
  COMPLETE = 4,
  ERROR = 5,
}
