// 量子講師群：照舊官網只放圖（1 張合照＋6 張講師卡），Jason 2026-10-28 決定不加文字。
// 圖片在 Supabase Storage（course-assets/site/lecturers/，scripts/upload-site-images.ts 上傳）。
const ASSETS = "https://qubjpayeopvscrgrvrci.supabase.co/storage/v1/object/public/course-assets/site/lecturers";

export const LECTURERS_GROUP_IMAGE = { src: `${ASSETS}/group.webp`, alt: "量子講師群合照" };

export const LECTURER_CARDS = [
  { src: `${ASSETS}/01.webp`, alt: "講師 梁舒庭" },
  { src: `${ASSETS}/02.webp`, alt: "講師 高名萱" },
  { src: `${ASSETS}/03.webp`, alt: "講師 黃靖閔" },
  { src: `${ASSETS}/04.webp`, alt: "講師 曾宸筠" },
  { src: `${ASSETS}/05.webp`, alt: "講師 黃詩雅" },
  { src: `${ASSETS}/06.webp`, alt: "講師 張雅淨" },
];
