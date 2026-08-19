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

// 把文字裡的 #標籤轉成可點擊的高亮膠囊，連到標籤總覽頁。標籤只會是字母/數字/底線/中文，
// 不含 HTML 特殊字元，所以在跳脫過的字串上做替換是安全的，不會破壞既有的跳脫結果。
export function renderTextWithHashtags(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(HASHTAG_PATTERN, (match, tag) => `<a class="hashtag-chip" href="#/tags/${encodeURIComponent(tag)}">#${tag}</a>`);
}
