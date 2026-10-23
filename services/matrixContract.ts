/**
 * HỢP ĐỒNG SỐ LIỆU MA TRẬN / ĐẶC TẢ
 * ------------------------------------------------------------------
 * Đọc bảng Ma trận hoặc Bản đặc tả (HTML) mà người dùng tải lên và chuyển thành
 * cấu trúc số liệu chặt chẽ: dạng câu hỏi × mức độ × mã câu × đơn vị kiến thức × điểm.
 *
 * Nguyên tắc: đọc bằng CẤU TRÚC chứ không đoán.
 *   - Cột nào là dạng nào / mức nào: lấy từ dòng tiêu đề của chính bảng
 *     (Nhiều lựa chọn | Đúng – Sai | Trả lời ngắn | Tự luận  ×  Biết | Hiểu | Vận dụng | VDC).
 *   - Ô dữ liệu được hiểu theo 3 kiểu ghi phổ biến:
 *       (1) mã La Mã:   I.1, II.1a, II.1b, III.2, IV.1      (mẫu CV 7991)
 *       (2) mã "Câu":   Câu 1, 2 | Câu 1a, 1b | C1a,b (1)   (nhiều trường dùng)
 *       (3) số lượng:   2 | 1TN | 2 câu                    (ma trận chỉ ghi số lệnh hỏi)
 *   - Dòng "Tổng số câu/lệnh hỏi" và "Tổng số điểm" được dùng để ĐỐI CHIẾU, sai lệch → cảnh báo.
 *
 * Module thuần chuỗi (không dùng DOMParser) nên chạy được cả trên trình duyệt lẫn Node (test).
 */
import type { QuestionConfig, DungSaiLevel, DungSaiLevelConfig } from '../types';

export type QType = 'I' | 'II' | 'III' | 'IV';
export type Lvl = 'biet' | 'hieu' | 'van_dung' | 'van_dung_cao';

export const QTYPES: QType[] = ['I', 'II', 'III', 'IV'];
export const LEVELS: Lvl[] = ['biet', 'hieu', 'van_dung', 'van_dung_cao'];

export const TYPE_LABEL: Record<QType, string> = {
  I: 'Trắc nghiệm nhiều lựa chọn',
  II: 'Trắc nghiệm Đúng – Sai',
  III: 'Trắc nghiệm trả lời ngắn',
  IV: 'Tự luận',
};
export const LEVEL_LABEL: Record<Lvl, string> = {
  biet: 'Biết',
  hieu: 'Hiểu',
  van_dung: 'Vận dụng',
  van_dung_cao: 'Vận dụng cao',
};

// ============================================================================
// 1. TIỆN ÍCH CHUỖI / HTML
// ============================================================================

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, '&');

/** HTML → văn bản thuần, giữ xuống dòng ở <br>/<p>. */
export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .normalize('NFC')
    .replace(/[ \t ​]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

const attrInt = (attrs: string, name: string): number => {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs);
  const v = m ? parseInt(m[1], 10) : 1;
  return Number.isFinite(v) && v > 0 ? v : 1;
};

/** Vị trí các bảng <table> cấp ngoài cùng (an toàn với bảng lồng nhau, bảng thiếu thẻ đóng). */
export const findTopLevelTables = (html: string): Array<{ start: number; end: number; html: string }> => {
  const out: Array<{ start: number; end: number; html: string }> = [];
  const re = /<(\/?)table\b[^>]*>/gi;
  let depth = 0;
  let start = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== '/') {
      if (depth === 0) start = m.index;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push({ start, end: re.lastIndex, html: html.slice(start, re.lastIndex) });
        start = -1;
      }
    }
  }
  if (depth > 0 && start >= 0) out.push({ start, end: html.length, html: html.slice(start) });
  return out;
};

interface RawCell { attrs: string; inner: string }

/** Tách các dòng/ô của 1 bảng (bỏ qua bảng lồng bên trong ô; chịu được thẻ không đóng). */
const splitRowsAndCells = (tableHtml: string): RawCell[][] => {
  const openEnd = tableHtml.indexOf('>') + 1;
  const body = tableHtml.slice(openEnd);
  const re = /<(\/?)(table|tr|td|th)\b([^>]*)>/gi;
  const rows: RawCell[][] = [];
  let nested = 0;
  let row: RawCell[] | null = null;
  let cell: { attrs: string; from: number } | null = null;
  let m: RegExpExecArray | null;

  const closeCell = (at: number) => {
    if (cell && row) row.push({ attrs: cell.attrs, inner: body.slice(cell.from, at) });
    cell = null;
  };
  const closeRow = (at: number) => {
    closeCell(at);
    if (row) rows.push(row);
    row = null;
  };

  while ((m = re.exec(body))) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (tag === 'table') {
      if (isClose) {
        if (nested === 0) { closeRow(m.index); break; } // thẻ đóng của chính bảng này
        nested--;
      } else nested++;
      continue;
    }
    if (nested > 0) continue;
    if (tag === 'tr') {
      if (isClose) closeRow(m.index);
      else { closeRow(m.index); row = []; }
    } else {
      // td | th
      if (isClose) closeCell(m.index);
      else {
        if (!row) row = [];
        closeCell(m.index);
        cell = { attrs: m[3] || '', from: re.lastIndex };
      }
    }
  }
  closeRow(body.length);
  return rows;
};

export interface GridCell {
  id: number;
  text: string;
  r: number;
  c: number;
  rs: number;
  cs: number;
}

/** Bảng HTML → lưới 2 chiều đã bung rowspan / colspan. */
export const tableToGrid = (tableHtml: string): { grid: (GridCell | undefined)[][]; cells: GridCell[]; nRows: number; nCols: number } => {
  const rawRows = splitRowsAndCells(tableHtml);
  const grid: (GridCell | undefined)[][] = [];
  const cells: GridCell[] = [];
  let id = 0;
  rawRows.forEach((raw, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const rc of raw) {
      while (grid[r][c]) c++;
      const rs = Math.min(attrInt(rc.attrs, 'rowspan'), Math.max(1, rawRows.length - r));
      const cs = Math.min(attrInt(rc.attrs, 'colspan'), 200);
      const cell: GridCell = { id: id++, text: htmlToText(rc.inner), r, c, rs, cs };
      cells.push(cell);
      for (let dr = 0; dr < rs; dr++) {
        const rr = r + dr;
        grid[rr] = grid[rr] || [];
        for (let dc = 0; dc < cs; dc++) {
          if (!grid[rr][c + dc]) grid[rr][c + dc] = cell;
        }
      }
      c += cs;
    }
  });
  const nRows = grid.length;
  const nCols = grid.reduce((mx, row) => Math.max(mx, row ? row.length : 0), 0);
  for (let r = 0; r < nRows; r++) grid[r] = grid[r] || [];
  return { grid, cells, nRows, nCols };
};

// ============================================================================
// 2. NHẬN DIỆN TIÊU ĐỀ CỘT
// ============================================================================

const low = (s: string) => oneLine(s).toLowerCase().normalize('NFC');

/** Ô tiêu đề chỉ ghi mức độ (Biết / Hiểu / VD / NB / TH / B / H / Mức 1 …). */
export const isLevelLabel = (text: string): boolean => {
  const t = low(text).replace(/[.:]+$/, '');
  if (!t || t.length > 24) return false;
  return /^(nhận\s*biết|biết|nb|b|thông\s*hiểu|hiểu|th|h|vận\s*dụng\s*cao|vận\s*dụng|vdc|vd|v|mức\s*[1-4]|m[1-4])(\s*\([^)]*\))?$/.test(t);
};

