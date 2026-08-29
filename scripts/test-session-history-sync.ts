import assert from "node:assert/strict";
import { buildSessionHistoryPreview } from "../src/lib/session-history-sync";
const rows=buildSessionHistoryPreview({signups:[
  {id:"ready",name:"王小明",email:"new@example.com",phone:null},
  {id:"done",name:"陳大華",email:"done@example.com",phone:null},
  {id:"none",name:"無資料",email:null,phone:null},
  {id:"conflict",name:"不同人",email:"shared@example.com",phone:null},
],students:[
  {id:"s-done",name:"陳大華",email:"done@example.com",phone:null},
  {id:"s-other",name:"原本人",email:"shared@example.com",phone:null},
],existingStudentIds:new Set(["s-done"])});
assert.equal(rows.find(r=>r.signupId==="ready")?.status,"READY");
assert.equal(rows.find(r=>r.signupId==="done")?.status,"ALREADY");
assert.equal(rows.find(r=>r.signupId==="none")?.status,"NO_CONTACT");
assert.equal(rows.find(r=>r.signupId==="conflict")?.status,"CONFLICT");
console.log("✓ session history sync preview passed");
