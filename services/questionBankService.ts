/**
 * Ngân hàng Câu hỏi — Service (localStorage-based CRUD)
 */
import { BankQuestion, ExtractedQuestion } from '../types';

const STORAGE_KEY = 'examcraft_question_bank';

// --- Read ---
export const getAllQuestions = (): BankQuestion[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BankQuestion[];
  } catch {
    return [];
  }
};

// --- Write ---
const saveAll = (questions: BankQuestion[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(questions));
};

// --- Create ---
export const addQuestion = (q: Omit<BankQuestion, 'id' | 'createdAt' | 'updatedAt'>): BankQuestion => {
  const all = getAllQuestions();
  const now = new Date().toISOString();
  const newQ: BankQuestion = {
    ...q,
    id: `bq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  };
  all.push(newQ);
  saveAll(all);
  return newQ;
};

// --- Update ---
export const updateQuestion = (id: string, updates: Partial<BankQuestion>): BankQuestion | null => {
  const all = getAllQuestions();
  const idx = all.findIndex(q => q.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() };
  saveAll(all);
  return all[idx];
};

// --- Delete ---
export const deleteQuestion = (id: string): boolean => {
  const all = getAllQuestions();
  const filtered = all.filter(q => q.id !== id);
  if (filtered.length === all.length) return false;
  saveAll(filtered);
  return true;
};

export const deleteMultiple = (ids: string[]): number => {
  const all = getAllQuestions();
  const idSet = new Set(ids);
  const filtered = all.filter(q => !idSet.has(q.id));
  const deleted = all.length - filtered.length;
  saveAll(filtered);
  return deleted;
};

// --- Search & Filter ---
export const searchQuestions = (opts: {
  subject?: string;
  grade?: string;
  level?: string;
  type?: string;
  keyword?: string;
  tags?: string[];
}): BankQuestion[] => {
  let results = getAllQuestions();

  if (opts.subject) {
    results = results.filter(q => q.subject.toLowerCase().includes(opts.subject!.toLowerCase()));
  }
  if (opts.grade) {
    results = results.filter(q => q.grade === opts.grade);
  }
  if (opts.level) {
    results = results.filter(q => q.level === opts.level);
  }
  if (opts.type) {
    results = results.filter(q => q.type === opts.type);
  }
  if (opts.keyword) {
    const kw = opts.keyword.toLowerCase();
    results = results.filter(q =>
      q.content.toLowerCase().includes(kw) ||
      q.topic.toLowerCase().includes(kw) ||
      q.tags.some(t => t.toLowerCase().includes(kw))
    );
  }
  if (opts.tags && opts.tags.length > 0) {
    results = results.filter(q => opts.tags!.some(t => q.tags.includes(t)));
  }

  return results;
};

// --- Import from ExtractedQuestion ---
export const importFromExtracted = (
  questions: ExtractedQuestion[],
  subject: string,
  grade: string
): BankQuestion[] => {
  const now = new Date().toISOString();
  const all = getAllQuestions();
  const imported: BankQuestion[] = [];

  for (const eq of questions) {
    // Map level
    const levelMap: Record<string, 'NB' | 'TH' | 'VD' | 'VDC'> = {
      'biet': 'NB',
      'hieu': 'TH',
      'van_dung': 'VD',
      'van_dung_cao': 'VDC',
    };

    const newQ: BankQuestion = {
      id: `bq_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      content: eq.content,
      type: eq.type,
      options: eq.options,
      answer: eq.answer || '',
      subject,
      topic: eq.topic || '',
      grade,
      level: levelMap[eq.level] || 'NB',
      tags: [eq.topic, eq.type].filter(Boolean),
      createdAt: now,
      updatedAt: now,
    };
    imported.push(newQ);
  }

  saveAll([...all, ...imported]);
  return imported;
};

// --- Export/Import JSON ---
export const exportToJSON = (): string => {
  return JSON.stringify(getAllQuestions(), null, 2);
};

export const importFromJSON = (jsonStr: string): number => {
  try {
    const imported = JSON.parse(jsonStr) as BankQuestion[];
    if (!Array.isArray(imported)) throw new Error('Invalid format');
    const all = getAllQuestions();
    const existingIds = new Set(all.map(q => q.id));
    const newOnes = imported.filter(q => !existingIds.has(q.id));
    saveAll([...all, ...newOnes]);
    return newOnes.length;
  } catch {
    throw new Error('File JSON không hợp lệ');
  }
};

// --- Stats ---
export const getStats = () => {
  const all = getAllQuestions();
  return {
    total: all.length,
    bySubject: groupBy(all, 'subject'),
    byGrade: groupBy(all, 'grade'),
    byLevel: groupBy(all, 'level'),
    byType: groupBy(all, 'type'),
  };
};

const groupBy = <T extends Record<string, any>>(arr: T[], key: keyof T): Record<string, number> => {
  return arr.reduce((acc, item) => {
    const k = String(item[key]);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
};
