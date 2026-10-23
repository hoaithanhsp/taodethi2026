
import React, { useState, useRef, useEffect } from 'react';
import { AppStep, AppMode, InputData, GenerationState, Lesson, Chapter, QuestionConfig, ExtractedQuestion, MatrixTemplate, ExamHistoryItem, ReferenceUsageMode, ReferenceDocItem, DungSaiLevel, DEFAULT_DUNG_SAI_LEVELS, getDungSaiQuestionCount, getDungSaiLevelConfigs } from './types';
import StepIndicator from './components/StepIndicator';
import Button from './components/Button';
import MarkdownView from './components/MarkdownView';
import BbtQuickGenerator from './components/BbtQuickGenerator';
import SimilarExamPage from './components/SimilarExamPage';
import VariantsExamPage from './components/VariantsExamPage';

import { generateStep1Matrix, generateStep2Specs, generateStep3Exam, extractInfoFromDocument, convertMatrixFileToHtml, convertMatrixTextToHtml, extractQuestionsFromReference, getApiKey, isValidApiKey, setApiKey as saveApiKey, getSelectedModel, setSelectedModel, getAiProvider, setAiProvider, getFallbackNotice, setFallbackNotice, subscribeFallbackNotice } from './services/geminiService';
import { parseDocxWithMath, extractQuestionsLocally, extractDocxTablesAndHtml, parseMatrixMetadataAndConfig } from './services/docxMathParser';
import { normalizeMathForWord, renderMarkdownPreservingMath } from './services/mathExportUtils';
import { extractFiguresToPlaceholders, restoreFiguresAsPngForWord } from './services/figureEngine';
// @ts-ignore
import { asBlob } from 'html-docx-js-typescript';
import MarkdownIt from 'markdown-it';
import { GEMINI_MODELS, AGENT_PLATFORM_MODELS, DEFAULT_GEMINI_MODEL, DEFAULT_AGENT_PLATFORM_MODEL, AiProvider } from './constants';
import { MATRIX_TEMPLATES } from './services/matrixTemplates';
import { validateAccount, Account } from './data/accounts';
import { ArrowRight, ArrowLeft, RotateCcw, FileText, Download, AlertCircle, Upload, Clock, Check, ChevronDown, ChevronRight, Filter, FileUp, Settings, Key, ExternalLink, Sun, Moon, X, Paperclip, Trash2, BookOpen, LogIn, Lock, User, Gift, Phone, Shield, Copy, Shuffle, Sparkles, Layers, Zap, History, Save, Eye } from 'lucide-react';

