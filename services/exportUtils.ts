import MarkdownIt from 'markdown-it';
// @ts-ignore
import { asBlob } from 'html-docx-js-typescript';

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true
});

// ══════════════════════════════════════════════
// LaTeX → Unicode Math Converter
// Converts LaTeX math expressions to readable
// Unicode text that renders properly in Word.
// ══════════════════════════════════════════════

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  'a': 'ₐ', 'e': 'ₑ', 'i': 'ᵢ', 'n': 'ₙ', 'o': 'ₒ',
  'r': 'ᵣ', 's': 'ₛ', 'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ',
};

function toSuperscript(text: string): string {
  return text.split('').map(c => SUPERSCRIPT_MAP[c] || c).join('');
}

function toSubscript(text: string): string {
  return text.split('').map(c => SUBSCRIPT_MAP[c] || c).join('');
}

function latexToUnicode(latex: string): string {
  let r = latex.trim();

  // ── Cleanup common LaTeX noise ──
  r = r.replace(/\\left\s*/g, '');
  r = r.replace(/\\right\s*/g, '');
  r = r.replace(/\\displaystyle\s*/g, '');
  r = r.replace(/\\,/g, ' ');
  r = r.replace(/\\;/g, ' ');
  r = r.replace(/\\!/g, '');
  r = r.replace(/\\quad/g, '  ');
  r = r.replace(/\\qquad/g, '    ');
  r = r.replace(/\\\s/g, ' ');
  r = r.replace(/\\hspace\{[^}]*\}/g, ' ');

  // ── Greek letters ──
  const greeks: [RegExp, string][] = [
    [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'],
    [/\\delta/g, 'δ'], [/\\epsilon/g, 'ε'], [/\\varepsilon/g, 'ε'],
    [/\\zeta/g, 'ζ'], [/\\eta/g, 'η'], [/\\theta/g, 'θ'],
    [/\\iota/g, 'ι'], [/\\kappa/g, 'κ'], [/\\lambda/g, 'λ'],
    [/\\mu/g, 'μ'], [/\\nu/g, 'ν'], [/\\xi/g, 'ξ'],
    [/\\pi/g, 'π'], [/\\rho/g, 'ρ'], [/\\sigma/g, 'σ'],
    [/\\tau/g, 'τ'], [/\\upsilon/g, 'υ'], [/\\phi/g, 'φ'],
    [/\\varphi/g, 'φ'], [/\\chi/g, 'χ'], [/\\psi/g, 'ψ'],
    [/\\omega/g, 'ω'],
    [/\\Gamma/g, 'Γ'], [/\\Delta/g, 'Δ'], [/\\Theta/g, 'Θ'],
    [/\\Lambda/g, 'Λ'], [/\\Pi/g, 'Π'], [/\\Sigma/g, 'Σ'],
    [/\\Phi/g, 'Φ'], [/\\Psi/g, 'Ψ'], [/\\Omega/g, 'Ω'],
  ];
  for (const [pat, rep] of greeks) r = r.replace(pat, rep);

  // ── Math operators & symbols ──
  const symbols: [RegExp, string][] = [
    [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\div/g, '÷'],
    [/\\pm/g, '±'], [/\\mp/g, '∓'],
    [/\\leq/g, '≤'], [/\\le\b/g, '≤'], [/\\geq/g, '≥'], [/\\ge\b/g, '≥'],
    [/\\neq/g, '≠'], [/\\ne\b/g, '≠'],
    [/\\approx/g, '≈'], [/\\equiv/g, '≡'], [/\\sim/g, '∼'],
    [/\\infty/g, '∞'], [/\\to\b/g, '→'], [/\\gets/g, '←'],
    [/\\rightarrow/g, '→'], [/\\leftarrow/g, '←'],
    [/\\Rightarrow/g, '⇒'], [/\\Leftarrow/g, '⇐'],
    [/\\Leftrightarrow/g, '⇔'], [/\\iff/g, '⇔'],
    [/\\forall/g, '∀'], [/\\exists/g, '∃'],
    [/\\in\b/g, '∈'], [/\\notin/g, '∉'],
    [/\\subset/g, '⊂'], [/\\subseteq/g, '⊆'],
    [/\\supset/g, '⊃'], [/\\supseteq/g, '⊇'],
    [/\\cup/g, '∪'], [/\\cap/g, '∩'],
    [/\\emptyset/g, '∅'], [/\\varnothing/g, '∅'],
    [/\\partial/g, '∂'], [/\\nabla/g, '∇'],
    [/\\angle/g, '∠'], [/\\perp/g, '⊥'], [/\\parallel/g, '∥'],
    [/\\triangle/g, '△'],
    [/\\circ/g, '°'],
    [/\\star/g, '★'], [/\\bullet/g, '•'],
    [/\\ldots/g, '…'], [/\\cdots/g, '⋯'], [/\\vdots/g, '⋮'],
    [/\\dots/g, '…'],
  ];
  for (const [pat, rep] of symbols) r = r.replace(pat, rep);

  // ── Big operators ──
  r = r.replace(/\\int/g, '∫');
  r = r.replace(/\\iint/g, '∬');
  r = r.replace(/\\iiint/g, '∭');
  r = r.replace(/\\oint/g, '∮');
  r = r.replace(/\\sum/g, '∑');
  r = r.replace(/\\prod/g, '∏');
  r = r.replace(/\\lim/g, 'lim');

  // ── Named functions ──
  const funcs = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'deg', 'dim', 'ker', 'gcd'];
  for (const fn of funcs) {
    r = r.replace(new RegExp(`\\\\${fn}\\b`, 'g'), fn);
  }

  // ── \text{...}, \mathrm{...}, \textbf{...}, \mathbf{...} ──
  r = r.replace(/\\text\{([^}]*)\}/g, '$1');
  r = r.replace(/\\textrm\{([^}]*)\}/g, '$1');
  r = r.replace(/\\textbf\{([^}]*)\}/g, '$1');
  r = r.replace(/\\textit\{([^}]*)\}/g, '$1');
  r = r.replace(/\\mathrm\{([^}]*)\}/g, '$1');
  r = r.replace(/\\mathbf\{([^}]*)\}/g, '$1');
  r = r.replace(/\\mathit\{([^}]*)\}/g, '$1');
  r = r.replace(/\\mathbb\{R\}/g, 'ℝ');
  r = r.replace(/\\mathbb\{N\}/g, 'ℕ');
  r = r.replace(/\\mathbb\{Z\}/g, 'ℤ');
  r = r.replace(/\\mathbb\{Q\}/g, 'ℚ');
  r = r.replace(/\\mathbb\{C\}/g, 'ℂ');
  r = r.replace(/\\mathbb\{([^}]*)\}/g, '$1');

  // ── Vectors ──
  r = r.replace(/\\vec\{([^}]*)\}/g, '$1⃗');
  r = r.replace(/\\overrightarrow\{([^}]*)\}/g, '$1⃗');
  r = r.replace(/\\overline\{([^}]*)\}/g, '$1̄');
  r = r.replace(/\\hat\{([^}]*)\}/g, '$1̂');
  r = r.replace(/\\tilde\{([^}]*)\}/g, '$1̃');
  r = r.replace(/\\bar\{([^}]*)\}/g, '$1̄');
  r = r.replace(/\\dot\{([^}]*)\}/g, '$1̇');

  // ── Fractions: \frac{a}{b} → (a)/(b) ──
  // Handle nested fracs by looping
  for (let i = 0; i < 5; i++) {
    r = r.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    r = r.replace(/\\dfrac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    r = r.replace(/\\tfrac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  }

  // ── Square roots ──
  r = r.replace(/\\sqrt\[3\]\{([^{}]*)\}/g, '∛($1)');
  r = r.replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, '√[$1]($2)');
  r = r.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');

  // ── Superscripts: x^{abc} or x^a ──
  r = r.replace(/\^\{([^{}]*)\}/g, (_, content) => toSuperscript(content));
  r = r.replace(/\^(\d)/g, (_, c) => toSuperscript(c));
  r = r.replace(/\^([a-zA-Z])/g, (_, c) => SUPERSCRIPT_MAP[c] || `^${c}`);

  // ── Subscripts: x_{abc} or x_a ──
  r = r.replace(/_\{([^{}]*)\}/g, (_, content) => toSubscript(content));
  r = r.replace(/_(\d)/g, (_, c) => toSubscript(c));
  r = r.replace(/_([a-zA-Z])/g, (_, c) => SUBSCRIPT_MAP[c] || `_${c}`);

  // ── Brackets ──
  r = r.replace(/\\{/g, '{');
  r = r.replace(/\\}/g, '}');
  r = r.replace(/\\lfloor/g, '⌊');
  r = r.replace(/\\rfloor/g, '⌋');
  r = r.replace(/\\lceil/g, '⌈');
  r = r.replace(/\\rceil/g, '⌉');
  r = r.replace(/\\langle/g, '⟨');
  r = r.replace(/\\rangle/g, '⟩');
  r = r.replace(/\\[|]/g, '|');

  // ── Newlines ──
  r = r.replace(/\\\\/g, '\n');

  // ── Remove remaining braces (non-escaped) ──
  r = r.replace(/([^\\])\{/g, '$1');
  r = r.replace(/([^\\])\}/g, '$1');
  r = r.replace(/^\{/, '');
  r = r.replace(/\}$/, '');

  // ── Remove any remaining backslash commands ──
  r = r.replace(/\\[a-zA-Z]+/g, '');

  // ── Clean up whitespace ──
  r = r.replace(/\s+/g, ' ');

  return r.trim();
}

