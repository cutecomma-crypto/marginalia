import { DB } from './db.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml, showToast, wireSearchClear, wireCoverImage, confirmModal, updateBatchActionBar } from './utils.js';
import { renderDashboardSidebar } from './dashboardSidebar.js';
import { loadRecordByBookMap, filterBooksCompletedInYear, filterBooksByStatus, filterBooksByCategory, filterBooksByAuthor } from './bookStats.js';
import { STATUS_OPTIONS } from './readingRecords.js';
import { openWishlistDrawer } from './wishlist.js';
import { pushEscapeHandler } from './services/keyboardShortcutsService.js';
import { categoryOptionsHtml, wireCategorySelect } from './categories.js';
import { DEFAULT_RETENTION_STATUS } from './bookForm.js';
import { ICON_SPARKLES, ICON_BOOK_OPEN, ICON_X, ICON_FILTER } from './icons.js';

// 「篩選與批量」下拉面板：跟這個檔案上面 .inline-status-popover 是同一種
// 「不是 document.body 單例，而是每次 renderBookList() 都重新產生」的頁面
// 內容，所以點外面關閉／Esc 關閉這兩個監聽器一樣掛在模組最外層、只註冊一次，
// 每次都用 document.getElementById 現查目前畫面上真正存在的那個面板/按鈕，
// 不用擔心離開再回來這頁時重複疊加監聽器（舊的 <div id="filter-batch-panel">
// 節點已經隨著 container.innerHTML 被整個換掉，id 查詢自然只會找到目前這份）。
function hideFilterBatchPanel() {
  const panel = document.getElementById('filter-batch-panel');
  const toggleBtn = document.getElementById('filter-batch-toggle-btn');
  if (panel) panel.hidden = true;
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
}
document.addEventListener('mousedown', (event) => {
  const panel = document.getElementById('filter-batch-panel');
  if (!panel || panel.hidden) return;
  if (panel.contains(event.target) || event.target.closest('#filter-batch-toggle-btn')) return;
  hideFilterBatchPanel();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideFilterBatchPanel();
});

// 批量操作列的「批次變更類別」彈窗：跟 confirmModal() 同一套 .modal-backdrop／
// .modal-card／Esc／點外面關閉的寫法，差別只是內容換成一顆分類下拉選單。
// 選單本身直接借用 categoryOptionsHtml()／wireCategorySelect()——書籍表單怎麼
// 選分類、怎麼跳「＋自訂分類」彈窗，這裡就跟著一樣，不用另外重寫一份分類邏輯。
// resolve(null) 代表取消（不異動任何書籍），resolve('') 是「先不分類」的合法選擇，
// 跟 resolve(null) 要分清楚，呼叫端用 `=== null` 判斷取消，不是用「假值」判斷。
function openBatchCategoryModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="batch-category-modal-title">
        <h3 id="batch-category-modal-title">批次變更類別</h3>
        <label for="batch-category-select">套用到選取的書籍
          <select id="batch-category-select">
            <option value="">（先不分類）</option>
            ${categoryOptionsHtml('')}
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn" id="batch-category-cancel-btn">取消</button>
          <button type="button" class="btn btn-primary" id="batch-category-confirm-btn">套用</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const selectEl = backdrop.querySelector('#batch-category-select');
    wireCategorySelect(selectEl);

    function settle(result) {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(result);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') settle(null);
    }
    backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) settle(null); });
    backdrop.querySelector('#batch-category-cancel-btn').addEventListener('click', () => settle(null));
    backdrop.querySelector('#batch-category-confirm-btn').addEventListener('click', () => settle(selectEl.value));
    document.addEventListener('keydown', onKeydown);
  });
}

// 雲端快取背景刷新（見 cloudDb.js／services/cloudCache.js 的 Stale-While-Revalidate
// 說明）如果發現書籍資料真的變了，會發出這個事件——這裡只負責跳一個不打擾的
// Toast 提示，不強制重繪目前畫面（使用者可能正在搜尋/篩選到一半，貿然重繪
// 會把捲動位置、輸入到一半的搜尋字串都弄丟），重新整理頁面就會看到最新內容。
// 掛在模組頂層只註冊一次，不會因為 renderBookList() 被重複呼叫而重複掛聽。
window.addEventListener('marginalia:cloud-cache-updated', (event) => {
  if (event.detail?.store !== 'books') return;
  showToast('雲端書籍資料已更新，重新整理即可看到最新內容');
});

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
}

