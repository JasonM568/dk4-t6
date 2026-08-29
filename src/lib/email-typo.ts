// 常見信箱網域打錯偵測（防呆第一關：信寄得再好，地址錯了都收不到）。
// 純函式，前後台與各報名表單共用。

const DOMAIN_FIXES: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmali.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.comm": "gmail.com",
  "gmil.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmall.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com.tw",
  "yaho.com.tw": "yahoo.com.tw",
  "outlok.com": "outlook.com",
  "icloud.co": "icloud.com",
  "icould.com": "icloud.com",
};

/** 網域疑似打錯時回傳建議的完整信箱；沒問題回 null。 */
export function suggestEmailFix(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).toLowerCase();
  const fixed = DOMAIN_FIXES[domain];
  return fixed ? email.slice(0, at + 1) + fixed : null;
}
