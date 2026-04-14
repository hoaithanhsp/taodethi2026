// ============================================
// DANH SÁCH TÀI KHOẢN ĐƯỢC CẤP PHÉP
// ============================================

export interface Account {
  username: string;
  password: string;
  name: string;
}

export const ACCOUNTS: Account[] = [
  {
    username: "duonghangdtntls@gmail.com",
    password: "SKKN100",
    name: "GV",
  },
];

/**
 * Xác thực tài khoản
 * @returns Account nếu hợp lệ, null nếu sai
 */
export function validateAccount(username: string, password: string): Account | null {
  const trimmedUser = username.trim().toLowerCase();
  const trimmedPass = password.trim();

  return ACCOUNTS.find(
    (acc) => acc.username.toLowerCase() === trimmedUser && acc.password === trimmedPass
  ) || null;
}
