import { isValidGoogleAiApiKey, maskGoogleAiApiKey, normalizeGoogleAiApiKey } from './apiKeyValidation';
import { FALLBACK_MODELS } from '../constants';

/**
 * API Key Manager - Quản lý kho tối đa 30 Gemini API Key với cơ chế xoay vòng + cooldown thông minh theo từng model
 * - Key người dùng nhập lưu tại localStorage ('gemini_api_keys')
 * - Key ngầm từ .env.local (VITE_GEMINI_API_KEYS) chỉ giữ trong RAM (source: 'env', isHidden: true), tuyệt đối không ghi xuống localStorage
 */

export type ApiKeyStatus = 'active' | 'error' | 'cooldown';
export type ApiKeySource = 'user' | 'env';

export interface ApiKeyInfo {
  key: string;
  name: string;
  status: ApiKeyStatus;
  source?: ApiKeySource;
  isHidden?: boolean;
  lastError?: string;
  lastErrorModel?: string;
  errorCount: number;
  cooldownUntil?: number; // Timestamp khi hết cooldown chung
  modelCooldowns?: Record<string, number>; // Cooldown riêng theo từng model: { [modelId]: timestamp }
  addedAt: number;
}

export interface ApiKeyRotationResult {
  success: boolean;
  hasMoreKeys: boolean;
  newKey?: string;
  message: string;
}

export interface BulkAddResult {
  added: number;
  duplicates: number;
  invalid: number;
  limitReached: number;
  total: number;
  addedKeys: string[];
}

export type KeyRotationCallback = (info: { fromKey: string; toKey: string; reason: string }) => void;
export type AllKeysFailedCallback = () => void;

const STORAGE_KEY = 'gemini_api_keys';
const LEGACY_SINGLE_KEY_STORAGE_KEYS = ['gemini_api_key', 'user_gemini_api_key', 'examcraft_api_key'] as const;
const MAX_KEYS = 30;
const RPM_COOLDOWN_MS = 65 * 1000;          // 65 giây cho giới hạn tốc độ theo phút (RPM)
const RPD_COOLDOWN_MS = 15 * 60 * 1000;     // 15 phút cho lỗi hết quota ngày (RPD) trên 1 model
const DEFAULT_COOLDOWN_MS = 3 * 60 * 1000;  // 3 phút mặc định khi không rõ loại 429

const hasLocalStorage = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
};

// Đọc danh sách API key ngầm từ biến môi trường (.env.local) — CHỈ giữ trong RAM, không ghi vào localStorage
const getEnvKeys = (): { key: string; name: string }[] => {
  let envKeys = '';
  try {
    envKeys = ((typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GEMINI_API_KEYS) || '') as string;
  } catch {
    envKeys = '';
  }
  if (!envKeys) return [];
  const seen = new Set<string>();
  const result: { key: string; name: string }[] = [];
  envKeys
    .split(/[\r\n,;\s]+/)
    .map((k: string) => normalizeGoogleAiApiKey(k))
    .filter((k: string) => isValidGoogleAiApiKey(k))
    .forEach((k: string) => {
      if (!seen.has(k)) {
        seen.add(k);
        result.push({ key: k, name: `Key dự phòng #${result.length + 1}` });
      }
    });
  return result;
};

const BACKUP_API_KEYS = getEnvKeys();

class ApiKeyManager {
  private keys: ApiKeyInfo[] = [];
  private currentIndex: number = 0;
  private onKeyRotation?: KeyRotationCallback;
  private onAllKeysFailed?: AllKeysFailedCallback;
  private changeListeners = new Set<() => void>();

  constructor() {
    this.loadFromStorage();
  }

  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private notifyChanged(): void {
    this.changeListeners.forEach(fn => {
      try {
        fn();
      } catch {
        // ignore listener errors
      }
    });
  }

  setOnKeyRotation(callback: KeyRotationCallback) {
    this.onKeyRotation = callback;
  }

  setOnAllKeysFailed(callback: AllKeysFailedCallback) {
    this.onAllKeysFailed = callback;
  }

