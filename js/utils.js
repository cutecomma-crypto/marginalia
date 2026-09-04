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

// 密碼欄位右側的「小眼睛」顯示/隱藏切換，全站兩處密碼輸入框（登入 Modal／
// WebDAV 設定）共用同一份邏輯——呼叫端把 <input type="password"> 包在
// <div class="password-field">（見 css/styles.css 同名 class 的定位規則）
// 裡、旁邊放一顆 data-target 指向該 input id 的 .password-toggle-btn，
// 渲染完 HTML 之後呼叫這個函式一次，自動幫容器內所有這樣的組合綁好切換
// 邏輯，兩邊不用各自重複寫一份幾乎一樣的程式碼。
export function initPasswordToggles(root) {
  root.querySelectorAll('.password-toggle-btn').forEach((btn) => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    btn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? '🙈' : '👁️';
      btn.setAttribute('aria-label', isPassword ? '隱藏密碼' : '顯示密碼');
    });
  });
}

// 破壞性操作（刪除書籍……）的自訂二次確認彈窗，取代原生 window.confirm()——
// 瀏覽器內建的 confirm() 樣式無法客製，使用者看多了「網站說…」這種瀏覽器
// 系統對話框，容易養成不看內容就習慣性按掉的反射動作；換成跟站上其他
// Modal（登入／分類管理……）同一套 .modal-backdrop／.modal-card 視覺語言，
// 至少在「這是這個網站自己的提示、不是瀏覽器雜訊」這件事上更清楚。
// 回傳 Promise<boolean>（true＝使用者按了確認），跟 window.confirm() 的
// 同步回傳值型別不一樣，呼叫端要記得 await。
export function confirmModal({ title = '請確認', message = '', confirmText = '確定', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <h3 id="confirm-modal-title">${escapeHtml(title)}</h3>
        <p class="confirm-modal-message">${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn" id="confirm-modal-cancel-btn">${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-modal-ok-btn">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    function settle(result) {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(result);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') settle(false);
    }
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) settle(false); });
    backdrop.querySelector('#confirm-modal-cancel-btn').addEventListener('click', () => settle(false));
    backdrop.querySelector('#confirm-modal-ok-btn').addEventListener('click', () => settle(true));
    document.addEventListener('keydown', onKeydown);
    backdrop.querySelector('#confirm-modal-ok-btn').focus();
  });
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
