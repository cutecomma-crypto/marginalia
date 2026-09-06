import { ICON_EYE, ICON_EYE_OFF, ICON_X } from './icons.js';

// 封面圖片 Skeleton 骨架屏與 Fade-in（Image Progressive Loading）：呼叫端把
// <img> 包一層 .cover-frame（或沿用本來就是固定尺寸容器的 .book-gallery-cover／
// .cover-preview，見 css/styles.css 對應規則），渲染完 HTML 之後對每張 <img>
// 呼叫一次這個函式——圖片真正解碼完成（或載入失敗）就補上 .is-loaded，觸發
// CSS 的透明度淡入動畫，同時（透過 CSS 的 :has() 選擇器）讓外層容器的骨架屏
// 動畫自動停止，不用另外寫一份「容器/圖片兩邊都要切換 class」的同步邏輯。
// 這裡的封面是 data URI（FileReader 讀出來直接存進資料庫，不是遠端網址，
// 見 bookForm.js 的上傳邏輯），瀏覽器不用等網路，但解碼＋排版還是需要一點
// 時間——封面網格檢視一次擺出十幾張封面同時解碼時，沒有骨架屏會看起來
// 「一格一格突然蹦出來」。img.complete 檢查是防呆：如果呼叫這個函式的當下
// 圖片其實已經解碼完（常見於瀏覽器快取過的圖片），原生 load 事件不會再觸發
// 第二次，直接補 class，不然骨架屏會卡住永遠不消失。
export function wireCoverImage(img) {
  if (!img) return;
  if (img.complete && img.naturalWidth > 0) {
    img.classList.add('is-loaded');
    return;
  }
  img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
  img.addEventListener('error', () => img.classList.add('is-loaded'), { once: true });
}

