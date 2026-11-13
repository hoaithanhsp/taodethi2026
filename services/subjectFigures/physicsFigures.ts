/**
 * BỘ VẼ HÌNH VẬT LÍ (vector SVG, nét đen trên nền trắng như đề in):
 *  - circuit: mạch điện mắc nối tiếp / song song (điện trở, biến trở, đèn, ampe kế, vôn kế, tụ, cuộn cảm, khóa K, nguồn)
 *  - forces: vật trên mặt phẳng nghiêng hoặc mặt phẳng ngang với các lực P, N, F, Fms
 *  - lens: đường truyền tia sáng qua thấu kính hội tụ / phân kì, tự tính vị trí và độ lớn ảnh
 *  - motion-graph: đồ thị chuyển động (v – t, x – t …) từ các điểm gấp khúc
 *  - oscillation: đồ thị dao động điều hòa x = A cos(2πt/T + φ)
 */
import { arrow, arrowHead, axes, circle, f1, fmt, line, num, path, rect, svgWrap, text, vecLabel } from './svgKit';

/* ---------------------------- Mạch điện ---------------------------- */

export type CircuitElementKind = 'resistor' | 'rheostat' | 'bulb' | 'ammeter' | 'voltmeter' | 'capacitor' | 'inductor' | 'switch' | 'source';

export const CIRCUIT_ELEMENT_LABELS: Record<CircuitElementKind, string> = {
  resistor: 'Điện trở',
  rheostat: 'Biến trở',
  bulb: 'Bóng đèn',
  ammeter: 'Ampe kế',
  voltmeter: 'Vôn kế',
  capacitor: 'Tụ điện',
  inductor: 'Cuộn cảm',
  switch: 'Khóa K',
  source: 'Nguồn điện',
};

interface CircuitElement { kind: CircuitElementKind; label?: string }

const MASK = 'fill="#fff" stroke="none"';

/** Vẽ một linh kiện nằm ngang, tâm (cx, cy); tự che đoạn dây phía dưới bằng nền trắng. */
const drawElement = (el: CircuitElement, cx: number, cy: number): string => {
  let body = '';
  switch (el.kind) {
    case 'resistor':
      body = rect(cx - 18, cy - 7, 36, 14, 'fill="#fff"');
      break;
    case 'rheostat':
      body = rect(cx - 18, cy - 7, 36, 14, 'fill="#fff"') + arrow(cx - 16, cy + 13, cx + 17, cy - 15, '', 6);
      break;
    case 'bulb':
      body = circle(cx, cy, 11, 'fill="#fff"') + line(cx - 7.8, cy - 7.8, cx + 7.8, cy + 7.8) + line(cx - 7.8, cy + 7.8, cx + 7.8, cy - 7.8);
      break;
    case 'ammeter':
    case 'voltmeter':
      body = circle(cx, cy, 12, 'fill="#fff"') + text(cx, cy + 5, el.kind === 'ammeter' ? 'A' : 'V', { size: 14, bold: true, rich: false });
      break;
    case 'capacitor':
      body = rect(cx - 6, cy - 14, 12, 28, MASK) + line(cx - 4, cy - 13, cx - 4, cy + 13, 'stroke-width="2"') + line(cx + 4, cy - 13, cx + 4, cy + 13, 'stroke-width="2"');
      break;
    case 'inductor':
      body = rect(cx - 20, cy - 2, 40, 4, MASK)
        + path(`M${cx - 20} ${cy} a5 5 0 0 1 10 0 a5 5 0 0 1 10 0 a5 5 0 0 1 10 0 a5 5 0 0 1 10 0`);
      break;
    case 'switch':
      body = rect(cx - 15, cy - 3, 30, 6, MASK) + circle(cx - 14, cy, 2.4, 'fill="#fff"') + circle(cx + 14, cy, 2.4, 'fill="#fff"') + line(cx - 12, cy - 1, cx + 12, cy - 13);
      break;
    case 'source':
      body = rect(cx - 6, cy - 16, 12, 32, MASK) + line(cx - 4, cy - 14, cx - 4, cy + 14) + line(cx + 4, cy - 7, cx + 4, cy + 7, 'stroke-width="3.2"');
      break;
    default:
      throw new Error(`Không có linh kiện "${(el as any).kind}".`);
  }
  return body;
};

