// 「願望與推薦清單」：先把想讀、被推薦的書名記下來（例如某 Podcast 節目提到、朋友介紹、
// FB 讀書會選書），之後真的想開始讀了再一鍵轉入正式藏書庫，不用因為還沒真的入手/開始讀，
// 就被迫馬上決定分類、來源、購買資訊這些只有正式藏書表單才有的欄位。
//
// 資料存在獨立的 wishlist store（見 localDb.js／supabase/schema.sql），跟 books 完全
// 獨立、沒有外鍵——「轉為藏書」是把書名/備註複製一份到 books 新增一筆記錄，不是把
// 這筆 wishlist 資料「搬過去」。走 DB 路由器（db.js），登入時自動讀寫 Supabase 的
// wishlist 表、登出時自動讀寫本機 IndexedDB，跟其餘所有 store 完全同一套機制，
// 這個檔案不用自己分辨現在是本機還是雲端。
//
// UI 是一個從畫面右側滑出的抽屜（跟 graph.js 的關係／編輯面板同一種手法），
// 不用 Modal 是因為使用者很可能會「開著清單、同時瀏覽/捲動書籍列表」，抽屜不會
// 像置中 Modal 一樣把背景整個蓋住擋住視線。
//
// 表單預設收合：抽屜的空間應該優先留給「一次瀏覽多本書」的清單本身，不是常駐一份
// 大部分時候都用不到的輸入表單。頂部只留一顆「＋ 新增願望」按鈕＋一個「共 N 本」
// 計數，點下去表單才用 CSS Grid 的 0fr→1fr 技巧滑出展開；送出成功或按「取消」都
// 收合回去，同一顆按鈕、同一份表單也拿來處理「編輯」——編輯跟新增本來就是同一份
// 欄位，收合狀態只差在有沒有預先帶入既有資料，用同一個 openForm() 入口統一處理，
// 不用另外維護兩套展開/收合邏輯。
import { DB } from './db.js';
import { escapeHtml, showToast } from './utils.js';
import { pushEscapeHandler } from './services/keyboardShortcutsService.js';

const STORE = 'wishlist';

// 雲端快取背景刷新（見 cloudDb.js／services/cloudCache.js 的 Stale-While-Revalidate
// 說明）如果發現願望清單資料真的變了，會發出這個事件——這裡只跳一個不打擾的
// Toast 提示，不強制重繪已經打開的抽屜（使用者可能正在展開表單打字打到一半），
// 重新整理頁面或重新打開抽屜就會看到最新內容。掛在模組頂層只註冊一次。
window.addEventListener('marginalia:cloud-cache-updated', (event) => {
  if (event.detail?.store !== 'wishlist') return;
  showToast('雲端願望清單已更新，重新整理即可看到最新內容');
});

let drawerEl = null;
let backdropEl = null;
let listEl = null;
let countEl = null;
let addToggleBtn = null;
let formCollapseEl = null;
let formEl = null;
let titleInput = null;
let authorInput = null;
let noteInput = null;
let submitBtn = null;
let formCancelBtn = null;
let editingId = null; // 目前正在編輯的願望清單項目 id；null 代表現在是新增模式
let cachedItems = [];

function closeDrawer() {
  if (!drawerEl) return;
  drawerEl.classList.remove('is-open');
  backdropEl.classList.remove('is-open');
}

// 表單展開／收合本身跟「新增模式／編輯模式」是兩件互相獨立的事：展開時是新增
// 還是編輯，由呼叫端決定要不要先塞資料進欄位；collapse 永遠、無條件把表單
// 重設回空白的新增模式，不管收合之前是新增中途放棄還是編輯中途取消，下一次
// 打開都要是乾淨的新增狀態，不能殘留上一次編輯留下的欄位內容或 editingId。
function openForm() {
  formCollapseEl.classList.add('is-open');
  addToggleBtn.hidden = true;
  titleInput.focus();
}

function closeForm() {
  formCollapseEl.classList.remove('is-open');
  addToggleBtn.hidden = false;
  editingId = null;
  submitBtn.textContent = '＋ 加入願望清單';
  formEl.reset();
}

function enterEditMode(item) {
  editingId = item.id;
  submitBtn.textContent = '儲存修改';
  titleInput.value = item.title || '';
  authorInput.value = item.author || '';
  noteInput.value = item.note || '';
  openForm();
}

