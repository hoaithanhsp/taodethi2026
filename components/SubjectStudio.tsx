import React, { useMemo, useState } from 'react';
import { Atom, ChevronDown, ChevronUp, Dna, Download, FlaskConical, ImagePlus } from 'lucide-react';
import { downloadSvgAsPng, renderFigureSpecToSvg, svgToDataUrl } from '../services/figureEngine';
import { parseExamForShuffle } from '../services/examShuffle';
import { APPARATUS_LABELS, GLASSWARE_LABELS, GlasswareName } from '../services/subjectFigures/chemFigures';
import { parseCircuitElements } from '../services/subjectFigures/physicsFigures';
import { parseFoodWebText, parsePedigreeText } from '../services/subjectFigures/biologyFigures';
import { studioSubjectOf } from '../services/subjectFigures';

export interface FigureDocument {
  id: string;
  label: string;
  content: string;
  onUpdate: (next: string) => void;
}

/* ---------------------------- Chèn hình vào câu ---------------------------- */

/** Lùi qua các thẻ HTML mở ngay trước vị trí (để chèn hình trước <p> của phương án A, không chèn vào giữa thẻ). */
const backOverOpenTags = (src: string, pos: number): number => {
  let p = pos;
  for (;;) {
    let q = p;
    while (q > 0 && /\s/.test(src[q - 1])) q--;
    if (q === 0 || src[q - 1] !== '>') return p;
    const open = src.lastIndexOf('<', q - 1);
    if (open < 0) return p;
    const tag = src.slice(open, q);
    if (/^<\//.test(tag) || /\/>$/.test(tag) || /^<(?:br|hr|img|meta|link|input|body|html|head)\b/i.test(tag)) return p;
    p = open;
  }
};

/** Chèn khai báo hình ngay dưới lời dẫn của câu đã chọn, trước các phương án. */
export const insertFigureIntoQuestion = (content: string, questionIndex: number, spec: object): string => {
  const exam = parseExamForShuffle(content);
  const q = exam.questions[questionIndex];
  if (!q) return content;
  const json = JSON.stringify(spec);
  const block = exam.isHtml
    ? `\n<script type="application/json" class="figure-json">${json}</script>\n`
    : `\n\n\`\`\`figure-json\n${json}\n\`\`\`\n\n`;
  const at = q.slots ? backOverOpenTags(content, q.slots[0].labelStart) : q.end;
  return content.slice(0, at) + block + content.slice(at);
};

/* ---------------------------- Khung chung ---------------------------- */

const inputClass = 'w-full border border-slate-300 rounded-md px-2 py-1.5 bg-white text-xs';
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="block mb-1 font-semibold">{label}</span>
    {children}
  </label>
);

