import "server-only";

/** 解碼上傳的 CSV：先試 UTF-8，出現亂碼字元再退回 Big5（台灣舊版 Excel 匯出） */
export function decodeCsvBuffer(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("big5").decode(buf);
  } catch {
    return utf8;
  }
}
