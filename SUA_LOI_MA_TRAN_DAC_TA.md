# Sửa lỗi: tải Ma trận / Đặc tả → sinh đề

Đối chiếu với `Rà soát lỗi_ tải Ma trận _ Đặc tả → sinh đề sai.md` (mã B-xx) và `lỗi.txt` (mục #n).

## Kết quả đọc 3 file mẫu (chạy thật, không qua AI)

| File | Môn / Lớp / Kỳ | Kiểu ghi | Đọc được | Điểm |
|---|---|---|---|---|
| 01 MA TRẬN ĐẶC TẢ | Địa lí · 11 · Cuối kỳ 1 | số lượng | I 12 câu · II 2 câu (8 ý) · III 4 · TL 2 | 3 – 2 – 2 – 3 |
| 02 MA TRẬN ĐẶC TẢ | Toán học · 10 · Giữa kỳ 2 | "Câu 1, 2", "Câu 1a, 1b" | I 12 · II 2 (8 ý) · III 4 · TL 3 câu / 4 lệnh hỏi | 3 – 2 – 2 – 3 |
| 03 Ma trận | Lịch sử · 7 · Giữa kỳ 1 | I.1, II.1a, IV.1 | I 6 · II 2 (8 ý) · TL 2 (không có Phần III) | 1,5 – 2 – 6,5 |

Tất cả khớp dòng "Tổng số câu" của file. Trước khi sửa: không nhận ra môn Địa lí và Lịch sử (lỗi `\b` với chữ có dấu), dòng `B | H | VD` của bảng đặc tả 01 bị coi là dữ liệu.

Phát hiện thêm: **trong file 02, Bản đặc tả không khớp Ma trận** (Dạng I: đặc tả 5/6/1, ma trận 10/2/0 — đặc tả là của đề khác). App giờ báo điều này và sinh đề theo Ma trận.

## Những gì đã sửa

| Lỗi | Sửa ở đâu | Cách sửa |
|---|---|---|
| B-01 bảng lồng cắt cụt bảng | `docxMathParser.ts` | Duyệt khối XML có đếm độ sâu (`iterateBlocks`), bảng lồng được giữ trong ô |
| B-02 bỏ qua `gridBefore` | `docxMathParser.ts` | Bù ô trống `gridBefore`/`gridAfter`, `hMerge`, bù cột theo `tblGrid` |
| B-03 dòng tiêu đề lặp | `docxMathParser.ts`, `matrixContract.ts` | Bỏ dòng tiêu đề bị chép lặp giữa bảng; xác định tiêu đề theo dòng Biết/Hiểu/VD |
| B-04 không tách được Đặc tả | `splitMatrixAndSpecsHtml` | Nhận diện bảng đặc tả theo nội dung (cột "Yêu cầu cần đạt", "Mức độ kiểm tra, đánh giá", dòng "Nhận biết: …"); chấp nhận mọi tiêu đề có chữ "đặc tả" |
| B-05 bảng nào cũng là ma trận | `extractDocxTablesAndHtml` | Thêm `hasMatrixTable`, `tableKinds`; bảng bìa/ký duyệt không ghi đè cấu hình |
| B-06 đọc số liệu bằng đoán, im lặng | **mới** `services/matrixContract.ts` | "Hợp đồng số liệu": đọc mã câu / số lượng theo đúng cột (dạng × mức), đối chiếu dòng Tổng, đọc điểm, cấp độ từng ý Đúng–Sai; không còn dùng `DOMParser` (#10) |
| B-07 tự bịa tự luận | `App.tsx` | Bỏ `detectEssayInHtml` khỏi quyết định; tự luận chỉ có khi bảng có |
| B-08 bắt chữ "tự luận" | `App.tsx` | Như trên |
| B-09 môn/lớp sai | `App.tsx`, `matrixContract.ts` | Nhận diện môn có dấu đúng; file khác lựa chọn trên màn hình → hỏi; không còn mặc định "Toán học / Lớp 12" |
| B-10 prompt ép chuẩn cứng | `constants.ts`, `geminiService.ts` | `SYSTEM_INSTRUCTION_UPLOADED` cho ma trận tải lên (giữ VDC, giữ thang điểm, giữ mã câu của file) |
| B-11 `void isGradeNoEssay` | `constants.ts` | Lớp 12 "mặc định" không tự luận, trừ khi người dùng cấu hình có |
| B-12 PDF/ảnh bị cắt | `geminiService.ts` | Kiểm tra `finishReason = MAX_TOKENS` → báo lỗi rõ; tăng giới hạn; không gửi file Word qua AI |
| B-13 cắt 20.000 ký tự | `geminiService.ts` | Nâng lên 60.000 ký tự, có cảnh báo; AI tách 2 bảng Ma trận / Đặc tả |
| B-14 không kiểm tra đề | **mới** `services/examValidator.ts` | Đếm số câu từng phần, 4 phương án A–D, đủ ý a–d, phần thừa/thiếu, có đáp án, đề bị cắt → tự sửa 1 lần, còn lỗi thì hiện cho người dùng |
| #5 OMML lồng nhau | `ommlToLatex` | Xử lý từ trong ra ngoài: `(x+1)^2`, phân số lồng, `sin x`, hệ phương trình, vectơ, giới hạn |
| Chú thích năng lực Toán | `constants.ts` | `getSubjectFootnotes('Toán học')` trước đây trả về mặc định; thêm Lịch sử, Địa lí |

## Luồng mới khi tải Ma trận / Đặc tả

1. Word `.docx` đọc trực tiếp (không qua AI); `.doc` đời cũ → báo cần lưu lại thành `.docx`; PDF/ảnh → AI chuyển bảng.
2. App đọc **hợp đồng số liệu** và hiện ngay trên thanh thông tin: môn, lớp (sửa được), số câu từng phần, điểm, các cảnh báo.
3. Bước Đặc tả (khi chỉ có Ma trận): khung cột dựng từ chính ma trận tải lên (không ép khung CV 7991 / mẫu 2–4).
4. Bước Đề: AI nhận danh sách **từng câu** (phần, số câu, mức độ, bài học, điểm, YCCĐ nếu có) → code kiểm tra lại → tự sửa 1 lần → hiện kết quả kiểm tra.

## Kiểm thử

```bash
npm run test:matrix   # 12 ca: 3 file mẫu + bảng lồng, gridBefore, tiêu đề lặp, VDC, tự luận trống, bảng bìa, OMML, kiểm tra đề
npm run test:cv7991
```

---

## Bổ sung: Tạo đề tương tự & Sinh 3 đề biến thể

| Lỗi | Hậu quả trước khi sửa | Cách sửa |
|---|---|---|
| Bộ phân loại lỗi coi mọi số chứa "500"/"400"/"429" là mã HTTP (`geminiService.ts`) | Đề dài bị cắt → lỗi JSON "…position 15003" bị coi là máy chủ quá tải → thử lại mọi model rồi báo sai "AI đang quá tải" | Chỉ nhận mã đứng riêng; lỗi JSON / lỗi nội dung không thử lại vô ích; thêm thông báo riêng khi file quá lớn |
| Tạo đề tương tự gộp phân tích + đề + lời giải vào 1 JSON, giới hạn 16k token | Đề dài là bị cắt → hỏng JSON → mất trắng cả đề | Tách 2 lượt: (1) phân tích + đề mới (hiện ngay), (2) lời giải Markdown, bị cắt thì tự viết tiếp tối đa 2 lần; lời giải lỗi vẫn giữ đề |
| Màn lỗi "Thử lại" xoá file | Phải tải lại file | "Thử lại với file này" + "Chọn file khác" |
| "Tạo đề mới" khi đã có kết quả | Lỗi là mất luôn đề đang có | Giữ kết quả cũ tới khi có đề mới; lỗi hiện thành thông báo |
| Sinh biến thể: không kiểm tra bị cắt khi stream | Đề 2/3 cụt phần cuối/đáp án mà không báo | Phát hiện MAX_TOKENS → tự gửi "viết tiếp" trong phiên chat (tối đa 2 lần) |
| Lỗi ở Đề 2 hoặc 3 → "Thử lại" | Xoá cả đề đã xong, chạy lại từ đầu | "Chạy tiếp từ Đề N", giữ các đề đã xong |
| Thanh tiến trình khi lỗi | Mọi bước xám, không biết bước nào lỗi | Bước xong hiện xanh, bước lỗi hiện đỏ |
| Xuất Word 3 đề | 3 đề nối liền, chỉ ngăn bằng đường kẻ | Mỗi đề sang trang mới |
| Giới hạn file 20 MB | File > ~15 MB vượt giới hạn gửi của Gemini (base64 +33%) → lỗi khó hiểu | Giới hạn 14 MB, thông báo rõ |
| Prompt biến thể "chuyên gia Toán & KHTN" | Đề Văn/Sử/Địa dễ lệch môn | Vai trò đa môn, bắt buộc giữ môn/lớp/cấu trúc đề gốc |
| — | Không biết 3 đề có cùng số câu không | Hiện số câu mỗi đề, cảnh báo khi lệch |
| — | Chỉ xuất Word từng tab | Thêm nút "Word: Đề + Lời giải" (lời giải sang trang mới) |

---

## Bổ sung 2: File Word cho đề gốc · Ngữ văn / Tiếng Anh · ma trận mẫu cũ

| Nội dung | Trước | Sau |
|---|---|---|
| Đề gốc dạng Word (.docx) cho "Tạo đề tương tự" và "Sinh 3 đề biến thể" | Chỉ nhận PDF/ảnh | Nhận .docx: app tự đọc (giữ bảng, công thức Equation → LaTeX, vị trí [HÌNH k] + ảnh đính kèm) rồi mới gửi AI (`services/examSourceService.ts`) |
| Word dùng công thức MathType | — | Báo ngay khi chọn file, hướng dẫn lưu PDF (AI không đọc được MathType). Ví dụ: file mẫu 02 có 3 công thức MathType |
| File .doc đời cũ / Word chỉ có ảnh chụp | — | Báo rõ cách xử lý |
| Ma trận mẫu cũ: Biết/Hiểu/VD ở trên, "TNKQ \| TL" ở dưới; cột phụ "Số câu \| Tỉ lệ %" | Dòng TNKQ/TL bị coi là dữ liệu → không đọc được số câu | Đọc đúng cả 2 kiểu tiêu đề; chỉ đếm cột "Số câu" |
| Ma trận Ngữ văn theo kĩ năng (Đọc hiểu / Viết, không có cột dạng câu) | Không đọc được số câu | Đọc số câu theo kĩ năng; đề chia PHẦN I. ĐỌC HIỂU / PHẦN II. VIẾT, điểm theo cột %, mỗi phần đánh số từ Câu 1 |
| Ma trận Tiếng Anh theo kĩ năng | Không đọc được | Coi là trắc nghiệm, đánh số câu liên tục |
| Kiểm tra đề Ngữ văn | Báo nhầm "thiếu phương án A–D" cho câu Đọc hiểu | Đọc hiểu / Viết là câu hỏi mở; kiểm tra tổng số câu |
| Kiểm tra đề Tiếng Anh | Không nhận "Question 1", "PART A", "ANSWER KEY" → báo nhầm thiếu câu / thiếu đáp án | Nhận đủ các kiểu này |

Kiểm thử: `npm run test:matrix` — 18 ca.
