import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const isLatex = match && match[1] === 'latex';
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
              <code className={`${codeClassName || ''} bg-slate-100 px-1 py-0.5 rounded text-sm font-mono text-pink-600`} {...props}>
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
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
