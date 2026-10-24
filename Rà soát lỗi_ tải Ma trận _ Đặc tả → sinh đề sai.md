# Rà soát lỗi: tải Ma trận / Đặc tả → sinh đề sai

**Repo:** `hoaithanhsp/taodethi2026` \(nhánh `main`, commit `b159911`\) **Phạm vi:** luồng *tải file ma trận/đặc tả → đọc số liệu → sinh đề → xuất Word* **Cách làm:** đọc trực tiếp mã nguồn `App.tsx`, `services/docxMathParser.ts`, `services/matrixTemplates.ts`, `services/geminiService.ts`, `constants.ts`, `types.ts`, đối chiếu 3 file mẫu `.docx` trong `public/templates/`.

Ký hiệu dùng trong báo cáo: **\[Đọc mã\]** = kết luận rút ra trực tiếp từ một đoạn mã cụ thể đã đọc; **\[Suy luận\]** = giả thuyết hợp lý chưa chạy thử trên trình duyệt; **\[Chưa kiểm chứng\]** = phần mã nằm ngoài đoạn đọc được, cần thầy xác nhận.

---

## 0. Kết luận trong 60 giây

Lỗi **không nằm ở AI**, mà ở chỗ app *không có một tầng "hiểu" ma trận đúng nghĩa*. Hiện tại app trải qua 4 tầng, và **cả 4 tầng đều có thể bóp méo số liệu**:

1. **Tầng trích xuất** \(`docxMathParser.ts`\) chuyển bảng Word sang HTML bằng regex. Regex này **cắt cụt bảng khi có bảng lồng**, **bỏ qua **<strong>`<w:gridBefore>`</strong> \(ô trống đầu dòng — rất phổ biến trong ma trận\), **nhân đôi số dòng khi Word lặp dòng tiêu đề ở trang 2**, và **không tách được phần Đặc tả** khi tiêu đề viết là "ĐẶC TẢ ĐỀ KIỂM TRA" thay vì "BẢN ĐẶC TẢ".

2. **Tầng đọc số liệu** dựa vào `parseMatrixMetadataAndConfig` — một bộ dò số từ HTML. Khi dò trượt, nó **im lặng** trả về `null`, và app rơi về cấu hình mặc định \(Toán 12: 18 TN + 4 Đ/S…\), tức là **ma trận của thầy bị thay bằng ma trận của app**.

3. **Tầng prompt** \(`constants.ts` + `matrixTemplates.ts`\) lại **áp một chuẩn cứng đè lên file người dùng**: chỉ 3 mức Biết–Hiểu–VD \(cấm cột Vận dụng cao\), mã câu bắt buộc `I./II./III./IV.`, thang điểm bắt buộc 3-2-2-3 hoặc 3-4-3-0, lớp 12 cấm tự luận. Ma trận thật của trường nào khác chuẩn này sẽ bị AI "chuẩn hoá lại" → đặc tả và đề không còn khớp file gốc.

4. **Không có tầng kiểm tra sau khi sinh.** Không ai đếm lại xem đề có đúng 12 câu Dạng I, đúng 3 câu Đúng–Sai × 4 ý, đúng thứ tự phần, đúng đáp án. Sai thì sai luôn, người dùng chỉ phát hiện bằng mắt.

Vì vậy triệu chứng "tải lên nhưng app không phân tích được chính xác, sinh đề lỗi, không đúng định dạng" là **hệ quả tất yếu của kiến trúc**, không phải lỗi ngẫu nhiên. Bản vá gốc gồm 3 việc: *đọc bảng bằng hợp đồng số liệu \(mã câu + vị trí cột\)*, *chuyển chế độ "ma trận người dùng là chuẩn cao nhất"*, *thêm bộ kiểm tra hậu sinh*.

---

## 1. Luồng hiện tại chạy thế nào

```plaintext
Người dùng chọn file
   │
   ├─ .docx/.doc ──► extractDocxTablesAndHtml()          [docxMathParser.ts]
   │                   ├─ JSZip → word/document.xml
   │                   ├─ regex tách <w:tbl> / <w:p>
   │                   ├─ convertWordTableXmlToHtml()  (gridSpan, vMerge)
   │                   ├─ splitMatrixAndSpecsHtml()    (tách Ma trận / Đặc tả)
   │                   └─ hasTable = true  ⇔  đã tìm thấy BẤT KỲ bảng nào
   │
   ├─ .pdf/.ảnh ───► convertMatrixFileToHtml()      [geminiService.ts] ← AI phiên bản hoá bảng
   └─ .doc cũ/RTF ─► parseDocxWithMath() → convertMatrixTextToHtml()   ← AI, cắt text 20.000 ký tự
   │
   ▼
syncConfigFromUploadedMatrix(html)         [App.tsx]
   ├─ parseMatrixMetadataAndConfig(html) → { subject, grade, examType, duration, questionConfig }
   ├─ detectEssayInHtml(html)            → true nếu chuỗi html CÓ CHỨA chữ "tự luận"
   └─ setInputData({ subject: prev.subject || meta.subject || 'Toán học', ... })
   │
   ▼
generateStep2Specs(matrix, effectiveData, ...)   [geminiService.ts] ← prompt có SYSTEM_INSTRUCTION cứng
   ▼
generateStep3Exam(specs, finalQuestionConfig, effectiveData, ..., matrix, isUploadedMatrix)
   ▼
Không có bước kiểm tra số câu / định dạng → xuất Word
```

Điểm mấu chốt: <strong>`questionConfig`</strong>** \(số câu từng dạng × từng mức\) là biến duy nhất quyết định đề có bao nhiêu câu.** Nó được lấy từ `parseMatrixMetadataAndConfig`. Nếu hàm này trả `null` hoặc trả sai, toàn bộ đề sai — dù bảng ma trận hiển thị trên màn hình vẫn đẹp.

---

## 2. Bảng lỗi tổng hợp

| Mã | Lỗi | Tầng | Mức độ | Trạng thái |
| --- | --- | --- | --- | --- |
| **B-01** | `<w:tbl>` lồng trong ô làm regex cắt cụt cả bảng | Trích xuất | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-02** | Bỏ qua `<w:gridBefore>/<w:gridAfter>` → cột bị dồn trái | Trích xuất | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-03** | Dòng tiêu đề lặp ở trang 2 \(`<w:tblHeader>`\) bị tính là dòng dữ liệu → nhân đôi số câu | Trích xuất | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-04** | Không tách được Đặc tả: regex tiêu đề đòi chữ "BẢN/BẢNG ĐẶC TẢ" và không cho phép thẻ con | Trích xuất | 🟠 Cao | \[Đọc mã\] |
| **B-05** | `hasTable = true` với *bất kỳ* bảng nào \(bảng bìa, bảng ghi chú\) → coi là ma trận | Trích xuất | 🟠 Cao | \[Đọc mã\] |
| **B-06** | Đọc số liệu bằng heuristic + **im lặng** trả `null` → rơi về cấu hình mặc định | Hiểu | 🔴 Nghiêm trọng | \[Đọc mã: call site\] / \[Chưa kiểm chứng: thân hàm\] |
| **B-07** | Tự bịa Tự luận `{0,1,1,0}` khi thấy chữ "tự luận" nhưng đọc ra 0 | Hiểu | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-08** | `detectEssayInHtml` khớp cả câu phủ định \("không có tự luận", "Tự luận: Không"\) | Hiểu | 🟠 Cao | \[Đọc mã\] |
| **B-09** | Môn/lớp đã chọn tay luôn thắng ma trận → tải ma trận Hoá 10 vẫn ra đề Toán 12 | Hiểu | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-10** | `SYSTEM_INSTRUCTION` ép 3 mức, cấm VDC, ép thang điểm, ép mã câu → đè lên file người dùng | Prompt | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-11** | `GRADE_NO_ESSAY` bị vô hiệu bằng `void isGradeNoEssay` → lớp 12 có tự luận sinh cột tự luận, trong khi system prompt cấm | Prompt | 🟠 Cao | \[Đọc mã\] |
| **B-12** | AI chuyển PDF/ảnh → HTML với `maxOutputTokens: 16384`, **không kiểm tra **<strong>`finishReason`</strong> → bảng dài bị cắt giữa dòng | Dự phòng | 🔴 Nghiêm trọng | \[Đọc mã\] |
| **B-13** | `convertMatrixTextToHtml` cắt text ở 20.000 ký tự, không cảnh báo | Dự phòng | 🟠 Cao | \[Đọc mã\] |
| **B-14** | Không có validator hậu sinh \(số câu, thứ tự phần, đáp án, định dạng\) | Kiểm soát | 🔴 Nghiêm trọng | \[Đọc mã\] |

