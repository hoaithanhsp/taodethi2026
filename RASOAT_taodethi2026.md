# RÀ SOÁT REPO TAODETHI2026

> Repo: `hoaithanhsp/taodethi2026` — nhánh `main`, commit mới nhất **4abec29** (17/10/2026, "Add files via upload").
> Phạm vi rà soát: 6 commit mới (16–17/10/2026) tính từ commit `380a6fe` (15/10/2026), tập trung vào bảng biến thiên (BBT), hình vẽ 2D/đồ thị, khối tròn xoay/3D.
> Cách kiểm tra: đọc toàn bộ mã liên quan; chạy `npm install`, `npx tsc --noEmit`, `npm run build`; viết script Node chạy thử trực tiếp các engine `bbt.js`, `graph.js`, `geo2d.js`, `geo3d.js` với mathjs của repo.
> Ký hiệu: **[Đã xác minh]** = đã chạy thử và thấy kết quả; **[Đọc code]** = rút ra từ việc đọc mã, chưa chạy trên trình duyệt.
> Lưu ý: repo **không có thư mục `src/`**, toàn bộ mã nằm ở thư mục gốc (`App.tsx`, `components/`, `services/`).

---

## 1. Tổng quan cấu trúc

### Thư mục chính

| Đường dẫn | Vai trò |
|---|---|
| `index.html`, `index.tsx`, `index.css` | Điểm vào. Tailwind và KaTeX CSS nạp qua CDN |
| `App.tsx` | Luồng chính 4 bước (Ma trận → Đặc tả → Đề thi → Xuất Word), đăng nhập, xuất Word |
| `components/` | `BbtQuickGenerator.tsx` (**mới**), `MarkdownRenderer.tsx` (react-markdown + KaTeX + hình), `MarkdownView.tsx` (bộ phân tích Markdown/HTML tự viết + hình), `SimilarExamPage.tsx`, `VariantsExamPage.tsx`, `FileUploadZone.tsx`, `LoginModal.tsx`, `StepIndicator.tsx`, `Button.tsx` |
| `services/` | `geminiService.ts` (prompt + gọi AI), `figureEngine.ts` (**mới, 1007 dòng** – lớp kết nối hình vẽ), `exportUtils.ts`, `mathExportUtils.ts`, `docxMathParser.ts`, `matrixTemplates.ts`, `similarExamService.ts`, `variantsExamService.ts`, `questionBankService.ts` |
| `services/engine/` | **Mới**: `bbt.js` (417 dòng), `graph.js` (248), `geo2d.js` (583), `geo3d.js` (446), `export.js`, `initMath.ts` |
| `public/templates/` | Mẫu ma trận `.docx` (vừa thêm `03_ma_tran.docx`) |
| `dist/` | Bản build **được commit vào git** (mỗi lần upload sinh thêm bundle mới) |
| `data/`, `constants.ts`, `types.ts`, `accounts.ts` | Dữ liệu, hằng số, prompt hệ thống, danh sách tài khoản |

### Công nghệ

- **Framework:** React 19 + TypeScript 5.8.
- **Build tool:** Vite 6 (`@vitejs/plugin-react`), triển khai Vercel (`vercel.json`).
- **AI:** Google Gemini (`@google/genai`), có cơ chế dự phòng nhà cung cấp/model (`callWithFallback`).
- **Hiển thị toán:** KaTeX (rehype-katex/remark-math) trong `MarkdownRenderer`; HTML thô trong `MarkdownView`.
- **Xuất Word:** `html-docx-js-typescript` (HTML → DOCX dạng altChunk) + `markdown-it`.
- **Hình vẽ (mới):** engine SVG tự viết + `mathjs` để phân tích hàm số → SVG → PNG 300 DPI qua `<canvas>`.

