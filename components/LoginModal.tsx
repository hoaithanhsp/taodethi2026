import React, { useState, useEffect, useRef } from 'react';
import { validateAccount, Account } from '../data/accounts';

// ============================================
// CONSTANTS — Quản lý phiên đăng nhập & dùng thử
// ============================================
const AUTH_KEY = 'examcraft_auth';
const TRIAL_KEY = 'examcraft_trial_used';

export interface AuthState {
  isAuthenticated: boolean;
  user: Account | null;
  trialUsed: boolean;
}

/** Lấy trạng thái auth từ localStorage */
export function getAuthState(): AuthState {
  const trialUsed = localStorage.getItem(TRIAL_KEY) === 'true';

  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      const user = JSON.parse(saved) as Account;
      return { isAuthenticated: true, user, trialUsed };
    }
  } catch {}

  return { isAuthenticated: false, user: null, trialUsed };
}

/** Lưu auth vào localStorage */
export function saveAuth(user: Account) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

/** Xóa auth */
export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
}

/** Đánh dấu đã dùng thử */
export function markTrialUsed() {
  localStorage.setItem(TRIAL_KEY, 'true');
}

/** Kiểm tra đã dùng thử chưa */
export function isTrialUsed(): boolean {
  return localStorage.getItem(TRIAL_KEY) === 'true';
}

// ============================================
// COMPONENT: LoginModal
// ============================================
interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: Account) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  // Focus input khi mở
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => usernameRef.current?.focus(), 200);
      setError('');
      setUsername('');
      setPassword('');
    }
  }, [isOpen]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      setError('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.');
      triggerShake();
      return;
    }

    const account = validateAccount(username, password);
    if (account) {
      saveAuth(account);
      onLoginSuccess(account);
      setError('');
    } else {
      setError('Sai tên đăng nhập hoặc mật khẩu!');
      triggerShake();
    }
  };

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 500);
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
      animation: 'loginFadeIn 0.3s ease-out',
    }}>
      <div
        style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          maxWidth: '420px',
          width: '100%',
          margin: '0 16px',
          overflow: 'hidden',
          animation: isShaking ? 'loginShake 0.5s ease-in-out' : 'loginScaleIn 0.3s ease-out',
        }}
      >
        {/* Header gradient */}
        <div style={{
          background: 'linear-gradient(135deg, #0d9488 0%, #10b981 50%, #0d9488 100%)',
          padding: '24px',
          color: '#fff',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Decorative circles */}
          <div style={{
            position: 'absolute', top: '-24px', right: '-24px',
            width: '96px', height: '96px',
            backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '50%',
          }} />
          <div style={{
            position: 'absolute', bottom: '-16px', left: '-16px',
            width: '64px', height: '64px',
            backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '50%',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '48px', height: '48px',
                backgroundColor: 'rgba(255,255,255,0.2)',
                borderRadius: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                  Yêu cầu đăng nhập
                </h3>
                <p style={{ fontSize: '13px', color: 'rgba(204,251,241,0.9)', fontWeight: 500, margin: '4px 0 0' }}>
                  Tạo Đề Thi Theo CV 7991 — Bằng AI
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '24px' }}>
          {/* Thông báo hết lượt dùng thử */}
          <div style={{
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 700, color: '#92400e', margin: 0 }}>
                  Bạn đã hết lượt dùng thử miễn phí!
                </p>
                <p style={{ fontSize: '12px', color: '#a16207', marginTop: '6px', lineHeight: 1.5 }}>
                  Vui lòng đăng nhập để tiếp tục sử dụng. Liên hệ cấp tài khoản:
                </p>
                <a
                  href="https://zalo.me/0348296773"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginTop: '8px',
                    padding: '6px 12px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    transition: 'background-color 0.2s',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1d4ed8')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                  Zalo: 0348296773
                </a>
                <p style={{
                  fontSize: '10px', color: '#d97706', marginTop: '8px', fontWeight: 500,
                }}>
                  💡 Đăng nhập 1 lần → dùng vĩnh viễn + được cập nhật mới nhất
                </p>
              </div>
            </div>
          </div>

          {/* Form đăng nhập */}
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Username */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                📧 Tên đăng nhập (Email)
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  ref={usernameRef}
                  type="text"
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(''); }}
                  placeholder="Nhập email được cấp..."
                  style={{
                    width: '100%',
                    borderRadius: '12px',
                    border: '2px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    padding: '12px 40px 12px 16px',
                    fontSize: '14px',
                    color: '#1e293b',
                    outline: 'none',
                    transition: 'all 0.2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#0d9488'; e.target.style.boxShadow = '0 0 0 3px rgba(13,148,136,0.15)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
                  autoComplete="username"
                />
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8',
                }}>
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                🔑 Mật khẩu
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="Nhập mật khẩu..."
                  style={{
                    width: '100%',
                    borderRadius: '12px',
                    border: '2px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                    padding: '12px 40px 12px 16px',
                    fontSize: '14px',
                    color: '#1e293b',
                    outline: 'none',
                    transition: 'all 0.2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={(e) => { e.target.style.borderColor = '#0d9488'; e.target.style.boxShadow = '0 0 0 3px rgba(13,148,136,0.15)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#94a3b8', padding: '2px', display: 'flex',
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#b91c1c',
                padding: '10px 16px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                animation: 'loginFadeIn 0.3s ease-out',
              }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                {error}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '12px', paddingTop: '4px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  backgroundColor: '#f1f5f9',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#475569',
                  fontWeight: 500,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#e2e8f0')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#f1f5f9')}
              >
                Để sau
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, #0d9488, #10b981)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(13,148,136,0.25)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #0f766e, #059669)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #0d9488, #10b981)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                🔓 Đăng nhập
              </button>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div style={{
          backgroundColor: '#f8fafc',
          borderTop: '1px solid #e2e8f0',
          padding: '12px 24px',
        }}>
          <p style={{
            fontSize: '10px', color: '#94a3b8', textAlign: 'center', lineHeight: 1.5, margin: 0,
          }}>
            Liên hệ <strong style={{ color: '#0f766e' }}>Zalo: 0348296773</strong> để được cấp tài khoản dùng vĩnh viễn & update mới nhất
          </p>
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes loginShake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-6px); }
          20%, 40%, 60%, 80% { transform: translateX(6px); }
        }
        @keyframes loginScaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes loginFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