---

## 3. Phân tích chi tiết

### 3.1. Nhóm A — Trích xuất DOCX làm hỏng bảng

**B-01. Bảng lồng nhau cắt cụt bảng** \[Đọc mã\] Trong `extractDocxTablesAndHtml`:

```typescript
const blockRegex = /<w:tbl(?=[ >])[^>]*>[\s\S]*?<\/w:tbl>|<w:p(?=[ >])[^>]*>[\s\S]*?<\/w:p>/g;
```

`[\s\S]*?` là *non-greedy*: với một ô chứa bảng con \(`<w:tbl>` bên trong `<w:tc>`\), regex dừng ở `</w:tbl>` **của bảng con**. Toàn bộ các dòng còn lại của bảng cha biến mất — không lỗi, không cảnh báo, chỉ là bảng ngắn hơn thực tế. Ma trận có ô "mã câu" đóng khung bằng bảng con, hoặc bảng đặc tả lồng trong ô "Yêu cầu cần đạt", sẽ bị mất phần đuôi.

**B-02. **<strong>`gridBefore`</strong>** bị bỏ qua** \[Đọc mã\] `convertWordTableXmlToHtml` chỉ đọc `gridSpan` và `vMerge`. Word dùng `<w:gridBefore w:val="2"/>` khi dòng bắt đầu bằng ô trống gộp — nghĩa là "2 cột đầu của dòng này không có `<w:tc>`". Code không bù hai ô trống đó, nên mọi ô của dòng **dịch sang trái 2 cột**: số câu mức "Biết" bị đọc thành mức "Hiểu", mã câu `III.1` rơi vào cột Vận dụng… Đây là dạng lỗi nguy hiểm nhất vì bảng vẫn hiển thị "gần đúng", chỉ lệch cột.

**B-03. Dòng tiêu đề lặp lại** \[Đọc mã\] Ma trận thường dài 2 trang; Word tự lặp 3 dòng tiêu đề ở đầu trang 2 và đánh dấu `<w:trPr><w:tblHeader/></w:trPr>`. Code không đọc `tblHeader`, nên 3 dòng tiêu đề đó thành 3 dòng dữ liệu rỗng. Hệ quả: tổng số dòng tăng, và các heuristic đếm dòng/tính % bị lệch. Nếu file có 4 dòng tiêu đề × 2 trang thì số dòng ảo còn nhiều hơn số dòng thật.

**B-04. Tách Ma trận / Đặc tả quá chặt** \[Đọc mã\]

```typescript
const headingMatch = betweenText.match(/<(?:h[1-4]|p)[^>]*>[^<]*(?:BẢNG|BẢN)\s*ĐẶC\s*TẢ[\s\S]*$/i);
```

Ba điều kiện cùng lúc, mỗi điều kiện đều có thể trượt:

- Tiêu đề phải chứa **"BẢNG ĐẶC TẢ"** hoặc **"BẢN ĐẶC TẢ"**. Thực tế trường học hay viết **"ĐẶC TẢ ĐỀ KIỂM TRA"**, "KHUNG ĐẶC TẢ", "MA TRẬN VÀ ĐẶC TẢ" → trượt hết.

- `[^<]*` **cấm mọi thẻ con**. Nhưng `extractDocxTablesAndHtml` lại sinh `<h2>${html}</h2>` với `html` có thể chứa `<b>` → `<h2><b>BẢN ĐẶC TẢ…</b></h2>` → trượt.

- Chỉ xét đoạn giữa **bảng 1 và bảng 2**. File có bảng bìa/bảng ghi chú ở giữa → trượt.

Khi trượt: `specsHtml = null`, `matrixHtml = fullHtml`. Nghĩa là **tab Ma trận chứa cả bảng đặc tả**, còn tab Đặc tả trống. Bước 2 vì thế nhận vào prompt một "ma trận" thực chất là 2 bảng — AI phải tự đoán bảng nào là ma trận.

**B-05. Bảng nào cũng là ma trận** \[Đọc mã\] `if (tableCount > 0) { ... hasTable: true }`. Một file .docx chỉ có bảng "Thông tin giáo viên – tổ trưởng ký duyệt" cũng được coi là ma trận; app sẽ set `isUploadedMatrix = true` và bỏ qua toàn bộ cấu hình người dùng đã nhập.

### 3.2. Nhóm B — "Hiểu" số liệu bằng cách đoán

**B-06. Điểm mù trung tâm** \[Đọc mã call site\] `syncConfigFromUploadedMatrix` trong `App.tsx`:

```typescript
const meta = parseMatrixMetadataAndConfig(htmlContent);
let nextQuestionConfig = meta.questionConfig ? { ...meta.questionConfig } : { ...prev.questionConfig };
```

Nếu `questionConfig` là `null` — vì bảng bị lệch cột, vì mã câu bị đọc thành số, vì tiêu đề cột khác chuẩn — app **không báo gì**, chỉ giữ `prev.questionConfig`, tức cấu hình mặc định của khối lớp \(lớp 12: 18 TN + 4 Đ/S + 6 TL ngắn\). Người dùng thấy: tải ma trận 12 câu × 3 dạng lên, đề sinh ra 28 câu. Đây gần như chắc chắn là hiện tượng thầy đang gặp.

Điểm thứ hai: hàm này chỉ trả về tổng theo mức \(`biet/hieu/van_dung`\), **không trả về cấu hình cấp độ từng câu Đúng–Sai** \(`dungSaiLevelConfigs`\). Trong khi `types.ts` đã có sẵn cơ chế này và `describeDungSaiLevels()` dùng nó để ra prompt. Nên dù đọc đúng tổng, vị trí ý a/b/c/d vẫn bị mặc định `a,b = Nhận biết; c = Thông hiểu; d = Vận dụng` — ma trận nào chia khác sẽ lệch.

**B-07. Tự bịa Tự luận** \[Đọc mã\]

```typescript
} else {
  const essaySum = nextQuestionConfig.essay.biet + nextQuestionConfig.essay.hieu + ...;
  if (essaySum === 0) {
    nextQuestionConfig = { ...nextQuestionConfig, essay: { biet: 0, hieu: 1, van_dung: 1, van_dung_cao: 0 } };
  }
}
```

Ma trận có cột "Tự luận" nhưng các ô đều là 0/trống → app **tự thêm 2 câu tự luận** không có trong ma trận. Và vì `handleGenerateExam` chỉ reset essay khi `userTotalEssay === 0`, mà ở đây đã thành 2, nên 2 câu bịa này đi thẳng vào đề.