  /**
   * Load danh sách key của người dùng từ localStorage + nạp ngầm env keys vào RAM
   */
  loadFromStorage(): void {
    try {
      const envKeySet = new Set(BACKUP_API_KEYS.map(b => b.key));
      const stored = hasLocalStorage() ? localStorage.getItem(STORAGE_KEY) : null;
      if (stored) {
        const data = JSON.parse(stored);
        const rawKeys = Array.isArray(data.keys)
          ? data.keys.filter((k: any) => k && typeof k.key === 'string')
          : [];

        // Dọn sạch mọi key env nếu từng vô tình lọt vào localStorage
        this.keys = rawKeys
          .map((k: any): ApiKeyInfo => {
            const normalized = normalizeGoogleAiApiKey(k.key);
            const isEnv = k.source === 'env' || envKeySet.has(normalized);
            return {
              key: normalized,
              name: k.name || 'Key của tôi',
              status: k.status === 'error' || k.status === 'cooldown' ? k.status : 'active',
              source: isEnv ? 'env' : 'user',
              isHidden: isEnv,
              lastError: k.lastError,
              lastErrorModel: k.lastErrorModel,
              errorCount: Number.isFinite(k.errorCount) ? k.errorCount : 0,
              cooldownUntil: k.cooldownUntil,
              modelCooldowns: k.modelCooldowns && typeof k.modelCooldowns === 'object' ? { ...k.modelCooldowns } : {},
              addedAt: Number.isFinite(k.addedAt) ? k.addedAt : Date.now(),
            };
          })
          .filter((k: ApiKeyInfo) => isValidGoogleAiApiKey(k.key) && k.source !== 'env');

        this.currentIndex = Number.isInteger(data.currentIndex) ? data.currentIndex : 0;
        if (this.currentIndex < 0 || this.currentIndex >= this.keys.length) this.currentIndex = 0;
      }

      // Migration: nếu có key đơn cũ ở 'gemini_api_key' / 'user_gemini_api_key' / 'examcraft_api_key'
      if (hasLocalStorage()) {
        for (const legacyStorageKey of LEGACY_SINGLE_KEY_STORAGE_KEYS) {
          const oldKeyRaw = localStorage.getItem(legacyStorageKey);
          const oldKey = oldKeyRaw ? normalizeGoogleAiApiKey(oldKeyRaw) : '';
          if (oldKey && isValidGoogleAiApiKey(oldKey) && !envKeySet.has(oldKey)) {
            if (!this.keys.some(k => k.key === oldKey) && this.keys.length < MAX_KEYS) {
              this.keys.unshift({
                key: oldKey,
                name: 'Key mặc định',
                status: 'active',
                source: 'user',
                isHidden: false,
                errorCount: 0,
                modelCooldowns: {},
                addedAt: Date.now(),
              });
            }
          }
        }
      }

      // Nạp ngầm backup env keys vào RAM (đặt sau user keys để ưu tiên key người dùng trước)
      this.injectBackupKeys();
      this.checkAndResetCooldowns();
    } catch (e) {
      console.error('[ApiKeyManager] Lỗi load API keys:', e);
      this.keys = [];
      this.currentIndex = 0;
      this.injectBackupKeys();
    }
  }

  /**
   * Nạp các backup API key từ .env vào RAM (KHÔNG ghi xuống localStorage)
   */
  private injectBackupKeys(): void {
    let added = 0;
    for (const backup of BACKUP_API_KEYS) {
      if (!this.keys.some(k => k.key === backup.key)) {
        if (this.keys.length < MAX_KEYS) {
          this.keys.push({
            key: backup.key,
            name: backup.name,
            status: 'active',
            source: 'env',
            isHidden: true,
            errorCount: 0,
            modelCooldowns: {},
            addedAt: Date.now(),
          });
          added++;
        }
      }
    }
    if (added > 0) {
      console.log(`🔑 Đã nạp ngầm ${added} API key dự phòng từ cấu hình môi trường`);
    }
  }

