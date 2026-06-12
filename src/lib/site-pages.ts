import { prisma } from "@/lib/db";

// 前台導覽分頁註冊表：頁面本體寫死在程式，後台只控制開/關。
// 開關存 SiteSetting（key = page:<key>，value = "on"/"off"），無資料列視為開啟。
export const SITE_PAGES = [
  { key: "lecturers", path: "/lecturers", title: "量子講師群" },
  { key: "knowledge", path: "/knowledge", title: "知識專區" },
  { key: "speaking", path: "/speaking", title: "講座邀約" },
] as const;

export type SitePageKey = (typeof SITE_PAGES)[number]["key"];

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
