// 個資蒐集告知條款 —— 版本化管理。
// 條款文字有實質變動時 bump 版本（日期.vN），MemberProfile.privacyConsentVersion
// 會記錄會員同意當下的版本，個資法爭議時要能舉證「何時同意了哪一版」。
// 純常數、無副作用：server action、server component、client 表單三邊都要 import。

export const PRIVACY_POLICY_VERSION = "2026-08-08.v1";

export const PRIVACY_CONTACT_EMAIL = "course@huangxi.info";

/** 個資法第 8 條告知事項（條列文字，PrivacyNotice 元件負責排版） */
export const PRIVACY_POLICY_SECTIONS: { title: string; body: string }[] = [
  {
    title: "蒐集機關",
    body: "希望學院學習平台（course.huangxi.info）。",
  },
  {
    title: "蒐集目的",
    body: "會員帳號管理、課程服務提供、訂單與金流處理、上課通知（含簡訊與電子郵件）、課程與活動資訊發送（特定目的：〇四〇行銷、〇六九契約或類似契約關係事務、〇九〇消費者與客戶管理服務）。",
  },
  {
    title: "蒐集之個人資料類別",
    body: "姓名、電子郵件信箱、行動電話號碼（C001 辨識個人者）。",
  },
  {
    title: "利用期間、地區、對象及方式",
    body: "期間：會員有效期間及依法令要求之保存期間。地區：台灣及本平台使用之雲端服務所在地。對象：本平台及協助提供服務之委外廠商（雲端主機、電子郵件與簡訊發送服務商）。方式：以電子檔案或其他合於法令之方式利用。",
  },
  {
    title: "當事人權利",
    body: `依個人資料保護法第 3 條，您得就您的個人資料行使：查詢或請求閱覽、請求製給複製本、請求補充或更正、請求停止蒐集處理或利用、請求刪除。行使方式：來信 ${PRIVACY_CONTACT_EMAIL}。`,
  },
  {
    title: "不提供之影響",
    body: "手機號碼為上課通知與帳號服務之必要資料，若不提供將無法完成註冊或使用會員服務。課程行銷訊息您可隨時退訂，不影響其他服務。",
  },
];

export const PRIVACY_CONSENT_LABEL =
  "我已閱讀並同意上述個人資料蒐集告知事項，同意希望學院學習平台於上述目的範圍內蒐集、處理及利用我的個人資料";