**Cách app hoạt động:** người dùng tải ma trận/đặc tả → Gemini sinh đề theo prompt. Prompt bước 3 giờ yêu cầu AI **không tự vẽ** BBT/hình mà chèn khối JSON mô tả hình (`<script type="application/json" class="figure-json">` hoặc khối ```` ```figure-json ````). `figureEngine` đọc JSON, kiểm tra và sửa thông số theo đề bài (`sanitizeAndValidateFigureSpec`), gọi engine tương ứng để tạo SVG, rồi nhúng vào đề dưới dạng `<img>`. Khi xuất Word, ảnh được đổi sang PNG 300 DPI và nhúng base64.

**Kiểm tra build [Đã xác minh]:** `npm install` chạy thành công, `tsc --noEmit` không có lỗi, `npm run build` thành công. Tuy nhiên bundle JS là **2,47 MB (gzip 702 KB)** trong một chunk duy nhất, Vite có cảnh báo vượt ngưỡng 500 KB.

---

## 2. Dependencies hiện tại

### dependencies
| Gói | Phiên bản | Liên quan hình vẽ/toán? |
|---|---|---|
| `@google/genai` | ^1.30.0 | – (gọi AI) |
| `@types/file-saver` | ^2.0.7 | – (nên chuyển sang devDependencies) |
| `file-saver` | ^2.0.5 | Gián tiếp (tải file) |
| `html-docx-js-typescript` | ^0.1.5 | Gián tiếp (xuất Word, nhúng ảnh PNG) |
| `katex` | ^0.16.45 | **Có** – hiển thị công thức |
| `lucide-react` | ^0.555.0 | – (icon) |
| `mammoth` | ^1.12.0 | – (đọc DOCX đầu vào) |
| `markdown-it` | ^14.1.1 | Gián tiếp (Markdown → HTML khi xuất Word) |
| **`mathjs`** | **^15.2.0 (MỚI)** | **Có** – parse biểu thức, đạo hàm ký hiệu, `rationalize` để tìm tiệm cận |
| `react`, `react-dom` | ^19.2.0 | – |
| `react-markdown` | ^10.1.0 | Có (khung hiển thị) |
| `rehype-katex` | ^7.0.1 | **Có** |
| `remark-gfm` | ^4.0.1 | – (bảng Markdown) |
| `remark-math` | ^6.0.0 | **Có** |

### devDependencies
`@types/node ^22.14`, `@vitejs/plugin-react ^5.0`, `typescript ~5.8.2`, `vite ^6.2`.

### Đánh giá
- Gói duy nhất được thêm cho phần hình vẽ là **mathjs**. Mọi thứ khác (vẽ BBT, đồ thị, hình 2D/3D, xuất PNG) đều tự viết bằng SVG thuần → nhẹ, không phụ thuộc thư viện ngoài, in ấn tốt.
- `initMath.ts` chỉ import 6 hàm (`parse, derivative, rationalize, fraction, evaluate, simplify`), nhưng `mathjs` bản đầy đủ vẫn kéo theo phần lớn thư viện. Đây là một trong các lý do bundle phình to.
- Chưa có: thư viện tạo DOCX thật (`docx`), chuyển LaTeX → OMML (công thức Word gốc), sanitize HTML/SVG (`DOMPurify`), giải nghiệm ký hiệu chính xác, test runner. Chi tiết ở mục 7.

---

## 3. Tính năng bảng biến thiên (BBT)

### Code hiện tại làm gì?
**Engine `services/engine/bbt.js`:**
- `normalizeFnExpr`: chuyển LaTeX → cú pháp mathjs (`\frac` lồng ≤ 3 cấp, `\sqrt`, `^{}`, `\ln`→`log`, tự chèn dấu `*` như `3x`→`3*x`).
- `analyzeFunction(fn)`: đạo hàm ký hiệu bằng mathjs; tìm điểm không xác định qua mẫu số trong cây biểu thức; tìm nghiệm y' bằng cách quét đoạn [−25; 25] bước 0,02, kết hợp chia đôi và phát hiện nghiệm kép; lấy dấu y' tại trung điểm mỗi khoảng; tính giới hạn tại ±∞ và hai bên điểm gián đoạn bằng cách thế số (±1e7, p ± 1e−7).
- `niceNumber`: hiển thị số dạng số nguyên, phân số (mẫu ≤ 12) hoặc `a√b`; nếu không được thì ra số thập phân 2 chữ số, dấu phẩy.
- `renderBBT(spec)`: vẽ SVG theo kiểu `tkz-tab` gồm 3 hàng x / y' / y; hai vạch `||` tại điểm không xác định; mũi tên nối giá trị trên/dưới; nhãn ±∞; phân số vẽ dạng tử/mẫu thật.
- `verifyBBT`: so sánh BBT do AI đưa ra với kết quả tự tính (**chưa được gọi ở đâu**).

**Lớp kết nối `services/figureEngine.ts`:**
- Nhận spec BBT ở 2 dạng: `{"type":"bbt","fn":"..."}` (tự tính toàn bộ) hoặc `{"xs","signs","ys"}` (bảng của hàm f(x) tổng quát, có hỗ trợ `pole`).
- Nếu AI không truyền `fn`/`xs`, tự lấy công thức `$y = ...$` / `$f(x) = ...$` từ câu dẫn (bỏ qua khi có tham số `m`).
- `parseHtmlBbtTableToSpec`: tự đổi bảng HTML cũ `<table class="bbt-table">` sang spec rồi vẽ thành ảnh (tương thích ngược với đề tạo bằng prompt cũ).
- Ảnh được bọc thành `<img class="figure-auto-img">`; `upgradeAutoFigureImagesInDom` nâng lên PNG 300 DPI để copy/dán.

**UI `components/BbtQuickGenerator.tsx` (mới):** có ở bước Đề thi (App) và trang Đề tương tự. Người dùng nhập hàm (có 5 mẫu sẵn), xem trước ảnh PNG 300 DPI, Copy ảnh, Tải PNG, **dán vào "Câu X"** (tìm `<p>` chứa "Câu X." trong HTML hoặc dòng Markdown "**Câu X.**").

### Đã cải thiện gì so với bản cũ?
| Bản cũ (≤ 380a6fe) | Bản mới (4abec29) |
|---|---|
| Prompt hướng dẫn AI tự kẻ `<table class="bbt-table">` với mũi tên ký tự ↗ ↘ và quy tắc đếm ô → AI hay kẻ lệch ô, sai dấu, sai giá trị | AI chỉ khai báo JSON; **máy tự tính** đạo hàm, cực trị, giới hạn, tiệm cận đứng |
| Hiển thị phụ thuộc CSS, xuất Word dễ vỡ bảng | Ảnh SVG/PNG 300 DPI chuẩn SGK, hiển thị giống nhau trên web và Word |
| Không có công cụ thủ công | Có `BbtQuickGenerator` để tạo nhanh và dán vào câu hỏi |
| – | Bảng HTML cũ được tự chuyển thành ảnh |

**Kết quả chạy thử [Đã xác minh]** (`analyzeFunction`):
- `x^3-3x` → x: −∞, −1, 1, +∞; y': + 0 − 0 +; y: −∞, 2, −2, +∞ ✅
- `\frac{2x+1}{x-1}` → `||` tại x = 1, y: 2 | −∞ ‖ +∞ | 2 ✅
- `x^4-2x^2` ✅; `x^3-6x` → ±√2, ±4√2 ✅; `(x^2-2x+3)/(x-1)` → ±2√2 ✅

### Còn thiếu gì?
- **Không xử lý tập xác định bị giới hạn [Đã xác minh]:**
  - `sqrt(4-x^2)` → engine vẽ từ −∞ đến +∞, y: −∞ ↗ 2 ↘ −∞ (**sai**, phải là [−2; 2] với y(±2) = 0).
  - `\ln x` → x: −∞..+∞, y: −∞, −∞ (**sai hoàn toàn**).
  - `x\ln x` → bỏ mất miền x > 0.
- **Không đọc được `ln(x)` viết thường [Đã xác minh]:** lỗi `Cannot process function "ln"`, ảnh không hiện. Chỉ `\ln` được chuyển sang `log`.
- **Mất cực trị nằm ngoài [−25; 25] [Đã xác minh]:** `(x-40)^2(x+1)` chỉ ra 1 cực trị (38/3), bỏ mất x = 40 → BBT **sai**.
- **Nghiệm vô tỉ dạng (a ± √b)/c hiển thị thập phân [Đã xác minh]:** `x^3-3x^2-3x` → "−0,41; 2,41" thay vì 1 − √2, 1 + √2; giá trị cực trị "0,66; −10,66". Đề thi chuẩn yêu cầu dạng chính xác.
- **Hàm lượng giác [Đã xác minh]:** `sin(x)` sinh ra 16 mốc trong [−25; 25], bảng không dùng được. Chưa hỗ trợ khảo sát trên một đoạn [a; b] cho trước.
- Không có tham số "đoạn/khoảng xét" (`domain: [a,b]`) để vẽ BBT trên [a; b] (dạng bài tìm GTLN/GTNN rất phổ biến).
- `verifyBBT` có sẵn nhưng chưa dùng để kiểm chứng BBT do AI đưa ra (trường hợp `xs/signs/ys`).
- Không hỗ trợ BBT nhiều dòng (`f'(x)`, `f(x)`, `g(x)`), dòng y' có dấu `||` ở biên miền xác định, hay hàng nhãn LaTeX phức tạp (căn trong phân số, chỉ số dưới).
- Chưa có dạng BBT có tham số m.

---

## 4. Tính năng hình vẽ 2D / đồ thị

### Code hiện tại làm gì?
**`graph.js` – đồ thị hàm số:**
- `analyzeGraph`: dùng `rationalize` tìm tiệm cận đứng (loại điểm khử được), tiệm cận ngang/xiên bằng giá trị lớn, cực trị, giao điểm với các trục.
- `renderGraph`:
  - Nét vẽ: lưới tùy chọn, trục có mũi tên, tiệm cận nét đứt, cắt đường cong tại điểm nhảy.
  - Nhiều hàm trên cùng hình, mỗi hàm một màu và có tên.
  - Điểm: điểm đặc biệt có đường gióng, giao điểm giữa các đồ thị, vạch chia trục chỉ ở giá trị "đẹp".
  - **`shade`**: tô miền giữa `fn` và `fn2` cho bài tích phân/diện tích.
  - **`revolve`**: minh họa khối tròn xoay quanh Ox (tô vùng ±f, vẽ elip thiết diện tại a, (a+b)/2, b, nửa sau nét đứt).

**`geo2d.js` – hình học phẳng (MỚI hoàn toàn, không có trong toolkit cũ):**
- Preset: `parallelogram`, `rectangle`, `square`, `rhombus`, `trapezoid`, `trapezoid-right`, `triangle-right` (vuông tại A/B/C), `triangle-equil`, `triangle-iso`, `triangle` (2 cạnh + góc hoặc 3 cạnh), `circle`, **`navigation`** (bài toán hướng/phương vị tàu thuyền, có la bàn Bắc–Nam, ví dụ N45°E), `custom`.
- Lệnh `extra`: điểm (trung điểm, trọng tâm, tâm, điểm trên đoạn, chân đường vuông góc, tọa độ cực, la bàn), đoạn thẳng (nét đứt, `label=`), vector, đa giác, đường tròn, ký hiệu góc vuông; nhãn cạnh; nhãn đỉnh đẩy ra phía ngoài.

**`figureEngine.ts`:**
- Nếu AI dùng nhầm `geo3d` cho bài phẳng, tự chuyển sang preset `geo2d` phù hợp dựa trên từ khóa trong đề (hình bình hành, chữ nhật, vuông, thoi, thang, các loại tam giác, điều hướng).
- Lọc các điểm/đoạn trong `extra` không xuất hiện trong đề.
- Đọc khoảng cách/góc/hướng từ văn bản tiếng Việt cho bài điều hướng.

### Đã cải thiện gì?
- Trước đây prompt yêu cầu AI viết **TikZ** trong khối ```` ```latex ```` → web chỉ hiện mã nguồn, Word không có hình. Nay AI xuất JSON và được vẽ thành ảnh thật (prompt `similarExamService` / `variantsExamService` đã đổi từ TikZ sang `FIGURE_JSON_MARKDOWN_INSTRUCTIONS`).
- So với `graph.js` trong toolkit: thêm `shade`, `revolve`, nhiều hàm, giao điểm, vạch chia "đẹp" (khoảng 61 dòng khác biệt).
- Có thêm engine hình phẳng `geo2d.js`, kèm cơ chế tự sửa khi AI chọn sai loại hình.

**Chạy thử [Đã xác minh]:** `renderGraph` với `(2*x+1)/(x-1)` và `2x+1` đều ra SVG hợp lệ.

### Còn thiếu gì?
- **`graph.js` không chuẩn hóa LaTeX [Đã xác minh]:** `fn: ["\\frac{2x+1}{x-1}"]` → lỗi `Syntax error in part "\frac..."`, hình biến mất (BBT thì có `normalizeFnExpr`, Graph thì không).
- **Tiệm cận chỉ đúng với hàm hữu tỉ [Đã xác minh]:**
  - `log(x)`, `tan(x)` → `poles: []` (mất tiệm cận đứng x = 0, x = π/2 + kπ).
  - `exp(x)/(1+exp(x))` → `hAsym: null` (hàm có 2 tiệm cận ngang khác nhau y = 0 và y = 1).
  - Cũng hàm này: `xIntercepts` trả về **hàng trăm "nghiệm" giả** từ −30 đến −29,…, do giá trị gần 0 bị coi là nghiệm → hình sẽ vẽ dày đặc điểm sai.
- Chưa có: đồ thị hàm trị tuyệt đối/hàm cho từng khúc, đồ thị y = f'(x) đọc ra tính chất f, đồ thị tham số, bất phương trình/miền nghiệm 2 ẩn, hình Oxy có điểm/vector/đường thẳng/đường tròn theo tọa độ (geo2d dùng thông số hình học, chưa dùng tọa độ).
- `geo2d` dùng thông số mặc định nếu AI không truyền → hình không đúng tỷ lệ đề bài. Chưa có: đường tròn nội/ngoại tiếp, đường phân giác, đánh dấu góc bằng nhau, ký hiệu cạnh bằng nhau.

---

## 5. Tính năng hình khối tròn xoay / 3D

### Code hiện tại làm gì?
**`geo3d.js`:**
- **Phép chiếu:** chiếu song song xiên kiểu SGK (góc 30°, tỉ số 0,5). Khối tròn xoay dùng góc 90°, tỉ số 0,33 để đáy thành elip.
- **Preset đa diện:** `pyramid-tri/square/rect` (đỉnh có thể nằm trên A), `tetra-right`, `prism-tri`, `box`, `cube`, `custom`.
- **Preset khối tròn xoay (MỚI):** `cone`, `cylinder`, `sphere`, `frustum`/`cone-frustum`:
  - nửa sau elip đáy vẽ nét đứt;
  - đường sinh biên tính chính xác tiếp tuyến với elip;
  - đường cao và bán kính vẽ nét đứt, có ký hiệu góc vuông;
  - mặt cầu có đường bao và đường xích đạo (nửa sau nét đứt).
- **Cạnh khuất:** xác định mặt thấy/khuất bằng bao lồi; cạnh khuất vẽ nét đứt **thủ công bằng nhiều đoạn nhỏ**, để khi chuyển PNG/Word vẫn giữ nét đứt.
- **Tùy chọn khác:** `extra` (điểm, đoạn), `faces` tô mặt, trục Oxyz.

**`figureEngine.ts`:** nhận diện ngữ cảnh 3D bằng từ khóa (hình chóp, lăng trụ, nón, trụ, cầu, khối tròn xoay, Oxyz, `S.ABCD`, …). Nếu không phải 3D thì chuyển sang 2D.

### Đã cải thiện gì?
- So với `geo3d.js` trong toolkit: thêm khoảng 160 dòng (≈ 350 dòng khác biệt), chủ yếu là **nón, trụ, cầu, nón cụt**, đường sinh biên, nét đứt thủ công, ký hiệu góc vuông, trục Oxyz.
- `graph.js` có `revolve` minh họa vật thể tròn xoay sinh bởi miền phẳng quay quanh Ox (bài tích phân thể tích).
- **Chạy thử [Đã xác minh]:** `cone`, `cylinder`, `sphere`, `frustum`, `pyramid-square` đều ra SVG.

### Còn thiếu gì?
- **Preset chưa có [Đã xác minh]:** `prism-quad`, `hexagon` → lỗi `Preset không hỗ trợ`, hình biến mất (khi đó `renderFigureSpecToSvg` trả chuỗi rỗng, không báo lỗi).
  - Đa diện: lăng trụ tứ giác/lục giác, chóp cụt, chóp lục giác, bát diện.
  - Tổ hợp: hình nón nội tiếp chóp, mặt cầu ngoại tiếp/nội tiếp.
  - Thiết diện, mặt phẳng cắt.
- **Khối tròn xoay:**
  - Chưa có trục quay vẽ nét chấm gạch.
  - Chưa có nhãn r, h, l tự động trên hình.
  - Chưa có khối tròn xoay rỗng (vành khuyên/washer – quay miền giữa 2 đường).
  - Chưa quay quanh Oy.
  - Chưa có khối ghép (nón + trụ, bán cầu + trụ).
  - Chưa có thiết diện qua trục.
- `revolve` trong `graph.js` chỉ là hình 2D minh họa (elip + vùng tô), chưa phải khối tròn xoay thật.
- Không đổi được góc nhìn (tỉ số 0,33 cố định cho trụ/nón). Nhãn đỉnh đa diện đặt theo hướng từ tâm, có thể đè lên cạnh.
- Oxyz: mới có trục, chưa vẽ được điểm/đường thẳng/mặt phẳng/mặt cầu theo tọa độ.
- `cylinder` dùng `p.h ?? 2.4` trong khi mô tả mặc định là 2.8 (không nhất quán nhỏ) [Đọc code].

---

## 6. Các lỗi / vấn đề phát hiện

### A. Sai kết quả toán học (nghiêm trọng – ảnh hưởng trực tiếp đến đề) [Đã xác minh]
1. BBT sai với hàm có tập xác định giới hạn: `sqrt(4-x^2)`, `\ln x`, `x\ln x`.
2. BBT bỏ sót cực trị ngoài [−25; 25] (ví dụ `(x-40)^2(x+1)`).
3. `ln(x)` (không có dấu `\`) làm engine báo lỗi → ảnh biến mất.
4. Graph không chấp nhận fn dạng LaTeX (`\frac`).
5. Graph tìm tiệm cận sai với hàm không hữu tỉ (ln, tan, mũ). `exp(x)/(1+exp(x))` sinh hàng trăm giao điểm Ox giả.
6. Nghiệm vô tỉ hiển thị thập phân (`-0,41`) thay vì `1-\sqrt{2}`.

### B. Lỗi kỹ thuật / độ bền
7. **Nhãn trong `geo2d` không được escape [Đã xác minh]:**
   - Ví dụ: `segment A C label=x&y` → ký tự `&` được ghi thẳng vào SVG → XML không hợp lệ → `<img src="data:image/svg+xml">` không tải được (hình trắng).
   - Ký tự `<` trong nhãn cũng có thể chèn markup.
   - BBT có hàm `esc`, nhưng geo2d (nhãn cạnh `s.label`, tên điểm) thì không có [Đọc code].
8. **Hình biến mất lặng lẽ:** JSON lỗi cú pháp, preset không hỗ trợ, hoặc lỗi mathjs → `renderFigureSpecToSvg` trả `''`, không có thông báo hay ô "Lỗi hình – bấm để sửa". Riêng trong `MarkdownRenderer`, khi `sanitize` trả `null` thì khối hình bị **xóa hẳn** [Đọc code].
9. **Heuristic regex tiếng Việt dễ sai [Đọc code]:**
   - "mặt phẳng" có trong is3DContext → bài "mặt phẳng tọa độ Oxy" bị coi là 3D.
   - Ngữ cảnh lấy 600 ký tự phía trước nên có thể dính câu hỏi trước.
   - Các phương án "A.", "B." được hiểu là tên điểm.
   - `extractNavigationParamsFromText` lấy 2 số đầu tiên, bất kể ngữ cảnh.
   - Bài phẳng không khớp từ khóa nào → `sanitize` trả `null` → mất hình.
10. **`graph.js` lấy `const M = global.math` ngay lúc nạp module** → phụ thuộc thứ tự import (`initMath` phải chạy trước). Hiện vẫn đúng vì `figureEngine` import `initMath` trước, nhưng dễ vỡ khi refactor. `bbt.js` thì dùng `getMath()` lười nên an toàn [Đọc code].
11. **`extractFiguresToPlaceholders` dùng regex `<svg ...</svg>`** → có thể bắt nhầm SVG không phải hình (ví dụ KaTeX hoặc icon dán vào nội dung) [Đọc code].
12. **`parseHtmlBbtTableToSpec` giả định cấu trúc cố định** (hàng x, y', y): không xử lý `colspan`; ô tiệm cận luôn gán ±∞; nếu chỉ có 1 hàng y thì phải đoán vị trí trên/dưới → bảng HTML cũ chuyển sang có thể sai [Đọc code].
13. **`BbtQuickGenerator` [Đọc code]:**
    - Regex tìm "Câu X" bắt lần xuất hiện **đầu tiên**, có thể nằm trong bảng ma trận/đặc tả chứ không phải câu hỏi.
    - Không tìm thấy thì dán vào **cuối đề** mà không cảnh báo.
    - Chỉ hỗ trợ BBT từ công thức, không nhập được `xs/signs/ys`, đồ thị hay hình học.
14. **`MarkdownRenderer`** trả `<div>` (FigureImageCard) bên trong `<pre>` do react-markdown sinh ra → HTML lồng không hợp lệ, React có thể cảnh báo, CSS của `pre` ảnh hưởng tới thẻ ảnh [Đọc code].
15. **`MarkdownView`** gọi `renderFiguresInHtml` (parse + tính toán + vẽ) mỗi lần render mà không dùng `useMemo` → chậm với đề dài [Đọc code].
16. **Ảnh nhúng dạng data URL base64** ngay trong nội dung đề (Step3 trả về HTML đã chứa ảnh). Nội dung rất nặng; khi lưu state, sửa tay hay gửi lại AI sẽ tốn token/bộ nhớ (*suy luận*).

### C. Xuất Word
17. `html-docx-js` dùng altChunk: **Word desktop** mở được ảnh, nhưng **Google Docs / LibreOffice / Word Online** thường không hiển thị nội dung altChunk (*hạn chế đã biết của thư viện, chưa thử trực tiếp trong lần này*).
18. Công thức vẫn là văn bản/HTML, chưa phải OMML (không sửa được bằng Equation Editor).
19. PNG 300 DPI base64 làm file DOCX phình to.
20. Chuyển SVG → PNG qua canvas dùng font "Times New Roman". Máy không có font này (Linux/Android) sẽ dùng font thay thế → chữ lệch [Đọc code].

### D. Hạ tầng / bảo mật (ngoài phạm vi hình vẽ nhưng vẫn còn)
21. `accounts.ts` vẫn chứa danh sách tài khoản/mật khẩu dạng văn bản thường trong mã client (commit mới chỉ xóa 2 tài khoản). Ai cũng xem được trong bundle.
22. `dist/` được commit vào git, mỗi lần upload thêm bundle mới → repo phình to, dễ deploy nhầm bản cũ.
23. Bundle 2,47 MB một chunk (mathjs, mammoth, katex, genai) → tải chậm trên mạng yếu.
24. Commit chỉ có message "Add files via upload" → khó theo dõi thay đổi.
25. Không có test tự động nào cho engine (đã chứng minh có lỗi toán học ở trên).
26. File thừa ở gốc: `03 Ma trận.docx` (trùng với `public/templates/03_ma_tran.docx`), `nâng cấp.txt`, `LỆNH.md`.

---

## 7. Thư viện cần bổ sung

| Thư viện | Lý do | Cách tích hợp |
|---|---|---|
| **DOMPurify** (`dompurify`) | Toàn app dùng `dangerouslySetInnerHTML` với HTML do AI sinh. Cần làm sạch HTML/SVG, chặn XSS | `npm i dompurify`; bọc `DOMPurify.sanitize(html, {ADD_TAGS:['svg'], ADD_ATTR:['data-figure-svg-b64']})` trong `MarkdownView`, `renderFiguresInHtml` trước khi render |
| **`docx`** (docx.js) | Tạo DOCX "thật" (ImageRun, Table, Paragraph) thay cho altChunk → mở được trên Google Docs/LibreOffice/Word Online, ảnh nhỏ gọn | `npm i docx`; viết `exportDocxNative()` trong `exportUtils.ts`, ảnh lấy từ `svgToPngBlob` (ArrayBuffer) |
| **`mathml2omml`** + MathML từ KaTeX (`katex.renderToString(tex,{output:'mathml'})`) | Công thức Word dạng OMML, sửa được bằng Equation Editor | `npm i mathml2omml`; dùng cùng `docx` (chèn XML OMML) |
| **nerdamer** (+ `nerdamer/Solve`) hoặc **Algebrite** | Giải y' = 0 dạng ký hiệu → nghiệm chính xác `1±√2`, `(−1±√5)/2`, không giới hạn [−25; 25] | `npm i nerdamer`; trong `bbt.js` thử `nerdamer.solve(dy,'x')` trước, nếu thất bại mới dùng quét số; dùng `toTeX()` cho nhãn |
| **canvg** | Render SVG → canvas ổn định (Safari/iOS, font nhúng), không phụ thuộc `<img>` decode data URL | `npm i canvg`; thay phần `Image` trong `export.js`/`svgToPngDataUrl` |
| **Font nhúng** (ví dụ `@fontsource/tinos` hoặc STIX Two) | Thay thế Times New Roman ổn định khi chuyển SVG → PNG trên mọi hệ điều hành | Nhúng `@font-face` base64 vào `<style>` trong SVG hoặc nạp font trước khi vẽ canvas |
| **Vitest** | Test hồi quy cho engine (BBT, giới hạn, tiệm cận, preset) | `npm i -D vitest`; tạo `services/engine/__tests__/*.test.ts` với các ca ở mục 6A |
| *(Tùy chọn)* **mathjs bản rút gọn** (`create` + factories, hoặc `mathjs/number`) | Giảm kích thước bundle | Sửa `initMath.ts`: `import { create, parseDependencies, derivativeDependencies, ... } from 'mathjs'` |
| *(Tùy chọn)* **JSXGraph** / **function-plot** | Xem trước đồ thị tương tác để giáo viên chỉnh xRange/yRange trước khi xuất ảnh | Chỉ dùng trong UI chỉnh sửa; ảnh in vẫn dùng engine SVG hiện tại |
| *(Tùy chọn)* **three.js** | Xem trước 3D xoay được để chọn góc nhìn, sau đó chiếu ra SVG | Chỉ cho chế độ xem trước; không bắt buộc |

> Không khuyến nghị đưa TikZJax vào lại: hướng JSON → SVG hiện tại tốt hơn cho web và Word.

---

## 8. Đề xuất cải thiện tiếp theo

### Ưu tiên cao (sai toán / mất hình)
1. **Hỗ trợ tập xác định trong BBT:**
   - Tự suy miền xác định (căn bậc chẵn ≥ 0, log > 0, mẫu ≠ 0).
   - Thêm trường `domain: [a,b]` / `interval`; mốc đầu/cuối là a, b thay vì ±∞; tính giá trị tại biên.
2. **Mở rộng tìm nghiệm:** giải ký hiệu trước (nerdamer). Nếu quét số thì mở rộng phạm vi theo bậc/hệ số hoặc lấy nghiệm đa thức bằng `math.polynomialRoot`. Riêng hàm lượng giác, bắt buộc có `domain`.
3. **Chuẩn hóa biểu thức dùng chung:** `ln`→`log`, `e^x`, `\left(\right)`, `\cdot`, `√`. Gọi `normalizeFnExpr` cả trong `graph.js`.
4. **Escape toàn bộ nhãn trong geo2d/geo3d/graph** (`& < > "`), tránh SVG hỏng.
5. **Báo lỗi hình thay vì xóa:** khi render thất bại, hiện khung "Không vẽ được hình (lý do…)" kèm JSON để sửa hoặc nút "Tạo lại"; ghi `console.warn`.
6. **Dùng `verifyBBT`** để đối chiếu BBT AI đưa ra (`xs/signs/ys`) với hàm trong đề, cảnh báo nếu lệch.
7. **Sửa tìm tiệm cận cho hàm không hữu tỉ** (giới hạn hai phía, xét riêng ±∞). Lọc nghiệm giả bằng điều kiện đổi dấu thật và |f| < ε tương đối.
8. **Bảo mật:** chuyển xác thực tài khoản sang server (Vercel function), xóa mật khẩu khỏi `accounts.ts`; thêm DOMPurify.

### Ưu tiên trung bình
9. Bổ sung preset 3D:
   - Đa diện: lăng trụ tứ giác/lục giác, chóp cụt, chóp lục giác.
   - Khối tròn xoay: trục quay nét chấm gạch, nhãn r/h/l; khối ghép; vành khuyên (washer); quay quanh Oy.
   - Mặt cầu ngoại tiếp; thiết diện qua trục.
10. Thêm geo2d theo tọa độ Oxy (điểm, vector, đường thẳng, đường tròn), đường tròn nội/ngoại tiếp, ký hiệu góc/cạnh bằng nhau. Graph: hàm từng khúc, trị tuyệt đối, đồ thị f'.
11. Xuất Word bằng `docx` + OMML. Giữ html-docx-js làm phương án dự phòng.
12. Lưu spec JSON trong nội dung (`data-figure-spec`) thay cho data URL to; chỉ render ảnh khi hiển thị/xuất.
13. `BbtQuickGenerator`:
    - Chỉ tìm "Câu X" trong phần đề (bỏ qua bảng ma trận); báo khi không tìm thấy.
    - Thêm chế độ nhập `xs/signs/ys`, đồ thị, hình học.
    - Thêm nút "Sửa hình" khi bấm vào ảnh đã chèn.
14. Thêm Vitest + bộ ca kiểm thử. Bỏ `dist/` khỏi git (để Vercel tự build), thêm `.gitignore`.

### Ưu tiên thấp
15. Tối ưu bundle: mathjs rút gọn; `import()` động cho mammoth/katex/engine; `manualChunks`.
16. Nhúng font cho SVG → PNG; cân nhắc canvg.
17. `useMemo` cho `renderFiguresInHtml` trong `MarkdownView`; sửa lồng `<div>` trong `<pre>` ở `MarkdownRenderer` (override `pre`).
18. Thống nhất mặc định (`cylinder h`), cho chỉnh góc nhìn 3D, đặt nhãn đỉnh tránh đè cạnh.
19. Dọn file thừa ở thư mục gốc, viết message commit rõ ràng, cập nhật README mô tả định dạng `figure-json`.
