import React, { useState, useRef } from 'react';
import { Download, Play, RefreshCw, AlertCircle, Loader2, FileCheck, ArrowRight, Key } from 'lucide-react';
import { Chat, Content } from "@google/genai";
import FileUploadZone from './FileUploadZone';
import MarkdownRenderer from './MarkdownRenderer';
import BbtQuickGenerator from './BbtQuickGenerator';
import SubjectStudio from './SubjectStudio';
import { SUBJECT_OPTIONS } from '../services/subjectFigures';
import { createVariantSession, generateVariantStep1, generateVariantNextStep, cloneVariantSession, countVariantQuestions, VARIANT_PROFILES, VariantStep } from '../services/variantsExamService';
import { exportToDoc } from '../services/exportUtils';
import MathFormatSelect from './MathFormatSelect';
import ShuffleExamPanel from './ShuffleExamPanel';
import { VariantFileData, VariantState } from '../types';
import {
  getApiKey,
  getFriendlyGeminiErrorMessage,
  classifyApiError,
  getAiProvider,
  getGeminiModelsToTry,
  getSelectedModel,
  setFallbackNotice,
  UserFacingError,
  hasAiAccess,
  checkServerProxyAvailable,
  getServerProxyStatus,
  maskGoogleAiApiKey,
  SERVER_PROXY_KEY_SENTINEL,
} from '../services/geminiService';
import { apiKeyManager } from '../services/apiKeyManager';
import { prepareExamSourceParts, isDocxSource } from '../services/examSourceService';

