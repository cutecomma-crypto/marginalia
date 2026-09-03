import { DB } from './db.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml, showToast } from './utils.js';
import { renderDashboardSidebar } from './dashboardSidebar.js';
import { patchRetentionCountBadge } from './stats.js';
import { loadRecordByBookMap, filterBooksCompletedInYear, filterBooksByStatus, filterBooksByCategory, filterBooksByRetentionStatus, filterBooksByAuthor } from './bookStats.js';
import { LENT_OUT_RETENTION_STATUS, BORROWED_RETENTION_STATUS, LIBRARY_SOURCE_FORMAT, QUICK_RETENTION_ACTIONS } from './bookForm.js';
import { openWishlistDrawer } from './wishlist.js';

// 雲端快取背景刷新（見 cloudDb.js／services/cloudCache.js 的 Stale-While-Revalidate
// 說明）如果發現書籍資料真的變了，會發出這個事件——這裡只負責跳一個不打擾的
// Toast 提示，不強制重繪目前畫面（使用者可能正在搜尋/篩選到一半，貿然重繪
// 會把捲動位置、輸入到一半的搜尋字串都弄丟），重新整理頁面就會看到最新內容。
// 掛在模組頂層只註冊一次，不會因為 renderBookList() 被重複呼叫而重複掛聽。
window.addEventListener('marginalia:cloud-cache-updated', (event) => {
  if (event.detail?.store !== 'books') return;
  showToast('雲端書籍資料已更新，重新整理即可看到最新內容');
});

// 借出中／借入未還兩顆快捷篩選按鈕共用同一個 retentionFilter 狀態，這裡統一決定標題上要顯示哪個中文標籤。
function retentionFilterLabel(retention) {
  if (retention === LENT_OUT_RETENTION_STATUS) return '借出中';
  if (retention === BORROWED_RETENTION_STATUS) return '借入未還';
  return retention;
}

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

// 完成日期欄位：純文字、低調的次要顏色，不用圖示也不用圓角底色框，
// 完成了顯示日期、還沒完成顯示「—」，樣式統一維持簡約。
function completedDateCell(record) {
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

// 快捷狀態切換按鈕：「借入未還」顯示「一鍵歸還」、「借出」顯示「已收回」，
// 其餘狀態不顯示——QUICK_RETENTION_ACTIONS（bookForm.js）決定某個狀態該顯示
// 什麼文字、點下去要切到哪個目標狀態，這裡只負責照設定把 HTML 印出來。
// 跟作者名稱一樣走 event delegation（見下方 bodyEl.addEventListener），
// 表格版用 <button>、封面網格版因為外層卡片本身已經是 <a>，
// 一樣改用 <span> 避免巢狀 <button> 的 HTML 語意問題。
function quickActionBtnHtml(book) {
  const action = QUICK_RETENTION_ACTIONS[book.retentionStatus];
  if (!action) return '';
  return `<button type="button" class="quick-action-btn" data-book-id="${book.id}" data-target-status="${escapeHtml(action.targetStatus)}" data-toast="${escapeHtml(action.toast)}" title="${escapeHtml(action.label)}">${escapeHtml(action.label)}</button>`;
}

function quickActionBtnHtmlInline(book) {
  const action = QUICK_RETENTION_ACTIONS[book.retentionStatus];
  if (!action) return '';
  return `<span class="quick-action-btn" data-book-id="${book.id}" data-target-status="${escapeHtml(action.targetStatus)}" data-toast="${escapeHtml(action.toast)}" title="${escapeHtml(action.label)}">${escapeHtml(action.label)}</span>`;
}

function bookRow(book, favoriteAuthors, recordMap) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  // data-label：手機版把表格轉成一張張卡片時（見 styles.css 的 @media (max-width: 768px)
  // .book-table 區塊），每個 <td> 用 CSS ::before 讀這個屬性當左側欄位名稱標籤，
  // 不用另外為手機版寫一套完全不同的卡片 HTML 樣板。
  return `
    <tr>
      <td data-label="書名"><a href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">${escapeHtml(book.title || '（未命名）')}</a></td>
      <td class="author-cell" data-label="作者"><span class="author-cell-value"><span class="author-star${isFavoriteAuthor ? '' : ' is-hidden'}" title="喜愛的作者">♥</span>${authorNameHtml(book)}</span></td>
      <td data-label="書籍類型">${escapeHtml(book.category)}</td>
      <td data-label="完成日期">${completedDateCell(record)}</td>
      <td class="action-cell" data-label="書籍歸還">${quickActionBtnHtml(book)}</td>
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

function bookTableHtml(list, favoriteAuthors, recordMap) {
  return `
    <table class="book-table">
      <colgroup>
        <col class="col-title">
        <col class="col-author">
        <col class="col-category">
        <col class="col-completed">
        <col class="col-actions">
      </colgroup>
      <thead>
        <tr><th>書名</th><th>作者</th><th>書籍類型</th><th>完成日期</th><th>書籍歸還</th></tr>
      </thead>
      <tbody>
        ${list.map((book) => bookRow(book, favoriteAuthors, recordMap)).join('')}
      </tbody>
    </table>
  `;
}

// 封面網格檢視：跟表格模式吃同一份 list／favoriteAuthors／recordMap，只是換一種排版，
// 沒有封面的書用書本 emoji 佔位，不留空白方塊。
function bookGalleryCard(book, favoriteAuthors, recordMap) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <a class="book-gallery-card" href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">
      <div class="book-gallery-cover">
        ${book.coverImage ? `<img src="${book.coverImage}" alt="《${escapeHtml(book.title || '未命名')}》封面">` : '<span class="book-gallery-cover-placeholder">📖</span>'}
      </div>
      <div class="book-gallery-info">
        <div class="book-gallery-title">${escapeHtml(book.title || '（未命名）')}</div>
        <div class="book-gallery-author">${isFavoriteAuthor ? '<span class="author-star" title="喜愛的作者">♥</span> ' : ''}${authorNameHtmlInline(book)}</div>
        <div class="book-gallery-meta">
          ${book.category ? `<span class="book-gallery-category">${escapeHtml(book.category)}</span>` : ''}
          ${completedDateCell(record)}
        </div>
        ${quickActionBtnHtmlInline(book)}
      </div>
    </a>
  `;
}

