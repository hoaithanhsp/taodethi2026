import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Button from './Button';
import {
  Key,
  X,
  Zap,
  Cpu,
  Sparkles,
  ExternalLink,
  Server,
  Plus,
  Trash2,
  RefreshCw,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  FlaskConical,
  Check,
  Settings,
} from 'lucide-react';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_AGENT_PLATFORM_MODEL,
  GEMINI_MODELS,
  AGENT_PLATFORM_MODELS,
  FALLBACK_MODELS,
  type AiProvider,
} from '../constants';
import { isValidGoogleAiApiKey, normalizeGoogleAiApiKey } from '../services/apiKeyValidation';
import { apiKeyManager, type ApiKeyInfo } from '../services/apiKeyManager';
import {
  getAiProvider,
  setAiProvider,
  getApiKey,
  setApiKey,
  getSelectedModel,
  setSelectedModel,
  testApiKey,
  checkServerProxyAvailable,
  getServerProxyStatus,
  type ServerProxyStatus,
} from '../services/geminiService';

interface ApiKeyModalProps {
  isOpen: boolean;
  onSave: (key: string, selectedModel: string, provider: AiProvider) => void;
  onClose: () => void;
  isDismissible?: boolean;
  onUseOfflineMix?: () => void;
}

const ModelIcon: React.FC<{ modelId: string }> = ({ modelId }) => {
  if (modelId.startsWith('gemini-4')) return <Sparkles className="w-4 h-4" />;
  if (modelId.includes('flash-lite')) return <Zap className="w-4 h-4" />;
  if (modelId.includes('pro')) return <Sparkles className="w-4 h-4" />;
  return <Cpu className="w-4 h-4" />;
};