**B-08. Bắt chữ "tự luận" ở mọi ngữ cảnh** \[Đọc mã\] `detectEssayInHtml` chỉ loại trừ 9 cụm cố định \(`'không có tự luận'`, `'tự luận: 0'`…\). Các cách viết phổ biến khác đều lọt: "Tự luận: Không", "Không có phần Tự luận", "Tự luận \(0 câu\)" với khoảng trắng khác, hoặc ghi chú "Đề không gồm tự luận". Ngoài ra `/>\s*iv\s*</i` khớp với **bất kỳ ô nào chỉ chứa chữ "IV"** — ví dụ ô mã câu `IV.1` không khớp, nhưng ô "Phần IV" trong bảng đáp án thì khớp.

**B-09. Môn/lớp: người dùng luôn thắng ma trận** \[Đọc mã\]

```typescript
subject: prev.subject || meta.subject || 'Toán học',
grade: prev.grade || meta.grade || '12',
```

Đây là chủ ý \(có comment "🔴 FIX"\), nhưng hệ quả là: thầy chọn "Toán 12" ở màn hình đầu, rồi tải ma trận **Hoá học 10** → app giữ Toán 12. Từ đó: `getSubjectFootnotes('Toán')` → chú thích năng lực Toán; `GRADE_NO_ESSAY` áp cho 12 → mất tự luận; thang điểm 3-4-3-0 thay vì 3-2-2-3. Đề ra sai môn, sai lớp, sai thang điểm — mà không một dòng cảnh báo. Sửa đúng không phải là đảo thứ tự ưu tiên, mà là **phát hiện xung đột và hỏi**.

### 3.3. Nhóm C — Prompt áp chuẩn cứng đè lên file người dùng

**B-10. **<strong>`SYSTEM_INSTRUCTION`</strong>** xung đột trực tiếp với "giữ nguyên 100% ma trận"** \[Đọc mã\] `constants.ts` quy định:

- "Mỗi dạng câu hỏi **CHỈ CÓ 3 CỘT MỨC ĐỘ: Biết | Hiểu | VD**… **KHÔNG** tạo cột VDC".

- "Mã câu hỏi: Dùng format `I.số`, `II.số`, `III.số`, `IV.số`".

- "Lớp 12: **TUYỆT ĐỐI KHÔNG** có tự luận. Áp dụng thang điểm **3-4-3-0**"; có tự luận thì **3-2-2-3**.

Trong khi `buildSpecsPromptForCustomTemplate` lại ra lệnh: "**BẮT BUỘC GIỮ NGUYÊN 100%** danh sách Chương/Chủ đề… số lượng câu hỏi… mã câu hỏi và điểm số đúng y hệt MA TRẬN ĐẦU VÀO".

Hai mệnh lệnh mâu thuẫn nằm trong **cùng một request**. Với ma trận có 4 mức \(thêm Vận dụng cao\), mã câu kiểu `Câu 1`, `Câu 2`, hay thang điểm 2-3-3-2, AI buộc phải chọn một: hoặc phá ma trận, hoặc phá system prompt. Kết quả là "lúc được lúc không", "đề không đúng định dạng" — đúng như mô tả.

**B-11. **<strong>`GRADE_NO_ESSAY`</strong>** bị vô hiệu** \[Đọc mã\] Trong `matrixTemplates.ts`:

```typescript
const isGradeNoEssay = GRADE_NO_ESSAY.includes(data.grade);
const hasEssay = totalEssayQuestions > 0;
void isGradeNoEssay;   // ← khai báo rồi bỏ
```

Nghĩa là với lớp 12, nếu người dùng \(hoặc bước dò B-07\) đặt tự luận \> 0, prompt **vẫn tạo cột Tự luận** — trong khi system prompt nói lớp 12 tuyệt đối không có. Lại một xung đột nữa ở tầng prompt. `void` ở đây là dấu vết của một lần vá trước đó bị bỏ dở.

### 3.4. Nhóm D — Đường dự phòng im lặng và thiếu kiểm soát

**B-12. AI chuyển PDF/ảnh bị cắt giữa bảng** \[Đọc mã\] `convertMatrixFileToHtml` gửi file gốc cho Gemini với `maxOutputTokens: 16384`. Một ma trận 6 cột × 25 dòng + bảng đặc tả 9 cột × 30 dòng, tính cả rowspan/colspan, thường vượt 16k token HTML. Code chỉ lấy `response.text` và **không kiểm tra **<strong>`finishReason === 'MAX_TOKENS'`</strong> → nhận về một chuỗi HTML cụt giữa `<td>`, không thẻ đóng. Sau đó `convertWordTableXmlToHtml`/`splitMatrixAndSpecsHtml` chạy trên chuỗi hỏng và cho ra bảng "na ná".

Cùng chỗ này còn hai rủi ro: `mimeType: file.type || 'application/octet-stream'` — với `.docx` bị lỗi JSZip, app gửi nguyên bytes docx với MIME của Word, Gemini không nhận dạng được; và prompt chỉ nói "chuyển thành **một** bảng", nên file gộp Ma trận + Đặc tả rất dễ bị gộp thành một bảng.

**B-13. Cắt 20.000 ký tự không báo** \[Đọc mã\]

```typescript
${text.substring(0, 20000)}
```

`convertMatrixTextToHtml` cắt text đã trích xuất mà không kiểm tra độ dài. File gộp Ma trận + Đặc tả thường 25–35k ký tự → phần đặc tả \(nằm sau\) mất sạch, và app lại rơi vào cảnh "đặc tả trống".

**B-14. Không có bước kiểm tra hậu sinh** \[Đọc mã\] `handleGenerateExam` nhận `exam` từ AI, `setGenState({ exam })` và chuyển bước. Không có bước đếm lại số câu, không so với contract, không kiểm tra đáp án, không chuẩn hoá thứ tự phần. Với một hệ sinh nội dung bằng LLM, đây là lỗ hổng lớn nhất về mặt "đúng định dạng": **không có gì bảo đảm định dạng ngoài lời dặn trong prompt.**

---

## 4. Bản vá

Nguyên tắc: **số liệu phải được đọc bằng cấu trúc, không bằng đoán.** Thay vì để AI/ heuristic suy ra "12 câu, 3 câu đúng sai", ta đọc **mã câu** trong chính bảng của thầy và suy ra cấu hình từ *vị trí cột*. Mã câu là dữ liệu có cấu trúc sẵn trong mọi ma trận CV 7991 \(`I.1`, `II.2a`, `III.3`, `IV.1`\), nên nó là nguồn tin cậy nhất.

### P1 — Sửa `convertWordTableXmlToHtml` \(giải B-01, B-02, B-03\)

Thêm bộ trích khối có đếm độ sâu, thay regex non-greedy:

```typescript
// services/docxMathParser.ts
/** Trích các khối <tag>…</tag> cùng cấp, có đếm độ sâu → an toàn với bảng lồng nhau. */
const extractBlocks = (xml: string, tag: string): string[] => {
  const blocks: string[] = [];
  const closeToken = `</${tag}>`;
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  let m: RegExpExecArray | null;
  let minStart = 0;
  while ((m = openRe.exec(xml))) {
    const start = m.index;
    if (start < minStart) continue;
    let depth = 0;
    let pos = start;
    let end = -1;
    while (pos < xml.length) {
      const nextOpen = xml.indexOf(`<${tag}`, pos + 1);
      const nextClose = xml.indexOf(closeToken, pos + 1);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const ch = xml[nextOpen + tag.length];
        if (ch === ' ' || ch === '>' || ch === '/') depth++;
        pos = nextOpen;
        continue;
      }
      if (depth === 0) { end = nextClose + closeToken.length; break; }
      depth--;
      pos = nextClose;
    }
    if (end === -1) break;
    blocks.push(xml.slice(start, end));
    minStart = end;
    openRe.lastIndex = end;
  }
  return blocks;
};
```