export const levelOf = (text: string): Lvl | null => {
  const t = low(text).replace(/[.:]+$/, '');
  if (/vận\s*dụng\s*cao|^vdc\b|^mức\s*4$|^m4$/.test(t)) return 'van_dung_cao';
  if (/vận\s*dụng|^vd\b|^v$|^mức\s*3$|^m3$/.test(t)) return 'van_dung';
  if (/thông\s*hiểu|^hiểu\b|^th\b|^h$|^mức\s*2$|^m2$/.test(t)) return 'hieu';
  if (/nhận\s*biết|^biết\b|^nb\b|^b$|^mức\s*1$|^m1$/.test(t)) return 'biet';
  return null;
};

/** Nhận diện dạng câu hỏi từ một ô tiêu đề (ưu tiên dạng cụ thể trước "TNKQ" chung). */
export const typeOf = (text: string): QType | null => {
  const t = low(text);
  if (!t) return null;
  if (/đúng\s*[-–—\/]?\s*sai|\bđ\s*\/\s*s\b|\(\s*ii\s*\)|dạng\s*(?:thức\s*)?(?:ii|2)(?![\w])|phần\s*(?:ii|2)(?![\w])/.test(t)) return 'II';
  if (/trả\s*lời\s*ngắn|điền\s*khuyết|\(\s*iii\s*\)|dạng\s*(?:thức\s*)?(?:iii|3)(?![\w])|phần\s*(?:iii|3)(?![\w])/.test(t)) return 'III';
  if (/tự\s*luận|\(\s*iv\s*\)|dạng\s*(?:thức\s*)?(?:iv|4)(?![\w])|phần\s*(?:iv|4)(?![\w])/.test(t)) return 'IV';
  if (/nhiều\s*lựa\s*chọn|4\s*lựa\s*chọn|bốn\s*lựa\s*chọn|\(\s*i\s*\)|dạng\s*(?:thức\s*)?(?:i|1)(?![\w])|phần\s*(?:i|1)(?![\w])/.test(t)) return 'I';
  return null;
};
const isGenericTnkq = (text: string) => /tnkq|trắc\s*nghiệm|khách\s*quan/.test(low(text));

const isExcludedHeader = (text: string) => /^(tổng|tỉ\s*lệ|tỷ\s*lệ|%|cộng|số\s*điểm|điểm\b|ghi\s*chú)/.test(low(text));

// ============================================================================
// 3. PHÂN TÍCH 1 BẢNG
// ============================================================================

export type TableKind = 'matrix' | 'specs' | 'other';

export interface TableAnalysis {
  index: number;
  start: number;
  end: number;
  html: string;
  kind: TableKind;
  grid: (GridCell | undefined)[][];
  nRows: number;
  nCols: number;
  headerRows: number;
  colMap: Array<{ type: QType; level: Lvl } | null>;
  roles: { tt?: number; chapter?: number; unit?: number; yccd?: number };
  dataRows: number[];
  footer: { countRow?: number; pointRow?: number; pctRow?: number };
  unmappedLevelCols: number;
}

const headerStack = (grid: (GridCell | undefined)[][], headerRows: number, c: number): GridCell[] => {
  const stack: GridCell[] = [];
  for (let r = 0; r < headerRows; r++) {
    const cell = grid[r]?.[c];
    if (cell && cell.text && stack[stack.length - 1]?.id !== cell.id) stack.push(cell);
  }
  return stack;
};

export const analyzeTable = (tableHtml: string, index = 0, start = 0, end = 0): TableAnalysis => {
  const { grid, nRows, nCols } = tableToGrid(tableHtml);

  // --- Dòng tiêu đề: dòng cuối cùng (trong 8 dòng đầu) có ≥ 2 ô chỉ ghi mức độ ---
  let levelRow = -1;
  for (let r = 0; r < Math.min(8, nRows); r++) {
    const seen = new Set<number>();
    let n = 0;
    for (const cell of grid[r]) {
      if (!cell || seen.has(cell.id)) continue;
      seen.add(cell.id);
      if (cell.r === r && isLevelLabel(cell.text)) n++;
    }
    if (n >= 2) levelRow = r;
    else if (levelRow >= 0) break; // hết khối tiêu đề (dòng tiêu đề chép lặp phía dưới không được tính)
  }
  let headerRows = levelRow >= 0 ? levelRow + 1 : 0;
  if (headerRows === 0 && nRows > 0) {
    // Không có cột mức độ: tiêu đề = rowspan của ô đầu tiên (nếu có)
    headerRows = Math.min(grid[0]?.[0]?.rs || 1, Math.max(1, nRows - 1));
  }

  // --- Bản đồ cột ---
  const colMap: TableAnalysis['colMap'] = [];
  const roles: TableAnalysis['roles'] = {};
  let unmappedLevelCols = 0;
  const hasAnySpecificType = (() => {
    for (let c = 0; c < nCols; c++) {
      if (headerStack(grid, headerRows, c).some(cell => typeOf(cell.text))) return true;
    }
    return false;
  })();

  for (let c = 0; c < nCols; c++) {
    const stack = headerStack(grid, headerRows, c);
    const bottom = grid[headerRows - 1]?.[c];
    let mapped: { type: QType; level: Lvl } | null = null;
    if (levelRow >= 0 && bottom && isLevelLabel(bottom.text) && !stack.some(s => isExcludedHeader(s.text))) {
      const level = levelOf(bottom.text);
      let type: QType | null = null;
      for (let i = stack.length - 2; i >= 0 && !type; i--) type = typeOf(stack[i].text);
      if (!type && !hasAnySpecificType && stack.slice(0, -1).some(s => isGenericTnkq(s.text))) type = 'I';
      if (level && type) mapped = { type, level };
      else if (level) unmappedLevelCols++;
    }
    colMap[c] = mapped;
    if (!mapped) {
      const joined = low(stack.map(s => s.text).join(' '));
      if (!joined) continue;
      if (roles.tt === undefined && /^(s?tt|stt|số\s*tt|thứ\s*tự)\b/.test(joined)) roles.tt = c;
      else if (roles.yccd === undefined && /yêu\s*cầu\s*cần\s*đạt|mức\s*độ\s*(kiểm\s*tra|đánh\s*giá)|mô\s*tả|chuẩn\s*kiến\s*thức/.test(joined) && !/^tổng/.test(joined)) roles.yccd = c;
      else if (roles.unit === undefined && /nội\s*dung|đơn\s*vị|bài\s*học/.test(joined)) roles.unit = c;
      else if (roles.chapter === undefined && /chương|chủ\s*đề|mạch|phân\s*môn/.test(joined)) roles.chapter = c;
    }
  }
  // Ma trận kiểu 02 (ô "Nội" bị tách khỏi "dung/đơn vị kiến thức"): ghép lại theo cột
  if (roles.unit === undefined) {
    for (let c = 0; c < nCols; c++) {
      if (colMap[c] || c === roles.tt || c === roles.chapter || c === roles.yccd) continue;
      const joined = low(headerStack(grid, headerRows, c).map(s => s.text).join(''));
      if (/nộidung|đơnvị|dung\/?\s*đơn/.test(joined.replace(/\s+/g, ''))) { roles.unit = c; break; }
    }
  }

  const firstMapped = colMap.findIndex(Boolean);
  const labelOfRow = (r: number): string => {
    const lim = firstMapped >= 0 ? firstMapped : Math.min(4, nCols);
    const seen = new Set<number>();
    const parts: string[] = [];
    for (let c = 0; c < lim; c++) {
      const cell = grid[r]?.[c];
      if (cell && !seen.has(cell.id) && cell.r === r && cell.text) { seen.add(cell.id); parts.push(cell.text); }
    }
    return low(parts.join(' '));
  };

  // --- Dòng tổng (footer) & dòng dữ liệu ---
  const footer: TableAnalysis['footer'] = {};
  const dataRows: number[] = [];
  let inFooter = false;
  for (let r = headerRows; r < nRows; r++) {
    const label = labelOfRow(r);
    const isFooter = /^(tổng|tỉ\s*lệ|tỷ\s*lệ|cộng|số\s*câu|số\s*điểm|điểm\b|số\s*lệnh)/.test(label);
    if (isFooter) {
      inFooter = true;
      if (/tỉ\s*lệ|tỷ\s*lệ|%/.test(label)) { if (footer.pctRow === undefined) footer.pctRow = r; }
      else if (/điểm/.test(label)) { if (footer.pointRow === undefined) footer.pointRow = r; }
      else if (footer.countRow === undefined) footer.countRow = r;
      continue;
    }
    if (inFooter) continue;
    // Bỏ dòng tiêu đề bị chép lặp lại giữa bảng
    const seen = new Set<number>();
    let lv = 0;
    for (const cell of grid[r]) {
      if (cell && !seen.has(cell.id) && cell.r === r) { seen.add(cell.id); if (isLevelLabel(cell.text)) lv++; }
    }
    if (lv >= 2) continue;
    if (!grid[r].some(cell => cell && cell.text)) continue;
    dataRows.push(r);
  }

  // --- Loại bảng ---
  const headerText = low(
    Array.from({ length: headerRows }, (_, r) => grid[r].map(c => c?.text || '').join(' ')).join(' ')
  );
  let specsBodyHits = 0;
  for (const r of dataRows) {
    for (let c = 0; c < nCols; c++) {
      if (colMap[c]) continue;
      const cell = grid[r][c];
      if (cell && cell.r === r && cell.c === c && /^[*\-–•+\s]*(nhận\s*biết|thông\s*hiểu|vận\s*dụng|biết|hiểu)\s*(\([^)]*\))?\s*[:：]/i.test(cell.text)) specsBodyHits++;
    }
  }
  const mappedCount = colMap.filter(Boolean).length;
  const isSpecs = roles.yccd !== undefined || /yêu\s*cầu\s*cần\s*đạt|đặc\s*tả/.test(headerText) || specsBodyHits >= 2;
  const kind: TableKind = mappedCount >= 2 ? (isSpecs ? 'specs' : 'matrix') : (isSpecs ? 'specs' : 'other');

  return { index, start, end, html: tableHtml, kind, grid, nRows, nCols, headerRows, colMap, roles, dataRows, footer, unmappedLevelCols };
};

