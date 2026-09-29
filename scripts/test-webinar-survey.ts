/* 名單收集問卷的驗證（純離線）。
 *
 * 落地頁是公開端點，前端擋不住竄改——選項值、題數上限、必填
 * 全部必須在伺服器端擋。這支測的就是那條防線。
 *
 * 跑法：npx tsx scripts/test-webinar-survey.ts */
import {
  MAX_QUESTIONS, MAX_TEXT_ANSWER, answerText, parseSurveyAnswers,
  questionFieldName, readAnswers, validateQuestions, type SurveyQuestion,
} from "../src/lib/webinar-survey";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d?: string) {
  if (ok) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.error(`  ✗ ${n}${d ? `\n    ${d}` : ""}`); }
}
const Q = (over: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id: "q1", label: "你從哪裡認識我們？", type: "SINGLE",
  options: ["Facebook", "朋友介紹", "Google"], required: false, ...over,
});
/** 把「表單送上來的值」包成 read 函式 */
const form = (m: Record<string, string[]>) => (f: string) => m[f] ?? [];

console.log("\n必填未作答要擋下，而且要指出是哪一題");
{
  const r = parseSurveyAnswers([Q({ required: true })], form({}));
  check("擋下", r.ok === false);
  check("錯誤訊息帶題目文字", !r.ok && r.error.includes("你從哪裡認識我們？"));
  check("回報是哪一題（前端才標得出紅框）", !r.ok && r.questionId === "q1");
  const ok = parseSurveyAnswers([Q({ required: false })], form({}));
  check("選填未作答不擋", ok.ok === true);
  check("選填未作答不留空紀錄", ok.ok && ok.answers.length === 0);
}

console.log("\n單選／複選只收在選項內的值（公開端點不能信任前端）");
{
  const single = parseSurveyAnswers([Q()], form({ [questionFieldName("q1")]: ["Facebook"] }));
  check("合法單選收得到", single.ok && single.answers[0].value[0] === "Facebook");
  const hacked = parseSurveyAnswers([Q()], form({ [questionFieldName("q1")]: ["<script>"] }));
  check("竄改的選項被丟掉", hacked.ok && hacked.answers.length === 0);
  const hackedRequired = parseSurveyAnswers([Q({ required: true })], form({ [questionFieldName("q1")]: ["不存在的選項"] }));
  check("必填題送竄改值＝等同未作答，擋下", hackedRequired.ok === false);
  const multi = parseSurveyAnswers(
    [Q({ type: "MULTI" })],
    form({ [questionFieldName("q1")]: ["Facebook", "Google", "假的"] }),
  );
  check("複選收多個、濾掉非法值", multi.ok && multi.answers[0].value.length === 2);
  const many = parseSurveyAnswers([Q()], form({ [questionFieldName("q1")]: ["Facebook", "Google"] }));
  check("單選送兩個只取第一個", many.ok && many.answers[0].value.length === 1);
}

console.log("\n簡答：超長截斷而不是退件");
{
  const long = "字".repeat(MAX_TEXT_ANSWER + 200);
  const r = parseSurveyAnswers([Q({ type: "TEXT", options: [] })], form({ [questionFieldName("q1")]: [long] }));
  check(`截斷到 ${MAX_TEXT_ANSWER} 字`, r.ok && r.answers[0].value[0].length === MAX_TEXT_ANSWER);
  check("不因為打太多字就退件", r.ok === true);
}

console.log("\n答案存的是快照——題目日後被改被刪還讀得懂");
{
  const r = parseSurveyAnswers([Q()], form({ [questionFieldName("q1")]: ["朋友介紹"] }));
  check("快照含題目文字", r.ok && r.answers[0].label === "你從哪裡認識我們？");
  check("快照含題型", r.ok && r.answers[0].type === "SINGLE");
  check("快照含 questionId", r.ok && r.answers[0].questionId === "q1");
}

console.log("\n後台編輯題目的檢查");
{
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `第${i}題`, type: "TEXT", options: [], required: false }));
  check(`${MAX_QUESTIONS} 題可以`, validateQuestions(mk(MAX_QUESTIONS)).ok === true);
  check(`${MAX_QUESTIONS + 1} 題擋下（擋在伺服器，不只擋 UI）`, validateQuestions(mk(MAX_QUESTIONS + 1)).ok === false);
  check("空白題目不計入題數", validateQuestions([...mk(MAX_QUESTIONS), { label: "   ", type: "TEXT", options: [], required: false }]).ok === true);
  check("單選只有一個選項要擋", validateQuestions([{ label: "A", type: "SINGLE", options: ["只有一個"], required: false }]).ok === false);
  check("單選兩個選項可以", validateQuestions([{ label: "A", type: "SINGLE", options: ["甲", "乙"], required: false }]).ok === true);
  check("簡答不需要選項", validateQuestions([{ label: "A", type: "TEXT", options: [], required: true }]).ok === true);
  check("題型亂填要擋", validateQuestions([{ label: "A", type: "DROPDOWN", options: [], required: false }]).ok === false);
}

console.log("\n讀回舊資料不能炸");
{
  check("null → 空陣列", readAnswers(null).length === 0);
  check("不是陣列 → 空陣列", readAnswers({ a: 1 }).length === 0);
  check("缺欄位的髒資料被濾掉", readAnswers([{ questionId: "x" }, null, "字串"]).length === 0);
  const good = readAnswers([{ questionId: "q1", label: "題", type: "MULTI", value: ["甲", 5, "乙"] }]);
  check("合法的讀得回來、非字串的值被濾掉", good.length === 1 && good[0].value.length === 2);
  check("顯示用文字以分號相連", answerText({ questionId: "q1", label: "題", type: "MULTI", value: ["甲", "乙"] }) === "甲；乙");
}

console.log(`\n${pass} 過 / ${fail} 失敗`);
if (fail > 0) process.exitCode = 1;
