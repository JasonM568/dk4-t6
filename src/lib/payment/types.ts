// 統一金流介面 — 之後要換藍新 NewebPay 只需新增一個 adapter

export interface CreatePaymentInput {
  orderNo: string; // = MerchantTradeNo（≤20 字元英數）
  amount: number; // 實付整數金額
  itemName: string; // 商品名稱（多項以 # 分隔）
  tradeDesc: string; // 交易描述
  returnUrl: string; // server-to-server 背景通知（以此為準）
  resultUrl: string; // 使用者付款完成後瀏覽器導回
  clientBackUrl: string; // 結果頁「返回」按鈕落點
}

export interface CreatePaymentResult {
  action: string; // 收銀台 endpoint，前端 auto-submit 過去
  fields: Record<string, string>; // 含 CheckMacValue 的隱藏欄位
}

export interface VerifyResult {
  valid: boolean; // 簽章是否正確
  orderNo: string;
  success: boolean; // 是否付款成功
  tradeNo?: string; // 金流商交易序號
  paymentType?: string; // Credit / ATM / CVS…
  raw: Record<string, string>;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): CreatePaymentResult;
  verifyCallback(payload: Record<string, string>): VerifyResult;
}
