/* 剪報圖片網址純函式測試。 */
import { isOurStorageUrl } from "../src/lib/supabase/public-url";

const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example.test/";
let pass = 0;
let fail = 0;
function check(name: string, url: string, expected: boolean) {
  const actual = isOurStorageUrl(url);
  if (actual === expected) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}: ${actual} != ${expected}`); }
}
check("站內 course-assets", "https://storage.example.test/storage/v1/object/public/course-assets/briefs/a.png", true);
check("路徑大小寫不同", "https://storage.example.test/storage/v1/object/public/Course-Assets/briefs/a.png", false);
check("第三方主機", "https://other.example.test/storage/v1/object/public/course-assets/a.png", false);
check("javascript:", "javascript:alert(1)", false);
check("data:", "data:image/png;base64,a", false);
check("協議相對", "//storage.example.test/storage/v1/object/public/course-assets/a.png", false);
if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
else process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
console.log(`結果：${pass} 通過、${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
