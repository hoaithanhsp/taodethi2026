/**
 * KIỂM TRA ĐỀ SAU KHI SINH (hậu kiểm bằng code — prompt chỉ là lời dặn, code mới là ràng buộc).
 * Đếm lại số câu từng phần, phương án A–D, đủ 4 ý a–d của câu Đúng – Sai, phần thừa / thiếu,
 * bảng đáp án, đề bị cắt cụt do hết token.
 */
import { htmlToText, QType, QTYPES, TYPE_LABEL } from './matrixContract';

export const TRUNCATION_MARKER = '<!--EXAMCRAFT_TRUNCATED-->';

export interface ExamIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ExamExpectation {
  /** Số câu cần có ở từng phần (Dạng II: số câu, mỗi câu 4 ý). null = không biết chắc → chỉ kiểm tra định dạng */
  counts: Record<QType, number> | null;
}

export interface ExamStructure {
  parts: Array<{ type: QType | null; heading: string; questions: Array<{ num: number; text: string }> }>;
  hasAnswerSection: boolean;
}

const PART_RE = /^\s*(?:PHẦN|Phần)\s+(IV|III|II|I|[1-4])(?![A-Za-z0-9])[.:\s–-]*(.*)$/;
const ESSAY_HEADING_RE = /^\s*(?:[A-D]|[IVX]+)\s*[.:]\s*(?:PHẦN\s+)?TỰ\s*LUẬN\b/i;
// Kiểu tiêu đề "I. Trắc nghiệm nhiều lựa chọn", "II. ĐÚNG – SAI", "C. Trả lời ngắn"
const ALT_PART_RE = /^\s*(?:[A-D]|[IVX]+)\s*[.:]\s*(?:câu\s*)?(?:trắc\s*nghiệm\s*)?(?:câu\s*hỏi\s*)?(nhiều\s*(?:phương\s*án\s*)?lựa\s*chọn|đúng\s*[-–\/]?\s*sai|trả\s*lời\s*ngắn|tự\s*luận)/i;
const QUESTION_RE = /^\s*Câu\s+(\d{1,3})(?:\s*\([^)]*\))?\s*[.:)\-–]/i;
const ANSWER_RE = /^\s*(?:[A-ZĐ]\s*[.:]\s*|[IVX]+\s*[.:]\s*|PHẦN\s+[IVX]+\s*[.:]?\s*)?(?:BẢNG\s*)?(ĐÁP\s*ÁN|HƯỚNG\s*DẪN\s*(?:CHẤM|GIẢI)|LỜI\s*GIẢI)/i;

