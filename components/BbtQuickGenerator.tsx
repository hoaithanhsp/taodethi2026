import React, { useState, useEffect, useMemo } from 'react';
import {
  renderFigureSpecToSvg,
  svgToDataUrl,
  svgToPngDataUrl,
  copySvgAsPngToClipboard,
  downloadSvgAsPng,
  renderFiguresInHtml,
} from '../services/figureEngine';

interface BbtQuickGeneratorProps {
  examContent?: string;
  onUpdateExamContent?: (newContent: string) => void;
  defaultOpen?: boolean;
}

const PRESET_FUNCTIONS = [
  { label: 'Bậc 3: x³ - 3x', fn: 'x^3 - 3*x' },
  { label: 'Bậc 3: -x³ + 3x² - 1', fn: '-x^3 + 3*x^2 - 1' },
  { label: 'Bậc 4: x⁴ - 2x² - 3', fn: 'x^4 - 2*x^2 - 3' },
  { label: 'Phân thức: (2x+1)/(x-1)', fn: '(2*x+1)/(x-1)' },
  { label: 'Phân thức: (x²+x+1)/(x+1)', fn: '(x^2+x+1)/(x+1)' },
];

const BbtQuickGenerator: React.FC<BbtQuickGeneratorProps> = ({
  examContent = '',
  onUpdateExamContent,
  defaultOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [fnInput, setFnInput] = useState('x^3 - 3x');
  const [selectedQuestion, setSelectedQuestion] = useState<string>('1');
  const [pngUrl, setPngUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [insertedMsg, setInsertedMsg] = useState<string | null>(null);

  const svgStr = useMemo(() => {
    if (!fnInput.trim()) return '';
    return renderFigureSpecToSvg({ type: 'bbt', fn: fnInput.trim() });
  }, [fnInput]);

  useEffect(() => {
    let active = true;
    if (!svgStr) {
      setPngUrl('');
      return;
    }
    setPngUrl(svgToDataUrl(svgStr));
    svgToPngDataUrl(svgStr, 300).then((url) => {
      if (active && url) setPngUrl(url);
    });
    return () => {
      active = false;
    };
  }, [svgStr]);

  // Trích xuất danh sách số thứ tự các câu hỏi có trong đề thi hiện tại
  const questionNumbers = useMemo(() => {
    if (!examContent) return ['1', '2', '3', '4', '5'];
    const matches = [...examContent.matchAll(/Câu\s+(\d+)\b/gi)];
    const unique = Array.from(new Set(matches.map((m) => m[1])));
    return unique.length > 0 ? unique : ['1', '2', '3', '4', '5'];
  }, [examContent]);

  useEffect(() => {
    if (questionNumbers.length > 0 && !questionNumbers.includes(selectedQuestion)) {
      setSelectedQuestion(questionNumbers[0]);
    }
  }, [questionNumbers, selectedQuestion]);

  const handleCopyImage = async () => {
    if (!svgStr) return;
    const ok = await copySvgAsPngToClipboard(svgStr, 300);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadPng = async () => {
    if (!svgStr) return;
    const safeName = fnInput.trim().replace(/[^a-zA-Z0-9]+/g, '_') || 'ham_so';
    await downloadSvgAsPng(svgStr, `bbt_${safeName}.png`);
  };

  const handleInsertIntoQuestion = () => {
    if (!svgStr || !onUpdateExamContent || !examContent) return;

    const scriptTag = `<script type="application/json" class="figure-json">{"type":"bbt","fn":${JSON.stringify(
      fnInput.trim()
    )}}</script>`;
    const renderedImgBlock = renderFiguresInHtml(scriptTag);

    const qNum = selectedQuestion;
    let updated = examContent;
    let inserted = false;

    // 1. Tìm thẻ <p> chứa "Câu X." hoặc "Câu X:" trong HTML đề thi
    const htmlQuestionRegex = new RegExp(
      `(<p[^>]*>[\\s\\S]*?Câu\\s+${qNum}\\s*[.:][\\s\\S]*?<\\/p>)`,
      'i'
    );
    if (htmlQuestionRegex.test(updated)) {
      updated = updated.replace(htmlQuestionRegex, `$1\n${renderedImgBlock}`);
      inserted = true;
    } else {
      // 2. Tìm dòng Markdown chứa "**Câu X.**" hoặc "Câu X."
      const mdQuestionRegex = new RegExp(
        `((?:\\*\\*)?Câu\\s+${qNum}\\s*[.:](?:\\*\\*)?[^\\n]*\\n)`,
        'i'
      );
      if (mdQuestionRegex.test(updated)) {
        updated = updated.replace(
          mdQuestionRegex,
          `$1\n\`\`\`figure-json\n{"type":"bbt","fn":${JSON.stringify(fnInput.trim())}}\n\`\`\`\n`
        );
        inserted = true;
      }
    }

    if (!inserted) {
      // Nếu không tìm thấy Câu X, chèn vào cuối nội dung
      updated = `${updated}\n${renderedImgBlock}`;
    }

    onUpdateExamContent(updated);
    setInsertedMsg(`Đã dán ảnh BBT vào Câu ${qNum}!`);
    setTimeout(() => setInsertedMsg(null), 2500);
  };

  return (
    <div className="mb-4 card-elevated p-3.5 flex-shrink-0 border border-teal-200 bg-gradient-to-r from-teal-50/70 via-white to-emerald-50/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-teal-600 text-white font-bold text-xs shadow-sm">
            BBT
          </span>
          <div>
            <span className="text-sm font-bold text-teal-900">
              Công cụ Tạo ảnh Bảng biến thiên (300 DPI) & Dán vào câu hỏi
            </span>
            <span className="hidden sm:inline text-xs text-slate-500 ml-2">
              — Tự tính đạo hàm $y'$, cực trị, tiệm cận chuẩn SGK
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors shadow-sm cursor-pointer"
        >
          {isOpen ? 'Thu gọn ▲' : 'Mở bộ tạo ảnh BBT ▼'}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3 pt-3 border-t border-teal-100 grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Cột điều khiển nhập hàm số & chọn câu hỏi */}
          <div className="lg:col-span-5 space-y-2.5">
            <div>
              <label className="text-xs font-semibold text-teal-800 block mb-1">
                Nhập hàm số $y = f(x)$:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fnInput}
                  onChange={(e) => setFnInput(e.target.value)}
                  placeholder="Ví dụ: x^3 - 3x hoặc (2x+1)/(x-1)"
                  className="flex-1 px-3 py-1.5 text-sm font-mono rounded-lg border border-teal-300 focus:ring-2 focus:ring-teal-500 outline-none bg-white"
                />
              </div>
            </div>

            {/* Các mẫu hàm số nhanh */}
            <div className="flex flex-wrap gap-1.5">
              {PRESET_FUNCTIONS.map((item) => (
                <button
                  key={item.fn}
                  type="button"
                  onClick={() => setFnInput(item.fn)}
                  className="text-[11px] px-2 py-0.5 rounded bg-white hover:bg-teal-50 text-teal-700 border border-teal-200 transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Thao tác Dán vào câu hỏi / Copy / Tải PNG */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onUpdateExamContent && examContent && (
                <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-teal-200">
                  <span className="text-xs font-medium text-slate-600">Chọn:</span>
                  <select
                    value={selectedQuestion}
                    onChange={(e) => setSelectedQuestion(e.target.value)}
                    className="text-xs font-bold text-teal-800 bg-transparent outline-none cursor-pointer"
                  >
                    {questionNumbers.map((num) => (
                      <option key={num} value={num}>
                        Câu {num}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleInsertIntoQuestion}
                    disabled={!svgStr}
                    className="text-xs font-bold px-2.5 py-1 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    📌 Dán ảnh vào Câu {selectedQuestion}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleCopyImage}
                disabled={!svgStr}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors cursor-pointer"
              >
                {copied ? '✓ Đã copy ảnh!' : '📋 Copy ảnh'}
              </button>

              <button
                type="button"
                onClick={handleDownloadPng}
                disabled={!svgStr}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
              >
                ⬇ Tải PNG (300 DPI)
              </button>
            </div>

            {insertedMsg && (
              <p className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200 inline-block">
                ✅ {insertedMsg}
              </p>
            )}
          </div>

          {/* Cột xem trước ảnh Bảng biến thiên */}
          <div className="lg:col-span-7 flex flex-col items-center justify-center bg-white p-3 rounded-xl border border-slate-200 min-h-[150px]">
            {pngUrl ? (
              <>
                <img
                  src={pngUrl}
                  alt={`Bảng biến thiên y = ${fnInput}`}
                  className="max-w-full h-auto"
                  style={{ maxHeight: '210px' }}
                />
                <span className="text-[11px] text-slate-400 mt-1">
                  Chuột phải vào ảnh chọn &quot;Sao chép hình ảnh&quot; hoặc nhấn nút &quot;Dán ảnh vào Câu {selectedQuestion}&quot;
                </span>
              </>
            ) : (
              <span className="text-xs text-red-500">
                Không nhận diện được biểu thức hàm số. Hãy nhập dạng: x^3 - 3x hoặc (2x+1)/(x-1)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BbtQuickGenerator;
