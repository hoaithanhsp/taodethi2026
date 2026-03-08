# 📊 TỐI ƯU CHI PHÍ GEMINI API - 4 MODEL CHÍNH (03/2026)


> **Phiên bản cập nhật :** Tháng 3/2026\
> **Áp dụng cho:** gemini-3-flash-preview | gemini-2.5-flash | gemini-2.5-flash-lite | gemini-2.5-pro\
> **Mục tiêu :** Tối ưu chi phí với bản trả phí, chọn đúng model cho từng tác vụ

---

## 🎯 BẢNG SO SÁNH 4 MODEL

### 1. Thông Số Kỹ Thuật

| Model | Context Window | Output Tokens | Đặc Điểm Chính | Use Case Phù Hợp |
| --- | --- | --- | --- | --- |
| **gemini-3-flash-preview** | 1,000,000 | 65,536 | Frontier-class, reasoning mạnh, visual/spatial tốt | Tác vụ phức tạp, cần reasoning sâu |
| **gemini-2.5-flash** | 1,000,000 | 65,536 | Multimodal, low-latency, high-volume | Real-time, API integration, chat |
| **gemini-2.5-flash-lite** | 128,000 | ~8,192 | Nhanh nhất, rẻ nhất, lightweight | Chat đơn giản, summarization nhỏ |
| **gemini-2.5-pro** | 1,000,000 (test 2M) | 65,536 | Multimodal, complex reasoning, agentic coding | Tác vụ phức tạp, coding, analysis |

### 2. Bảng Giá Chi Tiết (per 1M tokens)

#### a) Standard Pricing

| Model | Input (≤200K) | Input (>200K) | Output (≤200K) | Output (>200K) | Batch Input | Batch Output |
| --- | --- | --- | --- | --- | --- | --- |
| **gemini-3-flash-preview** | $0.50 | $0.50 | $3.00 | $3.00 | $0.25 | $1.50 |
| **gemini-2.5-flash** | $0.30 | $0.30 | $2.50 | $2.50 | $0.15 | $1.25 |
| **gemini-2.5-flash-lite** | ~$0.15* | ~$0.15* | ~$1.00* | ~$1.00* | ~$0.075* | ~$0.50* |
| **gemini-2.5-pro** | $1.25 | $2.50 | $10.00 | $15.00 | $0.625 | $5.00 |

* *Ước tính dựa trên positioning "thấp nhất trong dòng 2.5"*

#### b) Context Caching (Tiết kiệm cho repeated content)

| Model | Cache Storage (≤200K) | Cache Storage (>200K) | Cache Usage |
| --- | --- | --- | --- |
| gemini-3-flash-preview | $0.05/hour | $0.05/hour | $0.025/1M tokens |
| gemini-2.5-flash | $0.03/hour | $0.03/hour | $0.015/1M tokens |
| gemini-2.5-pro | $0.125/hour | $0.25/hour | $0.0625/1M tokens |

### 3. So Sánh Chi Phí Thực Tế

**Ví dụ: 1 request SKKN (Input: 2,000 tokens, Output: 1,500 tokens)**

```plaintext
Model                     Input Cost    Output Cost    Total/Request
─────────────────────────────────────────────────────────────────────
gemini-2.5-flash-lite     $0.00030      $0.00150       $0.00180  ✅ Rẻ nhất
gemini-2.5-flash          $0.00060      $0.00375       $0.00435  ⚖️ Cân bằng
gemini-3-flash-preview    $0.00100      $0.00450       $0.00550  🚀 Hiệu năng cao
gemini-2.5-pro            $0.00250      $0.01500       $0.01750  💎 Chất lượng cao nhất
```

**Với 1,000 request/ngày :**

| Model | Chi phí/ngày | Chi phí/tháng (30 ngày) |
| --- | --- | --- |
| gemini-2.5-flash-lite | $1.80 | ~$54 |
| gemini-2.5-flash | $4.35 | ~$131 |
| gemini-3-flash-preview | $5.50 | ~$165 |
| gemini-2.5-pro | $17.50 | ~$525 |

---

## II. CHIẾN LƯỢC CHỌN MODEL THEO TÁC VỤ

### 1. Quy Tắc Chọn Model

