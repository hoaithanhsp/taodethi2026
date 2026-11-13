/**
 * Các hàm vẽ SVG dùng chung cho Studio Vật lí và Sinh học:
 * nét đen trên nền trắng, chữ Times New Roman để in đen trắng rõ như đề in.
 */

export const FONT = `font-family="'Times New Roman', Times, serif"`;

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const svgWrap = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}"><rect width="${Math.round(w)}" height="${Math.round(h)}" fill="#fff"/><g fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

export const f1 = (n: number) => +n.toFixed(1);

/**
 * Chữ có chỉ số: "R1" → 1 viết nhỏ dưới; "x_0" → 0 dưới; "^A" hoặc "^{2+}" → viết nhỏ trên.
 * Dùng cho nhãn kiểu R1, E1, X^A, A' …
 */
export const richTspans = (text: string, size: number): string => {
  const small = Math.round(size * 0.7);
  let out = '';
  let shift = 0;
  const emit = (t: string, dy: number, fs: number) => {
    if (!t) return;
    const move = dy - shift;
    shift = dy;
    out += `<tspan${move ? ` dy="${move}"` : ''}${fs !== size ? ` font-size="${fs}"` : ''}>${esc(t)}</tspan>`;
  };
  const re = /\^\{([^}]*)\}|\^(.)|_\{([^}]*)\}|_(\w)|([A-Za-zĐđΩωαφλΔ'])(\d+)(?![\d.,])|([^^_]+?)(?=\^|_|[A-Za-zĐđΩωαφλΔ']\d|$)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m[0]) {
    if (m[1] !== undefined || m[2] !== undefined) emit(m[1] ?? m[2], -Math.round(size * 0.38), small);
    else if (m[3] !== undefined || m[4] !== undefined) emit(m[3] ?? m[4], Math.round(size * 0.28), small);
    else if (m[5]) { emit(m[5], 0, size); emit(m[6], Math.round(size * 0.28), small); }
    else if (m[7]) emit(m[7], 0, size);
  }
  if (shift) out += `<tspan dy="${-shift}" font-size="1"> </tspan>`;
  return out;
};

export interface TextOpts { size?: number; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; bold?: boolean; rich?: boolean }

export const text = (x: number, y: number, t: string, opts: TextOpts = {}) => {
  const size = opts.size ?? 13;
  const content = opts.rich === false ? esc(t) : richTspans(t, size);
  return `<text x="${f1(x)}" y="${f1(y)}" ${FONT} font-size="${size}" fill="#000" stroke="none" text-anchor="${opts.anchor ?? 'middle'}"${opts.italic ? ' font-style="italic"' : ''}${opts.bold ? ' font-weight="bold"' : ''}>${content}</text>`;
};

export const line = (x1: number, y1: number, x2: number, y2: number, extra = '') =>
  `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"${extra ? ' ' + extra : ''}/>`;
export const path = (d: string, extra = '') => `<path d="${d}"${extra ? ' ' + extra : ''}/>`;
export const rect = (x: number, y: number, w: number, h: number, extra = '') =>
  `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}"${extra ? ' ' + extra : ''}/>`;
export const circle = (x: number, y: number, r: number, extra = '') =>
  `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}"${extra ? ' ' + extra : ''}/>`;

/** Đầu mũi tên đặc tại (x2, y2), hướng từ (x1, y1). */
export const arrowHead = (x1: number, y1: number, x2: number, y2: number, size = 8) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p1 = [x2 - size * Math.cos(a - 0.38), y2 - size * Math.sin(a - 0.38)];
  const p2 = [x2 - size * Math.cos(a + 0.38), y2 - size * Math.sin(a + 0.38)];
  return path(`M${f1(x2)} ${f1(y2)} L${f1(p1[0])} ${f1(p1[1])} L${f1(p2[0])} ${f1(p2[1])} Z`, 'fill="#000"');
};

export const arrow = (x1: number, y1: number, x2: number, y2: number, extra = '', size = 8) =>
  line(x1, y1, x2, y2, extra) + arrowHead(x1, y1, x2, y2, size);

/** Nhãn vectơ: chữ kèm mũi tên nhỏ phía trên (P⃗, N⃗ …). */
export const vecLabel = (x: number, y: number, name: string, size = 14) => {
  const w = Math.max(8, name.replace(/[_^{}]/g, '').length * size * 0.5);
  const top = y - size * 0.95;
  return text(x, y, name, { size, italic: true }) + arrow(x - w / 2, top, x + w / 2 + 1, top, 'stroke-width="0.9"', 4);
};

export const num = (v: unknown, name: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Giá trị "${name}" không phải là số.`);
  return n;
};

/** Số đẹp cho nhãn trục: bỏ đuôi 0, dấu phẩy thập phân kiểu Việt Nam. */
export const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return String(r).replace('.', ',');
};

/** Bước chia trục "đẹp" (1, 2, 5 × 10^k). */
export const niceStep = (range: number, target = 5) => {
  const raw = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
};

/** Trục tọa độ có mũi tên, gốc O; trả về cả phần thân để vẽ tiếp. */
export const axes = (ox: number, oy: number, x2: number, yTop: number, xLabel: string, yLabel: string, yBottom = oy) =>
  arrow(ox, yBottom, ox, yTop, '', 8)
  + arrow(ox, oy, x2, oy, '', 8)
  + text(ox - 8, oy + 15, 'O', { size: 13, italic: true, anchor: 'end' })
  + text(x2, oy + 18, xLabel, { size: 13, italic: true, anchor: 'end' })
  + text(ox + 8, yTop + 4, yLabel, { size: 13, italic: true, anchor: 'start' });