Rồi thay `convertWordTableXmlToHtml` bằng bản sau \(giữ nguyên phần render cuối\):

```typescript
const convertWordTableXmlToHtml = (tblXml: string): string => {
  interface ParsedCell {
    html: string; isBold: boolean; isCentered: boolean;
    colspan: number; rowspan: number; vMerge: 'restart' | 'continue' | null; skip: boolean;
  }
  const emptyCell = (): ParsedCell => ({
    html: '', isBold: false, isCentered: false, colspan: 1, rowspan: 1, vMerge: null, skip: false,
  });

  // 0) Số cột chuẩn theo <w:tblGrid>
  const gridMatch = tblXml.match(/<w:tblGrid[^>]*>([\s\S]*?)<\/w:tblGrid>/);
  const gridWidth = gridMatch ? (gridMatch[1].match(/<w:gridCol\b/g) || []).length : 0;

  // 1) Tách bảng lồng ra khỏi cây chính (tránh cắt sai </w:tbl>)
  const innerStart = tblXml.indexOf('>') + 1;
  const inner = tblXml.slice(innerStart, tblXml.lastIndexOf('</w:tbl>'));
  const nestedTables = extractBlocks(inner, 'w:tbl');
  let flat = inner;
  nestedTables.forEach((t, i) => { flat = flat.replace(t, `\u0000NEST${i}\u0000`); });

  const rows: ParsedCell[][] = [];
  const rowIsHeaderRepeat: boolean[] = [];

  for (const trXml of extractBlocks(flat, 'w:tr')) {
    const trPr = (trXml.match(/<w:trPr>([\s\S]*?)<\/w:trPr>/) || ['', ''])[1];
    rowIsHeaderRepeat.push(/<w:tblHeader\b/.test(trPr));  // dòng tiêu đề Word tự lặp ở trang sau
    const gridBefore = parseInt((trPr.match(/<w:gridBefore[^>]*w:val="(\d+)"/) || ['', '0'])[1], 10) || 0;
    const gridAfter  = parseInt((trPr.match(/<w:gridAfter[^>]*w:val="(\d+)"/)  || ['', '0'])[1], 10) || 0;

    const rowCells: ParsedCell[] = [];
    for (let i = 0; i < gridBefore; i++) rowCells.push(emptyCell());

    for (const tcXml of extractBlocks(trXml, 'w:tc')) {
      const tcPr = (tcXml.match(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/) || ['', ''])[1];
      const colspan = Math.max(1, parseInt((tcPr.match(/<w:gridSpan[^>]*w:val="(\d+)"/i) || ['', '1'])[1], 10) || 1);
      const vMergeMatch = tcPr.match(/<w:vMerge(?:\s+[^>]*w:val="([^"]*)")?\s*\/?>/i);
      const vMerge: ParsedCell['vMerge'] = vMergeMatch
        ? (vMergeMatch[1] === 'restart' ? 'restart' : 'continue')
        : null;

      const paras: string[] = [];
      let allBold = true;
      let anyCentered = false;
      for (const p of extractBlocks(tcXml, 'w:p')) {
        const { html, isBold, isCentered } = extractParagraphHtml(p);
        if (html) {
          paras.push(html);
          if (!isBold) allBold = false;
          if (isCentered) anyCentered = true;
        }
      }
      const nest = tcXml.match(/\u0000NEST(\d+)\u0000/);
      if (nest) {
        const nested = nestedTables[Number(nest[1])];
        if (nested) paras.push(convertWordTableXmlToHtml(nested));
      }

      rowCells.push({
        html: paras.join('<br>'), isBold: paras.length > 0 && allBold, isCentered: anyCentered,
        colspan, rowspan: 1, vMerge, skip: false,
      });
    }
    for (let i = 0; i < gridAfter; i++) rowCells.push(emptyCell());
    if (rowCells.length) rows.push(rowCells);
  }

  if (rows.length === 0) return '';

  // 2) Bỏ dòng tiêu đề lặp (so khớp nội dung với dòng đầu)
  const rowSignature = (r: ParsedCell[]) =>
    r.map(c => c.html.replace(/<[^>]+>/g, '').trim()).join('|');
  const firstSignature = rowSignature(rows[0]);
  for (let r = rows.length - 1; r > 0; r--) {
    if (rowIsHeaderRepeat[r] && rowSignature(rows[r]) === firstSignature) {
      rows.splice(r, 1);
      rowIsHeaderRepeat.splice(r, 1);
    }
  }

  // 3) Giải vMerge (giữ nguyên logic cũ)
  const activeOriginByCol = new Map<number, { r: number; cIdx: number }>();
  for (let r = 0; r < rows.length; r++) {
    let colCursor = 0;
    const incremented = new Set<string>();
    for (let cIdx = 0; cIdx < rows[r].length; cIdx++) {
      const cell = rows[r][cIdx];
      if (cell.vMerge === 'restart') {
        for (let k = 0; k < cell.colspan; k++) activeOriginByCol.set(colCursor + k, { r, cIdx });
      } else if (cell.vMerge === 'continue') {
        const origin = activeOriginByCol.get(colCursor);
        if (origin) {
          cell.skip = true;
          const key = `${origin.r}_${origin.cIdx}`;
          if (!incremented.has(key)) {
            rows[origin.r][origin.cIdx].rowspan += 1;
            incremented.add(key);
          }
        } else {
          cell.vMerge = null;
        }
      } else {
        for (let k = 0; k < cell.colspan; k++) activeOriginByCol.delete(colCursor + k);
      }
      colCursor += cell.colspan;
    }
  }

  // 4) Cân cột theo tblGrid (bù ô trống nếu Word lược bỏ)
  if (gridWidth > 0) {
    for (const row of rows) {
      let width = row.reduce((s, c) => s + (c.skip ? 0 : c.colspan), 0);
      while (width < gridWidth) { row.push(emptyCell()); width += 1; }
    }
  }

  // 5) Hàng tiêu đề: ưu tiên <w:tblHeader> (Word khai báo tường minh)
  let headerRowCount = 0;
  while (headerRowCount < rows.length && rowIsHeaderRepeat[headerRowCount]) headerRowCount += 1;

  if (headerRowCount === 0) {
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const rowText = rows[r].map(c => c.html).join(' ').toLowerCase();
      const isHeaderish =
        r === 0 ||
        /(tt|stt|chương|chủ đề|nội dung|đơn vị kiến thức|mức độ|tnkq|nhiều lựa chọn|đúng|trả lời ngắn|tự luận|biết|hiểu|vận dụng|yêu cầu cần đạt|số câu)/i.test(rowText);
      if (!isHeaderish) break;
      const firstCellText = rows[r][0]?.html?.replace(/<[^>]+>/g, '').trim() || '';
      if (r > 0 && /^1\.?$/.test(firstCellText)) break;
      headerRowCount = r + 1;
    }
  }

  // ... phần renderRow / thead / tbody giữ nguyên như cũ
};
```

### P2 — Tách Ma trận / Đặc tả theo *nội dung bảng* \(giải B-04\)

