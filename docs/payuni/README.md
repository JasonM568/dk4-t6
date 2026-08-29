# PAYUNi 統一金流 — 規格快照（2026-08-29 抓取）

來源：https://docs.payuni.com.tw/web/#/7/24（ShowDoc API 抓取的原始 markdown）

| 檔案 | 內容 |
|---|---|
| 34.md | UPP 整合式支付頁 Ver 2.0（交易建立，主要串接對象） |
| 80.md | UPP Notify（背景通知格式） |
| 164.md | 單筆交易查詢 |
| 38.md | 信用卡請退款 |
| 374.md | **測試區資料**（測試卡號 4147631000000001；ATM/超商後台可「模擬繳費」） |
| 312.md | 官方 Node.js 加解密範例（含測試向量，scripts/test-payuni.ts 的基準） |
| 44.md | UPP 錯誤代碼 |
| 156.md | 通用錯誤代碼 |
| 170.md | 訂單金額限制 |

重點：
- 測試區 `https://sandbox-api.payuni.com.tw/api/upp`、正式區 `https://api.payuni.com.tw/api/upp`
- 加密：AES-256-GCM（key 32 字、iv 16 字）→ hex(base64密文:::base64tag)；HashInfo = SHA256(key+密文+iv) 大寫
- MerTradeNo ≤25 字 [A-Za-z0-9_-]、10 分鐘內不可重複
- NotifyURL 僅限 80/443 port；收到 HTTP 200 停止重送
- TradeStatus：0=取號成功(pending) 1=已付款 2=失敗 3=取消 8=待確認
- 電子發票：PAYUNi 後台串光貿加值中心，可設「自動開立」（付款成功即開）——**不用另外寫程式**；作廢/折讓去光貿後台
- 手續費（2024.08 簡報）：國內信用卡 2.80%、ATM 1%（上限15元）、超商代碼 25 元/筆；撥款 T+7
