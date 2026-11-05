/**
 * services/examShuffle.ts
 * ------------------------------------------------------------------
 * ĐẢO ĐỀ: từ 1 đề đã sinh tạo nhiều mã đề + bảng đáp án theo mã đề. Chạy hoàn toàn bằng code
 * (không gọi AI) nên không làm thay đổi nội dung câu hỏi.
 *
 * Nguyên tắc:
 *  - Đảo TẠI CHỖ trên văn bản gốc (HTML hoặc Markdown): chỉ hoán đổi các khối câu và nội dung
 *    phương án theo vị trí, nên công thức, hình vẽ, bảng biểu đi theo đúng câu của nó.
 *  - Chỉ đảo trong cùng phần và cùng dạng câu; số câu giữ theo vị trí.
 *  - Có nguy cơ sai thì KHÔNG đảo: phương án "Cả A và B", ý nhắc "ý a", câu dùng chung ngữ liệu,
 *    câu nhắc tới "câu 5"; câu tự luận giữ nguyên.
 *  - Đáp án đọc từ phần đáp án của AI; thiếu hoặc mâu thuẫn thì báo để giáo viên kiểm tra.
 * ------------------------------------------------------------------
 */
import { ALT_PART_RE, ANSWER_RE, EN_PART_RE, ESSAY_HEADING_RE, PART_RE, QUESTION_RE, TRUNCATION_MARKER, partTypeOf } from './examValidator';
import { findTopLevelTables, htmlToText, QType, tableToGrid } from './matrixContract';

export type QKind = 'mc' | 'tf' | 'short' | 'essay';
export type TfLetter = 'a' | 'b' | 'c' | 'd';
const TF_LETTERS: TfLetter[] = ['a', 'b', 'c', 'd'];
const MC_LETTERS = ['A', 'B', 'C', 'D'];

interface Slot {
  labelStart: number;
  contentStart: number;
  contentEnd: number;
}

export interface ExamQuestion {
  num: number;
  kind: QKind;
  /** Vị trí trong văn bản đề gốc */
  start: number;
  end: number;
  numPos: number;
  numLen: number;
  /** 4 phương án / 4 ý nhận diện được; null nếu không đủ */
  slots: Slot[] | null;
  /** Phương án / ý phải giữ nguyên thứ tự */
  keepInner: boolean;
  /** Câu phải giữ nguyên vị trí */
  pinned: boolean;
  sectionIndex: number;
}

export interface ExamSection {
  title: string;
  type: QType | null;
  start: number;
  questions: ExamQuestion[];
  /** Thẻ đóng còn lại sau câu cuối (không đi theo câu khi đảo) */
  tailStart: number;
  end: number;
}

export interface AnswerBook {
  mc: Record<number, string>;
  tf: Record<number, Partial<Record<TfLetter, string>>>;
  short: Record<number, string>;
}

export interface ParsedExam {
  source: string;
  isHtml: boolean;
  bodyStart: number;
  bodyEnd: number;
  footer: string;
  sections: ExamSection[];
  questions: ExamQuestion[];
  answers: AnswerBook;
  /** Hai nơi trong phần đáp án ghi khác nhau */
  conflicts: string[];
  notes: string[];
}

export interface ShuffleOptions {
  count: number;
  startCode: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  shuffleStatements: boolean;
}

export interface VersionQuestion {
  /** Số câu trong mã đề */
  num: number;
  /** Số câu trong đề gốc (để tra lời giải chi tiết) */
  originalNum: number;
  kind: QKind;
  answer: string;
}

export interface ExamVersion {
  code: string;
  content: string;
  questions: VersionQuestion[];
}

/* ---------------------------- Che vùng không được quét ---------------------------- */

const FILL = '';
const fill = (s: string) => FILL.repeat(s.length);

/** Chép chuỗi nhưng thay công thức, hình, bảng… bằng ký tự đệm CÙNG ĐỘ DÀI để vị trí không đổi. */
const maskSource = (src: string): string => {
  let m = src;
  for (const re of [
    /<!--[\s\S]*?-->/g,
    /<head\b[\s\S]*?<\/head>/gi,
    /<(style|script|svg|pre)\b[\s\S]*?<\/\1>/gi,
    /<img\b[^>]*>/gi,
    /^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm,
    /(?<!\\)\$\$[\s\S]+?(?<!\\)\$\$/g,
    /(?<!\\)\\\[[\s\S]+?(?<!\\)\\\]/g,
    /(?<!\\)\\\([\s\S]+?(?<!\\)\\\)/g,
    /(?<![\\$])\$(?!\$)[^\n$]+?(?<!\\)\$(?!\$)/g,
  ]) {
    m = m.replace(re, fill);
  }
  // Bảng trong đề (số liệu, bảng biến thiên) → che, trừ bảng trình bày 4 phương án A–D
  for (const t of findTopLevelTables(m).reverse()) {
    const cellsWithLabels = (t.html.match(/<t[dh]\b[^>]*>\s*(?:<[^>]+>\s*)*[A-D]\s*[.)]/gi) || []).length;
    if (cellsWithLabels >= 4) continue;
    m = m.slice(0, t.start) + fill(m.slice(t.start, t.end)) + m.slice(t.end);
  }
  return m.replace(/^[ \t]*\|.*\|[ \t]*$/gm, fill);
};

const BLOCK_RE = /<\/?(?:p|div|li|ul|ol|h[1-6]|table|thead|tbody|tfoot|tr|td|th|blockquote|section|article|center|body|html|header|footer|main|hr|br)\b[^>]*>|\n/gi;

interface Line { start: number; end: number; text: string }

const lineText = (raw: string): string =>
  raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;| /g, ' ')
    .replace(/\*\*|__/g, '')
    .replace(new RegExp(`${FILL}+`, 'g'), '▯')
    .replace(/^[\s#>*+-]+/, '')
    .trim()
    .normalize('NFC');

const splitLines = (mask: string): Line[] => {
  const lines: Line[] = [];
  const push = (start: number, end: number) => {
    const text = lineText(mask.slice(start, end));
    if (text) lines.push({ start, end, text });
  };
  let last = 0;
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(mask))) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, mask.length);
  return lines;
};

