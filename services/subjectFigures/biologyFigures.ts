/**
 * BỘ VẼ HÌNH SINH HỌC (vector SVG, nét đen trên nền trắng như đề in):
 *  - pedigree: sơ đồ phả hệ (nam □, nữ ○, tô đen = bị bệnh), tự nối vợ chồng và con cái
 *  - punnett: khung Punnett, tự tách giao tử từ kiểu gen bố mẹ (kể cả gen trên X: XAXa × XaY)
 *  - foodweb: lưới thức ăn, tự xếp bậc dinh dưỡng (sinh vật sản xuất ở dưới cùng)
 *  - chart: biểu đồ cột / đường từ bảng số liệu (in đen trắng phân biệt bằng mẫu tô)
 */
import { arrow, circle, esc, f1, FONT, fmt, line, niceStep, num, path, rect, svgWrap, text } from './svgKit';

/* ---------------------------- Phả hệ ---------------------------- */

export interface PedigreePerson { id: string; sex: 'M' | 'F'; affected: boolean; parents?: [string, string] | null }
export interface PedigreeSpec { type: 'pedigree'; generations: PedigreePerson[][]; couples: Array<[string, string]>; legend?: boolean; caption?: string }

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/**
 * Đọc phả hệ viết gọn, mỗi dòng một thế hệ:
 *   I: 1M = 2F
 *   II: [1-2] 3M* 4F = 5M
 *   III: [4-5] 6F 7M*
 * M = nam, F = nữ, * = bị bệnh; "a = b" là vợ chồng; [a-b] ghi bố mẹ của những người đứng sau
 * (người đứng ngay sau dấu "=" là người ngoài gia đình, không có bố mẹ trong sơ đồ).
 */
export const parsePedigreeText = (input: string): PedigreeSpec => {
  const generations: PedigreePerson[][] = [];
  const couples: Array<[string, string]> = [];
  const seen = new Set<string>();
  input.split('\n').map(l => l.trim()).filter(Boolean).forEach((raw, row) => {
    const lineText = raw.replace(/^[IVX]+\s*[:.]\s*/i, '');
    const people: PedigreePerson[] = [];
    let parents: [string, string] | null = null;
    let pendingSpouse: string | null = null;
    const tokens: string[] = lineText.match(/\[[^\]]*\]|=|[^\s=\[\],;]+/g) ?? [];
    tokens.forEach(tok => {
      if (tok.startsWith('[')) {
        const m = /^\[\s*(\w+)\s*[-–,+]\s*(\w+)\s*\]$/.exec(tok);
        if (!m) throw new Error(`Dòng ${row + 1}: không đọc được bố mẹ "${tok}" (viết dạng [1-2]).`);
        parents = [m[1], m[2]];
        return;
      }
      if (tok === '=') {
        if (!people.length) throw new Error(`Dòng ${row + 1}: dấu "=" phải đứng giữa hai người.`);
        pendingSpouse = people[people.length - 1].id;
        return;
      }
      const m = /^(\w+?)([MFmf])(\*?)$/.exec(tok);
      if (!m) throw new Error(`Dòng ${row + 1}: không đọc được "${tok}" (viết dạng 3M, 4F hoặc 5M*).`);
      const id = m[1];
      if (seen.has(id)) throw new Error(`Số ${id} bị dùng hai lần.`);
      seen.add(id);
      const sex = m[2].toUpperCase() === 'M' ? 'M' : 'F';
      const person: PedigreePerson = { id, sex, affected: m[3] === '*', parents: pendingSpouse ? null : parents };
      if (pendingSpouse) { couples.push([pendingSpouse, id]); pendingSpouse = null; }
      people.push(person);
    });
    if (pendingSpouse) throw new Error(`Dòng ${row + 1}: thiếu người đứng sau dấu "=".`);
    generations.push(people);
  });
  if (!generations.length) throw new Error('Phả hệ trống.');
  return { type: 'pedigree', generations, couples, legend: true };
};

const SHAPE = 26;

const personShape = (p: PedigreePerson, x: number, y: number) => {
  const fill = p.affected ? 'fill="#000"' : 'fill="#fff"';
  return p.sex === 'M' ? rect(x - SHAPE / 2, y - SHAPE / 2, SHAPE, SHAPE, fill) : circle(x, y, SHAPE / 2, fill);
};

