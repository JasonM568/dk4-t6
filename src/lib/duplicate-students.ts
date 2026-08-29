export type DuplicateStudentRow = { id: string; name: string | null; email: string | null; phone: string | null; claimedUserId: string | null; historyCount: number; engagementCount: number; createdAt: Date };
export const duplicateStudentKey = (name: string | null, email: string | null) => { const n=(name??"").replace(/\s+/g,"").toLowerCase();const e=(email??"").trim().toLowerCase();return n&&e?`${n}|${e}`:null; };
export function groupExactDuplicateStudents<T extends DuplicateStudentRow>(rows:T[]){const groups=new Map<string,T[]>();for(const row of rows){const key=duplicateStudentKey(row.name,row.email);if(!key)continue;groups.set(key,[...(groups.get(key)??[]),row]);}return[...groups.values()].filter(g=>g.length>1).map(g=>[...g].sort((a,b)=>Number(Boolean(b.claimedUserId))-Number(Boolean(a.claimedUserId))||(b.historyCount+b.engagementCount)-(a.historyCount+a.engagementCount)||a.createdAt.getTime()-b.createdAt.getTime()));}

export type MergeHistory = { id: string; courseName: string; attendedAt: Date | null };
export type MergeEngagement = { id: string; type: string; title: string; occurredAt: Date | null };
export type MergeStudent = { id: string; name: string | null; email: string | null; phone: string | null; claimedUserId: string | null; histories: MergeHistory[]; engagements: MergeEngagement[] };
const compact = (value:string|null) => (value??"").replace(/\s+/g,"").toLowerCase();
export const mergeHistoryKey = (h:MergeHistory) => `${h.courseName.trim().toLowerCase()}|${h.attendedAt?.toISOString().slice(0,10)??""}`;
export const mergeEngagementKey = (e:MergeEngagement) => `${e.type}|${e.title.trim().toLowerCase()}|${e.occurredAt?.toISOString().slice(0,10)??""}`;
export function buildStudentMergePreview(source:MergeStudent,target:MergeStudent){
  const conflicts:string[]=[];const warnings:string[]=[];
  const sameEmail=Boolean(source.email&&target.email&&source.email.toLowerCase()===target.email.toLowerCase());
  const samePhone=Boolean(source.phone&&target.phone&&source.phone===target.phone);
  if(!sameEmail&&!samePhone)conflicts.push("沒有相同 Email 或手機");
  if(source.phone&&target.phone&&source.phone!==target.phone)conflicts.push("手機不同");
  if(source.claimedUserId&&target.claimedUserId&&source.claimedUserId!==target.claimedUserId)conflicts.push("已連結不同會員帳號");
  if(source.name&&target.name&&compact(source.name)!==compact(target.name))conflicts.push("姓名不同");
  if(source.email&&target.email&&source.email.toLowerCase()!==target.email.toLowerCase())conflicts.push("Email 不同");
  if(!source.phone||!target.phone)warnings.push("至少一張卡沒有手機，請以其他資料人工核對");
  const historyKeys=new Set(target.histories.map(mergeHistoryKey));const engagementKeys=new Set(target.engagements.map(mergeEngagementKey));
  const moveHistories=source.histories.filter(h=>!historyKeys.has(mergeHistoryKey(h)));const duplicateHistories=source.histories.filter(h=>historyKeys.has(mergeHistoryKey(h)));
  const moveEngagements=source.engagements.filter(e=>!engagementKeys.has(mergeEngagementKey(e)));const duplicateEngagements=source.engagements.filter(e=>engagementKeys.has(mergeEngagementKey(e)));
  return{canMerge:conflicts.length===0,conflicts,warnings,moveHistories,duplicateHistories,moveEngagements,duplicateEngagements};
}

export function canOverridePhoneConflict(source: MergeStudent, target: MergeStudent, conflicts: string[]) {
  return conflicts.length === 1 && conflicts[0] === "手機不同"
    && Boolean(source.phone && target.phone && source.phone !== target.phone)
    && Boolean(source.name && target.name && compact(source.name) === compact(target.name))
    && Boolean(source.email && target.email && source.email.trim().toLowerCase() === target.email.trim().toLowerCase())
    && !(source.claimedUserId && target.claimedUserId && source.claimedUserId !== target.claimedUserId);
}