const elementLabel = (el: CircuitElement, cx: number, cy: number, below = false) => {
  const fallback = el.kind === 'switch' ? 'K' : '';
  const t = el.label ?? fallback;
  if (!t) return '';
  const lift = el.kind === 'rheostat' || el.kind === 'capacitor' || el.kind === 'source' ? 22 : 17;
  return text(cx, below ? cy + lift + 12 : cy - lift, t, { size: 13, italic: true });
};

const normElements = (list: unknown): CircuitElement[] =>
  (Array.isArray(list) ? list : []).map((e: any) => {
    const kind = String(typeof e === 'string' ? e : e?.kind || '').toLowerCase() as CircuitElementKind;
    if (!(kind in CIRCUIT_ELEMENT_LABELS)) throw new Error(`Linh kiện "${kind}" không có. Chọn: ${Object.keys(CIRCUIT_ELEMENT_LABELS).join(', ')}.`);
    return { kind, label: typeof e === 'object' && e?.label !== undefined ? String(e.label) : undefined };
  });

const dot = (x: number, y: number) => circle(x, y, 3, 'fill="#000"');

/** Đọc linh kiện viết gọn: "R1, A, K" → điện trở R1, ampe kế, khóa K. Rb = biến trở, Đ = đèn, V = vôn kế, C = tụ, L = cuộn cảm. */
export const parseCircuitElements = (input: string): Array<{ kind: CircuitElementKind; label?: string }> =>
  input.split(/[,;]/).map(s => s.trim()).filter(Boolean).map(tok => {
    if (/^Rb/i.test(tok)) return { kind: 'rheostat', label: tok };
    if (/^R/i.test(tok)) return { kind: 'resistor', label: tok };
    if (/^[ĐD]/.test(tok)) return { kind: 'bulb', label: tok };
    if (/^A\d*$/.test(tok)) return { kind: 'ammeter', label: tok === 'A' ? '' : tok };
    if (/^V\d*$/.test(tok)) return { kind: 'voltmeter', label: tok === 'V' ? '' : tok };
    if (/^C/.test(tok)) return { kind: 'capacitor', label: tok };
    if (/^L/.test(tok)) return { kind: 'inductor', label: tok };
    if (/^K/i.test(tok)) return { kind: 'switch', label: tok };
    throw new Error(`Không nhận ra linh kiện "${tok}". Dùng R, Rb, Đ, A, V, C, L, K.`);
  });

const renderCircuit = (spec: any): string => {
  const sourceLabel = spec.source === false ? '' : String(spec.source?.label ?? spec.sourceLabel ?? 'E, r');
  const main = normElements(spec.elements);
  const branches = (Array.isArray(spec.branches) ? spec.branches : []).map(normElements).filter((b: CircuitElement[]) => b.length);
  const left = 78;
  const step = 72;
  const top = 46;
  let body = '';

  // Nguồn đặt dọc ở cạnh trái
  const drawSource = (bottom: number) => {
    if (spec.source === false) return '';
    const my = (top + bottom) / 2;
    return `<g transform="rotate(90 ${left} ${f1(my)})">${drawElement({ kind: 'source' }, left, my)}</g>`
      + text(left - 22, my + 5, sourceLabel, { size: 13, italic: true, anchor: 'end' });
  };

  if (!branches.length) {
    if (!main.length) throw new Error('Mạch điện cần ít nhất một linh kiện ("elements").');
    const right = left + step * (main.length + 1);
    const bottom = top + 120;
    body += rect(left, top, right - left, bottom - top);
    main.forEach((el, i) => {
      const cx = left + step * (i + 1);
      body += drawElement(el, cx, top) + elementLabel(el, cx, top);
    });
    body += drawSource(bottom);
    return svgWrap(right + 40, bottom + 30, body);
  }

  if (branches.length < 2) throw new Error('Mạch song song cần ít nhất 2 nhánh ("branches").');
  const xa = left + step * (main.length + 1) - (main.length ? 0 : 22);
  const longest = Math.max(...branches.map((b: CircuitElement[]) => b.length));
  const xb = xa + step * (longest + 1);
  const right = xb + 46;
  const gap = 66;
  const ys = branches.map((_b: CircuitElement[], i: number) => top + gap * i);
  const lastY = ys[ys.length - 1];
  const bottom = lastY + 56;

  body += line(left, top, xa, top) + line(left, top, left, bottom) + line(left, bottom, right, bottom) + line(right, bottom, right, top) + line(xb, top, right, top);
  body += line(xa, top, xa, lastY) + line(xb, top, xb, lastY);
  branches.forEach((branch: CircuitElement[], i: number) => {
    const y = ys[i];
    body += line(xa, y, xb, y);
    const span = (xb - xa) / (branch.length + 1);
    branch.forEach((el, k) => {
      const cx = xa + span * (k + 1);
      body += drawElement(el, cx, y) + elementLabel(el, cx, y, i > 0 && el.kind !== 'rheostat');
    });
    if (i < branches.length - 1) body += dot(xa, y) + dot(xb, y);
  });
  main.forEach((el, i) => {
    const cx = left + (xa - left) * (i + 1) / (main.length + 1);
    body += drawElement(el, cx, top) + elementLabel(el, cx, top);
  });
  const nodes: string[] = Array.isArray(spec.nodeLabels) ? spec.nodeLabels : ['A', 'B'];
  if (nodes[0]) body += text(xa - 4, top - 9, nodes[0], { size: 13, italic: true, anchor: 'end' });
  if (nodes[1]) body += text(xb + 4, top - 9, nodes[1], { size: 13, italic: true, anchor: 'start' });
  body += drawSource(bottom);
  return svgWrap(right + 30, bottom + 30, body);
};