export const analyzeTables = (html: string): TableAnalysis[] =>
  findTopLevelTables(html || '').map((t, i) => analyzeTable(t.html, i, t.start, t.end));

// ============================================================================
// 4. ĐỌC NỘI DUNG Ô (mã câu / số lượng)
// ============================================================================

export interface CellCode { type?: QType; num: number; letter?: string }
export interface CellParse { codes: CellCode[]; count: number; style: 'roman' | 'cau' | 'count' | 'none' }

const ROMAN_RE = /(?<![A-Za-zÀ-ỹĐđ])(IV|III|II|I)\s*[.．]\s*(\d{1,2})(?!\d)((?:\s*[,;&\/]?\s*(?:và\s+)?[a-dA-D](?![a-zà-ỹđ]))*)/g;

export const parseCellContent = (rawText: string): CellParse => {
  if (!rawText) return { codes: [], count: 0, style: 'none' };
  let text = rawText.normalize('NFC').replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/([0-9a-dA-D])(?=(?:IV|III|II|I)\s*[.．]\s*\d)/g, '$1 ');

  // (1) Mã La Mã I.1 / II.1a / IV.2b
  const roman: CellCode[] = [];
  ROMAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROMAN_RE.exec(text))) {
    const type = m[1] as QType;
    const num = parseInt(m[2], 10);
    const letters = (m[3] || '').toLowerCase().match(/[a-d]/g) || [];
    if (letters.length === 0) roman.push({ type, num });
    else letters.forEach(letter => roman.push({ type, num, letter }));
  }
  if (roman.length) return { codes: roman, count: 0, style: 'roman' };

  // (2) Mã "Câu 1, 2" / "Câu 1a, 1b" / "C1a,b" / "Câu 3 - 5"
  const s = text.toLowerCase();
  const tokens = s.match(/câu|(?<![a-zà-ỹđ])c(?=\s*\d)|\d{1,2}(?![\d.,]\d)|[a-d](?![a-zà-ỹđ])|và|[,;&\/]|[-–→~]|\S/g) || [];
  const cau: CellCode[] = [];
  let inList = false;
  let lastNum: number | null = null;
  let pendingRange = false;
  for (const tok of tokens) {
    if (tok === 'câu' || tok === 'c') { inList = true; pendingRange = false; continue; }
    if (!inList) continue;
    if (/^\d+$/.test(tok)) {
      const n = parseInt(tok, 10);
      if (pendingRange && lastNum !== null && n > lastNum && n - lastNum <= 30) {
        for (let k = lastNum + 1; k <= n; k++) cau.push({ num: k });
      } else cau.push({ num: n });
      lastNum = n;
      pendingRange = false;
      continue;
    }
    if (/^[a-d]$/.test(tok) && lastNum !== null) {
      const last = cau[cau.length - 1];
      if (last && last.num === lastNum && !last.letter) last.letter = tok;
      else cau.push({ num: lastNum, letter: tok });
      continue;
    }
    if (tok === ',' || tok === ';' || tok === '&' || tok === '/' || tok === 'và') continue;
    if (/^[-–→~]$/.test(tok)) { pendingRange = true; continue; }
    inList = false; // từ khác → kết thúc danh sách
  }
  if (cau.length) return { codes: cau, count: 0, style: 'cau' };

  // (3) Số lượng: "2" | "1TN" | "2 câu" | "3 ý"
  const plain = oneLine(s);
  const cm = /^(\d{1,2})\s*(câu|tn|tl|tln|ds|đs|ý|lệnh(?:\s*hỏi)?|c)?\.?$/.exec(plain);
  if (cm) {
    const n = parseInt(cm[1], 10);
    return { codes: [], count: n, style: n > 0 ? 'count' : 'none' };
  }
  return { codes: [], count: 0, style: 'none' };
};