```javascript
function selectModel(task, complexity, requireReasoning) {
  // Priority: Cost → Performance → Quality
  
  if (complexity === 'low' && !requireReasoning) {
    return 'gemini-2.5-flash-lite';  // Rẻ nhất, đủ dùng
  }
  
  if (complexity === 'medium' || task === 'chat') {
    return 'gemini-2.5-flash';  // Cân bằng chi phí/hiệu năng
  }
  
  if (complexity === 'high' || requireReasoning || task === 'coding') {
    // Chọn giữa 3-flash và 2.5-pro
    if (task === 'coding' || task === 'analysis') {
      return 'gemini-2.5-pro';  // Tốt nhất cho coding
    }
    return 'gemini-3-flash-preview';  // Hiệu năng frontier-class
  }
  
  // Mặc định
  return 'gemini-2.5-flash';
}
```

### 2. Bảng Gợi Ý Chi Tiết

| Tác Vụ | Model Khuyến Nghị | Lý Do | Tiết Kiệm So Với Pro |
| --- | --- | --- | --- |
| **Chatbot đơn giản** | gemini-2.5-flash-lite | Nhanh, rẻ, đủ cho Q&A cơ bản | ~90% |
| **Tóm tắt văn bản ngắn** | gemini-2.5-flash-lite | Context 128K đủ dùng | ~90% |
| **Tạo SKKN cơ bản** | gemini-2.5-flash | Cân bằng chi phí/chất lượng | ~75% |
| **Phân tích dữ liệu** | gemini-3-flash-preview | Reasoning tốt, giá hợp lý | ~68% |
| **Coding/Agentic tasks** | gemini-2.5-pro | Agentic coding tốt nhất | 0% (best choice) |
| **Complex reasoning** | gemini-2.5-pro | Suy luận đa bước phức tạp | 0% (best choice) |
| **Multimodal (ảnh + text)** | gemini-2.5-flash | Xử lý nhanh, giá tốt | ~75% |
| **Real-time API** | gemini-2.5-flash | Low latency | ~75% |
| **Research/Deep analysis** | gemini-3-flash-preview | Frontier performance | ~68% |

---

## III. TỐI ƯU CHI PHÍ CHO TỪNG MODEL

### 1. Tối Ưu gemini-2.5-flash-lite (Rẻ Nhất)

**Khi nào dùng :**

- Chatbot FAQ đơn giản

- Tóm tắt văn bản < 5,000 từ

- Phản hồi nhanh không cần reasoning phức tạp

- Prototype/MVP

**Cấu hình tối ưu:**

```javascript
const flashLiteConfig = {
  model: 'gemini-2.5-flash-lite',
  generationConfig: {
    maxOutputTokens: 1024,      // Lite có thể giới hạn thấp hơn
    temperature: 0.5,           // Giảm sáng tạo → ít token hơn
    topP: 0.9,
  },
  // Giới hạn context
  maxInputTokens: 32000,        // Chỉ dùng 25% context window
};

// Chi phí ước tính: ~$0.0018/request (2K input, 1K output)
```

**Lưu ý:**

- Context window chỉ 128K → Không dùng cho tài liệu dài

- Không có multimodal → Không xử lý ảnh/video

### 2. Tối Ưu gemini-2.5-flash (Cân Bằng)

**Khi nào dùng :**

- Production app với cân bằng chi phí/chất lượng

- Multimodal cơ bản

- API integration

- Chatbot phức tạp hơn

**Cấu hình tối ưu:**

```javascript
const flashConfig = {
  model: 'gemini-2.5-flash',
  generationConfig: {
    maxOutputTokens: 2048,      // Đủ cho hầu hết tác vụ
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
  },
  // Sử dụng context caching cho repeated prompts
  cachedContent: cacheName,     // Tiết kiệm 50% input cost
};

// Chi phí ước tính: ~$0.0044/request (2K input, 1.5K output)
// Với caching: ~$0.0035/request (tiết kiệm ~20%)
```

**Chiến lược caching:**

```javascript
// Tạo cache cho system prompt dài
const cache = await genAI.caching.create({
  model: 'gemini-2.5-flash',
  contents: [
    { role: 'system', parts: [{ text: SYSTEM_PROMPT_SKKN }] }
  ],
  ttlSeconds: 3600,  // Cache 1 giờ
});

// Chi phí cache: $0.03/hour cho 100K tokens
// Tiết kiệm: $0.30 - $0.03 = $0.27 cho 100 request
```