const formatDurationShort = (ms: number): string => {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}p ${sec}s`;
  return `${sec}s`;
};

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onSave,
  onClose,
  isDismissible = true,
  onUseOfflineMix,
}) => {
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [selectedModel, setSelectedModelState] = useState<string>(DEFAULT_GEMINI_MODEL);

  // Tab Gemini: Kho nhiều key xoay vòng (tối đa 30 key)
  const [bulkKeyInput, setBulkKeyInput] = useState('');
  const [poolKeys, setPoolKeys] = useState<ApiKeyInfo[]>([]);
  const [currentPoolIndex, setCurrentPoolIndex] = useState<number>(0);
  const [bulkFeedback, setBulkFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [keyTestResults, setKeyTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  // Tab Agent Platform: 1 key riêng tách biệt theo api.md §III
  const [agentApiKey, setAgentApiKey] = useState('');
  const [isTestingAgent, setIsTestingAgent] = useState(false);
  const [agentTestResult, setAgentTestResult] = useState<{ ok: boolean; title: string; message: string } | null>(null);

  // Trạng thái Server Proxy ẩn trên Vercel (/api/gemini)
  const [serverProxy, setServerProxy] = useState<ServerProxyStatus>(() => getServerProxyStatus());
  const [error, setError] = useState('');

  const availableModels = useMemo(
    () => (provider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS),
    [provider]
  );

  const refreshPoolState = useCallback(() => {
    setPoolKeys(apiKeyManager.getAllKeys());
    setCurrentPoolIndex(apiKeyManager.getCurrentIndex());
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const savedProvider = getAiProvider();
    setProvider(savedProvider);
    setAgentApiKey(getApiKey('agent-platform') || '');

    const savedModel = getSelectedModel(savedProvider);
    const validList = savedProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS;
    const defaultId = savedProvider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
    setSelectedModelState(validList.some(m => m.id === savedModel) ? savedModel : defaultId);

    setBulkKeyInput('');
    setBulkFeedback(null);
    setAgentTestResult(null);
    setError('');
    refreshPoolState();

    checkServerProxyAvailable().then(status => setServerProxy(status));
  }, [isOpen, refreshPoolState]);

  // Cập nhật đếm ngược cooldown mỗi 2 giây khi modal đang mở
  useEffect(() => {
    if (!isOpen || provider !== 'gemini') return;
    const timer = setInterval(() => {
      refreshPoolState();
    }, 2000);
    return () => clearInterval(timer);
  }, [isOpen, provider, refreshPoolState]);

  const handleProviderChange = (newProvider: AiProvider) => {
    setProvider(newProvider);
    setError('');
    setBulkFeedback(null);
    setAgentTestResult(null);

    if (newProvider === 'agent-platform') {
      setAgentApiKey(getApiKey('agent-platform') || '');
    } else {
      refreshPoolState();
    }

    const validList = newProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS;
    const defaultId = newProvider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
    if (!validList.some(m => m.id === selectedModel)) {
      setSelectedModelState(defaultId);
    }
  };

  const handleAddBulkKeys = () => {
    if (!bulkKeyInput.trim()) {
      setBulkFeedback({ ok: false, text: 'Hãy dán ít nhất 1 API key (AIzaSy... hoặc AQ...) vào ô phía trên.' });
      return;
    }
    const res = apiKeyManager.addKeysBulk(bulkKeyInput);
    refreshPoolState();
    setError('');

    if (res.added > 0) {
      setBulkKeyInput('');
      const extras: string[] = [];
      if (res.duplicates > 0) extras.push(`bỏ qua ${res.duplicates} key trùng`);
      if (res.invalid > 0) extras.push(`${res.invalid} dòng sai định dạng`);
      if (res.limitReached > 0) extras.push(`${res.limitReached} key vượt giới hạn ${apiKeyManager.getMaxKeys()}`);
      setBulkFeedback({
        ok: true,
        text: `✅ Đã thêm ${res.added} API key vào kho xoay vòng${extras.length ? ` (${extras.join(', ')})` : ''}. Tổng hiện có: ${res.total} key.`,
      });
      if (res.addedKeys[0] && !apiKeyManager.hasAvailableKeys()) {
        apiKeyManager.setActiveKey(res.addedKeys[0]);
        refreshPoolState();
      }
    } else {
      const reasons: string[] = [];
      if (res.duplicates > 0) reasons.push(`${res.duplicates} key đã tồn tại`);
      if (res.invalid > 0) reasons.push(`${res.invalid} key sai định dạng (cần bắt đầu bằng AIza... hoặc AQ...)`);
      if (res.limitReached > 0) reasons.push(`đã đạt giới hạn tối đa ${apiKeyManager.getMaxKeys()} key`);
      setBulkFeedback({
        ok: false,
        text: `⚠️ Không thêm được key mới: ${reasons.join(', ') || 'chưa nhận diện được key hợp lệ'}.`,
      });
    }
  };

  const handleTestSinglePoolKey = async (keyInfo: ApiKeyInfo) => {
    setTestingKey(keyInfo.key);
    try {
      const result = await testApiKey(keyInfo.key, 'gemini', selectedModel);
      if (result.ok) {
        apiKeyManager.resetKey(keyInfo.key);
        setKeyTestResults(prev => ({
          ...prev,
          [keyInfo.key]: { ok: true, message: `Hoạt động tốt (${result.model || selectedModel})` },
        }));
      } else {
        if (result.errorType === 'INVALID_API_KEY') {
          apiKeyManager.markKeyError(keyInfo.key, 'INVALID_API_KEY', selectedModel);
        } else if (result.errorType === 'QUOTA_EXCEEDED' || result.errorType === 'RATE_LIMIT') {
          apiKeyManager.markKeyModelQuotaError(keyInfo.key, selectedModel, result.errorType);
        }
        setKeyTestResults(prev => ({
          ...prev,
          [keyInfo.key]: { ok: false, message: result.title },
        }));
      }
      refreshPoolState();
    } finally {
      setTestingKey(null);
    }
  };

  const handleTestAllKeys = async () => {
    const all = apiKeyManager.getAllKeys();
    if (all.length === 0) {
      setBulkFeedback({ ok: false, text: 'Chưa có API key nào trong kho để kiểm tra.' });
      return;
    }
    setIsTestingAll(true);
    setBulkFeedback(null);
    let okCount = 0;
    try {
      for (const item of all) {
        setTestingKey(item.key);
        const result = await testApiKey(item.key, 'gemini', selectedModel);
        if (result.ok) {
          okCount++;
          apiKeyManager.resetKey(item.key);
          setKeyTestResults(prev => ({
            ...prev,
            [item.key]: { ok: true, message: `OK (${result.model || selectedModel})` },
          }));
        } else {
          if (result.errorType === 'INVALID_API_KEY') {
            apiKeyManager.markKeyError(item.key, 'INVALID_API_KEY', selectedModel);
          } else if (result.errorType === 'QUOTA_EXCEEDED' || result.errorType === 'RATE_LIMIT') {
            apiKeyManager.markKeyModelQuotaError(item.key, selectedModel, result.errorType);
          }
          setKeyTestResults(prev => ({
            ...prev,
            [item.key]: { ok: false, message: result.title },
          }));
        }
        refreshPoolState();
      }
      setBulkFeedback({
        ok: okCount > 0,
        text:
          okCount > 0
            ? `🧪 Kiểm tra xong: ${okCount}/${all.length} API key đang hoạt động tốt với ${selectedModel}.`
            : `⚠️ Không có key nào vượt qua kiểm tra với ${selectedModel} (có thể đang hết quota hoặc sai key).`,
      });
    } finally {
      setTestingKey(null);
      setIsTestingAll(false);
    }
  };

  const handleTestAgentKey = async () => {
    const keyToTest = normalizeGoogleAiApiKey(agentApiKey);
    setAgentTestResult(null);
    if (!keyToTest || !isValidGoogleAiApiKey(keyToTest)) {
      setError('Vui lòng nhập Agent Platform API Key đúng định dạng (AIza... hoặc AQ...) trước khi kiểm tra.');
      return;
    }
    setError('');
    setIsTestingAgent(true);
    try {
      setAgentTestResult(await testApiKey(keyToTest, 'agent-platform', selectedModel));
    } finally {
      setIsTestingAgent(false);
    }
  };

  const handleSave = () => {
    if (provider === 'agent-platform') {
      const keyToSave = normalizeGoogleAiApiKey(agentApiKey);
      if (!keyToSave) {
        setError('Vui lòng nhập Agent Platform API Key.');
        return;
      }
      if (!isValidGoogleAiApiKey(keyToSave)) {
        setError('API Key không đúng định dạng. Key hợp lệ bắt đầu bằng "AIza..." hoặc "AQ...", không chứa khoảng trắng.');
        return;
      }
      const validModel = AGENT_PLATFORM_MODELS.some(m => m.id === selectedModel)
        ? selectedModel
        : DEFAULT_AGENT_PLATFORM_MODEL;
      setAiProvider('agent-platform');
      setApiKey(keyToSave, 'agent-platform');
      setSelectedModel(validModel);
      setError('');
      onSave(keyToSave, validModel, 'agent-platform');
      return;
    }

    // Tab Gemini: nếu người dùng vừa dán key vào textarea mà chưa bấm "+ Thêm vào kho", tự động thêm luôn!
    if (bulkKeyInput.trim()) {
      const bulkRes = apiKeyManager.addKeysBulk(bulkKeyInput);
      refreshPoolState();
      if (bulkRes.added === 0 && bulkRes.duplicates === 0 && apiKeyManager.getAllKeys().length === 0) {
        setError('API Key vừa dán không đúng định dạng. Key Gemini bắt đầu bằng "AIzaSy..." hoặc "AQ...".');
        return;
      }
      setBulkKeyInput('');
    }

    const validModel = GEMINI_MODELS.some(m => m.id === selectedModel) ? selectedModel : DEFAULT_GEMINI_MODEL;
    const activeKey = apiKeyManager.getActiveKey(validModel) || apiKeyManager.getAllKeys()[0]?.key || '';

    if (!activeKey && !serverProxy.available) {
      setError('Vui lòng thêm ít nhất 1 Gemini API Key vào kho (khuyên dùng 2–5 key để tự xoay vòng tránh hết quota).');
      return;
    }

    setAiProvider('gemini');
    setSelectedModel(validModel);
    setError('');
    onSave(activeKey, validModel, 'gemini');
  };

  const stats = useMemo(() => apiKeyManager.getKeyStats(), [poolKeys]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="modal-elevated max-w-2xl w-full p-0 max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="relative px-6 py-5 border-b border-teal-100 flex-shrink-0 bg-gradient-to-r from-teal-50 to-emerald-50">
          {isDismissible && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-white/80 transition-colors"
              aria-label="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 bg-gradient-to-br from-teal-600 to-emerald-600 rounded-xl flex items-center justify-center shadow-md">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-teal-900">Cài đặt AI & Kho API Key Xoay Vòng</h2>
              <p className="text-xs text-teal-700">
                Mặc định Gemini 4 Hydrogen (miễn phí) • Hỗ trợ nhiều API key chống hết quota 429
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. Provider Selection */}
          <div>
            <label className="text-sm font-semibold text-teal-800 mb-2 block">1. Chọn Nền tảng AI (Provider)</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleProviderChange('gemini')}
                className={`p-3 rounded-xl border-2 text-left flex items-center gap-2.5 transition-all ${
                  provider === 'gemini'
                    ? 'border-teal-600 bg-teal-50 shadow-sm'
                    : 'border-slate-200 hover:border-teal-300 bg-white'
                }`}
              >
                <Cpu className={`w-5 h-5 shrink-0 ${provider === 'gemini' ? 'text-teal-600' : 'text-slate-400'}`} />
                <div>
                  <div className={`font-bold text-sm ${provider === 'gemini' ? 'text-teal-800' : 'text-slate-700'}`}>
                    Gemini API
                  </div>
                  <div className="text-xs text-slate-500">Google AI Studio (Có Free Tier)</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleProviderChange('agent-platform')}
                className={`p-3 rounded-xl border-2 text-left flex items-center gap-2.5 transition-all ${
                  provider === 'agent-platform'
                    ? 'border-purple-600 bg-purple-50 shadow-sm'
                    : 'border-slate-200 hover:border-purple-300 bg-white'
                }`}
              >
                <Server
                  className={`w-5 h-5 shrink-0 ${provider === 'agent-platform' ? 'text-purple-600' : 'text-slate-400'}`}
                />
                <div>
                  <div
                    className={`font-bold text-sm ${provider === 'agent-platform' ? 'text-purple-800' : 'text-slate-700'}`}
                  >
                    Agent Platform API
                  </div>
                  <div className="text-xs text-slate-500">Google Cloud Express</div>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Model Selector */}
          <div>
            <label className="text-sm font-semibold text-teal-800 mb-2 block">2. Chọn Model AI ưu tiên</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {availableModels.map(m => {
                const isSelected = selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModelState(m.id)}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${
                      isSelected
                        ? provider === 'agent-platform'
                          ? 'border-purple-500 bg-purple-50 shadow-sm'
                          : 'border-teal-500 bg-teal-50 shadow-sm'
                        : 'border-slate-200 hover:border-teal-300 bg-white'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                        isSelected
                          ? provider === 'agent-platform'
                            ? 'bg-purple-600 text-white'
                            : 'bg-teal-600 text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <ModelIcon modelId={m.id} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`font-semibold text-sm ${
                            isSelected
                              ? provider === 'agent-platform'
                                ? 'text-purple-800'
                                : 'text-teal-900'
                              : 'text-slate-800'
                          }`}
                        >
                          {m.name}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            m.badge === 'Mặc định'
                              ? 'bg-emerald-100 text-emerald-700'
                              : m.badge === 'Pro'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-teal-100 text-teal-700'
                          }`}
                        >
                          {m.badge}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{m.desc}</p>
                    </div>
                    {isSelected && (
                      <div
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          provider === 'agent-platform' ? 'bg-purple-600' : 'bg-teal-600'
                        }`}
                      >
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-600 mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              💡 <strong>Chống hết quota 2 tầng:</strong> Khi 1 key chạm hạn mức (429), app tự xoay sang key dự phòng kế
              tiếp trên <em>cùng model</em>; nếu hết key trên model đó, app tự chuyển sang model miễn phí kế tiếp (6
              model × N key = 6N nguồn quota độc lập).
            </p>
          </div>

          {/* 3. API Key Section */}
          {provider === 'gemini' ? (
            <div className="border-t border-slate-200 pt-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-semibold text-teal-800">
                  🔑 3. Kho Gemini API Key Xoay Vòng (tối đa {apiKeyManager.getMaxKeys()} key)
                </label>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                    {stats.active} sẵn sàng
                  </span>
                  {stats.cooldown > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                      {stats.cooldown} tạm nghỉ
                    </span>
                  )}
                  {stats.error > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                      {stats.error} lỗi
                    </span>
                  )}
                </div>
              </div>

              {serverProxy.available && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Kho key dự phòng bảo mật trên máy chủ đang bật ({serverProxy.keyCount} key ẩn).</strong>
                    <p className="mt-0.5 text-emerald-700">
                      Có thể dùng ngay không cần nhập key, hoặc dán thêm key cá nhân bên dưới để ưu tiên dùng trước.
                    </p>
                  </div>
                </div>
              )}

              {stats.envTotal > 0 && (
                <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl flex items-start gap-2.5 text-xs text-teal-800">
                  <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                  <div>
                    Đã nạp ngầm <strong>{stats.envTotal} API key dự phòng</strong> từ cấu hình môi trường local (tự động
                    ẩn giá trị key).
                  </div>
                </div>
              )}

              {/* Bulk Paste Box */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Dán 1 hoặc nhiều API Key (mỗi dòng 1 key, hoặc ngăn cách bằng dấu phẩy):
                  </span>
                  <span className="text-[11px] text-slate-500">AIzaSy... & AQ...</span>
                </div>
                <textarea
                  rows={3}
                  value={bulkKeyInput}
                  onChange={e => {
                    setBulkKeyInput(e.target.value);
                    setBulkFeedback(null);
                    setError('');
                  }}
                  placeholder={
                    'Dán nhiều API key để tự động xoay vòng khi hết quota:\nAIzaSy...key1\nAIzaSy...key2\nAIzaSy...key3'
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-xs font-mono resize-y"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddBulkKeys}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Thêm vào kho xoay vòng
                  </button>
                  {poolKeys.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={handleTestAllKeys}
                        disabled={isTestingAll || testingKey !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-teal-300 text-teal-700 bg-white hover:bg-teal-50 disabled:opacity-50 transition-colors"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        {isTestingAll ? 'Đang kiểm tra...' : 'Kiểm tra tất cả'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          apiKeyManager.resetAllKeys();
                          setKeyTestResults({});
                          refreshPoolState();
                          setBulkFeedback({ ok: true, text: '🔄 Đã reset trạng thái tất cả key về Sẵn sàng.' });
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reset tất cả
                      </button>
                    </>
                  )}
                </div>

                {bulkFeedback && (
                  <div
                    className={`p-2.5 rounded-lg text-xs font-medium border ${
                      bulkFeedback.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                  >
                    {bulkFeedback.text}
                  </div>
                )}
              </div>

              {/* Key Pool List */}
              {poolKeys.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      Danh sách key trong kho ({poolKeys.length} key — bấm &quot;Dùng&quot; để chọn ưu tiên #1):
                    </span>
                    {stats.userTotal > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Xóa toàn bộ các API key bạn đã nhập?')) {
                            apiKeyManager.clearAllUserKeys();
                            setKeyTestResults({});
                            refreshPoolState();
                          }
                        }}
                        className="text-[11px] text-red-500 hover:text-red-700 hover:underline"
                      >
                        Xóa tất cả key của tôi
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {poolKeys.map((keyInfo, idx) => {
                      const isCurrent = idx === currentPoolIndex;
                      const isEnv = keyInfo.source === 'env';
                      const masked = apiKeyManager.maskKey(keyInfo.key);
                      const activeModelCds = apiKeyManager.getActiveModelCooldowns(keyInfo.key);
                      const cdModelCount = Object.keys(activeModelCds).length;
                      const soonestCdMs = keyInfo.cooldownUntil
                        ? Math.max(0, keyInfo.cooldownUntil - Date.now())
                        : cdModelCount > 0
                          ? Math.min(...Object.values(activeModelCds))
                          : 0;
                      const testRes = keyTestResults[keyInfo.key];
                      const isTestingThis = testingKey === keyInfo.key;

                      return (
                        <div
                          key={keyInfo.key}
                          className={`p-2.5 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                            isCurrent && keyInfo.status === 'active'
                              ? 'border-teal-400 bg-teal-50/70'
                              : keyInfo.status === 'error'
                                ? 'border-red-200 bg-red-50/50'
                                : keyInfo.status === 'cooldown'
                                  ? 'border-amber-200 bg-amber-50/50'
                                  : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-xs text-slate-800">{keyInfo.name}</span>
                              <span className="font-mono text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                {masked}
                              </span>
                              {isEnv && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                                  Hệ thống (ẩn)
                                </span>
                              )}
                              {isCurrent && keyInfo.status === 'active' && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-teal-600 text-white">
                                  Đang ưu tiên
                                </span>
                              )}
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                              {keyInfo.status === 'error' ? (
                                <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                                  <AlertCircle className="w-3 h-3" /> Key lỗi / không hợp lệ
                                </span>
                              ) : keyInfo.status === 'cooldown' ? (
                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                  <Clock className="w-3 h-3" /> Tạm nghỉ hết quota (
                                  {soonestCdMs > 0 ? `còn ${formatDurationShort(soonestCdMs)}` : 'sắp mở lại'})
                                </span>
                              ) : cdModelCount > 0 ? (
                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                  <Clock className="w-3 h-3" /> Hết lượt {cdModelCount}/{FALLBACK_MODELS.length} model
                                  (còn {FALLBACK_MODELS.length - cdModelCount} model dùng được)
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                  <CheckCircle2 className="w-3 h-3" /> Sẵn sàng
                                </span>
                              )}

                              {testRes && (
                                <span className={`font-medium ${testRes.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                                  • {testRes.message}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {!isCurrent && keyInfo.status !== 'error' && (
                              <button
                                type="button"
                                onClick={() => {
                                  apiKeyManager.setActiveKey(keyInfo.key);
                                  refreshPoolState();
                                }}
                                className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-teal-300 text-teal-700 bg-white hover:bg-teal-50"
                              >
                                Dùng
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isTestingThis || isTestingAll}
                              onClick={() => handleTestSinglePoolKey(keyInfo)}
                              className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50"
                            >
                              {isTestingThis ? '...' : 'Test'}
                            </button>
                            {(keyInfo.status !== 'active' || cdModelCount > 0) && (
                              <button
                                type="button"
                                onClick={() => {
                                  apiKeyManager.resetKey(keyInfo.key);
                                  refreshPoolState();
                                }}
                                title="Kích hoạt lại key"
                                className="p-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!isEnv && (
                              <button
                                type="button"
                                onClick={() => {
                                  apiKeyManager.removeKey(keyInfo.key);
                                  refreshPoolState();
                                }}
                                title="Xóa key"
                                className="p-1.5 rounded-lg border border-red-200 text-red-600 bg-white hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <a
                href="https://aistudio.google.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-teal-700 hover:underline font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Lấy API Key miễn phí tại Google AI Studio (có thể tạo nhiều key từ nhiều Gmail)
              </a>
            </div>
          ) : (
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <label className="text-sm font-semibold text-purple-800 block">🔑 3. API Key (Agent Platform)</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={agentApiKey}
                  onChange={e => {
                    setAgentApiKey(e.target.value);
                    setAgentTestResult(null);
                    if (error) setError('');
                  }}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  placeholder="Dán Agent Platform API Key (AQ... hoặc AIzaSy...)"
                  className="flex-1 p-2.5 input-elevated focus:ring-2 focus:ring-purple-500 outline-none font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={handleTestAgentKey}
                  disabled={isTestingAgent}
                  className="px-3.5 py-2 rounded-xl border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 font-semibold text-xs shrink-0 disabled:opacity-50"
                >
                  {isTestingAgent ? 'Đang thử...' : 'Kiểm tra'}
                </button>
              </div>
              {agentTestResult && (
                <div
                  className={`p-2.5 rounded-lg text-xs border ${
                    agentTestResult.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                  }`}
                >
                  <strong>{agentTestResult.title}:</strong> {agentTestResult.message}
                </div>
              )}
              <a
                href="https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-purple-700 hover:underline font-medium"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Hướng dẫn lấy API Key tại Google Cloud Agent Platform
              </a>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50/70 flex flex-col gap-2 shrink-0">
          <Button onClick={handleSave} className="w-full py-2.5" icon={<Key className="w-4 h-4" />}>
            Lưu & Áp dụng
          </Button>
          <div className="flex items-center justify-center gap-4">
            {isDismissible && (
              <button
                type="button"
                onClick={onClose}
                className="text-xs text-slate-500 hover:text-slate-800 py-1 font-medium"
              >
                Đóng
              </button>
            )}
            {!isDismissible && onUseOfflineMix && (
              <button
                type="button"
                onClick={onUseOfflineMix}
                className="text-xs font-semibold text-orange-700 hover:text-orange-900 py-1"
              >
                Chỉ trộn đề Word (không cần API key)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;
