import React, { useState, useRef } from 'react';
import { Download, Play, RefreshCw, AlertCircle, Loader2, FileCheck, ArrowRight } from 'lucide-react';
import { Chat } from "@google/genai";
import FileUploadZone from './FileUploadZone';
import MarkdownRenderer from './MarkdownRenderer';
import { createVariantSession, generateVariantStep1, generateVariantNextStep, cloneVariantSession, VARIANT_MODELS } from '../services/variantsExamService';
import { exportToDoc } from '../services/exportUtils';
import { VariantFileData, VariantState } from '../types';
import { getApiKey, getFriendlyGeminiErrorMessage, parseApiError } from '../services/geminiService';

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

  const chatSessionRef = useRef<Chat | null>(null);
  const currentModelIndexRef = useRef<number>(0);

  const handleFileSelect = (data: { base64: string; mimeType: string; name: string }) => {
    setFile({ name: data.name, type: data.mimeType, data: data.base64 });
  };

  const executeStepWithRetry = async (
    stepName: string,
    executeFn: (chat: Chat) => Promise<void>,
    resetOutput: () => void
  ) => {
    let lastError: any = null;
    const apiKey = getApiKey();
    if (!apiKey) throw new Error("Vui lòng nhập API Key");

    for (let i = currentModelIndexRef.current; i < VARIANT_MODELS.length; i++) {
      try {
        await executeFn(chatSessionRef.current!);
        currentModelIndexRef.current = i;
        return;
      } catch (err: any) {
        const errorType = parseApiError(err);
        console.warn(`[Variants] Step '${stepName}' failed with ${VARIANT_MODELS[i].id} (${errorType}):`, err);
        lastError = err;

        if (errorType === 'INVALID_API_KEY') {
          break;
        }

        if (i < VARIANT_MODELS.length - 1) {
          resetOutput();
          const nextModel = VARIANT_MODELS[i + 1].id;
          console.log(`[Variants] Switching to fallback: ${nextModel}`);
          if (chatSessionRef.current) {
            chatSessionRef.current = await cloneVariantSession(apiKey, chatSessionRef.current, nextModel);
          }
        }
      }
    }
    throw new Error(getFriendlyGeminiErrorMessage(lastError));
  };

  const runProcess = async () => {
    if (!file) return;
    if (!checkAuth()) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      setError("Vui lòng nhập API Key trong phần Cài đặt.");
      return;
    }

    currentModelIndexRef.current = 0;
    setState(VariantState.PROCESSING_STEP_1);
    setCol1(''); setCol2(''); setCol3('');
    setError(null);

    chatSessionRef.current = createVariantSession(apiKey, VARIANT_MODELS[0].id);

    try {
      // Step 1
      await executeStepWithRetry(
        "Step 1",
        async (chat) => {
          await generateVariantStep1(chat, file, (chunk) => setCol1(prev => prev + chunk));
        },
        () => setCol1('')
      );
    } catch (err: any) {
      handleError(err);
      return;
    }

    // Step 2
    setState(VariantState.PROCESSING_STEP_2);
    try {
      await executeStepWithRetry(
        "Step 2",
        async (chat) => {
          await generateVariantNextStep(chat, 2, (chunk) => setCol2(prev => prev + chunk));
        },
        () => setCol2('')
      );
    } catch (err: any) {
      handleError(err);
      return;
    }

    // Step 3
    setState(VariantState.PROCESSING_STEP_3);
    try {
      await executeStepWithRetry(
        "Step 3",
        async (chat) => {
          await generateVariantNextStep(chat, 3, (chunk) => setCol3(prev => prev + chunk));
        },
        () => setCol3('')
      );
      setState(VariantState.COMPLETE);
    } catch (err: any) {
      handleError(err);
    }
  };

  const handleError = (err: any) => {
    setState(VariantState.ERROR);
    let message = "Có lỗi xảy ra";
    if (typeof err === 'string') message = err;
    else if (err instanceof Error) message = err.message;
    else if (err && typeof err === 'object') message = JSON.stringify(err);

    if (message.includes("MODEL_OVERLOADED") || message.includes("503") || message.includes("UNAVAILABLE") || message.toLowerCase().includes("overloaded") || message.toLowerCase().includes("high demand") || message.includes("quá tải")) {
      message = "Model Gemini đang tạm quá tải. Ứng dụng đã thử các model dự phòng; vui lòng đợi 1-2 phút rồi thử lại.";
    } else if (message.includes("429") || message.includes("Quota exceeded") || message.includes("RESOURCE_EXHAUSTED")) {
      message = "Hết hạn mức sử dụng (Quota Exceeded). Vui lòng thử lại sau hoặc đổi API Key.";
    } else if (message.includes("API key not valid") || message.includes("INVALID_API_KEY")) {
      message = "API Key không hợp lệ. Vui lòng kiểm tra lại.";
    }
    setError(message);
  };

  const handleExport = () => {
    if (!col1 && !col2 && !col3) return;
    const fullContent = `${col1}\n\n***\n\n${col2}\n\n***\n\n${col3}`;
    const fileName = file ? `Bo_3_De_Thi_${file.name.split('.')[0]}` : 'ExamGen_Output';
    exportToDoc(fullContent, fileName);
  };

  const reset = () => {
    setFile(null);
    setCol1(''); setCol2(''); setCol3('');
    setState(VariantState.IDLE);
    setError(null);
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
            Tải lên đề gốc (PDF/Ảnh). Hệ thống sẽ tự động sinh 3 đề biến thể kèm đáp án chi tiết theo quy trình 3 bước.
          </p>
        </div>

        <div className="card-elevated p-6">
          <FileUploadZone
            onFileSelect={handleFileSelect}
            selectedFileName={file?.name}
            onClear={reset}
            label="Kéo thả đề gốc vào đây"
            sublabel="Hỗ trợ PDF, JPG, PNG"
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
    const isActive = state === step;
    const isDone = state > step && state !== VariantState.ERROR;
    const isError = state === VariantState.ERROR && state >= step;

    return (
      <div className={`flex items-center ${
        isError && state === step ? 'text-red-500' :
        isActive ? 'text-teal-600 animate-pulse' :
        isDone ? 'text-green-600' :
        'text-slate-400'
      }`}>
        {isDone ? (
          <FileCheck className="w-5 h-5 mr-2" />
        ) : isError && state === step ? (
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
          <span className="break-all text-sm flex-1">{error}</span>
          <button onClick={reset} className="underline font-bold text-sm">Thử lại</button>
        </div>
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
