import "server-only";

import { isSearchableQuery } from "@/lib/roster-search";
import { createClient } from "@supabase/supabase-js";

// Admin client：用 SUPABASE_SECRET_KEY（BYPASSRLS），只能在 server 端使用。
// 本檔案以 `import "server-only"` 防止被打包進 client bundle。
// 用途：
// 1. 「唯讀」查詢 QBC 管的 public.profiles——絕不對 public schema 直接寫入
// 2. 透過 GoTrue Admin API 批次建立會員（profiles 由 QBC 的 handle_new_user trigger 自動建立）

// public.profiles 的型別（QBC 站的 handle_new_user trigger 建立）
export type Profile = {
  id: string; // auth.users.id（uuid）
  email: string | null;
  display_name: string | null;
  nickname: string | null;
  role: string | null; // student | admin | coach | master | tester
};

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        // 純 server 端查詢用，不需要 session 機制
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// 會員詳情頁用：查單一會員的完整 profile（含建立時間）
export async function getProfile(
  userId: string,
): Promise<(Profile & { created_at: string | null }) | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, nickname, role, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[supabase/admin] 查詢 profile 失敗：", error.message);
    return null;
  }
  return (data as Profile & { created_at: string | null }) ?? null;
}

// 查單一使用者的 role（admin layout / requireAdmin 二次驗證用）
export async function getProfileRole(userId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[supabase/admin] 查詢 profiles.role 失敗：", error.message);
    return null;
  }
  return data?.role ?? null;
}

// 後台總覽用：唯讀計算 profiles 總數（head:true 只回 count 不抓資料）
export async function countProfiles(): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true });

  if (error) {
    console.error("[supabase/admin] 計算 profiles 總數失敗：", error.message);
    return 0;
  }
  return count ?? 0;
}

// 批次功能用：以 email（小寫）批次查 profiles，回傳 email → Profile 的對照表
export async function getProfilesByEmails(
  emails: string[],
): Promise<Map<string, Profile>> {
  const supabase = createAdminClient();
  const map = new Map<string, Profile>();

  // 一次塞太多會撞 URL 長度限制，分批每 200 筆查一次。
  // B13：profiles.email 可能含大寫，.in() 是大小寫敏感比對會漏判，
  // 改用 ilike 的 or() 做大小寫不敏感比對（email 先 lower 去重再查）。
  const normalized = [...new Set(emails.map((e) => e.toLowerCase()))];
  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    // 將 chunk 內每個 email 組成 email.ilike.<email> 的 or 條件；
    // ilike 無萬用字元時等同大小寫不敏感的相等比對。
    const orFilter = chunk
      .map((e) => `email.ilike.${e.replace(/[,()]/g, "")}`)
      .join(",");
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, display_name, nickname, role")
      .or(orFilter);

    if (error) {
      console.error("[supabase/admin] 批次查詢 profiles 失敗：", error.message);
      continue;
    }
    for (const p of (data ?? []) as Profile[]) {
      if (p.email) map.set(p.email.toLowerCase(), p);
    }
  }
  return map;
}

/** 破壞性操作專用：任何一批查詢失敗就 throw，禁止把「查不到」誤當成「沒有會員」。 */
export async function getProfilesByEmailsStrict(emails: string[]): Promise<Map<string, Profile>> {
  const supabase = createAdminClient();
  const map = new Map<string, Profile>();
  const normalized = [...new Set(emails.map((e) => e.toLowerCase()))];
  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    const orFilter = chunk.map((e) => `email.ilike.${e.replace(/[,()]/g, "")}`).join(",");
    const { data, error } = await supabase.from("profiles").select("id, email, display_name, nickname, role").or(orFilter);
    if (error) throw new Error(`PROFILE_SAFETY_CHECK_FAILED:${error.message}`);
    for (const profile of (data ?? []) as Profile[]) if (profile.email) map.set(profile.email.toLowerCase(), profile);
  }
  return map;
}

export type CreateMemberResult =
  | { ok: true; userId: string }
  // B7：email 已存在時，盡量帶上既有 auth user id，
  // 讓上層可直接用此 id 做 enrollment 開通（不依賴 profiles 同步）。
  | { ok: false; reason: "exists"; userId?: string }
  | { ok: false; reason: "error"; message?: string };

// B7：以 email 反查既有 auth user id（GoTrue Admin API 無 getUserByEmail，
// 改走 listUsers 分頁，lowercase 比對 email）。查不到回 null。
export async function findAuthUserIdByEmail(
  email: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const target = email.toLowerCase();
  const perPage = 1000;
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      console.error("[supabase/admin] 反查 auth user 失敗：", error.message);
      return null;
    }
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < perPage) break;
    page++;
  }
  return null;
}

