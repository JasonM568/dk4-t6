/* 重構回歸（純離線，不碰資料庫）：
 * buildWebinarMail 抽出前，這段邏輯內嵌在 requestWebinarLinkAction 裡。
 * 這支用正式站 5 場講座的真實欄位，比對「舊的內嵌演算法」與「新的共用函式」，
 * 確認抽出來之後寄出的信一字不差。跑法：npx tsx scripts/check-webinar-mail-refactor.ts */
import { buildWebinarMail } from "../src/lib/webinar-mail";
import { applyMergeTags } from "../src/lib/email/render-content";
import { buildJoinUrl } from "../src/lib/meeting";

type W = {
  slug: string;
  lectureUrl: string;
  meetingId: string | null;
  meetingPassword: string | null;
  meetingInfo: string | null;
  emailSubject: string;
  emailBody: string;
};

const BODY = "您好，感謝索取講座連結！\r\n\r\n點擊下方按鈕即可進入講座：\r\n\r\n[▶️ 進入講座]({link})\r\n\r\n若按鈕無法點擊，請直接開啟：{link}\r\n\r\n希望學院 敬上";

const CASES: W[] = [
  { slug: "0910-lecture", lectureUrl: "https://us02web.zoom.us/j/82523787710?pwd=6DjTLradhN17S2s2NyMxrhTuK5TIXZ.1", meetingId: "825 2378 7710", meetingPassword: "815855", meetingInfo: null, emailSubject: "感謝報名09/10 量子快閃小聚，內有zoom連結。", emailBody: BODY },
  { slug: "0903-lecture", lectureUrl: "https://us02web.zoom.us/j/85864542729?pwd=YbRMNWabkdWd8WEKp0s0UXDgVXsadu.1", meetingId: "858 6454 2729", meetingPassword: "154885", meetingInfo: "主題: 0903 - 量子快閃小聚\r\n時間: 2026年9月3日 07:45 下午 台北", emailSubject: "感謝登記『量子快閃小聚』，內有zoom連結", emailBody: BODY },
  // 無密碼＋有補充資訊（buildJoinUrl 不該亂加 pwd）
  { slug: "book-club", lectureUrl: "https://us02web.zoom.us/j/87198719458", meetingId: "871 9871 9458", meetingPassword: null, meetingInfo: "1.每週三晚上20:30 - 22:30 （20:15 開放上線）\r\n2.每月最後一週的週三是付費型的講座。", emailSubject: "感謝報名每週三量子讀冊會，內有zoom連結。", emailBody: BODY },
  { slug: "0826-ai-lecture", lectureUrl: "https://us02web.zoom.us/j/87162359938?pwd=HuMQygyqseB9jNSHCZKlzJ4VRmnL6a.1", meetingId: "871 6235 9938", meetingPassword: "313066", meetingInfo: "主題: 希望學院八月份超級講座\r\n時間: 2026年8月26日 \r\n晚上8:30-10:30 (08:15入場) 台北時間", emailSubject: "講座通知｜感謝報名 08/26 顧院長線上超級講座，內有zoom連結", emailBody: BODY },
  { slug: "0806-lecture", lectureUrl: "https://us02web.zoom.us/j/85787601959?pwd=6UlwiCuRqO9kor3rYqE2Xu24b86Bna.1", meetingId: "857 8760 1959", meetingPassword: "126092", meetingInfo: "時間｜20:30–22:00. (20:15 開放上線)", emailSubject: "感謝報名08/06 夏夜快閃講座，內有zoom連結。", emailBody: "您好，感謝索取講座連結！\r\n\r\n點擊下方按鈕即可進入講座：\r\n\r\n[▶️ 進入講座]({link})\r\n\r\n若按鈕無法點擊，請直接開啟：{link}\r\n會議ID: 857 8760 1959\r\n密碼: 126092\r\n\r\n希望學院 敬上" },
  // 邊界：內文完全沒提到連結 → 舊邏輯會自動補一顆 CTA 按鈕
  { slug: "no-link-in-body", lectureUrl: "https://example.com/room", meetingId: null, meetingPassword: null, meetingInfo: null, emailSubject: "測試 {name}", emailBody: "{name} 您好，講座快開始了。" },
];

/** 抽出前 requestWebinarLinkAction 裡的那段（逐字保留，作為對照組） */
function legacy(w: W, email: string, name: string) {
  const joinUrl = buildJoinUrl(w.lectureUrl, w.meetingPassword);
  let body = w.emailBody;
  if (!body.includes("{link}") && !body.includes(w.lectureUrl)) {
    body += `\n\n[▶️ 進入講座]({link})`;
  }
  body = body.replaceAll("{link}", joinUrl);
  const infoLines = [
    w.meetingId && `會議 ID：${w.meetingId}`,
    w.meetingPassword && `會議密碼：${w.meetingPassword}`,
    w.meetingInfo,
  ].filter(Boolean);
  if (infoLines.length > 0) {
    body += `\n\n──────────\n📌 會議資訊\n\n${infoLines.join("\n")}\n\n若點按鈕無法直接進入，請開啟會議程式後手動輸入上方 ID 與密碼。`;
  }
  body = applyMergeTags(body, { email, name });
  const subject = applyMergeTags(w.emailSubject, { email, name });
  return { subject, body };
}

let pass = 0, fail = 0;
for (const w of CASES) {
  const email = "someone@example.com";
  const name = "王小明";
  const before = legacy(w, email, name);
  const after = buildWebinarMail(w, { email, name });
  const sameSubject = before.subject === after.subject;
  const sameBody = before.body === after.body;
  if (sameSubject && sameBody) { pass++; console.log(`  ✓ ${w.slug}`); }
  else {
    fail++;
    console.log(`  ✗ ${w.slug}：${!sameSubject ? "主旨不同" : ""}${!sameBody ? "內文不同" : ""}`);
    if (!sameBody) { console.log("--- 舊 ---\n" + before.body + "\n--- 新 ---\n" + after.body); }
  }
}
console.log(`\n${pass} 過 / ${fail} 失敗`);
process.exit(fail > 0 ? 1 : 0);
