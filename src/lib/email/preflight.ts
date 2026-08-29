export type BroadcastPreflight = { errors: string[]; warnings: string[] };

const SUPPORTED_TAGS = new Set(["name", "email", "code"]);
const PLACEHOLDER_RE = /(TODO|請填寫|填入日期|填入地點|日期待定|地點待定)/i;

export function inspectBroadcastDraft(input: {
  subject: string;
  body: string;
  requireBody?: boolean;
}): BroadcastPreflight {
  const errors: string[] = [];
  const warnings: string[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) errors.push("請填寫主旨");
  if (input.requireBody !== false && !body) errors.push("請填寫內文");

  const unsupported = [...body.matchAll(/\{([^{}]+)\}/g)]
    .map((match) => match[1].trim())
    .filter((tag) => !SUPPORTED_TAGS.has(tag));
  if (unsupported.length > 0) {
    errors.push(`內文含未支援的變數：${[...new Set(unsupported)].map((tag) => `{${tag}}`).join("、")}`);
  }

  for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^)\n]*)\)/g)) {
    const raw = match[1].trim();
    try {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      errors.push(`連結格式不正確：${raw || "（空白網址）"}`);
    }
  }
  if (/!?\[[^\]\n]*\]\([^)]*(?:\n|$)/.test(body)) {
    errors.push("內文含未完成的 Markdown 連結或圖片語法");
  }
  if (!/(https?:\/\/|\[[^\]]+\]\(https?:\/\/)/.test(body)) {
    warnings.push("內文沒有 CTA 或網址，收件人可能不知道下一步要做什麼");
  }
  if ([...subject].length > 60) warnings.push("主旨超過 60 個字元，部分信箱可能截斷");
  if (PLACEHOLDER_RE.test(`${subject}\n${body}`)) {
    warnings.push("內容仍含 TODO／請填寫／待定等 placeholder，請確認已替換");
  }
  return { errors: [...new Set(errors)], warnings };
}
