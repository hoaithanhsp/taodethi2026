import React, { useEffect, useRef } from 'react';
import {
  renderFiguresInHtml,
  renderFigureSpecToSvg,
  svgToDataUrl,
  upgradeAutoFigureImagesInDom,
} from '../services/figureEngine';

interface Props {
  content: string;
}

const MarkdownView: React.FC<Props> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    upgradeAutoFigureImagesInDom(containerRef.current, 300);
  }, [content]);

  // Helper to detect if a block is pure HTML table
  const isHtmlTable = (text: string) => {
    const trimmed = text.trim();
    return trimmed.startsWith('<table') && trimmed.endsWith('</table>');
  };

  // Helper to detect if text is a Full HTML Document
  const isHtmlDocument = (text: string) => {
    const trimmed = text.trim();
    return trimmed.startsWith('<!DOCTYPE html>') || trimmed.startsWith('<html');
  };

  const renderContent = () => {
    // If the entire content seems to be an HTML table or Full HTML Document (from Gemini), render it directly with auto-generated PNG figures
    if (isHtmlTable(content) || isHtmlDocument(content)) {
      const htmlWithFigures = renderFiguresInHtml(content);
      return (
        <div
          className="overflow-x-auto p-4 bg-white text-black"
          dangerouslySetInnerHTML={{ __html: htmlWithFigures }}
        />
      );
    }

    // Otherwise, parse line by line (simple markdown parser)
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    let codeBlockLanguage = '';
    let htmlBuffer: string[] = [];
    let inHtmlTableBlock = false;

    lines.forEach((line, index) => {
      // 1. Handle HTML Tables embedded in Markdown
      if (line.trim().startsWith('<table')) {
        inHtmlTableBlock = true;
        htmlBuffer.push(line);
        return;
      }
      if (inHtmlTableBlock) {
        htmlBuffer.push(line);
        if (line.trim().endsWith('</table>')) {
          inHtmlTableBlock = false;
          elements.push(
            <div
              key={`table-${index}`}
              className="my-6 overflow-x-auto border border-slate-200 rounded-lg shadow-sm"
            >
              <div dangerouslySetInnerHTML={{ __html: renderFiguresInHtml(htmlBuffer.join('\n')) }} />
            </div>
          );
          htmlBuffer = [];
        }
        return;
      }

      // 2. Handle Code Blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          const rawCode = codeBlockContent.join('\n');
          if (codeBlockLanguage.toLowerCase() === 'figure-json') {
            const precedingCtx = lines.slice(Math.max(0, index - 25), index).join('\n');
            const svg = renderFigureSpecToSvg(rawCode, precedingCtx, { showError: true });
            if (svg) {
              const b64Svg =
                typeof window !== 'undefined' && typeof window.btoa === 'function'
                  ? window.btoa(unescape(encodeURIComponent(svg)))
                  : encodeURIComponent(svg);
              elements.push(
                <div
                  key={`fig-${index}`}
                  className="my-4 flex justify-center overflow-x-auto bg-white p-3 rounded-lg border border-slate-200"
                >
                  <img
                    className="figure-auto-img max-w-full h-auto"
                    src={svgToDataUrl(svg)}
                    data-figure-svg-b64={b64Svg}
                    alt="Bảng biến thiên / Hình minh họa"
                  />
                </div>
              );
            }
            codeBlockContent = [];
            inCodeBlock = false;
            return;
          }
          elements.push(
            <div key={`code-${index}`} className="my-4 bg-slate-900 rounded-lg overflow-hidden shadow-sm">
              <div className="bg-slate-800 px-4 py-1 text-xs text-slate-400 font-mono uppercase tracking-wider border-b border-slate-700">
                {codeBlockLanguage || 'Code'}
              </div>
              <pre className="p-4 text-sm text-teal-300 font-mono overflow-x-auto whitespace-pre">
                {rawCode}
              </pre>
            </div>
          );
          codeBlockContent = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeBlockLanguage = line.replace('```', '').trim();
        }
        return;
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        return;
      }

      // 3. Normal Markdown Rendering
      if (line.startsWith('# ')) {
        elements.push(
          <h1 key={index} className="text-2xl font-bold text-primary mt-6 mb-3 border-b border-teal-100 pb-2">
            {line.replace('# ', '')}
          </h1>
        );
        return;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={index} className="text-xl font-bold text-teal-800 mt-5 mb-2">
            {line.replace('## ', '')}
          </h2>
        );
        return;
      }
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={index} className="text-lg font-semibold text-teal-700 mt-4 mb-2">
            {line.replace('### ', '')}
          </h3>
        );
        return;
      }

      // Legacy Markdown Table Row (fallback)
      if (line.trim().startsWith('|')) {
        elements.push(
          <div
            key={index}
            className="font-mono text-xs sm:text-sm whitespace-pre text-slate-700 bg-white border-b border-slate-200 hover:bg-teal-50 px-1 overflow-x-auto"
          >
            {line}
          </div>
        );
        return;
      }

      if (line.trim() === '') {
        elements.push(<div key={index} className="h-2"></div>);
        return;
      }

      const parts = line.split(/(\*\*.*?\*\*)/g);
      elements.push(
        <div key={index} className="min-h-[1.5em] mb-1 leading-relaxed text-slate-800">
          {parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={i} className="font-bold text-teal-900">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            return <span key={i}>{part}</span>;
          })}
        </div>
      );
    });

    return elements;
  };

  return (
    <div ref={containerRef} className="prose prose-slate max-w-none p-6 bg-white h-full overflow-auto">
      <div className="font-sans text-sm">{renderContent()}</div>
    </div>
  );
};

export default MarkdownView;