// 批量操作列（Batch Action Bar）：勾選任一列表項目時，畫面下方浮出一條固定
// 定位的操作列，顯示「目前選了幾筆」＋一組呼叫端自訂的批次操作按鈕（例如
// 書籍列表的「批次變更類別」「批次刪除」、願望清單的「批次轉為藏書」「批次
// 刪除」）。跟 bookList.js 的 inline-status-popover／selectionToolbarService.js
// 同一種「單例、掛在 document.body、每次呼叫重新填內容」做法，書籍列表跟
// 願望清單兩處呼叫端不用各自維護一份操作列的建立/定位/顯示邏輯，只需要決定
// 「有哪些按鈕、按下去要做什麼」。
//
// actions：陣列，每項 { id, label, danger, onClick(selectedIdArray) }——
// onClick 收到目前選取的 id 陣列，實際的存取/刪除邏輯完全由呼叫端決定，
// 這個共用函式不管資料層的事。
// onClear：使用者按右側的 × 清空選取時呼叫——選取的 Set 已經先被清空，
// 呼叫端通常只需要重新渲染一次自己的清單（勾選框本來就是照 selectedIds.has()
// 畫出來的，重繪一次就會自動全部恢復未勾選）。
//
// 呼叫端在「勾選狀態有變化」的每個時機都呼叫這個函式一次（勾選/取消勾選
// 某一列、批次操作完成後）——selectedIds.size === 0 時自動隱藏操作列，
// 不用呼叫端自己判斷要不要顯示。
export function updateBatchActionBar(selectedIds, actions, onClear) {
  let el = document.getElementById('batch-action-bar');
  if (selectedIds.size === 0) {
    if (el) el.hidden = true;
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'batch-action-bar';
    el.className = 'batch-action-bar';
    document.body.appendChild(el);
  }
  el.hidden = false;
  el.innerHTML = `
    <span class="batch-action-count">已選取 ${selectedIds.size} 筆</span>
    <div class="batch-action-buttons">
      ${actions.map((a) => `<button type="button" class="batch-action-btn${a.danger ? ' is-danger' : ''}" data-action-id="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}
    </div>
    <button type="button" class="batch-action-bar-close" id="batch-action-bar-close" aria-label="取消選取">${ICON_X}</button>
  `;
  actions.forEach((a) => {
    el.querySelector(`[data-action-id="${a.id}"]`).addEventListener('click', () => a.onClick(Array.from(selectedIds)));
  });
  el.querySelector('#batch-action-bar-close').addEventListener('click', () => {
    selectedIds.clear();
    updateBatchActionBar(selectedIds, actions, onClear);
    onClear();
  });
}

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

// 未儲存內容離開防護（Unsaved Changes Guard）：閱讀心得／筆記／佳句這類「打了
// 字但還沒按儲存」的輸入框，使用者不小心關掉分頁、重新整理、輸入別的網址、
// 或在這個 hash 路由的單頁應用裡點到別的內部連結（書籍列表、別本書……）時，
// 內容會無聲無息整個不見。
//
// 用一個模組層級的共用 registry（不是各自獨立掛一份監聽器）——同一頁可能
// 同時有好幾個輸入框呼叫這個函式（心得編輯區、快速筆記、佳句表單都各自算
// 一份未儲存狀態），只要其中任何一個回報 true，離開網站或切換內部路由都要
// 攔下來問一次；三個實際的事件監聽器（beforeunload／hashchange／click）
// 全部只在這個模組載入時掛一次，不會因為呼叫端重繪好幾次就跟著疊加。
const unsavedGuards = new Set();
const CONFIRM_LEAVE_MESSAGE = '目前還有尚未儲存的內容，確定要離開嗎？離開後這些修改會遺失。';

function anyUnsavedDirty() {
  for (const isDirty of unsavedGuards) {
    if (isDirty()) return true;
  }
  return false;
}

// 瀏覽器安全限制：beforeunload 沒辦法自訂提示文字內容（各家瀏覽器早就統一
// 改成顯示自己那句固定文案，忽略網站想塞的任何字串），這裡設 event.returnValue
// 只是觸發提示視窗出現的標準寫法。這條只在「真的要離開這份文件」（關分頁／
// 重新整理／換成別的網址）才會觸發，涵蓋不到下面另外處理的內部 hash 換頁。
window.addEventListener('beforeunload', (event) => {
  if (!anyUnsavedDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});

// 路由攔截（點內部連結的情境）：在 capture 階段攔一次點擊，能在 hash 真的
// 換掉之前先問使用者，不會有「畫面已經跳走、又要跳回來」那種閃爍感。
// capture:true 保證這個檢查一定搶在 app.js 的路由監聽器、或連結自己的
// 預設行為之前執行。
document.addEventListener('click', (event) => {
  if (!anyUnsavedDirty()) return;
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  if (!window.confirm(CONFIRM_LEAVE_MESSAGE)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  // 使用者確認要離開：這一頁所有還在追蹤的未儲存狀態都已經跟使用者確認過
  // 「不要了」，一併清空，不然離開後 hashchange 監聽器還會再問一次
  // （下面那條是最後一道防線，理論上不會再被觸發到，但兩者用同一份
  // registry，這裡沒清的話還是會誤觸發）。
  unsavedGuards.clear();
}, true);

// 保底防線：瀏覽器上一頁/下一頁按鈕、或程式碼直接改 window.location.hash
// 這類不會經過上面點擊攔截的內部換頁方式，hashchange 事件觸發時 hash 其實
// 已經換過去了——沒辦法真的「攔下來」，只能問使用者、選擇「不要離開」的話
// 把網址列的 hash 復原成換頁前的樣子（畫面本身還是舊頁面，因為程式碼還沒
// 執行到重新渲染新頁面那一步，只有網址列的 hash 字串已經變了，復原後跟
// 畫面重新一致）。
let lastConfirmedHash = window.location.hash;
let suppressNextHashCheck = false;
window.addEventListener('hashchange', () => {
  if (suppressNextHashCheck) {
    suppressNextHashCheck = false;
    lastConfirmedHash = window.location.hash;
    return;
  }
  if (!anyUnsavedDirty()) {
    lastConfirmedHash = window.location.hash;
    return;
  }
  if (window.confirm(CONFIRM_LEAVE_MESSAGE)) {
    unsavedGuards.clear();
    lastConfirmedHash = window.location.hash;
    return;
  }
  suppressNextHashCheck = true;
  window.location.hash = lastConfirmedHash;
});

// 呼叫端在畫面上有輸入框時呼叫一次，isDirty() 回傳目前這個輸入框是否有
// 未儲存的修改。回傳 unregister()：存檔成功後、或者這個區塊即將重新渲染
// 產生一份新的 isDirty 閉包之前呼叫，把舊的這一份從 registry 移除——
// renderReflections()／renderNotesSection() 這類函式常常在新增/刪除其他
// 項目時重新呼叫自己好幾次，忘記 unregister() 的話會讓 registry 裡累積一堆
// 讀著已經被換掉、不會再更新的舊輸入框內容的閉包，可能永遠卡在「回報有未
// 儲存內容」的假警報。
export function guardUnsavedChanges(isDirty) {
  unsavedGuards.add(isDirty);
  return () => unsavedGuards.delete(isDirty);
}