const renderPedigree = (spec: any): string => {
  const gens: PedigreePerson[][] = Array.isArray(spec.generations) ? spec.generations : [];
  if (!gens.length || !gens.some(g => g.length)) throw new Error('Phả hệ cần ít nhất một thế hệ ("generations").');
  const couples: Array<[string, string]> = Array.isArray(spec.couples) ? spec.couples : [];
  const step = 62, rowH = 92, left = 58, top = 34;
  const widest = Math.max(...gens.map(g => g.length));
  const contentW = (widest - 1) * step;
  const pos = new Map<string, { x: number; y: number }>();
  gens.forEach((g, r) => {
    const offset = ((widest - g.length) * step) / 2;
    g.forEach((p, i) => pos.set(String(p.id), { x: left + offset + i * step, y: top + r * rowH }));
  });
  let body = '';
  // Vợ chồng
  couples.forEach(([a, b]) => {
    const A = pos.get(String(a)), B = pos.get(String(b));
    if (!A || !B) return;
    const [l, r] = A.x < B.x ? [A, B] : [B, A];
    body += line(l.x + SHAPE / 2, l.y, r.x - SHAPE / 2, r.y);
  });
  // Con cái: gom theo cặp bố mẹ
  const families = new Map<string, PedigreePerson[]>();
  gens.flat().forEach(p => {
    if (!p.parents) return;
    const key = p.parents.map(String).join('|');
    families.set(key, [...(families.get(key) || []), p]);
  });
  families.forEach((kids, key) => {
    const [a, b] = key.split('|');
    const A = pos.get(a), B = pos.get(b);
    if (!A || !B) throw new Error(`Không tìm thấy bố mẹ ${a}, ${b} trong sơ đồ.`);
    const midX = (A.x + B.x) / 2;
    const kidPos = kids.map(k => pos.get(String(k.id))!);
    const barY = kidPos[0].y - SHAPE / 2 - 22;
    const xs = [...kidPos.map(k => k.x), midX];
    body += line(midX, A.y, midX, barY) + line(Math.min(...xs), barY, Math.max(...xs), barY);
    kidPos.forEach(k => { body += line(k.x, barY, k.x, k.y - SHAPE / 2); });
  });
  gens.forEach((g, r) => {
    body += text(18, top + r * rowH + 5, ROMAN[r] || String(r + 1), { size: 14, bold: true, rich: false });
    g.forEach(p => {
      const P = pos.get(String(p.id))!;
      body += personShape(p, P.x, P.y) + text(P.x, P.y + SHAPE / 2 + 15, String(p.id), { size: 12, rich: false });
    });
  });
  let H = top + (gens.length - 1) * rowH + 40;
  let W = Math.max(left + contentW + 50, 300);
  if (spec.legend !== false) {
    const ly = H + 8;
    const items: Array<[PedigreePerson, string]> = [
      [{ id: '', sex: 'M', affected: false }, 'Nam bình thường'],
      [{ id: '', sex: 'F', affected: false }, 'Nữ bình thường'],
      [{ id: '', sex: 'M', affected: true }, 'Nam bị bệnh'],
      [{ id: '', sex: 'F', affected: true }, 'Nữ bị bệnh'],
    ];
    items.forEach(([p, label], i) => {
      const x = 30 + (i % 2) * 150, y = ly + Math.floor(i / 2) * 26;
      body += `<g transform="translate(${x} ${y}) scale(0.62) translate(${-x} ${-y})">${personShape(p, x, y)}</g>` + text(x + 16, y + 5, label, { size: 12, anchor: 'start', rich: false });
    });
    H = ly + 46;
    W = Math.max(W, 330);
  }
  if (spec.caption) { body += text(W / 2, H + 6, String(spec.caption), { size: 12, italic: true, rich: false }); H += 18; }
  return svgWrap(W, H, body);
};

/* ---------------------------- Khung Punnett ---------------------------- */

