import { prisma } from "@/lib/db";

// 前台導覽分頁註冊表：頁面本體寫死在程式，後台只控制開/關。
// 開關存 SiteSetting（key = page:<key>，value = "on"/"off"），無資料列視為開啟。
export const SITE_PAGES = [
  { key: "lecturers", path: "/lecturers", title: "量子講師群" },
  { key: "knowledge", path: "/knowledge", title: "知識專區" },
  { key: "speaking", path: "/speaking", title: "講座邀約" },
  { key: "shihua", path: "/zone/shihua", title: "世華會學習專區" },
] as const;

export type SitePageKey = (typeof SITE_PAGES)[number]["key"];

/** 依前台路徑反查分頁開關；沒有對應註冊項的路徑視為開啟（如未來後台自建的其他專區） */
export async function isPathEnabled(path: string): Promise<boolean> {
  const page = SITE_PAGES.find((p) => p.path === path);
  if (!page) return true;
  return isPageEnabled(page.key);
}

const settingKey = (key: SitePageKey) => `page:${key}`;

export async function getPageStates(): Promise<
  { key: SitePageKey; path: string; title: string; enabled: boolean }[]
> {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: SITE_PAGES.map((p) => settingKey(p.key)) } },
  });
  const offKeys = new Set(
    rows.filter((r) => r.value === "off").map((r) => r.key),
  );
  return SITE_PAGES.map((p) => ({
    ...p,
    enabled: !offKeys.has(settingKey(p.key)),
  }));
}

export async function isPageEnabled(key: SitePageKey): Promise<boolean> {
  const row = await prisma.siteSetting.findUnique({
    where: { key: settingKey(key) },
  });
  return row?.value !== "off";
}

export async function setPageEnabled(key: SitePageKey, enabled: boolean) {
  const value = enabled ? "on" : "off";
  await prisma.siteSetting.upsert({
    where: { key: settingKey(key) },
    update: { value },
    create: { key: settingKey(key), value },
  });
}