interface VariantsExamPageProps {
  checkAuth: () => boolean;
  onOpenSettings?: () => void;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const VariantsExamPage: React.FC<VariantsExamPageProps> = ({ checkAuth, onOpenSettings }) => {
  const [file, setFile] = useState<VariantFileData | null>(null);
  // Môn học bắt buộc: quyết định Studio hình nạp kèm (Hóa, Lí, Sinh…)
  const [subject, setSubject] = useState('');
  const [subjectError, setSubjectError] = useState(false);
  const [col1, setCol1] = useState('');
  const [col2, setCol2] = useState('');
  const [col3, setCol3] = useState('');
  const [state, setState] = useState<VariantState>(VariantState.IDLE);
  const [error, setError] = useState<string | null>(null);
  // Bước bị lỗi (1/2/3) → cho phép chạy tiếp từ bước đó mà KHÔNG mất các đề đã sinh xong
  const [failedStep, setFailedStep] = useState<1 | 2 | 3 | null>(null);

  const chatSessionRef = useRef<Chat | null>(null);
  const historyBeforeFailedStepRef = useRef<Content[]>([]);
  const currentModelRef = useRef<string>('');
  const currentKeyRef = useRef<string>('');

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
    resetOutput: () => void,
    historySnapshot: Content[]
  ) => {
    const provider = getAiProvider();
    const models = getGeminiModelsToTry(currentModelRef.current || getSelectedModel(provider), provider);

    // Nhánh Agent Platform (1 key riêng, fallback qua AGENT_PLATFORM_FALLBACK_MODELS)
    if (provider === 'agent-platform') {
      const apiKey = getApiKey('agent-platform');
      if (!apiKey) {
        throw new Error('Vui lòng nhập API Key cho Agent Platform trong phần Cài đặt.');
      }
      let lastError: any = null;
      for (let i = 0; i < models.length; i++) {
        const targetModel = models[i];
        try {
          if (!chatSessionRef.current || currentModelRef.current !== targetModel || currentKeyRef.current !== apiKey) {
            chatSessionRef.current = await cloneVariantSession(apiKey, historySnapshot, targetModel, 'agent-platform');
            currentModelRef.current = targetModel;
            currentKeyRef.current = apiKey;
          }
          await executeFn(chatSessionRef.current);
          setFallbackNotice(null);
          return;
        } catch (err: any) {
          if (err instanceof UserFacingError) throw err;
          lastError = err;
          const classified = classifyApiError(err);
          console.warn(`[Variants] (agent-platform) Step '${stepName}' failed with ${targetModel} (${classified.type}):`, err);
          if (classified.type === 'INVALID_API_KEY' || classified.type === 'INVALID_ARGUMENT') {
            break;
          }
          if (i < models.length - 1) {
            resetOutput();
            const nextModel = models[i + 1];
            setFallbackNotice(`Đang tự động chuyển từ ${targetModel} sang ${nextModel} (do ${targetModel} đang bận)...`);
          }
        }
      }
      setFallbackNotice(null);
      throw new Error(getFriendlyGeminiErrorMessage(lastError, 'agent-platform'));
    }

    // Nhánh Gemini API: 2 tầng (Multi-Key trên cùng model → Server Proxy → Model Free Tier kế tiếp → Short RPM wait)
    if (!getServerProxyStatus().checked && apiKeyManager.getAllKeys().length === 0) {
      await checkServerProxyAvailable();
    }
    const proxyStatus = getServerProxyStatus();
    const hasAnyClientKey = apiKeyManager.getAllKeys().length > 0;
    if (!hasAnyClientKey && !proxyStatus.available) {
      throw new Error('Vui lòng nhập ít nhất 1 Gemini API Key trong phần Cài đặt.');
    }

    let lastError: any = null;
    let hasWaitedRpm = false;

    const runPass = async (): Promise<boolean> => {
      for (let mIdx = 0; mIdx < models.length; mIdx++) {
        const targetModel = models[mIdx];
        const candidateKeys = apiKeyManager.getAvailableKeysForModel(
          targetModel,
          currentKeyRef.current && currentKeyRef.current !== SERVER_PROXY_KEY_SENTINEL ? currentKeyRef.current : undefined
        );

        let modelServerFailed = false;

        // Tầng 1: Thử hết các key khả dụng trên CÙNG model
        for (let kIdx = 0; kIdx < candidateKeys.length; kIdx++) {
          const candidateKey = candidateKeys[kIdx];
          try {
            if (
              !chatSessionRef.current ||
              currentModelRef.current !== targetModel ||
              currentKeyRef.current !== candidateKey
            ) {
              chatSessionRef.current = await cloneVariantSession(candidateKey, historySnapshot, targetModel, 'gemini');
              currentModelRef.current = targetModel;
              currentKeyRef.current = candidateKey;
            }
            await executeFn(chatSessionRef.current);
            setFallbackNotice(null);
            return true;
          } catch (err: any) {
            if (err instanceof UserFacingError) throw err;
            lastError = err;
            const classified = classifyApiError(err);
            console.warn(
              `[Variants] (gemini) Step '${stepName}' failed on model=${targetModel} key=${maskGoogleAiApiKey(candidateKey)} (${classified.type}):`,
              err
            );

            // Reset output & vô hiệu session cũ để lần thử tiếp luôn bắt đầu từ historySnapshot sạch
            resetOutput();
            chatSessionRef.current = null;

            if (classified.type === 'QUOTA_EXCEEDED' || classified.type === 'RATE_LIMIT') {
              apiKeyManager.markKeyModelQuotaError(candidateKey, targetModel, classified.type, {
                isPerMinute: classified.isPerMinute,
                retryDelaySec: classified.retryDelaySec,
              });
              if (kIdx < candidateKeys.length - 1) {
                setFallbackNotice(
                  `Key ${maskGoogleAiApiKey(candidateKey)} tạm hết quota trên ${targetModel} — đang tự động xoay sang key dự phòng #${kIdx + 2}/${candidateKeys.length}...`
                );
                continue;
              }
              break;
            }

            if (classified.type === 'INVALID_API_KEY' || classified.type === 'PERMISSION_DENIED') {
              apiKeyManager.markKeyError(candidateKey, classified.type, targetModel);
              if (kIdx < candidateKeys.length - 1) {
                setFallbackNotice(`Key ${maskGoogleAiApiKey(candidateKey)} bị từ chối — đang xoay sang key dự phòng...`);
                continue;
              }
              break;
            }

            if (
              classified.type === 'MODEL_OVERLOADED' ||
              classified.type === 'TRANSIENT_SERVER_ERROR' ||
              classified.type === 'NOT_FOUND' ||
              classified.isThinkingConfigError
            ) {
              modelServerFailed = true;
              break;
            }

            throw err;
          }
        }

        // Tầng 3: Fallback sang Server Proxy (/api/gemini) nếu bật
        if (!modelServerFailed && proxyStatus.available) {
          try {
            if (hasAnyClientKey) {
              setFallbackNotice(`Key cá nhân tạm hết quota trên ${targetModel} — đang dùng kho key dự phòng máy chủ...`);
            }
            chatSessionRef.current = await cloneVariantSession(SERVER_PROXY_KEY_SENTINEL, historySnapshot, targetModel, 'gemini');
            currentModelRef.current = targetModel;
            currentKeyRef.current = SERVER_PROXY_KEY_SENTINEL;
            await executeFn(chatSessionRef.current);
            setFallbackNotice(null);
            return true;
          } catch (proxyErr: any) {
            if (proxyErr instanceof UserFacingError) throw proxyErr;
            lastError = proxyErr;
            resetOutput();
            chatSessionRef.current = null;
            console.warn(`[Variants] (gemini-proxy) Step '${stepName}' failed on model=${targetModel}:`, proxyErr);
          }
        }

        // Tầng 2: Hạ sang model Free Tier tiếp theo
        if (mIdx < models.length - 1) {
          const nextModel = models[mIdx + 1];
          setFallbackNotice(
            `Đang tự động chuyển từ ${targetModel} sang ${nextModel} (mỗi model có hạn mức miễn phí riêng)...`
          );
        }
      }
      return false;
    };

    try {
      while (true) {
        const ok = await runPass();
        if (ok) return;
        const lastType = lastError ? classifyApiError(lastError).type : 'UNKNOWN';
        if (!hasWaitedRpm && (lastType === 'RATE_LIMIT' || lastType === 'QUOTA_EXCEEDED')) {
          const soonestMs = apiKeyManager.getSoonestCooldownMs(models[0]);
          if (soonestMs !== null && soonestMs > 0 && soonestMs <= 35_000) {
            hasWaitedRpm = true;
            const waitSec = Math.ceil(soonestMs / 1000);
            setFallbackNotice(`Tất cả key đang nghỉ giới hạn tốc độ (RPM) — tự động thử lại sau ${waitSec} giây...`);
            await delay(soonestMs + 500);
            continue;
          }
        }
        break;
      }
    } finally {
      setFallbackNotice(null);
    }

    throw new Error(getFriendlyGeminiErrorMessage(lastError, 'gemini'));
  };