/** Tách kiểu gen thành các cặp alen: "AaBb" → [[A,a],[B,b]]; "XAXa" → [[XA,Xa]]; "XAY" → [[XA,Y]]. */
export const splitGenotype = (genotype: string): string[][] => {
  const g = genotype.replace(/\s+/g, '');
  if (!g) throw new Error('Thiếu kiểu gen.');
  if (/X/.test(g)) {
    const alleles = g.match(/X[A-Za-z]?|Y/g) || [];
    const rest = g.replace(/X[A-Za-z]?|Y/g, '');
    if (alleles.length !== 2) throw new Error(`Kiểu gen "${genotype}" cần đúng 2 NST giới tính (ví dụ XAXa, XAY).`);
    return [...(rest ? splitGenotype(rest) : []), alleles];
  }
  if (g.length % 2) throw new Error(`Kiểu gen "${genotype}" phải gồm từng cặp alen (ví dụ Aa, AaBb).`);
  const pairs: string[][] = [];
  for (let i = 0; i < g.length; i += 2) {
    if (g[i].toLowerCase() !== g[i + 1].toLowerCase()) throw new Error(`Cặp "${g[i]}${g[i + 1]}" không cùng một gen.`);
    pairs.push([g[i], g[i + 1]]);
  }
  return pairs;
};

/** Giao tử theo phân li độc lập, bỏ trùng, giữ thứ tự. */
export const gametesOf = (genotype: string): string[][] => {
  const pairs = splitGenotype(genotype);
  let out: string[][] = [[]];
  pairs.forEach(pair => { out = out.flatMap(g => [...new Set(pair)].map(a => [...g, a])); });
  const seen = new Set<string>();
  return out.filter(g => { const k = g.join(''); if (seen.has(k)) return false; seen.add(k); return true; });
};

/** Hợp tử từ hai giao tử: alen trội viết trước, NST X viết trước Y. */
const zygote = (a: string[], b: string[]) =>
  a.map((x, i) => [x, b[i]].sort((p, q) => {
    if (p.startsWith('X') !== q.startsWith('X')) return p.startsWith('X') ? -1 : 1;
    const pu = p.replace('X', ''), qu = q.replace('X', '');
    return pu === pu.toUpperCase() && qu !== qu.toUpperCase() ? -1 : qu === qu.toUpperCase() && pu !== pu.toUpperCase() ? 1 : 0;
  }).join(''));

/** Viết alen trên NST X dạng chỉ số trên: XA → X^A. */
const allele = (a: string) => a.replace(/X([A-Za-z])/g, 'X^$1');

const renderPunnett = (spec: any): string => {
  const mother = String(spec.mother ?? spec.female ?? '');
  const father = String(spec.father ?? spec.male ?? '');
  const gm = gametesOf(mother), gf = gametesOf(father);
  if (splitGenotype(mother).length !== splitGenotype(father).length) throw new Error('Bố và mẹ phải có cùng số cặp gen.');
  if (gm.length > 8 || gf.length > 8) throw new Error('Khung Punnett chỉ vẽ tối đa 8 loại giao tử mỗi bên.');
  const cell = Math.max(54, 22 * gm[0].length + 18);
  const left = 34 + cell, top = 70 + 26;
  const W = left + cell * gf.length + 16;
  const H = top + cell * gm.length + 16;
  let body = text(W / 2, 22, `P: ${allele(mother)} × ${allele(father)}`, { size: 14, bold: true });
  body += text(left + (cell * gf.length) / 2, 52, '♂ giao tử', { size: 12, italic: true, rich: false });
  body += `<text transform="translate(16 ${f1(top + (cell * gm.length) / 2)}) rotate(-90)" ${FONT} font-size="12" font-style="italic" fill="#000" stroke="none" text-anchor="middle">${esc('♀ giao tử')}</text>`;
  body += rect(left - cell + 6, top - 26, cell - 6, 26, 'stroke-width="0.8"');
  gf.forEach((g, c) => { body += rect(left + cell * c, top - 26, cell, 26) + text(left + cell * c + cell / 2, top - 8, allele(g.join('')), { size: 13, bold: true }); });
  gm.forEach((g, r) => {
    body += rect(left - cell + 6, top + cell * r, cell - 6, cell) + text(left - cell / 2 + 3, top + cell * r + cell / 2 + 5, allele(g.join('')), { size: 13, bold: true });
    gf.forEach((h, c) => {
      body += rect(left + cell * c, top + cell * r, cell, cell);
      body += text(left + cell * c + cell / 2, top + cell * r + cell / 2 + 5, allele(zygote(g, h).join('')), { size: 13 });
    });
  });
  return svgWrap(W, H, body);
};

/* ---------------------------- Lưới thức ăn ---------------------------- */