const parseNumberVN = (text: string): number | null => {
  const m = /(\d+(?:[.,]\d+)?)/.exec(text.replace(/\s+/g, ''));
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// ============================================================================
// 5. HỢP ĐỒNG SỐ LIỆU
// ============================================================================

export interface PlanItem { letter?: string; level: Lvl }
export interface QuestionPlan {
  type: QType;
  num: number;
  items: PlanItem[];       // Dạng I/III: 1 item; Dạng II: 4 ý a–d; Tự luận: các ý (hoặc 1)
  chapter?: string;
  unit?: string;
  yccd?: string;
  points?: number;
}

export type ContractConfidence = 'high' | 'medium' | 'low';

export interface MatrixContract {
  ok: boolean;
  tableKind: TableKind;
  tablesFound: number;
  codeStyle: 'roman' | 'cau' | 'count' | 'mixed' | 'none';
  questions: Record<QType, QuestionPlan[]>;
  commands: Record<QType, Record<Lvl, number>>; // số lệnh hỏi theo mức
  questionCount: Record<QType, number>;
  totalCommands: number;
  hasVDC: boolean;
  points: {
    byType: Partial<Record<QType, number>>;
    byTypeLevel: Partial<Record<QType, Partial<Record<Lvl, number>>>>;
    total: number | null;
    fromFile: boolean;
  };
  questionConfig: QuestionConfig | null;
  meta: { subject?: string; grade?: string; examType?: string; duration?: number };
  /** Các cột mức độ theo đúng thứ tự trong bảng gốc (kể cả cột trống) */
  columns: Array<{ type: QType; level: Lvl; label: string }>;
  /** Tên nhóm cột của từng dạng như ghi trong file (VD: "TNKQ nhiều lựa chọn (I)") */
  typeHeaders: Partial<Record<QType, string>>;
  topics: Array<{ chapter?: string; unit?: string }>;
  topicsSummary: string;
  warnings: string[];
  confidence: ContractConfidence;
}

const emptyLevels = (): Record<Lvl, number> => ({ biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 });
const sumLv = (o: Partial<Record<Lvl, number>> | undefined) => LEVELS.reduce((s, l) => s + (o?.[l] || 0), 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmtNum = (n: number): string => {
  const r = round2(n);
  const s = Number.isInteger(r) ? r.toFixed(1) : String(r);
  return s.replace('.', ',');
};

const toDsLevel = (l: Lvl): DungSaiLevel => (l === 'biet' ? 'nhan_biet' : l === 'hieu' ? 'thong_hieu' : 'van_dung');

interface Entry { row: number; col: number; type: QType; level: Lvl; code?: CellCode; count?: number }

const LETTERS = ['a', 'b', 'c', 'd'];

const pickTable = (tables: TableAnalysis[], prefer?: TableKind): TableAnalysis | null => {
  const usable = tables.filter(t => t.colMap.some(Boolean) && t.dataRows.length > 0);
  if (!usable.length) return null;
  if (prefer) {
    const p = usable.find(t => t.kind === prefer);
    if (p) return p;
  }
  return usable.find(t => t.kind === 'matrix') || usable[0];
};

export interface ParseContractOptions { prefer?: TableKind }

export const parseMatrixContract = (html: string, opts: ParseContractOptions = {}): MatrixContract => {
  const warnings: string[] = [];
  const tables = analyzeTables(html || '');
  const meta = detectMeta(html || '');
  const questions: Record<QType, QuestionPlan[]> = { I: [], II: [], III: [], IV: [] };
  const commands: Record<QType, Record<Lvl, number>> = { I: emptyLevels(), II: emptyLevels(), III: emptyLevels(), IV: emptyLevels() };
  const questionCount: Record<QType, number> = { I: 0, II: 0, III: 0, IV: 0 };
  const base: MatrixContract = {
    ok: false, tableKind: 'other', tablesFound: tables.length, codeStyle: 'none',
    questions, commands, questionCount, totalCommands: 0, hasVDC: false,
    points: { byType: {}, byTypeLevel: {}, total: null, fromFile: false },
    questionConfig: null, meta, columns: [], typeHeaders: {}, topics: [], topicsSummary: '', warnings, confidence: 'low',
  };

  const t = pickTable(tables, opts.prefer);
  if (!t) {
    warnings.push(tables.length
      ? 'Có bảng trong file nhưng không tìm thấy cột mức độ (Biết / Hiểu / Vận dụng) gắn với dạng câu hỏi — app không đọc được số câu từ file.'
      : 'Không tìm thấy bảng nào trong nội dung tải lên.');
    return base;
  }
  base.tableKind = t.kind;
  for (let c = 0; c < t.nCols; c++) {
    const map = t.colMap[c];
    if (!map) continue;
    const stack = headerStack(t.grid, t.headerRows, c);
    base.columns.push({ ...map, label: oneLine(stack[stack.length - 1]?.text || LEVEL_LABEL[map.level]) });
    if (!base.typeHeaders[map.type]) {
      for (let i = stack.length - 2; i >= 0; i--) {
        if (typeOf(stack[i].text)) { base.typeHeaders[map.type] = oneLine(stack[i].text); break; }
      }
    }
  }
  if (t.unmappedLevelCols > 0) warnings.push(`${t.unmappedLevelCols} cột mức độ không xác định được thuộc dạng câu hỏi nào (thiếu tiêu đề dạng ở dòng trên) nên bị bỏ qua.`);

  const cellText = (r: number, c?: number) => (c === undefined ? '' : oneLine(t.grid[r]?.[c]?.text || ''));

  // --- 5.1 Gom dữ liệu ô ---
  const entries: Entry[] = [];
  const styles = new Set<string>();
  const seenCell = new Set<number>();
  for (const r of t.dataRows) {
    for (let c = 0; c < t.nCols; c++) {
      const map = t.colMap[c];
      const cell = t.grid[r]?.[c];
      if (!map || !cell || !cell.text || seenCell.has(cell.id)) continue;
      seenCell.add(cell.id);
      const parsed = parseCellContent(cell.text);
      if (parsed.style === 'none') {
        if (/\d/.test(cell.text) && !/^\s*[-–0]\s*$/.test(cell.text)) {
          warnings.push(`Ô "${oneLine(cell.text).slice(0, 30)}" (dòng ${r + 1}, cột ${LEVEL_LABEL[map.level]} – Dạng ${map.type}) không đọc được thành mã câu hay số câu.`);
        }
        continue;
      }
      styles.add(parsed.style);
      if (parsed.codes.length) {
        for (const code of parsed.codes) {
          const type = code.type || map.type;
          if (code.type && code.type !== map.type) {
            warnings.push(`Mã ${code.type}.${code.num}${code.letter || ''} nằm trong cột của Dạng ${map.type} — app lấy theo mã câu (Dạng ${code.type}).`);
          }
          entries.push({ row: r, col: c, type, level: map.level, code: { ...code, type } });
        }
      } else if (parsed.count > 0) {
        entries.push({ row: r, col: c, type: map.type, level: map.level, count: parsed.count });
      }
    }
  }
  base.codeStyle = styles.size === 0 ? 'none' : styles.size > 1 ? 'mixed' : (Array.from(styles)[0] as MatrixContract['codeStyle']);
  if (base.codeStyle === 'mixed') warnings.push('Bảng ghi lẫn mã câu và số lượng — app ưu tiên mã câu, phần ghi số được đánh số tiếp theo.');

  const rowInfo = (r: number) => ({
    chapter: cellText(r, t.roles.chapter) || undefined,
    unit: cellText(r, t.roles.unit) || undefined,
    yccd: t.roles.yccd !== undefined ? (cellText(r, t.roles.yccd) || undefined) : undefined,
  });

  // --- 5.2 Dựng danh sách câu hỏi theo dạng ---
  const byNum: Record<QType, Map<number, QuestionPlan>> = { I: new Map(), II: new Map(), III: new Map(), IV: new Map() };
  const seenKey = new Set<string>();
  const ensureQ = (type: QType, num: number, r: number): QuestionPlan => {
    let q = byNum[type].get(num);
    const info = rowInfo(r);
    if (!q) {
      q = { type, num, items: [], ...info };
      byNum[type].set(num, q);
    } else {
      // Một câu trải trên nhiều dòng (VD: tự luận Câu 2a ở bài này, 2b ở bài khác)
      if (info.unit && q.unit && !q.unit.includes(info.unit)) q.unit = `${q.unit} + ${info.unit}`;
      if (info.chapter && q.chapter && !q.chapter.includes(info.chapter)) q.chapter = `${q.chapter} + ${info.chapter}`;
      if (info.yccd && q.yccd && !q.yccd.includes(info.yccd)) q.yccd = `${q.yccd} | ${info.yccd}`;
      else if (info.yccd && !q.yccd) q.yccd = info.yccd;
    }
    return q;
  };

  // (a) mã câu
  for (const e of entries) {
    if (!e.code) continue;
    const key = `${e.type}.${e.code.num}${e.code.letter || ''}`;
    if (seenKey.has(key)) { warnings.push(`Mã ${key} xuất hiện nhiều lần trong bảng — chỉ tính 1 lần.`); continue; }
    seenKey.add(key);
    const q = ensureQ(e.type, e.code.num, e.row);
    if (e.type === 'I' || e.type === 'III') {
      if (q.items.length) { warnings.push(`Câu ${key} được ghi ở nhiều mức độ — app giữ mức ${LEVEL_LABEL[q.items[0].level]}.`); continue; }
      q.items.push({ level: e.level });
    } else {
      q.items.push({ letter: e.code.letter, level: e.level });
    }
  }
  // (b) số lượng → đánh số tiếp theo theo thứ tự dòng, cột
  const nextNum = (type: QType) => (byNum[type].size ? Math.max(...Array.from(byNum[type].keys())) : 0) + 1;
  const countEntries = entries.filter(e => e.count).sort((a, b) => a.row - b.row || a.col - b.col);
  const dsPool: Array<{ row: number; level: Lvl }> = [];
  for (const e of countEntries) {
    for (let k = 0; k < (e.count || 0); k++) {
      if (e.type === 'II') dsPool.push({ row: e.row, level: e.level });
      else ensureQ(e.type, nextNum(e.type), e.row).items.push({ level: e.level });
    }
  }
  if (dsPool.length) {
    if (dsPool.length % 4 !== 0) warnings.push(`Dạng II (Đúng – Sai) có ${dsPool.length} lệnh hỏi — không chia hết cho 4 ý/câu, vui lòng kiểm tra lại ma trận.`);
    for (let i = 0; i < dsPool.length; i += 4) {
      const chunk = dsPool.slice(i, i + 4);
      const q = ensureQ('II', nextNum('II'), chunk[0].row);
      chunk.forEach((p, j) => q.items.push({ letter: LETTERS[j], level: p.level }));
    }
  }

  // (c) chuẩn hoá Dạng II: đủ 4 ý a–d, sắp xếp theo chữ cái
  for (const q of byNum.II.values()) {
    const used = new Set(q.items.map(i => i.letter).filter(Boolean) as string[]);
    for (const it of q.items) {
      if (!it.letter) { const free = LETTERS.find(l => !used.has(l)); if (free) { it.letter = free; used.add(free); } }
    }
    q.items.sort((a, b) => (a.letter || 'z').localeCompare(b.letter || 'z'));
    if (q.items.length !== 4) {
      const missing = LETTERS.filter(l => !q.items.some(i => i.letter === l));
      warnings.push(`Câu II.${q.num} (Đúng – Sai) có ${q.items.length} ý${missing.length ? `, thiếu ý ${missing.join(', ')}` : ''} — mỗi câu Đúng – Sai cần đủ 4 ý a, b, c, d.`);
    }
  }
  for (const q of byNum.IV.values()) q.items.sort((a, b) => (a.letter || '').localeCompare(b.letter || ''));

  QTYPES.forEach(type => {
    questions[type] = Array.from(byNum[type].values()).sort((a, b) => a.num - b.num);
    questionCount[type] = questions[type].length;
    for (const q of questions[type]) for (const it of q.items) commands[type][it.level] += 1;
    const nums = questions[type].map(q => q.num);
    const gaps: number[] = [];
    for (let k = 1; k <= (nums.length ? Math.max(...nums) : 0); k++) if (!nums.includes(k)) gaps.push(k);
    if (gaps.length && gaps.length <= 6) warnings.push(`Dạng ${type}: thiếu câu số ${gaps.join(', ')} trong bảng (đánh số không liên tục).`);
  });

  // --- 5.3 Đối chiếu dòng "Tổng số câu/lệnh hỏi" ---
  const footerByTypeLevel = (row?: number) => {
    const out: { tl: Partial<Record<QType, Partial<Record<Lvl, number>>>>; t: Partial<Record<QType, number>> } = { tl: {}, t: {} };
    if (row === undefined) return out;
    const seen = new Set<number>();
    for (let c = 0; c < t.nCols; c++) {
      const cell: GridCell | undefined = t.grid[row]?.[c];
      if (!cell || seen.has(cell.id) || cell.r !== row) continue;
      seen.add(cell.id);
      const maps = Array.from({ length: cell.cs }, (_, k) => t.colMap[cell.c + k]).filter(Boolean) as Array<{ type: QType; level: Lvl }>;
      if (!maps.length) continue;
      const types = new Set(maps.map(x => x.type));
      if (types.size !== 1) continue;
      const v = parseNumberVN(cell.text);
      if (v === null) continue;
      const type = maps[0].type;
      const levels = new Set(maps.map(x => x.level));
      if (levels.size === 1) {
        out.tl[type] = out.tl[type] || {};
        out.tl[type]![maps[0].level] = (out.tl[type]![maps[0].level] || 0) + v;
      } else out.t[type] = (out.t[type] || 0) + v;
    }
    return out;
  };

  const fc = footerByTypeLevel(t.footer.countRow);
  let footerMismatch = false;
  QTYPES.forEach(type => {
    const f = fc.tl[type];
    if (!f) return;
    const bodyTotal = sumLv(commands[type]);
    if (bodyTotal === 0 && sumLv(f) > 0) {
      // Thân bảng trống → dựng từ dòng tổng (không có thông tin bài học)
      warnings.push(`Dạng ${type}: thân bảng không ghi mã/số câu, app lấy theo dòng "Tổng số câu" (${sumLv(f)} lệnh hỏi).`);
      LEVELS.forEach(l => {
        const n = Math.round(f[l] || 0);
        if (type === 'II') for (let k = 0; k < n; k++) dsPool.push({ row: -1, level: l });
        else for (let k = 0; k < n; k++) {
          const q: QuestionPlan = { type, num: questions[type].length + 1, items: [{ level: l }] };
          questions[type].push(q);
          commands[type][l] += 1;
        }
      });
      if (type === 'II') {
        const pool = dsPool.filter(p => p.row === -1);
        for (let i = 0; i < pool.length; i += 4) {
          const q: QuestionPlan = { type, num: questions.II.length + 1, items: pool.slice(i, i + 4).map((p, j) => ({ letter: LETTERS[j], level: p.level })) };
          questions.II.push(q);
          q.items.forEach(it => { commands.II[it.level] += 1; });
        }
      }
      questionCount[type] = questions[type].length;
      return;
    }
    const diffs = LEVELS.filter(l => f[l] !== undefined && Math.round(f[l]!) !== commands[type][l]);
    if (diffs.length) {
      footerMismatch = true;
      warnings.push(`Dạng ${type}: dòng "Tổng số câu" ghi ${diffs.map(l => `${LEVEL_LABEL[l]} ${f[l]}`).join(', ')} nhưng đếm trong bảng được ${diffs.map(l => `${LEVEL_LABEL[l]} ${commands[type][l]}`).join(', ')}.`);
    }
  });

  // --- 5.4 Điểm ---
  const fp = footerByTypeLevel(t.footer.pointRow);
  const fpct = footerByTypeLevel(t.footer.pctRow);
  const byType: Partial<Record<QType, number>> = {};
  const byTypeLevel: Partial<Record<QType, Partial<Record<Lvl, number>>>> = {};
  QTYPES.forEach(type => {
    if (!questions[type].length) return;
    const lv = fp.tl[type];
    if (lv && sumLv(lv) > 0) { byTypeLevel[type] = lv; byType[type] = round2(sumLv(lv)); }
    else if (fp.t[type]) byType[type] = round2(fp.t[type]!);
    else if (fpct.t[type] || fpct.tl[type]) {
      const pct = fpct.t[type] ?? sumLv(fpct.tl[type]);
      if (pct) byType[type] = round2(pct / 10);
    }
  });
  const fromFile = Object.keys(byType).length > 0;
  const total = fromFile ? round2(Object.values(byType).reduce((s, v) => s + (v || 0), 0)) : null;
  if (fromFile && total !== null && Math.abs(total - 10) > 0.01) warnings.push(`Tổng điểm đọc từ file là ${fmtNum(total)} (không phải 10) — vui lòng kiểm tra dòng "Tổng số điểm".`);
  const missingPts = QTYPES.filter(type => questions[type].length && byType[type] === undefined);
  if (fromFile && missingPts.length) warnings.push(`Không đọc được điểm của Dạng ${missingPts.join(', ')} trong dòng "Tổng số điểm".`);

  // Điểm từng câu
  QTYPES.forEach(type => {
    const qs = questions[type];
    const pts = byType[type];
    if (!qs.length || pts === undefined) return;
    if (type === 'II') {
      const per = pts / Math.max(1, sumLv(commands.II));
      qs.forEach(q => { q.points = round2(per * q.items.length); });
    } else if (type === 'IV' && byTypeLevel.IV) {
      qs.forEach(q => {
        q.points = round2(q.items.reduce((s, it) => s + (byTypeLevel.IV![it.level] || 0) / Math.max(1, commands.IV[it.level]), 0));
      });
    } else {
      const totalCmd = Math.max(1, sumLv(commands[type]));
      qs.forEach(q => { q.points = round2((pts / totalCmd) * q.items.length); });
    }
  });
  base.points = { byType, byTypeLevel, total, fromFile };

  // --- 5.5 Tổng hợp ---
  base.totalCommands = QTYPES.reduce((s, type) => s + sumLv(commands[type]), 0);
  base.hasVDC = QTYPES.some(type => commands[type].van_dung_cao > 0);
  base.ok = base.totalCommands > 0;

  const topics: Array<{ chapter?: string; unit?: string }> = [];
  const seenTopic = new Set<string>();
  for (const r of t.dataRows) {
    const info = rowInfo(r);
    const key = `${info.chapter || ''}|${info.unit || ''}`;
    if ((info.chapter || info.unit) && !seenTopic.has(key)) { seenTopic.add(key); topics.push({ chapter: info.chapter, unit: info.unit }); }
  }
  base.topics = topics;
  base.topicsSummary = topics.map(x => (x.unit ? (x.chapter && x.chapter !== x.unit ? `${x.chapter}: ${x.unit}` : x.unit) : x.chapter)).filter(Boolean).join('\n');

  if (base.ok) {
    const dsConfigs: DungSaiLevelConfig[] = questions.II.map(q => {
      const lv = (letter: string): DungSaiLevel => toDsLevel(q.items.find(i => i.letter === letter)?.level || 'biet');
      return { yA: lv('a'), yB: lv('b'), yC: lv('c'), yD: lv('d') };
    });
    base.questionConfig = {
      type1: { ...commands.I },
      type2: { ...commands.II },
      type3: { ...commands.III },
      essay: { ...commands.IV },
      type2QuestionCount: questions.II.length,
      dungSaiLevelConfigs: dsConfigs,
    };
  } else {
    warnings.push('Không đọc được mã câu / số câu nào trong các cột mức độ của bảng.');
  }

  const lowSignals = !base.ok || footerMismatch || base.codeStyle === 'mixed' || warnings.some(w => /không chia hết|cần đủ 4 ý/.test(w));
  base.confidence = lowSignals ? 'low' : (t.footer.countRow !== undefined || base.codeStyle === 'roman' || base.codeStyle === 'cau') ? 'high' : 'medium';
  return base;
};

// ============================================================================
// 6. MÔN / LỚP / KỲ / THỜI GIAN
// ============================================================================

const SUBJECT_RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'Lịch sử và Địa lí', re: /lịch\s*sử\s*(?:và|&)\s*địa\s*l[íýiy]/ },
  { name: 'Khoa học tự nhiên', re: /khoa\s*học\s*tự\s*nhiên|(?<![a-zà-ỹđ])khtn(?![a-zà-ỹđ])/ },
  { name: 'Giáo dục công dân', re: /giáo\s*dục\s*công\s*dân|(?<![a-zà-ỹđ])gdcd(?![a-zà-ỹđ])|giáo\s*dục\s*kinh\s*tế\s*(?:và|&)\s*pháp\s*luật|(?<![a-zà-ỹđ])gdkt\s*(?:&|và)?\s*pl(?![a-zà-ỹđ])/ },
  { name: 'Giáo dục quốc phòng và an ninh', re: /quốc\s*phòng/ },
  { name: 'Toán học', re: /(?<![a-zà-ỹđ])toán(?![a-zà-ỹđ])/ },
  { name: 'Ngữ văn', re: /ngữ\s*văn/ },
  { name: 'Tiếng Việt', re: /tiếng\s*việt/ },
  { name: 'Tiếng Anh', re: /tiếng\s*anh|(?<![a-z])english(?![a-z])/ },
  { name: 'Vật lí', re: /vật\s*l[íýiy](?![a-zà-ỹđ])/ },
  { name: 'Hóa học', re: /h(?:óa|oá|oa)\s*học/ },
  { name: 'Sinh học', re: /sinh\s*học/ },
  { name: 'Lịch sử', re: /lịch\s*sử/ },
  { name: 'Địa lí', re: /địa\s*l[íýiy](?![a-zà-ỹđ])/ },
  { name: 'Tin học', re: /tin\s*học/ },
  { name: 'Công nghệ', re: /công\s*nghệ/ },
  { name: 'Âm nhạc', re: /âm\s*nhạc/ },
  { name: 'Mĩ thuật', re: /m[ĩỹ]\s*thuật/ },
  { name: 'Giáo dục thể chất', re: /giáo\s*dục\s*thể\s*chất|thể\s*dục/ },
];