/** Lùi qua khoảng trắng và các thẻ mở liền trước để khối câu chứa cả thẻ bọc (<p>, <div …>). */
const backtrackOpenTags = (mask: string, pos: number): number => {
  let p = pos;
  for (;;) {
    let q = p;
    while (q > 0 && /\s/.test(mask[q - 1])) q--;
    if (q === 0 || mask[q - 1] !== '>') return p;
    const open = mask.lastIndexOf('<', q - 1);
    if (open < 0) return p;
    const tag = mask.slice(open, q);
    if (/^<\//.test(tag) || /\/>$/.test(tag) || /^<(?:br|hr|img|meta|link|input|body|html|head)\b/i.test(tag)) return p;
    p = open;
  }
};

const VOID_TAG = /^(?:br|hr|img|meta|link|input|col|area|base|embed|source|wbr)$/i;

/** Vị trí thẻ đóng đầu tiên không có thẻ mở trong đoạn [from, to); không có thì trả về to. */
const firstUnmatchedClose = (mask: string, from: number, to: number): number => {
  const re = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
  re.lastIndex = from;
  const stack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(mask)) && m.index < to) {
    const name = m[2].toLowerCase();
    if (VOID_TAG.test(name) || m[3]) continue;
    if (!m[1]) {
      stack.push(name);
      continue;
    }
    const i = stack.lastIndexOf(name);
    if (i < 0) return m.index;
    stack.length = i;
  }
  return to;
};

/* ---------------------------- Nhận diện phương án / ý ---------------------------- */

const LINE_START_BEFORE = /(?:^|\n|<br\s*\/?>|<\/?(?:p|div|li|td|th|tr|ul|ol|h[1-6]|blockquote)\b[^>]*>)[ \t]*(?:[-*+][ \t]+)?$/i;
const GAP_BEFORE = /(?:[ \t ]{2,}|\t|&nbsp;[ \t]*)$/;

const WRAP_OPEN = '(?:<(?:strong|b|i|em|u|span)\\b[^>]*>|\\*\\*|__|\\*)*';
const WRAP_CLOSE = '(?:\\s*</(?:strong|b|i|em|u|span)>|\\*\\*|__|\\*(?!\\*))*';

const findLabels = (mask: string, start: number, end: number, letters: string[], loose: boolean): Array<{ labelStart: number; labelEnd: number }> | null => {
  const re = new RegExp(`(${WRAP_OPEN})\\s*([${letters.join('')}])([.)])(${WRAP_CLOSE})(?=[\\s<${FILL}]|&nbsp;|$)`, 'g');
  re.lastIndex = start;
  const found: Array<{ labelStart: number; labelEnd: number }> = [];
  let m: RegExpExecArray | null;
  while (found.length < letters.length && (m = re.exec(mask)) && m.index < end) {
    if (m[2] !== letters[found.length]) continue;
    const labelStart = m.index + (m[0].length - m[0].trimStart().length);
    const before = mask.slice(Math.max(start, labelStart - 300), labelStart);
    const atStart = LINE_START_BEFORE.test(before) || GAP_BEFORE.test(before);
    if (!atStart && !(loose && /\s$/.test(before))) continue;
    found.push({ labelStart, labelEnd: m.index + m[0].length });
  }
  return found.length === letters.length ? found : null;
};

/** Điểm kết thúc nội dung một phương án: trước thẻ đóng khung chứa, bỏ khoảng trắng / <br> / thẻ mở thừa ở cuối. */
const trimContentEnd = (mask: string, from: number, to: number): number => {
  let s = mask.slice(from, to);
  for (;;) {
    const next = s
      .replace(/(?:\s| |&nbsp;)+$/, '')
      .replace(/<br\s*\/?>$/i, '')
      .replace(/<(?!\/)[^>]*>$/, '')
      .replace(/(?:^|[^*])\*\*$/, x => x.slice(0, -2));
    if (next === s) break;
    s = next;
  }
  return from + s.length;
};

const buildSlots = (mask: string, start: number, end: number, letters: string[]): Slot[] | null => {
  const labels = findLabels(mask, start, end, letters, false) || findLabels(mask, start, end, letters, true);
  if (!labels) return null;
  const slots: Slot[] = labels.map((l, i) => {
    let contentStart = l.labelEnd;
    while (contentStart < end && /[ \t ]/.test(mask[contentStart])) contentStart++;
    const isLast = i === labels.length - 1;
    let limit = isLast ? end : labels[i + 1].labelStart;
    if (isLast) {
      // Phương án cuối: hết dòng là hết (tránh nuốt ngữ liệu / chữ phía sau câu)
      const lineEnd = new RegExp(BLOCK_RE.source, 'gi');
      lineEnd.lastIndex = contentStart;
      let m: RegExpExecArray | null;
      while ((m = lineEnd.exec(mask)) && m.index < end) {
        if (lineText(mask.slice(contentStart, m.index))) {
          limit = m.index;
          break;
        }
      }
    }
    const close = firstUnmatchedClose(mask, contentStart, limit);
    return { labelStart: l.labelStart, contentStart, contentEnd: trimContentEnd(mask, contentStart, close) };
  });
  return slots.every(s => s.contentEnd > s.contentStart) ? slots : null;
};

/* ---------------------------- Đọc đề ---------------------------- */

