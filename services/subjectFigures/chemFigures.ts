/* Chuyển từ app taodethihoahoc (services/chemFigures.ts), giữ nguyên cách vẽ. */
/**
 * BỘ VẼ HÌNH HÓA HỌC (vector SVG, nét đen trên nền trắng để in đen trắng rõ nét):
 *  - apparatus: bộ thí nghiệm (chưng cất, chiết, chuẩn độ, điện phân, pin Galvani Zn–Cu)
 *  - glassware: các dụng cụ rời có kí hiệu (I), (II)…
 *  - ir / ms: phổ hồng ngoại, phổ khối lượng
 *  - structure: công thức cấu tạo 2D từ SMILES
 *  - haworth: glucose, fructose dạng mạch vòng
 *  - peptide, polymer: chuỗi peptide, mắt xích polymer
 */

const FONT = `font-family="'Times New Roman', Times, serif"`;

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svgWrap = (w: number, h: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#fff"/><g fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</g></svg>`;

/** Chữ có chỉ số: CH3 → số viết nhỏ dưới; "2+" sau dấu ^ → viết nhỏ trên. */
const chemTspans = (text: string, size: number): string => {
  const small = Math.round(size * 0.72);
  const drop = Math.round(size * 0.28);
  let out = '';
  let shift = 0;
  const flush = (t: string, dy: number, fs: number) => {
    const move = dy - shift;
    shift = dy;
    out += `<tspan${move ? ` dy="${move}"` : ''}${fs !== size ? ` font-size="${fs}"` : ''}>${esc(t)}</tspan>`;
  };
  const re = /\^\{?([0-9]*[+\-]?)\}?|([A-Za-z)\]])(\d+)|([^\^]+?)(?=\^|[A-Za-z)\]]\d|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m[0]) {
    if (m[1] !== undefined && m[0].startsWith('^')) flush(m[1], -Math.round(size * 0.36), small);
    else if (m[2]) { flush(m[2], 0, size); flush(m[3], drop, small); }
    else if (m[4]) flush(m[4], 0, size);
  }
  if (shift) out += `<tspan dy="${-shift}" font-size="1"> </tspan>`;
  return out;
};

const label = (x: number, y: number, text: string, opts: { size?: number; anchor?: 'start' | 'middle' | 'end'; italic?: boolean; bold?: boolean } = {}) => {
  const size = opts.size ?? 13;
  return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" fill="#000" stroke="none" text-anchor="${opts.anchor ?? 'middle'}"${opts.italic ? ' font-style="italic"' : ''}${opts.bold ? ' font-weight="bold"' : ''}>${chemTspans(text, size)}</text>`;
};

const line = (x1: number, y1: number, x2: number, y2: number, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra ? ' ' + extra : ''}/>`;
const path = (d: string, extra = '') => `<path d="${d}"${extra ? ' ' + extra : ''}/>`;
const rect = (x: number, y: number, w: number, h: number, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}"${extra ? ' ' + extra : ''}/>`;
const circle = (x: number, y: number, r: number, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}"${extra ? ' ' + extra : ''}/>`;

/** Mũi tên chú thích từ chữ tới vị trí trên hình. */
const callout = (x: number, y: number, tx: number, ty: number, text: string) =>
  line(x, y, tx + (tx < x ? 4 : -4), ty - 4, 'stroke-width="0.8"') + label(tx, ty, text, { size: 12, anchor: tx < x ? 'end' : 'start' });

/* ---------------------------- Dụng cụ rời ---------------------------- */

const liquidHatch = (d: string) => path(d, 'stroke="none" fill="#d9d9d9"');

