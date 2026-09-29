// 名單收集頁的問卷：題目正規化、作答驗證、答案快照組裝。
//
// 純函式、不碰 DB，理由與 webinar-mail 相同——落地頁送出、後台預覽、測試
// 走同一條驗證路徑，不會各說各話。
//
// 兩個刻意的設計：
//   1. 答案存「快照」（含當下的題目文字），不是只存 questionId。
//      題目可以被改被刪，但半年前收到的答案仍要看得懂是在回答什麼。
//   2. 選項值必須在題目選項內才收。表單是公開端點，前端擋不住竄改。

export const MAX_QUESTIONS = 10;
export const MAX_TEXT_ANSWER = 500;
export const QUESTION_TYPES = ["SINGLE", "MULTI", "TEXT"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  SINGLE: "單選",
  MULTI: "複選",
  TEXT: "簡答",
};

export type SurveyQuestion = {
  id: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
};

/** 一筆答案的快照：題目文字一起存，題目日後被改被刪都還讀得懂 */
export type SurveyAnswer = {
  questionId: string;
  label: string;
  type: string;
  value: string[]; // 單選/簡答也用陣列，CSV 與統計不必分兩種型別
};

export type SurveyParseResult =
  | { ok: true; answers: SurveyAnswer[] }
  | { ok: false; error: string; questionId: string };

const isType = (t: string): t is QuestionType =>
  (QUESTION_TYPES as readonly string[]).includes(t);

/** 表單欄位名稱：q_<questionId>。複選會有多個同名欄位 */
export const questionFieldName = (id: string) => `q_${id}`;

/**
 * 驗證作答並組出答案快照。
 *
 * 規則：
 *  - 必填未作答 → 擋下並指出是哪一題（錯誤訊息帶題目文字，管理員與訪客都看得懂）
 *  - 單選／複選的值必須在該題選項內（公開端點，不能信任前端送什麼就收什麼）
 *  - 簡答超過上限截斷而不是擋下——訪客打太多字不該被退件
 *  - 沒作答的選填題不留空紀錄，答案陣列只收真的有答的
 */
export function parseSurveyAnswers(
  questions: SurveyQuestion[],
  read: (field: string) => string[],
): SurveyParseResult {
  const answers: SurveyAnswer[] = [];

  for (const q of questions) {
    const type: QuestionType = isType(q.type) ? q.type : "TEXT";
    const raw = read(questionFieldName(q.id)).map((v) => v.trim()).filter(Boolean);

    let value: string[];
    if (type === "TEXT") {
      value = raw.length > 0 ? [raw.join(" ").slice(0, MAX_TEXT_ANSWER)] : [];
    } else {
      // 只收在選項內的值；竄改或過期的選項一律丟掉
      const allowed = new Set(q.options);
      const hit = raw.filter((v) => allowed.has(v));
      value = type === "SINGLE" ? hit.slice(0, 1) : hit;
    }

    if (q.required && value.length === 0) {
      return { ok: false, error: `請回答：${q.label}`, questionId: q.id };
    }
    if (value.length > 0) {
      answers.push({ questionId: q.id, label: q.label, type, value });
    }
  }
  return { ok: true, answers };
}

/** 後台編輯題目時的正規化與檢查（上限、題型、選項）。
 *  上限擋在這裡而不只擋 UI——表單是可以被繞過的。 */
export function validateQuestions(
  rows: { label: string; type: string; options: string[]; required: boolean }[],
): { ok: true } | { ok: false; error: string } {
  const kept = rows.filter((r) => r.label.trim());
  if (kept.length > MAX_QUESTIONS)
    return { ok: false, error: `問卷最多 ${MAX_QUESTIONS} 題（目前 ${kept.length} 題）` };
  for (const [i, r] of kept.entries()) {
    if (!isType(r.type)) return { ok: false, error: `第 ${i + 1} 題的題型不正確` };
    if (r.type !== "TEXT" && r.options.filter((o) => o.trim()).length < 2)
      return { ok: false, error: `第 ${i + 1} 題「${r.label.trim()}」是${QUESTION_TYPE_LABEL[r.type]}，至少要兩個選項` };
  }
  return { ok: true };
}

/** 答案陣列 → 顯示用文字（CSV 一格、後台一列） */
export const answerText = (a: SurveyAnswer) => a.value.join("；");

/** 從索取紀錄的 JSON 欄位安全取回答案（舊資料是 null，別炸） */
export function readAnswers(raw: unknown): SurveyAnswer[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    if (!x || typeof x !== "object") return [];
    const o = x as Record<string, unknown>;
    if (typeof o.questionId !== "string" || typeof o.label !== "string") return [];
    const value = Array.isArray(o.value) ? o.value.filter((v): v is string => typeof v === "string") : [];
    return [{ questionId: o.questionId, label: o.label, type: String(o.type ?? "TEXT"), value }];
  });
}