// 作者／推薦來源合併成同一行「中介資訊」，中間用點號分隔，並強制單行＋超出
// 省略號——書名＋這一行最多兩行，是刻意的密度設計：清單要「一次看得到很多本」，
// 不能讓少數幾筆備註寫特別長的項目把整份清單拉得又高又鬆散。備註本身仍然
// 用斜體跟作者的一般字重區分開，維持原本「書名／作者／備註」三層字級與顏色
// 階層（見 CSS .wishlist-item-* 的說明），只是排版上從各自獨立一行改成擠在一起。
function itemMetaLine(item) {
  const parts = [];
  if (item.author) parts.push(escapeHtml(item.author));
  if (item.note) parts.push(`<span class="wishlist-item-note-text">${escapeHtml(item.note)}</span>`);
  if (parts.length === 0) return '';
  return `<span class="wishlist-item-meta">${parts.join(' · ')}</span>`;
}

function itemRowHtml(item) {
  return `
    <li data-id="${item.id}">
      <div class="wishlist-item-main">
        <span class="wishlist-item-title" title="${escapeHtml(item.title || '（未命名）')}">${escapeHtml(item.title || '（未命名）')}</span>
        ${itemMetaLine(item)}
      </div>
      <div class="wishlist-item-actions">
        <button type="button" class="btn btn-sm wishlist-convert-btn" title="轉為藏書">📖 轉為藏書</button>
        <button type="button" class="wishlist-icon-btn wishlist-edit-btn" title="編輯「${escapeHtml(item.title || '')}」">✏️</button>
        <button type="button" class="wishlist-icon-btn wishlist-delete-btn" title="刪除「${escapeHtml(item.title || '')}」">🗑️</button>
      </div>
    </li>
  `;
}

async function refreshList() {
  cachedItems = await DB.getAll(STORE);
  cachedItems.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  countEl.textContent = `共 ${cachedItems.length} 本`;
  listEl.innerHTML = cachedItems.length === 0
    ? '<li class="empty">還沒有任何項目，點上面「＋ 新增願望」加入第一本想讀的書吧。</li>'
    : cachedItems.map(itemRowHtml).join('');

  listEl.querySelectorAll('.wishlist-convert-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.closest('li').dataset.id);
      const item = cachedItems.find((i) => i.id === id);
      if (item) convertToBook(item);
    });
  });
  listEl.querySelectorAll('.wishlist-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.closest('li').dataset.id);
      const item = cachedItems.find((i) => i.id === id);
      if (item) enterEditMode(item);
    });
  });
  listEl.querySelectorAll('.wishlist-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.closest('li').dataset.id);
      const item = cachedItems.find((i) => i.id === id);
      if (!item) return;
      if (!window.confirm(`確定要從願望清單刪除「${item.title || '（未命名）'}」嗎？`)) return;
      try {
        await DB.remove(STORE, id);
        // 刪掉的剛好是正在編輯中的那一筆，表單裡的內容已經失去對應對象，
        // 直接收合回去，不要留著一份「編輯一個已經不存在的項目」的表單。
        if (editingId === id) closeForm();
        showToast('已從願望清單刪除');
        await refreshList();
      } catch (error) {
        console.error('[Marginalia 願望清單] 刪除失敗：', error);
        showToast(`刪除失敗：${error.message || String(error)}`);
      }
    });
  });
}

// 轉為藏書：不直接在背後偷偷幫使用者建立一本資料不全的書，而是把書名／推薦來源
// 透過 hash 查詢字串帶進「新增書籍」表單直接預填（跟 bookList.js 的作者篩選是
// 同一種手法，見該檔案 readAndClearAuthorFilterFromHash 開頭註解），使用者看得到、
// 能修改，按下「加入我的書庫」送出才真的轉入藏書庫。也因此這裡「先不刪除」這筆
// 願望清單項目——真正的刪除動作放在 bookForm.js 新增書籍成功送出「之後」才執行
// （見該檔案 wishlistId 的處理），這樣使用者半路按「取消」或直接關掉分頁，
// 願望清單裡的這筆資料不會平白消失。
function convertToBook(item) {
  const params = new URLSearchParams();
  params.set('title', item.title || '');
  if (item.author) params.set('author', item.author);
  if (item.note) params.set('note', item.note);
  params.set('wishlistId', String(item.id));
  closeDrawer();
  window.location.hash = `#/books/new?${params.toString()}`;
}

function wireForm() {
  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }
    const author = authorInput.value.trim();
    const note = noteInput.value.trim();
    try {
      if (editingId) {
        const existing = cachedItems.find((i) => i.id === editingId);
        await DB.update(STORE, { ...existing, id: editingId, title, author, note });
        showToast('已更新願望清單項目');
      } else {
        await DB.add(STORE, { title, author, note });
        showToast('已加入願望清單');
      }
      closeForm();
      await refreshList();
    } catch (error) {
      // 失敗的話刻意不收合表單——使用者剛打的內容還留在欄位裡，不用重打一次，
      // 修正問題（或至少看清楚錯誤訊息）之後可以直接再按一次送出。
      console.error('[Marginalia 願望清單] 新增／更新失敗：', error);
      showToast(`操作失敗：${error.message || String(error)}`);
    }
  });
  addToggleBtn.addEventListener('click', openForm);
  formCancelBtn.addEventListener('click', closeForm);
}

