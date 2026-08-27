export function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HASHTAG_PATTERN = /#([\p{L}\p{N}_]+)/gu;

// 佳句／輸出／筆記共用的 #hashtag 解析：抓出文字裡所有 #標籤（去重），
// 用來做全域標籤頁的比對，跟 renderTextWithHashtags 用同一份規則。
export function extractHashtags(text) {
  if (!text) return [];
  return [...new Set(Array.from(String(text).matchAll(HASHTAG_PATTERN), (m) => m[1]))];
}

// 把「已經跳脫過的」字串裡的 #標籤轉成可點擊的高亮膠囊，連到標籤總覽頁。標籤只會是
// 字母/數字/底線/中文，不含 HTML 特殊字元，所以在跳脫過的字串上做替換是安全的。
// 拆成獨立函式，讓 outputs.js 的心得 Markdown 渲染也能重用同一份規則。
export function applyHashtagLinks(escapedText) {
  return escapedText.replace(HASHTAG_PATTERN, (match, tag) => `<a class="hashtag-chip" href="#/tags/${encodeURIComponent(tag)}">#${tag}</a>`);
}

export function renderTextWithHashtags(text) {
  return applyHashtagLinks(escapeHtml(text));
}