const HET_RE = /^(?:HẾT|Hết)\b/;
const OPTION_LINE_RE = /^[A-D]\s*[.)]/;
const STATEMENT_LINE_RE = /^[a-d]\s*[.)]/;
const LEADIN_RE = /(?:trả\s*lời|dùng|sử\s*dụng|dựa\s*vào|đọc|căn\s*cứ|answer|read)\b/i;
const RANGE_RE = /(?:câu|questions?)\s*(?:từ\s*)?(\d{1,3})(?:\s*(?:đến|tới|->|→|-|–|—|to|and|và|,)\s*(?:câu\s*|questions?\s*)?(\d{1,3}))?/i;
const OPTION_REF_RE = /(?:^|[\s(])(?:cả\s+(?:hai|ba|bốn|[A-D](?![A-Za-zÀ-ỹ]))|tất\s+cả|các\s+(?:đáp\s*án|phương\s*án|ý|câu)\s+(?:trên|đều)|(?:đáp\s*án|phương\s*án)\s+(?:trên|khác)|không\s+(?:có\s+)?(?:đáp\s*án|phương\s*án)|đều\s+(?:đúng|sai)|[A-D]\s*(?:và|,|hoặc)\s*[A-D](?![A-Za-zÀ-ỹ])|both|all\s+of\s+the\s+above|none\s+of\s+the\s+above|neither)/i;
const STATEMENT_REF_RE = /(?:^|[\s(])(?:ý\s+(?:[a-d](?![A-Za-zÀ-ỹ])|trên|trước)|câu\s+[a-d]\)|(?:kết\s*quả|giá\s*trị)\s+(?:ở\s+)?(?:trên|ý)|ở\s+trên|vừa\s+tìm|như\s+trên|từ\s+ý)/i;
const QUESTION_REF_RE = /(?:^|[\s(])(?:câu|question)\s+(\d{1,3})(?![\d.,]*\d)/gi;
const PREV_QUESTION_REF_RE = /(?:^|[\s(])câu\s+(?:trên|trước|liền\s+trước|vừa\s+rồi)/i;

const plainOf = (mask: string, from: number, to: number) => lineText(mask.slice(from, to));

export const parseExamForShuffle = (examSource: string, answerSource?: string): ParsedExam => {
  const source = examSource || '';
  const mask = maskSource(source);
  const lines = splitLines(mask);
  const sections: ExamSection[] = [];
  const notes: string[] = [];
  if (source.includes(TRUNCATION_MARKER)) notes.push('Đề gốc bị cắt cụt do quá dài: các mã đề có thể thiếu câu. Nên tạo lại đề trước khi đảo.');
  const makeSection = (start: number, title: string, type: QType | null): ExamSection => ({ title, type, start, questions: [], tailStart: start, end: start });

  let current: ExamSection | null = null;
  let currentQ: ExamQuestion | null = null;
  let answerStart = -1;
  let hetStart = -1;
  let bodyEndCandidate = -1;
  let sawLastOption = false;
  let optionSeen = false;
  // Ngữ liệu chen giữa các câu: thuộc câu kế tiếp, nhớ vị trí bắt đầu và nội dung
  let leadInStart = -1;
  let leadInText = '';
  const leadIns: Array<{ text: string; sectionIndex: number; beforeQuestion: number }> = [];

  const closeQuestion = (end: number) => {
    if (currentQ) currentQ.end = end;
    currentQ = null;
  };

  for (const line of lines) {
    const t = line.text;
    const optionLike = !!currentQ && !sawLastOption && (OPTION_LINE_RE.test(t) || STATEMENT_LINE_RE.test(t));

    if (currentQ || sections.some(s => s.questions.length)) {
      if (!optionLike && t.length <= 140 && ANSWER_RE.test(t)) {
        answerStart = backtrackOpenTags(mask, line.start);
        break;
      }
      if (hetStart < 0 && HET_RE.test(t)) {
        hetStart = backtrackOpenTags(mask, line.start);
        bodyEndCandidate = hetStart;
        closeQuestion(hetStart);
        continue;
      }
    }
    if (hetStart >= 0) continue;

    const pm = !optionLike && t.length <= 220 ? PART_RE.exec(t) : null;
    const em = !optionLike && !pm && t.length <= 160 ? EN_PART_RE.exec(t) : null;
    let am = !optionLike && !pm && !em && t.length <= 140 ? ALT_PART_RE.exec(t) : null;
    if (am && /^\s*[A-D]\s*[.:]/.test(t) && am[1] !== am[1].toUpperCase()) am = null;
    const essayHeading = !optionLike && !pm && !em && !am && t.length <= 120 && ESSAY_HEADING_RE.test(t) && !(/^\s*[A-D]\s*[.:]/.test(t) && !/TỰ\s*LUẬN/.test(t));

    if (pm || em || am || essayHeading) {
      const start = backtrackOpenTags(mask, line.start);
      // "Phần 1: ĐỀ THI" của đề biến thể chỉ là nhãn chung, không phải dạng câu
      const type: QType | null = /ĐỀ\s*THI/i.test(t) ? null : pm ? partTypeOf(pm[1], pm[2] || '') : am ? partTypeOf('', am[1]) : essayHeading ? 'IV' : null;
      closeQuestion(start);
      leadInStart = -1;
      leadInText = '';
      const empty: ExamSection | null = current;
      if (empty && empty.questions.length === 0) {
        empty.title = t;
        empty.type = type;
      } else {
        if (empty) empty.end = start;
        current = makeSection(start, t, type);
        sections.push(current);
      }
      sawLastOption = false;
      optionSeen = false;
      continue;
    }

    const qm = QUESTION_RE.exec(t);
    if (qm) {
      const labelStart = backtrackOpenTags(mask, line.start);
      const blockStart = leadInStart >= 0 ? leadInStart : labelStart;
      closeQuestion(blockStart);
      if (!current) {
        current = makeSection(blockStart, '', null);
        sections.push(current);
      }
      const raw = mask.slice(line.start, line.end);
      const nm = /(?:Câu|Question)\s+(\d{1,3})/i.exec(raw);
      const numPos = line.start + (nm ? nm.index + nm[0].length - nm[1].length : 0);
      const q: ExamQuestion = {
        num: parseInt(qm[1], 10), kind: 'essay', start: blockStart, end: blockStart,
        numPos, numLen: nm ? nm[1].length : 0, slots: null, keepInner: false, pinned: false,
        sectionIndex: sections.length - 1,
      };
      if (leadInText) leadIns.push({ text: leadInText, sectionIndex: sections.length - 1, beforeQuestion: current.questions.length });
      leadInStart = -1;
      leadInText = '';
      current.questions.push(q);
      currentQ = q;
      sawLastOption = false;
      optionSeen = false;
      // Phương án có thể nằm ngay trên dòng câu hỏi
      if (/(?:^|\s)D\s*[.)]\s/.test(t) || /(?:^|\s)d\s*\)\s/.test(t)) sawLastOption = true;
      continue;
    }

    if (currentQ) {
      if (/^[Dd]\s*[.)]/.test(t)) sawLastOption = true;
      if (OPTION_LINE_RE.test(t) || STATEMENT_LINE_RE.test(t)) {
        optionSeen = true;
        continue;
      }
      // Chữ xuất hiện sau khi đã đủ phương án, hoặc câu dẫn "Dùng thông tin… trả lời câu X, Y" → thuộc câu sau
      const isIntro = LEADIN_RE.test(t) && RANGE_RE.test(t);
      const lettersCount = (t.match(/[A-Za-zÀ-ỹ]/g) || []).length;
      if (leadInStart < 0 && lettersCount >= 8 && ((sawLastOption && optionSeen) || isIntro)) {
        leadInStart = backtrackOpenTags(mask, line.start);
        leadInText = t;
      } else if (leadInStart >= 0) {
        leadInText += ' ' + t;
      }
    }
  }

  // Bỏ đường kẻ, dòng trống, ngắt trang đứng ngay trước phần đáp án
  const trimBeforeAnswer = (end: number): number => {
    let e = end;
    for (;;) {
      const from = Math.max(0, e - 2000);
      const m = /(?:\s+|<hr\b[^>]*>|<br\s*\/?>|\n[ \t]*(?:-{3,}|\*{3,})[ \t]*|<div\b[^>]*page-break[^>]*>\s*<\/div>)$/i.exec(mask.slice(from, e));
      if (!m || m[0].length === 0) return e;
      e = from + m.index;
    }
  };
  const docEnd = answerStart >= 0 ? trimBeforeAnswer(answerStart) : source.length;
  const bodyEnd = bodyEndCandidate >= 0 ? bodyEndCandidate : docEnd;

  const bodyClose = /<\/body>\s*<\/html>\s*$/i.exec(source);
  const footer = bodyEndCandidate >= 0
    ? source.slice(bodyEndCandidate, docEnd)
    : answerStart < 0 ? source.slice(bodyEnd) : '';
  const footerWithClose = answerStart >= 0 && bodyClose ? `${footer}${bodyClose[0]}` : footer;

  if (currentQ) (currentQ as ExamQuestion).end = bodyEnd;
  const withQuestions = sections.filter(s => s.questions.length);

  // Hoàn thiện từng phần: mốc cuối, dạng câu, phương án
  const allQuestions: ExamQuestion[] = [];
  withQuestions.forEach((sec, si) => {
    const next = withQuestions[si + 1];
    sec.end = next ? next.start : bodyEnd;
    sec.questions.forEach((q, qi) => {
      q.sectionIndex = si;
      const nextQ = sec.questions[qi + 1];
      q.end = nextQ ? nextQ.start : sec.end;
    });
    const last = sec.questions[sec.questions.length - 1];
    last.end = firstUnmatchedClose(mask, last.start, last.end);
    sec.tailStart = last.end;

    for (const q of sec.questions) {
      const mcSlots = sec.type !== 'II' ? buildSlots(mask, q.numPos, q.end, MC_LETTERS) : null;
      const tfSlots = !mcSlots ? buildSlots(mask, q.numPos, q.end, TF_LETTERS) : null;
      if (mcSlots && sec.type !== 'IV') {
        q.kind = 'mc';
        q.slots = mcSlots;
      } else if (tfSlots && sec.type !== 'IV') {
        q.kind = 'tf';
        q.slots = tfSlots;
      } else if (sec.type === 'I') {
        q.kind = 'mc';
        notes.push(`Phần "${sec.title}", câu ${q.num}: không nhận đủ 4 phương án A–D → giữ nguyên thứ tự phương án.`);
      } else if (sec.type === 'II') {
        q.kind = 'tf';
        notes.push(`Phần "${sec.title}", câu ${q.num}: không nhận đủ 4 ý a–d → giữ nguyên thứ tự các ý.`);
      } else if (sec.type === 'III') {
        q.kind = 'short';
      } else {
        // Chưa rõ trả lời ngắn hay tự luận → quyết định sau khi đọc đáp án
        q.kind = 'essay';
      }
      if (q.slots) {
        const inner = q.slots.map(s => plainOf(mask, s.contentStart, s.contentEnd)).join(' \n ');
        if (q.kind === 'mc' && OPTION_REF_RE.test(inner)) q.keepInner = true;
        if (q.kind === 'tf' && STATEMENT_REF_RE.test(inner)) q.keepInner = true;
      }
      if (q.kind === 'essay') q.pinned = true;
    }

    // Câu nhắc tới câu khác → giữ nguyên vị trí cả hai
    const byNum = new Map(sec.questions.map(q => [q.num, q]));
    sec.questions.forEach((q, i) => {
      const text = plainOf(mask, q.numPos + q.numLen, q.end);
      for (const r of text.matchAll(QUESTION_REF_RE)) {
        const target = byNum.get(parseInt(r[1], 10));
        if (target && target !== q) {
          q.pinned = true;
          target.pinned = true;
        }
      }
      if (PREV_QUESTION_REF_RE.test(text) && i > 0) {
        q.pinned = true;
        sec.questions[i - 1].pinned = true;
      }
    });

    allQuestions.push(...sec.questions);
  });

  // Ngữ liệu dùng chung: giữ nguyên các câu liên quan; không xác định được phạm vi thì giữ cả phần
  const pinRange = (sec: ExamSection, from: number, to: number) => {
    const covered = sec.questions.filter(q => q.num >= from && q.num <= to);
    if (covered.length === sec.questions.length) return;
    covered.forEach(q => { q.pinned = true; });
  };
  for (const li of leadIns) {
    const sec = sections[li.sectionIndex];
    if (!sec || !withQuestions.includes(sec)) continue;
    const r = RANGE_RE.exec(li.text);
    const firstNum = sec.questions[li.beforeQuestion]?.num;
    if (r) {
      pinRange(sec, parseInt(r[1], 10), r[2] ? parseInt(r[2], 10) : parseInt(r[1], 10));
      if (firstNum !== undefined) sec.questions[li.beforeQuestion].pinned = true;
    } else {
      sec.questions.forEach(q => { q.pinned = true; });
      notes.push(`Phần "${sec.title || 'đề thi'}" có ngữ liệu dùng chung chưa rõ phạm vi → giữ nguyên thứ tự câu của phần này.`);
    }
  }
  // Câu dẫn nằm giữa tiêu đề phần và câu đầu tiên ("Đọc đoạn văn và trả lời câu 1 đến câu 3")
  for (const sec of withQuestions) {
    const intro = plainOf(mask, sec.start, sec.questions[0].numPos);
    const stripped = intro.replace(/^.*?(?:\n|$)/, '');
    if (LEADIN_RE.test(stripped) && !/^\s*thí\s*sinh/i.test(stripped)) {
      const r = RANGE_RE.exec(stripped);
      if (r && r[2]) pinRange(sec, parseInt(r[1], 10), parseInt(r[2], 10));
    }
  }

  const answerText = answerSource && answerSource.trim() ? answerSource : answerStart >= 0 ? source.slice(answerStart) : '';
  const { answers, conflicts } = parseAnswerKey(answerText, allQuestions);

  // Câu chưa rõ dạng: có đáp án ngắn → trả lời ngắn, còn lại là tự luận
  for (const q of allQuestions) {
    if (q.kind === 'essay' && withQuestions[q.sectionIndex].type !== 'IV' && answers.short[q.num] !== undefined) {
      q.kind = 'short';
      q.pinned = false;
    }
  }

  return {
    source,
    isHtml: /<\/?(?:p|div|span|table|html|body)\b/i.test(source),
    bodyStart: withQuestions[0]?.start ?? 0,
    bodyEnd,
    footer: footerWithClose,
    sections: withQuestions,
    questions: allQuestions,
    answers,
    conflicts,
    notes,
  };
};

