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
