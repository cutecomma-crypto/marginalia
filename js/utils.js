import { ICON_EYE, ICON_EYE_OFF, ICON_X } from './icons.js';

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
// 裡、旁邊放一顆 data-target 指向該 input id 的空白 .password-toggle-btn
// （不用在 HTML 樣板裡寫死圖示——初始的「眼睛」圖示也是這裡負責補上，
// 兩處呼叫端不用各自重複維護一份圖示 HTML），渲染完 HTML 之後呼叫這個
// 函式一次，自動幫容器內所有這樣的組合補圖示、綁好切換邏輯。
export function initPasswordToggles(root) {
  root.querySelectorAll('.password-toggle-btn').forEach((btn) => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    btn.innerHTML = ICON_EYE;
    btn.addEventListener('click', () => {
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword ? ICON_EYE_OFF : ICON_EYE;
      btn.setAttribute('aria-label', isPassword ? '隱藏密碼' : '顯示密碼');
    });
  });
}

// 搜尋框一鍵清空（Search Bar Enhancements）：全站兩處搜尋框（書籍列表／佳句摘錄）
// 共用同一份邏輯。呼叫端把原本裸的 <input class="search-input"> 換成
// <div class="search-input"><input class="search-input-field" id="..." ...>
// <button type="button" class="search-clear-btn" aria-label="清空搜尋" hidden></button></div>
// 這個結構（外層 .search-input 沿用它原本全站已經有的版面／斷點樣式，見
// css/styles.css 同名 class 開頭的說明，不用另外改任何 CSS；<input> 的 id
// 留在原本的位置，呼叫端既有的 querySelector('#xxx')／.value／'input' 事件監聽
// 完全不用改），渲染完 HTML 之後呼叫這個函式一次，自動幫容器內所有這樣的
// 組合補上 × 圖示、依「目前有沒有輸入內容」決定要不要顯示按鈕、綁好清空邏輯。
// 點清空按鈕時特意 dispatchEvent 一個新的 'input' 事件（不是直接呼叫呼叫端的
// 搜尋邏輯）——這樣呼叫端原本掛在輸入框上的 'input' 監聽器會自動重新觸發一次，
// 不用另外傳一個「清空後要做什麼」的 callback 進來，也不會有兩份搜尋重置邏輯
// 分別維護、彼此不同步的風險。
export function wireSearchClear(root) {
  root.querySelectorAll('.search-input').forEach((wrapper) => {
    const input = wrapper.querySelector('.search-input-field');
    const clearBtn = wrapper.querySelector('.search-clear-btn');
    if (!input || !clearBtn) return;
    clearBtn.innerHTML = ICON_X;
    function updateVisibility() {
      clearBtn.hidden = !input.value;
    }
    updateVisibility();
    input.addEventListener('input', updateVisibility);
    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
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

// 未儲存內容離開防護（Unsaved Changes Guard）：閱讀心得／筆記這類「打了字但
// 還沒按儲存」的輸入框，使用者不小心關掉分頁、重新整理、或直接輸入別的網址時，
// 內容會無聲無息整個不見——這裡掛一個 beforeunload 監聽器，只要呼叫端傳進來
// 的 isDirty() 回傳 true，瀏覽器就會跳出自己原生的「異動可能不會儲存」提醒
// 視窗，使用者確認要離開才會真的離開。
//
// 瀏覽器安全限制：beforeunload 沒辦法自訂提示文字內容（各家瀏覽器早就統一
// 改成顯示自己那句固定文案，忽略網站想塞的任何字串），這裡設 event.returnValue
// 只是觸發提示視窗出現的標準寫法，不是真的要顯示這串文字。
// beforeunload 只在「真的要離開這份文件」（關分頁／重新整理／換成別的網址）
// 才會觸發——這個網站是 hash 路由的單頁應用，在同一份文件裡切到書籍列表、
// 別本書之類的內部換頁，瀏覽器不會把它當成一次真正的 unload，這是預期中的
// 瀏覽器行為，不是這裡漏掉沒處理。
//
// 回傳 destroy()：呼叫端存起來，在存檔成功、或者這個輸入框所在的畫面即將被
// 換掉之前呼叫。另外自動掛一個「換頁（hashchange）就自我了斷」的保險——
// 呼叫端渲染心得／筆記區塊的函式常常會在使用者新增/刪除其他項目時重新呼叫
// 好幾次，忘記手動 destroy() 的話會一路累加監聽器，每一個都還讀著自己那份
// 已經被換掉、不會再更新的舊輸入框內容，可能永遠卡在「回報有未儲存內容」
// 的假警報——跟 bookList.js 的 inline-status-popover 曾經因為同樣理由
// （單例／殘留物件在換頁後沒有跟著清掉）修過的問題是同一個成因。
export function guardUnsavedChanges(isDirty) {
  function beforeUnloadHandler(event) {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }
  function destroy() {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    window.removeEventListener('hashchange', destroy);
  }
  window.addEventListener('beforeunload', beforeUnloadHandler);
  window.addEventListener('hashchange', destroy, { once: true });
  return destroy;
}
