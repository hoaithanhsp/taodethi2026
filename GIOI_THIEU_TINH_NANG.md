# 🎯 TẠO ĐỀ THI THEO CV 7991 — Ứng Dụng AI Toàn Năng Cho Giáo Viên

> **Biến hàng giờ soạn đề thành vài phút — với sức mạnh của Google Gemini AI**

---

## 📋 Tổng quan

**Tạo Đề Thi Theo CV 7991** là ứng dụng web sử dụng trí tuệ nhân tạo Google Gemini AI, hỗ trợ giáo viên THPT tạo đề kiểm tra chuẩn Công văn 7991 một cách nhanh chóng, chính xác và chuyên nghiệp.

Ứng dụng cung cấp **3 chế độ tạo đề** trong cùng một giao diện:

| # | Chế độ | Mô tả |
|---|--------|-------|
| 🔧 | **Tạo đề theo CV 7991** | Pipeline 4 bước chuẩn: INPUT → Ma trận → Đặc tả → Đề thi |
| 📋 | **Tạo đề tương tự** | Upload 1 đề mẫu → AI sinh đề mới giữ nguyên cấu trúc |
| 🔀 | **Sinh 3 đề biến thể** | Upload 1 đề gốc → AI sinh 3 đề biến thể kèm đáp án |

---

## 🔧 CHẾ ĐỘ 1: Tạo Đề Theo CV 7991 (Pipeline 4 Bước)

Đây là chế độ chính và mạnh mẽ nhất, hướng dẫn giáo viên qua quy trình chuẩn 4 bước theo Công văn 7991.

### 📥 Bước 1: NHẬP LIỆU THÔNG MINH

#### ✅ Upload Kế hoạch dạy học / PPCT
- Hỗ trợ **PDF, Word (.docx), ảnh chụp** kế hoạch dạy học
- AI tự động **nhận diện môn học, lớp, chương, bài học**, yêu cầu cần đạt
- Trích xuất **nguyên văn** nội dung từ file — không bịa đặt, không suy luận
- Hỗ trợ đọc bảng trong PDF ảnh bằng **AI Vision**
- Hỗ trợ trích xuất **công thức MathType/OMML** từ file Word

#### ✅ Cấu hình đề thi linh hoạt
- **Chọn môn học**: Toán, Lý, Hóa, Sinh, Tin, Sử, Địa, GDCD, Công nghệ, Tiếng Anh... (hoặc nhập tên môn tùy chỉnh)
- **Chọn khối lớp**: Lớp 10, 11, 12
- **Loại đề**: Giữa kỳ 1, Cuối kỳ 1, Giữa kỳ 2, Cuối kỳ 2
- **Thời gian làm bài**: 45 phút, 60 phút, 90 phút (hoặc tùy chỉnh)

#### ✅ Cấu trúc câu hỏi theo 4 dạng chuẩn CV 7991
- **Dạng I** — Trắc nghiệm nhiều lựa chọn (4 phương án A/B/C/D)
- **Dạng II** — Đúng/Sai (mỗi câu có 4 ý a, b, c, d)
- **Dạng III** — Trả lời ngắn
- **Tự luận** — (tự động ẩn cho Lớp 12 theo quy định)

Mỗi dạng được phân bổ theo **4 mức độ**: Nhận biết, Thông hiểu, Vận dụng, Vận dụng cao.

#### ✅ Lọc thông minh chủ đề theo kỳ thi
- Tự động chọn bài học phù hợp với loại đề (Giữa kỳ 1: tuần 1–10, Cuối kỳ 1: tuần 1–18,...)
- Hỗ trợ chọn/bỏ chọn theo **chương** hoặc **từng bài**
- Giao diện cây chủ đề (Topic Tree) trực quan, dễ thao tác

### 📊 Bước 2: MA TRẬN ĐỀ THI
- AI tự động sinh **bảng HTML Ma trận đề kiểm tra** chuẩn CV 7991
- Phân bổ câu hỏi theo tỷ lệ số tiết: bài nhiều tiết → nhiều câu hơn
- Đầy đủ mã câu (I.1, II.1a, III.2,...) và điểm số (bội 0.25, tổng = 10)
- Hỗ trợ **chỉnh sửa trực tiếp** nội dung HTML trước khi tiến sang bước tiếp theo
- **Tải về Word (.doc) hoặc HTML** để lưu trữ

