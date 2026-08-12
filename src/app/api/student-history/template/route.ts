// 學員資料庫匯入範本：UTF-8 BOM 讓 Excel 在 macOS／Windows 開啟時正確顯示中文。
// 電話擺第一欄：它是學員的識別鍵（同號碼＝同一人）；Email 夫妻／親子常共用，不能拿來認人。
export async function GET() {
  const csv =
    "﻿電話,姓名,Email,課程,上課日期,備註\r\n0912345678,王小明,student@example.com,量子投資課程,2025-08-06,範例資料，請刪除後再匯入\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=student-history-import-template.csv",
      "Cache-Control": "no-store",
    },
  });
}
