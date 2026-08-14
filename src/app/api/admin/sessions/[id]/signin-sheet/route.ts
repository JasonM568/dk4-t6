import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { formatMobile } from "@/lib/sms/phone";
import { isRetrainSignup, mealLabel, computeRosterStats } from "@/lib/session-roster";

// 場次簽到表匯出（Excel）：依組別排序、含葷素與新舊生標記、末尾用餐彙總。
// 用 requireEditor（throw → 403）而非 pageGuardEditor（redirect）——下載連結吃 3xx 會存到錯誤內容。

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireEditor();
  } catch {
    return new Response("需要編輯權限", { status: 403 });
  }
  const { id } = await params;
  const session = await prisma.courseSession.findUnique({
    where: { id },
    include: {
      // 延出者不上簽到表
      signups: { where: { deferredToSessionId: null } },
    },
  });
  if (!session) return new Response("場次不存在", { status: 404 });

  // 依組別排序（未分組其次、工作人員最後）→ 組內依報名時間
  const rows = [...session.signups].sort((a, b) => {
    const ga = a.isStaff ? Number.MAX_SAFE_INTEGER : (a.groupNo ?? Number.MAX_SAFE_INTEGER - 1);
    const gb = b.isStaff ? Number.MAX_SAFE_INTEGER : (b.groupNo ?? Number.MAX_SAFE_INTEGER - 1);
    if (ga !== gb) return ga - gb;
    const ta = a.orderedAt?.getTime() ?? a.createdAt.getTime();
    const tb = b.orderedAt?.getTime() ?? b.createdAt.getTime();
    return ta - tb || a.id.localeCompare(b.id);
  });
  const stats = computeRosterStats(session.signups);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("簽到表");
  ws.columns = [
    { header: "組別", key: "group", width: 10 },
    { header: "姓名", key: "name", width: 16 },
    { header: "新舊生", key: "type", width: 8 },
    { header: "葷素", key: "meal", width: 10 },
    { header: "手機", key: "phone", width: 16 },
    { header: "簽名", key: "sign", width: 28 },
  ];

  // 標題列（場次名＋日期）插到最前面
  const dateText = session.eventDate
    ? session.eventDate.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })
    : "";
  ws.insertRow(1, [`${session.title}${dateText ? `　${dateText}` : ""}　簽到表`]);
  ws.mergeCells(1, 1, 1, 6);
  ws.getRow(1).font = { size: 14, bold: true };
  ws.getRow(1).height = 24;
  ws.getRow(2).font = { bold: true };

  for (const s of rows) {
    const row = ws.addRow({
      group: s.isStaff ? "工作人員" : s.groupNo ? `第 ${s.groupNo} 組` : "未分組",
      name: s.name,
      type: s.isStaff ? "工作人員" : isRetrainSignup(s) ? "舊生" : "新生",
      meal: mealLabel(s.meal),
      phone: s.phone ? formatMobile(s.phone) : "",
      sign: "",
    });
    row.height = 26; // 留手寫簽名空間
  }

  // 全表框線（標題列除外）
  for (let r = 2; r <= ws.rowCount; r++) {
    for (let c = 1; c <= 6; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin" }, bottom: { style: "thin" },
        left: { style: "thin" }, right: { style: "thin" },
      };
    }
  }

  // 用餐彙總（未標往安全側算葷）
  ws.addRow([]);
  const summary = ws.addRow([
    `學員 ${stats.total}（新生 ${stats.fresh}／舊生 ${stats.retrain}）` +
      (stats.staff > 0 ? `｜工作人員 ${stats.staff}` : "") +
      `｜用餐：葷 ${stats.meat}（含未標 ${stats.mealUnknown}）、素 ${stats.veg}（用餐統計含工作人員）`,
  ]);
  ws.mergeCells(summary.number, 1, summary.number, 6);
  summary.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const filename = `${session.title}-簽到表.xlsx`;
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // ASCII fallback + RFC 5987 中文檔名
      "Content-Disposition": `attachment; filename="signin-sheet.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
