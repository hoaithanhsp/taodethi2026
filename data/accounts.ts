// ============================================
// DANH SÁCH TÀI KHOẢN ĐƯỢC CẤP PHÉP
// ============================================

export interface Account {
  username: string;
  password: string;
  name: string;
}

export const ACCOUNTS: Account[] = [
  { username: "duonghangdtntls@gmail.com", password: "SKKN100", name: "GV" },
  { username: "ngocthanhluong2023@gmail.com", password: "123456", name: "GV" },
  { username: "Phungthiphuonglinh_c2pdg@pgdthanhxuan.edu.vn", password: "123456", name: "GV" },
  { username: "phuocthotran96@gmail.com", password: "SKKN100", name: "GV" },
  { username: "Hoanchogao@gmail.com", password: "SKKN100", name: "GV" },
  { username: "Haohamm1999@gmail.com", password: "SKKN100", name: "GV" },
  { username: "hasonha75@gmail.com", password: "SKKN100", name: "GV" },
  { username: "sirthanhdb20682@gmail.com", password: "SKKN100", name: "GV" },
  { username: "KTD", password: "SKKN100", name: "GV" },
  { username: "ntphucthao@gmail.com", password: "SKKN100", name: "GV" },
  { username: "thanhhuanhb@gmail.com", password: "SKKN100", name: "GV" },
  { username: "hophuong333@gmail.com", password: "SKKN100", name: "GV" },
  { username: "votruongtoanga@gmail.com", password: "SKKN100", name: "GV" },
  { username: "Vutrungta1984@gmail.com", password: "SKKN100", name: "GV" },
  { username: "vominhnhi18@gmail.com", password: "SKKN100", name: "GV" },
  { username: "khacthuy@gmail.com", password: "SKKN100", name: "GV" },
  { username: "viethungcg@gmail.com", password: "SKKN100", name: "GV" },
  { username: "Letrang1571997@gmail.com", password: "SKKN100", name: "GV" },
  { username: "VIPKIMCUONG", password: "123456", name: "GV" },
  { username: "Beovan54@gmail.com", password: "SKKN100", name: "GV" },
  { username: "trivvt@gmail.com", password: "SKKN100", name: "GV" },
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