```typescript
const plainText = (s: string) =>
  s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
   .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const looksLikeSpecTable = (tableHtml: string) => {
  const t = plainText(tableHtml);
  return (/yêu\s*cầu\s*cần\s*đạt|mức\s*độ\s*đánh\s*gia/i.test(t)) &&
         (/\bbiết\b/i.test(t) || /\bthông\s*hiểu\b/i.test(t));
};

export const splitMatrixAndSpecsHtml = (fullHtml: string) => {
  const tables = Array.from(fullHtml.matchAll(/<table[\s\S]*?<\/table>/gi));
  if (tables.length < 2) return { matrixHtml: fullHtml, specsHtml: null };

  for (let i = 1; i < tables.length; i++) {
    const prevEnd = (tables[i - 1].index || 0) + tables[i - 1][0].length;
    const start = tables[i].index || 0;
    const between = plainText(fullHtml.slice(prevEnd, start));

    // Chấp nhận "ĐẶC TẢ", "BẢN ĐẶC TẢ", "KHUNG ĐẶC TẢ"; hoặc nhận diện bằng cột
    const headed = /đặc\s*tả/i.test(between);
    if (!headed && !looksLikeSpecTable(tables[i][0])) continue;

    const bodyStartMatch = fullHtml.match(/<body[^>]*>/i);
    const bodyEndMatch = fullHtml.match(/<\/body>/i);
    const bodyStart = bodyStartMatch && bodyStartMatch.index !== undefined
      ? bodyStartMatch.index + bodyStartMatch[0].length : 0;
    const bodyEnd = bodyEndMatch && bodyEndMatch.index !== undefined
      ? bodyEndMatch.index : fullHtml.length;

    const matrixPart = fullHtml.slice(bodyStart, start).trim();
    const specsPart = fullHtml.slice(start, bodyEnd).trim();

    if (matrixPart.includes('<table') && specsPart.includes('<table')) {
      return {
        matrixHtml: wrapMatrixHtmlDocument(matrixPart),
        specsHtml: wrapMatrixHtmlDocument(specsPart),
      };
    }
  }
  return { matrixHtml: fullHtml, specsHtml: null };
};
```

Điểm khác biệt cốt lõi: bỏ ràng buộc "BẢN/BẢNG" và bỏ `[^<]*`, đồng thời có **phương án dự phòng nhận diện theo cột** \(`Yêu cầu cần đạt`\) nên tiêu đề viết kiểu gì cũng tách được.

### P3 — File mới `services/matrixContract.ts`: đọc bảng thành hợp đồng số liệu \(giải B-06, B-07\)

```typescript
/**
 * Đọc Ma trận/Đặc tả thành HỢP ĐỒNG SỐ LIỆU. Nguồn tin cậy là MÃ CÂU (I.1, II.2a…)
 * và VỊ TRÍ CỘT (Biết / Hiểu / Vận dụng / Vận dụng cao) trong chính bảng người dùng tải lên.
 */
import { QuestionConfig, DungSaiLevel, DungSaiLevelConfig } from '../types';

type LevelKey = 'biet' | 'hieu' | 'van_dung' | 'van_dung_cao';
type TypeKey = 'I' | 'II' | 'III' | 'IV';

export interface MatrixContract {
  questionConfig: QuestionConfig | null;
  counts: Record<TypeKey, Record<LevelKey, number>>;
  type2Questions: string[];
  totalCommands: number;
  meta: { subject?: string; grade?: string; examType?: string; duration?: number };
  confidence: number;
  warnings: string[];
}

const stripTags = (s: string) =>
  s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
   .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** HTML table → lưới 2 chiều đã bung rowspan/colspan */
const tableToGrid = (tableHtml: string): string[][] => {
  const grid: string[][] = [];
  const occupied: boolean[][] = [];
  const trs = Array.from(tableHtml.matchAll(/<tr(?=[\s>])[^>]*>([\s\S]*?)<\/tr>/gi));

  trs.forEach((tr, ri) => {
    let col = 0;
    grid[ri] = grid[ri] || [];
    occupied[ri] = occupied[ri] || [];
    const cells = Array.from(tr[1].matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi));
    for (const c of cells) {
      const attrs = c[2];
      const colspan = Math.max(1, parseInt((attrs.match(/colspan\s*=\s*"?(\d+)/i) || ['', '1'])[1], 10) || 1);
      const rowspan = Math.max(1, parseInt((attrs.match(/rowspan\s*=\s*"?(\d+)/i) || ['', '1'])[1], 10) || 1);
      while (occupied[ri]?.[col]) col += 1;
      const text = stripTags(c[3]);
      for (let dr = 0; dr < rowspan; dr++) {
        const rr = ri + dr;
        grid[rr] = grid[rr] || [];
        occupied[rr] = occupied[rr] || [];
        for (let dc = 0; dc < colspan; dc++) {
          occupied[rr][col + dc] = true;
          grid[rr][col + dc] = text;
        }
      }
      col += colspan;
    }
  });
  return grid;
};

const LEVEL_RULES: Array<[LevelKey, RegExp]> = [
  ['van_dung_cao', /vận\s*dụng\s*cao|\bvdc\b/i],
  ['van_dung', /vận\s*dụng|\bvd\b/i],
  ['hieu', /thông\s*hiểu|\bhiểu\b|\bth\b/i],
  ['biet', /nhận\s*biết|\bbiết\b|\bnb\b/i],
];

const TYPE_RULES: Array<[TypeKey, RegExp]> = [
  ['II', /đúng\s*[-–]\s*sai|đúng\s*sai|\bđ\/s\b|\bds\b/i],
  ['III', /trả\s*lời\s*ngắn|\btln\b/i],
  ['IV', /tự\s*luận/i],
  ['I', /nhiều\s*lựa\s*chọn|trắc\s*nghiệm|\btnkq\b/i],
];

const CODE_RE = /(IV|III|II|I)\s*[.．]\s*(\d{1,2})\s*([a-d])?/g;

const toDungSaiLevel = (l: LevelKey): DungSaiLevel =>
  l === 'biet' ? 'nhan_biet' : l === 'hieu' ? 'thong_hieu' : 'van_dung';

export const parseMatrixContract = (html: string): MatrixContract => {
  const warnings: string[] = [];
  const counts: Record<TypeKey, Record<LevelKey, number>> = {
    I: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
    II: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
    III: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
    IV: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 },
  };
  const type2Map = new Map<number, Partial<Record<'a' | 'b' | 'c' | 'd', LevelKey>>>();
  const seenCodes = new Set<string>();

  const tables = Array.from(html.matchAll(/<table[\s\S]*?<\/table>/gi)).map(m => m[0]);
  let dataRowCount = 0;
  let codedRowCount = 0;

  for (const tableHtml of tables) {
    const grid = tableToGrid(tableHtml);
    if (grid.length < 3) continue;

    // Dòng tiêu đề = các dòng đầu có chứa từ khoá mức độ
    let headerEnd = -1;
    for (let r = 0; r < Math.min(6, grid.length); r++) {
      if (grid[r].some(c => LEVEL_RULES.some(([, re]) => re.test(c)))) headerEnd = r;
    }
    if (headerEnd < 0) continue;

    const maxCols = Math.max(...grid.map(r => r.length));

    // Bản đồ cột: (type, level) lấy theo ô sâu nhất của header
    const colMap: Array<{ type: TypeKey; level: LevelKey } | null> = [];
    for (let c = 0; c < maxCols; c++) {
      let level: LevelKey | null = null;
      let type: TypeKey | null = null;
      let excluded = false;
      for (let r = 0; r <= headerEnd; r++) {
        const cell = grid[r]?.[c] || '';
        if (/tổng|%|điểm|ghi\s*chú/i.test(cell)) excluded = true;
        for (const [k, re] of LEVEL_RULES) if (re.test(cell)) { level = k; break; }
        for (const [k, re] of TYPE_RULES) if (re.test(cell)) { type = k; break; }
      }
      colMap[c] = excluded || !level || !type ? null : { type, level };
    }

    for (let r = headerEnd + 1; r < grid.length; r++) {
      const row = grid[r] || [];
      if (!row.some(Boolean)) continue;
      // bỏ dòng tổng / tỉ lệ
      if (/tổng|tỉ\s*lệ|cộng/i.test(row[0] || '')) continue;
      dataRowCount += 1;
      let rowHasCode = false;

      for (let c = 0; c < row.length; c++) {
        const map = colMap[c];
        const cell = row[c] || '';
        if (!map || !cell) continue;

        const codes = Array.from(cell.matchAll(CODE_RE));
        if (codes.length === 0) {
          // dự phòng: ô chỉ chứa một con số
          const num = cell.match(/^\s*(\d{1,3})\s*$/);
          if (num) counts[map.type][map.level] += parseInt(num[1], 10);
          continue;
        }

        for (const m of codes) {
          const type = m[1] as TypeKey;
          const idx = parseInt(m[2], 10);
          const letter = (m[3] || '') as '' | 'a' | 'b' | 'c' | 'd';
          const key = `${type}.${idx}${letter}`;
          if (seenCodes.has(key)) continue;
          seenCodes.add(key);
          rowHasCode = true;

          if (type === 'II' && letter) {
            const entry = type2Map.get(idx) || {};
            entry[letter] = map.level;
            type2Map.set(idx, entry);
          } else {
            counts[type][map.level] += 1;
          }
        }
      }
      if (rowHasCode) codedRowCount += 1;
    }
  }

  const confidence = dataRowCount > 0 ? codedRowCount / dataRowCount : 0;
  if (dataRowCount === 0) warnings.push('Không nhận ra dòng dữ liệu nào trong bảng (thiếu tiêu đề cột Biết/Hiểu/Vận dụng?).');

  // Dựng QuestionConfig
  let questionConfig: QuestionConfig | null = null;
  const type2Ids = Array.from(type2Map.keys()).sort((a, b) => a - b);

  if (seenCodes.size > 0) {
    type2Ids.forEach(idx => {
      const e = type2Map.get(idx)!;
      (['a', 'b', 'c', 'd'] as const).forEach(letter => {
        const lv = e[letter];
        if (!lv) warnings.push(`Câu II.${idx} thiếu mức độ cho ý ${letter}.`);
        else counts.II[lv] += 1;
      });
    });

    const dsConfigs: DungSaiLevelConfig[] = type2Ids.map(idx => {
      const e = type2Map.get(idx)!;
      const pick = (letter: 'a' | 'b' | 'c' | 'd'): DungSaiLevel =>
        toDungSaiLevel(e[letter] || 'biet');
      return { yA: pick('a'), yB: pick('b'), yC: pick('c'), yD: pick('d') };
    });

    questionConfig = {
      type1: { ...counts.I },
      type2: { ...counts.II },
      type3: { ...counts.III },
      essay: { ...counts.IV },
      type2QuestionCount: type2Ids.length,
      dungSaiLevelConfigs: dsConfigs,
    };
  } else {
    warnings.push('Không đọc được mã câu nào — hãy kiểm tra lại cột mức độ trong file.');
  }

  // Metadata (chỉ là gợi ý, không ghi đè lựa chọn của người dùng)
  const plain = stripTags(html);
  const grade = (plain.match(/l[ớo]p\s*(\d{1,2})\b/i) || [])[1];
  const duration = (plain.match(/(\d{2,3})\s*phút/i) || [])[1];
  const examTypeRaw = plain.match(/(giữa|cuối)\s*(?:học\s*)?k[ìi]\s*(1|2|i{1,2})\b/i);
  const examType = examTypeRaw
    ? `${examTypeRaw[1].toLowerCase() === 'giữa' ? 'Giữa' : 'Cuối'} kỳ ${/[2i]/i.test(examTypeRaw[2]) ? '2' : '1'}`
    : undefined;

  const totalCommands =
    Object.values(counts).reduce(
      (s, lv) => s + lv.biet + lv.hieu + lv.van_dung + lv.van_dung_cao, 0);

  return {
    questionConfig,
    counts,
    type2Questions: type2Ids.map(i => `II.${i}`),
    totalCommands,
    meta: {
      grade,
      duration: duration ? parseInt(duration, 10) : undefined,
      examType,
    },
    confidence,
    warnings,
  };
};
```

