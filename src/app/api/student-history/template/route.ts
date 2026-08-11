// 學員資料庫匯入範本：UTF-8 BOM 讓 Excel 在 macOS／Windows 開啟時正確顯示中文。
export async function GET() {
  const csv = "\uFEFFEmail,姓名,電話,課程,上課日期,備註\r\nstudent@example.com,王小明,0912345678,量子投資課程,2025-08-06,範例資料，請刪除後再匯入\r\n";
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=student-history-import-template.csv",
      "Cache-Control": "no-store",
    },
  });
}