/* ---------------------------- Đọc đáp án ---------------------------- */

const clean = (s: string) => s.replace(/\*\*|__/g, '').replace(/^\*+|\*+$/g, '').replace(/\s+/g, ' ').trim().normalize('NFC');

const parseMc = (v: string): string | null => {
  const m = /^\(?([A-D])\)?\.?$/.exec(clean(v));
  return m ? m[1] : null;
};

/** Đ/S cho một ý */
const parseTfValue = (v: string): string | null => {
  const s = clean(v).replace(/[.,;:]$/, '').toLowerCase();
  if (s === 'đ' || s === 'đúng') return 'Đ';
  if (s === 's' || s === 'sai') return 'S';
  return null;
};

/** "Đ S Đ S", "ĐSĐS", "a) Đ, b) S, c) Đ, d) S", "Đúng - Sai - Đúng - Sai" → 4 giá trị */
const parseTfFour = (v: string): string[] | null => {
  const s = clean(v).toLowerCase().replace(/\b[a-d]\s*[.):]\s*/g, ' ');
  const tokens = s.match(/đúng|sai|đ|s/g);
  if (!tokens || tokens.length !== 4) return null;
  if (s.replace(/đúng|sai|đ|s/g, '').replace(/[\s,;:.\-–—/|]/g, '')) return null;
  return tokens.map(t => (t === 'đ' || t === 'đúng' ? 'Đ' : 'S'));
};

