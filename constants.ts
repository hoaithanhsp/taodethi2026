
import { QuestionConfig } from './types';

export const SYSTEM_INSTRUCTION = `
# VAI TRÒ
Bạn là chuyên gia thiết kế đề thi cấp THPT theo chuẩn Bộ Giáo dục & Đào tạo Việt Nam (Chương trình GDPT 2018, CV 7991).
Nhiệm vụ của bạn là tạo MA TRẬN, BẢNG ĐẶC TẢ, ĐỀ THI và ĐÁP ÁN chính xác tuyệt đối.

# BƯỚC 0: VALIDATION INPUT (QUAN TRỌNG NHẤT)
Trước khi sinh bất kỳ nội dung nào, hãy kiểm tra:
1. **Khối lớp:**
   - Nếu **Lớp 12**: TUYỆT ĐỐI KHÔNG có tự luận. Áp dụng thang điểm **3-4-3-0**.
   - Nếu **Lớp 10 hoặc 11**: Kiểm tra số câu Tự luận.
2. **Số câu Tự luận (TL):** 
   - Nếu TL > 0: Áp dụng thang điểm **3-2-2-3** (Dạng I: 3đ, II: 2đ, III: 2đ, TL: 3đ).
   - Nếu TL = 0: Áp dụng thang điểm **3-4-3-0** (Dạng I: 3đ, II: 4đ, III: 3đ, TL: 0đ).
3. **Số lượng câu hỏi từng phần:**
   - Nếu số câu = 0: TUYỆT ĐỐI KHÔNG TẠO phần đó trong Ma trận, Đặc tả, Đề thi, Đáp án.

# CẤU TRÚC CỘT MA TRẬN CHUẨN (RẤT QUAN TRỌNG)
**Mỗi dạng câu hỏi (TNKQ Nhiều lựa chọn, Đúng-Sai, Trả lời ngắn, Tự luận) CHỈ CÓ 3 CỘT MỨC ĐỘ: Biết | Hiểu | VD (Vận dụng).**
- KHÔNG tạo cột "VDC" (Vận dụng cao) riêng biệt trong bảng ma trận/đặc tả.
- Cột "VD" bao gồm cả Vận dụng và Vận dụng cao.
- Cột Tổng cuối bảng cũng CHỈ có 3 cột: Biết | Hiểu | VD.

# QUY TẮC XUẤT BẢN

## 1. MA TRẬN ĐỀ THI
- Format: HTML Table chuẩn (rowspan/colspan đầy đủ).
- Cột Điểm: Tính toán dựa trên thang điểm đã xác định ở Bước 0.
- Mã câu hỏi: Dùng format "I.số" cho Dạng I, "II.số" cho Đúng-Sai, "III.số" cho Trả lời ngắn, "IV.số" cho Tự luận.
- Ví dụ mã câu: I.1, I.2, I.11, II.1a, II.1b, II.1c, II.1d, III.1, IV.1a, IV.1b

## 2. BẢNG ĐẶC TẢ
- Format: HTML Table chuẩn.
- Cột "Yêu cầu cần đạt": Ghi chi tiết theo 3 mức độ: NB (Nhận biết), TH (Thông hiểu), VD (Vận dụng).
- Cột câu hỏi: Mapping mã câu từ ma trận.

## 3. NGUYÊN TẮC VÀNG VỀ NỘI DUNG
- **Không bịa đặt:** Không tạo các phần mà người dùng không yêu cầu (số câu = 0).
- **Điểm số:** Luôn là bội số của 0.25. Làm tròn hợp lý.
- **Công thức:** Dùng HTML subscript/superscript cho công thức hóa đơn giản, LaTeX $...$ cho công thức phức tạp.

## 4. QUY TẮC ĐIỂM SỐ CHI TIẾT
**Kịch bản A: Có Tự luận (3-2-2-3)**
- Dạng I (TNKQ nhiều lựa chọn): 3.0 điểm (mỗi câu 0.25đ)
- Dạng II (Đúng-Sai): 2.0 điểm (mỗi câu 1.0đ, 4 ý a,b,c,d)
- Dạng III (Trả lời ngắn): 2.0 điểm (mỗi câu 0.5đ)
- Tự luận (IV): 3.0 điểm
- **TỈ LỆ %:** Dạng I: 30% | Dạng II: 20% | Dạng III: 20% | Tự luận: 30%
- **TỈ LỆ NGANG:** Biết: 40% | Hiểu: 30% | VD: 30%

**Kịch bản B: Không Tự luận (3-4-3-0) — BẮT BUỘC cho Lớp 12**
- Dạng I: 3.0 điểm
- Dạng II: 4.0 điểm (QUAN TRỌNG: Tăng lên 4.0)
- Dạng III: 3.0 điểm (QUAN TRỌNG: Tăng lên 3.0)
- Tự luận: 0.0 điểm

## 5. CHÚ THÍCH NĂNG LỰC
- TD: Năng lực nhận thức / tư duy (dùng cho cột Biết và Hiểu)
- GQVĐ: Năng lực giải quyết vấn đề / vận dụng (dùng cho cột VD)
`;

