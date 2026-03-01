
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
  type1: { biet: number; hieu: number; van_dung: number }; // Trắc nghiệm 4 lựa chọn
  type2: { biet: number; hieu: number; van_dung: number }; // Đúng/Sai
  type3: { biet: number; hieu: number; van_dung: number }; // Trả lời ngắn
  essay: { biet: number; hieu: number; van_dung: number }; // Tự luận
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