const numOf = (cell: string): { num: number; part?: QType } | null => {
  const s = clean(cell);
  const roman = /^(IV|III|II|I)\s*[.\-]\s*(\d{1,3})$/.exec(s);
  if (roman) return { num: parseInt(roman[2], 10), part: roman[1] as QType };
  const m = /^(?:câu\s*)?(\d{1,3})\s*[.:)]?$/i.exec(s);
  return m ? { num: parseInt(m[1], 10) } : null;
};

/**
 * Đáp án ghi ngay sau tiêu đề phần trên cùng một dòng ("PHẦN I. 1.B, 2.D", "PHẦN III. 17. 10; 18. 3,5").
 * `body` là phần chữ sau tiêu đề; trả về các đoạn đáp án, hoặc [] nếu dòng chỉ là tiêu đề
 * (ví dụ "PHẦN I. TRẮC NGHIỆM (24 CÂU, 6 ĐIỂM)" hay "Trả lời ngắn (mỗi câu 0.5 điểm)").
 */
const inlineAnswerSegments = (body: string, part: QType | null): string[] => {
  const shortNum = String.raw`\d{1,3}(?:\s*[:)]\s*|\s*\.\s+)`;
  const start =
    part === 'II' ? /(?:Câu\s*)?\d{1,3}\s*[.:)\-–]\s*(?:[a-d]\s*[.)]\s*)?(?:Đúng|Sai|Đ|S)(?=$|[\s,;|.)ĐS])/i :
    part === 'III' ? new RegExp(String.raw`(?:^|\s)(?:Câu\s*)?${shortNum}-?\d+(?:[.,]\d+)?(?=$|\s*[;|,]|\s+(?:Câu\s*)?\d)`, 'i') :
    part === 'IV' ? null :
    /(?:Câu\s*)?\d{1,3}\s*[.:\-–)]?\s*[A-D](?=$|[\s,;|.)])/;
  const at = start ? body.search(start) : -1;
  if (at < 0) return [];
  let answers = body.slice(at).trim();
  // Đưa cả "17. 10" lẫn "Câu 17. 10" về dạng "Câu 17: 10" như các dòng đáp án khác
  if (part === 'II' || part === 'III') answers = answers.replace(/Câu\s*(?=\d)/gi, '');
  if (part === 'II') answers = answers.replace(/(^|[;|,]\s*|\s)(\d{1,3})\s*[.:)\-–]\s*(?=[ĐSđs]|[a-d]\s*[.)])/g, '$1Câu $2: ');
  if (part === 'III') answers = answers.replace(new RegExp(String.raw`(^|[;|,]\s+|\s)(\d{1,3})(?:\s*[:)]\s*|\s*\.\s+)(?=-?\d)`, 'g'), '$1Câu $2: ');
  return answers.split(/(?=Câu\s*\d)/i).map(s => s.replace(/[\s;,|]+$/, '')).filter(Boolean);
};