interface FrameProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  fileStem: string;
  kindLabel: string;
  documents: FigureDocument[];
  spec: Record<string, unknown> | null;
  specError?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const StudioFrame: React.FC<FrameProps> = ({ title, subtitle, icon, fileStem, kindLabel, documents, spec, specError, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [docId, setDocId] = useState(documents[0]?.id || '');
  const [question, setQuestion] = useState(0);
  const [notice, setNotice] = useState('');

  const doc = documents.find(d => d.id === docId) || documents[0];
  const exam = useMemo(() => (open && doc?.content ? parseExamForShuffle(doc.content) : null), [open, doc?.content]);
  const svg = useMemo(() => (open && spec ? renderFigureSpecToSvg(spec, undefined, { showError: true }) : ''), [open, spec]);
  const questionOptions = (exam?.questions || []).map((q, i) => ({
    index: i,
    label: `${exam!.sections[q.sectionIndex]?.title?.replace(/[*#_]/g, '').split('.')[0]?.trim() || 'Phần'} – Câu ${q.num}`,
  }));
  const canInsert = !!spec && !specError && questionOptions.length > 0;

  const insert = () => {
    if (!doc || !spec) return;
    doc.onUpdate(insertFigureIntoQuestion(doc.content, question, spec));
    const chosen = questionOptions.find(o => o.index === question);
    setNotice(`Đã chèn hình vào ${doc.label} – ${chosen?.label || 'câu đã chọn'}.`);
  };

  return (
    <section className="card-elevated flex-shrink-0 mb-4" data-studio={fileStem}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="w-full flex items-center justify-between gap-2 p-3 text-left">
        <span className="flex flex-wrap items-center gap-2 font-bold text-teal-800 text-sm">
          {icon} {title}
          <span className="font-normal text-slate-500 text-xs">{subtitle}</span>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-slate-100 pt-3 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-3 text-xs text-slate-700">
            {children}

            {documents.length > 1 && (
              <Field label="Chèn vào tài liệu">
                <select value={doc?.id} onChange={e => { setDocId(e.target.value); setQuestion(0); setNotice(''); }} className={inputClass}>
                  {documents.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select>
              </Field>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex-1 min-w-[140px]">
                <span className="block mb-1 font-semibold">Chèn vào câu</span>
                <select value={question} onChange={e => setQuestion(Number(e.target.value))} className={inputClass} disabled={!questionOptions.length}>
                  {!questionOptions.length && <option>Chưa có câu hỏi</option>}
                  {questionOptions.map(o => <option key={o.index} value={o.index}>{o.label}</option>)}
                </select>
              </label>
              <button type="button" onClick={insert} disabled={!canInsert} className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white hover:bg-teal-700 rounded-md font-medium disabled:opacity-50">
                <ImagePlus className="w-3.5 h-3.5" /> Chèn hình
              </button>
              <button type="button" onClick={() => svg && downloadSvgAsPng(svg, `${fileStem}.png`)} disabled={!svg || !!specError} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-teal-200 text-teal-800 hover:bg-teal-50 rounded-md font-medium disabled:opacity-50">
                <Download className="w-3.5 h-3.5" /> Tải PNG
              </button>
            </div>
            {specError && <p className="text-red-700" role="alert">{specError}</p>}
            {notice && <p className="text-emerald-700" role="status">{notice}</p>}
          </div>

          <div className="flex items-center justify-center bg-white border border-slate-200 rounded-lg p-3 min-h-[220px] overflow-auto">
            {svg && !specError && <img src={svgToDataUrl(svg)} alt={`Xem trước ${kindLabel}`} className="max-w-full h-auto" />}
          </div>
        </div>
      )}
    </section>
  );
};

/** Đổi lỗi đọc dữ liệu thành thông báo, không làm sập giao diện. */
const safeSpec = (build: () => Record<string, unknown>): { spec: Record<string, unknown> | null; error: string } => {
  try { return { spec: build(), error: '' }; } catch (e: any) { return { spec: null, error: e?.message || String(e) }; }
};

const KindSelect = <K extends string>({ value, labels, onChange }: { value: K; labels: Record<K, string>; onChange: (k: K) => void }) => (
  <Field label="Loại hình">
    <select value={value} onChange={e => onChange(e.target.value as K)} className={inputClass}>
      {(Object.keys(labels) as K[]).map(k => <option key={k} value={k}>{labels[k]}</option>)}
    </select>
  </Field>
);

/* ---------------------------- Studio Hóa học ---------------------------- */

type ChemKind = 'apparatus' | 'glassware' | 'ir' | 'ms' | 'structure' | 'haworth' | 'peptide' | 'polymer';
const CHEM_KINDS: Record<ChemKind, string> = {
  apparatus: 'Bộ thí nghiệm',
  glassware: 'Dụng cụ rời (I), (II)…',
  ir: 'Phổ hồng ngoại (IR)',
  ms: 'Phổ khối lượng (MS)',
  structure: 'Công thức cấu tạo 2D',
  haworth: 'Mạch vòng glucose, fructose',
  peptide: 'Chuỗi peptide',
  polymer: 'Mắt xích polymer',
};
const STRUCTURE_SAMPLES: Array<[string, string]> = [
  ['Ethyl acetate', 'CC(=O)OCC'], ['Benzene', 'c1ccccc1'], ['Toluene', 'Cc1ccccc1'], ['Phenol', 'Oc1ccccc1'], ['Aniline', 'Nc1ccccc1'],
  ['Acetic acid', 'CC(=O)O'], ['Ethanol', 'CCO'], ['Propanal', 'CCC=O'], ['Glycine', 'NCC(=O)O'], ['Alanine', 'CC(N)C(=O)O'], ['Isobutane', 'CC(C)C'],
];
const POLYMER_PRESETS: Array<[string, string]> = [
  ['pe', 'Polyethylene'], ['pp', 'Polypropylene'], ['pvc', 'Poly(vinyl chloride)'], ['ps', 'Polystyrene'], ['pan', 'Polyacrylonitrile'],
  ['pmma', 'Poly(methyl methacrylate)'], ['capron', 'Nylon-6 (capron)'], ['nylon-6,6', 'Nylon-6,6'], ['cao-su-buna', 'Cao su buna'],
];
const csvRows = (text: string) => text.split('\n').map(l => l.split(',').map(x => x.trim())).filter(p => p[0]);

const ChemistryStudio: React.FC<{ documents: FigureDocument[] }> = ({ documents }) => {
  const [kind, setKind] = useState<ChemKind>('apparatus');
  const [apparatus, setApparatus] = useState('distillation');
  const [items, setItems] = useState<GlasswareName[]>(['separatory-funnel', 'graduated-cylinder', 'burette', 'condenser']);
  const [irText, setIrText] = useState('3350, 25, O–H\n2950, 45\n1710, 10, C=O');
  const [msText, setMsText] = useState('58, 30\n43, 100\n15, 20');
  const [molecularIon, setMolecularIon] = useState('58');
  const [smiles, setSmiles] = useState('CC(=O)OCC');
  const [caption, setCaption] = useState('');
  const [sugar, setSugar] = useState('alpha-glucose');
  const [peptide, setPeptide] = useState('Gly-Ala-Val');
  const [polymer, setPolymer] = useState('pvc');

  const { spec, error } = useMemo(() => safeSpec(() => {
    switch (kind) {
      case 'apparatus': return { type: 'apparatus', preset: apparatus };
      case 'glassware': return { type: 'glassware', items };
      case 'ir': return { type: 'ir', peaks: csvRows(irText).map(([w, tr, lb]) => ({ wavenumber: Number(w), transmittance: Number(tr || 20), label: lb || undefined })) };
      case 'ms': return { type: 'ms', molecularIon: Number(molecularIon) || undefined, peaks: csvRows(msText).map(([mz, it]) => ({ mz: Number(mz), intensity: Number(it || 10) })) };
      case 'structure': return { type: 'structure', smiles, caption: caption || undefined };
      case 'haworth': return { type: 'haworth', sugar };
      case 'peptide': return { type: 'peptide', residues: peptide.split(/[-–\s]+/).filter(Boolean) };
      default: return { type: 'polymer', preset: polymer };
    }
  }), [kind, apparatus, items, irText, msText, molecularIon, smiles, caption, sugar, peptide, polymer]);

  return (
    <StudioFrame title="Studio Hóa học" subtitle="Dụng cụ thí nghiệm, phổ IR/MS, công thức cấu tạo, polymer" icon={<FlaskConical className="w-4 h-4" />}
      fileStem={`hinh-hoa-hoc-${kind}`} kindLabel={CHEM_KINDS[kind]} documents={documents} spec={spec} specError={error}>
      <KindSelect value={kind} labels={CHEM_KINDS} onChange={setKind} />
      {kind === 'apparatus' && (
        <Field label="Bộ thí nghiệm">
          <select value={apparatus} onChange={e => setApparatus(e.target.value)} className={inputClass}>
            {Object.entries(APPARATUS_LABELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
      )}
      {kind === 'glassware' && (
        <fieldset>
          <legend className="mb-1 font-semibold">Dụng cụ (đánh kí hiệu theo thứ tự chọn)</legend>
          <div className="grid grid-cols-2 gap-1">
            {(Object.keys(GLASSWARE_LABELS) as GlasswareName[]).map(name => (
              <label key={name} className="flex items-center gap-1.5">
                <input type="checkbox" checked={items.includes(name)} onChange={e => setItems(e.target.checked ? [...items, name] : items.filter(x => x !== name))} />
                {GLASSWARE_LABELS[name]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {kind === 'ir' && <Field label="Mỗi dòng một đỉnh: số sóng, % truyền qua, nhãn"><textarea rows={5} value={irText} onChange={e => setIrText(e.target.value)} className={`${inputClass} font-mono`} /></Field>}
      {kind === 'ms' && (
        <>
          <Field label="Mỗi dòng một đỉnh: m/z, cường độ tương đối"><textarea rows={5} value={msText} onChange={e => setMsText(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          <Field label="m/z ion phân tử"><input value={molecularIon} onChange={e => setMolecularIon(e.target.value)} className={inputClass} /></Field>
        </>
      )}
      {kind === 'structure' && (
        <>
          <Field label="Chất có sẵn">
            <select value={smiles} onChange={e => setSmiles(e.target.value)} className={inputClass}>
              {!STRUCTURE_SAMPLES.some(s => s[1] === smiles) && <option value={smiles}>Tự nhập</option>}
              {STRUCTURE_SAMPLES.map(([name, code]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </Field>
          <Field label="Mã SMILES"><input value={smiles} onChange={e => setSmiles(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          <Field label="Chú thích dưới hình (tùy chọn)"><input value={caption} onChange={e => setCaption(e.target.value)} className={inputClass} /></Field>
        </>
      )}
      {kind === 'haworth' && (
        <Field label="Chất">
          <select value={sugar} onChange={e => setSugar(e.target.value)} className={inputClass}>
            <option value="alpha-glucose">α-glucose</option><option value="beta-glucose">β-glucose</option>
            <option value="alpha-fructose">α-fructose</option><option value="beta-fructose">β-fructose</option>
          </select>
        </Field>
      )}
      {kind === 'peptide' && <Field label="Các gốc amino acid, cách nhau bằng dấu gạch"><input value={peptide} onChange={e => setPeptide(e.target.value)} className={inputClass} /></Field>}
      {kind === 'polymer' && (
        <Field label="Polymer">
          <select value={polymer} onChange={e => setPolymer(e.target.value)} className={inputClass}>
            {POLYMER_PRESETS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </Field>
      )}
    </StudioFrame>
  );
};

/* ---------------------------- Studio Vật lí ---------------------------- */

type PhysKind = 'circuit' | 'forces' | 'lens' | 'motion-graph' | 'oscillation';
const PHYS_KINDS: Record<PhysKind, string> = {
  circuit: 'Mạch điện',
  forces: 'Lực tác dụng lên vật',
  lens: 'Tia sáng qua thấu kính',
  'motion-graph': 'Đồ thị chuyển động',
  oscillation: 'Đồ thị dao động điều hòa',
};
const FORCE_NAMES = ['P', 'N', 'F', 'Fms'] as const;

const PhysicsStudio: React.FC<{ documents: FigureDocument[] }> = ({ documents }) => {
  const [kind, setKind] = useState<PhysKind>('circuit');
  const [layout, setLayout] = useState<'series' | 'parallel'>('parallel');
  const [mainText, setMainText] = useState('A, K');
  const [branchText, setBranchText] = useState('R1\nĐ, V\nR2');
  const [sourceLabel, setSourceLabel] = useState('E, r');
  const [setup, setSetup] = useState<'incline' | 'horizontal'>('incline');
  const [angle, setAngle] = useState('30');
  const [fAngle, setFAngle] = useState('30');
  const [forces, setForces] = useState<string[]>(['P', 'N', 'Fms']);
  const [frictionDir, setFrictionDir] = useState<'up' | 'down'>('up');
  const [lensType, setLensType] = useState<'converging' | 'diverging'>('converging');
  const [focal, setFocal] = useState('20');
  const [distance, setDistance] = useState('30');
  const [points, setPoints] = useState('0, 0\n2, 10\n6, 10\n8, 0');
  const [xLabel, setXLabel] = useState('t (s)');
  const [yLabel, setYLabel] = useState('v (m/s)');
  const [amp, setAmp] = useState('4');
  const [period, setPeriod] = useState('2');
  const [phase, setPhase] = useState('0');
  const [cycles, setCycles] = useState('1.25');
  const [oscY, setOscY] = useState('x (cm)');

  const { spec, error } = useMemo(() => safeSpec(() => {
    switch (kind) {
      case 'circuit':
        return layout === 'series'
          ? { type: 'circuit', elements: parseCircuitElements(mainText), source: { label: sourceLabel } }
          : { type: 'circuit', elements: parseCircuitElements(mainText), branches: branchText.split('\n').map(l => l.trim()).filter(Boolean).map(parseCircuitElements), source: { label: sourceLabel } };
      case 'forces': return { type: 'forces', setup, angle: Number(angle), fAngle: Number(fAngle), forces, frictionDir };
      case 'lens': return { type: 'lens', lens: lensType, f: Number(focal), d: Number(distance) };
      case 'motion-graph': return { type: 'motion-graph', points: csvRows(points).map(([x, y]) => [Number(x.replace(',', '.')), Number((y || '').replace(',', '.'))]), xLabel, yLabel };
      default: return { type: 'oscillation', amplitude: Number(amp), period: Number(period), phasePi: Number(phase), cycles: Number(cycles), yLabel: oscY };
    }
  }), [kind, layout, mainText, branchText, sourceLabel, setup, angle, fAngle, forces, frictionDir, lensType, focal, distance, points, xLabel, yLabel, amp, period, phase, cycles, oscY]);

  const lensInfo = useMemo(() => {
    const f = Math.abs(Number(focal)), d = Number(distance);
    if (kind !== 'lens' || !f || !d || d <= 0) return '';
    const fs = lensType === 'converging' ? f : -f;
    if (lensType === 'converging' && d === f) return 'Vật ở tiêu điểm: ảnh ở vô cực.';
    const di = (d * fs) / (d - fs);
    const k = -di / d;
    const r = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
    return `d' = ${r(di)} → ảnh ${di > 0 ? 'thật, ngược chiều' : 'ảo, cùng chiều'} vật, k = ${r(k)}.`;
  }, [kind, focal, distance, lensType]);

  return (
    <StudioFrame title="Studio Vật lí" subtitle="Mạch điện, lực, thấu kính, đồ thị chuyển động và dao động" icon={<Atom className="w-4 h-4" />}
      fileStem={`hinh-vat-li-${kind}`} kindLabel={PHYS_KINDS[kind]} documents={documents} spec={spec} specError={error}>
      <KindSelect value={kind} labels={PHYS_KINDS} onChange={setKind} />
      {kind === 'circuit' && (
        <>
          <Field label="Cách mắc">
            <select value={layout} onChange={e => setLayout(e.target.value as 'series' | 'parallel')} className={inputClass}>
              <option value="series">Nối tiếp</option><option value="parallel">Song song (có mạch chính)</option>
            </select>
          </Field>
          <Field label={layout === 'series' ? 'Các linh kiện nối tiếp' : 'Linh kiện trên mạch chính (có thể để trống)'}>
            <input value={mainText} onChange={e => setMainText(e.target.value)} className={`${inputClass} font-mono`} />
          </Field>
          {layout === 'parallel' && (
            <Field label="Mỗi dòng là một nhánh song song">
              <textarea rows={3} value={branchText} onChange={e => setBranchText(e.target.value)} className={`${inputClass} font-mono`} />
            </Field>
          )}
          <Field label="Kí hiệu nguồn"><input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} className={inputClass} /></Field>
          <p className="text-slate-500">Viết tắt: R1 điện trở, Rb biến trở, Đ đèn, A ampe kế, V vôn kế, C tụ, L cuộn cảm, K khóa. Cách nhau bằng dấu phẩy.</p>
        </>
      )}
      {kind === 'forces' && (
        <>
          <Field label="Vật đặt trên">
            <select value={setup} onChange={e => setSetup(e.target.value as 'incline' | 'horizontal')} className={inputClass}>
              <option value="incline">Mặt phẳng nghiêng</option><option value="horizontal">Mặt phẳng ngang</option>
            </select>
          </Field>
          {setup === 'incline'
            ? <Field label="Góc nghiêng α (độ, 10–60)"><input type="number" value={angle} onChange={e => setAngle(e.target.value)} className={inputClass} /></Field>
            : <Field label="Góc giữa lực F và phương ngang (độ)"><input type="number" value={fAngle} onChange={e => setFAngle(e.target.value)} className={inputClass} /></Field>}
          <fieldset>
            <legend className="mb-1 font-semibold">Các lực</legend>
            <div className="flex flex-wrap gap-3">
              {FORCE_NAMES.map(name => (
                <label key={name} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={forces.includes(name)} onChange={e => setForces(e.target.checked ? [...forces, name] : forces.filter(x => x !== name))} />
                  {name === 'Fms' ? 'Ma sát' : name}
                </label>
              ))}
            </div>
          </fieldset>
          {setup === 'incline' && forces.includes('Fms') && (
            <Field label="Ma sát hướng">
              <select value={frictionDir} onChange={e => setFrictionDir(e.target.value as 'up' | 'down')} className={inputClass}>
                <option value="up">Lên dốc (vật trượt xuống)</option><option value="down">Xuống dốc (vật đi lên)</option>
              </select>
            </Field>
          )}
        </>
      )}
      {kind === 'lens' && (
        <>
          <Field label="Thấu kính">
            <select value={lensType} onChange={e => setLensType(e.target.value as 'converging' | 'diverging')} className={inputClass}>
              <option value="converging">Hội tụ</option><option value="diverging">Phân kì</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tiêu cự f (cm)"><input type="number" value={focal} onChange={e => setFocal(e.target.value)} className={inputClass} /></Field>
            <Field label="Vật cách thấu kính d (cm)"><input type="number" value={distance} onChange={e => setDistance(e.target.value)} className={inputClass} /></Field>
          </div>
          {lensInfo && <p className="text-slate-600">{lensInfo}</p>}
        </>
      )}
      {kind === 'motion-graph' && (
        <>
          <Field label="Mỗi dòng một điểm gấp khúc: hoành độ, tung độ"><textarea rows={4} value={points} onChange={e => setPoints(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tên trục ngang"><input value={xLabel} onChange={e => setXLabel(e.target.value)} className={inputClass} /></Field>
            <Field label="Tên trục đứng"><input value={yLabel} onChange={e => setYLabel(e.target.value)} className={inputClass} /></Field>
          </div>
        </>
      )}
      {kind === 'oscillation' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Biên độ A"><input type="number" value={amp} onChange={e => setAmp(e.target.value)} className={inputClass} /></Field>
            <Field label="Chu kì T (s)"><input type="number" value={period} onChange={e => setPeriod(e.target.value)} className={inputClass} /></Field>
            <Field label="Pha ban đầu φ">
              <select value={phase} onChange={e => setPhase(e.target.value)} className={inputClass}>
                <option value="0">0</option><option value="0.5">π/2</option><option value="-0.5">−π/2</option><option value="1">π</option>
                <option value="0.3333333333">π/3</option><option value="-0.3333333333">−π/3</option><option value="0.25">π/4</option><option value="-0.25">−π/4</option>
              </select>
            </Field>
            <Field label="Số chu kì vẽ"><input type="number" step="0.25" value={cycles} onChange={e => setCycles(e.target.value)} className={inputClass} /></Field>
          </div>
          <Field label="Tên trục đứng"><input value={oscY} onChange={e => setOscY(e.target.value)} className={inputClass} /></Field>
          <p className="text-slate-500">x = A·cos(2πt/T + φ)</p>
        </>
      )}
    </StudioFrame>
  );
};

/* ---------------------------- Studio Sinh học ---------------------------- */

type BioKind = 'pedigree' | 'punnett' | 'foodweb' | 'chart';
const BIO_KINDS: Record<BioKind, string> = {
  pedigree: 'Sơ đồ phả hệ',
  punnett: 'Khung Punnett (lai)',
  foodweb: 'Lưới thức ăn',
  chart: 'Biểu đồ số liệu',
};

const BiologyStudio: React.FC<{ documents: FigureDocument[] }> = ({ documents }) => {
  const [kind, setKind] = useState<BioKind>('pedigree');
  const [pedigree, setPedigree] = useState('I: 1M = 2F\nII: [1-2] 3M* 4F = 5M\nIII: [4-5] 6F 7M* 8F');
  const [legend, setLegend] = useState(true);
  const [mother, setMother] = useState('AaBb');
  const [father, setFather] = useState('Aabb');
  const [web, setWeb] = useState('Cỏ -> Thỏ, Châu chấu, Chuột\nChâu chấu -> Ếch\nThỏ, Chuột, Ếch -> Rắn\nThỏ, Rắn -> Đại bàng');
  const [chartKind, setChartKind] = useState<'bar' | 'line'>('bar');
  const [categories, setCategories] = useState('Năm 1, Năm 2, Năm 3, Năm 4');
  const [seriesText, setSeriesText] = useState('Quần thể A: 120, 180, 260, 300\nQuần thể B: 90, 110, 150, 140');
  const [chartX, setChartX] = useState('Thời gian');
  const [chartY, setChartY] = useState('Số cá thể');

  const { spec, error } = useMemo(() => safeSpec(() => {
    switch (kind) {
      case 'pedigree': return { ...parsePedigreeText(pedigree), legend };
      case 'punnett': return { type: 'punnett', mother, father };
      case 'foodweb': return parseFoodWebText(web);
      default: return {
        type: 'chart', kind: chartKind,
        categories: categories.split(',').map(s => s.trim()).filter(Boolean),
        series: seriesText.split('\n').map(l => l.trim()).filter(Boolean).map((l, i) => {
          const [name, vals] = l.includes(':') ? [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1)] : [`Dãy ${i + 1}`, l];
          return { name, values: vals.split(/[;,]\s*|\s+/).filter(Boolean).map(v => Number(v.replace(',', '.'))) };
        }),
        xLabel: chartX, yLabel: chartY,
      };
    }
  }), [kind, pedigree, legend, mother, father, web, chartKind, categories, seriesText, chartX, chartY]);

  return (
    <StudioFrame title="Studio Sinh học" subtitle="Phả hệ, khung Punnett, lưới thức ăn, biểu đồ số liệu" icon={<Dna className="w-4 h-4" />}
      fileStem={`hinh-sinh-hoc-${kind}`} kindLabel={BIO_KINDS[kind]} documents={documents} spec={spec} specError={error}>
      <KindSelect value={kind} labels={BIO_KINDS} onChange={setKind} />
      {kind === 'pedigree' && (
        <>
          <Field label="Mỗi dòng một thế hệ"><textarea rows={4} value={pedigree} onChange={e => setPedigree(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          <p className="text-slate-500">M nam, F nữ, * bị bệnh; "a = b" là vợ chồng; [1-2] ghi bố mẹ của những người phía sau (người đứng sau dấu "=" là người ngoài gia đình).</p>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={legend} onChange={e => setLegend(e.target.checked)} /> Kèm chú thích kí hiệu</label>
        </>
      )}
      {kind === 'punnett' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kiểu gen mẹ (♀)"><input value={mother} onChange={e => setMother(e.target.value)} className={`${inputClass} font-mono`} /></Field>
            <Field label="Kiểu gen bố (♂)"><input value={father} onChange={e => setFather(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          </div>
          <p className="text-slate-500">Ví dụ: Aa × Aa, AaBb × aabb, gen trên X: XAXa × XaY. Giao tử tự tách theo phân li độc lập.</p>
        </>
      )}
      {kind === 'foodweb' && (
        <>
          <Field label="Mỗi dòng: loài bị ăn -> các loài ăn nó"><textarea rows={4} value={web} onChange={e => setWeb(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          <p className="text-slate-500">Sinh vật sản xuất tự xếp ở dưới cùng, các bậc dinh dưỡng xếp dần lên trên.</p>
        </>
      )}
      {kind === 'chart' && (
        <>
          <Field label="Dạng biểu đồ">
            <select value={chartKind} onChange={e => setChartKind(e.target.value as 'bar' | 'line')} className={inputClass}>
              <option value="bar">Cột</option><option value="line">Đường</option>
            </select>
          </Field>
          <Field label="Các mục trên trục ngang (cách nhau bằng dấu phẩy)"><input value={categories} onChange={e => setCategories(e.target.value)} className={inputClass} /></Field>
          <Field label="Mỗi dòng một dãy số liệu: Tên: giá trị, giá trị…"><textarea rows={3} value={seriesText} onChange={e => setSeriesText(e.target.value)} className={`${inputClass} font-mono`} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tên trục ngang"><input value={chartX} onChange={e => setChartX(e.target.value)} className={inputClass} /></Field>
            <Field label="Tên trục đứng"><input value={chartY} onChange={e => setChartY(e.target.value)} className={inputClass} /></Field>
          </div>
        </>
      )}
    </StudioFrame>
  );
};

/* ---------------------------- Chọn Studio theo môn ---------------------------- */

/**
 * Nạp Studio đặc trưng theo môn đã khai báo: Hóa học, Vật lí, Sinh học.
 * Môn khác (kể cả Toán) không hiện gì ở đây; Studio Toán (BBT, đồ thị, hình học) vẫn hiện như cũ.
 */
const SubjectStudio: React.FC<{ subject?: string | null; documents: FigureDocument[] }> = ({ subject, documents }) => {
  const kind = studioSubjectOf(subject);
  const docs = documents.filter(d => d.content);
  if (!docs.length) return null;
  if (kind === 'chemistry') return <ChemistryStudio documents={docs} />;
  if (kind === 'physics') return <PhysicsStudio documents={docs} />;
  if (kind === 'biology') return <BiologyStudio documents={docs} />;
  return null;
};

export default SubjectStudio;