/** 批次版的 findAuthUserIdByEmail：一次掃完所有使用者，回 email（小寫）→ userId。
 *
 *  存在的理由是效能：findAuthUserIdByEmail 每查一個 email 就從第一頁重掃一次，
 *  查 20 個 email 就是 20 趟全表掃描。需要一次對多個信箱時一律用這支。
 *  查詢失敗回空 Map（呼叫端自行決定要不要中斷）。 */
export async function getAuthUserIdsByEmails(
  emails: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  if (wanted.size === 0) return map;

  const supabase = createAdminClient();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[supabase/admin] getAuthUserIdsByEmails 失敗：", error.message);
      break;
    }
    for (const u of data.users) {
      const e = (u.email ?? "").toLowerCase();
      if (e && wanted.has(e)) map.set(e, u.id);
    }
    if (data.users.length < perPage) break;
  }
  return map;
}

// 批次匯入用：建立 Supabase Auth 會員。
// metadata 對齊 hope 站註冊（display_name/nickname/role:student），
// 讓 QBC 的 handle_new_user trigger 建出一致的 profiles。
export async function createMember(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<CreateMemberResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true, // 管理員代建，視同已驗證，學員可直接登入
    user_metadata: {
      display_name: input.displayName,
      nickname: input.displayName,
      role: "student",
    },
  });

  if (error) {
    const msg = error.message ?? "";
    if (/already|registered|exists/i.test(msg)) {
      // B7：反查既有 user id 一併回傳，讓上層能直接開通課程權限
      const userId = await findAuthUserIdByEmail(input.email);
      return userId
        ? { ok: false, reason: "exists", userId }
        : { ok: false, reason: "exists" };
    }
    console.error("[supabase/admin] 建立會員失敗：", input.email, msg);
    return { ok: false, reason: "error", message: msg };
  }
  return { ok: true, userId: data.user.id };
}

/** 產生「設定密碼」連結（recovery link）。訪客購課自動建帳號後，
 *  用這條連結請他設定自己的密碼——絕不自行保存或寄出明碼。
 *  落點與忘記密碼同一條（/auth/confirm → /reset-password）。 */