/* ---------------------------- Lực tác dụng lên vật ---------------------------- */

const hatchUnder = (x1: number, x2: number, y: number) => {
  let out = line(x1, y, x2, y, 'stroke-width="1.8"');
  for (let x = x1 + 6; x < x2; x += 12) out += line(x, y + 1, x - 8, y + 9, 'stroke-width="0.9"');
  return out;
};

/** Mũi tên lực từ (x, y) theo hướng (ux, uy), kèm nhãn vectơ ở đầu mũi tên. */
const force = (x: number, y: number, ux: number, uy: number, len: number, name: string) => {
  const x2 = x + ux * len, y2 = y + uy * len;
  const lx = x2 + ux * 16 + (Math.abs(uy) > 0.85 ? 16 : 0);
  const ly = y2 + uy * 16 + 5 + (Math.abs(ux) > 0.85 ? -10 : 0);
  return arrow(x, y, x2, y2, 'stroke-width="1.8"', 9) + vecLabel(lx, ly, name);
};

const renderForces = (spec: any): string => {
  const forces: string[] = (Array.isArray(spec.forces) ? spec.forces : ['P', 'N', 'Fms']).map((f: unknown) => String(f));
  const has = (name: string) => forces.some(f => f.toLowerCase() === name.toLowerCase());
  const names = Object.assign({ P: 'P', N: 'N', F: 'F', Fms: 'F_{ms}' }, spec.labels || {});
  let body = '';

  if (String(spec.setup || 'incline').toLowerCase() === 'horizontal') {
    body += hatchUnder(30, 390, 230);
    body += rect(160, 180, 90, 50, 'fill="#fff"');
    const gx = 205, gy = 205;
    body += circle(gx, gy, 2.2, 'fill="#000"');
    if (has('P')) body += force(gx, gy, 0, 1, 78, names.P);
    if (has('N')) body += force(gx, gy, 0, -1, 72, names.N);
    if (has('F')) {
      const b = (num(spec.fAngle ?? 0, 'fAngle') * Math.PI) / 180;
      body += force(gx, gy, Math.cos(b), -Math.sin(b), 92, names.F);
      if (b) body += line(gx, gy, gx + 60, gy, 'stroke-dasharray="4 3" stroke-width="0.9"')
        + path(`M${gx + 34} ${gy} A34 34 0 0 0 ${f1(gx + 34 * Math.cos(b))} ${f1(gy - 34 * Math.sin(b))}`, 'stroke-width="0.9"')
        + text(gx + 46, gy - 8, 'α', { size: 13, italic: true, anchor: 'start' });
    }
    if (has('Fms')) body += force(160, 228, -1, 0, 70, names.Fms);
    return svgWrap(420, 320, body);
  }

  const deg = Math.max(10, Math.min(60, num(spec.angle ?? 30, 'angle')));
  const a = (deg * Math.PI) / 180;
  let L = 320;
  if (L * Math.tan(a) > 210) L = 210 / Math.tan(a);
  const Ax = 50, Ay = 300;
  const Bx = Ax + L, Cy = Ay - L * Math.tan(a);
  body += path(`M${Ax} ${Ay} L${f1(Bx)} ${Ay} L${f1(Bx)} ${f1(Cy)} Z`, 'stroke-width="1.6"');
  body += hatchUnder(Ax - 20, Bx + 20, Ay);
  body += path(`M${Ax + 40} ${Ay} A40 40 0 0 0 ${f1(Ax + 40 * Math.cos(a))} ${f1(Ay - 40 * Math.sin(a))}`, 'stroke-width="0.9"');
  body += text(Ax + 52, Ay - 8, 'α', { size: 14, italic: true, anchor: 'start' });

  const hyp = L / Math.cos(a);
  const ux = Math.cos(a), uy = -Math.sin(a); // hướng lên dốc
  const nx = -Math.sin(a), ny = -Math.cos(a); // pháp tuyến hướng ra ngoài mặt dốc
  const s = hyp * 0.5;
  const px = Ax + ux * s, py = Ay + uy * s; // điểm tiếp xúc
  body += `<g transform="translate(${f1(px)} ${f1(py)}) rotate(${-deg})">${rect(-28, -32, 56, 32, 'fill="#fff"')}</g>`;
  const gx = px + nx * 16, gy = py + ny * 16;
  body += circle(gx, gy, 2.2, 'fill="#000"');
  if (has('P')) body += force(gx, gy, 0, 1, 80, names.P);
  if (has('N')) body += force(gx, gy, nx, ny, 70, names.N);
  if (has('F')) body += force(gx, gy, ux, uy, 84, names.F);
  if (has('Fms')) {
    const up = String(spec.frictionDir || 'up').toLowerCase() !== 'down';
    const sx = px + (up ? 1 : -1) * ux * 30, sy = py + (up ? 1 : -1) * uy * 30;
    body += force(sx, sy, up ? ux : -ux, up ? uy : -uy, 58, names.Fms);
  }
  const W = Math.max(420, Bx + 90);
  return svgWrap(W, 340, body);
};