/** Chuẩn hoá tên môn về đúng tên trong danh sách chọn môn của app. */
export const normalizeSubjectName = (raw?: string | null): string | undefined => {
  if (!raw) return undefined;
  const t = low(raw);
  for (const r of SUBJECT_RULES) if (r.re.test(t)) return r.name;
  return undefined;
};

/** So sánh 2 tên môn (bỏ khác biệt cách viết: Toán / Toán học, Hoá / Hóa…). */
export const sameSubject = (a?: string, b?: string): boolean => {
  if (!a || !b) return true;
  const na = normalizeSubjectName(a) || low(a);
  const nb = normalizeSubjectName(b) || low(b);
  return na === nb;
};

const KEYWORD_SUBJECTS: Array<{ name: string; re: RegExp }> = [
  { name: 'Vật lí', re: /dao\s*động|sóng\s*cơ|điện\s*trường|từ\s*trường|con\s*lắc|khúc\s*xạ|thấu\s*kính|động\s*lượng|cơ\s*năng|nhiệt\s*động|định\s*luật\s*(?:ôm|newton|niu)/g },
  { name: 'Hóa học', re: /nguyên\s*tử|liên\s*kết\s*hóa\s*học|oxi\s*hóa|ester|este(?![a-zà-ỹ])|polime|polymer|hydrocarbon|hiđrocacbon|carbohydrate|cacbohiđrat|kim\s*loại\s*kiềm|phản\s*ứng\s*hóa\s*học|dung\s*dịch|amin(?![a-zà-ỹ])/g },
  { name: 'Sinh học', re: /tế\s*bào|di\s*truyền|nhiễm\s*sắc\s*thể|sinh\s*thái|tiến\s*hóa|quang\s*hợp|enzyme|gen(?![a-zà-ỹ])|đột\s*biến/g },
  { name: 'Lịch sử', re: /thế\s*kỉ|thế\s*kỷ|triều\s*đại|kháng\s*chiến|cách\s*mạng|chiến\s*tranh|phát\s*kiến|vương\s*triều|nhà\s*(?:lý|trần|lê|nguyễn)/g },
  { name: 'Địa lí', re: /khí\s*hậu|dân\s*cư|vị\s*trí\s*địa\s*lí|kinh\s*tế\s*-?\s*xã\s*hội|khu\s*vực|tài\s*nguyên|lãnh\s*thổ|toàn\s*cầu\s*hoá|toàn\s*cầu\s*hóa/g },
  { name: 'Tin học', re: /thuật\s*toán|lập\s*trình|python|cơ\s*sở\s*dữ\s*liệu|mạng\s*máy\s*tính|phần\s*mềm/g },
  { name: 'Toán học', re: /hàm\s*số|đạo\s*hàm|nguyên\s*hàm|tích\s*phân|phương\s*trình|vectơ|vecto|tọa\s*độ|toạ\s*độ|cấp\s*số|lượng\s*giác|xác\s*suất|tam\s*thức|bất\s*phương\s*trình/g },
];

