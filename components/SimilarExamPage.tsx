import React, { useState } from 'react';
import { Copy, RotateCcw, FileSpreadsheet, CheckCircle, Download, FileText, Sliders, Image, List, BrainCircuit, BookOpen } from 'lucide-react';
import FileUploadZone from './FileUploadZone';
import MarkdownRenderer from './MarkdownRenderer';
import { generateSimilarExam } from '../services/similarExamService';
import { exportToDoc } from '../services/exportUtils';
import { SimilarExamResult, SimilarExamFileData, DiagramMode, SolutionMode } from '../types';
import { getSelectedModel } from '../services/geminiService';

interface SimilarExamPageProps {
  checkAuth: () => boolean;
}

const SimilarExamPage: React.FC<SimilarExamPageProps> = ({ checkAuth }) => {
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'success' | 'error'>('idle');
  const [result, setResult] = useState<SimilarExamResult | null>(null);
  const [activeTab, setActiveTab] = useState<'analysis' | 'examContent' | 'detailedSolution'>('analysis');
  const [fileData, setFileData] = useState<SimilarExamFileData | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Options
  const [diagramMode, setDiagramMode] = useState<DiagramMode>('standard');
  const [solutionMode, setSolutionMode] = useState<SolutionMode>('detailed');

  const handleFileSelect = (data: { base64: string; mimeType: string; name: string }) => {
    setFileData(data);
  };

  const handleGenerate = async () => {
    if (!fileData || isGenerating) return;
    if (!checkAuth()) return;

    setStatus('analyzing');
    setIsGenerating(true);
    setErrorDetail('');

    try {
      const generatedContent = await generateSimilarExam(
        fileData.base64,
        fileData.mimeType,
        { diagramMode, solutionMode },
        getSelectedModel()
      );
      setResult(generatedContent);
      setStatus('success');
    } catch (error: any) {
      console.error(error);
      setStatus('error');
      setErrorDetail(error.message || JSON.stringify(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const resetApp = () => {
    setStatus('idle');
    setResult(null);
    setFileData(null);
    setActiveTab('analysis');
    setErrorDetail('');
  };

  const handleExportWord = async () => {
    const content = activeTab === 'analysis' ? result?.analysis :
      activeTab === 'examContent' ? result?.examContent : result?.detailedSolution;
    if (!content) return;

    const tabLabel = activeTab === 'analysis' ? 'PhanTich' :
      activeTab === 'examContent' ? 'DeThi' : 'LoiGiai';
    const baseName = fileData?.name?.replace(/\.[^/.]+$/, '') || 'export';
    await exportToDoc(content, `${tabLabel}_${baseName}`);
  };

  const handleCopy = () => {
    const text = activeTab === 'analysis' ? result?.analysis :
      activeTab === 'examContent' ? result?.examContent : result?.detailedSolution;
    if (text) navigator.clipboard.writeText(text);
  };

  // ===== IDLE / ANALYZING =====
  if (status === 'idle' || status === 'analyzing') {
    return (
      <div className="max-w-3xl mx-auto space-y-8 pb-12 animate-fade-in-up">
        {/* Hero */}
        <div className="text-center space-y-4">
          <h2 className="text-3xl font-extrabold text-teal-900 tracking-tight">
            Biến một đề thi thành <span className="text-blue-600">vô hạn</span>
          </h2>
          <p className="text-base text-slate-600 max-w-xl mx-auto leading-relaxed">
            Tải lên đề thi mẫu (PDF/Ảnh). AI sẽ phân tích cấu trúc, độ khó và sinh ra đề tương tự chỉ trong giây lát.
          </p>
        </div>

        {/* Config */}
        <div className="card-elevated p-6">
          <div className="flex items-center gap-2 mb-4 text-teal-800 font-semibold">
            <Sliders className="w-4 h-4 text-teal-600" />
            <h3>Cấu hình sinh đề</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <Image className="w-4 h-4 text-slate-400" /> Chất lượng hình vẽ
              </label>
              <select
                value={diagramMode}
                onChange={(e) => setDiagramMode(e.target.value as DiagramMode)}
                className="w-full p-2.5 input-elevated text-sm"
              >
                <option value="standard">Tiêu chuẩn (Ưu tiên tốc độ)</option>
                <option value="detailed">Cao cấp (Chi tiết & Chính xác)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                <List className="w-4 h-4 text-slate-400" /> Chi tiết lời giải
              </label>
              <select
                value={solutionMode}
                onChange={(e) => setSolutionMode(e.target.value as SolutionMode)}
                className="w-full p-2.5 input-elevated text-sm"
              >
                <option value="concise">Ngắn gọn (Chỉ đáp án)</option>
                <option value="detailed">Tiêu chuẩn (Giải chi tiết)</option>
                <option value="very_detailed">Chuyên sâu (Giải thích & Mẹo)</option>
              </select>
            </div>
          </div>
        </div>

        {/* File Upload */}
        <div className="card-elevated p-6">
          <FileUploadZone
            onFileSelect={handleFileSelect}
            selectedFileName={fileData?.name}
            onClear={() => setFileData(null)}
            isLoading={status === 'analyzing'}
            label="Kéo thả đề thi mẫu vào đây"
            sublabel="Hỗ trợ PDF, JPG, PNG"
          />
        </div>

        {/* Generate Button */}
        <div className="flex flex-col items-center gap-4">
          {fileData && (
            <div className="flex items-center gap-2 px-4 py-2 bg-teal-50 text-teal-700 rounded-full text-sm font-medium">
              <CheckCircle className="w-4 h-4" />
              <span>Đã chọn: {fileData.name}</span>
            </div>
          )}
          <button
            onClick={handleGenerate}
            disabled={!fileData || status === 'analyzing'}
            className={`group relative px-8 py-4 text-white font-bold text-lg rounded-2xl shadow-lg transition-all duration-300
              ${!fileData || status === 'analyzing'
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:-translate-y-1 hover:shadow-teal-500/30 active:scale-95'
              }`}
          >
            <span className="flex items-center gap-3">
              <BrainCircuit className={`w-6 h-6 ${status === 'analyzing' ? 'animate-spin' : ''}`} />
              {status === 'analyzing' ? "ĐANG PHÂN TÍCH..." : "TẠO ĐỀ TƯƠNG TỰ"}
            </span>
          </button>
        </div>

        {/* Loading indicator */}
        {status === 'analyzing' && (
          <div className="max-w-lg mx-auto p-4 bg-teal-50 rounded-xl border border-teal-100">
            <div className="flex items-center justify-center gap-3">
              <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-teal-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="text-center text-sm font-medium text-teal-700 mt-2">
              Đang đọc và phân tích đề mẫu: "{fileData?.name}"
            </p>
          </div>
        )}

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
          {[
            { icon: FileSpreadsheet, title: "Phân tích Ma trận", desc: "Tự động nhận diện mức độ nhận biết, thông hiểu, vận dụng." },
            { icon: Copy, title: "Sinh đề tương tự", desc: "Tạo 1 đề mới giữ nguyên cấu trúc nhưng thay đổi số liệu." },
            { icon: CheckCircle, title: "Đáp án chi tiết", desc: "Kèm lời giải chi tiết và bảng đáp án nhanh." },
          ].map((f, i) => (
            <div key={i} className="card-elevated p-5">
              <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center text-teal-600 mb-3">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-teal-800 mb-1">{f.title}</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ===== ERROR =====
  if (status === 'error') {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-600 mb-6">
          <RotateCcw className="w-8 h-8" />
        </div>
        <h3 className="text-2xl font-bold text-slate-900 mb-2">Đã xảy ra lỗi</h3>
        <p className="text-red-600 font-medium mb-4 px-4 break-words">
          {errorDetail || "Không thể xử lý đề thi. Vui lòng thử lại."}
        </p>
        <button
          onClick={resetApp}
          className="px-6 py-3 bg-teal-700 text-white font-medium rounded-xl hover:bg-teal-800 transition-colors shadow-lg"
        >
          Thử lại
        </button>
      </div>
    );
  }

  // ===== SUCCESS — Results =====
  return (
    <div className="flex flex-col lg:flex-row gap-6 animate-fade-in-up h-full">
      {/* Sidebar */}
      <div className="lg:w-56 shrink-0">
        <div className="sticky top-24 space-y-4">
          <div className="card-elevated p-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">File gốc</p>
            <p className="text-sm font-medium text-teal-800 truncate">{fileData?.name}</p>
          </div>

          <nav className="flex flex-col gap-1">
            {[
              { id: 'analysis' as const, label: 'Phân tích Ma trận', icon: FileSpreadsheet },
              { id: 'examContent' as const, label: 'Đề thi (Bước 1)', icon: BookOpen },
              { id: 'detailedSolution' as const, label: 'Lời giải (Bước 2)', icon: List },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${activeTab === tab.id
                    ? 'badge-section text-white shadow-md'
                    : 'text-slate-600 hover:bg-teal-50'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Quick Re-generate */}
          <div className="card-elevated p-4 space-y-3">
            <div className="flex items-center gap-2 text-teal-800 font-semibold pb-2 border-b border-teal-100">
              <Sliders className="w-4 h-4 text-teal-600" />
              <h3 className="text-xs">Sinh lại</h3>
            </div>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`w-full py-2 badge-section text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center justify-center gap-2 ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Tạo đề mới
            </button>
            <button
              onClick={resetApp}
              className="w-full py-2 text-slate-500 text-xs hover:text-teal-700 transition-colors"
            >
              Đổi file khác
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="card-elevated p-6 md:p-8 min-h-[500px] relative">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500 rounded-t-xl opacity-80" />

          {/* Toolbar */}
          <div className="mb-6 pb-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4">
            <h2 className="text-xl font-bold text-teal-900">
              {activeTab === 'analysis' && 'Phân tích Đề thi'}
              {activeTab === 'examContent' && 'NỘI DUNG ĐỀ THI'}
              {activeTab === 'detailedSolution' && 'HƯỚNG DẪN GIẢI CHI TIẾT'}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportWord}
                className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                Word
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
            </div>
          </div>

          {/* Content */}
          <div>
            {activeTab === 'analysis' && result && <MarkdownRenderer content={result.analysis} />}
            {activeTab === 'examContent' && result && <MarkdownRenderer content={result.examContent} />}
            {activeTab === 'detailedSolution' && result && <MarkdownRenderer content={result.detailedSolution} />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SimilarExamPage;
