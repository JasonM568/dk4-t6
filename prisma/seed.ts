import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ── 會員等級（依累積消費自動升級）──────────────────────────
  const tiers = [
    { name: "銅卡會員", level: 0, minTotalSpent: 0, minCoursesBought: 0, discountPercent: 0 },
    { name: "銀卡會員", level: 1, minTotalSpent: 3000, minCoursesBought: 0, discountPercent: 5 },
    { name: "金卡會員", level: 2, minTotalSpent: 10000, minCoursesBought: 0, discountPercent: 10 },
  ];
  for (const t of tiers) {
    await prisma.membershipTier.upsert({
      where: { level: t.level },
      update: t,
      create: t,
    });
  }
  const bronze = await prisma.membershipTier.findUnique({ where: { level: 0 } });

  // ── 管理員帳號 ─────────────────────────────────────────────
  const adminPassword = await bcrypt.hash("admin1234", 10);
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: { role: "ADMIN" },
    create: {
      email: "admin@example.com",
      name: "系統管理員",
      passwordHash: adminPassword,
      role: "ADMIN",
      currentTierId: bronze?.id,
    },
  });

  // ── 一般測試會員 ───────────────────────────────────────────
  const userPassword = await bcrypt.hash("user1234", 10);
  await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: {},
    create: {
      email: "user@example.com",
      name: "測試學員",
      passwordHash: userPassword,
      role: "USER",
      currentTierId: bronze?.id,
    },
  });

  // ── 測試課程 ───────────────────────────────────────────────
  const courses = [
    {
      slug: "nextjs-fullstack",
      title: "Next.js 全端開發實戰",
      description:
        "從零打造一個具備會員、金流、後台的全端網站。涵蓋 App Router、Server Actions、Prisma、Auth.js 與 ECPay 金流串接。",
      coverImage: "https://images.unsplash.com/photo-1517180102446-f3ece451e9d8?w=800",
      price: 2400,
      isPublished: true,
      lessons: [
        { title: "課程介紹與環境建置", youtubeId: "dQw4w9WgXcQ", order: 1, durationSec: 600 },
        { title: "App Router 與路由結構", youtubeId: "dQw4w9WgXcQ", order: 2, durationSec: 1200 },
        { title: "用 Prisma 設計資料模型", youtubeId: "dQw4w9WgXcQ", order: 3, durationSec: 1500 },
      ],
    },
    {
      slug: "design-thinking",
      title: "設計思考入門",
      description: "學會用使用者為中心的方法解決問題，從同理、定義、發想到原型測試的完整流程。",
      coverImage: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800",
      price: 1800,
      isPublished: true,
      lessons: [
        { title: "什麼是設計思考", youtubeId: "dQw4w9WgXcQ", order: 1, durationSec: 720 },
        { title: "同理心地圖實作", youtubeId: "dQw4w9WgXcQ", order: 2, durationSec: 900 },
      ],
    },
    {
      slug: "digital-marketing",
      title: "數位行銷全攻略",
      description: "FB/IG 廣告投放、SEO、內容行銷與數據分析，一次搞懂數位行銷的完整佈局。",
      coverImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800",
      price: 3200,
      isPublished: true,
      lessons: [
        { title: "數位行銷地圖總覽", youtubeId: "dQw4w9WgXcQ", order: 1, durationSec: 800 },
        { title: "FB 廣告受眾設定", youtubeId: "dQw4w9WgXcQ", order: 2, durationSec: 1100 },
        { title: "SEO 關鍵字研究", youtubeId: "dQw4w9WgXcQ", order: 3, durationSec: 1000 },
        { title: "成效數據分析", youtubeId: "dQw4w9WgXcQ", order: 4, durationSec: 950 },
      ],
    },
  ];

  for (const c of courses) {
    const { lessons, ...courseData } = c;
    const course = await prisma.course.upsert({
      where: { slug: c.slug },
      update: courseData,
      create: courseData,
    });
    // 重建章節
    await prisma.lesson.deleteMany({ where: { courseId: course.id } });
    await prisma.lesson.createMany({
      data: lessons.map((l) => ({ ...l, courseId: course.id })),
    });
  }

  console.log("✅ Seed 完成：3 個等級、admin/user 帳號、3 門課程");
  console.log("   管理員：admin@example.com / admin1234");
  console.log("   學員：  user@example.com / user1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