// 書籍詳情頁點作者名稱要「跳頁＋套用篩選」一次完成，但列表頁的篩選狀態全部活在
// renderBookList 的閉包變數裡，沒辦法直接從別的頁面塞值進去——於是借用 hash 的
// 後半段夾帶一段假 query string（例如 #/books?author=東野圭吾，這不是真正的網址
// 查詢字串，單純是 hash 片段裡自訂的文字），列表頁載入時讀一次、套用完馬上用
// history.replaceState 把網址清乾淨，之後重新整理或再次點擊「所有書籍」都不會殘留。
function readAndClearAuthorFilterFromHash() {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  const author = new URLSearchParams(hash.slice(qIndex + 1)).get('author');
  if (author) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/books`);
  }
  return author;
}

// 「顯示全部書籍」按鈕用的細線 X，取代原本比較搶眼、線條較粗的「✕」文字符號。
const CLOSE_ICON = '<svg class="reset-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

// 視角切換按鈕用的 Lucide 圖示（List／LayoutGrid），取代原本容易模糊、鋸齒的純文字符號（▦／☰）。
const LIST_ICON = '<svg class="view-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h.01"></path><path d="M3 12h.01"></path><path d="M3 19h.01"></path><path d="M8 5h13"></path><path d="M8 12h13"></path><path d="M8 19h13"></path></svg>';
const GRID_ICON = '<svg class="view-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect></svg>';

// 完成日期欄位：表格版改成可點擊的按鈕（Inline Status Switcher），點下去跳出一個
// 小面板直接改「狀態」跟「完成日期」，不用整個跳進書籍詳情頁的「閱讀進度設定」
// 表單——視覺上維持原本純文字、低調次要色的樣子（按鈕本身重置成跟 <span> 一樣
// 沒有邊框/底色），完成了顯示日期、還沒完成顯示「—」，只是現在多了「可以點」這件事。
function completedDateCell(book, record) {
  const text = record && record.endDate ? formatDateSlash(record.endDate) : '—';
  return `<button type="button" class="book-completed-date book-status-trigger" data-book-id="${book.id}" title="點擊快速更新閱讀狀態／完成日期">${escapeHtml(text)}</button>`;
}

// 封面網格版維持純文字、不可點擊——整張卡片本身已經是 <a>，<button> 巢狀在
// <a> 裡面是不合法的 HTML（互動元素不能巢狀互動元素），跟 authorNameHtmlInline
// 用 <span> 走 event delegation 是同一個考量，但這裡沒有到「一定要在網格檢視
// 也支援快速編輯」的必要性，維持原本簡單的純顯示即可。
function completedDateTextOnly(record) {
  const text = record && record.endDate ? formatDateSlash(record.endDate) : '—';
  return `<span class="book-completed-date">${escapeHtml(text)}</span>`;
}

// 作者名稱點擊即篩選：只有真的有作者名稱才輸出可點擊元素，避免空字串也生出一顆
// 沒東西可篩的按鈕。點擊事件用 event delegation 掛在 #book-list-body 上（見下方
// bodyEl.addEventListener），這裡只負責標記 class／data-author，不在這裡個別綁定。
function authorNameHtml(book) {
  if (!book.author) return '';
  return `<button type="button" class="author-name-link" data-author="${escapeHtml(book.author)}" title="篩選出「${escapeHtml(book.author)}」的所有藏書">${escapeHtml(book.author)}</button>`;
}

// 封面網格模式整張卡片本身就是 <a>，裡面不能再塞一個 <button>（互動元素巢狀在
// HTML 語意上不合法），改用 <span> 靠 event delegation 處理，並在監聽器裡
// preventDefault／stopPropagation 擋掉外層 <a> 的導覽，做法跟 <button> 版一致，
// 只是換一個不會被瀏覽器特殊處理的容器標籤。
function authorNameHtmlInline(book) {
  if (!book.author) return '';
  return `<span class="author-name-link" data-author="${escapeHtml(book.author)}" title="篩選出「${escapeHtml(book.author)}」的所有藏書">${escapeHtml(book.author)}</span>`;
}


// 列表頁快速更新閱讀狀態／完成日期（Inline Status Switcher）：點擊「完成日期」
// 欄位跳出一個小面板，只放「狀態」跟「完成日期」這兩個最常需要臨場調整的欄位
// （開始日期／頁數／閱讀次數／評分這些留在書籍詳情頁的「閱讀進度設定」，那裡才是
// 完整表單），選了就立刻存檔（跟 outputs.js 的 .output-date-input 同一套「change
// 就自動存、不用另外按儲存」的習慣），不用整個跳頁就能完成最常見的操作。
// 單例面板（跟 selectionToolbarService.js 的 ensureToolbarEl() 同一種做法）：
// 掛在 document.body 上、每次開啟時重新填內容跟定位，不用每次 renderList() 都
// 重新建立/銷毀一次。
let statusPopoverEl = null;
function ensureStatusPopoverEl() {
  if (!statusPopoverEl) {
    statusPopoverEl = document.createElement('div');
    statusPopoverEl.className = 'inline-status-popover';
    statusPopoverEl.hidden = true;
    document.body.appendChild(statusPopoverEl);
  }
  return statusPopoverEl;
}

function hideStatusPopover() {
  if (statusPopoverEl) statusPopoverEl.hidden = true;
}

function positionStatusPopover(el, anchorRect) {
  const margin = 6;
  const top = window.scrollY + anchorRect.bottom + margin;
  let left = window.scrollX + anchorRect.left;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - el.offsetWidth - margin;
  left = Math.max(margin, Math.min(left, maxLeft));
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
}

// 點面板以外的地方、或按 Esc 都收起面板——跟 selectionToolbarService.js 的
// onDocMouseDown 同一種收尾方式。這兩個監聽器掛在模組最外層、只會執行一次
// （不會因為 renderBookList() 被重複呼叫而重複疊加監聽器）。
document.addEventListener('mousedown', (event) => {
  if (!statusPopoverEl || statusPopoverEl.hidden) return;
  if (statusPopoverEl.contains(event.target) || event.target.closest('.book-status-trigger')) return;
  hideStatusPopover();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideStatusPopover();
});
// 這是單例元素，掛在 document.body 上不會因為離開書籍列表頁就被清掉（hash
// 路由只是整個換掉 container 的內容，不是真的重新整理頁面）——沒有這一行，
// 面板開著的狀態下切去別的頁面（例如書籍詳情頁、資料管理頁），面板會維持
// 顯示、浮在完全不相干的畫面上面，這是實測抓到的真實問題，不是預防性猜測。
window.addEventListener('hashchange', hideStatusPopover);

// recordMap 是整頁共用的同一份 Map，存檔成功後直接原地更新這個 Map 裡對應的
// 那一筆（不用整批重新從資料庫撈一次 reading_records），onSaved() 呼叫端負責
// 決定要不要重繪列表（通常是 renderList()，讓這一列的完成日期文字立刻反映新值）。
function openStatusPopover(anchorBtn, book, recordMap, onSaved) {
  const el = ensureStatusPopoverEl();
  const record = recordMap.get(book.id);
  el.innerHTML = `
    <button type="button" class="inline-status-popover-close" aria-label="關閉">${ICON_X}</button>
    <label>狀態
      <select name="status">
        ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${record && record.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
      </select>
    </label>
    <label>完成日期
      <input type="date" name="endDate" value="${escapeHtml((record && record.endDate) || '')}">
    </label>
  `;
  el.hidden = false;
  positionStatusPopover(el, anchorBtn.getBoundingClientRect());

  el.querySelector('.inline-status-popover-close').addEventListener('click', hideStatusPopover);

  const statusSelect = el.querySelector('select[name="status"]');
  const dateInput = el.querySelector('input[name="endDate"]');
  statusSelect.focus();

  // 跟書籍詳情頁「閱讀進度設定」表單（見 readingRecords.js 的 renderReadingSection）
  // 完全同一套存檔邏輯：沒有既有記錄就新增一筆，有就在原本那筆上面補新的欄位值——
  // 兩個入口（詳情頁完整表單／列表頁這個快速面板）改的是同一張 reading_records
  // 資料表，行為只能有一套，不能各寫一份、彼此邏輯兜不起來。
  async function persist(patch) {
    const current = recordMap.get(book.id);
    const payload = {
      bookId: book.id,
      status: current?.status || '尚未閱讀',
      startDate: current?.startDate || '',
      endDate: current?.endDate || '',
      currentPage: current?.currentPage ?? null,
      readCount: current?.readCount || 0,
      rating: current?.rating || 0,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    let saved;
    if (current) {
      saved = { ...current, ...payload, id: current.id };
      await DB.update('reading_records', saved);
    } else {
      const newId = await DB.add('reading_records', payload);
      saved = { ...payload, id: newId };
    }
    recordMap.set(book.id, saved);
    showToast('已更新閱讀狀態');
    hideStatusPopover();
    onSaved();
  }

  statusSelect.addEventListener('change', () => persist({ status: statusSelect.value }));
  dateInput.addEventListener('change', () => persist({ endDate: dateInput.value }));
}

function bookRow(book, favoriteAuthors, recordMap, selectedIds) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  // data-label：手機版把表格轉成一張張卡片時（見 styles.css 的 @media (max-width: 640px)
  // .book-table 區塊），每個 <td> 用 CSS ::before 讀這個屬性當左側欄位名稱標籤，
  // 不用另外為手機版寫一套完全不同的卡片 HTML 樣板。
  // .book-table-category-badge：平常（桌機／手機卡片）預設 display:none，只有平板
  // 直向（見 styles.css 的 @media (min-width:641px) and (max-width:1024px) 區塊）
  // 才會顯示——那個寬度書籍類型改成貼在書名下方的小標籤，不再獨立佔一整欄，
  // 直接把內容寫進書名 <td> 裡（跟獨立的「書籍類型」<td> 並存），比起用純 CSS
  // 去「借」另一個 <td> 的文字內容（辦不到）簡單可靠得多。
  // 批量操作勾選框直接塞進書名 <td> 最前面，不另外加一欄——colgroup／nth-child
  // 一堆響應式規則都是照現有欄位數算的，多一欄會牽動一整片 CSS，見批量操作列
  // 那次規劃時的考量。
  return `
    <tr>
      <td data-label="書名"><input type="checkbox" class="row-select-checkbox book-select-checkbox" data-select-id="${book.id}" aria-label="選取《${escapeHtml(book.title || '未命名')}》" ${selectedIds.has(book.id) ? 'checked' : ''}><a href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">${escapeHtml(book.title || '（未命名）')}</a>${book.category ? `<span class="book-table-category-badge">${escapeHtml(book.category)}</span>` : ''}</td>
      <td class="author-cell" data-label="作者"><span class="author-cell-value"><span class="author-star${isFavoriteAuthor ? '' : ' is-hidden'}" title="喜愛的作者">♥</span>${authorNameHtml(book)}</span></td>
      <td data-label="書籍類型">${escapeHtml(book.category)}</td>
      <td data-label="完成日期">${completedDateCell(book, record)}</td>
    </tr>
  `;
}

function groupTextByBookId(items, field) {
  const map = {};
  for (const item of items) {
    if (!map[item.bookId]) map[item.bookId] = [];
    map[item.bookId].push(item[field]);
  }
  return map;
}

// 跨書名／作者／筆記／佳句／閱讀後輸出內容搜尋（含 #hashtag，因為標籤本來就是內文的一部分，
// 子字串比對天生就會吃到）：把每本書的可搜尋文字先組好，輸入時直接子字串比對。
async function buildSearchIndex(books) {
  const [allNotes, allQuotes, allOutputs] = await Promise.all([
    DB.getAll('notes'),
    DB.getAll('quotes'),
    DB.getAll('outputs'),
  ]);
  const notesByBook = groupTextByBookId(allNotes, 'text');
  const quotesByBook = groupTextByBookId(allQuotes, 'content');
  const reflectionsByBook = groupTextByBookId(allOutputs.filter((o) => o.kind === 'reflection'), 'text');

  return books.map((book) => ({
    book,
    searchText: [
      book.title, book.author, ...(book.tags || []),
      ...(notesByBook[book.id] || []), ...(quotesByBook[book.id] || []), ...(reflectionsByBook[book.id] || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }));
}

function bookTableHtml(list, favoriteAuthors, recordMap, selectedIds) {
  return `
    <table class="book-table">
      <colgroup>
        <col class="col-title">
        <col class="col-author">
        <col class="col-category">
        <col class="col-completed">
      </colgroup>
      <thead>
        <tr><th>書名</th><th>作者</th><th>書籍類型</th><th>完成日期</th></tr>
      </thead>
      <tbody>
        ${list.map((book) => bookRow(book, favoriteAuthors, recordMap, selectedIds)).join('')}
      </tbody>
    </table>
  `;
}

// 封面網格檢視：跟表格模式吃同一份 list／favoriteAuthors／recordMap，只是換一種排版，
// 沒有封面的書用書本 emoji 佔位，不留空白方塊。
// 批量操作勾選框沒有直接塞進 <a class="book-gallery-card"> 裡面——<input> 屬於
// 「互動內容」，HTML 規範不允許塞進另一個互動元素（<a href>）裡面，跟這個檔案
// 別處用 <span> 取代 <button> 是同一種考量（見 authorNameHtmlInline 等函式的
// 開頭註解）。這裡改成多包一層 .book-gallery-card-wrap，讓 <input> 跟 <a> 變成
// 平輩，勾選框改用 CSS 疊在卡片左上角（見 styles.css 的 .book-gallery-checkbox），
// 點下去不會誤觸 <a> 的導覽，也不需要額外寫 preventDefault／手動轉發 change
// 事件那種繞路的 hack。
function bookGalleryCard(book, favoriteAuthors, recordMap, selectedIds) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <div class="book-gallery-card-wrap">
      <input type="checkbox" class="book-gallery-checkbox book-select-checkbox" data-select-id="${book.id}" aria-label="選取《${escapeHtml(book.title || '未命名')}》" ${selectedIds.has(book.id) ? 'checked' : ''}>
      <a class="book-gallery-card" href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">
        <div class="book-gallery-cover">
          ${book.coverImage ? `<img src="${book.coverImage}" alt="《${escapeHtml(book.title || '未命名')}》封面">` : `<span class="book-gallery-cover-placeholder">${ICON_BOOK_OPEN}</span>`}
        </div>
        <div class="book-gallery-info">
          <div class="book-gallery-title">${escapeHtml(book.title || '（未命名）')}</div>
          <div class="book-gallery-author">${isFavoriteAuthor ? '<span class="author-star" title="喜愛的作者">♥</span> ' : ''}${authorNameHtmlInline(book)}</div>
          <div class="book-gallery-meta">
            ${book.category ? `<span class="book-gallery-category">${escapeHtml(book.category)}</span>` : ''}
            ${completedDateTextOnly(record)}
          </div>
        </div>
      </a>
    </div>
  `;
}

function bookGalleryHtml(list, favoriteAuthors, recordMap, selectedIds) {
  return `<div class="book-gallery">${list.map((book) => bookGalleryCard(book, favoriteAuthors, recordMap, selectedIds)).join('')}</div>`;
}

const PAGE_SIZE_OPTIONS = [
  { value: '12', label: '每頁顯示：12 本' },
  { value: '24', label: '每頁顯示：24 本' },
  { value: '50', label: '每頁顯示：50 本' },
  { value: 'all', label: '每頁顯示：全部' },
];

// 頁碼超過 7 頁時用「1 … 上一頁 目前頁 下一頁 … 末頁」的縮寫排法，
// 不然書籍一多頁碼列會長到跟搜尋列一樣寬，反而看不出目前在第幾頁。
function buildPageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const sortedKeep = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = null;
  for (const p of sortedKeep) {
    if (prev !== null && p - prev > 1) result.push('…');
    result.push(p);
    prev = p;
  }
  return result;
}