### P4 — Nối vào `App.tsx`, bỏ đoán mò \(giải B-07, B-08, B-09\)

```typescript
import { parseMatrixContract, MatrixContract } from './services/matrixContract';

const [matrixContract, setMatrixContract] = useState<MatrixContract | null>(null);
const [contractWarnings, setContractWarnings] = useState<string[]>([]);

const applyMatrixContract = (fullHtml: string) => {
  const contract = parseMatrixContract(fullHtml);
  setMatrixContract(contract);
  setContractWarnings(contract.warnings);

  setInputData(prev => {
    const next = { ...prev };
    if (contract.meta.examType) next.examType = contract.meta.examType;
    if (contract.meta.duration) next.duration = contract.meta.duration;

    // Chỉ điền khi người dùng CHƯA chọn — và nếu lệch thì cảnh báo, không im lặng
    if (contract.meta.grade && !prev.grade) next.grade = contract.meta.grade;

    // Điều kiện then chốt: chỉ ghi đè cấu hình khi đọc được mã câu đủ tin cậy
    if (contract.questionConfig && contract.confidence >= 0.6) {
      next.questionConfig = contract.questionConfig;   // KHÔNG còn tự bịa {hieu:1, van_dung:1}
    }
    return next;
  });
};
```

Và một banner để thầy nhìn thấy app đã đọc ra cái gì — đây là thứ hiện đang thiếu hoàn toàn:

```typescript
{matrixContract && (
  <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm">
    <p className="font-semibold text-teal-800">
      Đọc từ file: {matrixContract.totalCommands} lệnh hỏi
      {matrixContract.confidence < 0.6 && ' (độ tin cậy thấp — vui lòng kiểm tra lại)'}
    </p>
    <p className="text-teal-700 mt-1">
      I: {matrixContract.counts.I.biet + matrixContract.counts.I.hieu + matrixContract.counts.I.van_dung + matrixContract.counts.I.van_dung_cao} câu
      {' · '}II: {matrixContract.type2Questions.length} câu
      {' · '}III: {matrixContract.counts.III.biet + matrixContract.counts.III.hieu + matrixContract.counts.III.van_dung + matrixContract.counts.III.van_dung_cao} câu
      {' · '}TL: {matrixContract.counts.IV.biet + matrixContract.counts.IV.hieu + matrixContract.counts.IV.van_dung + matrixContract.counts.IV.van_dung_cao} câu
    </p>
    {contractWarnings.length > 0 && (
      <ul className="mt-2 list-disc pl-5 text-amber-700">
        {contractWarnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    )}
  </div>
)}
```

Ba thay đổi hành vi quan trọng:

1. **Không đoán tự luận nữa.** Tự luận chỉ tồn tại nếu ma trận có mã `IV.k` \(hoặc cột Tự luận có số\), hoặc người dùng tự nhập.

