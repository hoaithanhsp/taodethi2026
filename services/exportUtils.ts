import MarkdownIt from 'markdown-it';
// @ts-ignore
import { asBlob } from 'html-docx-js-typescript';

const md = new MarkdownIt({
  html: true,
  breaks: true,
  linkify: true
});

export const exportToDoc = async (markdownContent: string, fileName: string) => {
  // Render markdown to HTML — giữ nguyên $...$ LaTeX không xử lý
  const htmlBody = md.render(markdownContent);

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
