-- 課名歸戶種子：標準課程主檔 + 依規則把歷史課名（約 180 種寫法）指派到標準課程。
-- 只含課名、無任何個資。可重複執行（ON CONFLICT DO NOTHING）；
-- 規則只在種子階段跑一次，之後新課名由後台「課名歸戶」頁人工指派（完整原文比對）。
-- 本機：npx prisma db execute --file scripts/sql/course-canon-seed.sql
-- 正式站：由維運者以相同內容執行（course schema）。

INSERT INTO "CanonicalCourse" ("id", "name", "kind", "level", "sortOrder", "updatedAt") VALUES
  ('qm-basic',       '量子思維初階',            'COURSE',       'BASIC',    10,  now()),
  ('qm-adv',         '量子思維進階（工作坊）',  'COURSE',       'ADVANCED', 20,  now()),
  ('ai-basic',       'AI 初階（變現入門）',     'COURSE',       'BASIC',    30,  now()),
  ('ai-adv',         'AI 進階（Agent Team）',   'COURSE',       'ADVANCED', 40,  now()),
  ('ai-invest',      'AI 投資秘技',             'COURSE',       NULL,       50,  now()),
  ('nblm',           'NotebookLM 簡報工作流',   'COURSE',       NULL,       60,  now()),
  ('biz-camp',       '企業實戰營',              'COURSE',       NULL,       70,  now()),
  ('slides',         '簡報設計與製作',          'COURSE',       NULL,       80,  now()),
  ('slides-fund',    '簡報設計與募資展演',      'COURSE',       NULL,       90,  now()),
  ('speech',         '公眾演說技巧',            'COURSE',       NULL,       100, now()),
  ('sunzi',          '孫子兵法（線上課）',      'COURSE',       NULL,       110, now()),
  ('sunzi-decision', '孫子兵法與決策思維',      'COURSE',       NULL,       120, now()),
  ('bundle',         '組合方案（跨課程）',      'COURSE',       NULL,       130, now()),
  ('sub-reading',    '量子讀冊會',              'SUBSCRIPTION', NULL,       200, now()),
  ('sub-member',     '希望學院會員訂閱',        'SUBSCRIPTION', NULL,       210, now()),
  ('sub-sunzi',      '孫子兵法舊訂閱制（2023）','SUBSCRIPTION', NULL,       220, now()),
  ('sem-share',      '實體分享會（試聽）',      'SEMINAR',      NULL,       300, now()),
  ('sem-micro',      '台北微型課程',            'SEMINAR',      NULL,       310, now()),
  ('sem-super',      '超級講座',                'SEMINAR',      NULL,       320, now()),
  ('sem-finance',    '重磅財經講座',            'SEMINAR',      NULL,       330, now()),
  ('sem-ai-invest',  'AI應用×投資趨勢雙講座',   'SEMINAR',      NULL,       340, now()),
  ('sem-wealth',     '解鎖財富自由線上講座',    'SEMINAR',      NULL,       350, now()),
  ('biz-camp-trial', '企業實戰營試聽',          'SEMINAR',      NULL,       360, now()),
  ('event-meetup',   '見面會／粉絲活動',        'EVENT',        NULL,       400, now()),
  ('prod-skincare',  '保養品商品',              'PRODUCT',      NULL,       500, now()),
  ('other-coupon',   '折價券／優惠',            'OTHER',        NULL,       900, now()),
  ('other-refund',   '退刷紀錄',                'OTHER',        NULL,       910, now())
ON CONFLICT ("id") DO NOTHING;

-- 規則順序即優先序：越特定越前面（退刷/折價券/商品/組合先攔，
-- 「曾上過量子思維初階｜量子工作坊」這種同時含兩個課名的字串才會落到工作坊而不是初階）。
INSERT INTO "StudentCourseAlias" ("rawName", "courseId", "updatedBy", "updatedAt")
SELECT m.raw, m.cid, 'seed', now() FROM (
  SELECT DISTINCT h."courseName" AS raw,
    CASE
      WHEN h."courseName" LIKE '信用卡退刷%' THEN 'other-refund'
      WHEN h."courseName" LIKE '%折價%' OR h."courseName" LIKE '%優惠券%'
        OR h."courseName" IN ('早鳥9折優惠－下單現抵', '穩健專案限時優惠滿千現折100') THEN 'other-coupon'
      WHEN h."courseName" ~ '乳霜|激激霜|睛活露|活力露|呵護寶' THEN 'prod-skincare'
      WHEN h."courseName" LIKE '0815專屬優惠%' OR h."courseName" LIKE '初階+進階%'
        OR h."courseName" LIKE '量子初階+進階%' OR h."courseName" LIKE '量子思維課程＋%' THEN 'bundle'
      WHEN h."courseName" LIKE '%見面會%' THEN 'event-meetup'
      WHEN h."courseName" LIKE '%分享會%' THEN 'sem-share'
      WHEN h."courseName" LIKE '%微型課程%' THEN 'sem-micro'
      WHEN h."courseName" LIKE '%超級講座%' THEN 'sem-super'
      WHEN h."courseName" LIKE '%重磅財經講座%' THEN 'sem-finance'
      WHEN h."courseName" LIKE '%AI應用%' THEN 'sem-ai-invest'
      WHEN h."courseName" LIKE '%解鎖財富自由%' THEN 'sem-wealth'
      WHEN h."courseName" LIKE '%量子讀冊會%' THEN 'sub-reading'
      WHEN h."courseName" = '希望學院會員訂閱方案' THEN 'sub-member'
      WHEN h."courseName" = '孫子兵法影片 舊訂閱制（2023）' THEN 'sub-sunzi'
      WHEN h."courseName" = '孫子兵法與決策思維' THEN 'sunzi-decision'
      WHEN h."courseName" LIKE '%孫子兵法%' THEN 'sunzi'
      WHEN h."courseName" LIKE '企業實戰營%試聽%' THEN 'biz-camp-trial'
      WHEN h."courseName" LIKE '%企業實戰營%' THEN 'biz-camp'
      WHEN h."courseName" = '簡報設計與募資展演' THEN 'slides-fund'
      WHEN h."courseName" = '簡報設計與製作' THEN 'slides'
      WHEN h."courseName" = '公眾演說技巧' THEN 'speech'
      WHEN h."courseName" LIKE '%NotebookLM%' THEN 'nblm'
      WHEN h."courseName" LIKE '%AI投資秘技%' THEN 'ai-invest'
      WHEN h."courseName" ~ 'AI ?進階|Agent Team' THEN 'ai-adv'
      WHEN h."courseName" ~ 'AI ?初階|變現入門課|從聊天到' THEN 'ai-basic'
      WHEN h."courseName" ~ '量子工作坊|量子二階|人生升級高雄進階' THEN 'qm-adv'
      WHEN h."courseName" ~ '量子一階|量子初階|量子思維|人生升級初階|AI時代的人生升級系統|Inner OS|舊帶新-初階' THEN 'qm-basic'
      ELSE NULL
    END AS cid
  FROM "StudentCourseHistory" h
) m
WHERE m.cid IS NOT NULL
ON CONFLICT ("rawName") DO NOTHING;
