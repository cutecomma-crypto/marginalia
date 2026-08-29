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

// 書籍/心得的標籤是使用者自由輸入的文字，沒有固定清單，沒辦法像閱讀動機那樣
// 照語意手動分組——用字元碼加總取餘數決定落在哪個色階，同一個標籤字串每次
// 算出來都是同一組顏色（視覺穩定，不會每次重新整理就變色），不同標籤彼此
// 顏色不同，一排標籤不會全部長得一模一樣。
function tagColorGroup(tag) {
  const sum = String(tag).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return ['a', 'b', 'c'][sum % 3];
}

export function renderTagChip(tag) {
  return `<span class="output-tag" data-group="${tagColorGroup(tag)}">${escapeHtml(tag)}</span>`;
}

// 全站共用的一次性提示：目前只有「作者已無書籍，自動更新列表」這類防禦性訊息會用到，
// 用單一個固定在畫面底部的元素重複利用，不用每個呼叫端各自組一份 DOM。
export function showToast(message, duration = 2600) {
  let toastEl = document.querySelector('#app-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'app-toast';
    toastEl.className = 'app-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.remove('is-visible');
  // 強制 reflow：同一句話連續觸發兩次時，沒有這行動畫不會重新播放一次淡入效果。
  void toastEl.offsetWidth;
  toastEl.classList.add('is-visible');
  clearTimeout(toastEl._hideTimer);
  toastEl._hideTimer = setTimeout(() => toastEl.classList.remove('is-visible'), duration);
}