const ROMAN_TO_TYPE: Record<string, QType> = { I: 'I', II: 'II', III: 'III', IV: 'IV', '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };

const partTypeOf = (roman: string, rest: string): QType | null => {
  const t = rest.toLowerCase();
  if (/đúng\s*[-–\/]?\s*sai/.test(t)) return 'II';
  if (/trả\s*lời\s*ngắn/.test(t)) return 'III';
  if (/tự\s*luận/.test(t)) return 'IV';
  if (/nhiều\s*(?:phương\s*án\s*)?lựa\s*chọn|4\s*lựa\s*chọn/.test(t)) return 'I';
  return ROMAN_TO_TYPE[roman.toUpperCase()] || null;
};

export const parseExamStructure = (html: string): ExamStructure => {
  const cleaned = (html || '').replace(/<script[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ');
  const lines = htmlToText(cleaned).split('\n').map(l => l.trim()).filter(Boolean);

  const parts: ExamStructure['parts'] = [];
  let current: ExamStructure['parts'][number] | null = null;
  let currentQ: { num: number; text: string } | null = null;
  let seenQuestion = false;
  let inAnswer = false;
  let hasAnswerSection = false;
  const typesWithQuestions = new Set<QType>();
  for (const line of lines) {
    // Tiêu đề ĐÁP ÁN / HƯỚNG DẪN CHẤM (sau câu hỏi đầu tiên) → bỏ qua các "Câu N" trong phần đáp án
    if (seenQuestion && line.length <= 140 && ANSWER_RE.test(line)) {
      inAnswer = true;
      hasAnswerSection = true;
      currentQ = null;
      continue;
    }
    const pm = line.length <= 220 ? PART_RE.exec(line) : null;
    let am = !pm && line.length <= 140 ? ALT_PART_RE.exec(line) : null;
    // "A./B./C./D. …" chỉ là tiêu đề khi viết HOA (tránh nhầm phương án "A. Tự luận" trong câu hỏi)
    if (am && /^\s*[A-D]\s*[.:]/.test(line) && am[1] !== am[1].toUpperCase()) am = null;
    const essayHeading = !pm && !am && line.length <= 120 && ESSAY_HEADING_RE.test(line) && !(/^\s*[A-D]\s*[.:]/.test(line) && !/TỰ\s*LUẬN/.test(line));
    if (pm || am || essayHeading) {
      const type = pm ? partTypeOf(pm[1], pm[2] || '') : am ? partTypeOf('', am[1]) : 'IV';
      // Trong phần đáp án, "PHẦN I/II…" chỉ là tiêu đề con của đáp án — trừ khi là phần câu hỏi mới
      if (inAnswer && (!type || typesWithQuestions.has(type))) { currentQ = null; continue; }
      inAnswer = false;
      current = { type, heading: line, questions: [] };
      parts.push(current);
      currentQ = null;
      continue;
    }
    if (inAnswer) continue;
    const qm = QUESTION_RE.exec(line);
    if (qm) {
      if (!current) { current = { type: null, heading: '', questions: [] }; parts.push(current); }
      currentQ = { num: parseInt(qm[1], 10), text: line };
      current.questions.push(currentQ);
      if (current.type) typesWithQuestions.add(current.type);
      seenQuestion = true;
      continue;
    }
    if (currentQ) currentQ.text += '\n' + line;
  }
  return { parts, hasAnswerSection };
};

export const validateExamHtml = (html: string, exp: ExamExpectation): ExamIssue[] => {
  const issues: ExamIssue[] = [];
  if (!html || !html.trim()) return [{ code: 'EMPTY', message: 'AI không trả về nội dung đề.', severity: 'error' }];
  if (html.includes(TRUNCATION_MARKER) || (/<html/i.test(html) && !/<\/html>/i.test(html))) {
    issues.push({ code: 'TRUNCATED', message: 'Đề bị cắt cụt (AI hết giới hạn độ dài) — phần cuối đề/đáp án có thể bị thiếu.', severity: 'error' });
  }

  const s = parseExamStructure(html);
  const byType: Record<QType, Array<{ num: number; text: string }>> = { I: [], II: [], III: [], IV: [] };
  const untyped = s.parts.filter(p => !p.type).flatMap(p => p.questions);
  s.parts.forEach(p => { if (p.type) byType[p.type].push(...p.questions); });
  // Đề không có tiêu đề PHẦN mà chỉ có 1 dạng → gán luôn cho dạng đó
  const counts = exp.counts;
  const expectedTypes = counts ? QTYPES.filter(t => counts[t] > 0) : [];
  if (untyped.length && expectedTypes.length === 1 && byType[expectedTypes[0]].length === 0) byType[expectedTypes[0]] = untyped;

  QTYPES.forEach(type => {
    const qs = byType[type];
    const nums = Array.from(new Set(qs.map(q => q.num))).sort((a, b) => a - b);
    const label = `Phần ${type} (${TYPE_LABEL[type]})`;
    // Không biết chắc số câu (ma trận tải lên không đọc được) → chỉ kiểm tra định dạng từng câu
    const want = counts ? counts[type] || 0 : nums.length;
    if (want === 0) {
      if (nums.length > 0) issues.push({ code: `EXTRA_${type}`, message: `${label} không có trong ma trận nhưng đề lại có ${nums.length} câu — phải bỏ phần này.`, severity: 'error' });
      return;
    }
    if (nums.length === 0) {
      issues.push({ code: `MISSING_${type}`, message: `Thiếu ${label}: ma trận yêu cầu ${want} câu.`, severity: 'error' });
      return;
    }
    if (nums.length !== want) {
      issues.push({ code: `COUNT_${type}`, message: `${label}: ma trận yêu cầu ${want} câu, đề có ${nums.length} câu.`, severity: 'error' });
    }
    const dup = qs.length - nums.length;
    if (dup > 0) issues.push({ code: `DUP_${type}`, message: `${label}: có số câu bị lặp lại.`, severity: 'warning' });
    if (nums[0] !== 1 || nums.some((n, i) => n !== i + 1)) {
      issues.push({ code: `SEQ_${type}`, message: `${label}: đánh số câu không liên tục từ Câu 1 (${nums.slice(0, 8).join(', ')}${nums.length > 8 ? '…' : ''}).`, severity: 'warning' });
    }
    if (type === 'I') {
      const bad = qs.filter(q => new Set(Array.from(q.text.matchAll(/(?:^|[\s>(])([A-D])\s*[.)]/g)).map(m => m[1])).size < 4).map(q => q.num);
      if (bad.length) issues.push({ code: 'OPTIONS_I', message: `Phần I: câu ${bad.join(', ')} chưa đủ 4 phương án A, B, C, D.`, severity: 'error' });
    }
    if (type === 'II') {
      const bad = qs.filter(q => new Set(Array.from(q.text.matchAll(/(?:^|[\s>(])([a-d])\s*\)/g)).map(m => m[1])).size < 4).map(q => q.num);
      if (bad.length) issues.push({ code: 'ITEMS_II', message: `Phần II: câu ${bad.join(', ')} chưa đủ 4 ý a), b), c), d).`, severity: 'error' });
    }
  });

  if (!s.hasAnswerSection) issues.push({ code: 'NO_KEY', message: 'Không tìm thấy phần ĐÁP ÁN / HƯỚNG DẪN CHẤM.', severity: 'error' });
  return issues;
};

export const hasBlockingIssues = (issues: ExamIssue[]) => issues.some(i => i.severity === 'error');
