// 五種財富自我檢測（/check/wealth5）的純函式層：計分、名單驗證、答案快照、報告信組裝。
// 沒有 prisma、沒有 server-only，離線測試直接 import（scripts/test-wealth5-check.ts）。
//
// 設計原則：
// - 伺服器**只收 19 題原始作答**自己重算，不信任前端算好的分數與文案
//   （公開端點，前端送什麼都可能被竄改；報告信的內容一律由這裡的內容表產生）。
// - 計分邏輯與檢測頁的 JS（src/content/wealth5-check.html 的 calculate）是兩份實作，
//   離線測試用隨機作答交叉比對兩邊必須完全一致。
import { WEALTH5_CONTENT } from "./wealth5-content";
import type { SurveyAnswer } from "./webinar-survey";

export const WEALTH5_CHECK_SLUG = "wealth5-check"; // Webinar（素材索取類）slug：名單存在它底下
export const WEALTH5_CHECK_PATH = "/check/wealth5";
export const WEALTH5_FORM_KEY = "wealth5-check"; // 公開表單限流的表單名（同 IP 10 分鐘 20 次）
export const WEALTH5_RESEND_COOLDOWN_MS = 60_000; // 同信箱 60 秒內重複送出：只更新名單不重寄

/** 名單群組：全部索取者一組，依分數帶再各一組（Jason 2026-10-20：分流要分名單） */
export const WEALTH5_GROUP_NAMES = {
  all: "五種財富檢測｜全部索取者",
  nurture: "五種財富檢測｜培育（總分未滿 60）",
  convert: "五種財富檢測｜轉換（總分 60 以上）",
} as const;

/** CTA 連結預設值；正式站可用 SiteSetting（wealth5:link:*）覆寫，見 wealth5-links.ts */
export const WEALTH5_DEFAULT_LINKS = {
  course: "https://www.seehope66.com/svipyx",
  talk1031: "", // 10/31 實體公益講座：導 seehope66 報名頁，網址待 Jason 提供；空字串＝按鈕顯示「即將開放」
  reading1118: "/webinar/book-club", // 每週三線上讀冊會的登記頁（名稱沿用規格的 1118，實際是每週固定場）
  self: "https://course.huangxi.info/check/wealth5",
};
export type Wealth5Links = { course: string; talk1031: string; reading1118: string; self: string };

export type AreaId = "A1" | "A2" | "A3" | "A4" | "A5";
export type DimId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";
export type Wealth5Profile = "normal" | "balanced_high" | "all_low";
export type Wealth5Band = "nurture" | "convert";

export const WEALTH5_ANSWER_KEYS: readonly string[] = WEALTH5_CONTENT.questions.map((q) => q.id);
export type Wealth5Answers = Record<string, number>;

export type Wealth5Result = {
  areaScores: Record<AreaId, number>;
  dimScores: Record<DimId, number>;
  totalScore: number;
  weakestArea: AreaId;
  rootDim: DimId;
  secondDim: DimId;
  profile: Wealth5Profile;
  ctaBand: Wealth5Band;
};

const AREA_IDS = WEALTH5_CONTENT.areas.map((a) => a.id) as AreaId[];
const DIM_IDS = WEALTH5_CONTENT.dims.map((d) => d.id) as DimId[];
// 規格 5.2：最弱領域同分（且相關維度平均也同分）時的固定決勝順序
const TIE_ORDER: AreaId[] = ["A2", "A1", "A3", "A5", "A4"];