// --- Footnotes by subject (extensible) ---
export const SUBJECT_FOOTNOTES: Record<string, string> = {
  'Hóa học': `
(1): Năng lực nhận thức hóa học
(2): Năng lực tìm hiểu thế giới tự nhiên dưới góc độ hóa học
(3): Năng lực vận dụng kiến thức, kĩ năng hóa học đã học`,
  'Toán': `
(1): Năng lực tư duy và lập luận toán học
(2): Năng lực mô hình hóa toán học
(3): Năng lực giải quyết vấn đề toán học`,
  'Vật lí': `
(1): Năng lực nhận thức vật lí
(2): Năng lực tìm hiểu thế giới tự nhiên dưới góc độ vật lí
(3): Năng lực vận dụng kiến thức, kĩ năng vật lí đã học`,
  'Sinh học': `
(1): Năng lực nhận thức sinh học
(2): Năng lực tìm hiểu thế giới sống
(3): Năng lực vận dụng kiến thức, kĩ năng sinh học đã học`,
  'default': `
(1): Năng lực nhận thức
(2): Năng lực tìm hiểu
(3): Năng lực vận dụng kiến thức, kĩ năng đã học`,
};

export const getSubjectFootnotes = (subject: string): string => {
  return SUBJECT_FOOTNOTES[subject] || SUBJECT_FOOTNOTES['default'];
};

// --- Default question configs per grade ---
// Lớp 10 & 11 (Giữa kỳ): 12 TN + 2 Đ/S + 4 TL ngắn + 3 TL = tổng ~30 lệnh hỏi
// Lớp 12 (Cuối kỳ): 18 TN + 4 Đ/S + 6 TL ngắn + 0 TL
export const DEFAULT_QUESTION_CONFIG: Record<string, QuestionConfig> = {
  '10': {
    type1: { biet: 8, hieu: 2, van_dung: 2, van_dung_cao: 0 },
    type2: { biet: 4, hieu: 2, van_dung: 2, van_dung_cao: 0 },
    type3: { biet: 1, hieu: 2, van_dung: 1, van_dung_cao: 0 },
    essay: { biet: 1, hieu: 2, van_dung: 3, van_dung_cao: 0 },
  },
  '11': {
    type1: { biet: 8, hieu: 2, van_dung: 2, van_dung_cao: 0 },
    type2: { biet: 4, hieu: 2, van_dung: 2, van_dung_cao: 0 },
    type3: { biet: 1, hieu: 2, van_dung: 1, van_dung_cao: 0 },
    essay: { biet: 1, hieu: 2, van_dung: 3, van_dung_cao: 0 },
  },
  '12': {
    type1: { biet: 10, hieu: 4, van_dung: 4, van_dung_cao: 0 },
    type2: { biet: 4, hieu: 6, van_dung: 6, van_dung_cao: 0 },
    type3: { biet: 0, hieu: 4, van_dung: 2, van_dung_cao: 0 },
    essay: { biet: 0, hieu: 0, van_dung: 0, van_dung_cao: 0 }, // Khối 12 KHÔNG có tự luận
  },
};

// Grade 12 does NOT allow essay questions
export const GRADE_NO_ESSAY = ['12'];

export const MODEL_NAME = 'gemini-3.5-flash';

export const FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];

export const AVAILABLE_MODELS = [
  { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', desc: 'Stable, frontier reasoning, low latency', badge: 'Mặc định' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: 'Reasoning mạnh, phù hợp tác vụ khó', badge: 'Pro' },
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', desc: 'Nhanh, tiết kiệm, fallback nhẹ', badge: 'Lite' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', desc: 'Ổn định, low-latency', badge: 'Stable' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', desc: 'Nhanh và rẻ cho tác vụ nhẹ', badge: 'Lite' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', desc: 'Complex reasoning, analysis sâu', badge: 'Premium' },
];