### 3. Tối Ưu gemini-3-flash-preview (Hiệu Năng Cao)

**Khi nào dùng :**

- Tác vụ cần reasoning phức tạp

- Analysis sâu

- Code generation nâng cao

- Khi 2.5-flash không đủ mạnh

**Cấu hình tối ưu:**

```javascript
const flash3Config = {
  model: 'gemini-3-flash-preview',
  generationConfig: {
    maxOutputTokens: 4096,      // Cho phép output dài hơn
    temperature: 0.3,           // Giảm để tăng tính chính xác
    topP: 0.95,
  },
  // Bật thinking mode nếu cần reasoning
  thinkingConfig: {
    thinkingBudget: 1024,       // Giới hạn thinking tokens
  },
};

// Chi phí: ~$0.0055/request (2K input, 1.5K output)
// Với thinking: +$0.0015 (nếu 500 thinking tokens)
```

**Giảm chi phí thinking:**

```javascript
// Thinking giúp chất lượng nhưng tốn token
// Chỉ bật khi thực sự cần
const useThinking = task.requiresComplexReasoning;

const config = {
  ...baseConfig,
  thinkingConfig: useThinking ? { thinkingBudget: 1024 } : undefined,
};
```

### 4. Tối Ưu gemini-2.5-pro (Chất Lượng Cao Nhất)

**Khi nào dùng :**

- Coding phức tạp

- Agentic workflows

- Analysis chuyên sâu

- Khi chất lượng quan trọng hơn chi phí

**Cấu hình tối ưu:**

```javascript
const proConfig = {
  model: 'gemini-2.5-pro',
  generationConfig: {
    maxOutputTokens: 8192,      // Tận dụng output lớn
    temperature: 0.2,           // Giảm sáng tạo, tăng accuracy
    topP: 0.95,
  },
};

// Chi phí: ~$0.0175/request (2K input, 1.5K output)
// Gấp 4 lần Flash nhưng chất lượng cao hơn đáng kể
```

**Giảm chi phí Pro:**

```javascript
// 1. Dùng Pro chỉ cho phần quan trọng
async function hybridApproach(userRequest) {
  // Bước 1: Phân tích yêu cầu bằng Flash (rẻ)
  const analysis = await callGemini(userRequest, 'gemini-2.5-flash');
  
  // Bước 2: Nếu phức tạp, dùng Pro
  if (analysis.complexity === 'high') {
    return await callGemini(userRequest, 'gemini-2.5-pro');
  }
  
  return analysis;
}

// 2. Batch nhiều request
const batchResults = await callGeminiBatch([
  task1, task2, task3, task4, task5
], 'gemini-2.5-pro');  // Giảm overhead
```

---

## IV. CHIẾN LƯỢC TIẾT KIỆM TỔNG THỂ

### 1. Tiered Model Strategy (Chiến Lược Phân Tầng)

```javascript
class TieredModelStrategy {
  constructor() {
    this.usageStats = {
      lite: 0,
      flash: 0,
      flash3: 0,
      pro: 0
    };
  }

  async generate(userRequest, options = {}) {
    const { forceQuality, budget } = options;
    
    // Nếu ép buộc chất lượng
    if (forceQuality === 'high') {
      this.usageStats.pro++;
      return await this.callPro(userRequest);
    }
    
    // Nếu giới hạn budget
    if (budget === 'tight') {
      this.usageStats.lite++;
      return await this.callLite(userRequest);
    }
    
    // Thử theo thứ tự: Lite → Flash → Flash3 → Pro
    try {
      // Thử Lite trước
      const liteResult = await this.callLite(userRequest);
      if (liteResult.quality === 'acceptable') {
        this.usageStats.lite++;
        return liteResult;
      }
    } catch (e) {
      // Lite fail, thử Flash
    }
    
    // Mặc định dùng Flash
    this.usageStats.flash++;
    return await this.callFlash(userRequest);
  }
  
  getCostReport() {
    // Tính tổng chi phí
    const liteCost = this.usageStats.lite * 0.0018;
    const flashCost = this.usageStats.flash * 0.0044;
    const flash3Cost = this.usageStats.flash3 * 0.0055;
    const proCost = this.usageStats.pro * 0.0175;
    
    return {
      breakdown: this.usageStats,
      totalCost: liteCost + flashCost + flash3Cost + proCost,
      averagePerRequest: (liteCost + flashCost + flash3Cost + proCost) / 
                         (this.usageStats.lite + this.usageStats.flash + 
                          this.usageStats.flash3 + this.usageStats.pro)
    };
  }
}
```