/* ---------------------------- Thấu kính ---------------------------- */

const renderLens = (spec: any): string => {
  const converging = String(spec.lens || 'converging').toLowerCase() !== 'diverging';
  const f = Math.abs(num(spec.f ?? 20, 'f'));
  const d = num(spec.d ?? 30, 'd');
  if (f <= 0) throw new Error('Tiêu cự f phải khác 0.');
  if (d <= 0) throw new Error('Khoảng cách vật d phải lớn hơn 0.');
  const fs = converging ? f : -f;
  const atInfinity = converging && Math.abs(d - f) < 1e-9;
  const dImg = atInfinity ? Infinity : (d * fs) / (d - fs);
  const mag = atInfinity ? Infinity : -dImg / d;
  const imageFar = !Number.isFinite(dImg) || Math.abs(dImg) > 6 * Math.max(d, f);

  const W = 640, H = 300, x0 = W / 2, y0 = 150;
  const reach = Math.max(d, f, imageFar ? 0 : Math.abs(dImg)) * 1.18;
  const sx = (x0 - 40) / reach;
  const hp = imageFar ? 50 : Math.min(50, 105 / Math.max(1, Math.abs(mag)));
  const X = (u: number) => x0 + u * sx;

  let body = line(14, y0, W - 14, y0, 'stroke-width="1"');
  // Thấu kính
  body += line(x0, y0 - 124, x0, y0 + 124, 'stroke-width="1.8"');
  if (converging) body += arrowHead(x0, y0 - 100, x0, y0 - 126, 10) + arrowHead(x0, y0 + 100, x0, y0 + 126, 10);
  else body += path(`M${x0 - 8} ${y0 - 132} L${x0} ${y0 - 122} L${x0 + 8} ${y0 - 132} M${x0 - 8} ${y0 + 132} L${x0} ${y0 + 122} L${x0 + 8} ${y0 + 132}`, 'stroke-width="1.8"');
  body += text(x0 + 6, y0 + 17, 'O', { size: 13, italic: true, anchor: 'start' });
  // Tiêu điểm: F (vật), F' (ảnh)
  const fObj = converging ? X(-f) : X(f);
  const fImg = converging ? X(f) : X(-f);
  body += circle(fObj, y0, 2.4, 'fill="#000"') + circle(fImg, y0, 2.4, 'fill="#000"');
  body += text(fObj, y0 + 18, 'F', { size: 13, italic: true }) + text(fImg, y0 + 18, "F'", { size: 13, italic: true });

  // Vật AB
  const xA = X(-d), yB = y0 - hp;
  body += arrow(xA, y0, xA, yB, 'stroke-width="2"', 9);
  body += text(xA, y0 + 18, 'A', { size: 13, italic: true }) + text(xA - 6, yB - 6, 'B', { size: 13, italic: true, anchor: 'end' });

  const clipToEdge = (x1: number, y1: number, dx: number, dy: number) => {
    const t = dx > 0 ? (W - 16 - x1) / dx : dx < 0 ? (16 - x1) / dx : 1e6;
    const tY = dy > 0 ? (H - 10 - y1) / dy : dy < 0 ? (10 - y1) / dy : 1e6;
    const k = Math.min(t, tY);
    return [x1 + dx * k, y1 + dy * k];
  };
  const solid = 'stroke-width="1.1"';
  const dashed = 'stroke-width="1" stroke-dasharray="5 4"';

  // Tia 1: song song trục chính tới thấu kính
  body += line(xA, yB, x0, yB, solid) + arrowHead(xA, yB, (xA + x0) / 2, yB, 7);
  // Tia 2: qua quang tâm truyền thẳng
  {
    const [ex, ey] = clipToEdge(x0, y0, x0 - xA, y0 - yB);
    body += line(xA, yB, ex, ey, solid) + arrowHead(xA, yB, (xA + x0) / 2, (yB + y0) / 2, 7);
  }

  if (imageFar) {
    // Ảnh ở vô cực (hoặc rất xa): tia khúc xạ song song với tia qua quang tâm
    const [ex, ey] = clipToEdge(x0, yB, x0 - xA, y0 - yB);
    body += line(x0, yB, ex, ey, solid);
    body += text(W - 20, 28, Number.isFinite(dImg) ? 'Ảnh ở rất xa thấu kính' : 'Ảnh ở vô cực', { size: 12, italic: true, anchor: 'end', rich: false });
    return svgWrap(W, H, body);
  }

  const xI = X(dImg), yI = y0 - hp * mag;
  const real = dImg > 0;
  // Tia 1 sau khúc xạ: đi qua (hoặc có đường kéo dài qua) ảnh B'
  if (real) {
    const [ex, ey] = clipToEdge(x0, yB, xI - x0, yI - yB);
    body += line(x0, yB, ex, ey, solid);
  } else {
    const [ex, ey] = clipToEdge(x0, yB, x0 - xI, yB - yI);
    body += line(x0, yB, ex, ey, solid) + line(x0, yB, xI, yI, dashed);
    body += line(xA, yB, xI, yI, dashed);
  }
  body += arrow(xI, y0, xI, yI, real ? 'stroke-width="2"' : 'stroke-width="2" stroke-dasharray="6 4"', 9);
  body += text(xI, yI < y0 ? y0 + 18 : y0 - 8, "A'", { size: 13, italic: true });
  body += text(xI + 6, yI < y0 ? yI - 6 : yI + 16, "B'", { size: 13, italic: true, anchor: 'start' });
  return svgWrap(W, H, body);
};

