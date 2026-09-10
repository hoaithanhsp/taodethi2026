import MarkdownIt from 'markdown-it';
// @ts-ignore
import { asBlob } from 'html-docx-js-typescript';

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true
});

export const exportToDoc = async (content: string, fileName: string) => {
  let fullHtml = '';

  const bbtCss = `
    .bbt-table { border-collapse: collapse; margin: 12pt auto; border: 1px solid #000; min-width: 420px; }
    .bbt-table td { padding: 4pt 8pt; text-align: center; vertical-align: middle; border: none; }
    .bbt-table .label-col { font-weight: bold; font-style: italic; border-right: 1px solid #000; width: 40pt; }
    .bbt-table .row-border { border-bottom: 1px solid #000; }
    .options { margin-left: 15pt; page-break-inside: avoid; }
    .option-item { margin-bottom: 3pt; }
    .question-number { font-weight: bold; }
  `;

  if (content.includes('<!DOCTYPE html>') || (content.includes('<html') && content.includes('<body'))) {
    fullHtml = content.replace(
      /<\/style>/i,
      `
        table { page-break-inside: auto; border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
        tr { page-break-inside: avoid; page-break-after: auto; }
        td, th { border: 1px solid black; padding: 5px; vertical-align: middle; }
        p { margin-top: 4pt; margin-bottom: 4pt; line-height: 1.4; page-break-inside: avoid; }
        ${bbtCss}
      </style>`
    );
  } else {
    // Render markdown to HTML — giữ nguyên $...$ LaTeX không xử lý
    const htmlBody = md.render(content);

    const css = `
      <style>
        body { 
          font-family: 'Times New Roman', serif; 
          font-size: 13pt; 
          line-height: 1.5; 
          color: #000;
        }
        h1 { font-size: 16pt; font-weight: bold; text-align: center; margin: 12pt 0 6pt; page-break-after: avoid; }
        h2 { font-size: 14pt; font-weight: bold; margin: 10pt 0 4pt; page-break-after: avoid; }
        h3 { font-size: 13pt; font-weight: bold; margin: 8pt 0 4pt; page-break-after: avoid; }
        h4 { font-size: 13pt; font-weight: bold; font-style: italic; margin: 6pt 0 3pt; page-break-after: avoid; }
        p { margin: 0 0 6pt; text-align: justify; page-break-inside: avoid; }
        table { 
          border-collapse: collapse; 
          width: 100%; 
          margin: 8pt 0; 
          page-break-inside: auto;
        }
        tr { page-break-inside: avoid; page-break-after: auto; }
        th, td { 
          border: 1px solid #000; 
          padding: 4pt 6pt; 
          text-align: left; 
          font-size: 12pt;
          vertical-align: middle;
        }
        th { 
          background-color: #f2f2f2; 
          font-weight: bold;
        }
        ol, ul { margin: 4pt 0 8pt 20pt; }
        li { margin-bottom: 3pt; }
        strong { font-weight: bold; }
        em, i { font-style: italic; }
        ${bbtCss}
      </style>
    `;

    fullHtml = `
      <!DOCTYPE html>
      <html lang="vi">
        <head>
          <meta charset="utf-8">
          <title>${fileName}</title>
          ${css}
        </head>
        <body>
          ${htmlBody}
        </body>
      </html>
    `;
  }

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
    console.error("DOCX generation failed, fallback to .doc", error);
    // Fallback sang .doc
    try {
      const fallbackHtml = fullHtml || (content.includes('<!DOCTYPE html>') ? content : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${md.render(content)}</body></html>`);
      const blob = new Blob(['\ufeff', fallbackHtml], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.doc`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (fallbackError) {
      alert("Không thể tạo file Word. Vui lòng thử lại.");
    }
  }
};