const glassware = {
  'separatory-funnel': (x: number, y: number) =>
    path(`M${x - 6} ${y} h12 M${x - 4} ${y} v12 C${x + 34} ${y + 40} ${x + 18} ${y + 92} ${x + 3} ${y + 104} V${y + 150} H${x - 3} V${y + 104} C${x - 18} ${y + 92} ${x - 34} ${y + 40} ${x - 4} ${y + 12}`)
    + path(`M${x + 4} ${y} v12`) + rect(x - 11, y + 116, 22, 7, 'fill="#fff"'),
  'graduated-cylinder': (x: number, y: number) =>
    path(`M${x - 13} ${y} V${y + 136} H${x + 13} V${y} M${x - 26} ${y + 136} H${x + 26} V${y + 146} H${x - 26} Z`)
    + Array.from({ length: 7 }, (_v, i) => line(x - 13, y + 18 + i * 17, x - (i % 2 ? 6 : 2), y + 18 + i * 17, 'stroke-width="0.9"')).join(''),
  burette: (x: number, y: number) =>
    path(`M${x - 6} ${y} V${y + 118} L${x - 1.5} ${y + 136} V${y + 150} M${x + 6} ${y} V${y + 118} L${x + 1.5} ${y + 136} V${y + 150}`)
    + rect(x - 10, y + 122, 20, 6, 'fill="#fff"')
    + Array.from({ length: 10 }, (_v, i) => line(x - 6, y + 8 + i * 11, x - (i % 5 ? 2 : -2), y + 8 + i * 11, 'stroke-width="0.8"')).join(''),
  condenser: (x: number, y: number) =>
    path(`M${x - 3} ${y} V${y + 150} M${x + 3} ${y} V${y + 150}`)
    + path(`M${x - 12} ${y + 18} V${y + 132} Q${x} ${y + 138} ${x + 12} ${y + 132} V${y + 18} Q${x} ${y + 12} ${x - 12} ${y + 18}`)
    + path(`M${x + 12} ${y + 30} h14 M${x + 12} ${y + 36} h14 M${x - 12} ${y + 114} h-14 M${x - 12} ${y + 120} h-14`),
  erlenmeyer: (x: number, y: number) =>
    path(`M${x - 7} ${y + 44} V${y + 88} L${x - 36} ${y + 146} H${x + 36} L${x + 7} ${y + 88} V${y + 44} M${x - 10} ${y + 44} H${x + 10}`)
    + Array.from({ length: 3 }, (_v, i) => line(x - 12, y + 112 + i * 9, x + 2, y + 112 + i * 9, 'stroke-width="0.8"')).join(''),
  beaker: (x: number, y: number) =>
    path(`M${x - 38} ${y + 52} l4 5 V${y + 146} H${x + 34} V${y + 57} l4 -5`)
    + Array.from({ length: 4 }, (_v, i) => line(x + 34, y + 72 + i * 18, x + 22, y + 72 + i * 18, 'stroke-width="0.8"')).join(''),
  'round-flask': (x: number, y: number) =>
    path(`M${x - 7} ${y + 40} V${y + 78} A36 36 0 1 0 ${x + 7} ${y + 78} V${y + 40} M${x - 10} ${y + 40} H${x + 10}`),
  'test-tube': (x: number, y: number) =>
    path(`M${x - 11} ${y + 22} V${y + 128} A11 11 0 0 0 ${x + 11} ${y + 128} V${y + 22} M${x - 14} ${y + 22} H${x + 14}`),
  'volumetric-flask': (x: number, y: number) =>
    path(`M${x - 5} ${y} V${y + 88} C${x - 36} ${y + 100} ${x - 36} ${y + 146} ${x - 22} ${y + 146} H${x + 22} C${x + 36} ${y + 146} ${x + 36} ${y + 100} ${x + 5} ${y + 88} V${y}`)
    + line(x - 5, y + 40, x + 5, y + 40),
  pipette: (x: number, y: number) =>
    path(`M${x - 2.5} ${y} V${y + 40} L${x - 8} ${y + 54} V${y + 96} L${x - 2} ${y + 112} V${y + 150} M${x + 2.5} ${y} V${y + 40} L${x + 8} ${y + 54} V${y + 96} L${x + 2} ${y + 112} V${y + 150}`)
    + line(x - 2.5, y + 22, x + 2.5, y + 22),
} as const;

export type GlasswareName = keyof typeof glassware;

export const GLASSWARE_LABELS: Record<GlasswareName, string> = {
  'separatory-funnel': 'Phễu chiết',
  'graduated-cylinder': 'Ống đong',
  burette: 'Burette',
  condenser: 'Ống sinh hàn',
  erlenmeyer: 'Bình tam giác',
  beaker: 'Cốc thủy tinh',
  'round-flask': 'Bình cầu',
  'test-tube': 'Ống nghiệm',
  'volumetric-flask': 'Bình định mức',
  pipette: 'Pipette',
};

const ROMAN = ['(I)', '(II)', '(III)', '(IV)', '(V)', '(VI)', '(VII)', '(VIII)'];

const renderGlasswareSet = (spec: any): string => {
  const items: GlasswareName[] = (Array.isArray(spec.items) ? spec.items : []).filter((n: string) => n in glassware);
  if (!items.length) throw new Error('Thiếu danh sách dụng cụ ("items").');
  const labels: string[] = Array.isArray(spec.labels) ? spec.labels : [];
  const cell = 104;
  const w = cell * items.length + 16;
  const body = items.map((name, i) => {
    const cx = 8 + cell * i + cell / 2;
    return glassware[name](cx, 12) + label(cx, 186, labels[i] ?? ROMAN[i] ?? '', { size: 13 });
  }).join('');
  return svgWrap(w, 198, body);
};

/* ---------------------------- Bộ thí nghiệm ---------------------------- */

const standAt = (x: number, top: number, bottom: number) =>
  rect(x - 3, top, 6, bottom - top) + rect(x - 28, bottom, 92, 8);

const burner = (x: number, y: number) =>
  path(`M${x - 14} ${y + 34} H${x + 14} L${x + 7} ${y + 12} H${x - 7} Z M${x - 2} ${y + 12} V${y + 4}`) + path(`M${x} ${y + 4} C${x - 8} ${y - 6} ${x - 3} ${y - 12} ${x} ${y - 18} C${x + 3} ${y - 12} ${x + 8} ${y - 6} ${x} ${y + 4}`);