/** 規格第 5 節的計分與判讀；必須與檢測頁 JS 的 calculate 逐項一致 */
export function computeWealth5(answers: Wealth5Answers): Wealth5Result {
  const areaScores = {} as Record<AreaId, number>;
  for (const id of AREA_IDS) areaScores[id] = Math.round(((answers[id] - 1) / 4) * 100);
  const dimScores = {} as Record<DimId, number>;
  for (const id of DIM_IDS)
    dimScores[id] = Math.round((((answers[`${id}a`] + answers[`${id}b`]) / 2 - 1) / 4) * 100);
  const totalScore = Math.round(
    AREA_IDS.reduce((sum, id) => sum + areaScores[id], 0) / AREA_IDS.length,
  );

  const minArea = Math.min(...AREA_IDS.map((id) => areaScores[id]));
  let candidates = AREA_IDS.filter((id) => areaScores[id] === minArea);
  if (candidates.length > 1) {
    const averages = new Map(
      candidates.map((id) => {
        const dims = WEALTH5_CONTENT.priority[id] as readonly string[];
        return [id, dims.reduce((sum, d) => sum + dimScores[d as DimId], 0) / dims.length] as const;
      }),
    );
    const low = Math.min(...averages.values());
    candidates = candidates.filter((id) => averages.get(id) === low);
  }
  const weakestArea = TIE_ORDER.find((id) => candidates.includes(id)) ?? candidates[0];

  const ranked = (WEALTH5_CONTENT.priority[weakestArea] as readonly string[])
    .map((id, index) => ({
      id: id as DimId,
      score: dimScores[id as DimId] - WEALTH5_CONTENT.priorityBonus[index],
      index,
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index);

  const profile: Wealth5Profile =
    totalScore < 30
      ? "all_low"
      : totalScore >= 80 && AREA_IDS.every((id) => areaScores[id] >= 70)
        ? "balanced_high"
        : "normal";

  return {
    areaScores,
    dimScores,
    totalScore,
    weakestArea,
    rootDim: ranked[0].id,
    secondDim: ranked[1].id,
    profile,
    ctaBand: totalScore < WEALTH5_CONTENT.ctaThreshold ? "nurture" : "convert",
  };
}

// ─────────────────── 名單驗證 ───────────────────

export type Wealth5Lead = {
  name: string;
  email: string; // 已小寫正規化
  phoneRaw: string; // 原文；正規化（normalizeContactPhone）在 route 做，純函式層不碰 lib/sms
  lineId: string;
  topConcern: string;
  source: string; // utm_source；無則 direct
  answers: Wealth5Answers; // 恰好 19 題、整數 1–5
};
export type Wealth5ParseResult = { ok: true; lead: Wealth5Lead } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 公開端點的輸入驗證：欄位長度上限、Email 格式、19 題作答完整且在 1–5。
 *  手機這裡只收原文（上限 30 字），格式不合在 route 轉 null（手機是選填，不該擋住看報告）。 */
export function parseWealth5Lead(body: unknown): Wealth5ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "格式錯誤" };
  const b = body as Record<string, unknown>;

  const name = str(b.name).trim();
  if (!name) return { ok: false, error: "請填寫姓名" };
  if (name.length > 50 || CONTROL_RE.test(name)) return { ok: false, error: "姓名無效" };

  const email = str(b.email).trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: "Email 格式不正確" };

  const phoneRaw = str(b.phone).trim();
  if (phoneRaw.length > 30) return { ok: false, error: "手機號碼過長" };
  const lineId = str(b.lineId).trim();
  if (lineId.length > 50 || CONTROL_RE.test(lineId)) return { ok: false, error: "LINE ID 無效" };
  const topConcern = str(b.topConcern).trim();
  if (topConcern.length > 100 || CONTROL_RE.test(topConcern)) return { ok: false, error: "備註過長" };
  const sourceRaw = str(b.source).trim().slice(0, 100);
  const source = sourceRaw && !CONTROL_RE.test(sourceRaw) ? sourceRaw : "direct";

  const rawAnswers = b.answers;
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers))
    return { ok: false, error: "作答資料缺失" };
  const a = rawAnswers as Record<string, unknown>;
  const answers: Wealth5Answers = {};
  for (const key of WEALTH5_ANSWER_KEYS) {
    const v = a[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5)
      return { ok: false, error: `第 ${key} 題作答無效` };
    answers[key] = v;
  }

  return { ok: true, lead: { name, email, phoneRaw, lineId, topConcern, source, answers } };
}

// ─────────────────── 答案快照（存進 WebinarRequest.answers，後台與 CSV 直接可讀） ───────────────────

export function areaName(id: AreaId): string {
  return WEALTH5_CONTENT.areas.find((a) => a.id === id)?.name ?? id;
}
export function dimName(id: DimId): string {
  return WEALTH5_CONTENT.dims.find((d) => d.id === id)?.name ?? id;
}
export function bandLabel(band: Wealth5Band): string {
  return band === "nurture" ? "培育（總分未滿 60）" : "轉換（總分 60 以上）";
}

export function buildWealth5Answers(lead: Wealth5Lead, result: Wealth5Result): SurveyAnswer[] {
  const row = (questionId: string, label: string, value: string): SurveyAnswer => ({
    questionId,
    label,
    type: "TEXT",
    value: [value],
  });
  const out: SurveyAnswer[] = [
    row("w5c:total", "五力總分", String(result.totalScore)),
    row("w5c:weakest", "最弱領域", `${areaName(result.weakestArea)}（${result.areaScores[result.weakestArea]}）`),
    row("w5c:root", "根源維度", dimName(result.rootDim)),
    row("w5c:second", "次要根源", dimName(result.secondDim)),
    row("w5c:band", "分數帶", bandLabel(result.ctaBand)),
    row("w5c:areas", "五大領域", AREA_IDS.map((id) => `${areaName(id)} ${result.areaScores[id]}`).join("｜")),
    row("w5c:dims", "七維度", DIM_IDS.map((id) => `${dimName(id)} ${result.dimScores[id]}`).join("｜")),
    row("w5c:source", "來源", lead.source),
  ];
  if (lead.lineId) out.push(row("w5c:line", "LINE ID", lead.lineId));
  if (lead.topConcern) out.push(row("w5c:concern", "最想處理的事", lead.topConcern));
  out.push(
    row("w5c:raw", "原始作答", WEALTH5_ANSWER_KEYS.map((k) => `${k}=${lead.answers[k]}`).join(",")),
  );
  return out;
}

