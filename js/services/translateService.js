// 獨立、可插拔模組：劃詞翻譯。
//
// ⚠️ 重要、請務必知道：這是這份清單裡唯一一個會把使用者輸入的文字內容送到
// 「第三方伺服器」的功能，跟 Marginalia 其餘完全 local-first、不連網的原則不一樣。
// 呼叫的是 MyMemory Translated（api.mymemory.translated.net）這個免金鑰、
// 免費方案有速率限制的公開翻譯 API——沒有官方 SLA，也不是你能控制的服務。
// 因此這個模組刻意設計成「預設不啟用」：selectionToolbarService.js 只有在
// 呼叫端明確傳入 enableTranslate: true 時才會顯示翻譯按鈕（見該檔案）。
// 是否要接受「選取的文字會離開這台裝置」這個取捨，由你自己決定要不要打開它。

const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

export async function translateText(text, targetLang = 'zh-TW', sourceLang = 'en') {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';
  const params = new URLSearchParams({ q: trimmed, langpair: `${sourceLang}|${targetLang}` });
  const response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`);
  if (!response.ok) throw new Error(`翻譯服務回應錯誤（HTTP ${response.status}）`);
  const json = await response.json();
  const translated = json?.responseData?.translatedText;
  if (!translated) throw new Error('翻譯服務沒有回傳結果');
  return translated;
}
