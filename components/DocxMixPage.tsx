import React, { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, FileText, Link2, Lock, RefreshCw, ShieldCheck, Shuffle, Upload, X } from 'lucide-react';
import {
  answerRows,
  BuiltVersion,
  buildAnswerWorkbook,
  buildVersion,
  defaultOverrides,
  EMPTY_EXAM_INFO,
  ExamInfo,
  hasExamInfo,
  loadDocxExam,
  missingMixAnswers,
  MixDocument,
  MixKind,
  MixOverrides,
  MixQuestion,
  MixSettings,
  planVersions,
} from '../services/docxExamMixer';

const MAX_VERSIONS = 24;
const ANSWER_FILE = 'ĐÁP ÁN CÁC MÃ ĐỀ.xlsx';
const versionFile = (code: string) => `Mã Đề_${code}.docx`;
const KIND_LABEL: Record<MixKind, string> = { mc: 'Trắc nghiệm', tf: 'Đúng – Sai', short: 'Trả lời ngắn', essay: 'Tự luận' };
const SOURCE_LABEL: Record<string, string> = { key: 'từ bảng đáp án', solution: 'từ lời giải', mark: 'từ dấu trong đề' };

const saveBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
const EXAM_INFO_FIELDS: Array<{ key: keyof ExamInfo; label: string; placeholder: string }> = [
  { key: 'department', label: 'Bộ/Sở/Phòng GD:', placeholder: 'SỞ GD-ĐT' },
  { key: 'school', label: 'Tổ/Trường:', placeholder: 'TRƯỜNG THPT' },
  { key: 'examName', label: 'Tên bài thi:', placeholder: 'ĐỀ KIỂM TRA' },
  { key: 'schoolYear', label: 'Năm học:', placeholder: '2026 - 2027' },
  { key: 'subject', label: 'Môn học:', placeholder: 'Toán' },
  { key: 'duration', label: 'Thời gian:', placeholder: '60 phút' },
];

const DEFAULT_EXAM_INFO = EXAM_INFO_FIELDS.reduce((info, field) => ({ ...info, [field.key]: field.placeholder }), { ...EMPTY_EXAM_INFO });

const newSeed = () => Math.floor(Math.random() * 900000000) + 100000000;
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));

const normalizeTf = (v: string) => (v.toUpperCase().replace(/D/g, 'Đ').match(/[ĐS]/g) || []).slice(0, 4).join('');
const normalizeMc = (v: string) => v.toUpperCase().replace(/[^A-F]/g, '').slice(0, 1);

const answerValid = (q: MixQuestion, v: string) => {
  if (q.kind === 'tf') return v.length === 4;
  if (q.kind === 'mc') return !!v && q.optionPreviews.length > 'ABCDEF'.indexOf(v);
  return !!v.trim();
};