2. **Xoá **<strong>`detectEssayInHtml`</strong>** khỏi đường quyết định.** Hàm này có thể giữ lại cho mục đích hiển thị, nhưng không được dùng để set cấu hình.

3. **Xung đột môn/lớp phải hiện ra.** Nếu `prev.subject` đã có và `contract.meta.subject` khác, hiện hộp thoại: *"File ghi môn Hoá học lớp 10, màn hình đang chọn Toán lớp 12. Dùng theo file hay giữ lựa chọn?"* — thay vì im lặng chọn một bên.

### P5 — Chế độ "ma trận người dùng là chuẩn cao nhất" \(giải B-10, B-11\)

Thêm vào `matrixTemplates.ts` / `geminiService.ts` một khối override, chèn **sau** `SYSTEM_INSTRUCTION` và **trước** dữ liệu:

```typescript
export const buildUploadedMatrixOverride = (contract: MatrixContract): string => `
===== CHẾ ĐỘ ĐẶC BIỆT: NGƯỜI DÙNG ĐÃ TẢI MA TRẬN LÊN =====
Ma trận đính kèm là CHUẨN CAO NHẤT. Mọi quy tắc mặc định ở phần trên bị VÔ HIỆU khi mâu thuẫn:

1. SỐ CỘT VÀ TÊN CỘT: giữ y hệt file. Nếu file có cột "Vận dụng cao" thì GIỮ RIÊNG cột đó
   (không gộp vào "Vận dụng"). Nếu file dùng tên khác (NB/TH/VD/VDC) thì giữ nguyên tên đó.
2. MÃ CÂU: giữ y hệt file. KHÔNG đổi sang I./II./III./IV. nếu file dùng cách khác.
3. THANG ĐIỂM VÀ %: lấy theo file. KHÔNG áp 3-2-2-3 hay 3-4-3-0 nếu file ghi khác.
4. TỰ LUẬN: chỉ tồn tại nếu file có. Lớp 12 vẫn được có tự luận nếu file có tự luận.
5. SỐ LIỆU ĐÃ ĐỌC ĐƯỢC TỪ FILE (không được thay đổi):
   - Dạng I: ${contract.counts.I.biet} Biết / ${contract.counts.I.hieu} Hiểu / ${contract.counts.I.van_dung} Vận dụng
   - Dạng II: ${contract.type2Questions.length} câu × 4 ý
   - Dạng III: ${contract.counts.III.biet} / ${contract.counts.III.hieu} / ${contract.counts.III.van_dung}
   - Tự luận: ${contract.counts.IV.biet + contract.counts.IV.hieu + contract.counts.IV.van_dung}
6. Nếu có mâu thuẫn không thể giải quyết, ƯU TIÊN FILE và ghi rõ cảnh báo trong một khối
   <!-- CONTRACT_MISMATCH: ... --> ở cuối output.
`;
```

Kèm theo, trong `constants.ts` nên tham số hoá `SYSTEM_INSTRUCTION`. Cách rẻ nhất là thêm tham số thứ hai:

```typescript
export const buildSystemInstruction = (opts: { respectUserMatrix?: boolean } = {}) => {
  if (!opts.respectUserMatrix) return SYSTEM_INSTRUCTION;
  return SYSTEM_INSTRUCTION + `
# GHI ĐÈ (ưu tiên tuyệt đối)
Khi có "CHẾ ĐỘ ĐẶC BIỆT: NGƯỜI DÙNG ĐÃ TẢI MA TRẬN LÊN", mọi quy tắc về số cột mức độ,
mã câu, thang điểm và tự luận ở trên đều bị vô hiệu. Bám 100% file người dùng.
`;
};
```

Đồng thời sửa `void isGradeNoEssay` → dùng thật:

```typescript
const isGradeNoEssay = GRADE_NO_ESSAY.includes(data.grade);
const userWantsEssay = totalEssayQuestions > 0;
// Lớp 12 mặc định không tự luận, NHƯNG nếu đang ở chế độ ma trận tải lên thì tôn trọng file
const hasEssay = isUploadedMatrix ? userWantsEssay : (userWantsEssay && !isGradeNoEssay);
```

### P6 — Validator hậu sinh \(giải B-14\)

Đây là phần "chống sai định dạng" thực sự, vì prompt chỉ là lời khuyên còn code mới là ràng buộc.

```typescript
// services/examValidator.ts
export interface ExamIssue { code: string; message: string }

export const validateExam = (
  examHtml: string,
  contract: MatrixContract,
  specHtml: string,
): ExamIssue[] => {
  const issues: ExamIssue[] = [];
  const plain = examHtml.replace(/<[^>]+>/g, ' ');

  const expect = {
    I: contract.counts.I.biet + contract.counts.I.hieu + contract.counts.I.van_dung + contract.counts.I.van_dung_cao,
    II: contract.type2Questions.length,
    III: contract.counts.III.biet + contract.counts.III.hieu + contract.counts.III.van_dung + contract.counts.III.van_dung_cao,
    IV: contract.counts.IV.biet + contract.counts.IV.hieu + contract.counts.IV.van_dung + contract.counts.IV.van_dung_cao,
  };

  const codes = Array.from(plain.matchAll(/(IV|III|II|I)\s*[.．]\s*(\d{1,2})/g))
    .map(m => `${m[1]}.${m[2]}`);
  const unique = new Set(codes);

  (['I', 'II', 'III', 'IV'] as const).forEach(type => {
    const found = Array.from(unique).filter(c => c.startsWith(`${type}.`));
    if (found.length !== expect[type]) {
      issues.push({
        code: `COUNT_${type}`,
        message: `Dạng ${type}: cần ${expect[type]} câu, đề có ${found.length} câu.`,
      });
    }
    // kiểm tra đánh số liên tục 1..n
    const nums = found.map(c => parseInt(c.split('.')[1], 10)).sort((a, b) => a - b);
    nums.forEach((n, i) => {
      if (n !== i + 1) issues.push({
        code: `SEQ_${type}`,
        message: `Dạng ${type}: đánh số không liên tục (thiếu ${i + 1}).`,
      });
    });
  });

  // Dạng I phải có đủ 4 phương án mỗi câu
  const blocks = examHtml.split(/Câu\s+(?:IV|III|II|I)\s*[.．]\s*\d+/i).slice(1);
  blocks.forEach((b, i) => {
    const opts = (b.match(/(?:^|[\s>(])([A-D])\s*[.)]/g) || []).length;
    if (i < expect.I && opts > 0 && opts !== 4) {
      issues.push({ code: 'OPTS', message: `Câu Dạng I thứ ${i + 1} có ${opts} phương án (cần 4).` });
    }
  });

  if (!/đáp\s*án|answer/i.test(plain)) {
    issues.push({ code: 'NO_KEY', message: 'Thiếu bảng đáp án.' });
  }

  return issues;
};
```

Dùng trong `handleGenerateExam`:

```typescript
let exam = await generateStep3Exam(...);
let issues = matrixContract ? validateExam(exam, matrixContract, genState.specs) : [];

if (issues.length > 0 && matrixContract) {
  // một lần tự sửa, có mục tiêu cụ thể
  exam = await generateStep3Exam(
    `${genState.specs}\n\n===== BẢN NHÁP TRƯỚC CÓ LỖI, PHẢI SỬA =====\n${issues.map(i => `- ${i.message}`).join('\n')}`,
    finalQuestionConfig, effectiveData, ..., exam
  );
  issues = validateExam(exam, matrixContract, genState.specs);
}
if (issues.length > 0) {
  setGenState(prev => ({ ...prev, exam, warning: issues.map(i => i.message).join('\n') }));
}
```