export const detectMeta = (html: string): MatrixContract['meta'] => {
  const meta: MatrixContract['meta'] = {};
  if (!html) return meta;
  // Văn bản ngoài bảng (tiêu đề, ghi chú) — nơi thường ghi Môn / Lớp / Kỳ
  let outside = html;
  findTopLevelTables(html).reverse().forEach(tb => { outside = outside.slice(0, tb.start) + '\n' + outside.slice(tb.end); });
  const outsideText = htmlToText(outside);
  const fullText = htmlToText(html);
  const title = low(outsideText.slice(0, 800));
  const outsideLow = low(outsideText);
  const fullLow = low(fullText);

  // Môn: "MÔN: ĐỊA LÍ" → tiêu đề có tên môn → từ khoá trong nội dung (cần ≥ 2 lần)
  const monMatch = /môn\s*(?:học)?\s*[:：\-–]?\s*([^\n,;|–\-]{2,40})/.exec(outsideLow) || /môn\s*(?:học)?\s*[:：\-–]?\s*([^\n,;|–\-]{2,40})/.exec(fullLow.slice(0, 1500));
  meta.subject = normalizeSubjectName(monMatch?.[1]);
  if (!meta.subject) {
    for (const r of SUBJECT_RULES) if (r.re.test(title)) { meta.subject = r.name; break; }
  }
  if (!meta.subject) {
    let best: { name: string; n: number } | null = null;
    for (const k of KEYWORD_SUBJECTS) {
      const n = (fullLow.match(k.re) || []).length;
      if (n >= 2 && (!best || n > best.n)) best = { name: k.name, n };
    }
    if (best) meta.subject = best.name;
  }

  // Lớp
  const gradeRe = /(?:lớp|khối)\s*[:：\-]?\s*(1[0-2]|[1-9])(?!\d)/;
  const g = gradeRe.exec(title) ||
    /(?:toán|văn|anh|lí|lý|hóa|hoá|sinh|sử|địa|tin|công\s*nghệ|khtn|gdcd)\s*[-–]?\s*(1[0-2]|[6-9])(?!\d)/.exec(title) ||
    gradeRe.exec(outsideLow) ||
    gradeRe.exec(fullLow.slice(0, 2000));
  if (g) meta.grade = g[1];

  // Kỳ kiểm tra
  const src = `${title}\n${outsideLow.slice(0, 2000)}`;
  const ek = /(giữa|cuối)\s*(?:học\s*)?k[ìỳiy]\s*(ii|2|i|1)(?![a-z0-9])/.exec(src) || /(?<![a-z])(gk|ck)\s*(ii|2|i|1)(?![a-z0-9])/.exec(src);
  if (ek) {
    const kind = /^(giữa|gk)$/.test(ek[1]) ? 'Giữa' : 'Cuối';
    const sem = /^(ii|2)$/.test(ek[2]) ? '2' : '1';
    meta.examType = `${kind} kỳ ${sem}`;
  }

  const d = /(\d{2,3})\s*phút/.exec(outsideLow) || /(\d{2,3})\s*phút/.exec(fullLow.slice(0, 2000));
  if (d) {
    const v = parseInt(d[1], 10);
    if (v >= 15 && v <= 180) meta.duration = v;
  }
  return meta;
};