function paginationHtml(current, total) {
  if (total <= 1) return '';
  const pages = buildPageList(current, total);
  return `
    <nav class="pagination-bar" aria-label="分頁導覽">
      <button type="button" class="pagination-btn" data-page="${current - 1}" ${current === 1 ? 'disabled' : ''}>‹ 上一頁</button>
      <div class="pagination-pages">
        ${pages.map((p) => (p === '…'
    ? '<span class="pagination-ellipsis">…</span>'
    : `<button type="button" class="pagination-page${p === current ? ' is-active' : ''}" data-page="${p}" ${p === current ? 'aria-current="page"' : ''}>${p}</button>`
  )).join('')}
      </div>
      <button type="button" class="pagination-btn" data-page="${current + 1}" ${current === total ? 'disabled' : ''}>下一頁 ›</button>
    </nav>
  `;
}

const SORT_OPTIONS = [
  { value: 'created-desc', label: '建立時間：新到舊' },
  { value: 'created-asc', label: '建立時間：舊到新' },
  { value: 'completed-desc', label: '完成日期：新到舊' },
  { value: 'completed-asc', label: '完成日期：舊到新' },
  { value: 'rating-desc', label: '評分：高到低' },
  { value: 'title-asc', label: '書名：筆劃／字母 A-Z' },
];