export async function generateSetPasswordLink(
  email: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "https://course.huangxi.info";
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${base}/auth/confirm` },
  });
  if (error) {
    console.error("[supabase/admin] 產生設定密碼連結失敗：", email, error.message);
    return null;
  }
  return data.properties?.action_link ?? null;
}

// ───── 課程圖片上傳（Supabase Storage：course-assets 公開 bucket）─────

const COURSE_ASSETS_BUCKET = "course-assets";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export type SignedUploadResult =
  | { ok: true; bucket: string; path: string; token: string; publicUrl: string }
  | { ok: false; error: string };

// 產生「簽名上傳 URL」讓瀏覽器把圖片 bytes 直接傳到 Supabase Storage。
// 為什麼：Vercel serverless function 的 request body 有 ~4.5MB 平台硬上限，
// 透過 server action 上傳，封面 5MB／多張介紹圖很容易超過而整批送出失敗
// （前台只看到「This page couldn't load」）。改成瀏覽器直傳，bytes 不經過
// server action body，徹底避開上限；server 端只回一個簽名 token（極小封包）。
export async function createCourseImageSignedUpload(
  fileType: string,
  prefix:
    | "cover"
    | "intro"
    | "webinar"
    | "page"
    | "broadcast"
    | "brief"
    | "article"
    | "session" = "intro",
): Promise<SignedUploadResult> {
  if (!ALLOWED_IMAGE_TYPES.includes(fileType)) {
    return { ok: false, error: "格式不支援（限 JPG/PNG/WebP/GIF）" };
  }
  const ext = fileType.split("/")[1].replace("jpeg", "jpg");
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(COURSE_ASSETS_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[supabase/admin] 產生簽名上傳 URL 失敗：", error?.message);
    return { ok: false, error: error?.message ?? "無法產生上傳連結，請稍後再試" };
  }

  const { data: pub } = supabase.storage
    .from(COURSE_ASSETS_BUCKET)
    .getPublicUrl(data.path);

  return {
    ok: true,
    bucket: COURSE_ASSETS_BUCKET,
    path: data.path,
    token: data.token,
    publicUrl: pub.publicUrl,
  };
}

// 講義允許的檔案格式（bucket 的 allowed_mime_types 須同步包含這些）
const ALLOWED_MATERIAL_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/zip": "zip",
};
const MAX_MATERIAL_BYTES = 20 * 1024 * 1024; // 20MB

// 上傳課程講義（PDF/Office/ZIP），回傳公開網址
export async function uploadCourseMaterial(file: File): Promise<UploadResult> {
  const ext = ALLOWED_MATERIAL_TYPES[file.type];
  if (!ext) {
    return {
      ok: false,
      error: `「${file.name}」格式不支援（限 PDF、PPT、Word、Excel、ZIP）`,
    };
  }
  if (file.size > MAX_MATERIAL_BYTES) {
    return { ok: false, error: `「${file.name}」超過 20MB，請壓縮後再上傳` };
  }

  const path = `materials/${crypto.randomUUID()}.${ext}`;
  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(COURSE_ASSETS_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000" });

  if (error) {
    console.error("[supabase/admin] 講義上傳失敗：", file.name, error.message);
    return { ok: false, error: `「${file.name}」上傳失敗：${error.message}` };
  }

  const { data } = supabase.storage.from(COURSE_ASSETS_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}

export type NeverSignedInUser = {
  id: string;
  email: string | null;
  createdAt: string;
};

// 撈出「從未登入」的會員（last_sign_in_at 為空）。
// 走 GoTrue Admin API，B6：以 while 迴圈分頁直到撈到不足一頁為止（不硬性限 10 頁）。
export async function listNeverSignedInUsers(): Promise<NeverSignedInUser[]> {
  const supabase = createAdminClient();
  const result: NeverSignedInUser[] = [];
  const perPage = 1000;
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      console.error("[supabase/admin] listUsers 失敗：", error.message);
      break;
    }
    for (const u of data.users) {
      if (!u.last_sign_in_at) {
        result.push({
          id: u.id,
          email: u.email ?? null,
          createdAt: u.created_at,
        });
      }
    }
    if (data.users.length < perPage) break;
    page++;
  }
  return result;
}

// 後台會員列表用：撈所有帳號的登入時間（last_sign_in_at）+ 註冊時間，回 Map(id → meta)
export async function listAuthMeta(): Promise<
  Map<string, { lastSignInAt: string | null; createdAt: string }>
> {
  const supabase = createAdminClient();
  const map = new Map<string, { lastSignInAt: string | null; createdAt: string }>();
  const perPage = 1000;
  let page = 1;
  // B6：以 while 迴圈分頁直到撈到不足一頁為止（不硬性限 10 頁）。
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      console.error("[supabase/admin] listAuthMeta 失敗：", error.message);
      break;
    }
    for (const u of data.users) {
      map.set(u.id, {
        lastSignInAt: u.last_sign_in_at ?? null,
        createdAt: u.created_at,
      });
    }
    if (data.users.length < perPage) break;
    page++;
  }
  return map;
}

// 批次重設密碼（管理員操作，覆蓋原密碼）
export async function setUserPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
  });
  if (error) {
    console.error("[supabase/admin] 重設密碼失敗：", userId, error.message);
    return false;
  }
  return true;
}

// 後台會員列表用：唯讀撈出全部 profiles。
// B4：PostgREST 預設單次上限 1000 筆，改用 .range(from,to) 每頁 1000 迴圈撈，
// 直到回傳不足一頁為止，避免超過 1000 名會員時被截斷。
/** 依 userId 批次取 profile（course schema 只存得到 userId，姓名／email 要回 QBC 拿）。
 *  id 是 uuid，沒有 email 那種大小寫問題，直接用 .in() 即可。 */
export async function getProfilesByIds(userIds: string[]): Promise<Profile[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, nickname, role")
    .in("id", ids.slice(0, 200)); // 一次塞太多會撞 URL 長度限制

  if (error) {
    console.error("[supabase/admin] 依 id 查 profiles 失敗：", error.message);
    return [];
  }
  return (data ?? []) as Profile[];
}

/** 關鍵字搜會員（姓名／暱稱／email 子字串，不分大小寫）。
 *
 *  與 listProfiles 的差別：那支是把全部會員抓下來給頁面自己過濾（647 筆一次性頁面載入
 *  還可以），這支是給「邊打字邊查」用的——每按一鍵就抓全表會非常慢，必須讓資料庫過濾。
 *
 *  PostgREST 的 .or() 是用逗號與括號當語法分隔的字串 DSL，關鍵字直接串進去會壞掉
 *  （或被拿來拼出別的條件），所以先把語法字元清掉再組。 */
export async function searchProfiles(
  query: string,
  limit = 20,
): Promise<Profile[]> {
  const q = query.trim().replace(/[,()%\\*]/g, "");
  // 門檻走共用的 isSearchableQuery：中文一個字（姓氏）就查，英數要兩個字元
  if (!isSearchableQuery(q)) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, nickname, role")
    .or(`email.ilike.%${q}%,display_name.ilike.%${q}%,nickname.ilike.%${q}%`)
    .limit(limit);

  if (error) {
    console.error("[supabase/admin] 搜尋 profiles 失敗：", error.message);
    return [];
  }
  return (data ?? []) as Profile[];
}

export async function listProfiles(): Promise<Profile[]> {
  const supabase = createAdminClient();
  const pageSize = 1000;
  const result: Profile[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, display_name, nickname, role")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[supabase/admin] 查詢 profiles 列表失敗：", error.message);
      break;
    }
    const rows = (data ?? []) as Profile[];
    result.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return result;
}