/**
 * Convert LaTeX math in markdown text to Unicode math for Word export.
 * Handles both display math ($$...$$) and inline math ($...$).
 */
function renderLatexForWord(text: string): string {
  // Handle display math $$...$$
  let result = text.replace(/\$\$([\s\S]*?)\$\$/g, (_match, latex) => {
    return latexToUnicode(latex);
  });

  // Handle inline math $...$
  result = result.replace(/(?<!\$)\$(?!\$)((?:[^$\\]|\\.)+?)\$(?!\$)/g, (_match, latex) => {
    return latexToUnicode(latex);
  });

  return result;
}

export const exportToDoc = async (markdownContent: string, fileName: string) => {
  // 1. Pre-process: convert LaTeX to Unicode math
  const processedMarkdown = renderLatexForWord(markdownContent);

  // 2. Render markdown to HTML
  const htmlBody = md.render(processedMarkdown);

  // 3. Build full HTML with professional styling for Word
  const css = `
    <style>
      body { 
        font-family: 'Times New Roman', serif; 
        font-size: 13pt; 
        line-height: 1.5; 
        color: #000;
      }
      h1 { font-size: 16pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt; }
      h2 { font-size: 14pt; font-weight: bold; margin: 10pt 0 4pt; }
      h3 { font-size: 13pt; font-weight: bold; margin: 8pt 0 4pt; }
      h4 { font-size: 13pt; font-weight: bold; font-style: italic; margin: 6pt 0 3pt; }
      p { margin: 0 0 6pt; text-align: justify; }
      table { 
        border-collapse: collapse; 
        width: 100%; 
        margin: 8pt 0; 
      }
      th, td { 
        border: 1px solid #000; 
        padding: 4pt 6pt; 
        text-align: left; 
        font-size: 12pt;
      }
      th { 
        background-color: #f2f2f2; 
        font-weight: bold;
      }
      ol, ul { margin: 4pt 0 8pt 20pt; }
      li { margin-bottom: 3pt; }
      strong { font-weight: bold; }
      em, i { font-style: italic; }
    </style>
  `;

  const fullHtml = `
    <!DOCTYPE html>
    <html lang="vi">
      <head>
        <meta charset="utf-8">
        ${css}
      </head>
      <body>
        ${htmlBody}
      </body>
    </html>
  `;

  try {
    const blob = await asBlob(fullHtml, {
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
    console.error("DOCX generation failed", error);
    alert("Không thể tạo file .docx. Vui lòng thử lại.");
  }
};