// ============================================================================
// 7. SO SÁNH MA TRẬN ↔ ĐẶC TẢ, MÔ TẢ CHO PROMPT
// ============================================================================

export const compareContracts = (matrix: MatrixContract, specs: MatrixContract): string[] => {
  const out: string[] = [];
  if (!matrix.ok || !specs.ok) return out;
  QTYPES.forEach(type => {
    const a = matrix.commands[type];
    const b = specs.commands[type];
    const diff = LEVELS.filter(l => a[l] !== b[l]);
    if (diff.length) {
      out.push(`Bảng đặc tả không khớp Ma trận ở Dạng ${type}: ${diff.map(l => `${LEVEL_LABEL[l]} ${b[l]} ≠ ${a[l]}`).join(', ')} (đặc tả ≠ ma trận).`);
    }
  });
  return out;
};

export const sumTypeCommands = (c: MatrixContract, type: QType) => sumLv(c.commands[type]);

/** Tóm tắt 1 dòng để hiển thị cho người dùng. */
export const summarizeContract = (c: MatrixContract): string => {
  const parts: string[] = [];
  if (c.questionCount.I) parts.push(`Dạng I: ${c.questionCount.I} câu`);
  if (c.questionCount.II) parts.push(`Dạng II: ${c.questionCount.II} câu (${sumLv(c.commands.II)} ý)`);
  if (c.questionCount.III) parts.push(`Dạng III: ${c.questionCount.III} câu`);
  if (c.questionCount.IV) parts.push(`Tự luận: ${c.questionCount.IV} câu (${sumLv(c.commands.IV)} lệnh hỏi)`);
  return parts.join(' · ');
};

const levelList = (o: Record<Lvl, number>, withVdc: boolean) =>
  LEVELS.filter(l => withVdc || l !== 'van_dung_cao').map(l => `${LEVEL_LABEL[l]} ${o[l]}`).join(', ');

const clip = (s: string | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : '');

/**
 * Khối "HỢP ĐỒNG SỐ LIỆU" chèn vào prompt: liệt kê TỪNG câu hỏi, mức độ, đơn vị kiến thức, điểm.
 * Đây là nguồn chuẩn để AI sinh đề đúng số câu, đúng mức, đúng bài.
 */