const apparatusPresets: Record<string, (labels: Record<string, string>) => string> = {
  distillation: labels => {
    const body =
      // Bình cầu + chất lỏng + đá bọt
      liquidHatch('M72 186 A34 34 0 0 0 132 186 Z')
      + path('M95 120 V148 A36 36 0 1 0 109 148 V120')
      + burner(102, 234)
      // Nhiệt kế
      + rect(99, 72, 6, 74, 'fill="#fff"') + circle(102, 150, 4)
      // Nhánh + ống sinh hàn nghiêng
      + path('M109 130 L150 138')
      + path('M150 134 L330 176 M148 141 L328 183')
      + path('M176 126 L312 158 L306 186 L170 154 Z')
      + path('M198 124 V106 M204 126 V108 M286 178 V198 M292 180 V200')
      + path('M328 180 L338 196')
      // Bình hứng
      + path('M328 206 V222 L304 262 H372 L348 222 V206')
      + liquidHatch('M314 250 L308 262 H368 L362 250 Z')
      + rect(30, 268, 372, 7, 'fill="#fff"');
    return svgWrap(440, 290, body
      + callout(102, 80, 56, 70, labels.thermometer ?? 'Nhiệt kế')
      + callout(84, 170, 56, 146, labels.flask ?? 'Hỗn hợp')
      + callout(250, 150, 300, 110, labels.condenser ?? 'Ống sinh hàn')
      + label(201, 100, labels.waterOut ?? 'Nước ra', { size: 11 })
      + label(289, 214, labels.waterIn ?? 'Nước vào', { size: 11 })
      + callout(350, 250, 386, 232, labels.receiver ?? 'Chất lỏng'));
  },
  extraction: labels => {
    const body =
      standAt(42, 14, 262)
      + path('M42 118 H80') + path('M80 118 A22 5 0 1 0 124 118 A22 5 0 1 0 80 118')
      + path('M96 14 h12 M98 14 v12 C136 54 120 106 105 118 V170 H99 V118 C84 106 68 54 98 26 M106 14 v12')
      + rect(92, 134, 20, 7, 'fill="#fff"')
      + path('M82 60 Q102 54 122 60', 'stroke-dasharray="3 2"')
      + line(86, 84, 118, 84)
      + liquidHatch('M86 84 H118 C116 100 110 112 105 118 H99 C94 112 88 100 86 84 Z')
      + path('M70 196 V258 H134 V196 M70 196 l-4 -4 M134 196 l4 -4')
      + liquidHatch('M71 232 H133 V257 H71 Z');
    return svgWrap(330, 280, body
      + callout(118, 70, 178, 58, labels.upper ?? 'Lớp chất lỏng nhẹ hơn')
      + callout(112, 100, 178, 100, labels.lower ?? 'Lớp chất lỏng nặng hơn')
      + callout(112, 138, 178, 142, labels.stopcock ?? 'Khóa phễu')
      + callout(132, 244, 178, 244, labels.receiver ?? 'Bình hứng'));
  },
  titration: labels => {
    const body =
      standAt(50, 12, 276)
      + path('M50 56 H92') + rect(86, 48, 24, 16, 'fill="#fff"')
      + glassware.burette(98, 12)
      + glassware.erlenmeyer(98, 124)
      + liquidHatch('M72 248 L62 270 H134 L124 248 Z')
      + rect(56, 276, 90, 0);
    return svgWrap(340, 296, body
      + callout(104, 60, 164, 44, labels.titrant ?? 'Dung dịch chuẩn (burette)')
      + callout(106, 138, 164, 128, labels.stopcock ?? 'Khóa burette')
      + callout(122, 256, 164, 234, labels.analyte ?? 'Dung dịch cần chuẩn độ + chỉ thị'));
  },
  electrolysis: labels => {
    const body =
      path('M60 110 V240 H260 V110 M56 106 l4 4 M264 106 l-4 4')
      + liquidHatch('M61 136 H259 V239 H61 Z')
      + rect(100, 84, 14, 124, 'fill="#fff"') + rect(206, 84, 14, 124, 'fill="#fff"')
      + path('M107 84 V40 H142 M213 84 V40 H178')
      + rect(142, 28, 36, 24, 'fill="#fff"') + line(152, 32, 152, 48) + line(166, 36, 166, 44, 'stroke-width="2.4"');
    return svgWrap(320, 262, body
      + label(132, 60, '+', { size: 15, bold: true }) + label(188, 60, '–', { size: 15, bold: true })
      + label(100, 76, labels.anode ?? 'Anode', { size: 12, anchor: 'end' }) + label(220, 76, labels.cathode ?? 'Cathode', { size: 12, anchor: 'start' })
      + label(160, 256, labels.solution ?? 'Dung dịch chất điện li', { size: 12 })
      + label(160, 20, labels.source ?? 'Nguồn điện', { size: 12 }));
  },
  galvanic: labels => {
    const bridge = labels.bridge ?? 'Cầu muối';
    const body =
      path('M30 110 V240 H150 V110 M250 110 V240 H370 V110')
      + liquidHatch('M31 138 H149 V239 H31 Z') + liquidHatch('M251 138 H369 V239 H251 Z')
      + rect(60, 74, 16, 136, 'fill="#fff"') + rect(324, 74, 16, 136, 'fill="#fff"')
      + path('M68 74 V38 H178 M332 74 V38 H222')
      + circle(200, 38, 22, 'fill="#fff"')
      + path('M116 186 V92 Q116 76 132 76 H268 Q284 76 284 92 V186 M132 186 V92 H268 V186', 'fill="#fff"');
    return svgWrap(400, 262, body
      + label(200, 43, labels.meter ?? 'V', { size: 15, bold: true })
      + label(50, 66, labels.left ?? 'Zn', { size: 13, bold: true }) + label(350, 66, labels.right ?? 'Cu', { size: 13, bold: true })
      + label(200, 108, bridge, { size: 12 })
      + label(90, 256, labels.leftSolution ?? 'Dung dịch ZnSO4', { size: 12 })
      + label(310, 256, labels.rightSolution ?? 'Dung dịch CuSO4', { size: 12 }));
  },
};

export const APPARATUS_LABELS: Record<string, string> = {
  distillation: 'Chưng cất',
  extraction: 'Chiết lỏng – lỏng',
  titration: 'Chuẩn độ acid – base',
  electrolysis: 'Bình điện phân',
  galvanic: 'Pin Galvani Zn–Cu',
};

