-- CreateTable：看板登入共享限流（IP＋全域雙維度）。全新表，零風險 additive。
-- 不記使用者輸入的登入碼，只記失敗次數與鎖定時間。
CREATE TABLE "BoardLoginThrottle" (
    "key" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoardLoginThrottle_pkey" PRIMARY KEY ("key")
);