const DocxMixPage: React.FC<{ checkAuth: () => boolean }> = ({ checkAuth }) => {
  const [doc, setDoc] = useState<MixDocument | null>(null);
  const [ov, setOv] = useState<MixOverrides | null>(null);
  const [settings, setSettings] = useState<MixSettings>({
    count: 4,
    startCode: 101,
    shuffleQuestions: true,
    shuffleOptions: true,
    shuffleStatements: true,
    keepTogether: true,
    normalizeFormat: true,
    examInfo: { ...DEFAULT_EXAM_INFO },
    seed: newSeed(),
  });
  const [built, setBuilt] = useState<BuiltVersion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const missing = useMemo(() => (doc && ov ? missingMixAnswers(doc, ov) : []), [doc, ov]);
  const warned = useMemo(() => (doc ? doc.questions.filter(q => q.warnings.length > 0) : []), [doc]);
  const problemCount = built.reduce((sum, b) => sum + b.problems.length, 0);
  const rows = useMemo(() => answerRows(built.map(b => b.plan)), [built]);
  const clampedCount = Math.min(MAX_VERSIONS, Math.max(1, settings.count || 1));

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBuilt([]);
    if (!/\.docx$/i.test(file.name)) {
      setError('Vui lòng chọn file Word .docx. File .doc cũ cần mở bằng Word rồi Lưu thành .docx.');
      return;
    }
    setBusy('Đang đọc đề...');
    await nextFrame();
    try {
      const loaded = await loadDocxExam(file, file.name);
      setDoc(loaded);
      setOv(defaultOverrides(loaded));
      setSettings(s => ({ ...s, seed: newSeed() }));
      setExpanded(null);
    } catch (e: any) {
      setDoc(null);
      setOv(null);
      setError(e?.message || 'Không đọc được file này.');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const updateSettings = (patch: Partial<MixSettings>) => {
    setSettings(s => ({ ...s, ...patch }));
    setBuilt([]);
  };
  const updateOv = (fn: (draft: MixOverrides) => void) => {
    if (!ov) return;
    const draft: MixOverrides = { answers: { ...ov.answers }, pinned: { ...ov.pinned }, lockOptions: { ...ov.lockOptions }, linkNext: { ...ov.linkNext } };
    fn(draft);
    setOv(draft);
    setBuilt([]);
  };

  const handleMix = async () => {
    if (!doc || !ov || !checkAuth()) return;
    setError('');
    const finalSettings = { ...settings, count: clampedCount, startCode: settings.startCode || 101 };
    setSettings(finalSettings);
    try {
      const plans = planVersions(doc, finalSettings, ov);
      const out: BuiltVersion[] = [];
      for (let i = 0; i < plans.length; i++) {
        setBusy(`Đang tạo mã đề ${plans[i].code} (${i + 1}/${plans.length})...`);
        await nextFrame();
        out.push(await buildVersion(doc, plans[i], finalSettings));
      }
      setBuilt(out);
    } catch (e: any) {
      setBuilt([]);
      setError(`Không trộn được đề: ${e?.message || 'lỗi không xác định'}`);
    } finally {
      setBusy(null);
    }
  };

  const downloadExcel = async () => {
    if (!doc) return;
    saveBlob(await buildAnswerWorkbook(doc, built, settings), ANSWER_FILE);
  };

  const downloadAll = async () => {
    if (!doc) return;
    setBusy('Đang đóng gói...');
    try {
      const zip = new JSZip();
      built.forEach(b => zip.file(versionFile(b.plan.code), b.blob));
      zip.file(ANSWER_FILE, await buildAnswerWorkbook(doc, built, settings));
      const base = doc.fileName.replace(/\.docx$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'De_thi';
      saveBlob(await zip.generateAsync({ type: 'blob' }), `${base}_Tron_de.zip`);
    } catch (e: any) {
      setError(`Không đóng gói được: ${e?.message || 'lỗi không xác định'}`);
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setDoc(null);
    setOv(null);
    setBuilt([]);
    setError('');
  };

  const inputCls = 'border border-slate-300 rounded-md px-2 py-1.5 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-orange-400';

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-8">
      <div className="card-elevated p-5">
        <h2 className="text-xl font-extrabold text-slate-900">Trộn đề từ file Word</h2>
        <p className="text-sm text-slate-600 mt-1">
          Giữ nguyên công thức MathType, Word Equation, hình ảnh và bảng. Tạo nhiều mã đề kèm bảng đáp án Excel.
        </p>
        <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          File được xử lý ngay trên máy của bạn, không tải đề lên máy chủ và không dùng AI.
        </p>
      </div>

      {!doc && (
        <div
          className={`card-elevated p-8 text-center border-2 border-dashed transition-colors ${dragging ? 'border-orange-400 bg-orange-50' : 'border-slate-300'}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
        >
          <Upload className="w-10 h-10 text-orange-500 mx-auto mb-3" />
          <p className="font-semibold text-slate-800">Kéo thả file đề gốc vào đây</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">Chỉ nhận file .docx. Mỗi câu bắt đầu bằng "Câu 1.", phương án "A.", ý Đúng – Sai "a)".</p>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={!!busy} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm disabled:opacity-50">
            Chọn file Word
          </button>
          <input ref={fileInput} type="file" accept=".docx" className="hidden" aria-label="Chọn file đề gốc" onChange={e => handleFile(e.target.files?.[0])} />
          <div className="mt-5 text-left max-w-xl mx-auto text-xs text-slate-600 space-y-1">
            <p className="font-semibold text-slate-700">Để đọc đúng đáp án, đề gốc nên có một trong các dạng:</p>
            <p>• Bảng "ĐÁP ÁN" ở cuối file, hoặc dòng "Chọn A" trong lời giải.</p>
            <p>• Phương án đúng được gạch chân hoặc tô màu. Đề học sinh sẽ tự bỏ các dấu này.</p>
            <p>• Nếu đề không có đáp án, bạn nhập trực tiếp ở bước kế tiếp.</p>
          </div>
        </div>
      )}

      {busy && !built.length && (
        <div className="p-3 rounded-lg bg-orange-50 text-orange-800 border border-orange-200 text-sm flex items-center gap-2" role="status">
          <RefreshCw className="w-4 h-4 animate-spin" /> {busy}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm flex items-start gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      {doc && ov && (
        <>
          <div className="card-elevated p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-orange-600 shrink-0" /> <span className="truncate">{doc.fileName}</span>
              </div>
              <div className="text-sm text-slate-600 mt-1">
                {doc.questions.length} câu · {doc.stats.objects} công thức MathType · {doc.stats.equations} công thức Word · {doc.stats.images} hình · {doc.stats.tables} bảng
              </div>
            </div>
            <button type="button" onClick={reset} className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1 border border-slate-300 rounded-lg px-3 py-1.5 bg-white">
              <X className="w-4 h-4" /> Chọn file khác
            </button>
          </div>

          {(missing.length > 0 || warned.length > 0 || doc.conflicts.length > 0 || doc.notes.length > 0) && (
            <div className="p-3 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 text-sm space-y-1.5" role="status">
              <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="w-4 h-4" /> Cần xem qua trước khi trộn</div>
              {missing.length > 0 && <p>Còn {missing.length} câu chưa có đáp án. Hãy nhập vào các ô đỏ bên dưới, nếu không file Excel sẽ hiện dấu "?".</p>}
              {warned.length > 0 && <p>{warned.length} câu được tự động khóa hoặc có lưu ý, xem biểu tượng cảnh báo ở từng câu.</p>}
              {doc.conflicts.map(c => <p key={c}>{c}.</p>)}
              {doc.notes.map(n => <p key={n}>{n}</p>)}
            </div>
          )}

          <div className="card-elevated p-4 space-y-3">
            <h3 className="font-bold text-slate-900">Cấu hình trộn</h3>
            <div className="flex flex-wrap gap-4">
              <label className="text-sm text-slate-700">
                <span className="block mb-1">Số mã đề (tối đa {MAX_VERSIONS})</span>
                <input type="number" min={1} max={MAX_VERSIONS} value={settings.count || ''} onChange={e => updateSettings({ count: parseInt(e.target.value, 10) || 0 })} onBlur={() => updateSettings({ count: clampedCount })} className={`w-24 ${inputCls}`} />
              </label>
              <label className="text-sm text-slate-700">
                <span className="block mb-1">Mã đề đầu tiên</span>
                <input type="number" min={1} value={settings.startCode || ''} onChange={e => updateSettings({ startCode: parseInt(e.target.value, 10) || 0 })} className={`w-28 ${inputCls}`} />
              </label>
              <label className="text-sm text-slate-700">
                <span className="block mb-1">Mã tái tạo kết quả</span>
                <span className="flex gap-1.5">
                  <input type="number" value={settings.seed} onChange={e => updateSettings({ seed: parseInt(e.target.value, 10) || 0 })} className={`w-36 ${inputCls}`} />
                  <button type="button" onClick={() => updateSettings({ seed: newSeed() })} title="Đổi mã khác" aria-label="Đổi mã tái tạo khác" className="border border-slate-300 rounded-md px-2 bg-white hover:bg-slate-50">
                    <RefreshCw className="w-4 h-4 text-slate-600" />
                  </button>
                </span>
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-slate-800">
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.shuffleQuestions} onChange={e => updateSettings({ shuffleQuestions: e.target.checked })} /> Đảo thứ tự câu trong từng phần</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.shuffleOptions} onChange={e => updateSettings({ shuffleOptions: e.target.checked })} /> Đảo phương án A, B, C, D</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.shuffleStatements} onChange={e => updateSettings({ shuffleStatements: e.target.checked })} /> Đảo ý a, b, c, d của câu Đúng – Sai</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.keepTogether} onChange={e => updateSettings({ keepTogether: e.target.checked })} /> Giữ mỗi câu không bị ngắt sang trang</label>
              <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={settings.normalizeFormat} onChange={e => updateSettings({ normalizeFormat: e.target.checked })} /> Chuẩn hóa hình thức: Times New Roman 12, nhãn đậm, phương án tự xếp 4, 2 hoặc 1 cột</label>
            </div>
          </div>

          <div className="card-elevated p-4">
            <h3 className="font-bold text-slate-900">Duyệt câu hỏi và đáp án đề gốc</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">Câu tự luận giữ nguyên vị trí. Bỏ khóa nếu muốn cho câu đó đổi chỗ.</p>
            <div className="space-y-4">
              {doc.parts.map(part => {
                const qs = doc.questions.filter(q => q.part === part.index);
                return (
                  <div key={part.index}>
                    {part.title && <div className="font-semibold text-sm text-orange-800 bg-orange-50 rounded-md px-2 py-1.5 mb-2">{part.title.length > 130 ? `${part.title.slice(0, 130)}…` : part.title}</div>}
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                      {qs.map((q, i) => {
                        const value = ov.answers[q.id] || '';
                        const invalid = q.kind !== 'essay' && !answerValid(q, value);
                        const open = expanded === q.id;
                        return (
                          <div key={q.id} className="p-2.5 text-sm">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                              <button type="button" onClick={() => setExpanded(open ? null : q.id)} aria-expanded={open} aria-label={`Xem chi tiết câu ${q.num}`} className="flex items-start gap-1.5 flex-1 min-w-[14rem] text-left">
                                <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                                <span className="min-w-0">
                                  <span className="font-semibold text-slate-900">Câu {q.num}</span>
                                  <span className="text-xs text-slate-500"> · {KIND_LABEL[q.kind]}</span>
                                  {q.warnings.length > 0 && <AlertTriangle className="inline w-3.5 h-3.5 text-amber-600 ml-1 -mt-0.5" aria-label="Có lưu ý" />}
                                  <span className="block text-xs text-slate-600 truncate max-w-[34rem]">{q.preview}</span>
                                </span>
                              </button>
                              {q.kind !== 'essay' && (
                                <label className="flex items-center gap-1 text-xs text-slate-600" title={q.answerSource ? `Đọc được ${SOURCE_LABEL[q.answerSource]}` : 'Chưa có đáp án'}>
                                  Đáp án
                                  <input
                                    aria-label={`Đáp án câu ${q.num}, phần ${part.index + 1}`}
                                    value={value}
                                    placeholder={q.kind === 'tf' ? 'ĐSĐS' : q.kind === 'mc' ? 'A' : ''}
                                    onChange={e => {
                                      const v = q.kind === 'mc' ? normalizeMc(e.target.value) : q.kind === 'tf' ? normalizeTf(e.target.value) : e.target.value;
                                      updateOv(d => { d.answers[q.id] = v; });
                                    }}
                                    className={`text-center border rounded-md px-1 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${q.kind === 'mc' ? 'w-10' : q.kind === 'tf' ? 'w-16' : 'w-20'} ${invalid ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-white'}`}
                                  />
                                </label>
                              )}
                              <label className="flex items-center gap-1 text-xs text-slate-700" title="Câu này giữ nguyên số câu trong mọi mã đề">
                                <input type="checkbox" checked={!!ov.pinned[q.id]} onChange={e => updateOv(d => { d.pinned[q.id] = e.target.checked; })} />
                                <Lock className="w-3 h-3" /> Khóa câu
                              </label>
                              {(q.kind === 'mc' || q.kind === 'tf') && (
                                <label className="flex items-center gap-1 text-xs text-slate-700" title="Không đảo phương án của câu này">
                                  <input type="checkbox" checked={!!ov.lockOptions[q.id]} onChange={e => updateOv(d => { d.lockOptions[q.id] = e.target.checked; })} />
                                  Khóa {q.kind === 'tf' ? 'ý' : 'phương án'}
                                </label>
                              )}
                              {i < qs.length - 1 && (
                                <label className="flex items-center gap-1 text-xs text-slate-700" title="Câu này và câu kế tiếp luôn đi liền nhau, dùng cho câu chung dữ kiện">
                                  <input type="checkbox" checked={!!ov.linkNext[q.id]} onChange={e => updateOv(d => { d.linkNext[q.id] = e.target.checked; })} />
                                  <Link2 className="w-3 h-3" /> Liền câu sau
                                </label>
                              )}
                            </div>
                            {open && (
                              <div className="mt-2 ml-5 text-xs text-slate-700 space-y-1">
                                <p className="text-slate-600">{q.preview}</p>
                                {q.optionPreviews.map((o, k) => (
                                  <p key={k}><b>{q.kind === 'tf' ? `${'abcd'[k]})` : `${'ABCDEF'[k]}.`}</b> {o || '(hình hoặc công thức)'}</p>
                                ))}
                                <p className="text-slate-500">{q.stats.objects} MathType · {q.stats.equations} công thức Word · {q.stats.images} hình · {q.stats.tables} bảng{q.answerSource ? ` · Đáp án ${SOURCE_LABEL[q.answerSource]}` : ''}</p>
                                {q.warnings.map(w => <p key={w} className="text-amber-800">{w}</p>)}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card-elevated p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900">Thông tin đề thi</h3>
              <button
                type="button"
                onClick={() => updateSettings({ examInfo: { ...(hasExamInfo(settings.examInfo) ? EMPTY_EXAM_INFO : DEFAULT_EXAM_INFO) } })}
                className="text-xs font-semibold text-orange-700 hover:text-orange-900 underline underline-offset-2"
              >
                {hasExamInfo(settings.examInfo) ? 'Giữ tiêu đề của đề gốc' : 'Điền lại thông tin mẫu'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">
              {hasExamInfo(settings.examInfo)
                ? 'Hãy sửa lại cho đúng đề của bạn. Tiêu đề của đề gốc sẽ được thay bằng thông tin dưới đây, kèm dòng họ tên, số báo danh và mã đề.'
                : 'Các ô đang trống nên tiêu đề của đề gốc được giữ nguyên.'}
            </p>
            <div className="space-y-1">
              {EXAM_INFO_FIELDS.map(field => (
                <label key={field.key} className="grid sm:grid-cols-[11rem_1fr] sm:items-center gap-x-4">
                  <span className="text-sm font-semibold text-slate-600">{field.label}</span>
                  <input
                    type="text"
                    value={settings.examInfo?.[field.key] || ''}
                    placeholder={field.placeholder}
                    onChange={e => updateSettings({ examInfo: { ...EMPTY_EXAM_INFO, ...settings.examInfo, [field.key]: e.target.value } })}
                    className="w-full bg-transparent border-0 border-b border-orange-500 px-1 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-b-2 focus:border-orange-600"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleMix} disabled={!!busy} className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-bold disabled:opacity-50">
              <Shuffle className="w-4 h-4" /> Trộn {clampedCount} mã đề
            </button>
            {busy && <span className="text-sm text-orange-800" role="status">{busy}</span>}
          </div>

          {built.length > 0 && (
            <div className="card-elevated p-4 space-y-3">
              <div className={`flex items-start gap-2 text-sm font-semibold ${problemCount ? 'text-red-700' : 'text-emerald-700'}`} role="status">
                {problemCount ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                {problemCount
                  ? `Có ${problemCount} điểm không khớp với đề gốc. Hãy xem danh sách bên dưới trước khi dùng.`
                  : `Đã tạo ${built.length} mã đề. App đã đọc lại từng file và đối chiếu: đủ câu, đủ công thức và hình, đáp án khớp nội dung, không còn dấu đáp án.`}
              </div>
              {built.filter(b => b.problems.length).map(b => (
                <div key={b.plan.code} className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                  <b>Mã {b.plan.code}:</b> {b.problems.join(' ')}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={downloadAll} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold disabled:opacity-50">
                  <Download className="w-4 h-4" /> Tải tất cả (.zip)
                </button>
                <button type="button" onClick={downloadExcel} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-sm font-semibold disabled:opacity-50">
                  <FileSpreadsheet className="w-4 h-4" /> Đáp án (.xlsx)
                </button>
                {built.map(b => (
                  <button key={b.plan.code} type="button" onClick={() => saveBlob(b.blob, versionFile(b.plan.code))} className="px-3 py-2 rounded-lg border border-orange-200 bg-white hover:bg-orange-50 text-orange-900 text-sm font-medium">
                    Mã {b.plan.code}
                  </button>
                ))}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-slate-700">Xem bảng đáp án các mã đề</summary>
                <div className="overflow-x-auto mt-2">
                  <table className="text-xs border-collapse">
                    <thead>
                      <tr>{rows[0].map(c => <th key={String(c)} className="border border-slate-300 bg-slate-100 px-2 py-1">{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.slice(1).map((r, i) => (
                        <tr key={i}>{r.map((c, k) => <td key={k} className="border border-slate-300 px-2 py-1 text-center">{c}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <p className="text-xs text-slate-500">
                Vui lòng mở thử một mã đề bằng Word để xem ngắt trang và số trang ghi ở đầu đề trước khi in.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DocxMixPage;
