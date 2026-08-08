import Link from "next/link";
import { pageGuardEditor } from "@/lib/auth/staff";
import { PhoneImportForm } from "./import-form";

export const metadata = { title: "訂單回填會員手機 — 管理後台" };

export default async function PhoneImportPage() {
  await pageGuardEditor();

  return (
    <div className="max-w-3xl">
      <Link
        href="/admin/members"
        className="text-sm text-gray-500 hover:text-black"
      >
        ← 會員列表
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">1shop 訂單回填會員手機</h1>
      <p className="mb-6 text-sm text-gray-500">
        上傳 1shop 匯出的訂單檔（.xlsx / .csv），以「顧客信箱」比對平台會員，
        把「顧客電話」自動回填到會員資料。
        只回填、<span className="font-medium text-gray-700">不代替會員同意個資條款</span>——
        回填的會員下次登入時手機已預填，勾選同意即完成補填。
        會員自己填過的手機一律不覆蓋，號碼不同會列入查核報告。
      </p>
      <PhoneImportForm />
    </div>
  );
}