### P7 — Đường dự phòng: báo lỗi thay vì im lặng \(giải B-05, B-12, B-13\)

```typescript
// 1) B-12: kiểm tra bị cắt do hết token
const response = await ai.models.generateContent({ /* ... */ });
const finish = response.candidates?.[0]?.finishReason;
const text = response.text || '';
if (finish === 'MAX_TOKENS') {
  throw new Error(
    'Bảng quá dài nên AI chỉ chuyển được một phần. Thầy hãy: (a) lưu file thành .docx và tải lại, ' +
    'hoặc (b) tách riêng Ma trận và Đặc tả thành 2 file.'
  );
}

// 2) B-12: chặn gửi .docx/.doc qua inlineData
const DOC_MIME = /wordprocessingml|msword|octet-stream/;
if (DOC_MIME.test(file.type) || /\.docx?$/i.test(file.name)) {
  throw new Error('File Word cần được đọc trực tiếp (.docx hợp lệ). Nếu file là .doc cũ, hãy "Save As" sang .docx.');
}

// 3) B-13: không cắt text âm thầm
if (text.length > 20000) {
  console.warn(`[MatrixUpload] Text ${text.length} ký tự, tiến hành chuyển theo từng phần.`);
  // chia theo bảng: cắt tại các mốc "BẢNG ĐẶC TẢ" / "MA TRẬN" rồi chuyển từng phần
}

// 4) B-05: xác thực bảng có đúng là ma trận sau khi trích xuất
const looksLikeMatrix = (html: string) =>
  /mức\s*độ/i.test(html) && /(biết|hiểu|vận\s*dụng)/i.test(html) &&
  /(nội\s*dung|đơn\s*vị\s*kiến\s*thức|chương|chủ\s*đề)/i.test(html);

if (directTable.hasTable && !looksLikeMatrix(directTable.fullHtml)) {
  setGenState(prev => ({ ...prev, error:
    'File này có bảng nhưng không giống ma trận đề (thiếu cột Mức độ / Nội dung). ' +
    'Vui lòng kiểm tra lại hoặc dùng mẫu trong /templates.' }));
  return false;
}
```

---

## 5. Kiểm thử hồi quy

Ba file mẫu đã có trong repo \(`01 MA TRẬN ĐẶC TẢ.docx`, `02 MA TRẬN ĐẶC TẢ.docx`, `03 Ma trận.docx`\) đủ để làm bộ test tối thiểu. Với mỗi file, ghi lại **kỳ vọng cứng** rồi so:

| # | Ca kiểm thử | Kỳ vọng |
| --- | --- | --- |
| 1 | `01_ma_tran_dac_ta.docx` | Tách được **2 bảng**; tab Đặc tả có cột "Yêu cầu cần đạt"; tổng lệnh hỏi của 2 bảng bằng nhau |
| 2 | `03_ma_tran.docx` | 1 bảng, 3 dòng header, cột `TT/Chương/Nội dung/Mức độ/Tổng/%`; không sinh Đặc tả giả |
| 3 | Ma trận 4 mức \(có VDC\) | Cột VDC **được giữ riêng**, không bị gộp vào Vận dụng |
| 4 | Ma trận mã câu kiểu `Câu 1, Câu 2` | App cảnh báo "không đọc được mã câu", **không** ghi đè cấu hình |
| 5 | Ma trận trống cột Tự luận nhưng có chữ "Tự luận" | Không sinh câu tự luận nào |
| 6 | File .doc cũ \(OLE2\) | Báo lỗi rõ ràng, không ra đề rác |
| 7 | PDF ma trận 30 dòng | Không bị cắt giữa bảng; nếu cắt → báo lỗi MAX_TOKENS |
| 8 | Ma trận 2 trang \(header lặp\) | Số dòng = số dòng thật, không nhân đôi |
| 9 | Dòng có 2 ô trống đầu \(gridBefore\) | Cột không bị dồn trái, mã câu nằm đúng cột mức độ |
| 10 | Chọn "Toán 12" rồi tải ma trận "Hoá 10" | Hiện cảnh báo xung đột, không im lặng |

Cách chạy nhanh \(không cần UI\): tạo `tests/matrixContract.test.mjs` đọc file `.docx` → `extractDocxTablesAndHtml` → `parseMatrixContract` → in ra `counts` và `totalCommands`, đối chiếu với số đếm tay. Repo đã có `tests/_load.mjs` và hai file test mẫu \(`cv7991.test.mjs`, `engines.test.mjs`\) làm khuôn.

---

## 6. Thứ tự triển khai

| Bước | Việc | Vá lỗi | Công |
| --- | --- | --- | --- |
| 1 | `extractBlocks` + sửa `convertWordTableXmlToHtml` | B-01, B-02, B-03 | 3–4 h |
| 2 | `splitMatrixAndSpecsHtml` mới | B-04 | 1 h |
| 3 | `matrixContract.ts` + banner "Đọc từ file" | B-06, B-07, B-08 | 5–6 h |
| 4 | Bỏ `detectEssayInHtml` khỏi đường quyết định, xử lý xung đột môn/lớp | B-07, B-08, B-09 | 2 h |
| 5 | Khối override "ma trận là chuẩn" + sửa `void isGradeNoEssay` | B-10, B-11 | 2–3 h |
| 6 | `examValidator.ts` + 1 lần tự sửa | B-14 | 4 h |
| 7 | Chặn `.doc`, kiểm `finishReason`, bỏ cắt 20k, `looksLikeMatrix` | B-05, B-12, B-13 | 2 h |
| 8 | Bộ test hồi quy 10 ca | — | 3 h |

Ước lượng: **\~22 giờ công**, chia được thành 3 đợt. Nếu chỉ có 1 ngày, làm bước 1 + 3 + 7 — đó là ba chỗ giải quyết khoảng 80% triệu chứng.

---

## 7. Hai ghi chú ngoài phạm vi \(nên xử lý sớm\)

**Xuất Word.** `nâng cấp.txt` trong repo đã ghi nhận lỗi "đề dồn thành một dòng" do nhét Markdown thô vào `<body>`. File `services/exportUtils.ts` đã có sẵn `markdown-it` với `breaks: true` nhưng `App.tsx` không dùng — cần xác nhận lại `handleDownloadWord` hiện tại đã chuyển sang nhánh render Markdown chưa **\[Chưa kiểm chứng\]**.

**Bảo mật.** `data/accounts.ts` vẫn chứa tài khoản/mật khẩu dạng văn bản thường trong bundle client; `dist/` được commit vào git nên mỗi lần upload sinh thêm bundle, dễ deploy nhầm bản cũ. Hai việc này không liên quan đến lỗi parse nhưng ảnh hưởng trực tiếp đến việc thầy có tin được bản đang chạy hay không.

---

## 8. Tóm lại

App hiện **không sai ở chỗ "AI kém"**, mà sai ở chỗ *không có hợp đồng dữ liệu*. Bảng được chuyển thành HTML bằng regex dễ vỡ, số liệu được đoán bằng heuristic im lặng, cấu hình bị ép về chuẩn của app, và không có bước nào kiểm tra lại kết quả. Ba việc — **đọc mã câu theo cột**, **tuyên bố ma trận người dùng là chuẩn**, **kiểm tra hậu sinh** — sẽ biến luồng này từ "hy vọng AI làm đúng" thành "máy đảm bảo đúng".