export const parseAnswerKey = (text: string, questions: ExamQuestion[]): { answers: AnswerBook; conflicts: string[] } => {
  const answers: AnswerBook = { mc: {}, tf: {}, short: {} };
  const conflicts: string[] = [];
  if (!text) return { answers, conflicts };

  const has = (kinds: QKind[], num: number) => questions.some(q => q.num === num && kinds.includes(q.kind));

  const setMc = (num: number, v: string) => {
    const old = answers.mc[num];
    if (old && old !== v) conflicts.push(`Trắc nghiệm câu ${num}: phần đáp án ghi cả ${old} và ${v}`);
    if (!old) answers.mc[num] = v;
  };
  const setTf = (num: number, letter: TfLetter, v: string) => {
    const row = (answers.tf[num] = answers.tf[num] || {});
    if (row[letter] && row[letter] !== v) conflicts.push(`Đúng – Sai câu ${num} ý ${letter}): phần đáp án ghi cả ${row[letter]} và ${v}`);
    if (!row[letter]) row[letter] = v;
  };
  const setTfAll = (num: number, vals: string[]) => vals.forEach((v, i) => setTf(num, TF_LETTERS[i], v));
  const setShort = (num: number, v: string) => {
    const val = v.trim().replace(/\.$/, '');
    if (!val) return;
    const old = answers.short[num];
    if (old && old.replace(/\s/g, '') !== val.replace(/\s/g, '')) conflicts.push(`Trả lời ngắn câu ${num}: phần đáp án ghi cả ${old} và ${val}`);
    if (!old) answers.short[num] = val;
  };

  let ctx: QType | null = null;
  const canShort = (num: number, value: string, part: QType | null) =>
    value.length <= 60 && (part === 'III' || (part === null && has(['short', 'essay'], num) && !has(['mc', 'tf'], num)));

  const assign = (num: number, value: string, part: QType | null) => {
    if (part === 'IV') return;
    const mc = parseMc(value);
    if (mc && part !== 'II' && part !== 'III') return setMc(num, mc);
    const four = part !== 'I' ? parseTfFour(value) : null;
    if (four) return setTfAll(num, four);
    if (part !== 'I' && part !== 'II' && canShort(num, clean(value), part)) setShort(num, clean(value));
  };

  const handleTable = (rows: string[][]) => {
    if (!rows.length) return;
    const header = rows[0].map(c => clean(c).toLowerCase());
    const col = (re: RegExp) => header.findIndex(h => re.test(h));
    const colAns = col(/đáp\s*án|đáp\s*số|kết\s*quả|answer|key/);
    const colY = col(/^ý$|^ý\s*\(|^mệnh\s*đề$/);
    const colsAbcd = TF_LETTERS.map(l => col(new RegExp(`^(?:ý\\s*)?${l}\\s*\\)?$`)));

    if (colsAbcd.every(c => c >= 0)) {
      for (const row of rows.slice(1)) {
        const n = numOf(row[0] || '');
        if (!n) continue;
        TF_LETTERS.forEach((l, i) => {
          const v = parseTfValue(row[colsAbcd[i]] || '');
          if (v) setTf(n.num, l, v);
        });
      }
      return;
    }
    if (colY >= 0) {
      const valueCol = colAns >= 0 ? colAns : colY + 1;
      for (const row of rows.slice(1)) {
        const n = numOf(row[0] || '');
        const y = /^([a-d])\s*[.)]?$/.exec(clean(row[colY] || ''));
        const v = parseTfValue(row[valueCol] || '');
        if (n && y && v) setTf(n.num, y[1] as TfLetter, v);
      }
      return;
    }
    // Bảng ngang: hàng số câu + hàng đáp án
    let horizontal = false;
    for (let r = 0; r + 1 < rows.length; r++) {
      const row = rows[r];
      const nums = row.map(numOf);
      const numeric = nums.slice(1).filter(Boolean).length;
      if (numeric < 2 || numeric < row.length - 2) continue;
      horizontal = true;
      const vals = rows[r + 1];
      nums.forEach((n, c) => {
        if (n && vals[c] !== undefined) assign(n.num, vals[c], n.part || ctx);
      });
      r++;
    }
    if (horizontal) return;
    // Bảng dọc: Câu | Đáp án | …
    const valueCol = colAns >= 0 ? colAns : 1;
    for (const row of rows.slice(colAns >= 0 || !numOf(rows[0][0] || '') ? 1 : 0)) {
      const first = clean(row[0] || '');
      const pair = /^(?:câu\s*)?(\d{1,3})\s*[.\-]?\s*([a-d])\s*\)?$/i.exec(first);
      if (pair) {
        const v = parseTfValue(row[valueCol] || '');
        if (v) setTf(parseInt(pair[1], 10), pair[2].toLowerCase() as TfLetter, v);
        continue;
      }
      const n = numOf(first);
      if (n && row[valueCol] !== undefined) assign(n.num, row[valueCol], n.part || ctx);
    }
  };

  let currentNum: number | null = null;
  const handleLine = (rawLine: string) => {
    const line = clean(rawLine);
    if (!line) return;

    // Tiêu đề nhóm đáp án
    const stripped = line.replace(/^#+\s*/, '');
    const pm = PART_RE.exec(stripped);
    // Tiêu đề phần kèm cả dãy đáp án có thể dài hơn 120 ký tự
    if ((line.length <= 120 || pm) && !/^câu\s*\d/i.test(line)) {
      let type: QType | null | undefined;
      if (/đúng\s*[-–\/]?\s*sai|\bĐ\s*\/\s*S\b/i.test(stripped)) type = 'II';
      else if (/trả\s*lời\s*ngắn/i.test(stripped)) type = 'III';
      else if (/tự\s*luận/i.test(stripped)) type = 'IV';
      else if (/nhiều\s*(?:phương\s*án|lựa\s*chọn)|4\s*(?:phương\s*án|lựa\s*chọn)/i.test(stripped)) type = 'I';
      // "Phần 2: ĐÁP ÁN & HƯỚNG DẪN GIẢI" của đề biến thể là nhãn chung, không phải Phần II Đúng – Sai
      else if (/lời\s*giải\s*chi\s*tiết|hướng\s*dẫn\s*giải/i.test(stripped) || (pm && /^(?:đáp\s*án|hướng\s*dẫn|lời\s*giải)/i.test(pm[2] || ''))) type = null;
      else if (pm) type = partTypeOf(pm[1], pm[2] || '');
      if (type !== undefined) {
        const inline = inlineAnswerSegments(pm ? pm[2] || '' : stripped, type);
        if (inline.length) {
          ctx = type;
          currentNum = null;
          inline.forEach(handleLine);
          return;
        }
        if (line.length <= 120) {
          ctx = type;
          currentNum = null;
          if (pm || /^(?:#+\s*)?(?:\d+[.)]|[IVX]+[.)])/.test(line) || line.length <= 60) return;
        }
      }
    }

    // "Câu 1: A | Câu 2: B", "1.A, 2.B", "1A 2B"
    if (ctx !== 'II' && ctx !== 'III' && ctx !== 'IV') {
      const pairs = [...line.matchAll(/(?:Câu\s*)?(\d{1,3})\s*[.:\-–)]?\s*([A-D])(?=$|[\s,;|.)])/g)];
      if (pairs.length) {
        const rest = line
          .replace(/(?:Câu\s*)?(\d{1,3})\s*[.:\-–)]?\s*([A-D])(?=$|[\s,;|.)])/g, '')
          .replace(/Đáp án|Chọn|Câu|Phần\s*\w*/gi, '')
          .replace(/[|,;.:()\s\-–]/g, '');
        if (rest.length < 3) {
          pairs.forEach(p => setMc(parseInt(p[1], 10), p[2]));
          return;
        }
      }
    }

    const qm = /^Câu\s*(\d{1,3})\s*(?:\([^)]*\))?\s*[.:\-–)]?\s*(.*)$/i.exec(line);
    const rest = qm ? qm[2] : line;
    if (qm) currentNum = parseInt(qm[1], 10);
    if (currentNum === null) return;
    const num = currentNum;

    // Đúng – Sai
    if (ctx !== 'I' && ctx !== 'III' && ctx !== 'IV') {
      if (qm) {
        const four = parseTfFour(rest);
        if (four) return setTfAll(num, four);
      }
      if (ctx === 'II' || has(['tf'], num)) {
        for (const m of rest.matchAll(/(?:^|[\s,;(])([a-d])\s*[.)]\s*(Đúng|Sai|Đ|S)(?=$|[\s,.;:)|\-–])/g)) {
          setTf(num, m[1] as TfLetter, m[2] === 'Đ' || m[2] === 'Đúng' ? 'Đ' : 'S');
        }
      }
    }

    // "Chọn B", "Đáp án: B" trong lời giải
    if (ctx !== 'II' && ctx !== 'III' && ctx !== 'IV') {
      const choose = /(?:^|[\s.(])(?:[Cc]họn|[Đđ]áp án(?:\s+đúng)?(?:\s+là)?)\s*[:.]?\s*([A-D])(?=$|[\s,.;)])/.exec(rest);
      if (choose && (ctx === 'I' || has(['mc'], num))) return setMc(num, choose[1]);
    }

    // Trả lời ngắn
    if (ctx === 'III' || (ctx === null && has(['short', 'essay'], num) && !has(['mc', 'tf'], num))) {
      for (const seg of line.split('|')) {
        const sm = /^\s*(?:Câu\s*(\d{1,3})\s*[.:\-–)]?\s*)?(.*)$/i.exec(seg);
        if (!sm) continue;
        const segNum = sm[1] ? parseInt(sm[1], 10) : num;
        const labelled = /(?:Đáp số|Đáp án|Kết quả|ĐS)\s*(?:là)?\s*[:=]?\s*(.+?)\s*\.?$/i.exec(sm[2]);
        if (labelled) setShort(segNum, labelled[1]);
        else if (ctx === 'III' && sm[1] && sm[2].trim().length <= 24) setShort(segNum, sm[2]);
      }
    }
  };

  const handleText = (chunk: string) => {
    const lines = htmlToText(chunk).split('\n');
    let table: string[][] = [];
    const flush = () => {
      if (table.length) handleTable(table);
      table = [];
    };
    for (const l of lines) {
      if (/^\s*\|.*\|\s*$/.test(l)) {
        if (!/^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(l)) {
          table.push(l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
        }
        continue;
      }
      flush();
      handleLine(l);
    }
    flush();
  };

  let pos = 0;
  for (const t of findTopLevelTables(text)) {
    handleText(text.slice(pos, t.start));
    const { grid, nRows, nCols } = tableToGrid(t.html);
    const rows: string[][] = [];
    for (let r = 0; r < nRows; r++) {
      const row: string[] = [];
      for (let c = 0; c < nCols; c++) row.push(grid[r]?.[c]?.text || '');
      rows.push(row);
    }
    handleTable(rows);
    pos = t.end;
  }
  handleText(text.slice(pos));

  return { answers, conflicts: Array.from(new Set(conflicts)) };
};

