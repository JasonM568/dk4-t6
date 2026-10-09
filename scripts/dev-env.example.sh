#!/usr/bin/env bash
# 隔離 dev server 的環境變數範本——給需要『真的起 dev server』的 QA 測試用
# （目前只有 scripts/test-payment-notify-abuse-db.ts）。
#
# 用法（必須用 source，不能直接執行，否則變數帶不進 pnpm dev）：
#   source scripts/dev-env.example.sh && pnpm dev -p 3100
#   # 另一個終端機：
#   npx tsx scripts/test-payment-notify-abuse-db.ts
#   # 跑完務必關掉：pkill -f "next dev -p 3100"
#
# ══════════════ 紅線（違反任何一條就不要起 server）══════════════
# 1. 本機 .env 帶的是『正式』金鑰：RESEND／MAACGO／SUPABASE_SECRET／EZPAY_INVOICE_*／PAYUNI_*／ECPAY_*。
#    付款通知一旦結算成功，會真的開 ezPay 發票、寄 Resend 信、用 GoTrue 建帳號。
#    所以下面每一個外部服務都被覆寫成『假值＋127.0.0.1:1 死埠』（任何外呼都立刻失敗，而不是打到正式服務）。
#    Next 會讓行程環境變數優先於 .env，所以這份覆寫有效；起之前請確認沒有漏掉任何新增的外部服務變數。
# 2. 註冊（registerAction）與忘記密碼（forgotPasswordAction）『不准』走 dev server：
#    它們用 publishable key 直打 Supabase Auth，就算清空 secret key 也會在『正式專案』建帳號
#    （曾經真的發生過）。這兩個只能在 tsx 腳本裡用 Module._load 把 @/lib/supabase/* 換成假實作
#    （範例：scripts/test-public-forms-abuse-db.ts）。
# 3. 只能搭配 localhost 的 DATABASE_URL 使用（下面會檢查，不符就中止）。
# 4. 一次只能有一個人在 3100 埠跑；起之前先 lsof -i :3100 確認沒人用，跑完立刻關。
# 5. 起來之後，先確認行程實際吃到的值再開始打：
#      ps eww -o command= -p $(pgrep -f "next dev") | tr ' ' '\n' | grep -E '^(PAYUNI_MER_ID|NEXT_PUBLIC_SUPABASE_URL)='
#    PAYUNI_MER_ID 必須是 TEST、NEXT_PUBLIC_SUPABASE_URL 必須是 http://127.0.0.1:1。
#    （test-payment-notify-abuse-db.ts 開頭還有一道護欄：用假金鑰簽章的通知必須被接受、
#     別把金鑰簽的必須被拒絕，否則整支中止。）
# ═══════════════════════════════════════════════════════════════

_repo_env="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/.env"
if [ -f "$_repo_env" ] && ! grep -E '^DATABASE_URL=' "$_repo_env" | grep -qE '@(localhost|127\.0\.0\.1)[:/]'; then
  echo "✗ .env 的 DATABASE_URL 不是 localhost，拒絕設定（這組環境只給本機隔離測試用）" >&2
  return 1 2>/dev/null || exit 1
fi

# ── 寄信／簡訊：清空金鑰，外呼指向死埠 ──
export RESEND_API_KEY=
export MAACGO_API_KEY=
export RESEND_WEBHOOK_SECRET=
export RESEND_BATCH_URL=http://127.0.0.1:1/

# ── Supabase：網址指向死埠。secret key 設成『非空的假字串』——
#    空值會讓 createAdminClient 直接丟 'supabaseKey is required'（那是設定錯誤的情境，不是外呼失敗的情境）。
#    要專門測『secret key 缺失』時，才把下一行改成 export SUPABASE_SECRET_KEY=（並事先通知 PM）。 ──
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:1
export SUPABASE_SECRET_KEY=FAKE-SECRET-KEY-DEAD-PORT-ONLY

# ── 金流：PAYUNi（主要）、ezPay 發票、ECPay（保留的 provider）全部假值＋死埠 ──
#    測試腳本預設用同一組值簽章；若你改了這裡，請同時 export NOTIFY_HASH_KEY／NOTIFY_HASH_IV 讓腳本一致。
export PAYMENT_PROVIDER=payuni
export PAYUNI_API_URL=http://127.0.0.1:1/
export PAYUNI_MER_ID=TEST
export PAYUNI_HASH_KEY=FAKEKEYFAKEKEYFAKEKEYFAKEKEY0032   # 32 字元（假）
export PAYUNI_HASH_IV=FAKEIVFAKEIV0016                      # 16 字元（假）

export EZPAY_INVOICE_API_URL=http://127.0.0.1:1/
export EZPAY_INVOICE_MERCHANT_ID=TEST
export EZPAY_INVOICE_HASH_KEY=FAKEKEYFAKEKEYFAKEKEYFAKEKEY0032
export EZPAY_INVOICE_HASH_IV=FAKEIVFAKEIV0016

export ECPAY_API_URL=http://127.0.0.1:1/
export ECPAY_MERCHANT_ID=TEST
export ECPAY_HASH_KEY=FAKEECPAYKEY0001
export ECPAY_HASH_IV=FAKEECPAYIV00001

# ── 本機網址 ──
export NEXT_PUBLIC_BASE_URL=http://localhost:3100

echo "✓ 已設定隔離環境：PAYUNI_MER_ID=$PAYUNI_MER_ID  NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL  所有外呼指向 127.0.0.1:1"