/** "Cỏ -> Thỏ, Châu chấu" (mỗi dòng: loài bị ăn -> các loài ăn nó). */
export const parseFoodWebText = (input: string) => {
  const links: Array<[string, string]> = [];
  const nodes: string[] = [];
  const add = (n: string) => { if (!nodes.includes(n)) nodes.push(n); };
  input.split('\n').map(l => l.trim()).filter(Boolean).forEach((l, i) => {
    const parts = l.split(/\s*(?:->|→|=>)\s*/);
    if (parts.length < 2) throw new Error(`Dòng ${i + 1}: cần dạng "Cỏ -> Thỏ, Châu chấu".`);
    for (let k = 0; k + 1 < parts.length; k++) {
      const from = parts[k].split(/\s*,\s*/).filter(Boolean);
      const to = parts[k + 1].split(/\s*,\s*/).filter(Boolean);
      from.forEach(a => { add(a); to.forEach(b => { add(b); links.push([a, b]); }); });
    }
  });
  return { type: 'foodweb', nodes, links };
};

const renderFoodWeb = (spec: any): string => {
  const links: Array<[string, string]> = (Array.isArray(spec.links) ? spec.links : []).map((l: any) => [String(l[0]), String(l[1])]);
  const nodes: string[] = Array.isArray(spec.nodes) && spec.nodes.length ? spec.nodes.map(String) : [...new Set(links.flat())];
  if (!links.length) throw new Error('Lưới thức ăn cần ít nhất một mũi tên ("links").');
  const level = new Map<string, number>(nodes.map(n => [n, 0]));
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    links.forEach(([a, b]) => {
      const want = (level.get(a) ?? 0) + 1;
      if ((level.get(b) ?? 0) < want) { level.set(b, want); changed = true; }
    });
    if (!changed) break;
  }
  const maxLevel = Math.max(...level.values());
  const rows: string[][] = Array.from({ length: maxLevel + 1 }, () => []);
  nodes.forEach(n => rows[level.get(n) ?? 0].push(n));
  const boxW = (n: string) => Math.max(56, n.length * 8.2 + 20);
  const rowGap = 84, boxH = 30, padX = 30;
  const rowWidth = (r: string[]) => r.reduce((s, n) => s + boxW(n), 0) + (r.length - 1) * 34;
  const W = Math.max(...rows.map(rowWidth)) + padX * 2;
  const H = (maxLevel + 1) * rowGap + 20;
  const box = new Map<string, { x: number; y: number; w: number }>();
  rows.forEach((r, lv) => {
    let x = (W - rowWidth(r)) / 2;
    const y = H - 30 - lv * rowGap;
    r.forEach(n => { const w = boxW(n); box.set(n, { x: x + w / 2, y, w }); x += w + 34; });
  });
  const edgePoint = (b: { x: number; y: number; w: number }, tx: number, ty: number) => {
    const dx = tx - b.x, dy = ty - b.y;
    const sx = dx ? (b.w / 2 + 3) / Math.abs(dx) : Infinity;
    const sy = dy ? (boxH / 2 + 3) / Math.abs(dy) : Infinity;
    const k = Math.min(sx, sy);
    return [b.x + dx * k, b.y + dy * k];
  };
  let body = '';
  links.forEach(([a, b]) => {
    const A = box.get(a)!, B = box.get(b)!;
    const [x1, y1] = edgePoint(A, B.x, B.y);
    const [x2, y2] = edgePoint(B, A.x, A.y);
    body += arrow(x1, y1, x2, y2, 'stroke-width="1.2"', 8);
  });
  box.forEach((b, n) => {
    body += rect(b.x - b.w / 2, b.y - boxH / 2, b.w, boxH, 'rx="8" fill="#fff"') + text(b.x, b.y + 5, n, { size: 13, rich: false });
  });
  return svgWrap(W, H, body);
};

/* ---------------------------- Biểu đồ số liệu ---------------------------- */

const FILLS = ['#000', '#9a9a9a', '#fff', '#d4d4d4'];