// 書名排序用 Intl.Collator 搭配 BCP 47 的 -u-co-stroke 擴充參數，指定中文
// 用「筆劃」排序（不是瀏覽器預設常見的拼音排序）——同一顆 collator 物件
// 拿英文書名比較一樣正常（回歸到一般字母序），不用另外為中英文分兩套邏輯。
// 建在函式外層只需要建立一次，重複呼叫 sortBooks() 不用每次都重新初始化。
const titleCollator = new Intl.Collator('zh-Hant-u-co-stroke', { sensitivity: 'base', numeric: true });

function sortBooks(books, recordMap, sortMode) {
  const list = [...books];
  if (sortMode === 'created-asc') {
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } else if (sortMode === 'completed-desc') {
    list.sort((a, b) => {
      const endA = recordMap.get(a.id)?.endDate || '';
      const endB = recordMap.get(b.id)?.endDate || '';
      if (endA && endB) return endB.localeCompare(endA);
      if (endA && !endB) return -1;
      if (!endA && endB) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } else if (sortMode === 'completed-asc') {
    list.sort((a, b) => {
      const endA = recordMap.get(a.id)?.endDate || '';
      const endB = recordMap.get(b.id)?.endDate || '';
      if (endA && endB) return endA.localeCompare(endB);
      if (endA && !endB) return -1;
      if (!endA && endB) return 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  } else if (sortMode === 'rating-desc') {
    // 沒評分（0 分／從沒設定過）一律排到最後面，不跟「評分低」混在一起——
    // 「沒評分」代表使用者根本還沒讀完或懶得評，語意上不是「評 0 分」。
    list.sort((a, b) => {
      const ratingA = recordMap.get(a.id)?.rating || 0;
      const ratingB = recordMap.get(b.id)?.rating || 0;
      if (ratingA !== ratingB) return ratingB - ratingA;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } else if (sortMode === 'title-asc') {
    list.sort((a, b) => titleCollator.compare(a.title || '', b.title || ''));
  } else {
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); // created-desc（預設）
  }
  return list;
}

// 「空白頁面與新手引導」：資料庫真的一本書都沒有時（不是搜尋/篩選篩到剩零筆——
// 那種情況維持原本簡短的文字提示，見下面 renderList() 的判斷式），比起單純一行
// 「還沒有任何書籍」的文字，一張莫蘭迪風格的插畫＋一顆「載入範例書籍」按鈕
// 更能讓剛註冊、還沒開始建立藏書的新使用者馬上摸得到「這個平台實際長什麼樣子」，
// 不用自己想書名、慢慢建立才看得到列表、統計、分類這些功能運作起來的樣子。
// 插畫刻意純用行內 SVG＋CSS 變數上色（跟全站 icons.js 的線條圖示同一種筆觸：
// stroke-width 1.5、圓角端點），不是外部圖檔——完全繼承目前的莫蘭迪配色（含
// 深色模式），不用另外準備、维護一張點陣圖素材。
function emptyLibraryStateHtml() {
  return `
    <div class="empty-library-state">
      <svg class="empty-library-illustration" viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="14" y="70" width="92" height="6" rx="3" fill="var(--border-soft)"></rect>
        <path d="M24 70V32a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v38" stroke="var(--color-primary-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M52 70V24a4 4 0 0 1 4-4h20a4 4 0 0 1 4 4v46" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="M80 70V38a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v32" stroke="var(--accent-green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <line x1="32" y1="46" x2="40" y2="46" stroke="var(--color-primary-accent)" stroke-width="2" stroke-linecap="round"></line>
        <line x1="60" y1="38" x2="70" y2="38" stroke="var(--primary)" stroke-width="2" stroke-linecap="round"></line>
        <circle cx="90" cy="52" r="3" fill="var(--gold)"></circle>
      </svg>
      <p class="empty-library-title">還沒有任何藏書</p>
      <p class="empty-library-subtitle">點擊上方「＋ 新增書籍」開始記錄，或先載入幾本範例書籍熟悉一下功能。</p>
      <button type="button" class="btn btn-primary" id="load-sample-books-btn">${ICON_SPARKLES}載入 3 本範例書籍</button>
    </div>
  `;
}

// 範例書籍刻意挑三種不同閱讀狀態（已讀完＋評分／閱讀中／尚未閱讀）跟三個不同
// 分類，讓新使用者一載入就能同時看到列表、側邊欄「年度已讀進度」「藏書分類
// 統計」這幾個核心功能實際運作起來的樣子，不是三本內容完全相同、只有書名不同
// 的空殼資料。
const SAMPLE_BOOKS = [
  { title: '原子習慣', author: '詹姆斯．克利爾', category: '自我提升', status: '已讀完', rating: 5, daysAgo: 20 },
  { title: '人類大歷史', author: '哈拉瑞', category: '社會科學', status: '閱讀中', rating: 0, daysAgo: 0 },
  { title: '小王子', author: '安東尼．聖修伯里', category: '歐美文學', status: '尚未閱讀', rating: 0, daysAgo: 0 },
];

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function loadSampleBooks() {
  for (const sample of SAMPLE_BOOKS) {
    const bookId = await DB.add('books', {
      title: sample.title,
      author: sample.author,
      publisher: '',
      publishDate: '',
      purchaseDate: '',
      purchasePrice: null,
      format: '紙本購買',
      retentionStatus: DEFAULT_RETENTION_STATUS,
      libraryBorrowType: '',
      libraryName: '',
      category: sample.category,
      coverImage: '',
    });
    await DB.add('reading_records', {
      bookId,
      status: sample.status,
      startDate: '',
      endDate: sample.status === '已讀完' ? isoDateDaysAgo(sample.daysAgo) : '',
      currentPage: null,
      readCount: sample.status === '已讀完' ? 1 : 0,
      rating: sample.rating,
    });
  }
}

export async function renderBookList(container) {
  const books = await DB.getAll('books');
  // let（不是 const）：批次刪除時要把被刪掉的書從搜尋索引裡一併移除，
  // 不然刪除後不重新整理頁面，搜尋結果還會撈到已經不存在的書。
  let index = await buildSearchIndex(books);
  const favoriteAuthors = await getFavoriteAuthorMap();
  const recordMap = await loadRecordByBookMap();

  // 讓 Header 那顆「藏書統計」抽屜觸發按鈕（跟 favicon 共用同一張書本＋書籤
  // 圖示，見 index.html）知道「現在在書籍列表頁、有抽屜
  // 可以開」——按鈕本身是 index.html 的靜態內容、按鈕的 click 監聽器掛在
  // app.js（只掛一次，見該檔案開頭註解），這裡只負責在按鈕上補一個 CSS
  // 顯示開關會讀的 class；app.js 的 route() 已經在每次換頁最前面先移除掉，
  // 只有真的執行到這裡才會重新加回來，離開這頁按鈕會自動隱藏。
  document.body.classList.add('has-sidebar-drawer');

  container.innerHTML = `
    <div class="dashboard-layout">
      <div class="sidebar-drawer-backdrop" id="sidebar-drawer-backdrop"></div>
      <aside class="dashboard-sidebar" id="dashboard-sidebar">
        <button type="button" class="sidebar-drawer-close" id="sidebar-drawer-close" title="關閉面板">✕ 關閉</button>
        <div class="dashboard-sidebar-inner" id="dashboard-sidebar-inner"></div>
      </aside>
      <div class="dashboard-main">
        <div class="toolbar">
          <div class="toolbar-title-row">
            <h2 id="book-list-title">所有書籍</h2>
            <button type="button" class="view-mode-toggle-btn" id="view-mode-toggle-btn" title="切換為封面網格檢視">${GRID_ICON}</button>
          </div>
          <div class="toolbar-actions">
            <button type="button" class="btn" id="open-wishlist-btn">${ICON_SPARKLES}願望清單</button>
            <a class="btn btn-primary" href="#/books/new">＋ 新增書籍</a>
          </div>
        </div>
        <div class="active-filters-row" id="active-filters-row" hidden>
          <div class="active-filter-badges" id="active-filter-badges"></div>
          <button type="button" class="clear-filters-btn" id="clear-filters-btn">${CLOSE_ICON}清除篩選</button>
        </div>
        <div class="search-row">
          <div class="search-input">
            <input type="search" id="book-search" class="search-input-field" placeholder="搜尋書名、作者、#標籤，或筆記／佳句內容…">
            <button type="button" class="search-clear-btn" aria-label="清空搜尋" hidden></button>
          </div>
          <div class="filter-batch-wrap">
            <button type="button" class="btn filter-batch-toggle-btn" id="filter-batch-toggle-btn" aria-expanded="false" aria-controls="filter-batch-panel">${ICON_FILTER}篩選與批量</button>
            <div class="filter-batch-panel" id="filter-batch-panel" hidden>
              <label class="filter-batch-field">排序
                <select id="book-sort-select" class="sort-select">
                  ${SORT_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
                </select>
              </label>
              <label class="filter-batch-field">每頁顯示
                <select id="book-page-size-select" class="sort-select">
                  ${PAGE_SIZE_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
                </select>
              </label>
              <label class="filter-batch-toggle-field">
                <input type="checkbox" id="batch-mode-checkbox">
                啟用批量選取（顯示勾選框）
              </label>
            </div>
          </div>
          <span class="book-list-count" id="book-list-count">共 ${books.length} 本</span>
        </div>
        <div id="book-list-body"></div>
        <div id="book-pagination"></div>
      </div>
    </div>
  `;

  container.querySelector('#open-wishlist-btn').addEventListener('click', () => openWishlistDrawer());

  const titleEl = container.querySelector('#book-list-title');
  const activeFiltersRow = container.querySelector('#active-filters-row');
  const activeFilterBadgesEl = container.querySelector('#active-filter-badges');
  const clearFiltersBtn = container.querySelector('#clear-filters-btn');
  const viewModeBtn = container.querySelector('#view-mode-toggle-btn');
  const searchInput = container.querySelector('#book-search');
  wireSearchClear(container);
  const sortSelect = container.querySelector('#book-sort-select');
  const pageSizeSelect = container.querySelector('#book-page-size-select');
  const bodyEl = container.querySelector('#book-list-body');
  const paginationEl = container.querySelector('#book-pagination');
  const countEl = container.querySelector('#book-list-count');
  const dashboardMainEl = container.querySelector('.dashboard-main');

  // 「篩選與批量」按鈕：點下去才展開排序／每頁顯示／批量選取開關這個小面板，
  // 平常收合不佔搜尋列版面。點面板外面或按 Esc 收起見模組最上面那兩個
  // document 監聽器（跟這裡的 .inline-status-popover 是同一套做法）。
  const filterBatchToggleBtn = container.querySelector('#filter-batch-toggle-btn');
  const filterBatchPanel = container.querySelector('#filter-batch-panel');
  filterBatchToggleBtn.addEventListener('click', () => {
    const willShow = filterBatchPanel.hidden;
    filterBatchPanel.hidden = !willShow;
    filterBatchToggleBtn.setAttribute('aria-expanded', String(willShow));
  });

  // 批量選取模式：預設關閉（勾選框不顯示），開啟時才在 .dashboard-main 補一個
  // class，靠 CSS 顯示表格／卡片上的勾選框（見 styles.css 的 .row-select-checkbox／
  // .book-gallery-checkbox 預設 display:none）。關閉時順便清空已選取的項目、
  // 收起底部批量操作列——不然使用者關掉批量模式後，勾選框消失但選取狀態、
  // 浮動操作列還留著，會很不直覺。
  const batchModeCheckbox = container.querySelector('#batch-mode-checkbox');
  batchModeCheckbox.addEventListener('change', () => {
    dashboardMainEl.classList.toggle('is-batch-mode', batchModeCheckbox.checked);
    if (!batchModeCheckbox.checked) {
      selectedIds.clear();
      refreshBatchBar();
    }
  });

  // 左側「閱讀統計」的年份選單／閱讀狀態方塊／各類型書籍數量，跟右側書籍列表是同一份狀態，
  // 四種篩選各自獨立、可以同時套用（AND 組合）：年份只留「該年完成日期在該年份且已讀完」的書，
  // 狀態只留符合閱讀中／尚未閱讀／已讀完的書，分類只留符合該分類的書，
  // 作者只留符合該作者的書（見下面 applyAuthorFilter）。
  let yearFilter = null;
  let statusFilter = null;
  let categoryFilter = null;
  let authorFilter = readAndClearAuthorFilterFromHash();
  let viewMode = 'table';
  let pageSize = 12;
  let currentPage = 1;
  // 批量操作列（Batch Action Bar）勾選狀態：只存書籍 id，不存整份書籍物件——
  // 每次 renderList() 都會用這個 Set 重新決定每一列/每張卡片的勾選框要不要打勾，
  // 這個 Set 本身才是「唯一事實來源」，checkbox 的 checked 屬性只是照它畫出來的結果。
  const selectedIds = new Set();

  // 批量操作列本身是掛在 document.body 上的單例元素（見 utils.js 的
  // updateBatchActionBar()），離開這頁（切到書籍詳情頁、資料管理頁……）
  // 要記得清空選取＋收起面板，不然面板會跟著單例元素一起「越權」浮在
  // 別的頁面上——跟這個檔案上面 hideStatusPopover 的 hashchange 監聽器
  // 是同一種必要防線，不是預防性猜測（這裡曾經只清空 selectedIds 這個
  // Set，沒有真的呼叫 updateBatchActionBar() 讓面板跟著收起，畫面上的
  // 面板其實不會消失，是實測抓到的真實問題，不是預防性猜測）。
  window.addEventListener('hashchange', () => {
    selectedIds.clear();
    updateBatchActionBar(selectedIds, []);
  });

  function refreshBatchBar() {
    updateBatchActionBar(selectedIds, [
      {
        id: 'batch-category',
        label: '批次變更類別',
        onClick: async (ids) => {
          const category = await openBatchCategoryModal();
          if (category === null) return; // 使用者取消，''（先不分類）是合法選擇
          for (const id of ids) {
            const book = books.find((b) => b.id === id);
            if (!book) continue;
            await DB.update('books', { ...book, category });
            book.category = category;
          }
          selectedIds.clear();
          showToast(`已將 ${ids.length} 本書變更類別`);
          renderList();
          refreshBatchBar();
        },
      },
      {
        id: 'batch-delete',
        label: '批次刪除',
        danger: true,
        onClick: async (ids) => {
          const confirmed = await confirmModal({
            title: `確定要刪除這 ${ids.length} 本書嗎？`,
            message: '此動作無法復原，連同它們的閱讀紀錄、輸出、筆記、圖譜一起刪除。',
            confirmText: '刪除',
            cancelText: '取消',
            danger: true,
          });
          if (!confirmed) return;
          // 跟 bookDetail.js 單本刪除同一套關聯資料清除順序（見該檔案
          // #delete-book 的監聽器），只是這裡對一批 id 各跑一次。
          for (const id of ids) {
            await DB.removeByIndex('reading_records', 'bookId', id);
            await DB.removeByIndex('outputs', 'bookId', id);
            await DB.removeByIndex('quotes', 'bookId', id);
            await DB.removeByIndex('notes', 'bookId', id);
            await DB.removeByIndex('edges', 'bookId', id);
            await DB.removeByIndex('nodes', 'bookId', id);
            await DB.remove('books', id);
            const bookIdx = books.findIndex((b) => b.id === id);
            if (bookIdx !== -1) books.splice(bookIdx, 1);
          }
          index = index.filter((entry) => !ids.includes(entry.book.id));
          selectedIds.clear();
          showToast(`已刪除 ${ids.length} 本書`);
          renderList();
          refreshBatchBar();
        },
      },
    ], () => renderList());
  }

  // 作者篩選沒有像其他篩選那樣「點原本那個 UI 元素就能取消」的對應開關（作者名稱
  // 到處都可以點：表格、封面卡片、側邊欄喜愛作者、書籍詳情頁），統一收斂到這個
  // 函式，篩選標籤列的清除按鈕跟四個點擊來源都呼叫同一份邏輯。
  function applyAuthorFilter(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    authorFilter = trimmed;
    currentPage = 1;
    renderList();
  }

  // 平滑滾動回列表頂部，只有「切換每頁顯示數量」跟「換頁」這兩種操作才需要——
  // 打字搜尋、切換篩選這些操作使用者視線本來就停在畫面上，不需要幫他們捲動。
  function scrollListToTop() {
    titleEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 右側「動態篩選標籤」膠囊：每種篩選各自一顆，膠囊上的 ✕ 只取消該項篩選，
  // 沿用各自原本「再點一次左側原標籤即可取消」的邏輯（模擬點擊該 UI 元素），不用另外重寫一份取消規則。
  function activeFilterEntries() {
    const entries = [];
    if (yearFilter) {
      entries.push({ key: 'year', label: `${yearFilter} 年已讀完`, remove: () => {
        const yearSelect = container.querySelector('#sidebar-stats-year-select');
        yearSelect.value = '';
        yearSelect.dispatchEvent(new Event('change'));
      } });
    }
    if (statusFilter) {
      entries.push({ key: 'status', label: statusFilter, remove: () => {
        const cell = container.querySelector('.sidebar-stat-cell.is-active');
        if (cell) cell.click();
      } });
    }
    if (categoryFilter) {
      entries.push({ key: 'category', label: categoryFilter, remove: () => {
        const item = container.querySelector('.category-progress-item.is-active');
        if (item) item.click();
      } });
    }
    if (authorFilter) {
      const authorBookCount = books.filter((b) => (b.author || '').trim() === authorFilter).length;
      entries.push({ key: 'author', label: `作者：${authorFilter}（共 ${authorBookCount} 本）`, remove: () => {
        authorFilter = null;
        currentPage = 1;
        renderList();
      } });
    }
    return entries;
  }

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    const searched = query
      ? index.filter((entry) => entry.searchText.includes(query)).map((entry) => entry.book)
      : books;
    let base = filterBooksCompletedInYear(searched, recordMap, yearFilter);
    base = filterBooksByStatus(base, recordMap, statusFilter);
    base = filterBooksByCategory(base, categoryFilter);
    base = filterBooksByAuthor(base, authorFilter);
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    // 分頁永遠是「搜尋＋篩選＋排序都套用完之後」的最後一步，總頁數依 sorted（搜尋後的
    // 結果）而不是 books（全部書籍）去算；currentPage 在這裡夾一次範圍，是防呆保險——
    // 理論上每個會改變 sorted 內容的操作（搜尋、篩選、換排序、換每頁筆數）都已經在
    // 各自的事件監聽器裡把 currentPage 重設回 1，這裡只是避免萬一漏掉某個角落。
    const isShowAll = pageSize === 'all';
    const effectivePageSize = isShowAll ? Math.max(sorted.length, 1) : pageSize;
    const totalPages = Math.max(1, Math.ceil(sorted.length / effectivePageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const pageItems = isShowAll ? sorted : sorted.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

    if (sorted.length === 0) {
      if (query) {
        bodyEl.innerHTML = `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`;
      } else if (yearFilter || statusFilter || categoryFilter || authorFilter) {
        bodyEl.innerHTML = '<p class="empty">沒有符合目前篩選條件的書籍。</p>';
      } else if (books.length === 0) {
        // 真正的「資料庫一本書都沒有」（不是篩選/搜尋篩到剩零筆），見上面
        // emptyLibraryStateHtml() 的完整說明。
        bodyEl.innerHTML = emptyLibraryStateHtml();
        bodyEl.querySelector('#load-sample-books-btn').addEventListener('click', async (event) => {
          event.target.disabled = true;
          await loadSampleBooks();
          showToast('已載入 3 本範例書籍');
          await renderBookList(container);
        });
      } else {
        bodyEl.innerHTML = '<p class="empty">還沒有任何書籍，點擊上方新增第一本。</p>';
      }
      paginationEl.innerHTML = '';
    } else {
      bodyEl.innerHTML = viewMode === 'gallery'
        ? bookGalleryHtml(pageItems, favoriteAuthors, recordMap, selectedIds)
        : bookTableHtml(pageItems, favoriteAuthors, recordMap, selectedIds);
      bodyEl.querySelectorAll('.book-gallery-cover img').forEach(wireCoverImage);
      paginationEl.innerHTML = paginationHtml(currentPage, totalPages);
      paginationEl.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentPage = Number(btn.dataset.page);
          renderList();
          scrollListToTop();
        });
      });
    }
    countEl.textContent = sorted.length === books.length ? `共 ${books.length} 本` : `符合 ${sorted.length} 本（共 ${books.length} 本）`;
    titleEl.textContent = '所有書籍';

    const filters = activeFilterEntries();
    if (filters.length > 0) {
      activeFiltersRow.hidden = false;
      activeFilterBadgesEl.innerHTML = filters.map((f) => `
        <span class="filter-badge" data-key="${f.key}">
          篩選條件：${escapeHtml(f.label)}
          <button type="button" class="filter-badge-remove" data-key="${f.key}" aria-label="移除篩選：${escapeHtml(f.label)}">${CLOSE_ICON}</button>
        </span>
      `).join('');
      activeFilterBadgesEl.querySelectorAll('.filter-badge-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          const entry = filters.find((f) => f.key === btn.dataset.key);
          if (entry) entry.remove();
        });
      });
    } else {
      activeFiltersRow.hidden = true;
      activeFilterBadgesEl.innerHTML = '';
    }
  }

  viewModeBtn.addEventListener('click', () => {
    viewMode = viewMode === 'table' ? 'gallery' : 'table';
    viewModeBtn.innerHTML = viewMode === 'table' ? GRID_ICON : LIST_ICON;
    viewModeBtn.title = viewMode === 'table' ? '切換為封面網格檢視' : '切換為表格檢視';
    viewModeBtn.classList.toggle('is-active', viewMode === 'gallery');
    renderList();
  });

  clearFiltersBtn.addEventListener('click', () => {
    yearFilter = null;
    statusFilter = null;
    categoryFilter = null;
    authorFilter = null;
    currentPage = 1;
    searchInput.value = '';
    const yearSelect = container.querySelector('#sidebar-stats-year-select');
    if (yearSelect.value) {
      yearSelect.value = '';
      yearSelect.dispatchEvent(new Event('change'));
    }
    const activeStatusCell = container.querySelector('.sidebar-stat-cell.is-active');
    if (activeStatusCell) activeStatusCell.click();
    const activeCategoryItem = container.querySelector('.category-progress-item.is-active');
    if (activeCategoryItem) activeCategoryItem.click();
    renderList();
  });

  // 傳進去的是內層的 #dashboard-sidebar-inner，不是 <aside> 本身——
  // renderDashboardSidebar() 會整個覆蓋掉傳入容器的 innerHTML，如果直接傳
  // <aside>，每次重繪都會把外面那顆「✕ 關閉」按鈕一起洗掉。
  await renderDashboardSidebar(container.querySelector('#dashboard-sidebar-inner'), {
    onYearChange: (year) => {
      yearFilter = year;
      currentPage = 1;
      renderList();
    },
    onStatusFilterChange: (status) => {
      statusFilter = status;
      currentPage = 1;
      renderList();
    },
    onCategoryFilterChange: (category) => {
      categoryFilter = category;
      currentPage = 1;
      renderList();
    },
  });

  // 側邊欄抽屜（手機／平板直立版）的關閉方式：抽屜自己的「✕ 關閉」按鈕、
  // 點背景遮罩、按 Esc，三種都收斂到同一個 closeSidebarDrawer()。開啟的觸發
  // 按鈕在 Header（app.js 掛的委派監聽器），這裡只管關閉——這幾個元素每次
  // renderBookList() 都是全新的 DOM 節點，直接綁定不會有累積監聽器的問題
  // （跟開啟按鈕那種「按鈕本身是永久存在的靜態元素」是不同情況，見 app.js
  // 開頭註解）。
  const sidebarDrawerEl = container.querySelector('#dashboard-sidebar');
  const sidebarBackdropEl = container.querySelector('#sidebar-drawer-backdrop');
  function closeSidebarDrawer() {
    sidebarDrawerEl.classList.remove('is-open');
    sidebarBackdropEl.classList.remove('is-open');
  }
  container.querySelector('#sidebar-drawer-close').addEventListener('click', closeSidebarDrawer);
  sidebarBackdropEl.addEventListener('click', closeSidebarDrawer);
  pushEscapeHandler(() => {
    if (!sidebarDrawerEl.classList.contains('is-open')) return false;
    closeSidebarDrawer();
    return true;
  });

  // 表格模式的作者按鈕、封面網格模式的作者 <span> 共用同一個 delegated listener——
  // #book-list-body 底下的內容每次 renderList() 都整個重繪，掛在容器本身而不是
  // 個別元素上，才不用每次重繪後重新綁定。網格卡片本身是 <a>，這裡順手擋掉外層
  // 導覽，讓點作者名稱只觸發篩選、不會同時跳進書籍詳情頁。
  bodyEl.addEventListener('click', (event) => {
    const link = event.target.closest('.author-name-link');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    applyAuthorFilter(link.dataset.author);
  });

  // 批量操作勾選框：表格版、封面網格版共用同一個 .book-select-checkbox class，
  // 靠 data-select-id 對應書籍 id。這裡只維護 selectedIds 這個 Set 並刷新
  // 底部的批量操作列，不用整頁重繪——重繪只會影響「排序／篩選／分頁」，
  // 勾選狀態本身不需要因為打勾這個動作就重新整理列表。
  bodyEl.addEventListener('change', (event) => {
    const checkbox = event.target.closest('.book-select-checkbox');
    if (!checkbox) return;
    const id = Number(checkbox.dataset.selectId);
    if (checkbox.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    refreshBatchBar();
  });

  // 完成日期欄位點下去跳出快速更新面板（見上面 openStatusPopover() 的說明）。
  bodyEl.addEventListener('click', (event) => {
    const trigger = event.target.closest('.book-status-trigger');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    const id = Number(trigger.dataset.bookId);
    const book = books.find((b) => b.id === id);
    if (!book) return;
    openStatusPopover(trigger, book, recordMap, () => renderList());
  });

  searchInput.addEventListener('input', () => {
    currentPage = 1;
    renderList();
  });
  sortSelect.addEventListener('change', () => {
    currentPage = 1;
    renderList();
  });
  pageSizeSelect.addEventListener('change', () => {
    pageSize = pageSizeSelect.value === 'all' ? 'all' : Number(pageSizeSelect.value);
    currentPage = 1;
    renderList();
    scrollListToTop();
  });
  renderList();
}