/* ---------------------------- Phổ IR, MS ---------------------------- */

const num = (v: unknown, name: string): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Giá trị "${name}" không phải là số.`);
  return n;
};

const renderIr = (spec: any): string => {
  const peaks: Array<{ wavenumber: number; transmittance: number; width: number; label?: string }> =
    (spec.peaks || []).map((p: any) => ({
      wavenumber: num(p.wavenumber ?? p.x, 'wavenumber'),
      transmittance: Math.max(2, Math.min(95, num(p.transmittance ?? p.t ?? 20, 'transmittance'))),
      width: Number(p.width) || (num(p.wavenumber ?? p.x, 'wavenumber') > 2500 ? 90 : 26),
      label: p.label,
    }));
  if (!peaks.length) throw new Error('Phổ IR cần ít nhất một đỉnh ("peaks").');
  const W = 560, H = 270, left = 54, right = 18, top = 26, bottom = 46;
  const plotW = W - left - right, plotH = H - top - bottom;
  const xOf = (wn: number) => left + ((4000 - wn) / 3500) * plotW;
  const yOf = (t: number) => top + ((100 - t) / 100) * plotH;
  // Đường cong = 92% trừ các đỉnh hấp thụ dạng Lorentz (tất định, cùng dữ liệu cùng hình)
  const curve = (wn: number) => {
    let absorb = 0;
    peaks.forEach(p => { absorb += (92 - p.transmittance) / (1 + ((wn - p.wavenumber) / (p.width / 2)) ** 2); });
    return Math.max(2, 92 - absorb);
  };
  let d = '';
  for (let wn = 4000; wn >= 500; wn -= 4) d += `${d ? 'L' : 'M'}${xOf(wn).toFixed(1)} ${yOf(curve(wn)).toFixed(1)} `;
  let axes = rect(left, top, plotW, plotH);
  [4000, 3500, 3000, 2500, 2000, 1500, 1000, 500].forEach(wn => {
    axes += line(xOf(wn), top + plotH, xOf(wn), top + plotH + 5) + label(xOf(wn), top + plotH + 19, String(wn), { size: 11 });
  });
  [0, 20, 40, 60, 80, 100].forEach(t => {
    axes += line(left - 5, yOf(t), left, yOf(t)) + label(left - 8, yOf(t) + 4, String(t), { size: 11, anchor: 'end' });
  });
  const peakLabels = peaks.filter(p => p.label).map(p =>
    p.transmittance < 22
      ? label(xOf(p.wavenumber) + 8, yOf(p.transmittance) + 4, String(p.label), { size: 11, anchor: 'start' })
      : line(xOf(p.wavenumber), yOf(p.transmittance) + 3, xOf(p.wavenumber), yOf(p.transmittance) + 12, 'stroke-width="0.8"')
        + label(xOf(p.wavenumber), yOf(p.transmittance) + 24, String(p.label), { size: 11 })).join('');
  return svgWrap(W, H, axes + path(d) + peakLabels
    + label(left + plotW / 2, H - 8, spec.xLabel || 'Số sóng (cm^-1)', { size: 12 })
    + `<text transform="translate(14 ${top + plotH / 2}) rotate(-90)" ${FONT} font-size="12" fill="#000" stroke="none" text-anchor="middle">Độ truyền qua (%)</text>`
    + (spec.title ? label(left + plotW / 2, 17, String(spec.title), { size: 12, italic: true }) : ''));
};

const renderMs = (spec: any): string => {
  const peaks: Array<{ mz: number; intensity: number; label?: string }> = (spec.peaks || []).map((p: any) => ({
    mz: num(p.mz ?? p.x, 'mz'), intensity: Math.max(0, Math.min(100, num(p.intensity ?? p.y, 'intensity'))), label: p.label,
  }));
  if (!peaks.length) throw new Error('Phổ MS cần ít nhất một đỉnh ("peaks").');
  const maxMz = Math.ceil(Math.max(...peaks.map(p => p.mz)) / 10 + 1) * 10;
  const W = 540, H = 270, left = 54, right = 18, top = 26, bottom = 46;
  const plotW = W - left - right, plotH = H - top - bottom;
  const xOf = (mz: number) => left + (mz / maxMz) * plotW;
  const yOf = (v: number) => top + ((100 - v) / 100) * plotH;
  let body = rect(left, top, plotW, plotH);
  for (let mz = 0; mz <= maxMz; mz += maxMz > 120 ? 20 : 10) {
    body += line(xOf(mz), top + plotH, xOf(mz), top + plotH + 5) + label(xOf(mz), top + plotH + 19, String(mz), { size: 11 });
  }
  [0, 20, 40, 60, 80, 100].forEach(v => {
    body += line(left - 5, yOf(v), left, yOf(v)) + label(left - 8, yOf(v) + 4, String(v), { size: 11, anchor: 'end' });
  });
  peaks.forEach(p => {
    body += line(xOf(p.mz), yOf(0), xOf(p.mz), yOf(p.intensity), 'stroke-width="2"');
    const showMz = p.intensity >= 8 || p.mz === spec.molecularIon;
    if (showMz) body += label(xOf(p.mz), yOf(p.intensity) - 4, p.label ? String(p.label) : String(p.mz), { size: 11 });
  });
  return svgWrap(W, H, body
    + label(left + plotW / 2, H - 8, 'm/z', { size: 12, italic: true })
    + `<text transform="translate(14 ${top + plotH / 2}) rotate(-90)" ${FONT} font-size="12" fill="#000" stroke="none" text-anchor="middle">Cường độ tương đối (%)</text>`
    + (spec.title ? label(left + plotW / 2, 17, String(spec.title), { size: 12, italic: true }) : ''));
};

/* ---------------------------- Công thức cấu tạo từ SMILES ---------------------------- */

interface Atom { el: string; aromatic: boolean; charge: number; hExplicit: number | null; x: number; y: number; placed: boolean; ring: boolean }
interface Bond { a: number; b: number; order: number }

const VALENCE: Record<string, number> = { C: 4, N: 3, O: 2, S: 2, P: 3, F: 1, Cl: 1, Br: 1, I: 1, H: 1 };

export const parseSmiles = (smiles: string): { atoms: Atom[]; bonds: Bond[] } => {
  const atoms: Atom[] = [];
  const bonds: Bond[] = [];
  const stack: number[] = [];
  const rings: Record<string, { atom: number; order: number }> = {};
  let prev = -1;
  let pendingOrder = 0;
  const addAtom = (el: string, aromatic: boolean, charge = 0, hExplicit: number | null = null) => {
    atoms.push({ el, aromatic, charge, hExplicit, x: 0, y: 0, placed: false, ring: false });
    const idx = atoms.length - 1;
    if (prev >= 0) bonds.push({ a: prev, b: idx, order: pendingOrder || (aromatic && atoms[prev].aromatic ? 1.5 : 1) });
    prev = idx;
    pendingOrder = 0;
  };
  for (let i = 0; i < smiles.length; i++) {
    const c = smiles[i];
    if (c === '(') stack.push(prev);
    else if (c === ')') prev = stack.pop() ?? -1;
    else if (c === '-') pendingOrder = 1;
    else if (c === '=') pendingOrder = 2;
    else if (c === '#') pendingOrder = 3;
    else if (c === '/' || c === '\\' || c === '@') continue;
    else if (c === '[') {
      const end = smiles.indexOf(']', i);
      if (end < 0) throw new Error('SMILES thiếu dấu ].');
      const m = /^([A-Z][a-z]?|[cnos])(H(\d*))?([+-]\d?|\+\+|--)?$/.exec(smiles.slice(i + 1, end));
      if (!m) throw new Error(`SMILES không đọc được: [${smiles.slice(i + 1, end)}]`);
      const chargeStr = m[4] || '';
      const charge = !chargeStr ? 0 : chargeStr === '++' ? 2 : chargeStr === '--' ? -2 : (chargeStr[0] === '+' ? 1 : -1) * (parseInt(chargeStr.slice(1), 10) || 1);
      addAtom(m[1][0].toUpperCase() + m[1].slice(1), /^[a-z]/.test(m[1]), charge, m[2] ? (m[3] ? parseInt(m[3], 10) : 1) : 0);
      i = end;
    } else if (/\d/.test(c)) {
      const open = rings[c];
      if (open) {
        const order = pendingOrder || open.order || (atoms[open.atom].aromatic && atoms[prev].aromatic ? 1.5 : 1);
        bonds.push({ a: open.atom, b: prev, order });
        delete rings[c];
      } else rings[c] = { atom: prev, order: pendingOrder };
      pendingOrder = 0;
    } else if (c === 'C' && smiles[i + 1] === 'l') { addAtom('Cl', false); i++; }
    else if (c === 'B' && smiles[i + 1] === 'r') { addAtom('Br', false); i++; }
    else if (/[CNOSPFI]/.test(c)) addAtom(c, false);
    else if (/[cnos]/.test(c)) addAtom(c.toUpperCase(), true);
    else throw new Error(`SMILES có kí tự lạ: "${c}"`);
  }
  if (!atoms.length) throw new Error('SMILES rỗng.');
  return { atoms, bonds };
};

const findRings = (atoms: Atom[], bonds: Bond[]): number[][] => {
  const adj = atoms.map(() => [] as number[]);
  bonds.forEach(b => { adj[b.a].push(b.b); adj[b.b].push(b.a); });
  const parent = new Array(atoms.length).fill(-2);
  const rings: number[][] = [];
  const dfs = (u: number, p: number) => {
    parent[u] = p;
    adj[u].forEach(v => {
      if (v === p) return;
      if (parent[v] === -2) dfs(v, u);
      else if (v < u && !rings.some(r => r.includes(u) && r.includes(v))) {
        const ring = [u];
        let w = u;
        while (w !== v && w >= 0) { w = parent[w]; ring.push(w); }
        if (w === v) rings.push(ring);
      }
    });
  };
  atoms.forEach((_a, i) => { if (parent[i] === -2) dfs(i, -1); });
  return rings;
};

const BOND_LEN = 34;

const layoutMolecule = (atoms: Atom[], bonds: Bond[]) => {
  const adj = atoms.map(() => [] as number[]);
  bonds.forEach(b => { adj[b.a].push(b.b); adj[b.b].push(b.a); });
  const rings = findRings(atoms, bonds);
  const ringOf = new Map<number, number[]>();
  rings.forEach(r => r.forEach(i => { atoms[i].ring = true; ringOf.set(i, r); }));

  const placeRing = (ring: number[], fromIdx: number, dirAngle: number) => {
    // Vòng đều, nhận fromIdx làm đỉnh; tâm nằm theo hướng đi tới
    const start = ring.indexOf(fromIdx);
    const ordered = [...ring.slice(start), ...ring.slice(0, start)];
    const n = ordered.length;
    const radius = BOND_LEN / (2 * Math.sin(Math.PI / n));
    const cx = atoms[fromIdx].x + radius * Math.cos(dirAngle);
    const cy = atoms[fromIdx].y + radius * Math.sin(dirAngle);
    const a0 = dirAngle + Math.PI;
    ordered.forEach((idx, k) => {
      if (atoms[idx].placed) return;
      const ang = a0 + (2 * Math.PI * k) / n;
      atoms[idx].x = cx + radius * Math.cos(ang);
      atoms[idx].y = cy + radius * Math.sin(ang);
      atoms[idx].placed = true;
    });
    return { cx, cy };
  };

  const visit = (u: number, incoming: number, flip: number) => {
    const ring = ringOf.get(u);
    if (ring && !ring.every(i => atoms[i].placed)) {
      const { cx, cy } = placeRing(ring, u, incoming);
      ring.forEach(r => {
        const out = Math.atan2(atoms[r].y - cy, atoms[r].x - cx);
        adj[r].filter(v => !atoms[v].placed).forEach((v, i, list) => {
          const angle = list.length === 1 ? out : out + (i - (list.length - 1) / 2) * (Math.PI / 3);
          atoms[v].x = atoms[r].x + BOND_LEN * Math.cos(angle);
          atoms[v].y = atoms[r].y + BOND_LEN * Math.sin(angle);
          atoms[v].placed = true;
          visit(v, angle, 1);
        });
      });
      return;
    }
    const next = adj[u].filter(v => !atoms[v].placed);
    const spreads = next.length === 1 ? [flip * Math.PI / 3]
      : next.length === 2 ? [Math.PI / 3, -Math.PI / 3]
      : [Math.PI / 2, 0, -Math.PI / 2];
    next.forEach((v, i) => {
      const angle = incoming + (spreads[i] ?? 0);
      atoms[v].x = atoms[u].x + BOND_LEN * Math.cos(angle);
      atoms[v].y = atoms[u].y + BOND_LEN * Math.sin(angle);
      atoms[v].placed = true;
      visit(v, angle, -flip);
    });
  };

  atoms[0].placed = true;
  visit(0, -Math.PI / 6, 1);
  return rings;
};

const atomLabel = (atom: Atom, bonds: Bond[], idx: number): string => {
  const order = bonds.filter(b => b.a === idx || b.b === idx).reduce((s, b) => s + (b.order === 1.5 ? 1 : b.order), 0);
  const aromaticBonus = atom.aromatic ? 1 : 0;
  const hCount = atom.hExplicit ?? Math.max(0, (VALENCE[atom.el] ?? 0) + atom.charge * (atom.el === 'N' ? 1 : atom.el === 'O' ? 1 : 0) - order - aromaticBonus);
  const h = hCount > 0 ? `H${hCount > 1 ? hCount : ''}` : '';
  const chargeText = atom.charge ? `^${Math.abs(atom.charge) > 1 ? Math.abs(atom.charge) : ''}${atom.charge > 0 ? '+' : '-'}` : '';
  return `${atom.el}${h}${chargeText}`;
};

const renderStructure = (spec: any): string => {
  const smiles = String(spec.smiles || '').trim();
  const { atoms, bonds } = parseSmiles(smiles);
  const rings = layoutMolecule(atoms, bonds);
  const pad = 28;
  const minX = Math.min(...atoms.map(a => a.x)) - pad;
  const maxX = Math.max(...atoms.map(a => a.x)) + pad;
  const minY = Math.min(...atoms.map(a => a.y)) - pad;
  const maxY = Math.max(...atoms.map(a => a.y)) + pad;
  const showCaption = !!spec.caption;
  const W = Math.max(90, Math.round(maxX - minX));
  const H = Math.round(maxY - minY) + (showCaption ? 24 : 0);
  const px = (a: Atom) => a.x - minX;
  const py = (a: Atom) => a.y - minY;
  const labelled = (a: Atom) => a.el !== 'C' || a.charge !== 0;

  const trim = (x1: number, y1: number, x2: number, y2: number, startLabel: boolean, endLabel: boolean) => {
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const cut = 11;
    return [x1 + (startLabel ? ux * cut : 0), y1 + (startLabel ? uy * cut : 0), x2 - (endLabel ? ux * cut : 0), y2 - (endLabel ? uy * cut : 0)];
  };

  // Kekulé cho vòng thơm: liên kết xen kẽ đơn – đôi
  const aromaticDouble = new Set<Bond>();
  rings.forEach(ring => {
    if (!ring.every(i => atoms[i].aromatic)) return;
    ring.forEach((idx, k) => {
      if (k % 2 !== 0) return;
      const nxt = ring[(k + 1) % ring.length];
      const bond = bonds.find(b => (b.a === idx && b.b === nxt) || (b.b === idx && b.a === nxt));
      if (bond) aromaticDouble.add(bond);
    });
  });

  let body = '';
  bonds.forEach(b => {
    const A = atoms[b.a], B = atoms[b.b];
    const [x1, y1, x2, y2] = trim(px(A), py(A), px(B), py(B), labelled(A), labelled(B));
    const order = aromaticDouble.has(b) ? 2 : b.order === 1.5 ? 1 : b.order;
    body += line(+x1.toFixed(1), +y1.toFixed(1), +x2.toFixed(1), +y2.toFixed(1));
    if (order >= 2) {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      let nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
      const ring = rings.find(r => r.includes(b.a) && r.includes(b.b));
      if (ring) {
        // Nét đôi trong vòng vẽ vào phía tâm vòng
        const cx = ring.reduce((s, i) => s + px(atoms[i]), 0) / ring.length;
        const cy = ring.reduce((s, i) => s + py(atoms[i]), 0) / ring.length;
        if (((x1 + x2) / 2 + nx - cx) ** 2 + ((y1 + y2) / 2 + ny - cy) ** 2 > ((x1 + x2) / 2 - cx) ** 2 + ((y1 + y2) / 2 - cy) ** 2) { nx = -nx; ny = -ny; }
      }
      const off = ring ? 4.5 : 3.6;
      const shrink = ring ? 0.14 : 0;
      const sx = x1 + (x2 - x1) * shrink, sy = y1 + (y2 - y1) * shrink;
      const ex = x2 - (x2 - x1) * shrink, ey = y2 - (y2 - y1) * shrink;
      body += line(+(sx + nx * off).toFixed(1), +(sy + ny * off).toFixed(1), +(ex + nx * off).toFixed(1), +(ey + ny * off).toFixed(1));
      if (order === 3) body += line(+(sx - nx * off).toFixed(1), +(sy - ny * off).toFixed(1), +(ex - nx * off).toFixed(1), +(ey - ny * off).toFixed(1));
    }
  });
  atoms.forEach((a, i) => {
    if (!labelled(a)) return;
    body += label(+px(a).toFixed(1), +(py(a) + 5).toFixed(1), atomLabel(a, bonds, i), { size: 14 });
  });
  if (showCaption) body += label(W / 2, H - 7, String(spec.caption), { size: 12, italic: true });
  return svgWrap(W, H, body);
};

/* ---------------------------- Haworth ---------------------------- */

type Sub = [up: string, down: string];

const HAWORTH: Record<string, { ring: 'pyranose' | 'furanose'; subs: Sub[]; name: string }> = {
  'alpha-glucose': { ring: 'pyranose', name: 'α-glucose', subs: [['H', 'OH'], ['H', 'OH'], ['OH', 'H'], ['H', 'OH'], ['CH2OH', 'H']] },
  'beta-glucose': { ring: 'pyranose', name: 'β-glucose', subs: [['OH', 'H'], ['H', 'OH'], ['OH', 'H'], ['H', 'OH'], ['CH2OH', 'H']] },
  'alpha-fructose': { ring: 'furanose', name: 'α-fructose', subs: [['CH2OH', 'OH'], ['OH', 'H'], ['H', 'OH'], ['CH2OH', 'H']] },
  'beta-fructose': { ring: 'furanose', name: 'β-fructose', subs: [['OH', 'CH2OH'], ['OH', 'H'], ['H', 'OH'], ['CH2OH', 'H']] },
};

const renderHaworth = (spec: any): string => {
  const sugar = HAWORTH[String(spec.sugar || spec.name || '').toLowerCase()];
  if (!sugar) throw new Error('Haworth chỉ có: alpha-glucose, beta-glucose, alpha-fructose, beta-fructose.');
  const pyranose = sugar.ring === 'pyranose';
  // Tọa độ vòng theo chiều kim đồng hồ từ carbon anomer; O ở phía sau bên phải (pyranose) hoặc đỉnh sau (furanose)
  const ringPts: Array<[number, number]> = pyranose
    ? [[222, 102], [172, 140], [96, 140], [46, 102], [92, 64]]
    : [[214, 100], [176, 134], [100, 134], [62, 100]];
  const oxygen: [number, number] = pyranose ? [176, 64] : [138, 70];
  const closed = [...ringPts, oxygen];
  let body = '';
  closed.forEach((p, i) => {
    const q = closed[(i + 1) % closed.length];
    const toO = i === closed.length - 1 || i === closed.length - 2;
    const front = !toO && (pyranose ? i < 3 : i < 3);
    const fromO = closed[i] === oxygen || q === oxygen;
    const [x1, y1, x2, y2] = fromO
      ? (() => {
          const start = closed[i] === oxygen;
          const dx = q[0] - p[0], dy = q[1] - p[1];
          const len = Math.hypot(dx, dy);
          return start
            ? [p[0] + dx / len * 9, p[1] + dy / len * 9, q[0], q[1]]
            : [p[0], p[1], q[0] - dx / len * 9, q[1] - dy / len * 9];
        })()
      : [p[0], p[1], q[0], q[1]];
    body += line(+x1.toFixed(1), +y1.toFixed(1), +x2.toFixed(1), +y2.toFixed(1), front ? 'stroke-width="3.6"' : '');
  });
  body += label(oxygen[0], oxygen[1] + 5, 'O', { size: 14 });
  sugar.subs.forEach(([up, down], i) => {
    const [x, y] = ringPts[i];
    const stem = 22;
    body += line(x, y, x, y - stem) + line(x, y, x, y + stem);
    const anchor = i === 0 ? 'start' : i === ringPts.length - 1 ? 'end' : 'middle';
    const shift = i === 0 ? -8 : i === ringPts.length - 1 ? 8 : 0;
    body += label(x + shift, y - stem - 4, up, { size: 13, anchor });
    body += label(x + shift, y + stem + 14, down, { size: 13, anchor });
  });
  return svgWrap(280, 214, body + label(140, 204, spec.caption || sugar.name, { size: 13, italic: true }));
};

/* ---------------------------- Peptide, polymer ---------------------------- */

const SIDE_CHAINS: Record<string, string> = { gly: 'H', ala: 'CH3', val: 'CH(CH3)2', leu: 'CH2CH(CH3)2', ser: 'CH2OH', lys: '[CH2]4NH2', glu: '[CH2]2COOH', phe: 'CH2C6H5', tyr: 'CH2C6H4OH' };

const renderPeptide = (spec: any): string => {
  const residues: string[] = Array.isArray(spec.residues) ? spec.residues : [];
  if (!residues.length) throw new Error('Thiếu danh sách gốc amino acid ("residues").');
  const step = 112;
  const W = 86 + step * residues.length + 70;
  let body = label(40, 66, 'H2N', { size: 14 });
  residues.forEach((res, i) => {
    const x = 62 + step * i;
    const r = SIDE_CHAINS[String(res).toLowerCase()] ?? String(res);
    body += line(x, 61, x + 22, 61);
    body += label(x + 34, 66, 'CH', { size: 14 }) + line(x + 34, 70, x + 34, 88) + label(x + 34, 104, r, { size: 13 });
    body += line(x + 46, 61, x + 64, 61);
    body += label(x + 74, 66, 'C', { size: 14 });
    body += line(x + 71, 52, x + 71, 34) + line(x + 77, 52, x + 77, 34) + label(x + 74, 28, 'O', { size: 14 });
    if (i < residues.length - 1) {
      body += line(x + 83, 61, x + 92, 61) + label(x + 104, 66, 'N', { size: 14 }) + label(x + 104, 88, 'H', { size: 13 }) + line(x + 104, 70, x + 104, 76);
    } else {
      body += line(x + 83, 61, x + 96, 61) + label(x + 112, 66, 'OH', { size: 14 });
    }
  });
  // Chữ N trùng điểm đầu gốc kế tiếp: nét nối đã bắt đầu từ x tiếp theo
  const H = spec.caption ? 136 : 118;
  if (spec.caption) body += label(W / 2, 128, String(spec.caption), { size: 12, italic: true });
  return svgWrap(W, H, body);
};

const POLYMER_UNITS: Record<string, { unit: string; name: string }> = {
  pe: { unit: 'CH2–CH2', name: 'polyethylene' },
  pp: { unit: 'CH2–CH(CH3)', name: 'polypropylene' },
  pvc: { unit: 'CH2–CHCl', name: 'poly(vinyl chloride)' },
  ps: { unit: 'CH2–CH(C6H5)', name: 'polystyrene' },
  pan: { unit: 'CH2–CH(CN)', name: 'polyacrylonitrile' },
  pmma: { unit: 'CH2–C(CH3)(COOCH3)', name: 'poly(methyl methacrylate)' },
  capron: { unit: 'NH–[CH2]5–CO', name: 'nylon-6 (capron)' },
  'nylon-6,6': { unit: 'NH–[CH2]6–NH–CO–[CH2]4–CO', name: 'nylon-6,6' },
  'cao-su-buna': { unit: 'CH2–CH=CH–CH2', name: 'polybuta-1,3-diene (cao su buna)' },
};

const renderPolymer = (spec: any): string => {
  const preset = POLYMER_UNITS[String(spec.preset || '').toLowerCase()];
  const unit = String(spec.unit || preset?.unit || '');
  if (!unit) throw new Error('Thiếu mắt xích polymer ("unit" hoặc "preset").');
  const textW = unit.replace(/\d/g, '').length * 9.4 + 20;
  const W = Math.round(textW + 84);
  const name = spec.caption || preset?.name;
  const H = name ? 84 : 62;
  const bx1 = 32, bx2 = bx1 + textW;
  const body =
    line(8, 34, bx1 - 2, 34) + line(bx2 + 2, 34, bx2 + 24, 34)
    + path(`M${bx1 + 6} 12 Q${bx1 - 4} 34 ${bx1 + 6} 56`) + path(`M${bx2 - 6} 12 Q${bx2 + 4} 34 ${bx2 - 6} 56`)
    + label((bx1 + bx2) / 2, 39, unit, { size: 14 })
    + label(bx2 + 8, 58, 'n', { size: 13, italic: true })
    + (name ? label(W / 2, 77, String(name), { size: 12, italic: true }) : '');
  return svgWrap(W, H, body);
};

/* ---------------------------- Điểm vào ---------------------------- */

export const CHEM_FIGURE_TYPES = ['apparatus', 'glassware', 'ir', 'ms', 'structure', 'haworth', 'peptide', 'polymer'] as const;

export const renderChemFigure = (spec: any): string => {
  const type = String(spec?.type || '').toLowerCase();
  switch (type) {
    case 'apparatus': {
      const draw = apparatusPresets[String(spec.preset || '').toLowerCase()];
      if (!draw) throw new Error(`Không có bộ thí nghiệm "${spec.preset}". Chọn: ${Object.keys(apparatusPresets).join(', ')}.`);
      return draw(spec.labels || {});
    }
    case 'glassware': return renderGlasswareSet(spec);
    case 'ir': return renderIr(spec);
    case 'ms': return renderMs(spec);
    case 'structure': return renderStructure(spec);
    case 'haworth': return renderHaworth(spec);
    case 'peptide': return renderPeptide(spec);
    case 'polymer': return renderPolymer(spec);
    default: throw new Error(`Loại hình "${spec?.type}" không được hỗ trợ.`);
  }
};
