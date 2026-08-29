"use server";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEditor } from "@/lib/auth/staff";
import { decodeCsvBuffer } from "@/lib/csv";
import { normalizeMobile } from "@/lib/sms/phone";
export type StudentImportState={error?:string;success?:string; imported?:number; histories?:number; noPhone?:number}|null;
const aliases={email:["email","信箱","電子信箱","e-mail"],name:["姓名","name","學員姓名"],phone:["電話","手機","phone"],course:["課程","課程名稱","course"],date:["上課日期","日期","date"],note:["備註","note"]};
const val=(row:string[],headers:string[],key:keyof typeof aliases)=>{const i=headers.findIndex(h=>aliases[key].includes(h.toLowerCase()));return i<0?"":(row[i]??"").trim()};

/** 學員資料庫匯入。識別鍵是手機——同一支號碼只會有一筆學員，重複匯入是更新不是新增。
 *  只有 email 沒有手機的舊名單仍可匯入，但共用信箱的兩個人會被併成同一筆
 *  （夫妻共用信箱很常見），所以回報會列出「沒有手機」的筆數提醒補齊。 */
export async function importStudentHistory(_p:StudentImportState,fd:FormData):Promise<StudentImportState>{await requireEditor();const f=fd.get("file");if(!(f instanceof File)||!f.size)return{error:"請選擇 CSV 或 XLSX 檔"};let rows:string[][]=[];try{if(/\.csv$/i.test(f.name))rows=decodeCsvBuffer(await f.arrayBuffer()).split(/\r?\n/).filter(Boolean).map(x=>x.split(",").map(v=>v.trim().replace(/^"|"$/g,"")));else{const wb=new ExcelJS.Workbook();await wb.xlsx.load(await f.arrayBuffer());const ws=wb.worksheets[0];rows=ws.getSheetValues().slice(1).map((r:any)=>r.slice(1).map((v:any)=>String(v??"").trim()));}}catch{return{error:"檔案無法解析，請使用 CSV 或 XLSX"}}if(rows.length<2)return{error:"檔案沒有資料列"};const headers=rows.shift()!.map(x=>x.toLowerCase());if(!headers.some(h=>aliases.phone.includes(h))&&!headers.some(h=>aliases.email.includes(h)))return{error:"需要「電話」欄位（或至少要有 Email 欄位）"};
  let imported=0,histories=0,noPhone=0;
  for(const row of rows){
    const phone=normalizeMobile(val(row,headers,"phone"));
    const email=val(row,headers,"email").toLowerCase();
    const name=val(row,headers,"name");
    if(!phone&&!email.includes("@"))continue; // 兩個識別欄位都沒有就跳過
    let record;
    if(phone){
      record=await prisma.studentRecord.upsert({where:{phone},update:{name:name||undefined,email:email||undefined},create:{phone,name:name||null,email:email||null}});
    }else{
      noPhone++;
      const found=await prisma.studentRecord.findFirst({where:{email}});
      record=found
        ?await prisma.studentRecord.update({where:{id:found.id},data:{name:name||undefined}})
        :await prisma.studentRecord.create({data:{email,name:name||null}});
    }
    imported++;
    const course=val(row,headers,"course");
    if(course){
      const date=val(row,headers,"date");
      await prisma.studentCourseHistory.create({data:{studentId:record.id,courseName:course,attendedAt:date?new Date(date):null,note:val(row,headers,"note")||null,source:"IMPORT"}});
      histories++;
    }
  }
  revalidatePath("/admin/students");
  return{success:"匯入完成",imported,histories,noPhone};
}

/** 依手機（優先）或 email 找/建學員檔；姓名/信箱只補空不覆蓋（匯入資料品質參差） */
async function upsertStudent(
  phone: string | null,
  email: string | null,
  name: string | null,
): Promise<{ id: string } | null> {
  if (phone) {
    return prisma.studentRecord.upsert({
      where: { phone },
      update: { name: name || undefined, email: email || undefined },
      create: { phone, name, email },
      select: { id: true },
    });
  }
  if (email) {
    const found = await prisma.studentRecord.findFirst({
      where: { email },
      select: { id: true },
    });
    if (found) return found;
    return prisma.studentRecord.create({ data: { email, name }, select: { id: true } });
  }
  return null;
}

/** 已有同鍵紀錄就跳過（防重複匯入把記錄卡灌成十筆一樣的） */
async function addHistoryOnce(
  studentId: string,
  courseName: string,
  attendedAt: Date | null,
  source: string,
  note: string,
): Promise<boolean> {
  const exists = await prisma.studentCourseHistory.findFirst({
    where: { studentId, note },
    select: { id: true },
  });
  if (exists) return false;
  await prisma.studentCourseHistory.create({
    data: { studentId, courseName, attendedAt, source, note },
  });
  return true;
}

export type OrderHistoryImportState = {
  error?: string;
  success?: string;
  students?: number;
  histories?: number;
  duplicates?: number;
  noContact?: number;
} | null;

/** 1shop 訂單檔直接匯入上課紀錄（免轉 CSV 範本）。
 *  已付款的每一列 = 一筆紀錄；課程名 = 產品欄原文（通常含場次日期）；
 *  同行者有電話/信箱的也各自建卡。防重複鍵 = 訂單編號＋產品（重傳同檔不會灌爆）。 */