### 2. Batch API (Giảm 50% Chi Phí)

```javascript
// Sử dụng Batch API cho non-real-time tasks
async function batchProcess(requests) {
  const batchResponses = await genAI.batch.create({
    model: 'gemini-2.5-flash',
    requests: requests.map((req, i) => ({
      name: `request_${i}`,
      contents: [{ parts: [{ text: req }] }]
    })),
  });
  
  // Batch pricing: 50% giá standard
  // Input: $0.15/1M tokens (thay vì $0.30)
  // Output: $1.25/1M tokens (thay vì $2.50)
}
```

### 3. Smart Caching Strategy

```javascript
// Cache theo loại prompt
const CACHE_STRATEGY = {
  // Cache system prompt (dùng lại nhiều)
  systemPrompts: {
    ttl: 3600,  // 1 giờ
    model: 'gemini-2.5-flash'
  },
  
  // Cache templates thường dùng
  templates: {
    'skkn_mo_dau': { ttl: 7200 },
    'skkn_ket_qua': { ttl: 7200 },
    'skkn_ket_luan': { ttl: 7200 },
  },
  
  // Không cache (real-time, unique)
  noCache: ['chat', 'qa', 'analysis']
};
```

---

## V. GIÁM SÁT VÀ BÁO CÁO CHI PHÍ

### 1. Theo Dõi Chi Phí Theo Model

```javascript
class CostTracker {
  constructor() {
    this.dailyStats = {
      'gemini-2.5-flash-lite': { requests: 0, inputTokens: 0, outputTokens: 0 },
      'gemini-2.5-flash': { requests: 0, inputTokens: 0, outputTokens: 0 },
      'gemini-3-flash-preview': { requests: 0, inputTokens: 0, outputTokens: 0 },
      'gemini-2.5-pro': { requests: 0, inputTokens: 0, outputTokens: 0 },
    };
    
    this.pricing = {
      'gemini-2.5-flash-lite': { input: 0.00000015, output: 0.000001 },
      'gemini-2.5-flash': { input: 0.00000030, output: 0.00000250 },
      'gemini-3-flash-preview': { input: 0.00000050, output: 0.00000300 },
      'gemini-2.5-pro': { input: 0.00000125, output: 0.00001000 },
    };
  }

  track(model, inputTokens, outputTokens) {
    this.dailyStats[model].requests++;
    this.dailyStats[model].inputTokens += inputTokens;
    this.dailyStats[model].outputTokens += outputTokens;
  }

  getDailyReport() {
    let totalCost = 0;
    const breakdown = {};
    
    for (const [model, stats] of Object.entries(this.dailyStats)) {
      const inputCost = stats.inputTokens * this.pricing[model].input;
      const outputCost = stats.outputTokens * this.pricing[model].output;
      const modelTotal = inputCost + outputCost;
      
      breakdown[model] = {
        ...stats,
        cost: modelTotal.toFixed(4)
      };
      
      totalCost += modelTotal;
    }
    
    return {
      date: new Date().toISOString().split('T')[0],
      breakdown,
      totalCost: totalCost.toFixed(4),
      projectedMonthly: (totalCost * 30).toFixed(2)
    };
  }
}

// Sử dụng
const tracker = new CostTracker();

// Sau mỗi request
tracker.track('gemini-2.5-flash', 2000, 1500);

// Cuối ngày
console.log(tracker.getDailyReport());
```

### 2. Cảnh Báo Vượt Ngân Sách

