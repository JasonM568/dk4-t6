import assert from "node:assert/strict";import{buildStudentMergePreview,duplicateStudentKey,groupExactDuplicateStudents}from"../src/lib/duplicate-students";
const d=(id:string,name:string,email:string,claimedUserId:string|null,h:number,e:number,day:number)=>({id,name,email,phone:null,claimedUserId,historyCount:h,engagementCount:e,createdAt:new Date(`2026-01-${String(day).padStart(2,"0")}T00:00:00Z`)});
assert.equal(duplicateStudentKey("王 小明","USER@Example.com"),"王小明|user@example.com");
const groups=groupExactDuplicateStudents([d("old","王小明","a@example.com",null,1,0,1),d("claimed","王 小明","A@example.com","u1",0,0,2),d("other","陳大華","b@example.com",null,0,0,3)]);
assert.equal(groups.length,1);assert.equal(groups[0][0].id,"claimed","已認領卡優先推薦保留");
const preview=buildStudentMergePreview({id:"source",name:"王小明",email:"a@example.com",phone:null,claimedUserId:null,histories:[{id:"h1",courseName:"量子初階",attendedAt:new Date("2026-01-01")},{id:"h2",courseName:"AI入門",attendedAt:null}],engagements:[]},{id:"target",name:"王 小明",email:"A@example.com",phone:null,claimedUserId:"u1",histories:[{id:"h3",courseName:"量子初階",attendedAt:new Date("2026-01-01")}],engagements:[]});
assert.equal(preview.canMerge,true);assert.equal(preview.moveHistories.length,1);assert.equal(preview.duplicateHistories.length,1);
assert.equal(buildStudentMergePreview({id:"x",name:"陳大華",email:"a@example.com",phone:null,claimedUserId:null,histories:[],engagements:[]},{id:"y",name:"王小明",email:"a@example.com",phone:null,claimedUserId:null,histories:[],engagements:[]}).canMerge,false);
console.log("✓ exact duplicate student grouping and recommendation passed");