const mdParser = new MarkdownIt({
  html: true,
  breaks: true, // Chuyển đổi ký tự xuống dòng thành thẻ <br>
  linkify: true
});

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.INPUT);
  const [completedSteps, setCompletedSteps] = useState<number>(0);

  // -- App Mode State --
  const [appMode, setAppMode] = useState<AppMode>(() => {
    return (localStorage.getItem('examcraft_app_mode') as AppMode) || 'home';
  });

  useEffect(() => {
    localStorage.setItem('examcraft_app_mode', appMode);
  }, [appMode]);

  // -- Data State --
  const [inputData, setInputData] = useState<InputData>({
    subject: '',
    grade: '',
    duration: 45,
    examType: 'Giữa kỳ 1',
    topics: '',
    additionalNotes: '',
    chapters: [],
    questionConfig: {
      type1: { biet: 8, hieu: 4, van_dung: 0, van_dung_cao: 0 },
      type2: { biet: 1, hieu: 1, van_dung: 0, van_dung_cao: 0 },
      type2QuestionCount: 2,
      dungSaiLevelConfigs: [{ ...DEFAULT_DUNG_SAI_LEVELS }, { ...DEFAULT_DUNG_SAI_LEVELS }],
      type3: { biet: 1, hieu: 1, van_dung: 2, van_dung_cao: 0 },
      essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
    }
  });

  // -- Dark Mode State --
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('examcraft_dark_mode') === 'true';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('examcraft_dark_mode', String(darkMode));
  }, [darkMode]);

  // -- Auth State --
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('examcraft_auth') === 'true';
  });
  const [trialUsed, setTrialUsed] = useState<boolean>(() => {
    return localStorage.getItem('examcraft_trial_used') === 'true';
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggedInUser, setLoggedInUser] = useState<Account | null>(() => {
    const saved = localStorage.getItem('examcraft_user');
    return saved ? JSON.parse(saved) : null;
  });

  // -- Provider & Selected Model State --
  const [provider, setProviderState] = useState<AiProvider>(getAiProvider());
  const [selectedModel, setSelectedModelState] = useState(() => {
    const currentProvider = getAiProvider();
    const saved = getSelectedModel();
    const validList = currentProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS;
    const defaultId = currentProvider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
    if (saved && validList.some(m => m.id === saved)) {
      return saved;
    }
    return defaultId;
  });
  const [fallbackNotice, setFallbackNoticeState] = useState<string | null>(getFallbackNotice());

  useEffect(() => {
    return subscribeFallbackNotice((msg) => {
      setFallbackNoticeState(msg);
    });
  }, []);

  // -- UI State --
  const [selectedLessonIds, setSelectedLessonIds] = useState<Set<string>>(new Set());
  const [expandedChapterIds, setExpandedChapterIds] = useState<Set<string>>(new Set());

  const [genState, setGenState] = useState<GenerationState>({
    matrix: '',
    specs: '',
    exam: '',
    isLoading: false,
    error: null
  });

  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isCustomSubject, setIsCustomSubject] = useState(false);
  const [matrixTemplate, setMatrixTemplate] = useState<MatrixTemplate>('template1');
  const [isUploadedMatrix, setIsUploadedMatrix] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const matrixUploadRef = useRef<HTMLInputElement>(null); // Ref for Step 2 upload
  const matrixDirectUploadRef = useRef<HTMLInputElement>(null); // Ref for Step 1 direct upload
  const referenceUploadRef = useRef<HTMLInputElement>(null); // Ref for reference doc upload
  const comboMatrixUploadRef = useRef<HTMLInputElement>(null); // Ref for combo shortcut - matrix
  const comboSpecsUploadRef = useRef<HTMLInputElement>(null); // Ref for combo shortcut - specs

  // -- Combo Shortcut State --
  const [comboMatrixFile, setComboMatrixFile] = useState<File | null>(null);
  const [comboSpecsFile, setComboSpecsFile] = useState<File | null>(null);
  const [isComboProcessing, setIsComboProcessing] = useState(false);

  // -- Reference Document State (Hỗ trợ nhiều file + 2 chế độ sử dụng) --
  const [referenceDocs, setReferenceDocs] = useState<ReferenceDocItem[]>([]);
  const [referenceMode, setReferenceMode] = useState<ReferenceUsageMode>('exact');
  const [isDraggingReference, setIsDraggingReference] = useState(false);
  const [isParsingReference, setIsParsingReference] = useState(false);
  const [extractedQuestions, setExtractedQuestions] = useState<ExtractedQuestion[]>([]);
  const [isExtractingQuestions, setIsExtractingQuestions] = useState(false);

  const getCombinedReferenceData = (docs: ReferenceDocItem[] = referenceDocs) => {
    const text = docs
      .filter(d => d.text && d.text.trim())
      .map(d => `=== TÀI LIỆU: ${d.fileName} ===\n${d.text}`)
      .join('\n\n');
    const images = docs.flatMap(d => d.images);
    return { text, images };
  };

  // -- API Key State --
  const [apiKey, setApiKeyState] = useState<string>(getApiKey(getAiProvider()) || '');
  const [apiKeyError, setApiKeyError] = useState<string>('');
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(!getApiKey(getAiProvider()));
  const [tempGeminiKey, setTempGeminiKey] = useState<string>(getApiKey('gemini') || '');
  const [tempAgentPlatformKey, setTempAgentPlatformKey] = useState<string>(getApiKey('agent-platform') || '');

  // -- Exam Creation History State (Max 5 recent items) --
  const HISTORY_STORAGE_KEY = 'examcraft_creation_history';
  const [examHistory, setExamHistory] = useState<ExamHistoryItem[]>(() => {
    try {
      const raw = localStorage.getItem('examcraft_creation_history');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);
  const [isCurrentExamSaved, setIsCurrentExamSaved] = useState<boolean>(false);

  const persistExamHistory = (items: ExamHistoryItem[]) => {
    const limited = items.slice(0, 5);
    setExamHistory(limited);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(limited));
    } catch (e) {
      console.warn('[ExamCraft] Không thể lưu lịch sử vào localStorage:', e);
    }
  };

  // --- Auth Handlers ---
  const handleLogin = () => {
    const account = validateAccount(loginUsername, loginPassword);
    if (account) {
      setIsAuthenticated(true);
      setLoggedInUser(account);
      setShowLoginModal(false);
      setLoginError('');
      setLoginUsername('');
      setLoginPassword('');
      localStorage.setItem('examcraft_auth', 'true');
      localStorage.setItem('examcraft_user', JSON.stringify(account));
    } else {
      setLoginError('Sai tên đăng nhập hoặc mật khẩu!');
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setLoggedInUser(null);
    localStorage.removeItem('examcraft_auth');
    localStorage.removeItem('examcraft_user');
  };

  /**
   * Kiểm tra quyền sử dụng: đã đăng nhập HOẶC chưa hết lượt thử
   * Trả về true nếu được phép, false nếu cần đăng nhập
   */
  const checkAuthOrTrial = (): boolean => {
    if (isAuthenticated) return true;
    if (!trialUsed) {
      // Đánh dấu đã dùng lượt thử
      setTrialUsed(true);
      localStorage.setItem('examcraft_trial_used', 'true');
      return true;
    }
    // Hết lượt → hiện popup đăng nhập
    setShowLoginModal(true);
    return false;
  };

  // --- API Key Handlers ---
  const handleSaveApiKey = () => {
    const geminiKeyClean = tempGeminiKey.trim();
    const agentPlatformKeyClean = tempAgentPlatformKey.trim();

    const activeKey = provider === 'agent-platform' ? agentPlatformKeyClean : geminiKeyClean;
    if (!activeKey) {
      setApiKeyError(`Vui lòng nhập API Key cho ${provider === 'agent-platform' ? 'Agent Platform' : 'Google Gemini'}`);
      return;
    }

    if (!isValidApiKey(activeKey)) {
      setApiKeyError('API Key không hợp lệ. Vui lòng nhập key bắt đầu bằng AIzaSy... hoặc AQ...');
      return;
    }

    const validModels = provider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS;
    const defaultModel = provider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
    const normalizedModel = validModels.some(m => m.id === selectedModel) ? selectedModel : defaultModel;

    setAiProvider(provider);
    setSelectedModelState(normalizedModel);
    setSelectedModel(normalizedModel);
    if (geminiKeyClean) saveApiKey(geminiKeyClean, 'gemini');
    if (agentPlatformKeyClean) saveApiKey(agentPlatformKeyClean, 'agent-platform');

    setApiKeyState(activeKey);
    setShowApiKeyModal(false);
    setApiKeyError('');
  };

  // --- Handlers ---

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;

    if (name === 'examType') {
      let newDuration = 45;
      if (value.includes('15 phút')) newDuration = 15;
      else if (value.includes('45 phút')) newDuration = 45;
      else if (value.includes('Giữa') || value.includes('Cuối')) newDuration = 90; // Standard for semesters

      setInputData(prev => ({ ...prev, [name]: value, duration: newDuration }));

      // Auto-filter topics when exam type changes
      if (inputData.chapters.length > 0) {
        applySmartFilter(value, inputData.chapters);
      }

    } else {
      setInputData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzingFile(true);
    setUploadedFileName(file.name);
    setGenState(prev => ({ ...prev, error: null }));

    try {
      const extracted = await extractInfoFromDocument(file, inputData.subject, inputData.grade);

      if (!extracted || !extracted.chapters || extracted.chapters.length === 0) {
        throw new Error("AI không tìm thấy thông tin bài học/chủ đề nào trong file này. Hãy đảm bảo file là kế hoạch dạy học (PPCT) hợp lệ.");
      }

      // Fix 3: Validation — cảnh báo nếu AI trả về môn khác với môn đã chọn
      if (inputData.subject && extracted.subject && extracted.subject !== inputData.subject) {
        const aiSubject = extracted.subject;
        const userSubject = inputData.subject;
        // Kiểm tra không phải chỉ khác cách viết (ví dụ: "Công nghệ" vs "Công Nghệ")
        if (aiSubject.toLowerCase().trim() !== userSubject.toLowerCase().trim()) {
          alert(`⚠️ CẢNH BÁO: Bạn đã chọn môn "${userSubject}" nhưng AI phát hiện file này có nội dung môn "${aiSubject}".\n\nVui lòng kiểm tra lại file PPCT đã upload có đúng môn "${userSubject}" không.`);
        }
      }

      setInputData(prev => ({
        ...prev,
        subject: prev.subject || extracted.subject || '',
        grade: prev.grade || extracted.grade || '',
        topics: extracted.topics || prev.topics, // Fallback
        chapters: extracted.chapters || [],
      }));

      // Initialize selection: Expand all chapters, Apply filter
      if (extracted.chapters && extracted.chapters.length > 0) {
        const allChapIds = new Set(extracted.chapters.map(c => c.id));
        setExpandedChapterIds(allChapIds);
        applySmartFilter(inputData.examType, extracted.chapters);
      }

    } catch (err: any) {
      setGenState(prev => ({ ...prev, error: `Lỗi đọc file: ${err.message}` }));
      setUploadedFileName(null);
    } finally {
      setIsAnalyzingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Helper: detect if HTML content mentions essay/tự luận columns
  const detectEssayInHtml = (html: string): boolean => {
    const lowerHtml = html.toLowerCase();
    // Nếu có khẳng định rõ ràng là không có tự luận hoặc tự luận = 0 câu thì coi như KHÔNG có
    if (
      lowerHtml.includes('không có tự luận') ||
      lowerHtml.includes('không tự luận') ||
      lowerHtml.includes('khong co tu luan') ||
      lowerHtml.includes('tự luận: 0') ||
      lowerHtml.includes('tự luận 0') ||
      lowerHtml.includes('tự luận (0') ||
      lowerHtml.includes('cột tự luận: 0') ||
      lowerHtml.includes('tự luận | 0') ||
      lowerHtml.includes('tự luận: 0.0') ||
      lowerHtml.includes('tuyệt đối không tạo cột tự luận')
    ) {
      return false;
    }
    // Check for explicit essay column headers in the matrix/specs table
    // Mở rộng từ khóa để nhận diện chính xác hơn khi user upload file Ma trận/Đặc tả
    return (
      lowerHtml.includes('tự luận') ||
      lowerHtml.includes('tu luan') ||
      lowerHtml.includes('essay') ||
      lowerHtml.includes('phần iv') ||
      lowerHtml.includes('phan iv') ||
      lowerHtml.includes('phần 4') ||
      /phần\s+iv/i.test(html) ||
      />\s*iv\s*</i.test(html) ||
      /part\s+iv/i.test(html) ||
      lowerHtml.includes('câu tự luận') ||
      lowerHtml.includes('dạng iv') ||
      lowerHtml.includes('(iv)') ||
      lowerHtml.includes('mục iv')
    );
  };

  // Auto-sync questionConfig.essay based on matrix HTML content
  const syncEssayConfigFromMatrix = (matrixHtml: string) => {
    const hasEssay = detectEssayInHtml(matrixHtml);
    if (!hasEssay) {
      console.log('[ExamCraft] Ma trận KHÔNG có tự luận → reset essay config = 0');
      setInputData(prev => ({
        ...prev,
        questionConfig: {
          ...prev.questionConfig,
          essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
        }
      }));
    } else {
      console.log('[ExamCraft] Ma trận CÓ tự luận → kiểm tra và set essay config nếu đang = 0');
      setInputData(prev => {
        const currentEssay = prev.questionConfig.essay;
        const totalEssay = currentEssay.biet + currentEssay.hieu + currentEssay.van_dung + currentEssay.van_dung_cao;
        if (totalEssay === 0) {
          console.log('[ExamCraft] Essay config đang = 0 nhưng Ma trận CÓ tự luận → auto-set default essay config');
          return {
            ...prev,
            questionConfig: {
              ...prev.questionConfig,
              essay: { biet: 0, hieu: 1, van_dung: 1, van_dung_cao: 0 },
            }
          };
        }
        return prev;
      });
    }
  };

  // Đồng bộ toàn diện thông tin Môn, Lớp, Kỳ kiểm tra, Thời gian, Chủ đề và Số câu hỏi từ Ma trận/Đặc tả tải lên
  const syncConfigFromUploadedMatrix = (htmlContent: string) => {
    const meta = parseMatrixMetadataAndConfig(htmlContent);
    const hasEssay = detectEssayInHtml(htmlContent);
    console.log('[MatrixUpload] Parsed metadata & questionConfig from uploaded table:', meta, 'hasEssay=', hasEssay);

    setInputData(prev => {
      let nextQuestionConfig = meta.questionConfig
        ? { ...meta.questionConfig }
        : { ...prev.questionConfig };

      if (!hasEssay) {
        nextQuestionConfig = {
          ...nextQuestionConfig,
          essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
        };
      } else {
        const essaySum =
          nextQuestionConfig.essay.biet +
          nextQuestionConfig.essay.hieu +
          nextQuestionConfig.essay.van_dung +
          nextQuestionConfig.essay.van_dung_cao;
        if (essaySum === 0) {
          nextQuestionConfig = {
            ...nextQuestionConfig,
            essay: { biet: 0, hieu: 1, van_dung: 1, van_dung_cao: 0 },
          };
        }
      }

      return {
        ...prev,
        subject: meta.subject || prev.subject || 'Toán học',
        grade: meta.grade || prev.grade || '12',
        examType: meta.examType || prev.examType,
        duration: meta.duration || prev.duration,
        topics: meta.topicsSummary || prev.topics,
        questionConfig: nextQuestionConfig,
      };
    });
  };

  // Common logic for processing uploaded matrix file
  const processMatrixUpload = async (file: File) => {
    setGenState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      let content = "";
      let extractedSpecsFromSameFile: string | null = null;
      const lowerName = file.name.toLowerCase();

      // If HTML or Text, read directly
      if (file.type === "text/html" || file.type === "text/plain" || lowerName.endsWith(".html") || lowerName.endsWith(".txt")) {
        content = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsText(file);
        });
      }
      // If DOCX/DOC, extract HTML table directly via JSZip XML parser (100% exact, < 20ms, no AI distortion)
      else if (lowerName.endsWith(".docx") || lowerName.endsWith(".doc")) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const directTable = await extractDocxTablesAndHtml(arrayBuffer);
          if (directTable.hasTable && directTable.matrixHtml) {
            content = directTable.matrixHtml;
            extractedSpecsFromSameFile = directTable.specsHtml;
            console.log(`[MatrixUpload] Direct DOCX table extracted 100% verbatim (${content.length} chars, hasSpecs=${!!extractedSpecsFromSameFile})`);
          } else {
            const parsed = await parseDocxWithMath(arrayBuffer);
            console.log(`[MatrixUpload] DOCX parsed (no XML table found): ${parsed.text.length} chars, ${parsed.images.length} images, method=${parsed.method}`);
            content = await convertMatrixTextToHtml(parsed.text, parsed.images);
          }
        } catch (docxErr: any) {
          console.warn('[MatrixUpload] DOCX parse failed, trying direct AI:', docxErr);
          content = await convertMatrixFileToHtml(file);
        }
      }
      // If PDF, convert using AI directly (Gemini supports PDF)
      else {
        content = await convertMatrixFileToHtml(file);
      }

      // Auto-detect & sync subject, grade, examType, duration, topics & exact questionConfig from the uploaded matrix
      syncConfigFromUploadedMatrix(content);
      setIsUploadedMatrix(true);

      setGenState(prev => ({
        ...prev,
        matrix: content,
        specs: extractedSpecsFromSameFile || prev.specs,
        isLoading: false,
      }));
      return true;
    } catch (err: any) {
      setGenState(prev => ({ ...prev, isLoading: false, error: err.message }));
      return false;
    }
  };

  const handleMatrixUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await processMatrixUpload(file);
    if (matrixUploadRef.current) matrixUploadRef.current.value = '';
  };

  const handleMatrixSkipUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const success = await processMatrixUpload(file);
    if (success) {
      // Skip to Matrix Step (Step 2) immediately
      setCurrentStep(AppStep.MATRIX);
      setCompletedSteps(Math.max(completedSteps, 1));
    }

    if (matrixDirectUploadRef.current) matrixDirectUploadRef.current.value = '';
  };

  // -- Combo Shortcut: Upload cả Ma trận + Đặc tả → Nhảy thẳng sang tạo đề --
  const handleComboMatrixSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setComboMatrixFile(file);
    if (comboMatrixUploadRef.current) comboMatrixUploadRef.current.value = '';
  };

  const handleComboSpecsSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setComboSpecsFile(file);
    if (comboSpecsUploadRef.current) comboSpecsUploadRef.current.value = '';
  };

  const processComboShortcut = async () => {
    if (!comboMatrixFile || !comboSpecsFile) {
      alert('Vui lòng chọn cả 2 file: Ma trận VÀ Đặc tả.');
      return;
    }

    setIsComboProcessing(true);
    setGenState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Step 1: Process Matrix file
      const matrixSuccess = await processMatrixUpload(comboMatrixFile);
      if (!matrixSuccess) throw new Error('Không thể xử lý file Ma trận.');

      // Step 2: Process Specs file (direct XML table extraction for .docx/.doc)
      let specsContent = '';
      const specsFile = comboSpecsFile;
      const lowerSpecsName = specsFile.name.toLowerCase();

      if (specsFile.type === 'text/html' || specsFile.type === 'text/plain' || lowerSpecsName.endsWith('.html') || lowerSpecsName.endsWith('.txt')) {
        specsContent = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsText(specsFile);
        });
      } else if (lowerSpecsName.endsWith('.docx') || lowerSpecsName.endsWith('.doc')) {
        try {
          const arrayBuffer = await specsFile.arrayBuffer();
          const directTable = await extractDocxTablesAndHtml(arrayBuffer);
          if (directTable.hasTable) {
            specsContent = directTable.specsHtml || directTable.fullHtml;
            console.log(`[ComboSpecsUpload] Direct DOCX specs table extracted 100% verbatim (${specsContent.length} chars)`);
          } else {
            const parsed = await parseDocxWithMath(arrayBuffer);
            specsContent = await convertMatrixTextToHtml(parsed.text, parsed.images);
          }
        } catch {
          specsContent = await convertMatrixFileToHtml(specsFile);
        }
      } else {
        specsContent = await convertMatrixFileToHtml(specsFile);
      }

      // Sync metadata/questionConfig from specs as well if matrix didn't have all fields
      syncConfigFromUploadedMatrix(specsContent);
      setIsUploadedMatrix(true);

      setGenState(prev => ({ ...prev, specs: specsContent, isLoading: false }));

      // Jump to SPECS step → user clicks "Tạo đề" from there
      setCurrentStep(AppStep.SPECS);
      setCompletedSteps(Math.max(completedSteps, 2));

      // Clear combo state
      setComboMatrixFile(null);
      setComboSpecsFile(null);
    } catch (err: any) {
      setGenState(prev => ({ ...prev, isLoading: false, error: err.message }));
    } finally {
      setIsComboProcessing(false);
    }
  };

  // -- Topic Selection Logic --

  const applySmartFilter = (type: string, chapters: Chapter[]) => {
    const newSelection = new Set<string>();

    chapters.forEach(chap => {
      chap.lessons.forEach(lesson => {
        const end = lesson.weekEnd || 99; // Default to late if unknown
        const start = lesson.weekStart || 0;
        let shouldSelect = false;

        if (type.includes('Giữa kỳ 1')) shouldSelect = end <= 10;
        else if (type.includes('Cuối kỳ 1')) shouldSelect = end <= 18;
        else if (type.includes('Giữa kỳ 2')) shouldSelect = start >= 19 && end <= 27;
        else if (type.includes('Cuối kỳ 2')) shouldSelect = start >= 19; // Chỉ HK2 (tuần 19+)
        else shouldSelect = true; // 15 mins etc (User manual select)

        if (shouldSelect) newSelection.add(lesson.id);
      });
    });
    setSelectedLessonIds(newSelection);
  };

  const toggleChapter = (chapId: string, select: boolean) => {
    const chapter = inputData.chapters.find(c => c.id === chapId);
    if (!chapter) return;

    const newSet = new Set(selectedLessonIds);
    chapter.lessons.forEach(l => {
      if (select) newSet.add(l.id);
      else newSet.delete(l.id);
    });
    setSelectedLessonIds(newSet);
  };

  const toggleLesson = (lessonId: string) => {
    const newSet = new Set(selectedLessonIds);
    if (newSet.has(lessonId)) newSet.delete(lessonId);
    else newSet.add(lessonId);
    setSelectedLessonIds(newSet);
  };

  const toggleExpandChapter = (chapId: string) => {
    const newSet = new Set(expandedChapterIds);
    if (newSet.has(chapId)) newSet.delete(chapId);
    else newSet.add(chapId);
    setExpandedChapterIds(newSet);
  };

  // -- Question Config Logic --
  const updateQuestionConfig = (type: 'type1' | 'type2' | 'type3' | 'essay', level: 'biet' | 'hieu' | 'van_dung' | 'van_dung_cao', value: number) => {
    setInputData(prev => ({
      ...prev,
      questionConfig: {
        ...prev.questionConfig,
        [type]: {
          ...prev.questionConfig[type],
          [level]: Math.max(0, isNaN(value) ? 0 : value)
        }
      }
    }));
  };

  // -- Generation Handlers --

  const handleGenerateMatrix = async () => {
    if (!checkAuthOrTrial()) return;

    if (selectedLessonIds.size === 0) {
      alert("Vui lòng chọn ít nhất 1 bài học/chủ đề!");
      return;
    }

    setGenState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      setIsUploadedMatrix(false);
      const matrix = await generateStep1Matrix(inputData, selectedLessonIds, matrixTemplate);
      // Tôn trọng cấu hình: nếu người dùng đã đặt tự luận = 0, không auto-set lên
      const userConfigTotalEssay = inputData.questionConfig.essay.biet + inputData.questionConfig.essay.hieu + inputData.questionConfig.essay.van_dung + inputData.questionConfig.essay.van_dung_cao;
      if (userConfigTotalEssay === 0) {
        setInputData(prev => ({
          ...prev,
          questionConfig: {
            ...prev.questionConfig,
            essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
          }
        }));
      }
      // Người dùng đã nhập số câu Tự luận > 0 ở bất kỳ cột nào → GIỮ NGUYÊN cấu hình,
      // không reset theo kết quả dò từ khóa trong HTML (nguyên nhân Tự luận "lúc có lúc không").
      setGenState(prev => ({ ...prev, matrix, isLoading: false }));
      setCurrentStep(AppStep.MATRIX);
      setCompletedSteps(Math.max(completedSteps, 1));
    } catch (err: any) {
      setGenState(prev => ({ ...prev, isLoading: false, error: err.message }));
    }
  };

  const handleGenerateSpecs = async () => {
    if (!checkAuthOrTrial()) return;
    setGenState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      // Đảm bảo thông tin môn/lớp/số câu đã đồng bộ từ Ma trận hiện tại (đặc biệt khi tải lên Ma trận)
      let effectiveData = inputData;
      if (isUploadedMatrix && genState.matrix) {
        const meta = parseMatrixMetadataAndConfig(genState.matrix);
        const hasEssay = detectEssayInHtml(genState.matrix);
        let qCfg = meta.questionConfig ? { ...meta.questionConfig } : { ...inputData.questionConfig };
        if (!hasEssay) {
          qCfg = { ...qCfg, essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 } };
        }
        effectiveData = {
          ...inputData,
          subject: inputData.subject || meta.subject || 'Toán học',
          grade: inputData.grade || meta.grade || '12',
          examType: meta.examType || inputData.examType,
          duration: meta.duration || inputData.duration,
          topics: meta.topicsSummary || inputData.topics,
          questionConfig: qCfg,
        };
        setInputData(effectiveData);
      }

      const specs = await generateStep2Specs(
        genState.matrix,
        effectiveData,
        selectedLessonIds,
        matrixTemplate,
        isUploadedMatrix
      );
      setGenState(prev => ({ ...prev, specs, isLoading: false }));
      setCurrentStep(AppStep.SPECS);
      setCompletedSteps(Math.max(completedSteps, 2));
    } catch (err: any) {
      setGenState(prev => ({ ...prev, isLoading: false, error: err.message }));
    }
  };

  const handleGenerateExam = async () => {
    if (!checkAuthOrTrial()) return;

    setGenState(prev => ({ ...prev, isLoading: true, error: null }));
    try {
      let effectiveData = inputData;
      if (isUploadedMatrix && (genState.matrix || genState.specs)) {
        const meta = parseMatrixMetadataAndConfig(genState.matrix || genState.specs);
        const hasEssay = detectEssayInHtml(genState.matrix || genState.specs);
        let qCfg = meta.questionConfig ? { ...meta.questionConfig } : { ...inputData.questionConfig };
        if (!hasEssay) {
          qCfg = { ...qCfg, essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 } };
        }
        effectiveData = {
          ...inputData,
          subject: inputData.subject || meta.subject || 'Toán học',
          grade: inputData.grade || meta.grade || '12',
          examType: meta.examType || inputData.examType,
          duration: meta.duration || inputData.duration,
          topics: meta.topicsSummary || inputData.topics,
          questionConfig: qCfg,
        };
        setInputData(effectiveData);
      }

      const finalQuestionConfig = { ...effectiveData.questionConfig };
      
      const userTotalEssay = 
        finalQuestionConfig.essay.biet + 
        finalQuestionConfig.essay.hieu + 
        finalQuestionConfig.essay.van_dung + 
        finalQuestionConfig.essay.van_dung_cao;

      if (userTotalEssay === 0) {
        finalQuestionConfig.essay = { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 };
      }

      // Instant local question extraction if not done yet (no double AI call!)
      const combinedRef = getCombinedReferenceData();
      let questionsToUse = extractedQuestions;
      if (referenceDocs.length > 0 && questionsToUse.length === 0 && combinedRef.text) {
        const localExtracted = extractQuestionsLocally(combinedRef.text);
        if (localExtracted.length > 0) {
          setExtractedQuestions(localExtracted);
          questionsToUse = localExtracted;
        }
      }

      const exam = await generateStep3Exam(
        genState.specs,
        finalQuestionConfig,
        effectiveData,
        combinedRef.text || undefined,
        combinedRef.images.length > 0 ? combinedRef.images : undefined,
        questionsToUse.length > 0 ? questionsToUse : undefined,
        referenceMode,
        genState.matrix || undefined,
        isUploadedMatrix
      );
      setGenState(prev => ({ ...prev, exam, isLoading: false }));
      setCurrentStep(AppStep.EXAM);
      setCompletedSteps(Math.max(completedSteps, 3));
      setIsCurrentExamSaved(false);
    } catch (err: any) {
      setGenState(prev => ({ ...prev, isLoading: false, error: err.message }));
    }
  };

  // -- History Handlers (Lưu 5 lịch sử gần nhất & Tái sử dụng Ma trận/Đặc tả để tạo đề thêm) --
  const buildHistoryTitle = (): string => {
    if (inputData.subject) {
      const gradeStr = inputData.grade ? ` - Lớp ${inputData.grade}` : '';
      const typeStr = inputData.examType ? ` • ${inputData.examType}` : '';
      const durStr = inputData.duration ? ` (${inputData.duration} phút)` : '';
      return `${inputData.subject}${gradeStr}${typeStr}${durStr}`;
    }
    const titleMatch = (genState.exam || genState.specs || genState.matrix).match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]?.trim()) {
      return titleMatch[1].trim();
    }
    return `Đề kiểm tra ${inputData.examType || ''} (${inputData.duration || 45} phút)`.trim();
  };

  const handleSaveHistory = () => {
    if (!genState.exam && !genState.specs) return;
    const createdAt = new Date().toLocaleString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const newItem: ExamHistoryItem = {
      id: `hist_${Date.now()}`,
      createdAt,
      title: buildHistoryTitle(),
      inputData: JSON.parse(JSON.stringify(inputData)),
      matrixTemplate,
      selectedLessonIds: Array.from(selectedLessonIds),
      matrix: genState.matrix,
      specs: genState.specs,
      exam: genState.exam,
    };
    const updated = [newItem, ...examHistory].slice(0, 5);
    persistExamHistory(updated);
    setIsCurrentExamSaved(true);
  };

  const handleGenerateExamFromHistory = async (item: ExamHistoryItem) => {
    if (!checkAuthOrTrial()) return;

    setShowHistoryModal(false);
    setAppMode('cv7991');
    setInputData(item.inputData);
    setMatrixTemplate(item.matrixTemplate || 'template1');
    setSelectedLessonIds(new Set(item.selectedLessonIds || []));
    setIsCurrentExamSaved(false);
    setCurrentStep(AppStep.EXAM);
    setCompletedSteps(3);
    setGenState({
      matrix: item.matrix,
      specs: item.specs,
      exam: item.exam,
      isLoading: true,
      error: null,
    });

    try {
      const finalQuestionConfig = { ...item.inputData.questionConfig };
      const userTotalEssay =
        finalQuestionConfig.essay.biet +
        finalQuestionConfig.essay.hieu +
        finalQuestionConfig.essay.van_dung +
        finalQuestionConfig.essay.van_dung_cao;

      if (userTotalEssay === 0) {
        finalQuestionConfig.essay = { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 };
      }

      const combinedRef = getCombinedReferenceData();
      const newExam = await generateStep3Exam(
        item.specs || item.matrix,
        finalQuestionConfig,
        item.inputData,
        combinedRef.text || undefined,
        combinedRef.images.length > 0 ? combinedRef.images : undefined,
        extractedQuestions.length > 0 ? extractedQuestions : undefined,
        referenceMode,
        item.matrix || undefined
      );

      setGenState({
        matrix: item.matrix,
        specs: item.specs,
        exam: newExam,
        isLoading: false,
        error: null,
      });
      setCurrentStep(AppStep.EXAM);
      setCompletedSteps(3);
      setIsCurrentExamSaved(false);
    } catch (err: any) {
      setGenState(prev => ({ ...prev, isLoading: false, error: err.message }));
    }
  };

  const handleRestoreHistory = (item: ExamHistoryItem) => {
    setShowHistoryModal(false);
    setAppMode('cv7991');
    setInputData(item.inputData);
    setMatrixTemplate(item.matrixTemplate || 'template1');
    setSelectedLessonIds(new Set(item.selectedLessonIds || []));
    setGenState({
      matrix: item.matrix,
      specs: item.specs,
      exam: item.exam,
      isLoading: false,
      error: null,
    });
    setCurrentStep(AppStep.EXAM);
    setCompletedSteps(3);
    setIsCurrentExamSaved(true);
  };

  const handleDeleteHistoryItem = (id: string) => {
    const updated = examHistory.filter(item => item.id !== id);
    persistExamHistory(updated);
  };

  // -- Reference Document Upload Handler (Multi-file + Drag & Drop) --
  const parseSingleReferenceFile = async (file: File): Promise<ReferenceDocItem> => {
    const lowerName = file.name.toLowerCase();
    const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
      const arrayBuffer = await file.arrayBuffer();
      const result = await parseDocxWithMath(arrayBuffer);
      return {
        id,
        fileName: file.name,
        text: result.text,
        images: result.images,
        method: result.method,
        wmfCount: result.wmfCount,
      };
    }

    if (lowerName.endsWith('.pdf') || file.type === 'application/pdf' || file.type.startsWith('image/')) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = reader.result as string;
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const mimeType = file.type || (lowerName.endsWith('.pdf') ? 'application/pdf' : 'image/png');
      return {
        id,
        fileName: file.name,
        text: `[Tài liệu PDF/Hình ảnh đính kèm: ${file.name}]`,
        images: [{ base64, mimeType }],
        method: 'pdf',
        wmfCount: 0,
      };
    }

    // Fallback for .txt / .html
    const textContent = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = reject;
      reader.readAsText(file);
    });
    return {
      id,
      fileName: file.name,
      text: textContent,
      images: [],
      method: 'text',
      wmfCount: 0,
    };
  };

  const processReferenceFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const t0 = performance.now();
    setIsParsingReference(true);
    setGenState(prev => ({ ...prev, error: null }));

    try {
      // 1. Parse all uploaded files concurrently in parallel (< 30ms)
      const parsedItems = await Promise.all(files.map(file => parseSingleReferenceFile(file)));

      const mergedDocs = [
        ...referenceDocs.filter(existing => !parsedItems.some(p => p.fileName === existing.fileName)),
        ...parsedItems,
      ];
      setReferenceDocs(mergedDocs);

      // Release upload spinner immediately after local file reading finishes
      setIsParsingReference(false);

      const combined = getCombinedReferenceData(mergedDocs);
      // 2. Instant local question extraction (< 5ms, zero API wait time)
      const localQuestions = extractQuestionsLocally(combined.text);
      setExtractedQuestions(localQuestions);

      console.log(
        `[Reference] Fast parsed ${mergedDocs.length} files in ${Math.round(performance.now() - t0)}ms: ${combined.text.length} chars, ${localQuestions.length} questions extracted locally`
      );
    } catch (err: any) {
      setGenState(prev => ({ ...prev, error: `Lỗi đọc file tham khảo: ${err.message}` }));
    } finally {
      setIsParsingReference(false);
      if (referenceUploadRef.current) referenceUploadRef.current.value = '';
    }
  };

  // Optional on-demand AI deep extraction (for scanned PDFs / MathType WMF images)
  const handleDeepAiExtractReference = async () => {
    if (referenceDocs.length === 0 || isExtractingQuestions) return;
    const combined = getCombinedReferenceData(referenceDocs);
    setIsExtractingQuestions(true);
    try {
      const questions = await extractQuestionsFromReference(
        combined.text,
        combined.images,
        genState.specs,
        inputData.subject,
        inputData.grade,
        true
      );
      if (questions.length > 0) {
        setExtractedQuestions(questions);
      }
    } catch (extractErr: any) {
      console.warn('[Reference] Deep AI extraction failed:', extractErr.message);
    } finally {
      setIsExtractingQuestions(false);
    }
  };

  const handleReferenceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    await processReferenceFiles(e.target.files);
  };

  const handleReferenceDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingReference(false);
    if (isParsingReference) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processReferenceFiles(e.dataTransfer.files);
    }
  };

  const handleRemoveReferenceDoc = (id: string) => {
    const remaining = referenceDocs.filter(doc => doc.id !== id);
    setReferenceDocs(remaining);
    if (remaining.length === 0) {
      setExtractedQuestions([]);
    } else {
      const combined = getCombinedReferenceData(remaining);
      setExtractedQuestions(extractQuestionsLocally(combined.text));
    }
  };

  const handleClearAllReferenceDocs = () => {
    setReferenceDocs([]);
    setExtractedQuestions([]);
  };

  const handleDownloadWord = async (content: string, fileName: string) => {
    let sourceHTML = '';
    try {
      const { text: contentWithoutFigures, figures } = extractFiguresToPlaceholders(content);
      const cleanedContent = contentWithoutFigures.replace(/^```html\s*/i, '').replace(/\s*```$/i, '').trim();

      // Nếu đã là Full HTML document (có thẻ html/body hoặc doctype)
      if (cleanedContent.includes('<!DOCTYPE html>') || (cleanedContent.includes('<html') && cleanedContent.includes('<body'))) {
        sourceHTML = cleanedContent.replace(
          /<\/style>/i,
          `
            table { page-break-inside: auto; border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
            tr { page-break-inside: avoid; page-break-after: auto; }
            td, th { border: 1px solid black; padding: 5px; vertical-align: middle; }
            th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
            .answer-table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt 0; }
            .answer-table th, .answer-table td { border: 1px solid #000; padding: 5pt 6pt; vertical-align: middle; }
            .answer-table th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
            .answer-table td.center { text-align: center; }
            .answer-table td.left { text-align: left; }
            p { margin-top: 4pt; margin-bottom: 4pt; line-height: 1.4; page-break-inside: avoid; }
            .options { margin-left: 15pt; page-break-inside: avoid; }
            .option-item { margin-bottom: 3pt; }
            .question-number { font-weight: bold; }
            h1, h2, h3, h4 { page-break-after: avoid; }
            div { page-break-inside: avoid; }

            /* CSS BẢNG BIẾN THIÊN CHUẨN SGK CHO WORD */
            .bbt-table { border-collapse: collapse; margin: 12pt auto; border: 1px solid #000; min-width: 420px; }
            .bbt-table td { padding: 4pt 8pt; text-align: center; vertical-align: middle; border: none; }
            .bbt-table .label-col { font-weight: bold; font-style: italic; border-right: 1px solid #000; width: 40pt; }
            .bbt-table .row-border { border-bottom: 1px solid #000; }
          </style>`
        );
      } else {
        // Nếu là MARKDOWN: render sang HTML, tạm cất công thức để markdown-it không làm hỏng LaTeX
        const renderedBody = renderMarkdownPreservingMath(mdParser, cleanedContent);
        
        sourceHTML = `
          <!DOCTYPE html>
          <html lang="vi">
          <head>
            <meta charset="utf-8">
            <title>${fileName}</title>
            <style>
              body { font-family: 'Times New Roman', serif; font-size: 13pt; line-height: 1.5; color: #000; }
              h1, h2, h3, h4 { font-weight: bold; margin-top: 10pt; margin-bottom: 6pt; page-break-after: avoid; }
              p { margin-top: 4pt; margin-bottom: 4pt; text-align: justify; page-break-inside: avoid; }
              ul, ol { margin-top: 2pt; margin-bottom: 6pt; padding-left: 20pt; }
              li { margin-bottom: 3pt; }
              table { border-collapse: collapse; width: 100%; margin: 8pt 0; page-break-inside: auto; }
              tr { page-break-inside: avoid; page-break-after: auto; }
              td, th { border: 1px solid black; padding: 4pt 6pt; vertical-align: middle; }
              th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
              .answer-table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt 0; }
              .answer-table th, .answer-table td { border: 1px solid #000; padding: 5pt 6pt; vertical-align: middle; }
              .answer-table th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
              .answer-table td.center { text-align: center; }
              .answer-table td.left { text-align: left; }
              strong { font-weight: bold; }
              .options { margin-left: 15pt; page-break-inside: avoid; }
              .option-item { margin-bottom: 3pt; }
              .question-number { font-weight: bold; }

              /* CSS BẢNG BIẾN THIÊN CHUẨN SGK CHO WORD */
              .bbt-table { border-collapse: collapse; margin: 12pt auto; border: 1px solid #000; min-width: 420px; }
              .bbt-table td { padding: 4pt 8pt; text-align: center; vertical-align: middle; border: none; }
              .bbt-table .label-col { font-weight: bold; font-style: italic; border-right: 1px solid #000; width: 40pt; }
              .bbt-table .row-border { border-bottom: 1px solid #000; }
            </style>
          </head>
          <body>
            ${renderedBody}
          </body>
          </html>
        `;
      }

      // Đảm bảo mọi bảng (trừ bảng biến thiên .bbt-table) đều có border="1" để hiển thị rõ khung bảng trong Word
      sourceHTML = sourceHTML.replace(/<table(?![^>]*bbt-table)(?![^>]*border=)/gi, '<table border="1" cellspacing="0" cellpadding="5"');

      // Chuẩn hoá LaTeX: tách công thức khỏi chữ + tách ranh giới cho MathType
      sourceHTML = normalizeMathForWord(sourceHTML);

      // Chuyển các hình vẽ (BBT, đồ thị, hình 3D) thành ảnh PNG 300 DPI nhúng vào Word
      sourceHTML = await restoreFiguresAsPngForWord(sourceHTML, figures, 300);

      const blob = await asBlob(sourceHTML, {
        orientation: 'portrait',
        margins: { top: 720, right: 720, bottom: 720, left: 720 }
      });

      const url = URL.createObjectURL(blob as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Lỗi xuất file Word (.docx), fallback sang .doc:', error);
      // Fallback: xuất .doc nếu .docx thất bại
      const fallbackHtml = normalizeMathForWord(sourceHTML || (content.includes('<!DOCTYPE html>') ? content : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${renderMarkdownPreservingMath(mdParser, content)}</body></html>`));
      const blob = new Blob(['\ufeff', fallbackHtml], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.doc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  // --- Sub-Components for Render ---

  const renderQuestionConfigRow = (
    label: string,
    typeKey: 'type1' | 'type2' | 'type3' | 'essay',
    defaultB: number,
    defaultH: number,
    defaultV: number,
    defaultVC: number = 0
  ) => (
    <div className="grid grid-cols-5 gap-3 items-center py-3 border-b border-teal-50 last:border-0">
      <span className="text-sm font-semibold text-teal-700">{label}</span>
      <div className="flex flex-col">
        <span className="text-xs text-teal-500 mb-1">Biết</span>
        <input
          type="number"
          className="w-full p-2 input-elevated text-center text-sm"
          value={inputData.questionConfig[typeKey].biet}
          onChange={(e) => updateQuestionConfig(typeKey, 'biet', parseInt(e.target.value) || 0)}
          min={0}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-teal-500 mb-1">Hiểu</span>
        <input
          type="number"
          className="w-full p-2 input-elevated text-center text-sm"
          value={inputData.questionConfig[typeKey].hieu}
          onChange={(e) => updateQuestionConfig(typeKey, 'hieu', parseInt(e.target.value) || 0)}
          min={0}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-teal-500 mb-1">Vận dụng</span>
        <input
          type="number"
          className="w-full p-2 input-elevated text-center text-sm"
          value={inputData.questionConfig[typeKey].van_dung}
          onChange={(e) => updateQuestionConfig(typeKey, 'van_dung', parseInt(e.target.value) || 0)}
          min={0}
        />
      </div>
      <div className="flex flex-col">
        <span className="text-xs text-teal-500 mb-1">VD cao</span>
        <input
          type="number"
          className="w-full p-2 input-elevated text-center text-sm"
          value={inputData.questionConfig[typeKey].van_dung_cao}
          onChange={(e) => updateQuestionConfig(typeKey, 'van_dung_cao', parseInt(e.target.value) || 0)}
          min={0}
        />
      </div>
    </div>
  );

  const updateDungSaiQuestionCount = (value: number) => {
    const count = Math.max(0, Math.floor(value || 0));
    setInputData(prev => {
      const current = getDungSaiLevelConfigs(prev.questionConfig);
      const configs = Array.from({ length: count }, (_, index) => ({ ...(current[index] || DEFAULT_DUNG_SAI_LEVELS) }));
      return { ...prev, questionConfig: { ...prev.questionConfig, type2QuestionCount: count, dungSaiLevelConfigs: configs } };
    });
  };

  const updateDungSaiLevel = (questionIndex: number, key: keyof typeof DEFAULT_DUNG_SAI_LEVELS, value: DungSaiLevel) => {
    setInputData(prev => {
      const configs = getDungSaiLevelConfigs(prev.questionConfig);
      configs[questionIndex] = { ...configs[questionIndex], [key]: value };
      return { ...prev, questionConfig: { ...prev.questionConfig, dungSaiLevelConfigs: configs } };
    });
  };

  const renderInputStep = () => (
    <div className="max-w-4xl mx-auto space-y-8 pb-12 relative z-10">

      {/* === SHORTCUT SECTION (Moved to top) === */}
      <div className="animate-fade-in-up">
        <div className="space-y-4">
          {/* Shortcut 1: Có file Ma trận */}
          <div className="shortcut-box p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-blue-800">⚡ Lối tắt: Bạn đã có file Ma trận?</h3>
              <p className="text-sm text-blue-600">Tải lên file Ma trận (HTML, Word, PDF) để bỏ qua các bước cấu hình và sinh ngay Bảng đặc tả.</p>
            </div>
            <input
              type="file"
              ref={matrixDirectUploadRef}
              onChange={handleMatrixSkipUpload}
              className="hidden"
              accept=".html,.txt,.pdf,.docx,.doc"
            />
            <Button
              variant="secondary"
              onClick={() => matrixDirectUploadRef.current?.click()}
              icon={<FileUp className="w-4 h-4" />}
              className="whitespace-nowrap"
              isLoading={genState.isLoading && currentStep === AppStep.INPUT && !isComboProcessing}
            >
              Upload Ma trận & Đi tiếp
            </Button>
          </div>

          {/* Shortcut 2: Có cả Ma trận + Đặc tả */}
          <div className="shortcut-box p-5" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 50%, #f0f9ff 100%)' }}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-bold text-emerald-800">🚀 Lối tắt: Bạn đã có file Ma trận + Đặc tả?</h3>
                <p className="text-sm text-emerald-600">Tải lên cả 2 file để nhảy thẳng sang bước tạo đề thi!</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {/* Upload Ma trận */}
              <input type="file" ref={comboMatrixUploadRef} onChange={handleComboMatrixSelect} className="hidden" accept=".html,.txt,.pdf,.docx,.doc" />
              <button
                onClick={() => comboMatrixUploadRef.current?.click()}
                className={`flex items-center gap-3 p-3.5 rounded-xl border-2 border-dashed transition-all text-left ${comboMatrixFile
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/30'
                  }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${comboMatrixFile ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}>
                  {comboMatrixFile ? <Check className="w-5 h-5 text-emerald-600" /> : <FileUp className="w-5 h-5 text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${comboMatrixFile ? 'text-emerald-700' : 'text-slate-600'}`}>
                    {comboMatrixFile ? comboMatrixFile.name : '📋 Chọn file Ma trận'}
                  </p>
                  <p className="text-xs text-slate-400">{comboMatrixFile ? 'Đã chọn · Click để đổi' : 'HTML, Word, PDF'}</p>
                </div>
              </button>

              {/* Upload Đặc tả */}
              <input type="file" ref={comboSpecsUploadRef} onChange={handleComboSpecsSelect} className="hidden" accept=".html,.txt,.pdf,.docx,.doc" />
              <button
                onClick={() => comboSpecsUploadRef.current?.click()}
                className={`flex items-center gap-3 p-3.5 rounded-xl border-2 border-dashed transition-all text-left ${comboSpecsFile
                  ? 'border-emerald-400 bg-emerald-50'
                  : 'border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/30'
                  }`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${comboSpecsFile ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}>
                  {comboSpecsFile ? <Check className="w-5 h-5 text-emerald-600" /> : <FileUp className="w-5 h-5 text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${comboSpecsFile ? 'text-emerald-700' : 'text-slate-600'}`}>
                    {comboSpecsFile ? comboSpecsFile.name : '📝 Chọn file Đặc tả'}
                  </p>
                  <p className="text-xs text-slate-400">{comboSpecsFile ? 'Đã chọn · Click để đổi' : 'HTML, Word, PDF'}</p>
                </div>
              </button>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-emerald-500 italic">
                {comboMatrixFile && comboSpecsFile
                  ? '✅ Đã chọn đủ 2 file — Nhấn nút để xử lý'
                  : `⏳ Còn thiếu: ${!comboMatrixFile ? 'Ma trận' : ''}${!comboMatrixFile && !comboSpecsFile ? ' + ' : ''}${!comboSpecsFile ? 'Đặc tả' : ''}`
                }
              </p>
              <Button
                onClick={processComboShortcut}
                disabled={!comboMatrixFile || !comboSpecsFile}
                isLoading={isComboProcessing}
                icon={<ArrowRight className="w-4 h-4" />}
                className="whitespace-nowrap"
              >
                Xử lý & Tạo đề thi
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t-2 border-teal-100/60"></div></div>
        <span className="relative bg-white px-4 py-1 text-xs font-bold text-teal-500 uppercase tracking-wider rounded-full border border-teal-100">Hoặc bắt đầu từ đầu</span>
      </div>

      {/* 1. Basic Info & Upload */}
      <div className="card-elevated p-6 sm:p-8 animate-fade-in-up">
        <h2 className="text-xl font-bold text-teal-800 mb-6 flex items-center gap-2.5">
          <span className="badge-section text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">1</span>
          Thông tin chung & Upload PPCT
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-semibold text-teal-700 mb-2">Môn học</label>
            <select
              name="subject"
              value={isCustomSubject ? '__custom__' : inputData.subject}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setIsCustomSubject(true);
                  setInputData(prev => ({ ...prev, subject: '' }));
                } else {
                  setIsCustomSubject(false);
                  handleInputChange(e);
                }
              }}
              className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none"
            >
              <option value="">-- Chọn môn học --</option>
              <option value="Toán học">Toán học</option>
              <option value="Ngữ văn">Ngữ văn</option>
              <option value="Tiếng Anh">Tiếng Anh</option>
              <option value="Vật lí">Vật lí</option>
              <option value="Hóa học">Hóa học</option>
              <option value="Sinh học">Sinh học</option>
              <option value="Lịch sử">Lịch sử</option>
              <option value="Địa lí">Địa lí</option>
              <option value="Tin học">Tin học</option>
              <option value="Công nghệ">Công nghệ</option>
              <option value="Giáo dục công dân">Giáo dục công dân (GD KT&PL)</option>
              <option value="Giáo dục thể chất">Giáo dục thể chất</option>
              <option value="Âm nhạc">Âm nhạc</option>
              <option value="Mỹ thuật">Mỹ thuật</option>
              <option value="Khoa học tự nhiên">Khoa học tự nhiên</option>
              <option value="Lịch sử và Địa lí">Lịch sử và Địa lí</option>
              <option value="Hoạt động trải nghiệm">Hoạt động trải nghiệm, hướng nghiệp</option>
              <option value="__custom__">✏️ Nhập môn khác...</option>
            </select>
            {isCustomSubject && (
              <input
                type="text"
                name="subject"
                value={inputData.subject}
                onChange={handleInputChange}
                placeholder="Nhập tên môn học của bạn..."
                className="w-full p-3 mt-2 input-elevated focus:ring-2 focus:ring-primary outline-none"
                autoFocus
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-semibold text-teal-700 mb-2">Khối lớp</label>
            <select name="grade" value={inputData.grade} onChange={handleInputChange} className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none">
              <option value="">-- Chọn khối lớp --</option>
              <option value="1">Lớp 1</option>
              <option value="2">Lớp 2</option>
              <option value="3">Lớp 3</option>
              <option value="4">Lớp 4</option>
              <option value="5">Lớp 5</option>
              <option value="6">Lớp 6</option>
              <option value="7">Lớp 7</option>
              <option value="8">Lớp 8</option>
              <option value="9">Lớp 9</option>
              <option value="10">Lớp 10</option>
              <option value="11">Lớp 11</option>
              <option value="12">Lớp 12</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-teal-700 mb-2">Loại kiểm tra (Auto Filter)</label>
            <select name="examType" value={inputData.examType} onChange={handleInputChange} className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none">
              <option>Kiểm tra 15 phút</option>
              <option>Kiểm tra 45 phút</option>
              <option>Giữa kỳ 1</option>
              <option>Cuối kỳ 1</option>
              <option>Giữa kỳ 2</option>
              <option>Cuối kỳ 2</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-teal-700 mb-2">Thời gian (phút)</label>
            <div className="relative">
              <input type="number" name="duration" value={inputData.duration} onChange={handleInputChange} className="w-full p-3 pl-10 input-elevated focus:ring-2 focus:ring-primary outline-none" />
              <Clock className="w-5 h-5 text-slate-400 absolute left-3 top-3.5" />
            </div>
          </div>
        </div>

        <div className="p-5 upload-zone text-center relative">
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".pdf,.docx,.doc" className="hidden" id="file-upload" disabled={isAnalyzingFile} />
          <label htmlFor="file-upload" className={`cursor-pointer flex flex-col items-center justify-center ${isAnalyzingFile ? 'opacity-50' : ''}`}>
            {isAnalyzingFile ? (
              <div className="flex items-center gap-2 text-primary font-medium"><div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div> Đang phân tích...</div>
            ) : uploadedFileName ? (
              <div className="flex items-center gap-2 text-green-700 font-medium"><Check className="w-5 h-5" /> {uploadedFileName} (Click thay đổi)</div>
            ) : (
              <div className="flex items-center gap-2 text-primary font-medium"><Upload className="w-5 h-5" /> Upload File PPCT (.pdf, .docx)</div>
            )}
          </label>
          <p className="text-xs text-slate-500 mt-2 italic">📌 Hỗ trợ file <strong>.pdf</strong> và <strong>.docx</strong> (Word). Công thức toán MathType sẽ được tự động trích xuất.</p>
        </div>
      </div>

      {/* === MATRIX TEMPLATE SELECTOR === */}
      <div className="card-elevated p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
        <h2 className="text-xl font-bold text-teal-800 mb-4 flex items-center gap-2.5">
          <span className="badge-section text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">✦</span>
          Chọn mẫu Ma trận – Đặc tả
        </h2>
        <p className="text-sm text-slate-500 mb-4">Chọn mẫu format bảng Ma trận & Đặc tả mà AI sẽ sinh ra.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MATRIX_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => setMatrixTemplate(tmpl.id)}
              className={`relative flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left group ${matrixTemplate === tmpl.id
                ? 'border-teal-500 bg-teal-50 shadow-md shadow-teal-100'
                : 'border-slate-200 hover:border-teal-300 hover:bg-teal-50/30'
                }`}
            >
              {/* Radio indicator */}
              <div className="absolute top-3 right-3">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${matrixTemplate === tmpl.id ? 'border-teal-500 bg-teal-500' : 'border-slate-300'
                  }`}>
                  {matrixTemplate === tmpl.id && (
                    <div className="w-2 h-2 rounded-full bg-white" />
                  )}
                </div>
              </div>
              {/* Content */}
              <span className="text-2xl mb-2">{tmpl.icon}</span>
              <span className="text-sm font-bold text-teal-800 pr-6">{tmpl.name}</span>
              <span className="text-xs text-slate-500 mt-1 leading-relaxed">{tmpl.description}</span>
              {tmpl.badge && (
                <span className="mt-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">{tmpl.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Topic Selection Tree */}
      {inputData.chapters.length > 0 && (
        <div className="card-elevated p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-teal-800 flex items-center gap-2.5">
              <span className="badge-section text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">2</span>
              Chọn chủ đề trọng tâm
            </h2>
            <div className="flex gap-2 text-xs">
              <button onClick={() => applySmartFilter(inputData.examType, inputData.chapters)} className="flex items-center gap-1 text-primary hover:bg-teal-50 px-2 py-1 rounded"><Filter className="w-3 h-3" /> Lọc theo kỳ</button>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden border border-teal-100 shadow-sm">
            {inputData.chapters.map(chap => {
              const isExpanded = expandedChapterIds.has(chap.id);
              const activeLessonCount = chap.lessons.filter(l => selectedLessonIds.has(l.id)).length;
              const isFullSelected = activeLessonCount === chap.lessons.length;
              const isPartSelected = activeLessonCount > 0 && !isFullSelected;

              return (
                <div key={chap.id} className="border-b border-slate-100 last:border-0">
                  {/* Chapter Header */}
                  <div className="flex items-center bg-teal-50/40 p-3 chapter-row">
                    <button onClick={() => toggleExpandChapter(chap.id)} className="p-1 mr-2 text-slate-500">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <input
                      type="checkbox"
                      className="w-4 h-4 mr-3 text-primary rounded focus:ring-primary"
                      checked={isFullSelected}
                      ref={el => { if (el) el.indeterminate = isPartSelected; }}
                      onChange={(e) => toggleChapter(chap.id, e.target.checked)}
                    />
                    <div className="flex-1 font-semibold text-sm text-teal-800">
                      {chap.name}
                    </div>
                    <span className="text-xs chip-teal px-2 py-0.5 text-teal-700 ml-2">
                      {chap.totalPeriods} tiết
                    </span>
                  </div>

                  {/* Lessons List */}
                  {isExpanded && (
                    <div className="pl-12 pr-4 py-2 space-y-1 bg-white">
                      {chap.lessons.map(lesson => (
                        <div key={lesson.id} className="flex items-center p-2 hover:bg-teal-50 rounded group">
                          <input
                            type="checkbox"
                            className="w-4 h-4 mr-3 text-primary rounded focus:ring-primary"
                            checked={selectedLessonIds.has(lesson.id)}
                            onChange={() => toggleLesson(lesson.id)}
                          />
                          <div className="flex-1 text-sm text-teal-700">
                            {lesson.name}
                          </div>
                          <div className="flex gap-2 opacity-70 group-hover:opacity-100">
                            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">{lesson.periods} tiết</span>
                            {lesson.weekEnd && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Tuần {lesson.weekStart}-{lesson.weekEnd}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between items-center text-sm text-teal-700 chip-teal p-3">
            <span>Đã chọn: <strong className="text-primary">{selectedLessonIds.size}</strong> bài học</span>
          </div>
        </div>
      )}

      {/* 3. Question Configuration */}
      <div className="card-elevated p-6 sm:p-8 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
        <h2 className="text-xl font-bold text-teal-800 mb-6 flex items-center gap-2.5">
          <span className="badge-section text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold">3</span>
          Cấu trúc đề thi (Số lượng câu hỏi)
        </h2>
        <div className="config-table">
          {renderQuestionConfigRow("Dạng I (4 lựa chọn)", "type1", 8, 4, 0)}
          <div className="py-4 border-b border-teal-50 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div className="sm:col-span-3">
                <span className="block text-sm font-semibold text-teal-700">Dạng II (Đúng/Sai)</span>
                <p className="text-xs text-teal-500 mt-1">Khai báo số câu, sau đó chọn mức độ riêng cho từng ý a, b, c, d.</p>
              </div>
              <div className="sm:col-span-2 flex flex-col">
                <span className="text-xs text-teal-500 mb-1">Số câu</span>
                <input type="number" min={0} className="w-full p-2 input-elevated text-center text-sm" value={getDungSaiQuestionCount(inputData.questionConfig)} onChange={e => updateDungSaiQuestionCount(Number(e.target.value))} />
              </div>
            </div>
            {getDungSaiLevelConfigs(inputData.questionConfig).map((question, questionIndex) => (
              <div key={questionIndex} className="rounded-xl border border-teal-100 bg-teal-50/40 p-3">
                <span className="block text-sm font-bold text-teal-800 mb-2">Câu {questionIndex + 1}</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(['yA', 'yB', 'yC', 'yD'] as const).map((key, idx) => (
                    <div key={key} className="flex flex-col">
                      <span className="text-xs text-teal-500 mb-1">Ý {'abcd'[idx]}</span>
                      <select className="w-full p-2 input-elevated text-sm" value={question[key]} onChange={e => updateDungSaiLevel(questionIndex, key, e.target.value as DungSaiLevel)}>
                        <option value="nhan_biet">Nhận biết</option>
                        <option value="thong_hieu">Thông hiểu</option>
                        <option value="van_dung">Vận dụng</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {renderQuestionConfigRow("Dạng III (Trả lời ngắn)", "type3", 1, 1, 2)}
          {renderQuestionConfigRow("Tự luận", "essay", 0, 1, 2)}
        </div>
      </div>

      <div className="pt-6 flex justify-end">
        <Button
          onClick={handleGenerateMatrix}
          isLoading={genState.isLoading}
          disabled={selectedLessonIds.size === 0}
          icon={<ArrowRight className="w-5 h-5" />}
          className="w-full sm:w-auto px-8 py-3 text-lg shadow-lg shadow-teal-100"
        >
          Tạo Ma trận đề thi
        </Button>
      </div>

    </div>
  );

  const renderContentStep = (
    title: string,
    content: string,
    onNext: () => void,
    nextLabel: string,
    isLastStep: boolean = false,
    onUpdateContent: (val: string) => void
  ) => (
    <div className="max-w-[1400px] mx-auto h-full flex flex-col p-4 sm:p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 card-elevated p-4 flex-shrink-0">
        <h2 className="text-xl font-bold text-teal-800 flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full badge-section text-white flex items-center justify-center text-sm shrink-0 font-bold">
            {currentStep + 1}
          </span>
          {title}
        </h2>
        <div className="flex flex-wrap gap-2.5">
          {/* Upload Matrix Button - Only for Matrix Step */}
          {currentStep === AppStep.MATRIX && (
            <>
              <input
                type="file"
                ref={matrixUploadRef}
                onChange={handleMatrixUpload}
                className="hidden"
                accept=".html,.txt,.pdf,.docx,.doc"
              />
              <Button
                variant="secondary"
                onClick={() => matrixUploadRef.current?.click()}
                icon={<Upload className="w-4 h-4" />}
                isLoading={genState.isLoading}
              >
                Upload Ma trận
              </Button>
            </>
          )}

          <Button variant="secondary" onClick={() => handleDownloadWord(content, title)} icon={<FileText className="w-4 h-4" />}>
            Tải Word (.docx)
          </Button>

          <Button variant="secondary" onClick={() => {
            const blob = new Blob([content], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${title}.html`;
            a.click();
          }} icon={<Download className="w-4 h-4" />}>
            Tải HTML
          </Button>

          {isLastStep && (
            <>
              <Button
                variant={isCurrentExamSaved ? 'secondary' : 'primary'}
                onClick={handleSaveHistory}
                disabled={isCurrentExamSaved || genState.isLoading || !content}
                icon={isCurrentExamSaved ? <Check className="w-4 h-4 text-emerald-600" /> : <Save className="w-4 h-4" />}
              >
                {isCurrentExamSaved ? 'Đã lưu lịch sử' : 'Lưu lịch sử tạo'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowHistoryModal(true)}
                icon={<History className="w-4 h-4 text-teal-700" />}
              >
                Lịch sử tạo ({examHistory.length}/5)
              </Button>
            </>
          )}

          {!isLastStep && (
            <Button onClick={onNext} isLoading={genState.isLoading} icon={<ArrowRight className="w-4 h-4" />}>
              {nextLabel}
            </Button>
          )}
        </div>
      </div>

      {/* Thanh thông tin đồng bộ từ Ma trận đã tải lên (hiển thị ở Bước 2 & Bước 3) */}
      {isUploadedMatrix && (currentStep === AppStep.MATRIX || currentStep === AppStep.SPECS) && (
        <div className="mb-3 px-4 py-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs text-emerald-900 flex-shrink-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold flex items-center gap-1 text-emerald-800">
              <Check className="w-4 h-4 text-emerald-600" />
              Đã đồng bộ theo đúng Ma trận tải lên:
            </span>
            <span>Môn: <strong>{inputData.subject || 'Toán học'}</strong></span>
            <span>•</span>
            <span>Khối: <strong>Lớp {inputData.grade || '12'}</strong></span>
            <span>•</span>
            <span>Kỳ: <strong>{inputData.examType}</strong></span>
            <span>•</span>
            <span>
              Cấu trúc:{' '}
              <strong>
                Phần I ({inputData.questionConfig.type1.biet + inputData.questionConfig.type1.hieu + inputData.questionConfig.type1.van_dung + inputData.questionConfig.type1.van_dung_cao} câu)
              </strong>
              {', '}
              <strong>
                Phần II ({getDungSaiQuestionCount(inputData.questionConfig)} câu Đ/S)
              </strong>
              {', '}
              <strong>
                Phần III ({inputData.questionConfig.type3.biet + inputData.questionConfig.type3.hieu + inputData.questionConfig.type3.van_dung + inputData.questionConfig.type3.van_dung_cao} câu TLN)
              </strong>
              {', '}
              <strong>
                Tự luận ({inputData.questionConfig.essay.biet + inputData.questionConfig.essay.hieu + inputData.questionConfig.essay.van_dung + inputData.questionConfig.essay.van_dung_cao} câu)
              </strong>
            </span>
          </div>
          {currentStep === AppStep.MATRIX && genState.specs && (
            <button
              type="button"
              onClick={() => {
                setCurrentStep(AppStep.SPECS);
                setCompletedSteps(Math.max(completedSteps, 2));
              }}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors flex items-center gap-1 shrink-0"
            >
              <Eye className="w-3.5 h-3.5" />
              Dùng luôn Đặc tả trong file
            </button>
          )}
        </div>
      )}

      {/* Reference Document Upload - Only for SPECS step */}
      {currentStep === AppStep.SPECS && (
        <div className="mb-4 card-elevated p-4 flex-shrink-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-teal-600" />
              <span className="text-sm font-bold text-teal-800">Tài liệu tham khảo — Ngân hàng câu hỏi</span>
              <span className="text-xs text-slate-400">(tùy chọn)</span>
            </div>
            {referenceDocs.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => referenceUploadRef.current?.click()}
                  disabled={isParsingReference}
                  className="text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Thêm file
                </button>
                <button
                  type="button"
                  onClick={handleClearAllReferenceDocs}
                  className="text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa tất cả ({referenceDocs.length})
                </button>
              </div>
            )}
          </div>

          {/* 2 Options: Trích xuất chính xác vs Tham khảo dạng câu hỏi, thay số hoặc bối cảnh */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setReferenceMode('exact')}
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border-2 text-left transition-all ${
                referenceMode === 'exact'
                  ? 'border-teal-500 bg-teal-50/80 shadow-sm'
                  : 'border-slate-200 hover:border-teal-300 bg-white'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                referenceMode === 'exact' ? 'border-teal-600 bg-teal-600' : 'border-slate-300'
              }`}>
                {referenceMode === 'exact' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-teal-900">Trích xuất chính xác</div>
                <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                  Sử dụng nguyên văn các câu hỏi trong tài liệu vào đề thi (phù hợp với ma trận, đặc tả).
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setReferenceMode('adapt')}
              className={`flex items-start gap-2.5 p-2.5 rounded-xl border-2 text-left transition-all ${
                referenceMode === 'adapt'
                  ? 'border-teal-500 bg-teal-50/80 shadow-sm'
                  : 'border-slate-200 hover:border-teal-300 bg-white'
              }`}
            >
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                referenceMode === 'adapt' ? 'border-teal-600 bg-teal-600' : 'border-slate-300'
              }`}>
                {referenceMode === 'adapt' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-teal-900">
                  Tham khảo dạng câu hỏi, thay số hoặc bối cảnh cho phù hợp
                </div>
                <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                  Giữ dạng bài từ tài liệu nhưng thay đổi số liệu, hàm số hoặc bối cảnh thực tế và giải lại đáp án.
                </p>
              </div>
            </button>
          </div>

          <input
            type="file"
            multiple
            ref={referenceUploadRef}
            onChange={handleReferenceUpload}
            className="hidden"
            accept=".docx,.doc,.pdf,.txt,.html"
          />

          {/* Drag & Drop / Click Zone (always available to upload multiple files at once) */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isParsingReference) setIsDraggingReference(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingReference(false);
            }}
            onDrop={handleReferenceDrop}
            onClick={() => !isParsingReference && referenceUploadRef.current?.click()}
            className={`cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-2 px-4 py-3 border-2 border-dashed rounded-xl transition-all text-sm w-full ${
              isDraggingReference
                ? 'border-teal-500 bg-teal-50 text-teal-800 scale-[1.005]'
                : 'border-teal-200 hover:border-teal-400 hover:bg-teal-50/50 text-teal-600'
            } ${isParsingReference ? 'opacity-60 pointer-events-none' : ''}`}
          >
            {isParsingReference ? (
              <>
                <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                <span className="font-medium">Đang phân tích các tài liệu tải lên...</span>
              </>
            ) : (
              <>
                <Paperclip className="w-4 h-4 shrink-0" />
                <span className="font-medium text-center">
                  Kéo thả nhiều file vào đây hoặc click để chọn file đề mẫu / ngân hàng câu hỏi (.docx, .pdf)
                </span>
              </>
            )}
          </div>

          {/* Uploaded Files List & Extraction Summary */}
          {referenceDocs.length > 0 && (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                {referenceDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2.5 px-3 py-2 bg-teal-50/70 border border-teal-200 rounded-lg"
                  >
                    <div className="w-7 h-7 bg-teal-100 rounded-md flex items-center justify-center shrink-0">
                      <FileText className="w-3.5 h-3.5 text-teal-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-teal-900 truncate" title={doc.fileName}>
                        {doc.fileName}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {doc.method === 'hybrid'
                          ? `Hybrid: ${doc.wmfCount} MathType + ${doc.images.length} hình`
                          : doc.method === 'xml'
                            ? `Word XML: ${Math.max(1, Math.round(doc.text.length / 1000))}K ký tự`
                            : doc.method === 'pdf'
                              ? 'PDF / Hình ảnh đính kèm'
                              : `${Math.max(1, Math.round(doc.text.length / 1000))}K ký tự`
                        }
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveReferenceDoc(doc.id)}
                      className="shrink-0 p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                      title="Xóa file này"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Extraction Status */}
              {isExtractingQuestions && (
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs sm:text-sm text-amber-700 font-medium">
                    Đang quét sâu câu hỏi từ {referenceDocs.length} tài liệu bằng AI...
                  </span>
                </div>
              )}

              {/* Extracted Questions Summary */}
              {extractedQuestions.length > 0 && !isExtractingQuestions && (
                <div className="px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs sm:text-sm font-bold text-emerald-800">
                        Đã phân tích nhanh {extractedQuestions.length} câu hỏi từ {referenceDocs.length} file (tức thì)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeepAiExtractReference}
                      className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 bg-white/80 hover:bg-white px-2.5 py-1 rounded-md border border-emerald-200 transition-colors flex items-center gap-1"
                      title="Dùng AI quét sâu thêm (hữu ích nếu tài liệu có nhiều hình công thức MathType hoặc PDF scan)"
                    >
                      <Sparkles className="w-3 h-3" />
                      Quét sâu bằng AI
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {(() => {
                      const byType = {
                        type1: extractedQuestions.filter(q => q.type === 'type1').length,
                        type2: extractedQuestions.filter(q => q.type === 'type2').length,
                        type3: extractedQuestions.filter(q => q.type === 'type3').length,
                        essay: extractedQuestions.filter(q => q.type === 'essay').length,
                      };
                      return (
                        <>
                          {byType.type1 > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-md">Dạng I: {byType.type1} câu</span>}
                          {byType.type2 > 0 && <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-md">Dạng II: {byType.type2} câu</span>}
                          {byType.type3 > 0 && <span className="bg-orange-100 text-orange-700 px-2 py-1 rounded-md">Dạng III: {byType.type3} câu</span>}
                          {byType.essay > 0 && <span className="bg-pink-100 text-pink-700 px-2 py-1 rounded-md">Tự luận: {byType.essay} câu</span>}
                        </>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-emerald-700 mt-1.5 italic">
                    {referenceMode === 'exact'
                      ? '✅ Chế độ Trích xuất chính xác: Các câu hỏi sẽ được sử dụng NGUYÊN VĂN trong đề thi (phù hợp ma trận + đặc tả).'
                      : '🔄 Chế độ Tham khảo & Thay số: AI sẽ lấy dạng bài từ các câu hỏi này và thay đổi số liệu hoặc bối cảnh cho phù hợp.'}
                  </p>
                </div>
              )}

              {/* Ready status when file is PDF/image or unnumbered text */}
              {referenceDocs.length > 0 && !isExtractingQuestions && extractedQuestions.length === 0 && (
                <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-teal-50/80 border border-teal-200 rounded-lg flex-wrap">
                  <p className="text-xs text-teal-800 font-medium">
                    ✅ Đã nạp xong {referenceDocs.length} tài liệu ({Math.max(1, Math.round(getCombinedReferenceData(referenceDocs).text.length / 1000))}K ký tự). Sẵn sàng tạo đề theo chế độ "{referenceMode === 'exact' ? 'Trích xuất chính xác' : 'Tham khảo dạng câu hỏi, thay số hoặc bối cảnh'}".
                  </p>
                  <button
                    type="button"
                    onClick={handleDeepAiExtractReference}
                    className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 bg-white px-2.5 py-1 rounded-md border border-teal-200 transition-colors flex items-center gap-1 shrink-0"
                  >
                    <Sparkles className="w-3 h-3" />
                    Bóc tách trước bằng AI
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {currentStep === AppStep.EXAM && (
        <BbtQuickGenerator
          examContent={content}
          onUpdateExamContent={onUpdateContent}
        />
      )}

      <div className="flex-1 min-h-0 flex flex-col pb-2 relative">
        {/* Loading overlay when generating additional exam from history */}
        {genState.isLoading && isLastStep && (
          <div className="absolute inset-0 z-20 bg-white/85 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-base font-bold text-teal-800">
              Đang sinh đề thi mới từ Ma trận & Bảng đặc tả đã lưu...
            </p>
            <p className="text-xs text-slate-500">
              Hệ thống đang giữ nguyên cấu trúc Ma trận, Đặc tả và sinh bộ câu hỏi mới.
            </p>
          </div>
        )}

        {/* Preview Side */}
        <div className="flex flex-col h-full panel-elevated">
          <div className="bg-gradient-to-r from-teal-50 to-emerald-50 px-4 py-2.5 border-b border-teal-100/50 flex-shrink-0">
            <label className="text-xs font-bold text-primary uppercase tracking-wider">Xem trước</label>
          </div>
          <div className="flex-1 overflow-auto bg-white p-2">
            <MarkdownView content={content} />
          </div>
        </div>
      </div>
    </div>
  );

  const handleReset = () => {
    if (window.confirm("Tạo mới sẽ xóa toàn bộ dữ liệu hiện tại?")) {
      setInputData({
        subject: '', grade: '', duration: 45, examType: 'Giữa kỳ 1', topics: '', additionalNotes: '',
        chapters: [],
        questionConfig: {
          type1: { biet: 8, hieu: 4, van_dung: 0, van_dung_cao: 0 },
          type2: { biet: 1, hieu: 1, van_dung: 0, van_dung_cao: 0 },
      type2QuestionCount: 2,
      dungSaiLevelConfigs: [{ ...DEFAULT_DUNG_SAI_LEVELS }, { ...DEFAULT_DUNG_SAI_LEVELS }],
          type3: { biet: 1, hieu: 1, van_dung: 2, van_dung_cao: 0 },
          essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
        }
      });
      setUploadedFileName(null);
      setIsCustomSubject(false);
      setCurrentStep(AppStep.INPUT);
      setCompletedSteps(0);
      setSelectedLessonIds(new Set());
      setExpandedChapterIds(new Set());
      setMatrixTemplate('template1');
      setReferenceDocs([]);
      setReferenceMode('exact');
      setExtractedQuestions([]);
      setComboMatrixFile(null);
      setComboSpecsFile(null);
      setIsCurrentExamSaved(false);
    }
  }

  return (
    <div className="h-screen w-full flex flex-col bg-app-gradient font-sans text-black overflow-hidden">

      {/* History Modal (5 lịch sử tạo gần nhất) */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] flex items-center justify-center p-4" onClick={() => setShowHistoryModal(false)}>
          <div className="modal-elevated max-w-2xl w-full p-0 overflow-hidden max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #115e59 100%)' }} className="p-5 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/15">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Lịch sử tạo đề thi (5 gần nhất)</h2>
                  <p className="text-xs text-teal-100">Bấm "Tạo đề thi" để tận dụng Ma trận & Đặc tả đã tạo trước đó sinh đề thêm</p>
                </div>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {examHistory.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <History className="w-12 h-12 text-slate-300 mx-auto" />
                  <p className="text-sm font-semibold text-slate-600">Chưa có lịch sử tạo đề nào được lưu</p>
                  <p className="text-xs text-slate-400">Sau khi tạo xong đề thi, hãy bấm nút "Lưu lịch sử tạo" để lưu lại Ma trận, Đặc tả và Đề thi tại đây.</p>
                </div>
              ) : (
                examHistory.slice(0, 5).map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-teal-100 bg-white hover:border-teal-300 transition-all shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-teal-100 text-teal-800 shrink-0">
                          #{idx + 1}
                        </span>
                        <h3 className="text-sm font-bold text-teal-900 truncate" title={item.title}>
                          {item.title}
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>🕒 {item.createdAt}</span>
                        <span>•</span>
                        <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                          Đã lưu Ma trận + Đặc tả + Đề
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={() => handleGenerateExamFromHistory(item)}
                        isLoading={genState.isLoading}
                        icon={<Sparkles className="w-4 h-4" />}
                        className="text-xs px-3.5 py-2 whitespace-nowrap"
                      >
                        Tạo đề thi
                      </Button>
                      <button
                        onClick={() => handleRestoreHistory(item)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-teal-200 text-teal-700 hover:bg-teal-50 text-xs font-semibold transition-colors whitespace-nowrap"
                        title="Xem lại Ma trận, Đặc tả và Đề thi đã lưu"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Xem lại
                      </button>
                      <button
                        onClick={() => handleDeleteHistoryItem(item.id)}
                        className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
                        title="Xóa lịch sử này"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[60] flex items-center justify-center p-4" onClick={() => setShowLoginModal(false)}>
          <div className="modal-elevated max-w-md w-full p-0 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 50%, #115e59 100%)' }} className="p-6 text-white relative overflow-hidden">
              <div style={{ position: 'absolute', top: '-20px', right: '-20px', width: '120px', height: '120px', background: 'rgba(255,255,255,0.08)', borderRadius: '50%' }} />
              <div style={{ position: 'absolute', bottom: '-30px', left: '-10px', width: '80px', height: '80px', background: 'rgba(255,255,255,0.05)', borderRadius: '50%' }} />
              <div className="flex items-center gap-3 mb-3 relative">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)' }}>
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Đăng nhập để tiếp tục</h2>
                  <p className="text-sm text-teal-100">Bạn đã hết lượt dùng thử miễn phí</p>
                </div>
              </div>
              <button onClick={() => setShowLoginModal(false)} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Login Form */}
            <div className="p-6 space-y-4">
              {loginError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {loginError}
                </div>
              )}

              <div>
                <label className="text-sm font-semibold text-teal-700 mb-1.5 block flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Tên đăng nhập
                </label>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => { setLoginUsername(e.target.value); setLoginError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Nhập tên đăng nhập..."
                  className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none text-sm"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-teal-700 mb-1.5 block flex items-center gap-1.5">
                  <Key className="w-3.5 h-3.5" /> Mật khẩu
                </label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => { setLoginPassword(e.target.value); setLoginError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Nhập mật khẩu..."
                  className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none text-sm"
                />
              </div>

              <button
                onClick={handleLogin}
                disabled={!loginUsername.trim() || !loginPassword.trim()}
                className="w-full py-3 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 text-sm"
                style={{
                  background: (!loginUsername.trim() || !loginPassword.trim()) ? '#94a3b8' : 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                  cursor: (!loginUsername.trim() || !loginPassword.trim()) ? 'not-allowed' : 'pointer',
                  boxShadow: (!loginUsername.trim() || !loginPassword.trim()) ? 'none' : '0 4px 14px rgba(13, 148, 136, 0.4)',
                }}
              >
                <LogIn className="w-4 h-4" />
                Đăng nhập
              </button>
            </div>

            {/* Contact Info */}
            <div style={{ background: 'linear-gradient(135deg, #f0fdfa 0%, #ecfdf5 50%, #f0f9ff 100%)' }} className="p-5 border-t border-teal-100">
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-teal-100 shadow-sm">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Phone className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-teal-800">Liên hệ Zalo để mua tài khoản</p>
                    <a href="https://zalo.me/0348296773" target="_blank" rel="noopener noreferrer" className="text-lg font-bold text-blue-600 hover:underline">0348296773</a>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-teal-100 shadow-sm">
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-teal-800">Phí: <span className="text-emerald-600">199.000đ</span> — Sử dụng không giới hạn thời gian</p>
                    <p className="text-xs text-slate-500">Ủng hộ tác giả để duy trì và phát triển ứng dụng ❤️</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-amber-100 shadow-sm" style={{ background: 'linear-gradient(135deg, #fffbeb, #fef3c7)' }}>
                  <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <Gift className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-amber-800">🎁 TẶNG KÈM APP TẠO ĐỀ THI TOÀN NĂNG!</p>
                    <a href="https://taodethitoannang.vercel.app" target="_blank" rel="noopener noreferrer" className="text-xs text-amber-700 hover:underline font-medium flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> taodethitoannang.vercel.app
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showApiKeyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="modal-elevated max-w-lg w-full p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                <Settings className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-teal-800">Cài đặt AI System</h2>
                <p className="text-sm text-teal-500">Cấu hình Nhà cung cấp & API Key</p>
              </div>
            </div>
            <div className="space-y-5">
              {/* Provider Selection */}
              <div>
                <label className="text-sm font-semibold text-teal-700 mb-2 block">⚡ Nền tảng AI (Provider)</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setProviderState('gemini');
                      setApiKeyError('');
                      if (!GEMINI_MODELS.some(m => m.id === selectedModel)) {
                        setSelectedModelState(DEFAULT_GEMINI_MODEL);
                        setSelectedModel(DEFAULT_GEMINI_MODEL);
                      }
                    }}
                    className={`p-3 rounded-xl border-2 font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                      provider === 'gemini'
                        ? 'border-teal-600 bg-teal-50 text-teal-800 font-bold shadow-sm'
                        : 'border-slate-200 text-slate-600 hover:border-teal-300'
                    }`}
                  >
                    <span>Google Gemini</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProviderState('agent-platform');
                      setApiKeyError('');
                      if (!AGENT_PLATFORM_MODELS.some(m => m.id === selectedModel)) {
                        setSelectedModelState(DEFAULT_AGENT_PLATFORM_MODEL);
                        setSelectedModel(DEFAULT_AGENT_PLATFORM_MODEL);
                      }
                    }}
                    className={`p-3 rounded-xl border-2 font-medium text-sm flex items-center justify-center gap-2 transition-all ${
                      provider === 'agent-platform'
                        ? 'border-teal-600 bg-teal-50 text-teal-800 font-bold shadow-sm'
                        : 'border-slate-200 text-slate-600 hover:border-teal-300'
                    }`}
                  >
                    <span>Agent Platform</span>
                  </button>
                </div>
              </div>

              {/* API Key Section */}
              {provider === 'gemini' ? (
                <div>
                  <label className="text-sm font-semibold text-teal-700 mb-2 block">🔑 API Key (Google Gemini)</label>
                  <input
                    type="password"
                    value={tempGeminiKey}
                    onChange={(e) => {
                      setTempGeminiKey(e.target.value);
                      if (apiKeyError) setApiKeyError('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                    placeholder="Dán Gemini API Key (AIzaSy... hoặc AQ...)"
                    className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none font-mono text-sm"
                    autoFocus
                  />
                  <a
                    href="https://aistudio.google.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline font-medium mt-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Lấy API Key miễn phí tại Google AI Studio
                  </a>
                </div>
              ) : (
                <div>
                  <label className="text-sm font-semibold text-teal-700 mb-2 block">🔑 API Key (Agent Platform)</label>
                  <input
                    type="password"
                    value={tempAgentPlatformKey}
                    onChange={(e) => {
                      setTempAgentPlatformKey(e.target.value);
                      if (apiKeyError) setApiKeyError('');
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveApiKey()}
                    placeholder="Dán Agent Platform API Key (AQ... hoặc AIzaSy...)"
                    className="w-full p-3 input-elevated focus:ring-2 focus:ring-primary outline-none font-mono text-sm"
                    autoFocus
                  />
                  <a
                    href="https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline font-medium mt-2"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Hướng dẫn lấy API Key tại Agent Platform
                  </a>
                </div>
              )}

              {apiKeyError && (
                <p className="text-sm text-red-600 font-medium">{apiKeyError}</p>
              )}

              {/* Model Selector */}
              <div>
                <label className="text-sm font-semibold text-teal-700 mb-3 block">🤖 Chọn Model AI</label>
                <div className="space-y-2">
                  {(provider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS).map(m => (
                    <button
                      key={m.id}
                      onClick={() => { setSelectedModelState(m.id); setSelectedModel(m.id); }}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all text-left ${selectedModel === m.id
                        ? 'border-teal-500 bg-teal-50 shadow-sm'
                        : 'border-slate-200 hover:border-teal-300 hover:bg-teal-50/30'
                        }`}
                    >
                      <div>
                        <div className="font-semibold text-sm text-teal-800">{m.name}</div>
                        <div className="text-xs text-slate-500">{m.desc}</div>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${m.badge === 'Mặc định' ? 'bg-teal-100 text-teal-700' :
                        m.badge === 'Pro' ? 'bg-amber-100 text-amber-700' :
                          'bg-blue-100 text-blue-700'
                        }`}>{m.badge}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={handleSaveApiKey} className="w-full py-3" icon={<Key className="w-4 h-4" />}>
                Lưu & Áp dụng
              </Button>
              {apiKey && (
                <button onClick={() => setShowApiKeyModal(false)} className="w-full text-center text-sm text-slate-500 hover:text-slate-800 py-2">
                  Hủy
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="glass-header shrink-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 badge-section rounded-xl flex items-center justify-center text-white font-bold text-lg">
              AI
            </div>
            <div>
              <h1 className="text-lg font-bold text-teal-900 leading-tight">TẠO ĐỀ THI THEO CV 7991</h1>
              <p className="text-xs text-slate-500 leading-tight">Phát triển bởi thầy Trần Hoài Thanh - zalo 0348296773</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Auth Status Badge */}
            {isAuthenticated && loggedInUser ? (
              <div className="flex items-center gap-2">
                <span className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                  <Shield className="w-3 h-3" /> {loggedInUser.name}
                </span>
                <button onClick={handleLogout} className="text-xs text-slate-400 hover:text-red-500 transition-colors px-1.5 py-1 rounded" title="Đăng xuất">Đăng xuất</button>
              </div>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-all cursor-pointer"
                style={{
                  background: trialUsed
                    ? 'linear-gradient(135deg, #fef3c7, #fde68a)'
                    : 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
                  color: trialUsed ? '#92400e' : '#065f46',
                  border: trialUsed ? '1px solid #fcd34d' : '1px solid #6ee7b7',
                }}
                title="Nhấn để đăng nhập"
              >
                <LogIn className="w-3 h-3" />
                {trialUsed ? 'Hết lượt thử · Đăng nhập' : '🎁 1 lượt thử miễn phí · Đăng nhập'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2" style={{ marginLeft: '8px' }}>


            {/* Dark Mode Toggle */}
            <button
              onClick={() => setDarkMode(prev => !prev)}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors"
              title={darkMode ? 'Chế độ sáng' : 'Chế độ tối'}
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>
            <button
              onClick={() => {
                const activeProvider = getAiProvider();
                const savedModel = getSelectedModel();
                const validModels = activeProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : GEMINI_MODELS;
                const defaultModel = activeProvider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
                setProviderState(activeProvider);
                setSelectedModelState(savedModel && validModels.some(m => m.id === savedModel) ? savedModel : defaultModel);
                setTempGeminiKey(getApiKey('gemini') || '');
                setTempAgentPlatformKey(getApiKey('agent-platform') || '');
                setApiKeyError('');
                setShowApiKeyModal(true);
              }}
              className="flex items-center gap-2 text-sm px-3 py-1.5 h-9 rounded-lg border border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <Settings className="w-4 h-4 text-slate-600" />
              {!apiKey && <span className="text-red-500 font-medium text-xs">Lấy API key để sử dụng app</span>}
              {apiKey && (
                <span className="text-teal-700 font-medium text-xs">
                  Cài đặt ({provider === 'agent-platform' ? 'Agent Platform' : 'Gemini'})
                </span>
              )}
            </button>
            <Button
              variant="secondary"
              onClick={() => setShowHistoryModal(true)}
              icon={<History className="w-4 h-4 text-teal-700" />}
              className="text-sm px-3 py-1.5 h-9"
            >
              Lịch sử tạo {examHistory.length > 0 ? `(${examHistory.length})` : ''}
            </Button>
            <Button variant="secondary" onClick={handleReset} icon={<RotateCcw className="w-4 h-4" />} className="text-sm px-3 py-1.5 h-9">
              Tạo mới
            </Button>
          </div>
        </div>
      </header>

      {/* ===== BACK TO HOME BUTTON (only when inside a mode) ===== */}
      {appMode !== 'home' && (
        <div className="shrink-0 border-b border-teal-100 bg-white/90 backdrop-blur-sm">
          <div className="max-w-[1600px] mx-auto px-4 py-1.5 flex items-center gap-3">
            <button onClick={() => setAppMode('home')} className="back-home-btn">
              <ArrowLeft className="w-3.5 h-3.5" />
              Trang chủ
            </button>
            <span className="text-xs text-slate-400">|</span>
            <span className="text-sm font-semibold text-slate-700">
              {appMode === 'cv7991' && '🔧 Tạo đề theo CV 7991'}
              {appMode === 'similar' && '📋 Tạo đề tương tự'}
              {appMode === 'variants' && '🔀 Sinh 3 đề biến thể'}
            </span>
          </div>
        </div>
      )}

      {/* Progress — chỉ hiển thị cho mode CV 7991 */}
      {appMode === 'cv7991' && (
        <div className="shrink-0">
          <StepIndicator currentStep={currentStep} setStep={setCurrentStep} completedSteps={completedSteps} />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 relative w-full overflow-hidden">

        {/* Transient Fallback Notice Banner */}
        {fallbackNotice && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-300 text-amber-800 px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2.5 max-w-xl animate-fade-in-up">
            <Sparkles className="w-4 h-4 shrink-0 text-amber-600 animate-spin" />
            <span className="text-sm flex-1 font-medium">{fallbackNotice}</span>
            <button
              onClick={() => setFallbackNotice(null)}
              className="shrink-0 hover:bg-amber-200/60 rounded p-0.5 transition-colors"
              title="Đóng thông báo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ===== HOME LANDING — 3 MODE CARDS ===== */}
        {appMode === 'home' && (
          <div className="absolute inset-0 overflow-y-auto">
            <div className="min-h-full flex flex-col items-center justify-center px-4 py-10 sm:py-16">
              {/* Hero Title */}
              <div className="text-center mb-10 animate-fade-in-up">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-teal-50 border border-teal-200 rounded-full text-sm font-medium text-teal-700 mb-4">
                  <Sparkles className="w-4 h-4" />
                  Powered by Google Gemini AI
                </div>
                <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
                  Chọn chế độ <span className="bg-gradient-to-r from-teal-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">tạo đề thi</span>
                </h1>
                <p className="text-base sm:text-lg text-slate-500 max-w-xl mx-auto">
                  3 công cụ AI mạnh mẽ giúp soạn đề chỉ trong vài phút
                </p>
              </div>

              {/* 3 Mode Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">

                {/* Card 1: CV 7991 — TEAL */}
                <div className="mode-card mode-card-teal card-stagger-1" onClick={() => setAppMode('cv7991')}>
                  <div className="particle" style={{ width: 8, height: 8, background: '#14b8a6', top: '15%', right: '20%', animationDelay: '0s' }} />
                  <div className="particle" style={{ width: 6, height: 6, background: '#0d9488', bottom: '25%', left: '15%', animationDelay: '1.5s' }} />
                  <div className="mode-card-icon">
                    <FileText className="w-7 h-7" />
                  </div>
                  <h3 className="text-xl font-extrabold text-teal-900 mb-2">Tạo đề theo CV 7991</h3>
                  <p className="text-sm text-teal-700/70 mb-5 leading-relaxed">
                    Pipeline 4 bước chuẩn: Nhập liệu → Ma trận → Đặc tả → Đề thi hoàn chỉnh
                  </p>
                  <div className="space-y-1.5 mb-6">
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#0d9488' }} /><span>Upload PPCT tự động nhận diện</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#0d9488' }} /><span>4 dạng câu hỏi chuẩn CV 7991</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#0d9488' }} /><span>Lối tắt nhanh nếu có sẵn Ma trận</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#0d9488' }} /><span>Xuất Word / HTML</span></div>
                  </div>
                  <button className="mode-card-btn" onClick={(e) => { e.stopPropagation(); setAppMode('cv7991'); }}>
                    <Zap className="w-4 h-4" />
                    Bắt đầu
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Card 2: Tạo đề tương tự — BLUE */}
                <div className="mode-card mode-card-blue card-stagger-2" onClick={() => setAppMode('similar')}>
                  <div className="particle" style={{ width: 8, height: 8, background: '#3b82f6', top: '20%', left: '25%', animationDelay: '0.5s' }} />
                  <div className="particle" style={{ width: 6, height: 6, background: '#2563eb', bottom: '15%', right: '20%', animationDelay: '2s' }} />
                  <div className="mode-card-icon">
                    <Copy className="w-7 h-7" />
                  </div>
                  <h3 className="text-xl font-extrabold text-blue-900 mb-2">Tạo đề tương tự</h3>
                  <p className="text-sm text-blue-700/70 mb-5 leading-relaxed">
                    Upload 1 đề mẫu → AI phân tích cấu trúc & sinh đề mới giữ nguyên format
                  </p>
                  <div className="space-y-1.5 mb-6">
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#2563eb' }} /><span>Phân tích ma trận tự động</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#2563eb' }} /><span>Giữ cấu trúc, thay số liệu</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#2563eb' }} /><span>Lời giải chi tiết kèm theo</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#2563eb' }} /><span>Hỗ trợ PDF & ảnh chụp</span></div>
                  </div>
                  <button className="mode-card-btn" onClick={(e) => { e.stopPropagation(); setAppMode('similar'); }}>
                    <Layers className="w-4 h-4" />
                    Bắt đầu
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Card 3: Sinh 3 đề biến thể — PURPLE */}
                <div className="mode-card mode-card-purple card-stagger-3" onClick={() => setAppMode('variants')}>
                  <div className="particle" style={{ width: 8, height: 8, background: '#8b5cf6', top: '10%', right: '15%', animationDelay: '1s' }} />
                  <div className="particle" style={{ width: 6, height: 6, background: '#7c3aed', bottom: '20%', left: '10%', animationDelay: '2.5s' }} />
                  <div className="mode-card-icon">
                    <Shuffle className="w-7 h-7" />
                  </div>
                  <h3 className="text-xl font-extrabold text-purple-900 mb-2">Sinh 3 đề biến thể</h3>
                  <p className="text-sm text-purple-700/70 mb-5 leading-relaxed">
                    Upload 1 đề gốc → AI tự động sinh 3 đề khác nhau kèm đáp án chi tiết
                  </p>
                  <div className="space-y-1.5 mb-6">
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#7c3aed' }} /><span>3 đề biến thể từ 1 gốc</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#7c3aed' }} /><span>Streaming thời gian thực</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#7c3aed' }} /><span>Đáp án chi tiết cho câu khó</span></div>
                    <div className="mode-card-feature"><div className="dot" style={{ background: '#7c3aed' }} /><span>Xuất 1 file Word gộp 3 đề</span></div>
                  </div>
                  <button className="mode-card-btn" onClick={(e) => { e.stopPropagation(); setAppMode('variants'); }}>
                    <Sparkles className="w-4 h-4" />
                    Bắt đầu
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

              </div>

              {/* Login Section on Home Page */}
              {!isAuthenticated && (
                <div className="mt-10 max-w-md w-full animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                  <div className="card-elevated p-6 text-center">
                    <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)' }}>
                      <LogIn className="w-7 h-7 text-white" />
                    </div>
                    <h3 className="text-lg font-bold text-teal-800 mb-1">Đăng nhập tài khoản</h3>
                    <p className="text-sm text-slate-500 mb-4">
                      {trialUsed
                        ? 'Bạn đã hết lượt dùng thử. Đăng nhập để sử dụng không giới hạn.'
                        : 'Đăng nhập ngay hoặc dùng thử 1 lần miễn phí.'}
                    </p>
                    <button
                      onClick={() => setShowLoginModal(true)}
                      className="w-full py-3 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 text-sm hover:shadow-lg"
                      style={{
                        background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                        boxShadow: '0 4px 14px rgba(13, 148, 136, 0.3)',
                      }}
                    >
                      <LogIn className="w-4 h-4" />
                      Đăng nhập
                    </button>
                    <p className="text-xs text-slate-400 mt-3">
                      Liên hệ Zalo <a href="https://zalo.me/0348296773" target="_blank" rel="noopener noreferrer" className="text-blue-500 font-semibold hover:underline">0348296773</a> để mua tài khoản
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== MODE: CV 7991 (Pipeline gốc) ===== */}
        {appMode === 'cv7991' && (
          <>
            {/* Error Toast */}
            {genState.error && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-100 border border-red-200 text-red-700 px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 max-w-xl animate-fade-in-up">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm flex-1">{genState.error}</span>
                <button onClick={() => setGenState(prev => ({ ...prev, error: null }))} className="shrink-0 hover:bg-red-200 rounded p-0.5 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {currentStep === AppStep.INPUT && (
              <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6">
                {renderInputStep()}
              </div>
            )}

            {currentStep === AppStep.MATRIX && (
              <div className="absolute inset-0">
                {renderContentStep(
                  "Ma trận đề thi",
                  genState.matrix,
                  handleGenerateSpecs,
                  "Tiếp theo: Bảng đặc tả",
                  false,
                  (val) => setGenState(prev => ({ ...prev, matrix: val }))
                )}
              </div>
            )}

            {currentStep === AppStep.SPECS && (
              <div className="absolute inset-0">
                {renderContentStep(
                  "Bảng đặc tả",
                  genState.specs,
                  handleGenerateExam,
                  "Tiếp theo: Đề thi",
                  false,
                  (val) => setGenState(prev => ({ ...prev, specs: val }))
                )}
              </div>
            )}

            {currentStep === AppStep.EXAM && (
              <div className="absolute inset-0">
                {renderContentStep(
                  "Đề thi hoàn chỉnh",
                  genState.exam,
                  () => { },
                  "Hoàn tất",
                  true,
                  (val) => setGenState(prev => ({ ...prev, exam: val }))
                )}
              </div>
            )}
          </>
        )}

        {/* ===== MODE: TẠO ĐỀ TƯƠNG TỰ ===== */}
        {appMode === 'similar' && (
          <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6">
            <SimilarExamPage checkAuth={checkAuthOrTrial} />
          </div>
        )}

        {/* ===== MODE: SINH 3 ĐỀ BIẾN THỂ ===== */}
        {appMode === 'variants' && (
          <div className="absolute inset-0 overflow-y-auto p-4 sm:p-6">
            <VariantsExamPage checkAuth={checkAuthOrTrial} />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="shrink-0 text-center py-3 text-xs text-slate-400 border-t border-slate-200/50 space-y-1">
        <p>Tạo Đề Thi Theo CV 7991 © 2026 | Powered by Google Gemini AI</p>
        <p>Mọi tool AI và khóa học tạo app dành cho giáo viên có tại: <a href="https://giaovienai.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-800 underline font-medium">giaovienai.vercel.app</a></p>
      </footer>
    </div>
  );
};

export default App;
