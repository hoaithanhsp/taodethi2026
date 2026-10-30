import React, { useState, useRef } from 'react';
import { Download, Play, RefreshCw, AlertCircle, Loader2, FileCheck, ArrowRight } from 'lucide-react';
import { Chat } from "@google/genai";
import FileUploadZone from './FileUploadZone';
import MarkdownRenderer from './MarkdownRenderer';
import BbtQuickGenerator from './BbtQuickGenerator';
import { createVariantSession, generateVariantStep1, generateVariantNextStep, cloneVariantSession, countVariantQuestions } from '../services/variantsExamService';
import { exportToDoc } from '../services/exportUtils';
import MathFormatSelect from './MathFormatSelect';
import { VariantFileData, VariantState } from '../types';
import { getApiKey, getFriendlyGeminiErrorMessage, parseApiError, getAiProvider, getGeminiModelsToTry, getSelectedModel, setFallbackNotice, UserFacingError } from '../services/geminiService';
import { prepareExamSourceParts, isDocxSource } from '../services/examSourceService';

interface VariantsExamPageProps {
  checkAuth: () => boolean;
}

const VariantsExamPage: React.FC<VariantsExamPageProps> = ({ checkAuth }) => {
  const [file, setFile] = useState<VariantFileData | null>(null);
  const [col1, setCol1] = useState('');
  const [col2, setCol2] = useState('');
  const [col3, setCol3] = useState('');
  const [state, setState] = useState<VariantState>(VariantState.IDLE);
  const [error, setError] = useState<string | null>(null);
  // Bước bị lỗi (1/2/3) → cho phép chạy tiếp từ bước đó mà KHÔNG mất các đề đã sinh xong
  const [failedStep, setFailedStep] = useState<1 | 2 | 3 | null>(null);

  const chatSessionRef = useRef<Chat | null>(null);
  const currentModelIndexRef = useRef<number>(0);

  const handleFileSelect = async (data: { base64: string; mimeType: string; name: string }) => {
    setError(null);
    if (isDocxSource(data.mimeType, data.name)) {
      // Kiểm tra file Word ngay khi chọn (MathType, .doc cũ, đề dạng ảnh…) để báo sớm
      try {
        await prepareExamSourceParts(data.base64, data.mimeType, data.name);
      } catch (err: any) {
        setFile(null);
        setError(err?.message || 'Không đọc được file Word này.');
        return;
      }
    }
    setFile({ name: data.name, type: data.mimeType, data: data.base64 });
  };

  const executeStepWithRetry = async (
    stepName: string,
    executeFn: (chat: Chat) => Promise<void>,
    resetOutput: () => void
  ) => {
    let lastError: any = null;
    const provider = getAiProvider();
    const models = getGeminiModelsToTry(getSelectedModel(), provider);
    const apiKey = getApiKey(provider);
    if (!apiKey) throw new Error(`Vui lòng nhập API Key cho ${provider === 'agent-platform' ? 'Agent Platform' : 'Google Gemini'} trong phần Cài đặt.`);

    for (let i = currentModelIndexRef.current; i < models.length; i++) {
      try {
        await executeFn(chatSessionRef.current!);
        currentModelIndexRef.current = i;
        setFallbackNotice(null);
        return;
      } catch (err: any) {
        const errorType = parseApiError(err);
        console.warn(`[Variants] (${provider}) Step '${stepName}' failed with ${models[i]} (${errorType}):`, err);
        lastError = err;

        // Sai API key hoặc lỗi về file (Word MathType, .doc cũ…) → đổi model cũng vô ích
        if (errorType === 'INVALID_API_KEY' || err instanceof UserFacingError) {
          break;
        }

        if (i < models.length - 1) {
          resetOutput();
          const currentModel = models[i];
          const nextModel = models[i + 1];
          setFallbackNotice(
            `Đang tự động chuyển từ ${currentModel} sang ${nextModel} (do ${currentModel} đang bận)...`
          );
          console.log(`[Variants] (${provider}) Switching to fallback: ${nextModel}`);
          if (chatSessionRef.current) {
            chatSessionRef.current = await cloneVariantSession(apiKey, chatSessionRef.current, nextModel, provider);
          }
        }
      }
    }
    setFallbackNotice(null);
    throw new Error(getFriendlyGeminiErrorMessage(lastError));
  };

  const STEP_STATES = [VariantState.PROCESSING_STEP_1, VariantState.PROCESSING_STEP_2, VariantState.PROCESSING_STEP_3] as const;
  const setters = [setCol1, setCol2, setCol3];

  /** Chạy quy trình từ bước `fromStep` (1 = từ đầu). Các đề trước bước đó được giữ nguyên. */
  const runFrom = async (fromStep: 1 | 2 | 3) => {
    if (!file) return;
    if (!checkAuth()) return;

    const provider = getAiProvider();
    const models = getGeminiModelsToTry(getSelectedModel(), provider);
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      setError(`Vui lòng nhập API Key cho ${provider === 'agent-platform' ? 'Agent Platform' : 'Google Gemini'} trong phần Cài đặt.`);
      return;
    }

    setError(null);
    setFailedStep(null);
    setFallbackNotice(null);
    if (fromStep === 1 || !chatSessionRef.current) {
      // Bắt đầu lại từ đầu (hoặc chưa có phiên): tạo phiên mới
      fromStep = 1;
      currentModelIndexRef.current = 0;
      setCol1(''); setCol2(''); setCol3('');
      chatSessionRef.current = createVariantSession(apiKey, models[0], provider);
    } else {
      // Chạy tiếp: xoá phần dở dang của bước lỗi và các bước sau
      for (let k = fromStep; k <= 3; k++) setters[k - 1]('');
    }

    for (let step = fromStep; step <= 3; step++) {
      setState(STEP_STATES[step - 1]);
      const setCol = setters[step - 1];
      try {
        await executeStepWithRetry(
          `Step ${step}`,
          async (chat) => {
            if (step === 1) await generateVariantStep1(chat, file, (chunk) => setCol(prev => prev + chunk));
            else await generateVariantNextStep(chat, step, (chunk) => setCol(prev => prev + chunk));
          },
          () => setCol('')
        );
      } catch (err: any) {
        handleError(err, step as 1 | 2 | 3);
        return;
      }
    }
    setFallbackNotice(null);
    setState(VariantState.COMPLETE);
  };

  const runProcess = () => runFrom(1);

  const handleError = (err: any, step: 1 | 2 | 3) => {
    setFallbackNotice(null);
    setFailedStep(step);
    setState(VariantState.ERROR);
    setError(getFriendlyGeminiErrorMessage(err));
  };

  const handleExport = () => {
    if (!col1 && !col2 && !col3) return;
    // Mỗi đề bắt đầu ở TRANG MỚI trong file Word (trước đây chỉ có đường kẻ ngang)
    const pageBreak = '\n\n<div style="page-break-before: always"></div>\n\n';
    const fullContent = [col1, col2, col3].filter(Boolean).join(pageBreak);
    const fileName = file ? `Bo_3_De_Thi_${file.name.split('.')[0]}` : 'ExamGen_Output';
    exportToDoc(fullContent, fileName);
  };

  const reset = () => {
    setFile(null);
    setCol1(''); setCol2(''); setCol3('');
    setState(VariantState.IDLE);
    setError(null);
    setFailedStep(null);
    chatSessionRef.current = null;
    currentModelIndexRef.current = 0;
  };

  // ===== IDLE =====
  if (state === VariantState.IDLE) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 pb-12 animate-fade-in-up">
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-extrabold text-teal-900 tracking-tight">
            Sinh <span className="text-blue-600">3 đề biến thể</span> từ 1 đề gốc
          </h2>
          <p className="text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
            Tải lên đề gốc (Word, PDF hoặc ảnh). Hệ thống sẽ tự động sinh 3 đề biến thể kèm đáp án chi tiết theo quy trình 3 bước.
          </p>
        </div>

        <div className="card-elevated p-6">
          <FileUploadZone
            onFileSelect={handleFileSelect}
            selectedFileName={file?.name}
            onClear={reset}
            label="Kéo thả đề gốc vào đây"
            sublabel="Hỗ trợ Word (.docx), PDF, JPG, PNG (tối đa 14 MB)"
            maxSizeMB={14}
            allowDocx
          />

          <button
            onClick={runProcess}
            disabled={!file}
            className={`w-full mt-6 flex items-center justify-center gap-3 py-4 px-6 rounded-xl font-bold text-lg transition-all
              ${!file
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:shadow-lg hover:-translate-y-0.5 active:scale-95'
              }`}
          >
            <Play className="w-6 h-6" />
            BẮT ĐẦU QUY TRÌNH 3 BƯỚC
          </button>
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span className="break-all text-sm">{error}</span>
          </div>
        )}

        {/* Feature highlights */}
        <div className="grid grid-cols-3 gap-4 text-center">
          {['Đề 1 + Đáp án', 'Đề 2 + Đáp án', 'Đề 3 + Đáp án'].map((label, i) => (
            <div key={i} className="card-elevated p-4 flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full badge-section text-white flex items-center justify-center font-bold">{i + 1}</div>
              <p className="text-sm font-medium text-teal-800">{label}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ===== PROCESSING / COMPLETE / ERROR =====
  const renderStepIndicator = (step: number, label: string) => {
    // Khi lỗi: các bước trước bước lỗi vẫn hiện "đã xong", bước lỗi hiện đỏ
    const isActive = state === step;
    const isError = state === VariantState.ERROR && failedStep === step;
    const isDone = state === VariantState.ERROR
      ? failedStep !== null && step < failedStep
      : state > step;

    return (
      <div className={`flex items-center ${
        isError ? 'text-red-500' :
        isActive ? 'text-teal-600 animate-pulse' :
        isDone ? 'text-green-600' :
        'text-slate-400'
      }`}>
        {isDone ? (
          <FileCheck className="w-5 h-5 mr-2" />
        ) : isError ? (
          <AlertCircle className="w-5 h-5 mr-2 text-red-500" />
        ) : (
          <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center mr-2 text-xs border-current">{step}</span>
        )}
        {label}
      </div>
    );
  };

  const renderColumn = (title: string, content: string, stepState: VariantState, waitMsg: string) => (
    <div className="flex flex-col panel-elevated overflow-hidden h-full min-h-[400px]">
      <div className="p-3 bg-teal-50/80 border-b border-teal-100 text-center font-bold text-teal-800 uppercase text-xs tracking-wider">
        {title}
        {content && state !== stepState && countVariantQuestions(content) !== null && (
          <span className="ml-2 normal-case font-medium text-teal-600">({countVariantQuestions(content)} câu)</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {content ? (
          <MarkdownRenderer content={content} />
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">
            {state === stepState ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
                <span>Đang xử lý...</span>
              </div>
            ) : state === VariantState.COMPLETE ? "Hoàn tất" :
              state === VariantState.ERROR ? "Đã dừng do lỗi" : waitMsg}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex-1 max-w-[1920px] mx-auto w-full flex flex-col pb-4">
      {/* Progress Bar */}
      <div className="mb-6 flex justify-center">
        <div className="bg-white rounded-full shadow-sm border border-teal-100 px-6 py-2.5 flex items-center gap-4 text-sm font-medium">
          {renderStepIndicator(VariantState.PROCESSING_STEP_1, "Đề 1")}
          <ArrowRight className="w-4 h-4 text-slate-300" />
          {renderStepIndicator(VariantState.PROCESSING_STEP_2, "Đề 2")}
          <ArrowRight className="w-4 h-4 text-slate-300" />
          {renderStepIndicator(VariantState.PROCESSING_STEP_3, "Đề 3")}

          {/* Actions */}
          <div className="ml-4 pl-4 border-l border-slate-200 flex items-center gap-2">
            <MathFormatSelect />
            <button
              onClick={handleExport}
              disabled={!col1}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Word (.docx)
            </button>
            {state === VariantState.COMPLETE && (
              <button onClick={reset} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full" title="Làm mới">
                <RefreshCw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 mx-auto max-w-2xl w-full p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="break-words text-sm flex-1">{error}</span>
          {failedStep && file && (
            <button onClick={() => runFrom(failedStep)} className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs shrink-0">
              {failedStep === 1 ? 'Thử lại' : `Chạy tiếp từ Đề ${failedStep}`}
            </button>
          )}
          <button onClick={reset} className="underline font-bold text-xs shrink-0">Làm lại từ đầu</button>
        </div>
      )}

      {/* So sánh số câu giữa các đề (đề biến thể phải cùng số câu) */}
      {(() => {
        const counts = [col1, col2, col3].map(c => countVariantQuestions(c));
        const done = [col1, col2, col3].map((c, i) => !!c && (state > STEP_STATES[i] || (state === VariantState.ERROR && failedStep !== null && i + 1 < failedStep)));
        const known = counts.filter((n, i) => n !== null && done[i]) as number[];
        if (known.length < 2 || known.every(n => n === known[0])) return null;
        return (
          <div className="mb-4 mx-auto max-w-2xl w-full p-3 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-sm">
            ⚠️ Số câu giữa các đề không bằng nhau: {counts.map((n, i) => (done[i] ? `Đề ${i + 1}: ${n ?? '?'} câu` : null)).filter(Boolean).join(' · ')}. Vui lòng kiểm tra lại hoặc chạy lại đề bị thiếu.
          </div>
        );
      })()}

      {(col1 || col2 || col3) && (
        <BbtQuickGenerator
          documents={[
            { id: 'col1', label: 'Đề 1', content: col1, onUpdate: setCol1 },
            { id: 'col2', label: 'Đề 2', content: col2, onUpdate: setCol2 },
            { id: 'col3', label: 'Đề 3', content: col3, onUpdate: setCol3 },
          ]}
        />
      )}

      {/* 3 Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {renderColumn("Bước 1: Đề & Đáp Án Đề 1", col1, VariantState.PROCESSING_STEP_1, "Chờ xử lý...")}
        {renderColumn("Bước 2: Đề & Đáp Án Đề 2", col2, VariantState.PROCESSING_STEP_2, "Chờ Bước 1...")}
        {renderColumn("Bước 3: Đề & Đáp Án Đề 3", col3, VariantState.PROCESSING_STEP_3, "Chờ Bước 2...")}
      </div>
    </div>
  );
};

export default VariantsExamPage;