### 📝 Bước 3: BẢNG ĐẶC TẢ
- AI sinh **Bảng đặc tả đề kiểm tra** dựa trên Ma trận ở Bước 2
- Mỗi câu hỏi có: Nội dung kiến thức, Cấp độ tư duy (NB/TH/VD), Yêu cầu cần đạt chi tiết
- Mã câu **đồng bộ 100%** với Ma trận
- Chỉnh sửa trực tiếp + Tải Word/HTML

#### 📚 Tính năng đặc biệt: Upload Tài Liệu Tham Khảo
- Tại bước Đặc tả, giáo viên có thể **upload ngân hàng câu hỏi** (.docx)
- AI sẽ **trích xuất nguyên văn** các câu hỏi từ file (bao gồm công thức toán)
- Các câu hỏi được **phân loại tự động** theo dạng (Type 1/2/3/Tự luận) và mức độ
- AI ưu tiên **sử dụng nguyên văn** câu hỏi từ ngân hàng vào đề thi ở Bước 4

### 📄 Bước 4: ĐỀ THI HOÀN CHỈNH
- AI sinh **đề thi + hướng dẫn chấm đầy đủ** dựa trên Ma trận + Đặc tả
- Bao gồm: Đề thi, Bảng đáp án nhanh, Hướng dẫn giải chi tiết
- Nếu có ngân hàng câu hỏi → AI ưu tiên dùng câu hỏi nguyên văn từ đó
- Xuất Word (.doc) hoặc HTML

---

## ⚡ LỐI TẮT NHANH (Shortcuts)

Dành cho giáo viên **đã có sẵn** Ma trận hoặc Đặc tả từ trước:

### Lối tắt 1: Có file Ma trận
- Upload file Ma trận (HTML/Word/PDF) → **Bỏ qua cấu hình** → Nhảy thẳng sang sinh Bảng đặc tả

### Lối tắt 2: Có cả Ma trận + Đặc tả
- Upload 2 file Ma trận + Đặc tả → **Nhảy thẳng** sang sinh Đề thi hoàn chỉnh

---

## 📋 CHẾ ĐỘ 2: Tạo Đề Tương Tự

Chế độ này dành cho giáo viên **đã có sẵn 1 đề thi mẫu** và muốn tạo thêm đề mới giữ nguyên cấu trúc.

### Quy trình
1. **Upload đề mẫu** (PDF hoặc ảnh JPG/PNG)
2. **Cấu hình tùy chọn**:
   - Chất lượng hình vẽ: Tiêu chuẩn (nhanh) hoặc Cao cấp (TikZ chi tiết)
   - Chi tiết lời giải: Ngắn gọn / Tiêu chuẩn / Chuyên sâu
3. **AI phân tích** đề mẫu: Nhận diện số câu, dạng toán, mức độ khó
4. **AI sinh 1 đề mới hoàn chỉnh** kèm lời giải

### Kết quả gồm 3 phần (Tab)
- **📊 Phân tích Ma trận**: Bảng phân tích cấu trúc đề gốc
- **📝 Đề thi (Bước 1)**: Nội dung đề thi mới — chỉ thay số liệu/bối cảnh
- **✅ Lời giải (Bước 2)**: Bảng đáp án nhanh + Hướng dẫn giải chi tiết

### Xuất dữ liệu
- Copy nội dung nhanh
- Tải về Word (.doc)
- Sinh lại đề mới bất cứ lúc nào (nút "Tạo đề mới" ở sidebar)

---

## 🔀 CHẾ ĐỘ 3: Sinh 3 Đề Biến Thể

Chế độ mạnh mẽ nhất để **nhân bản đề thi** — từ 1 đề gốc sinh ra 3 đề khác nhau.

### Quy trình 3 bước tự động
1. **Upload đề gốc** (PDF hoặc ảnh)
2. AI sinh **Đề biến thể số 1** + Đáp án (streaming trực tiếp)
3. AI sinh **Đề biến thể số 2** + Đáp án
4. AI sinh **Đề biến thể số 3** + Đáp án

