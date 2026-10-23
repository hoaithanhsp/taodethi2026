
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
  type2QuestionCount?: number; // Số câu Dạng II
  dungSaiLevelConfigs?: DungSaiLevelConfig[]; // Cấp độ a,b,c,d riêng cho từng câu
  dungSaiLevelConfig?: DungSaiLevelConfig; // Dữ liệu cũ: một cấu hình áp dụng cho mọi câu
}

export type DungSaiLevel = 'nhan_biet' | 'thong_hieu' | 'van_dung';
export interface DungSaiLevelConfig { yA: DungSaiLevel; yB: DungSaiLevel; yC: DungSaiLevel; yD: DungSaiLevel }
export const DEFAULT_DUNG_SAI_LEVELS: DungSaiLevelConfig = { yA: 'nhan_biet', yB: 'nhan_biet', yC: 'thong_hieu', yD: 'van_dung' };
export const DUNG_SAI_LEVEL_LABELS: Record<DungSaiLevel, string> = { nhan_biet: 'Nhận biết', thong_hieu: 'Thông hiểu', van_dung: 'Vận dụng' };

export const getDungSaiQuestionCount = (config: QuestionConfig): number => {
  if (Number.isFinite(config.type2QuestionCount)) return Math.max(0, Math.floor(config.type2QuestionCount || 0));
  return Math.max(0, (config.type2?.biet || 0) + (config.type2?.hieu || 0) + (config.type2?.van_dung || 0) + (config.type2?.van_dung_cao || 0));
};

export const getDungSaiLevelConfigs = (config: QuestionConfig): DungSaiLevelConfig[] => {
  const count = getDungSaiQuestionCount(config);
  const saved = config.dungSaiLevelConfigs || [];
  const fallback = config.dungSaiLevelConfig || DEFAULT_DUNG_SAI_LEVELS;
  return Array.from({ length: count }, (_, index) => ({ ...(saved[index] || fallback) }));
};

export const getDungSaiLevelTotals = (config: QuestionConfig) => {
  const totals = { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 };
  getDungSaiLevelConfigs(config).forEach(question => {
    [question.yA, question.yB, question.yC, question.yD].forEach(level => {
      if (level === 'nhan_biet') totals.biet += 1;
      else if (level === 'thong_hieu') totals.hieu += 1;
      else totals.van_dung += 1;
    });
  });
  return totals;
};

/** Mô tả cấu hình cấp độ ý a,b,c,d để chèn vào prompt AI */
export const describeDungSaiLevels = (config: QuestionConfig): string => {
  const questions = getDungSaiLevelConfigs(config);
  if (questions.length === 0) return '';
  const L = DUNG_SAI_LEVEL_LABELS;
  const totals = getDungSaiLevelTotals(config);
  const details = questions.map((question, index) => `Câu ${index + 1}: ý a ${L[question.yA]}, ý b ${L[question.yB]}, ý c ${L[question.yC]}, ý d ${L[question.yD]}`).join('; ');
  return `**CẤU HÌNH CẤP ĐỘ TỪNG CÂU ĐÚNG/SAI (BẮT BUỘC):** ${details}. Tổng ${questions.length * 4} ý: Biết ${totals.biet}, Hiểu ${totals.hieu}, Vận dụng ${totals.van_dung}. Mã II.ka, II.kb, II.kc, II.kd phải đặt đúng cột theo cấu hình riêng của Câu k.`;
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
  /** Ma trận do người dùng tải lên (ma trận là chuẩn cao nhất khi sinh lại đề) */
  isUploadedMatrix?: boolean;
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