/** Các câu còn thiếu đáp án (để hiện cho giáo viên). */
export const missingAnswers = (exam: ParsedExam, answers: AnswerBook = exam.answers): string[] => {
  const out: string[] = [];
  for (const q of exam.questions) {
    if (q.kind === 'mc' && !answers.mc[q.num]) out.push(`Trắc nghiệm câu ${q.num}`);
    if (q.kind === 'tf') {
      const row = answers.tf[q.num] || {};
      if (TF_LETTERS.some(l => !row[l])) out.push(`Đúng – Sai câu ${q.num}`);
    }
    if (q.kind === 'short' && !answers.short[q.num]) out.push(`Trả lời ngắn câu ${q.num}`);
  }
  return out;
};

/* ---------------------------- Sinh mã đề ---------------------------- */

/** Bộ sinh số có hạt giống (kiểm thử lặp lại được). */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const shuffleInPlace = <T,>(arr: T[], rng: () => number): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/** Hoán vị khác thứ tự gốc (khi có thể). */
const derange = (n: number, rng: () => number): number[] => {
  const base = Array.from({ length: n }, (_x, i) => i);
  for (let tries = 0; tries < 12; tries++) {
    const p = shuffleInPlace([...base], rng);
    if (n < 2 || p.some((v, i) => v !== i)) return p;
  }
  return base;
};

interface QuestionPlan { question: ExamQuestion; slotNum: number; innerPerm: number[] | null }

const planSection = (sec: ExamSection, opts: ShuffleOptions, rng: () => number): QuestionPlan[] => {
  const order: ExamQuestion[] = [...sec.questions];
  if (opts.shuffleQuestions) {
    // Chỉ đảo trong các đoạn liền nhau cùng dạng; câu ghim giữ nguyên chỗ
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].kind === order[i].kind) j++;
      const free: number[] = [];
      for (let k = i; k <= j; k++) if (!order[k].pinned) free.push(k);
      const perm = derange(free.length, rng);
      const picked = free.map(k => sec.questions[k]);
      free.forEach((k, idx) => { order[k] = picked[perm[idx]]; });
      i = j + 1;
    }
  }
  return order.map((question, idx) => {
    const allowed = question.kind === 'mc' ? opts.shuffleOptions : question.kind === 'tf' ? opts.shuffleStatements : false;
    return {
      question,
      slotNum: sec.questions[idx].num,
      innerPerm: allowed && question.slots && !question.keepInner ? derange(question.slots.length, rng) : null,
    };
  });
};

const renderQuestion = (exam: ParsedExam, plan: QuestionPlan): string => {
  const { question: q, slotNum, innerPerm } = plan;
  const src = exam.source;
  const edits: Array<{ pos: number; len: number; text: string }> = [];
  if (q.numLen) edits.push({ pos: q.numPos, len: q.numLen, text: String(slotNum) });
  if (innerPerm && q.slots) {
    q.slots.forEach((slot, i) => {
      const from = q.slots![innerPerm[i]];
      edits.push({ pos: slot.contentStart, len: slot.contentEnd - slot.contentStart, text: src.slice(from.contentStart, from.contentEnd) });
    });
  }
  edits.sort((a, b) => a.pos - b.pos);
  let out = '';
  let cursor = q.start;
  for (const e of edits) {
    out += src.slice(cursor, e.pos) + e.text;
    cursor = e.pos + e.len;
  }
  return out + src.slice(cursor, q.end);
};