function bookGalleryHtml(list, favoriteAuthors, recordMap) {
  return `<div class="book-gallery">${list.map((book) => bookGalleryCard(book, favoriteAuthors, recordMap)).join('')}</div>`;
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
  { value: 'completed-desc', label: '完成時間：新到舊' },
  { value: 'completed-asc', label: '完成時間：舊到新' },
];

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
  } else {
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); // created-desc（預設）
  }
  return list;
}

export async function renderBookList(container) {
  const books = await DB.getAll('books');
  const index = await buildSearchIndex(books);
  const favoriteAuthors = await getFavoriteAuthorMap();
  const recordMap = await loadRecordByBookMap();

  container.innerHTML = `
    <div class="dashboard-layout">
      <aside class="dashboard-sidebar" id="dashboard-sidebar"></aside>
      <div class="dashboard-main">
        <div class="toolbar">
          <div class="toolbar-title-row">
            <h2 id="book-list-title">所有書籍</h2>
            <button type="button" class="view-mode-toggle-btn" id="view-mode-toggle-btn" title="切換為封面網格檢視">${GRID_ICON}</button>
          </div>
          <div class="toolbar-actions">
            <button type="button" class="btn" id="open-wishlist-btn">✨ 願望清單</button>
            <a class="btn btn-primary" href="#/books/new">＋ 新增書籍</a>
          </div>
        </div>
        <div class="active-filters-row" id="active-filters-row" hidden>
          <div class="active-filter-badges" id="active-filter-badges"></div>
          <button type="button" class="clear-filters-btn" id="clear-filters-btn">${CLOSE_ICON}清除篩選</button>
        </div>
        <div class="search-row">
          <input type="search" id="book-search" class="search-input" placeholder="搜尋書名、作者、#標籤，或筆記／佳句內容…">
          <select id="book-sort-select" class="sort-select">
            ${SORT_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
          <select id="book-page-size-select" class="sort-select">
            ${PAGE_SIZE_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
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
  const sortSelect = container.querySelector('#book-sort-select');
  const pageSizeSelect = container.querySelector('#book-page-size-select');
  const bodyEl = container.querySelector('#book-list-body');
  const paginationEl = container.querySelector('#book-pagination');
  const countEl = container.querySelector('#book-list-count');

  // 左側「閱讀統計」的年份選單／閱讀狀態方塊／各類型書籍數量／借出中／熱門標籤，跟右側書籍列表是同一份狀態，
  // 六種篩選各自獨立、可以同時套用（AND 組合）：年份只留「該年完成日期在該年份且已讀完」的書，
  // 狀態只留符合閱讀中／尚未閱讀／已讀完的書，分類只留符合該分類的書，借出中／借入中只留符合的存留狀態，
  // 作者只留符合該作者的書（見下面 applyAuthorFilter），
  // activeTag 是熱門標籤點擊帶出來的搜尋字串（跟使用者自己打字搜尋分開追蹤，才能只有前者顯示成篩選膠囊）。
  let yearFilter = null;
  let statusFilter = null;
  let categoryFilter = null;
  let retentionFilter = null;
  let activeTag = null;
  let authorFilter = readAndClearAuthorFilterFromHash();
  let viewMode = 'table';
  let pageSize = 12;
  let currentPage = 1;

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
    if (retentionFilter) {
      entries.push({ key: 'retention', label: retentionFilterLabel(retentionFilter), remove: () => {
        const btn = container.querySelector('.retention-filter-btn.is-active');
        if (btn) btn.click();
      } });
    }
    if (activeTag) {
      entries.push({ key: 'tag', label: `#${activeTag}`, remove: () => {
        const chip = container.querySelector('.popular-tag-chip.is-active');
        if (chip) chip.click();
      } });
    }
    if (authorFilter) {
      const authorBookCount = books.filter((b) => (b.author || '').trim() === authorFilter).length;
      entries.push({ key: 'author', label: `👤 作者：${authorFilter}（共 ${authorBookCount} 本）`, remove: () => {
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
    base = filterBooksByRetentionStatus(base, retentionFilter);
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
      bodyEl.innerHTML = query
        ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
        : `<p class="empty">${(yearFilter || statusFilter || categoryFilter || retentionFilter || authorFilter) ? '沒有符合目前篩選條件的書籍。' : '還沒有任何書籍，點擊上方新增第一本。'}</p>`;
      paginationEl.innerHTML = '';
    } else {
      bodyEl.innerHTML = viewMode === 'gallery'
        ? bookGalleryHtml(pageItems, favoriteAuthors, recordMap)
        : bookTableHtml(pageItems, favoriteAuthors, recordMap);
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
    retentionFilter = null;
    activeTag = null;
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
    const activeRetentionBtn = container.querySelector('.retention-filter-btn.is-active');
    if (activeRetentionBtn) activeRetentionBtn.click();
    const activeTagChip = container.querySelector('.popular-tag-chip.is-active');
    if (activeTagChip) activeTagChip.classList.remove('is-active');
    renderList();
  });

  await renderDashboardSidebar(container.querySelector('#dashboard-sidebar'), {
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
    onRetentionFilterChange: (retention) => {
      retentionFilter = retention;
      currentPage = 1;
      renderList();
    },
    onTagClick: (tag) => {
      activeTag = tag;
      searchInput.value = tag || '';
      currentPage = 1;
      renderList();
    },
    onAuthorClick: applyAuthorFilter,
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

  // 一鍵歸還／已收回：只改 books 陣列裡對應那本書的 retentionStatus 欄位（不用整批
  // 重新向資料庫要一次，其他欄位——作者、筆記、閱讀進度全部不動），renderList() 讀的
  // 就是同一份陣列，篩選／統計／操作欄按鈕立刻反映最新狀態；側邊欄「借出中／借入未還」
  // 按鈕的本數是另一棵獨立的渲染樹，同時補一個小 DOM 更新（patchRetentionCountBadge）
  // 避免整個側邊欄重繪，打斷使用者當下展開的分類清單、選到的年份等狀態。
  bodyEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('.quick-action-btn');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const id = Number(btn.dataset.bookId);
    const book = books.find((b) => b.id === id);
    if (!book) return;
    const targetStatus = btn.dataset.targetStatus;
    await DB.update('books', { ...book, retentionStatus: targetStatus });
    book.retentionStatus = targetStatus;
    showToast(btn.dataset.toast);
    renderList();
    const sidebarEl = container.querySelector('#dashboard-sidebar');
    const newBorrowedCount = books.filter((b) => b.format === LIBRARY_SOURCE_FORMAT && b.retentionStatus === BORROWED_RETENTION_STATUS).length;
    const newLentOutCount = books.filter((b) => b.retentionStatus === LENT_OUT_RETENTION_STATUS).length;
    patchRetentionCountBadge(sidebarEl, BORROWED_RETENTION_STATUS, newBorrowedCount);
    patchRetentionCountBadge(sidebarEl, LENT_OUT_RETENTION_STATUS, newLentOutCount);
  });

  searchInput.addEventListener('input', () => {
    activeTag = null;
    const activeTagChip = container.querySelector('.popular-tag-chip.is-active');
    if (activeTagChip) activeTagChip.classList.remove('is-active');
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