function ensureDrawerBuilt() {
  if (drawerEl) return;

  backdropEl = document.createElement('div');
  backdropEl.className = 'wishlist-drawer-backdrop';
  document.body.appendChild(backdropEl);

  drawerEl = document.createElement('aside');
  drawerEl.className = 'wishlist-drawer';
  drawerEl.innerHTML = `
    <button type="button" class="wishlist-drawer-close" id="wishlist-drawer-close" title="關閉面板">✕ 關閉</button>
    <div class="wishlist-drawer-head">
      <h3>✨ 願望與推薦清單</h3>
      <span class="wishlist-count" id="wishlist-count">共 0 本</span>
    </div>
    <div class="wishlist-form-area">
      <button type="button" class="btn btn-primary wishlist-add-toggle-btn" id="wishlist-add-toggle-btn">＋ 新增願望</button>
      <div class="wishlist-form-collapse" id="wishlist-form-collapse">
        <div class="wishlist-form-collapse-inner">
          <form id="wishlist-form" class="book-form compact-form" novalidate>
            <label class="field-required" for="wishlist-title-input">書名 *
              <input type="text" id="wishlist-title-input" name="title" required placeholder="請輸入書名">
            </label>
            <label for="wishlist-author-input">作者
              <input type="text" id="wishlist-author-input" name="author" placeholder="選填">
            </label>
            <label for="wishlist-note-input">推薦來源／備註
              <textarea id="wishlist-note-input" name="note" rows="2" placeholder="選填，例如：朋友推薦"></textarea>
            </label>
            <div class="form-actions">
              <button type="button" class="btn" id="wishlist-form-cancel-btn">取消</button>
              <button type="submit" class="btn btn-primary" id="wishlist-submit-btn">＋ 加入願望清單</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <ul class="wishlist-list" id="wishlist-list"></ul>
  `;
  document.body.appendChild(drawerEl);

  countEl = drawerEl.querySelector('#wishlist-count');
  addToggleBtn = drawerEl.querySelector('#wishlist-add-toggle-btn');
  formCollapseEl = drawerEl.querySelector('#wishlist-form-collapse');
  listEl = drawerEl.querySelector('#wishlist-list');
  formEl = drawerEl.querySelector('#wishlist-form');
  titleInput = drawerEl.querySelector('#wishlist-title-input');
  authorInput = drawerEl.querySelector('#wishlist-author-input');
  noteInput = drawerEl.querySelector('#wishlist-note-input');
  submitBtn = drawerEl.querySelector('#wishlist-submit-btn');
  formCancelBtn = drawerEl.querySelector('#wishlist-form-cancel-btn');

  backdropEl.addEventListener('click', closeDrawer);
  drawerEl.querySelector('#wishlist-drawer-close').addEventListener('click', closeDrawer);
  // 只在抽屜真的開著的時候關閉並回傳 true；抽屜關著時回傳 false，讓 Esc 正常往下
  // 傳遞，不搶走跟這個抽屜無關的行為（跟 graph.js 的關係／編輯面板同一種寫法）。
  pushEscapeHandler(() => {
    if (!drawerEl.classList.contains('is-open')) return false;
    closeDrawer();
    return true;
  });

  wireForm();
}

// 抽屜「一定要先打開」再去載入清單，不能反過來——原本的寫法是 await refreshList()
// 成功之後才加上 is-open，一旦讀取失敗（例如登入雲端帳號後，Supabase 那邊還沒
// 執行 wishlist 資料表的建表 SQL，getAll() 會直接 throw），await 整個中斷，
// 後面加 is-open 的兩行永遠不會執行到——使用者點下按鈕會像完全沒反應一樣，
// 連 Console 都要主動打開才看得到那個被吃掉的 rejection。現在無論讀取成不成功，
// 抽屜都保證會滑出來；讀取失敗就把真正的錯誤訊息印在清單區域，不會又是一次
// 「看起來什麼都沒發生」的靜默失敗。
export async function openWishlistDrawer() {
  ensureDrawerBuilt();
  closeForm(); // 表單預設收合，每次打開抽屜都從乾淨的收合狀態開始
  drawerEl.classList.add('is-open');
  backdropEl.classList.add('is-open');
  try {
    await refreshList();
  } catch (error) {
    console.error('[Marginalia 願望清單] 讀取清單失敗：', error);
    listEl.innerHTML = `<li class="empty">讀取失敗：${escapeHtml(error.message || String(error))}</li>`;
  }
}