/* ---------------------------- Đồ thị ---------------------------- */

const plotFrame = (xs: number[], ys: number[], plotW = 420, plotH = 210) => {
  const xMax = Math.max(...xs, 0) || 1;
  const yMax = Math.max(...ys, 0);
  const yMin = Math.min(...ys, 0);
  const ySpan = (yMax - yMin) || 1;
  const ox = 66, top = 34;
  const sx = plotW / (xMax * 1.08);
  const sy = plotH / (ySpan * 1.12);
  const oy = top + (yMax + ySpan * 0.06) * sy;
  return { ox, oy, top, sx, sy, X: (x: number) => ox + x * sx, Y: (y: number) => oy - y * sy, right: ox + plotW + 26, bottom: top + plotH + 10 };
};

const renderMotionGraph = (spec: any): string => {
  const pts: Array<[number, number]> = (Array.isArray(spec.points) ? spec.points : []).map((p: any) =>
    Array.isArray(p) ? [num(p[0], 'x'), num(p[1], 'y')] : [num(p.x ?? p.t, 'x'), num(p.y ?? p.v, 'y')]);
  if (pts.length < 2) throw new Error('Đồ thị cần ít nhất 2 điểm ("points").');
  const fr = plotFrame(pts.map(p => p[0]), pts.map(p => p[1]));
  let body = axes(fr.ox, fr.oy, fr.right, fr.top - 18, String(spec.xLabel ?? 't (s)'), String(spec.yLabel ?? 'v (m/s)'), fr.bottom);
  const xs = new Set<string>(), ysSeen = new Set<string>();
  pts.forEach(([x, y]) => {
    const px = fr.X(x), py = fr.Y(y);
    if (x !== 0 && y !== 0) {
      body += line(px, py, px, fr.oy, 'stroke-dasharray="4 3" stroke-width="0.8"') + line(px, py, fr.ox, py, 'stroke-dasharray="4 3" stroke-width="0.8"');
    }
    if (x !== 0 && !xs.has(fmt(x))) { xs.add(fmt(x)); body += text(px, y < 0 ? fr.oy - 7 : fr.oy + 17, fmt(x), { size: 12, rich: false }); }
    if (y !== 0 && !ysSeen.has(fmt(y))) { ysSeen.add(fmt(y)); body += text(fr.ox - 7, py + 4, fmt(y), { size: 12, anchor: 'end', rich: false }); }
  });
  body += path(pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(fr.X(x))} ${f1(fr.Y(y))}`).join(' '), 'stroke-width="2"');
  return svgWrap(fr.right + 30, fr.bottom + 26, body);
};

const renderOscillation = (spec: any): string => {
  const A = Math.abs(num(spec.amplitude ?? 4, 'amplitude'));
  const T = Math.abs(num(spec.period ?? 2, 'period'));
  const phi = num(spec.phasePi ?? 0, 'phasePi') * Math.PI;
  const cycles = Math.max(0.5, Math.min(4, num(spec.cycles ?? 1.25, 'cycles')));
  if (!A || !T) throw new Error('Biên độ và chu kì phải khác 0.');
  const tEnd = cycles * T;
  const fr = plotFrame([tEnd], [A, -A], 440, 200);
  let body = axes(fr.ox, fr.oy, fr.right, fr.top - 18, String(spec.xLabel ?? 't (s)'), String(spec.yLabel ?? 'x (cm)'), fr.bottom);
  body += line(fr.ox, fr.Y(A), fr.X(tEnd), fr.Y(A), 'stroke-dasharray="4 3" stroke-width="0.8"')
    + line(fr.ox, fr.Y(-A), fr.X(tEnd), fr.Y(-A), 'stroke-dasharray="4 3" stroke-width="0.8"')
    + text(fr.ox - 7, fr.Y(A) + 4, fmt(A), { size: 12, anchor: 'end', rich: false })
    + text(fr.ox - 7, fr.Y(-A) + 4, fmt(-A), { size: 12, anchor: 'end', rich: false });
  const quarter = T / 4;
  for (let k = 1; k * quarter <= tEnd + 1e-9; k++) {
    const t = k * quarter;
    body += line(fr.X(t), fr.oy - 3, fr.X(t), fr.oy + 3, 'stroke-width="0.9"');
    if (k % 2 === 0 || cycles <= 1.5) body += text(fr.X(t), fr.oy + 17, fmt(t), { size: 11, rich: false });
  }
  let d = '';
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const t = (tEnd * i) / steps;
    d += `${i ? 'L' : 'M'}${f1(fr.X(t))} ${f1(fr.Y(A * Math.cos((2 * Math.PI * t) / T + phi)))} `;
  }
  body += path(d.trim(), 'stroke-width="2"');
  return svgWrap(fr.right + 30, fr.bottom + 26, body);
};

/* ---------------------------- Điểm vào ---------------------------- */

export const PHYSICS_FIGURE_TYPES = ['circuit', 'forces', 'lens', 'motion-graph', 'oscillation'] as const;

export const renderPhysicsFigure = (spec: any): string => {
  switch (String(spec?.type || '').toLowerCase()) {
    case 'circuit': return renderCircuit(spec);
    case 'forces': return renderForces(spec);
    case 'lens': return renderLens(spec);
    case 'motion-graph': return renderMotionGraph(spec);
    case 'oscillation': return renderOscillation(spec);
    default: throw new Error(`Loại hình Vật lí "${spec?.type}" không được hỗ trợ.`);
  }
};
