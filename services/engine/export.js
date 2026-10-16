/* ==========================================================================
 * EXPORT — SVG → PNG (mặc định 300 dpi) để nhúng vào DOCX (thư viện `docx`: ImageRun)
 *   FigExport.svgToPngBlob(svgEl | svgString, dpi=300) -> Promise<{blob, width, height}>
 *   FigExport.downloadPNG(svgEl, filename)
 * ======================================================================== */
(function (global) {
  function svgToPngBlob(svg, dpi = 300) {
    const str = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
    const w = Number((str.match(/width="([\d.]+)"/) || [])[1] || 400);
    const h = Number((str.match(/height="([\d.]+)"/) || [])[1] || 300);
    const scale = dpi / 96;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale); c.height = Math.round(h * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob((blob) => (blob ? resolve({ blob, width: w, height: h }) : reject(new Error('toBlob thất bại'))), 'image/png');
      };
      img.onerror = () => reject(new Error('Không nạp được SVG'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
    });
  }
  async function downloadPNG(svgEl, filename = 'hinh.png') {
    const { blob } = await svgToPngBlob(svgEl);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  global.FigExport = { svgToPngBlob, downloadPNG };
})(typeof window !== 'undefined' ? window : globalThis);
