"use server";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireFullAdmin } from "@/lib/auth/staff";
import { normalizeMobile } from "@/lib/sms/phone";
import { compatibleName } from "@/lib/session-history-sync";

export type LegacyRow = { name: string | null; email: string | null; phone: string | null; status: string; courses: string[]; mapped: string[] };
export type LegacyPreviewState = { error?: string; rows?: LegacyRow[]; unmapped?: string[] } | null;
const statuses = new Set(["NONE","ACTIVE","TO_MIGRATE","MIGRATED","UNKNOWN"]);
export async function previewLegacyMigrationAction(_prev: LegacyPreviewState, fd: FormData): Promise<LegacyPreviewState> {
  await requireFullAdmin(); const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "請選擇 CSV 或 XLSX 檔案" };
  const wb = new ExcelJS.Workbook(); const buffer = Buffer.from(await file.arrayBuffer());
  if (file.name.toLowerCase().endsWith(".csv")) await wb.csv.read(Readable.from(buffer)); else await wb.xlsx.load(buffer as never);
  const ws = wb.worksheets[0]; if (!ws) return { error: "檔案沒有工作表" };
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? "").trim().toLowerCase());
  const idx = (names: string[]) => headers.findIndex((h) => names.includes(h)) + 1;
  const cols = { name: idx(["name","姓名"]), email: idx(["email","信箱"]), phone: idx(["phone","手機","電話"]), status: idx(["legacy_status","舊官網狀態"]), courses: idx(["legacy_courses","舊課程","課程"])};
  if (!cols.name && !cols.email && !cols.phone) return { error: "至少需要姓名、Email 或手機欄位" };
  const raw: Omit<LegacyRow,"mapped">[] = [];
  ws.eachRow((row, no) => { if (no === 1) return; const text = (col: number) => col ? String(row.getCell(col).text ?? "").trim() : "";
    const name=text(cols.name)||null,email=text(cols.email).toLowerCase()||null,phone=normalizeMobile(text(cols.phone))||null,status=text(cols.status).toUpperCase()||"TO_MIGRATE";
    const courses=text(cols.courses).split(/[;；、\n]+/).map((v)=>v.trim()).filter(Boolean); if (name||email||phone) raw.push({name,email,phone,status:statuses.has(status)?status:"UNKNOWN",courses}); });
  if (raw.length > 2000) return { error: "每次最多 2,000 筆" };
  const names=[...new Set(raw.flatMap((r)=>r.courses))]; const aliases=names.length?await prisma.studentCourseAlias.findMany({where:{rawName:{in:names}},include:{course:true}}):[];
  const map=new Map(aliases.map((a)=>[a.rawName,a.course.name])); const rows=raw.map((r)=>({...r,mapped:r.courses.map((c)=>map.get(c)??`未對照：${c}`)}));
  return { rows, unmapped:names.filter((n)=>!map.has(n)) };
}

export type LegacyCommitState={error?:string;created?:number;updated?:number;histories?:number;conflicts?:number}|null;
export async function commitLegacyMigrationAction(_prev:LegacyCommitState,fd:FormData):Promise<LegacyCommitState>{
  await requireFullAdmin(); let rows:LegacyRow[]; try{rows=JSON.parse(String(fd.get("rows")??"[]"));}catch{return{error:"預覽資料已失效，請重新上傳"};}
  if(!Array.isArray(rows)||!rows.length||rows.length>2000)return{error:"匯入資料筆數不正確"}; let created=0,updated=0,histories=0,conflicts=0;
  for(const row of rows){let student=row.phone?await prisma.studentRecord.findUnique({where:{phone:row.phone}}):null;if(student&&!compatibleName(student.name,row.name)){conflicts++;continue;}
    if(!student&&row.email){const matches=await prisma.studentRecord.findMany({where:{email:row.email}});const compatible=matches.filter((s)=>compatibleName(s.name,row.name));if(compatible.length>1||(matches.length&&compatible.length===0)){conflicts++;continue;}student=compatible[0]??null;}
    if(!student){student=await prisma.studentRecord.create({data:{name:row.name,email:row.email,phone:row.phone,legacyAccessStatus:statuses.has(row.status)?row.status:"UNKNOWN"}});created++;}
    else{await prisma.studentRecord.update({where:{id:student.id},data:{name:student.name||row.name,email:student.email||row.email,phone:student.phone||row.phone,legacyAccessStatus:statuses.has(row.status)?row.status:"UNKNOWN"}});updated++;}
    for(const courseName of row.courses){const exists=await prisma.studentCourseHistory.findFirst({where:{studentId:student.id,courseName,source:"LEGACY_IMPORT"}});if(!exists){await prisma.studentCourseHistory.create({data:{studentId:student.id,courseName,source:"LEGACY_IMPORT",note:"舊官網搬遷匯入"}});histories++;}}
    await prisma.studentDataAuditLog.create({data:{studentId:student.id,action:"LEGACY_MIGRATION_IMPORT",afterJson:{status:row.status,courseCount:row.courses.length}}});
  }
  revalidatePath("/admin/students/legacy-migration");revalidatePath("/admin/people");return{created,updated,histories,conflicts};
}