// ─────────────────── 報告信 ───────────────────

function absolute(url: string, baseUrl: string): string {
  if (!url) return "";
  return url.startsWith("/") ? `${baseUrl.replace(/\/$/, "")}${url}` : url;
}

/** 報告信（純文字＋ broadcast 內文語法：## 標題、**粗體**、[按鈕](網址)、---）。
 *  內容全部來自 WEALTH5_CONTENT，不吃任何前端送來的文字。 */
export function buildWealth5ReportMail(
  name: string,
  result: Wealth5Result,
  links: Wealth5Links,
  baseUrl: string,
): { subject: string; body: string } {
  const area = WEALTH5_CONTENT.areas.find((a) => a.id === result.weakestArea)!;
  const dim = WEALTH5_CONTENT.dims.find((d) => d.id === result.rootDim)!;
  const special = (WEALTH5_CONTENT.special as Record<string, { kicker: string; name: string; copy: string }>)[
    `${result.weakestArea}_${result.rootDim}`
  ];
  const opening =
    result.profile === "normal"
      ? "五格之中，最需要先處理的是——"
      : WEALTH5_CONTENT.profiles[result.profile].replace(/\n/g, " ");

  const rootBlock = special
    ? `${special.kicker}\n\n## 根源：${special.name}\n${special.copy.replace(/\n/g, " ")}`
    : `但你的問題，可能不在這裡。\n\n## 根源：${dim.name}\n${dim.root}\n\n次要根源：${dimName(result.secondDim)}`;

  const sortedDims = [...DIM_IDS].sort((a, b) => result.dimScores[a] - result.dimScores[b]);
  const matrixText = (WEALTH5_CONTENT.matrix as Record<string, Record<string, string>>)[dim.id][area.id];

  const course = absolute(links.course, baseUrl);
  const talk = absolute(links.talk1031, baseUrl);
  const reading = absolute(links.reading1118, baseUrl);
  const courseBtn = course ? `[查看 11/22–23 三合一進階課程](${course})` : "";
  const talkBtns = [
    talk ? `[10/31 實體公益講座](${talk})` : "",
    reading ? `[每週三線上讀冊會・登記](${reading})` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const ctaBlock =
    result.ctaBand === "nurture"
      ? [
          "**優先建議：先來聽聽看**",
          talkBtns,
          "",
          "也適合你：三合一進階．11/22–23。兩天，把你卡住的那一格打通。量子思維 × 投資判斷 × AI 升級。",
          courseBtn,
        ]
      : [
          "**優先建議：三合一進階．11/22–23**",
          "兩天，把你卡住的那一格打通。量子思維 × 投資判斷 × AI 升級。",
          courseBtn,
          "",
          "也適合你：先來聽聽看",
          talkBtns,
        ];

  const lines = [
    `${name} 你好，`,
    "",
    "這是你剛完成的「五種財富自我檢測」完整報告，留存在信箱裡隨時可以回來看。",
    "",
    `## 你的五力總分：${result.totalScore} / 100`,
    AREA_IDS.map((id) => `${areaName(id)} ${result.areaScores[id]}`).join("｜"),
    "",
    opening,
    "",
    `## 最弱領域：${area.name}（${result.areaScores[area.id]} / 100）`,
    area.desc,
    "",
    rootBlock,
    "",
    `當「${dim.name}」沒有處理好，它會這樣影響你的「${area.name}」：`,
    `「${matrixText}」`,
    ...(area.id === "A3" ? ["", "本工具不提供醫療建議。身體不適請諮詢專業醫療人員。"] : []),
    "",
    "---",
    "",
    "## 七個維度（由低到高）",
    ...sortedDims.map(
      (id) => `${dimName(id)} ${result.dimScores[id]}${id === result.rootDim ? "　← 根源" : ""}`,
    ),
    "",
    "## 接下來 90 天，從這三件事開始",
    ...dim.actions.map((x, i) => `${i + 1}. ${x}`),
    "",
    "你不需要同時解決五件事。先把根源那一格鬆開，其他四格會跟著動。",
    "",
    "---",
    "",
    ...ctaBlock,
    "",
    `想再測一次或分享給朋友：${absolute(links.self, baseUrl)}`,
    "",
    "希望學院．顧及然｜本工具為自我覺察參考，非心理測驗、非醫療診斷。",
  ];
  return {
    subject: `你的五種財富檢測報告：最弱在「${area.name}」，根源在「${special ? special.name : dim.name}」`,
    body: lines.join("\n"),
  };
}
