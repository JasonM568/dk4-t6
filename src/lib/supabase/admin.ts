import "server-only";
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

// ───── 課程圖片上傳（Supabase Storage：course-assets 公開 bucket）─────

const COURSE_ASSETS_BUCKET = "course-assets";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB，與 bucket 設定一致

export type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// 上傳課程圖片，回傳公開網址。檔名用隨機字串避免覆蓋與中文檔名問題。
export async function uploadCourseImage(
  file: File,
  prefix: string, // 例如 "cover" / "intro"
): Promise<UploadResult> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: `「${file.name}」格式不支援（限 JPG/PNG/WebP/GIF）` };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: `「${file.name}」超過 5MB，請壓縮後再上傳` };
  }

  const ext = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${prefix}/${crypto.randomUUID()}.${ext}`;

  const supabase = createAdminClient();
  const { error } = await supabase.storage
    .from(COURSE_ASSETS_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000" });

  if (error) {
    console.error("[supabase/admin] 圖片上傳失敗：", file.name, error.message);
    return { ok: false, error: `「${file.name}」上傳失敗：${error.message}` };
  }

  const { data } = supabase.storage.from(COURSE_ASSETS_BUCKET).getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
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