```javascript
async function budgetAlert(currentSpend, budgetLimit) {
  const threshold = budgetLimit * 0.8;  // Cảnh báo ở 80%
  
  if (currentSpend > threshold) {
    await sendNotification({
      type: 'budget_warning',
      message: `Đã sử dụng ${(currentSpend/budgetLimit*100).toFixed(1)}% ngân sách ngày`,
      recommendation: 'Chuyển sang gemini-2.5-flash-lite để tiết kiệm'
    });
  }
  
  if (currentSpend > budgetLimit) {
    // Tự động downgrade
    return 'gemini-2.5-flash-lite';
  }
  
  return null;
}
```

---

## VI. CHECKLIST TỐI ƯU CHI PHÍ

### ✅ Trước Khi Deploy

- [ ]  Phân loại tác vụ : Simple (Lite) | Medium (Flash) | Complex (Flash3/Pro)

- [ ]  Thiết lập caching cho system prompts

- [ ]  Cấu hình maxOutputTokens phù hợp (đừng để mặc định 8K)

- [ ]  Chuẩn bị fallback: Pro → Flash3 → Flash → Lite

- [ ]  Thiết lập budget alerts

- [ ]  Cấu hình Batch API cho non-real-time tasks

### ✅ Sau Khi Deploy

- [ ]  Theo dõi phân bổ : Lite % | Flash % | Flash3% | Pro %

- [ ]  Mục tiêu : Lite + Flash ≥ 80% tổng request

- [ ]  Kiểm tra cache hit rate > 40%

- [ ]  Theo dõi chi phí/ngày và dự báo tháng

- [ ]  Điều chỉnh model selection nếu chi phí vượt dự kiến

---

## VII. VÍ DỤ THỰC TẾ: APP TẠO SKKN

### Kịch Bản : 100 users/ngày, mỗi user 3 SKKN

**Phân bổ tác vụ :**

| Tác vụ | Số request | Model | Chi phí/request | Tổng/ngày |
| --- | --- | --- | --- | --- |
| Mở đầu SKKN | 100 | Flash | $0.0044 | $0.44 |
| Cơ sở lý thuyết | 100 | Flash3 | $0.0055 | $0.55 |
| Nội dung giải pháp | 100 | Flash | $0.0044 | $0.44 |
| Kết quả (có số liệu) | 100 | Pro | $0.0175 | $1.75 |

**Tổng chi phí/ngày :** $3.18\
**Tổng chi phí/tháng:** ~$95

**So sánh nếu dùng toàn Pro :** ~$525/tháng\
**Tiết kiệm:** ~82%

---

## 📌 KẾT LUẬN

### Nguyên Tắc Vàng :

1. **Bắt đầu với Flash-Lite** → Chỉ nâng cấp khi thực sự cần

2. **Flash cho 80% tác vụ** → Cân bằng chi phí/hiệu năng

3. **Flash3 cho reasoning** → Khi cần suy luận phức tạp

4. **Pro cho coding/analysis** → Chất lượng cao nhất

5. **Luôn dùng caching** → Tiết kiệm 20-50%

6. **Batch khi có thể** → Giảm 50% chi phí

### Chi Phí Ước Tính Theo Quy Mô :

| Users/ngày | Requests/ngày | Chi phí/tháng (tối ưu) | Chi phí/tháng (toàn Pro) |
| --- | --- | --- | --- |
| 50 | 500 | ~$27 | ~$263 |
| 100 | 1,000 | ~$54 | ~$525 |
| 200 | 2,000 | ~$108 | ~$1,050 |
| 500 | 5,000 | ~$270 | ~$2,625 |

### Khuyến Nghị Cuối Cùng :

- **Startup/MVP:** Chỉ dùng Flash-Lite + Flash

- **Production:** 70% Flash + 20% Flash3 + 10% Pro

- **Enterprise:** 50% Flash + 30% Flash3 + 20% Pro

---

**Tài liệu tham khảo :**

- Google AI Documentation: <https://ai.google.dev/gemini-api/docs/models>

- Gemini Pricing: <https://ai.google.dev/pricing>

- Batch API: <https://ai.google.dev/gemini-api/docs/batch>

**Phiên bản :** 2.0 (Cập nhật tháng 3/2026)\
**Tác giả:** YouMind AI Assistant\
**Model hỗ trợ:** gemini-3-flash-preview | gemini-2.5-flash | gemini-2.5-flash-lite | gemini-2.5-pro