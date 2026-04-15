
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
}

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
// APP MODE — Chế độ ứng dụng
// ============================================
export type AppMode = 'cv7991' | 'similar' | 'variants';

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
