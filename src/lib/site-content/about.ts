// 關於我們／院長介紹：文案與圖片照舊官網 academy4hope.com（2026-10-28 複刻），版型用新平台風格。
// 圖片已複製到 Supabase Storage（course-assets/site/…，scripts/upload-site-images.ts），不連舊站 CDN。
const ASSETS = "https://qubjpayeopvscrgrvrci.supabase.co/storage/v1/object/public/course-assets/site";

export const ABOUT_INTRO = {
  heading: "找到方法，看見希望",
  paragraphs: [
    "希望學院致力於讓更多想要升級轉型、更上層樓的企業組織或個人，解決經營痛點、促進商機交流、建立跨界人脈、掌握趨勢未來。",
    "透過線上學習，幫助你不受時空限制，重新啟動你的商業思維，讓你的「專業」快速變現，價值被「客戶」看見。",
    "我們擁有豐富實戰的經驗，擁有深厚的商業背景和敏銳的洞察力，匯聚優異的經驗、人脈、know-how、錢脈，來為企業家、創業家、上班族進行輔導以及國際資源對接，鼓勵所有企業家、個人坦誠地交換心得與觀點，激發創新商業模式，深入每個問題的核心，創造極具價值的解決方案，讓每一位學員可以獲得實質利益。",
  ],
  photos: [
    { src: `${ASSETS}/about/photo-1.webp`, alt: "希望學院實體課程合影" },
    { src: `${ASSETS}/about/photo-2.webp`, alt: "希望學院課程現場" },
    { src: `${ASSETS}/about/photo-3.webp`, alt: "希望學院講座現場" },
  ],
};

export const ABOUT_STATS = [
  { value: "2,000+", unit: "名", text: "學員走進希望學院課程，利用知識為事業再創高峰" },
  { value: "6,500+", unit: "位", text: "朋友參與過希望學院的實體講座、線上分享會、課程工作坊" },
  { value: "100+", unit: "場", text: "舉辦過的課程活動，規模從十人的工作坊，到千人的線上線下同步課程" },
];

export const ABOUT_FEATURES = [
  { icon: "/site/about/icon1.svg", title: "豐富的實戰經驗", text: "從實務出發進行理論拆解，並以具體商業實戰解析，提供直接有效的商業對策。" },
  { icon: "/site/about/icon2.svg", title: "敏銳的全球視野", text: "透過深厚的商業市場、資本市場資歷與背景，以及敏銳的洞察力，提供最新的商業趨勢。" },
  { icon: "/site/about/icon3.svg", title: "匯聚優異的人脈資源", text: "協助輔導企業家、創業家、上班族與國際資源對接，促進商機發展並激發嶄新的合作模式。" },
  { icon: "/site/about/icon4.svg", title: "解析市場動態與對策", text: "分享最新財經、科技、國際趨勢新聞，進一步分析未來的產業脈動，提供有價值的對策方案。" },
  { icon: "/site/about/icon5.svg", title: "激發交流與創新思考", text: "鼓勵所有企業家、個人坦誠交換心得與觀點，深入商業本質與問題核心，激發創新的商業模式。" },
  { icon: "/site/about/icon6.svg", title: "協助尋找新的商機", text: "媒合值得信賴的戰略夥伴，以抱團的方式突破困境，為企業發展新的商機與視角。" },
];

export const CHANCELLOR = {
  name: "顧及然",
  title: "院長",
  photo: `${ASSETS}/about/chancellor.webp`,
  signature: `${ASSETS}/about/signature.png`,
  quote: [
    "郭台銘先生親口說「不會笑你」的希望學院院長——顧及然，曾任鴻海精密戰略部門領導，親自見證鴻海年營業額從 3000 億元成長到 3.9 兆元。",
    "近年來致力推動國際資源整合，協助新創團隊從國際資本市場募集超過六億多元的資金，掌握數十億元創投基金，分別在瀋陽、北京、上海、深圳、吉隆坡、台北等地輔導數百家中小企業及新創團隊，協助企業及個人提升與翻轉。",
  ],
  current: [
    "XCEL NEXT 創投　執行合夥人",
    "TA 台灣速創　執行合夥人",
    "日勝生京站實業　董事",
    "安勤科技　獨立董事",
  ],
  past: [
    "國際總裁菁英書院　院長",
    "台灣發展研究院　副院長",
    "鴻海精密戰略部門　領導",
    "驊陞科技行動通訊事業部　總監",
    "德商帝希科技全球　行銷總監",
  ],
};
