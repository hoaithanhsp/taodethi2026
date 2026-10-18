import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import {
  renderFigureSpecToSvg,
  downloadSvgAsPng,
  sanitizeAndValidateFigureSpec,
  svgToDataUrl,
  svgToPngDataUrl,
  copySvgAsPngToClipboard,
  parseHtmlBbtTableToSpec,
} from '../services/figureEngine';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const FigureImageCard: React.FC<{ svg: string }> = ({ svg }) => {
  const [imgSrc, setImgSrc] = useState<string>(() => svgToDataUrl(svg));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setImgSrc(svgToDataUrl(svg));
    svgToPngDataUrl(svg, 300).then((pngUrl) => {
      if (active && pngUrl) setImgSrc(pngUrl);
    });
    return () => {
      active = false;
    };
  }, [svg]);

  const handleCopy = async () => {
    const ok = await copySvgAsPngToClipboard(svg, 300);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="my-4 p-3 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col items-center">
      <div className="overflow-x-auto max-w-full flex justify-center">
        <img
          src={imgSrc}
          alt="Bảng biến thiên / Hình minh họa"
          className="max-w-full h-auto"
          style={{ maxHeight: '280px' }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
        >
          {copied ? '✓ Đã copy ảnh' : '📋 Copy ảnh'}
        </button>
        <button
          type="button"
          onClick={() => downloadSvgAsPng(svg, 'bang-bien-thien.png')}
          className="text-xs px-2.5 py-1 rounded bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200 transition-colors"
        >
          ⬇ Tải ảnh PNG (300 DPI)
        </button>
      </div>
    </div>
  );
};

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  // Chuyển các thẻ <script class="figure-json">...</script> và <table class="bbt-table"> sang khối ```figure-json
  const normalizedContent = React.useMemo(() => {
    if (!content) return '';
    let withFences = content.replace(
      /<script[^>]*class=["'][^"']*figure-json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi,
      (_m, body) => `\n\`\`\`figure-json\n${String(body).trim()}\n\`\`\`\n`
    );
    withFences = withFences.replace(
      /<table[^>]*class=["'][^"']*bbt-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi,
      (fullTable) => {
        const spec = parseHtmlBbtTableToSpec(fullTable);
        if (spec) {
          return `\n\`\`\`figure-json\n${JSON.stringify({ type: 'bbt', ...spec })}\n\`\`\`\n`;
        }
        return fullTable;
      }
    );
    return withFences.replace(
      /```figure-json\s*([\s\S]*?)```/gi,
      (full, jsonBody, offset) => {
        try {
          const before = withFences.slice(Math.max(0, Number(offset) - 600), Number(offset));
          const parsed = JSON.parse(String(jsonBody).trim());
          const fixed = sanitizeAndValidateFigureSpec(parsed, before);
          if (!fixed) return '';
          return `\`\`\`figure-json\n${JSON.stringify(fixed)}\n\`\`\``;
        } catch {
          return full;
        }
      }
    );
  }, [content]);

  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-([\w-]+)/.exec(codeClassName || '');
            const lang = match ? match[1].toLowerCase() : '';
            const rawText = String(children).trim();

            if (
              lang === 'figure-json' ||
              (lang === 'json' && /"type"\s*:\s*"(bbt|graph|geo2d|geo3d)"/i.test(rawText))
            ) {
              const svg = renderFigureSpecToSvg(rawText, undefined, { showError: true });
              if (svg) {
                return <FigureImageCard svg={svg} />;
              }
            }

            const isLatex = lang === 'latex' || lang === 'tikz';
            return isLatex ? (
              <div className="my-4 bg-slate-900 rounded-lg overflow-hidden border border-slate-700 shadow-sm">
                <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                  <span className="text-xs font-mono text-slate-400">TikZ / LaTeX Code</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(String(children))}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-4 overflow-x-auto text-sm text-slate-300 font-mono">
                  {children}
                </pre>
              </div>
            ) : (
              <code
                className={`${codeClassName || ''} bg-slate-100 px-1 py-0.5 rounded text-sm font-mono text-pink-600`}
                {...props}
              >
                {children}
              </code>
            );
          },
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-4">
              <table {...props} className="min-w-full divide-y divide-gray-200 border">
                {children}
              </table>
            </div>
          ),
          p: ({ children }) => {
            return <p className="mb-4 leading-relaxed">{children}</p>;
          },
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