  const STEP_STATES = [VariantState.PROCESSING_STEP_1, VariantState.PROCESSING_STEP_2, VariantState.PROCESSING_STEP_3] as const;
  const setters = [setCol1, setCol2, setCol3];

  /** Chạy quy trình từ bước `fromStep` (1 = từ đầu). Các đề trước bước đó được giữ nguyên. */
  const runFrom = async (fromStep: 1 | 2 | 3) => {
    if (!file) return;
    if (!subject) { setSubjectError(true); return; }
    if (!checkAuth()) return;

    const provider = getAiProvider();
    if (provider === 'gemini' && !getServerProxyStatus().checked && apiKeyManager.getAllKeys().length === 0) {
      await checkServerProxyAvailable();
    }
    if (!hasAiAccess(provider)) {
      setError(`Vui lòng nhập API Key cho ${provider === 'agent-platform' ? 'Agent Platform' : 'Google Gemini'} trong phần Cài đặt.`);
      return;
    }

    const models = getGeminiModelsToTry(getSelectedModel(provider), provider);
    const initialKey =
      provider === 'agent-platform'
        ? getApiKey('agent-platform')!
        : apiKeyManager.getAvailableKeysForModel(models[0])[0] ||
          apiKeyManager.getActiveKey(models[0]) ||
          SERVER_PROXY_KEY_SENTINEL;

    setError(null);
    setFailedStep(null);
    setFallbackNotice(null);
    if (fromStep === 1 || (!chatSessionRef.current && historyBeforeFailedStepRef.current.length === 0)) {
      // Bắt đầu lại từ đầu: tạo phiên mới
      fromStep = 1;
      historyBeforeFailedStepRef.current = [];
      currentModelRef.current = models[0];
      currentKeyRef.current = initialKey;
      setCol1(''); setCol2(''); setCol3('');
      chatSessionRef.current = createVariantSession(initialKey, models[0], provider);
    } else {
      // Chạy tiếp từ bước lỗi: xoá phần dở dang của bước lỗi và các bước sau, khôi phục từ snapshot sạch
      for (let k = fromStep; k <= 3; k++) setters[k - 1]('');
      currentModelRef.current = models[0];
      currentKeyRef.current = initialKey;
      chatSessionRef.current = await cloneVariantSession(initialKey, historyBeforeFailedStepRef.current, models[0], provider);
    }

    for (let step = fromStep; step <= 3; step++) {
      setState(STEP_STATES[step - 1]);
      const setCol = setters[step - 1];
      let historySnapshot: Content[] = [];
      if (step > 1) {
        if (chatSessionRef.current) {
          try {
            historySnapshot = await Promise.resolve(chatSessionRef.current.getHistory());
          } catch {
            historySnapshot = historyBeforeFailedStepRef.current;
          }
        } else {
          historySnapshot = historyBeforeFailedStepRef.current;
        }
      }
      historyBeforeFailedStepRef.current = historySnapshot;

      try {
        await executeStepWithRetry(
          `Step ${step}`,
          async (chat) => {
            if (step === 1) await generateVariantStep1(chat, file, (chunk) => setCol(prev => prev + chunk), subject);
            else await generateVariantNextStep(chat, step as 2 | 3, (chunk) => setCol(prev => prev + chunk));
          },
          () => setCol(''),
          historySnapshot
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
    historyBeforeFailedStepRef.current = [];
    currentModelRef.current = '';
    currentKeyRef.current = '';
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
            Tải lên đề gốc (Word, PDF hoặc ảnh). Hệ thống tự động sinh 3 đề theo 3 mục tiêu khác nhau, kèm đáp án chi tiết.
          </p>
        </div>

        <div className="card-elevated p-6">
          <div className="mb-5 space-y-1.5">
            <label htmlFor="variants-subject" className="block text-sm font-semibold text-teal-800">
              Môn học <span className="text-red-600">*</span>
            </label>
            <select
              id="variants-subject"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setSubjectError(false); }}
              aria-invalid={subjectError}
              className={`w-full p-2.5 input-elevated text-sm ${subjectError ? 'ring-2 ring-red-400' : ''}`}
            >
              <option value="">-- Chọn môn học của đề gốc --</option>
              {SUBJECT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            {subjectError
              ? <p className="text-xs text-red-600" role="alert">Vui lòng chọn Môn học trước khi sinh đề.</p>
              : <p className="text-xs text-slate-500">Môn Hóa học, Vật lí, Sinh học có thêm Studio vẽ hình riêng của môn sau khi sinh đề.</p>}
          </div>
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
            disabled={!file || !subject}
            className={`w-full mt-6 flex items-center justify-center gap-3 py-4 px-6 rounded-xl font-bold text-lg transition-all
              ${!file || !subject
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          {([1, 2, 3] as VariantStep[]).map(step => (
            <div key={step} className="card-elevated p-4 flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-full badge-section text-white flex items-center justify-center font-bold">{step}</div>
              <p className="text-sm font-bold text-teal-800">{VARIANT_PROFILES[step].label}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{VARIANT_PROFILES[step].description}</p>
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
        <div className="mb-4 mx-auto max-w-2xl w-full p-4 bg-red-50 text-red-700 border border-red-200 rounded-xl flex flex-wrap items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="break-words text-sm flex-1 min-w-[200px]">{error}</span>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold text-xs shrink-0"
            >
              <Key className="w-3.5 h-3.5" />
              Thêm API Key
            </button>
          )}
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
        <SubjectStudio
          subject={subject}
          documents={[
            { id: 'col1', label: 'Đề 1', content: col1, onUpdate: setCol1 },
            { id: 'col2', label: 'Đề 2', content: col2, onUpdate: setCol2 },
            { id: 'col3', label: 'Đề 3', content: col3, onUpdate: setCol3 },
          ]}
        />
      )}

      {(col1 || col2 || col3) && (
        <BbtQuickGenerator
          documents={[
            { id: 'col1', label: 'Đề 1', content: col1, onUpdate: setCol1 },
            { id: 'col2', label: 'Đề 2', content: col2, onUpdate: setCol2 },
            { id: 'col3', label: 'Đề 3', content: col3, onUpdate: setCol3 },
          ]}
        />
      )}

      {/* Đảo đề: tạo nhiều mã đề + file đáp án từ một trong các đề đã sinh xong */}
      {(() => {
        const finished = [col1, col2, col3]
          .map((exam, i) => ({ id: `col${i + 1}`, label: `Đề ${i + 1}`, exam, done: !!exam && (state > STEP_STATES[i] || (state === VariantState.ERROR && failedStep !== null && i + 1 < failedStep)) }))
          .filter(d => d.done);
        return finished.length > 0 ? (
          <ShuffleExamPanel className="mb-4" documents={finished} baseName={file ? file.name.replace(/\.[^/.]+$/, '') : 'De_bien_the'} />
        ) : null;
      })()}

      {/* 3 Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
        {renderColumn(`Đề 1: ${VARIANT_PROFILES[1].label}`, col1, VariantState.PROCESSING_STEP_1, "Chờ xử lý...")}
        {renderColumn(`Đề 2: ${VARIANT_PROFILES[2].label}`, col2, VariantState.PROCESSING_STEP_2, "Chờ Bước 1...")}
        {renderColumn(`Đề 3: ${VARIANT_PROFILES[3].label}`, col3, VariantState.PROCESSING_STEP_3, "Chờ Bước 2...")}
      </div>
    </div>
  );
};

export default VariantsExamPage;