export const buildContractPromptBlock = (c: MatrixContract, opts: { includeQuestionList?: boolean; maxYccd?: number } = {}): string => {
  if (!c.ok) return '';
  const withList = opts.includeQuestionList !== false;
  const maxY = opts.maxYccd ?? 220;
  const lines: string[] = [];
  lines.push('===== HỢP ĐỒNG SỐ LIỆU ĐỌC TRỰC TIẾP TỪ FILE NGƯỜI DÙNG TẢI LÊN (CHUẨN CAO NHẤT — KHÔNG ĐƯỢC THAY ĐỔI) =====');
  const present = QTYPES.filter(type => c.questionCount[type] > 0);
  const absent = QTYPES.filter(type => c.questionCount[type] === 0);
  lines.push(`Các phần CÓ trong ma trận: ${present.map(type => `Phần ${type} (${TYPE_LABEL[type]})`).join(', ')}.`);
  if (absent.length) lines.push(`Các phần KHÔNG có (TUYỆT ĐỐI KHÔNG TẠO): ${absent.map(type => `Phần ${type} (${TYPE_LABEL[type]})`).join(', ')}.`);
  lines.push(`Tổng số lệnh hỏi: ${c.totalCommands}. Mức độ dùng trong file: ${c.hasVDC ? 'Biết – Hiểu – Vận dụng – Vận dụng cao (GIỮ RIÊNG cột Vận dụng cao)' : 'Biết – Hiểu – Vận dụng'}.`);
  if (c.points.fromFile) {
    lines.push(`Thang điểm theo file: ${present.map(type => `Phần ${type}: ${c.points.byType[type] !== undefined ? fmtNum(c.points.byType[type]!) : '?'} điểm`).join(' | ')}${c.points.total !== null ? ` — tổng ${fmtNum(c.points.total)} điểm` : ''}.`);
  }
  present.forEach(type => {
    const qs = c.questions[type];
    const head = type === 'II'
      ? `PHẦN ${type} — ${TYPE_LABEL[type]}: ${qs.length} câu × 4 ý = ${sumLv(c.commands.II)} lệnh hỏi (${levelList(c.commands.II, c.hasVDC)})`
      : type === 'IV'
        ? `PHẦN ${type} — ${TYPE_LABEL[type]}: ${qs.length} câu, ${sumLv(c.commands.IV)} lệnh hỏi (${levelList(c.commands.IV, c.hasVDC)})`
        : `PHẦN ${type} — ${TYPE_LABEL[type]}: ${qs.length} câu (${levelList(c.commands[type], c.hasVDC)})`;
    lines.push('');
    lines.push(head);
    if (!withList) return;
    qs.forEach(q => {
      const where = [q.chapter && q.unit && q.chapter !== q.unit ? `${clip(q.chapter, 80)} › ${clip(q.unit, 100)}` : clip(q.unit || q.chapter, 120)].filter(Boolean).join('');
      const pts = q.points !== undefined ? ` (${fmtNum(q.points)} điểm)` : '';
      let lv: string;
      if (type === 'II') lv = q.items.map(i => `${i.letter}) ${LEVEL_LABEL[i.level]}`).join(', ');
      else if (type === 'IV' && (q.items.length > 1 || q.items[0]?.letter)) lv = q.items.map(i => `ý ${i.letter || '—'}: ${LEVEL_LABEL[i.level]}`).join(', ');
      else lv = LEVEL_LABEL[q.items[0]?.level || 'biet'];
      const y = q.yccd ? ` | YCCĐ: ${clip(oneLine(q.yccd), maxY)}` : '';
      lines.push(`  - Câu ${q.num}${pts} | ${lv}${where ? ` | ${where}` : ''}${y}`);
    });
  });
  lines.push('');
  lines.push('QUY TẮC: Đánh số câu trong mỗi phần đúng như danh sách trên (Câu 1, Câu 2, … của từng phần). Mỗi câu phải đúng đơn vị kiến thức và đúng mức độ đã ghi. Không thêm/bớt câu, không thêm phần.');
  return lines.join('\n');
};

// ============================================================================
// 8. CHỌN NGUỒN SỐ LIỆU & DỰNG KHUNG BẢNG ĐẶC TẢ THEO MA TRẬN TẢI LÊN
// ============================================================================

export interface ResolvedContracts {
  matrix: MatrixContract | null;
  specs: MatrixContract | null;
  /** Nguồn dùng để sinh đề: đặc tả (có YCCĐ) nếu khớp ma trận, ngược lại là ma trận */
  primary: MatrixContract | null;
  primarySource: 'matrix' | 'specs' | null;
  warnings: string[];
}

export const resolveContracts = (matrixHtml?: string | null, specsHtml?: string | null): ResolvedContracts => {
  const matrix = matrixHtml && /<table/i.test(matrixHtml) ? parseMatrixContract(matrixHtml, { prefer: 'matrix' }) : null;
  const specs = specsHtml && /<table/i.test(specsHtml) ? parseMatrixContract(specsHtml, { prefer: 'specs' }) : null;
  const warnings: string[] = [];
  let primary: MatrixContract | null = null;
  if (matrix?.ok && specs?.ok) {
    const diff = compareContracts(matrix, specs);
    if (diff.length) {
      warnings.push(...diff, 'App dùng số liệu của MA TRẬN để sinh đề. Nếu Bảng đặc tả mới đúng, hãy sửa lại Ma trận hoặc tải lại đúng file.');
      primary = matrix;
    } else {
      // Đặc tả khớp ma trận → dùng đặc tả (có Yêu cầu cần đạt), giữ điểm của ma trận nếu đặc tả không ghi
      primary = {
        ...specs,
        meta: { ...specs.meta, ...matrix.meta },
        ...(specs.points.fromFile ? {} : { points: matrix.points, questions: mergePoints(specs, matrix) }),
      };
    }
  } else primary = matrix?.ok ? matrix : specs?.ok ? specs : null;
  const primarySource = !primary ? null : primary === matrix ? 'matrix' : 'specs';
  if (primary && primarySource === 'specs' && matrix) primary.meta = { ...primary.meta, ...matrix.meta };
  return { matrix, specs, primary, primarySource, warnings };
};

const mergePoints = (specs: MatrixContract, matrix: MatrixContract): MatrixContract['questions'] => {
  const out = { I: [], II: [], III: [], IV: [] } as MatrixContract['questions'];
  QTYPES.forEach(type => {
    out[type] = specs.questions[type].map(q => {
      const m = matrix.questions[type].find(x => x.num === q.num);
      return { ...q, points: q.points ?? m?.points };
    });
  });
  return out;
};

/** Số câu/lệnh hỏi của hợp đồng có khớp cấu hình hay không (dùng cho ma trận do AI sinh). */
export const contractMatchesConfig = (c: MatrixContract, cfg: QuestionConfig): boolean => {
  if (!c.ok) return false;
  const eq = (a: Record<Lvl, number>, b: { biet: number; hieu: number; van_dung: number; van_dung_cao: number }) =>
    a.biet === (b.biet || 0) && a.hieu === (b.hieu || 0) && a.van_dung + a.van_dung_cao === (b.van_dung || 0) + (b.van_dung_cao || 0);
  const dsQ = Number.isFinite(cfg.type2QuestionCount) ? cfg.type2QuestionCount! : sumLv(cfg.type2);
  return eq(c.commands.I, cfg.type1) && eq(c.commands.III, cfg.type3) && eq(c.commands.IV, cfg.essay) && c.questionCount.II === dsQ;
};

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * <thead> của Bảng đặc tả dựng từ CHÍNH cấu trúc cột của ma trận tải lên
 * (giữ đúng các dạng, đúng các cột mức độ — kể cả cột Vận dụng cao nếu có), thêm cột "Yêu cầu cần đạt".
 */
export const buildSpecsTheadFromContract = (c: MatrixContract): { thead: string; columnCount: number } | null => {
  if (!c.columns.length) return null;
  const groups: Array<{ type: QType; cols: MatrixContract['columns'] }> = [];
  for (const col of c.columns) {
    const g = groups[groups.length - 1];
    if (g && g.type === col.type) g.cols.push(col);
    else groups.push({ type: col.type, cols: [col] });
  }
  const levelCols = c.columns.length;
  const row1 = `<tr><th rowspan="3" style="width:3%">TT</th><th rowspan="3" style="width:9%">Chủ đề/Chương</th><th rowspan="3" style="width:12%">Nội dung/đơn vị kiến thức</th><th rowspan="3" style="width:30%">Yêu cầu cần đạt</th><th colspan="${levelCols}">Số câu hỏi ở các mức độ đánh giá</th></tr>`;
  const row2 = `<tr>${groups.map(g => `<th colspan="${g.cols.length}">${escHtml(c.typeHeaders[g.type] || TYPE_LABEL[g.type])}</th>`).join('')}</tr>`;
  const row3 = `<tr>${c.columns.map(col => `<th>${escHtml(col.label || LEVEL_LABEL[col.level])}</th>`).join('')}</tr>`;
  return { thead: ['<thead>', row1, row2, row3, '</thead>'].join('\n'), columnCount: 4 + levelCols };
};
