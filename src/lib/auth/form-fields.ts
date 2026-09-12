// 註冊／補填表單的「姓名」欄位名稱：表單與 server action 共用同一份常數。
//
// 為什麼要為兩個字串開一個檔：2026-08-29（f34cbb5）把姓名必填加進
// parseProfileFields 時寫死讀 "name"，但註冊頁的欄位一直叫 "displayName"
// （它同時要當 Supabase 的 display_name）。兩邊各寫各的字串，型別檢查抓不到，
// build 也過——結果是整整 14 天沒有任何人註冊得成功：使用者明明填了姓名，
// 畫面卻回「請填寫姓名（訂單與發票需要）」。正式站 auth.users 在那之後 0 筆新註冊。
//
// 唯一擋得住這種錯的方法是只留一個來源，讓改名字必須同時改到兩邊。
// 放 src/lib 而不是 actions：`"use server"` 檔案不能匯出常數（整個路由群組會掛）。

/** 註冊頁的姓名欄位——同時送進 Supabase user_metadata.display_name */
export const REGISTER_NAME_FIELD = "displayName";

/** 補填頁（/complete-profile）的姓名欄位 */
export const PROFILE_NAME_FIELD = "name";

/** parseProfileFields 接受的姓名欄位名稱 */
export type NameField = typeof REGISTER_NAME_FIELD | typeof PROFILE_NAME_FIELD;