  /**
   * Lưu CHỈ các key của người dùng vào localStorage (tuyệt đối không lưu key ẩn từ .env)
   */
  saveToStorage(): void {
    try {
      if (!hasLocalStorage()) return;
      const userKeys = this.keys.filter(k => k.source !== 'env');
      const activeUserKey = userKeys.find(k => k.status === 'active')?.key || userKeys[0]?.key || '';
      const currentKey = this.keys[this.currentIndex]?.key;
      const userCurrentIndex = Math.max(0, userKeys.findIndex(k => k.key === currentKey));

      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          keys: userKeys,
          currentIndex: userCurrentIndex,
        })
      );

      // Đồng bộ khóa tương thích ngược CHỈ cho key người dùng
      if (activeUserKey) {
        localStorage.setItem('gemini_api_key', activeUserKey);
        localStorage.setItem('examcraft_api_key', activeUserKey);
      } else {
        localStorage.removeItem('gemini_api_key');
        localStorage.removeItem('user_gemini_api_key');
        localStorage.removeItem('examcraft_api_key');
      }
    } catch (e) {
      console.error('[ApiKeyManager] Lỗi lưu API keys:', e);
    }
    this.notifyChanged();
  }

  /**
   * Kiểm tra và gỡ các cooldown đã hết hạn (cả cooldown chung lẫn cooldown theo từng model)
   */
  private checkAndResetCooldowns(): void {
    const now = Date.now();
    let hasChanges = false;

    this.keys.forEach(keyInfo => {
      if (keyInfo.modelCooldowns) {
        for (const [model, until] of Object.entries(keyInfo.modelCooldowns)) {
          if (until <= now) {
            delete keyInfo.modelCooldowns[model];
            hasChanges = true;
          }
        }
      }

      if (keyInfo.status === 'cooldown') {
        const generalExpired = !keyInfo.cooldownUntil || keyInfo.cooldownUntil <= now;
        const activeModelCooldowns = Object.values(keyInfo.modelCooldowns || {}).filter(t => t > now);
        if (generalExpired && activeModelCooldowns.length === 0) {
          keyInfo.status = 'active';
          keyInfo.errorCount = 0;
          keyInfo.cooldownUntil = undefined;
          keyInfo.lastError = undefined;
          keyInfo.lastErrorModel = undefined;
          hasChanges = true;
        } else if (generalExpired && activeModelCooldowns.length > 0 && activeModelCooldowns.length < FALLBACK_MODELS.length) {
          keyInfo.status = 'active';
          keyInfo.cooldownUntil = undefined;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      this.saveToStorage();
    }
  }

  /**
   * Thêm một API key mới của người dùng
   */
  addKey(key: string, name?: string): { success: boolean; message: string } {
    const trimmedKey = normalizeGoogleAiApiKey(key);
    if (!isValidGoogleAiApiKey(trimmedKey)) {
      return { success: false, message: 'API Key không đúng định dạng (cần bắt đầu bằng AIza... hoặc AQ...)' };
    }

    const existing = this.keys.find(k => k.key === trimmedKey);
    if (existing) {
      if (existing.status !== 'active' || (existing.modelCooldowns && Object.keys(existing.modelCooldowns).length > 0)) {
        existing.status = 'active';
        existing.errorCount = 0;
        existing.cooldownUntil = undefined;
        existing.modelCooldowns = {};
        existing.lastError = undefined;
        existing.lastErrorModel = undefined;
        this.saveToStorage();
      }
      return { success: false, message: 'Key này đã tồn tại trong danh sách' };
    }

    if (this.keys.length >= MAX_KEYS) {
      return { success: false, message: `Đã đạt giới hạn tối đa ${MAX_KEYS} API key` };
    }

    const userCount = this.keys.filter(k => k.source !== 'env').length;
    const newKey: ApiKeyInfo = {
      key: trimmedKey,
      name: name?.trim() || `Key ${userCount + 1}`,
      status: 'active',
      source: 'user',
      isHidden: false,
      errorCount: 0,
      modelCooldowns: {},
      addedAt: Date.now(),
    };

    // Chèn key người dùng TRƯỚC các key env ẩn để luôn ưu tiên key người dùng trước
    const firstEnvIdx = this.keys.findIndex(k => k.source === 'env');
    if (firstEnvIdx === -1) {
      this.keys.push(newKey);
    } else {
      this.keys.splice(firstEnvIdx, 0, newKey);
      if (this.currentIndex >= firstEnvIdx) {
        this.currentIndex++;
      }
    }

    this.saveToStorage();
    return { success: true, message: 'Đã thêm key thành công' };
  }

  /**
   * Thêm hàng loạt nhiều API key cùng lúc (tách theo dòng, dấu phẩy, chấm phẩy, khoảng trắng)
   */
  addKeysBulk(rawText: string, namePrefix = 'Key'): BulkAddResult {
    const tokens = (rawText || '')
      .split(/[\r\n,;\t ]+/)
      .map(token => normalizeGoogleAiApiKey(token))
      .filter(token => token.length > 0);

    let added = 0;
    let duplicates = 0;
    let invalid = 0;
    let limitReached = 0;
    const addedKeys: string[] = [];

    for (const token of tokens) {
      if (!isValidGoogleAiApiKey(token)) {
        invalid++;
        continue;
      }
      if (this.keys.some(k => k.key === token)) {
        duplicates++;
        continue;
      }
      if (this.keys.length >= MAX_KEYS) {
        limitReached++;
        continue;
      }
      const userCount = this.keys.filter(k => k.source !== 'env').length;
      const res = this.addKey(token, `${namePrefix} ${userCount + 1}`);
      if (res.success) {
        added++;
        addedKeys.push(token);
      }
    }

    return {
      added,
      duplicates,
      invalid,
      limitReached,
      total: this.keys.length,
      addedKeys,
    };
  }

  /**
   * Xóa một API key (chỉ cho xóa key của người dùng, bảo vệ key ẩn hệ thống)
   */
  removeKey(key: string): { success: boolean; message: string } {
    const index = this.keys.findIndex(k => k.key === key);
    if (index === -1) {
      return { success: false, message: 'Không tìm thấy key' };
    }
    if (this.keys[index].source === 'env') {
      return { success: false, message: 'Không thể xóa key dự phòng hệ thống' };
    }

    this.keys.splice(index, 1);

    if (index < this.currentIndex) {
      this.currentIndex--;
    }
    if (this.currentIndex >= this.keys.length) {
      this.currentIndex = 0;
    }
    this.saveToStorage();

    return { success: true, message: 'Đã xóa key' };
  }

  /**
   * Xóa toàn bộ key do người dùng nhập (giữ lại key dự phòng hệ thống nếu có)
   */
  clearAllUserKeys(): void {
    this.keys = this.keys.filter(k => k.source === 'env');
    this.currentIndex = 0;
    this.saveToStorage();
  }

  /**
   * Kiểm tra một cặp (key, model) có đang sẵn sàng gọi API hay không
   */
  isKeyModelAvailable(key: string, model?: string): boolean {
    this.checkAndResetCooldowns();
    const keyInfo = this.keys.find(k => k.key === key);
    if (!keyInfo) return true;
    if (keyInfo.status === 'error') return false;
    const now = Date.now();
    if (keyInfo.cooldownUntil && keyInfo.cooldownUntil > now) return false;
    if (model && keyInfo.modelCooldowns?.[model] && keyInfo.modelCooldowns[model] > now) {
      return false;
    }
    return true;
  }

  /**
   * Trả về danh sách các API key khả dụng cho một model cụ thể theo thứ tự ưu tiên xoay vòng
   */
  getAvailableKeysForModel(model: string, preferredKey?: string): string[] {
    this.checkAndResetCooldowns();
    if (this.keys.length === 0) return preferredKey ? [preferredKey] : [];

    const result: string[] = [];
    const addIfAvailable = (k: string) => {
      if (!k || result.includes(k)) return;
      if (this.isKeyModelAvailable(k, model)) {
        result.push(k);
      }
    };

    if (preferredKey) addIfAvailable(preferredKey);

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      addIfAvailable(this.keys[idx].key);
    }

    return result;
  }

  /**
   * Lấy key đang active (hoặc còn ít nhất 1 model khả dụng)
   */
  getActiveKey(model?: string): string | null {
    this.checkAndResetCooldowns();

    if (this.keys.length === 0) {
      return null;
    }

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const keyInfo = this.keys[idx];
      if (this.isKeyModelAvailable(keyInfo.key, model)) {
        this.currentIndex = idx;
        return keyInfo.key;
      }
    }

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const keyInfo = this.keys[idx];
      if (keyInfo.status !== 'error') {
        this.currentIndex = idx;
        return keyInfo.key;
      }
    }

    return null;
  }

  /**
   * Đánh dấu cặp (key, model) gặp lỗi quota/rate-limit với thời gian cooldown thông minh (RPM vs RPD)
   * — Giữ nguyên khả năng dùng key đó cho các model Free Tier khác!
   */
  markKeyModelQuotaError(
    key: string,
    model: string,
    errorType: 'QUOTA_EXCEEDED' | 'RATE_LIMIT',
    options?: { isPerMinute?: boolean; retryDelaySec?: number }
  ): ApiKeyRotationResult {
    this.checkAndResetCooldowns();
    const keyInfo = this.keys.find(k => k.key === key);
    if (!keyInfo) {
      return { success: false, hasMoreKeys: false, message: 'Không tìm thấy key trong danh sách' };
    }

    let cooldownMs = DEFAULT_COOLDOWN_MS;
    if (options?.retryDelaySec && options.retryDelaySec > 0) {
      cooldownMs = Math.min(Math.max((options.retryDelaySec + 3) * 1000, 15_000), RPD_COOLDOWN_MS);
    } else if (errorType === 'RATE_LIMIT' || options?.isPerMinute) {
      cooldownMs = RPM_COOLDOWN_MS;
    } else {
      cooldownMs = RPD_COOLDOWN_MS;
    }

    const until = Date.now() + cooldownMs;
    if (!keyInfo.modelCooldowns) keyInfo.modelCooldowns = {};
    keyInfo.modelCooldowns[model] = until;
    keyInfo.lastError = errorType;
    keyInfo.lastErrorModel = model;
    keyInfo.errorCount++;

    const now = Date.now();
    const blockedModels = FALLBACK_MODELS.filter(m => (keyInfo.modelCooldowns?.[m] || 0) > now);
    if (blockedModels.length >= FALLBACK_MODELS.length) {
      keyInfo.status = 'cooldown';
      keyInfo.cooldownUntil = Math.min(...blockedModels.map(m => keyInfo.modelCooldowns![m]));
    }

    this.saveToStorage();
    console.log(
      `⏸️ Key ${this.maskKey(key)} tạm nghỉ trên model ${model} (${Math.round(cooldownMs / 1000)}s) do ${errorType}. Còn ${FALLBACK_MODELS.length - blockedModels.length}/${FALLBACK_MODELS.length} model khả dụng trên key này.`
    );

    return this.rotateToNextKey(errorType, model);
  }

  /**
   * Đánh dấu key bị lỗi chung và xoay sang key tiếp theo
   */
  markKeyError(key: string, errorType: string, model?: string): ApiKeyRotationResult {
    const keyInfo = this.keys.find(k => k.key === key);
    if (!keyInfo) {
      return { success: false, hasMoreKeys: false, message: 'Không tìm thấy key' };
    }

    keyInfo.lastError = errorType;
    if (model) keyInfo.lastErrorModel = model;

    if (errorType === 'MODEL_OVERLOADED' || errorType === 'TRANSIENT_SERVER_ERROR' || errorType === 'NOT_FOUND' || errorType === 'NETWORK_ERROR') {
      this.saveToStorage();
      console.log(`⚠️ Model Gemini quá tải / lỗi tạm thời (${errorType}); key ${this.maskKey(key)} vẫn giữ active`);
      return {
        success: false,
        hasMoreKeys: this.hasAvailableKeys(),
        message: 'Model Gemini đang quá tải tạm thời; API key vẫn hoạt động.',
      };
    }

    if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
      if (model) {
        return this.markKeyModelQuotaError(key, model, errorType);
      }
      keyInfo.errorCount++;
      keyInfo.status = 'cooldown';
      keyInfo.cooldownUntil = Date.now() + (errorType === 'RATE_LIMIT' ? RPM_COOLDOWN_MS : DEFAULT_COOLDOWN_MS);
      this.saveToStorage();
      return this.rotateToNextKey(errorType);
    }

    keyInfo.errorCount++;
    if (errorType === 'INVALID_API_KEY') {
      keyInfo.status = 'error';
      console.log(`❌ Key ${this.maskKey(key)} không hợp lệ, đã đánh dấu lỗi`);
    } else if (errorType === 'PERMISSION_DENIED') {
      keyInfo.status = 'cooldown';
      keyInfo.cooldownUntil = Date.now() + RPD_COOLDOWN_MS;
      console.log(`🚫 Key ${this.maskKey(key)} không có quyền truy cập, tạm nghỉ và chuyển key khác`);
    }

    this.saveToStorage();
    return this.rotateToNextKey(errorType, model);
  }

  /**
   * Xoay sang key tiếp theo (tùy chọn lọc theo model cụ thể)
   */
  rotateToNextKey(reason: string = 'manual', model?: string): ApiKeyRotationResult {
    this.checkAndResetCooldowns();
    if (this.keys.length === 0) {
      return { success: false, hasMoreKeys: false, message: 'Chưa có API key nào' };
    }

    const fromKey = this.keys[this.currentIndex]?.key;

    for (let i = 1; i <= this.keys.length; i++) {
      const nextIndex = (this.currentIndex + i) % this.keys.length;
      const nextKey = this.keys[nextIndex];

      if (this.isKeyModelAvailable(nextKey.key, model)) {
        if (nextKey.key === fromKey && reason !== 'manual' && reason !== 'manual_retry') {
          continue;
        }
        this.currentIndex = nextIndex;
        this.saveToStorage();

        if (this.onKeyRotation && fromKey && fromKey !== nextKey.key) {
          this.onKeyRotation({
            fromKey: this.maskKey(fromKey),
            toKey: this.maskKey(nextKey.key),
            reason,
          });
        }

        return {
          success: true,
          hasMoreKeys: true,
          newKey: nextKey.key,
          message: `Đã chuyển sang ${nextKey.name} (${this.maskKey(nextKey.key)})`,
        };
      }
    }

    if (this.onAllKeysFailed) {
      this.onAllKeysFailed();
    }

    return {
      success: false,
      hasMoreKeys: false,
      message: model
        ? `Tất cả API key đều đã tạm nghỉ trên model ${model}`
        : 'Tất cả API key đều không khả dụng',
    };
  }

  /**
   * Thời gian ngắn nhất (ms) cho tới khi có ít nhất 1 key hết cooldown (trả về 0 nếu đang có key sẵn sàng)
   */
  getSoonestCooldownMs(model?: string): number | null {
    this.checkAndResetCooldowns();
    const now = Date.now();
    let soonest = Infinity;

    for (const k of this.keys) {
      if (k.status === 'error') continue;
      if (this.isKeyModelAvailable(k.key, model)) return 0;

      const generalUntil = k.cooldownUntil && k.cooldownUntil > now ? k.cooldownUntil : 0;
      const modelUntil =
        model && k.modelCooldowns?.[model] && k.modelCooldowns[model] > now
          ? k.modelCooldowns[model]
          : 0;
      const effectiveUntil = Math.max(generalUntil, modelUntil);
      if (effectiveUntil > now && effectiveUntil < soonest) {
        soonest = effectiveUntil;
      }
    }

    return soonest === Infinity ? null : Math.max(0, soonest - now);
  }

  getActiveModelCooldowns(key: string): Record<string, number> {
    this.checkAndResetCooldowns();
    const keyInfo = this.keys.find(k => k.key === key);
    if (!keyInfo?.modelCooldowns) return {};
    const now = Date.now();
    const active: Record<string, number> = {};
    for (const [m, until] of Object.entries(keyInfo.modelCooldowns)) {
      if (until > now) active[m] = until - now;
    }
    return active;
  }

  getAllKeys(): ApiKeyInfo[] {
    this.checkAndResetCooldowns();
    return this.keys.map(k => ({
      ...k,
      modelCooldowns: k.modelCooldowns ? { ...k.modelCooldowns } : {},
    }));
  }

  getUserKeys(): ApiKeyInfo[] {
    return this.getAllKeys().filter(k => k.source !== 'env');
  }

  getHiddenEnvKeyCount(): number {
    return this.keys.filter(k => k.source === 'env').length;
  }

  getKeyStats(): {
    total: number;
    active: number;
    error: number;
    cooldown: number;
    userTotal: number;
    envTotal: number;
    partialCooldown: number;
  } {
    this.checkAndResetCooldowns();
    const now = Date.now();
    const partialCooldown = this.keys.filter(k => {
      if (k.status !== 'active') return false;
      return Object.values(k.modelCooldowns || {}).some(t => t > now);
    }).length;

    return {
      total: this.keys.length,
      active: this.keys.filter(k => k.status === 'active').length,
      error: this.keys.filter(k => k.status === 'error').length,
      cooldown: this.keys.filter(k => k.status === 'cooldown').length,
      userTotal: this.keys.filter(k => k.source !== 'env').length,
      envTotal: this.keys.filter(k => k.source === 'env').length,
      partialCooldown,
    };
  }

  resetKey(key: string): { success: boolean; message: string } {
    const keyInfo = this.keys.find(k => k.key === key);
    if (!keyInfo) {
      return { success: false, message: 'Không tìm thấy key' };
    }

    keyInfo.status = 'active';
    keyInfo.errorCount = 0;
    keyInfo.cooldownUntil = undefined;
    keyInfo.modelCooldowns = {};
    keyInfo.lastError = undefined;
    keyInfo.lastErrorModel = undefined;

    this.saveToStorage();
    return { success: true, message: 'Đã kích hoạt lại key' };
  }

  updateKeyName(key: string, newName: string): { success: boolean; message: string } {
    const keyInfo = this.keys.find(k => k.key === key);
    if (!keyInfo) {
      return { success: false, message: 'Không tìm thấy key' };
    }

    keyInfo.name = newName.trim() || keyInfo.name;
    this.saveToStorage();
    return { success: true, message: 'Đã cập nhật tên key' };
  }

  maskKey(key: string): string {
    return maskGoogleAiApiKey(key);
  }

  hasAvailableKeys(model?: string): boolean {
    this.checkAndResetCooldowns();
    return this.keys.some(k => this.isKeyModelAvailable(k.key, model));
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getMaxKeys(): number {
    return MAX_KEYS;
  }

  setActiveKey(keyOrIndex: string | number): { success: boolean; message: string } {
    let index: number;

    if (typeof keyOrIndex === 'number') {
      index = keyOrIndex;
    } else {
      const normalized = normalizeGoogleAiApiKey(keyOrIndex);
      index = this.keys.findIndex(k => k.key === normalized);
    }

    if (index < 0 || index >= this.keys.length) {
      return { success: false, message: 'Key không tồn tại' };
    }

    const keyInfo = this.keys[index];
    keyInfo.status = 'active';
    keyInfo.errorCount = 0;
    keyInfo.cooldownUntil = undefined;
    keyInfo.modelCooldowns = {};
    keyInfo.lastError = undefined;
    keyInfo.lastErrorModel = undefined;

    this.currentIndex = index;
    this.saveToStorage();
    console.log(`✅ Đã đặt ${keyInfo.name} (${this.maskKey(keyInfo.key)}) làm key ưu tiên`);
    return { success: true, message: `Đã chuyển sang ${keyInfo.name}` };
  }

  resetAllKeys(): { success: boolean; message: string } {
    let resetCount = 0;
    this.keys.forEach(keyInfo => {
      const hadCooldowns = keyInfo.modelCooldowns && Object.keys(keyInfo.modelCooldowns).length > 0;
      if (keyInfo.status !== 'active' || hadCooldowns) {
        keyInfo.status = 'active';
        keyInfo.errorCount = 0;
        keyInfo.cooldownUntil = undefined;
        keyInfo.modelCooldowns = {};
        keyInfo.lastError = undefined;
        keyInfo.lastErrorModel = undefined;
        resetCount++;
      }
    });

    this.saveToStorage();
    console.log(`🔄 Đã reset ${resetCount} key về trạng thái sẵn sàng`);
    return { success: true, message: `Đã làm mới ${resetCount} key` };
  }

  getNextAvailableKey(model?: string): string | null {
    this.checkAndResetCooldowns();
    for (let i = 1; i <= this.keys.length; i++) {
      const nextIndex = (this.currentIndex + i) % this.keys.length;
      const nextKey = this.keys[nextIndex];
      if (this.isKeyModelAvailable(nextKey.key, model)) {
        return nextKey.key;
      }
    }
    return null;
  }
}

export const apiKeyManager = new ApiKeyManager();
