# ezPay 電子發票 — 串接摘要（2026-08-29 抓取）

來源：ezPay 官網下載頁「電子發票技術串接手冊」
（pay2go_gateway_electronic_invoice_api_V1_1_8.pdf，60 頁；PDF 未入 repo）

## 端點
- 測試：`https://cinv.ezpay.com.tw/Api/invoice_issue`（文件舊域名 cinv.pay2go.com/API/invoice_issue）
- 正式：`https://inv.ezpay.com.tw/Api/invoice_issue`（文件舊域名 inv.pay2go.com/API/invoice_issue）
- 測試環境要在 cinv.ezpay.com.tw 另外註冊測試會員（同 PAYUNi 的模式，測試與正式不同金鑰）

## 加密（與 PAYUNi 完全不同，別搞混）
- Post 欄位：`MerchantID_` + `PostData_`（**底線後綴是規格**）
- `PostData_` = hex小寫( AES-256-CBC( PKCS7pad(query_string, **blocksize=32**), HashKey, HashIV ) )
  - blocksize 32 是文件特規（附件一 addpadding），不是標準 16；Node 要 setAutoPadding(false) 手動補
- 回應 JSON `{Status:"SUCCESS", Result:{InvoiceNumber, RandomNum, CheckCode…}}`
- CheckCode = SHA256(`HashIV=<iv>&` + 五欄A-Z排序query + `&HashKey=<key>`) 大寫；
  五欄：InvoiceTransNo, MerchantID, MerchantOrderNo, RandomNum, TotalAmt
  官方向量：HashKey=abcdefg, HashIV=1234567 → C4156CA2...（見 scripts/test-ezpay-invoice.ts）

## 本專案的開立策略（src/lib/invoice/ezpay.ts）
- B2C、即時開立（Status=1）、稅內含 TaxType=1/TaxRate=5：Amt=round(Total/1.05)、TaxAmt=差額
- 載具 CarrierType=2（ezPay 會員載具、buyerEmail 識別）→ 結帳頁免收手機條碼即合規，PrintFlag=N
- MerchantOrderNo 限英數_：訂單號的 `-` 自動替換 `_`
- 開立時機：PAYUNi notify 付款成功後、DB transaction 之外；失敗記 InvoiceRecord 可重試
- 作廢期限：奇數月 14 日前可作廢前兩月發票；作廢/折讓另有 API（invoice_invalid 等，未串接，量少走 ezPay 後台）