### Giao diện 3 cột
- Mỗi đề hiển thị trong **1 cột riêng** (layout 3 cột trên desktop)
- **Streaming thời gian thực**: Nội dung hiện dần khi AI đang sinh
- **Thanh tiến trình**: Theo dõi bước 1 → 2 → 3

### Nguyên tắc sinh biến thể
- ✓ Giữ nguyên cấu trúc, số lượng câu, mức độ khó
- ✓ Thay đổi số liệu, bối cảnh, cách hỏi
- ✓ Đáp án là số đẹp, hợp lý
- ✓ Câu dễ: Chỉ ghi đáp án | Câu khó: Lời giải vắn tắt

### Xuất dữ liệu
- Tải về **1 file Word (.docx)** chứa cả 3 đề + đáp án

---

## 🔑 TÍNH NĂNG CHUNG

### 🤖 Tích hợp Google Gemini AI
- Hỗ trợ **5 model AI**: Gemini 3 Flash, Gemini 3 Pro, Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Gemini 2.5 Pro
- **Tự động fallback**: Nếu model chính gặp lỗi/hết quota → tự chuyển sang model khác
- **Retry thông minh**: Tự thử lại khi gặp lỗi tạm thời (503, 429)
- Người dùng tự nhập **API Key** miễn phí từ Google AI Studio

### 🔐 Hệ thống xác thực
- Cho phép **1 lượt dùng thử miễn phí** trước khi yêu cầu đăng nhập
- Đăng nhập bằng tài khoản + mật khẩu
- Phiên đăng nhập được **lưu trữ** (không cần đăng nhập lại)
- Liên hệ Zalo để nhận tài khoản sử dụng không giới hạn

### 🎨 Giao diện Premium
- Thiết kế **Glassmorphism** hiện đại
- Gradient xanh teal chuyên nghiệp
- **Micro-animations** mượt mà (fade-in, hover effects)
- Card nổi (elevated cards) với hiệu ứng 3D
- **Responsive** hoàn toàn — hoạt động tốt trên máy tính, tablet, điện thoại
- Custom scrollbar đẹp mắt

### 📐 Hỗ trợ công thức toán học
- Render **LaTeX** đẹp bằng KaTeX ($x^2 + y^2 = r^2$)
- Hỗ trợ bảng GFM (GitHub Flavored Markdown)
- Highlight code block cho TikZ/LaTeX
- Trích xuất chính xác **MathType/OMML** từ file Word

### 💾 Xuất dữ liệu đa dạng
- Tải **Word (.doc / .docx)** — mở trực tiếp bằng Microsoft Word
- Tải **HTML** — mở bằng trình duyệt, dễ in ấn
- **Copy** nội dung nhanh vào clipboard
- Chỉnh sửa trực tiếp nội dung HTML trước khi tải về

### ⚙️ Cài đặt linh hoạt
- **Chọn model AI** theo nhu cầu (nhanh/chất lượng/premium)
- **Quản lý API Key** — thêm/xóa/thay đổi bất cứ lúc nào
- **Lưu trữ cấu hình** — nhớ model đã chọn, chế độ đang dùng

---

## 🏫 AI TẠO ĐỀ PHÙ HỢP VỚI

| Đối tượng | Chi tiết |
|-----------|----------|
| **Cấp học** | THPT (Lớp 10, 11, 12) |
| **Môn học** | Toán, Lý, Hóa, Sinh, Tin học, Sử, Địa, GDCD, Công nghệ, Tiếng Anh,... |
| **Loại đề** | Giữa kỳ, Cuối kỳ, 15 phút, Kiểm tra thường xuyên |
| **Chuẩn** | Công văn 7991/BGDĐT — Quy định về kiểm tra đánh giá |

---

## 🚀 Bắt đầu sử dụng

1. Truy cập ứng dụng tại web
2. Nhập **API Key** miễn phí từ [Google AI Studio](https://aistudio.google.com/apikey)
3. Chọn chế độ tạo đề phù hợp
4. Upload tài liệu và để AI làm phần còn lại!

---

> **Powered by Google Gemini AI** | © 2026 | Mọi tool AI và khóa học tạo app dành cho giáo viên có tại: [giaovienai.vercel.app](https://giaovienai.vercel.app/)
