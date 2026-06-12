import { prisma } from "@/lib/db";
import { addCategory, updateCategory, deleteCategory } from "@/actions/admin";

export const metadata = { title: "課程分類 — 管理後台" };

export default async function AdminCategoriesPage() {
  const categories = await prisma.category.findMany({
    include: { _count: { select: { courses: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">課程分類</h1>
      <p className="mb-6 text-sm text-gray-500">
        分類選項供新增/編輯課程時勾選；刪除分類只會解除課程的分類標記，不會刪除課程。
      </p>

      <ul className="mb-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {categories.length === 0 && (
          <li className="px-4 py-3 text-sm text-gray-400">
            尚無分類，先在下方新增
          </li>
        )}
        {categories.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-4 py-3">
            <form
              action={updateCategory.bind(null, c.id)}
              className="flex flex-1 items-center gap-2"
            >
              <input
                name="name"
                required
                defaultValue={c.name}
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
              <span className="shrink-0 text-xs text-gray-400">
                {c._count.courses} 門課程
              </span>
              <button className="shrink-0 text-sm text-indigo-600 hover:underline">
                改名
              </button>
            </form>
            <form action={deleteCategory.bind(null, c.id)}>
              <button className="text-sm text-red-600 hover:underline">
                刪除
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form
        action={addCategory}
        className="flex items-end gap-2 rounded-xl border border-dashed border-gray-300 p-4"
      >
        <div className="flex-1">
          <label className="mb-1 block text-xs text-gray-500">分類名稱</label>
          <input
            name="name"
            required
            placeholder="例：心靈成長、職場技能"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white">
          新增分類
        </button>
      </form>
    </div>
  );
}
