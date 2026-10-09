/** 公開付款結果頁只顯示信箱線索，避免單號連結洩漏完整地址。 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}