const answerOf = (plan: QuestionPlan, answers: AnswerBook): string => {
  const { question: q, innerPerm } = plan;
  if (q.kind === 'mc') {
    const orig = answers.mc[q.num];
    if (!orig) return '';
    const origIdx = MC_LETTERS.indexOf(orig);
    if (!innerPerm) return orig;
    return MC_LETTERS[innerPerm.indexOf(origIdx)] || '';
  }
  if (q.kind === 'tf') {
    const row = answers.tf[q.num] || {};
    return TF_LETTERS.map((_l, i) => row[TF_LETTERS[innerPerm ? innerPerm[i] : i]] || '?').join(' ');
  }
  if (q.kind === 'short') return answers.short[q.num] || '';
  return '';
};

const insertCode = (prefix: string, code: string, isHtml: boolean): string => {
  const existing = /(Mã\s*đề(?:\s*thi)?\s*[:：]?\s*)([\d.…_\-xX]*)/i;
  if (existing.test(prefix)) return prefix.replace(existing, (_m, label: string) => `${label}${code}`);
  return isHtml
    ? `${prefix}<p style="text-align:right;font-weight:bold;">Mã đề: ${code}</p>\n`
    : `${prefix}\n\n**Mã đề: ${code}**\n\n`;
};

/** Sinh các mã đề. Mọi mã đề cố gắng khác nhau và khác đề gốc. */
export const generateExamVersions = (
  exam: ParsedExam,
  answers: AnswerBook,
  opts: ShuffleOptions,
  seed: number = Date.now() & 0x7fffffff
): ExamVersion[] => {
  const rng = mulberry32(seed);
  const seen = new Set<string>();
  const versions: ExamVersion[] = [];
  for (let v = 0; v < opts.count; v++) {
    let plans: QuestionPlan[][] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      plans = exam.sections.map(sec => planSection(sec, opts, rng));
      const signature = plans.flat().map(p => `${p.question.num}:${p.innerPerm?.join('') ?? ''}`).join('|');
      if (!seen.has(signature)) {
        seen.add(signature);
        break;
      }
    }
    const code = String(opts.startCode + v);
    const body = exam.sections
      .map((sec, si) => exam.source.slice(sec.start, sec.questions[0].start) + plans[si].map(p => renderQuestion(exam, p)).join('') + exam.source.slice(sec.tailStart, sec.end))
      .join('');
    const prefix = insertCode(exam.source.slice(0, exam.bodyStart), code, exam.isHtml);
    versions.push({
      code,
      content: prefix + body + exam.footer,
      questions: plans.flat().map(p => ({ num: p.slotNum, originalNum: p.question.num, kind: p.question.kind, answer: answerOf(p, answers) })),
    });
  }
  return versions;
};

/* ---------------------------- File đáp án ---------------------------- */

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KIND_TITLE: Record<Exclude<QKind, 'essay'>, string> = {
  mc: 'Trắc nghiệm nhiều phương án lựa chọn',
  tf: 'Trắc nghiệm Đúng – Sai (thứ tự các ý a, b, c, d)',
  short: 'Trắc nghiệm trả lời ngắn',
};
const CODES_PER_TABLE = 8;

/** Giữ nguyên công thức trong đáp án; chỉ escape phần chữ. */
const answerCell = (s: string) => (s ? (/\$/.test(s) ? s : escHtml(s)) : '<span style="color:#c00;font-weight:bold;">?</span>');

const keyTables = (versions: ExamVersion[], kind: QKind, cell: (q: VersionQuestion) => string): string => {
  const parts: string[] = [];
  for (let i = 0; i < versions.length; i += CODES_PER_TABLE) {
    const group = versions.slice(i, i + CODES_PER_TABLE);
    const rows = group[0].questions.filter(q => q.kind === kind);
    const head = group.map(v => `<th>${v.code}</th>`).join('');
    const body = rows
      .map((row, r) => {
        const cells = group.map(v => `<td class="center" style="text-align:center;">${cell(v.questions.filter(q => q.kind === kind)[r])}</td>`).join('');
        return `<tr><td class="center" style="text-align:center;">${row.num}</td>${cells}</tr>`;
      })
      .join('');
    parts.push(`<table class="answer-table" border="1" cellspacing="0" cellpadding="5"><thead><tr><th>Câu \\ Mã đề</th>${head}</tr></thead><tbody>${body}</tbody></table>`);
  }
  return parts.join('\n');
};

/** Nội dung HTML của file đáp án theo mã đề. */
export const buildAnswerKeyDocument = (exam: ParsedExam, versions: ExamVersion[], title: string): string => {
  const has = (k: QKind) => exam.questions.some(q => q.kind === k);
  let section = 0;
  const roman = ['I', 'II', 'III', 'IV', 'V'];
  const blocks: string[] = [];
  for (const kind of ['mc', 'tf', 'short'] as const) {
    if (!has(kind)) continue;
    blocks.push(`<h3>${roman[section++]}. ${KIND_TITLE[kind]}</h3>`);
    blocks.push(keyTables(versions, kind, q => answerCell(q.answer)));
  }
  if (has('essay')) {
    blocks.push(`<h3>${roman[section++]}. Tự luận</h3><p>Phần tự luận giữ nguyên như đề gốc ở mọi mã đề. Xem hướng dẫn chấm của đề gốc.</p>`);
  }
  const mapping: string[] = [];
  for (const kind of ['mc', 'tf', 'short'] as const) {
    if (!has(kind)) continue;
    mapping.push(`<p><strong>${KIND_TITLE[kind].split(' (')[0]}</strong></p>`);
    mapping.push(keyTables(versions, kind, q => String(q.originalNum)));
  }
  blocks.push(`<h3>${roman[section++]}. Đối chiếu với đề gốc</h3><p>Mỗi ô là số câu tương ứng trong đề gốc, dùng để tra lời giải chi tiết.</p>${mapping.join('\n')}`);

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<style>
body { font-family: 'Times New Roman', serif; font-size: 13pt; color: #000; }
h2 { text-align: center; font-size: 15pt; margin: 0 0 4pt; }
h3 { font-size: 13pt; margin: 12pt 0 4pt; }
</style></head><body>
<h2>BẢNG ĐÁP ÁN THEO MÃ ĐỀ</h2>
<p style="text-align:center;font-style:italic;">${escHtml(title)}</p>
${blocks.join('\n')}
</body></html>`;
};