export async function importStudentHistoryFromOrders(
  _p: OrderHistoryImportState,
  fd: FormData,
): Promise<OrderHistoryImportState> {
  await requireEditor();
  const f = fd.get("file");
  if (!(f instanceof File) || !f.size) return { error: "請選擇 1shop 訂單檔（.xlsx / .csv）" };
  if (f.size > 20 * 1024 * 1024) return { error: "檔案請小於 20MB" };

  const { parseOrderFile } = await import("@/lib/session-import");
  const { normalizeContactPhone } = await import("@/lib/sms/phone");
  let rows;
  try {
    rows = (await parseOrderFile(await f.arrayBuffer())).rows;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "檔案無法解析" };
  }

  const touched = new Set<string>();
  let histories = 0,
    duplicates = 0,
    noContact = 0;
  for (const r of rows) {
    if (!r.orderNo || !r.name || !r.product) continue;
    if (!r.paymentStatus.includes("已付款")) continue;
    const phone = r.phone ? normalizeContactPhone(r.phone) : null;
    const email = r.email.toLowerCase().includes("@") ? r.email.toLowerCase() : null;
    const buyer = await upsertStudent(phone, email, r.name || null);
    if (!buyer) {
      noContact++;
    } else {
      touched.add(buyer.id);
      const ok = await addHistoryOnce(
        buyer.id,
        r.product,
        r.orderedAt,
        "1SHOP",
        `訂單 ${r.orderNo}｜${r.product}`,
      );
      ok ? histories++ : duplicates++;
    }
    // 同行者：有電話或信箱才認得出人（沒有就無法建卡，跳過不硬猜）
    for (const a of r.attendees) {
      if (a.key === "buyer") continue;
      const ap = a.phone ? normalizeContactPhone(a.phone) : null;
      const ae = a.email?.toLowerCase().includes("@") ? a.email.toLowerCase() : null;
      const rec = await upsertStudent(ap, ae, a.name || null);
      if (!rec) {
        noContact++;
        continue;
      }
      touched.add(rec.id);
      const ok = await addHistoryOnce(
        rec.id,
        r.product,
        r.orderedAt,
        "1SHOP",
        `訂單 ${r.orderNo}｜${r.product}｜同行 ${a.name}`,
      );
      ok ? histories++ : duplicates++;
    }
  }
  revalidatePath("/admin/students");
  return {
    success: "訂單檔匯入完成",
    students: touched.size,
    histories,
    duplicates,
    noContact,
  };
}

/** 場次看板名單一鍵同步：已結束場次的報名者（不含工作人員/延期出去的）
 *  寫進上課紀錄。防重複鍵 = 場次 id，按幾次都不會重複。 */
export async function syncSessionHistoriesAction(): Promise<OrderHistoryImportState> {
  await requireEditor();
  const sessions = await prisma.courseSession.findMany({
    where: { eventDate: { not: null } },
    select: {
      id: true,
      title: true,
      eventDate: true,
      endDate: true,
      signups: {
        where: { deferredToSessionId: null, isStaff: false },
        select: { name: true, phone: true, email: true },
      },
    },
  });
  // 只同步已結束的場次——還沒上的課不算「上過」
  const now = Date.now();
  const ended = sessions.filter((s) => {
    const end = s.endDate ?? s.eventDate;
    return end !== null && end.getTime() < now;
  });

  const touched = new Set<string>();
  let histories = 0,
    duplicates = 0,
    noContact = 0;
  for (const s of ended) {
    for (const g of s.signups) {
      const email = g.email?.toLowerCase().includes("@") ? g.email.toLowerCase() : null;
      const rec = await upsertStudent(g.phone ?? null, email, g.name || null);
      if (!rec) {
        noContact++;
        continue;
      }
      touched.add(rec.id);
      const ok = await addHistoryOnce(
        rec.id,
        s.title,
        s.eventDate,
        "SESSION",
        `場次 ${s.id}`,
      );
      ok ? histories++ : duplicates++;
    }
  }
  revalidatePath("/admin/students");
  return {
    success: `已同步 ${ended.length} 個已結束場次`,
    students: touched.size,
    histories,
    duplicates,
    noContact,
  };
}

// ---- 課名歸戶（標準課程主檔 + 課名別名） ----

const canonPaths = () => {
  revalidatePath("/admin/students/courses");
  revalidatePath("/admin/students");
};

/** 建立或更新標準課程。id 有值 = 更新；空 = 新建（slug 用亂數） */
export async function saveCanonicalCourseAction(fd: FormData): Promise<void> {
  await requireEditor();
  const id = String(fd.get("id") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  const kind = String(fd.get("kind") ?? "COURSE");
  const level = String(fd.get("level") ?? "").trim() || null;
  if (!name) return;
  if (id) await prisma.canonicalCourse.update({ where: { id }, data: { name, kind, level } });
  else await prisma.canonicalCourse.create({ data: { id: crypto.randomUUID().slice(0, 8), name, kind, level, sortOrder: 999 } });
  canonPaths();
}

/** 指派（或改派）課名到標準課程；courseId 空值 = 取消歸戶 */
export async function assignCourseAliasAction(fd: FormData): Promise<void> {
  const role = await requireEditor();
  const rawName = String(fd.get("rawName") ?? "");
  const courseId = String(fd.get("courseId") ?? "").trim();
  if (!rawName) return;
  if (!courseId) await prisma.studentCourseAlias.deleteMany({ where: { rawName } });
  else
    await prisma.studentCourseAlias.upsert({
      where: { rawName },
      update: { courseId, updatedBy: role },
      create: { rawName, courseId, updatedBy: role },
    });
  canonPaths();
}