const renderChart = (spec: any): string => {
  const categories: string[] = (Array.isArray(spec.categories) ? spec.categories : []).map(String);
  const series: Array<{ name: string; values: number[] }> = (Array.isArray(spec.series) ? spec.series : []).map((s: any, i: number) => ({
    name: String(s.name ?? `Dãy ${i + 1}`),
    values: (Array.isArray(s.values) ? s.values : []).map((v: unknown) => num(v, 'values')),
  }));
  if (!categories.length || !series.length) throw new Error('Biểu đồ cần "categories" và ít nhất một dãy "series".');
  if (series.some(s => s.values.length !== categories.length)) throw new Error('Mỗi dãy số liệu phải có đủ giá trị cho từng mục.');
  const isLine = String(spec.kind || 'bar').toLowerCase() === 'line';
  const all = series.flatMap(s => s.values);
  const yMax = Math.max(0, ...all), yMin = Math.min(0, ...all);
  const stepY = niceStep(yMax - yMin || 1);
  const top = 40, plotH = 210, left = 70;
  const slot = Math.max(56, isLine ? 60 : series.length * 22 + 26);
  const plotW = slot * categories.length;
  const hi = Math.ceil(yMax / stepY) * stepY, lo = Math.floor(yMin / stepY) * stepY;
  const Y = (v: number) => top + ((hi - v) / ((hi - lo) || 1)) * plotH;
  const oy = Y(0);
  let body = '';
  for (let v = lo; v <= hi + 1e-9; v += stepY) {
    body += line(left - 4, Y(v), left + plotW, Y(v), v === 0 ? '' : 'stroke-width="0.5" stroke-dasharray="3 3"') + text(left - 8, Y(v) + 4, fmt(v), { size: 11, anchor: 'end', rich: false });
  }
  body += line(left, top - 8, left, top + plotH);
  categories.forEach((c, i) => { body += text(left + slot * i + slot / 2, top + plotH + 18, c, { size: 12, rich: false }); });
  if (isLine) {
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => [left + slot * i + slot / 2, Y(v)]);
      body += path(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join(' '), `stroke-width="1.8"${k % 2 ? ' stroke-dasharray="6 4"' : ''}`);
      pts.forEach(([x, y]) => { body += k % 2 ? rect(x - 3.5, y - 3.5, 7, 7, 'fill="#fff"') : circle(x, y, 3.6, 'fill="#000"'); });
      if (spec.showValues !== false) s.values.forEach((v, i) => { body += text(pts[i][0], pts[i][1] - 8, fmt(v), { size: 11, rich: false }); });
    });
  } else {
    const bw = Math.min(26, (slot - 18) / series.length);
    series.forEach((s, k) => {
      s.values.forEach((v, i) => {
        const x = left + slot * i + (slot - bw * series.length) / 2 + bw * k;
        const y = Math.min(Y(v), oy), h = Math.abs(Y(v) - oy);
        body += rect(x, y, bw, h, `fill="${FILLS[k % FILLS.length]}"`);
        if (spec.showValues !== false) body += text(x + bw / 2, (v >= 0 ? y - 4 : y + h + 12), fmt(v), { size: 10, rich: false });
      });
    });
  }
  body += text(left + plotW, top + plotH + 36, String(spec.xLabel ?? ''), { size: 12, italic: true, anchor: 'end', rich: false });
  body += text(left - 8, top - 16, String(spec.yLabel ?? ''), { size: 12, italic: true, anchor: 'start', rich: false });
  let H = top + plotH + 44;
  if (series.length > 1) {
    series.forEach((s, k) => {
      const x = left + k * 150, y = H + 4;
      body += isLine
        ? line(x, y, x + 26, y, `stroke-width="1.8"${k % 2 ? ' stroke-dasharray="6 4"' : ''}`)
        : rect(x, y - 7, 18, 12, `fill="${FILLS[k % FILLS.length]}"`);
      body += text(x + 32, y + 4, s.name, { size: 12, anchor: 'start', rich: false });
    });
    H += 22;
  }
  if (spec.title) { body += text(left + plotW / 2, 18, String(spec.title), { size: 13, bold: true, rich: false }); }
  return svgWrap(left + plotW + 30, H, body);
};

/* ---------------------------- Điểm vào ---------------------------- */

export const BIOLOGY_FIGURE_TYPES = ['pedigree', 'punnett', 'foodweb', 'chart'] as const;

export const renderBiologyFigure = (spec: any): string => {
  switch (String(spec?.type || '').toLowerCase()) {
    case 'pedigree': return renderPedigree(spec);
    case 'punnett': return renderPunnett(spec);
    case 'foodweb': return renderFoodWeb(spec);
    case 'chart': return renderChart(spec);
    default: throw new Error(`Loại hình Sinh học "${spec?.type}" không được hỗ trợ.`);
  }
};

