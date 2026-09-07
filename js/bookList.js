import { DB } from './db.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml, showToast, wireSearchClear, wireCoverImage, confirmModal, updateBatchActionBar } from './utils.js';
import { renderDashboardSidebar } from './dashboardSidebar.js';
import { loadRecordByBookMap, filterBooksCompletedInYear, filterBooksByStatus, filterBooksByAuthor } from './bookStats.js';
import { openWishlistDrawer } from './wishlist.js';
import { pushEscapeHandler } from './services/keyboardShortcutsService.js';
import { ICON_SPARKLES } from './icons.js';
import { CLOSE_ICON, LIST_ICON, GRID_ICON, bookListToolbarHtml } from './bookListToolbar.js';
import { bookTableHtml, bookGalleryHtml } from './bookListRowTemplates.js';
import { buildSearchIndex } from './bookListSearch.js';
import { sortBooks, paginationHtml } from './bookListPagination.js';
import { emptyLibraryStateHtml, loadSampleBooks } from './bookListEmptyState.js';
import { openStatusPopover } from './bookStatusPopover.js';
import { openBatchCategoryModal } from './bookBatchCategoryModal.js';

// 這支檔案是「所有書籍」列表頁的主控制器（畫面組裝、篩選／排序／分頁狀態、
// 事件串接）。原本 933 行、是全站健檢中偏大的檔案之一，已經拆成好幾個各自
// 獨立、職責單一的模組：
//   - js/bookListToolbar.js      頂部工具列樣板＋工具列專用圖示
//   - js/bookListRowTemplates.js 表格列／封面卡片樣板（對應「BookTableRow」）
//   - js/bookListSearch.js       搜尋索引建構
//   - js/bookListPagination.js   排序選項／分頁邏輯
//   - js/bookListEmptyState.js   新手引導空狀態＋範例書籍
//   - js/bookStatusPopover.js    「完成日期」欄位的快速狀態切換面板
//   - js/bookBatchCategoryModal.js 批量操作的「批次變更類別」彈窗
// 這裡只剩「串起畫面、串起篩選/排序/分頁狀態、串起各模組」的膠水邏輯，
// 見各檔案開頭的說明。

// 雲端快取背景刷新（見 cloudDb.js／services/cloudCache.js 的 Stale-While-Revalidate
// 說明）如果發現書籍資料真的變了，會發出這個事件——這裡只負責跳一個不打擾的
// Toast 提示，不強制重繪目前畫面（使用者可能正在搜尋/篩選到一半，貿然重繪
// 會把捲動位置、輸入到一半的搜尋字串都弄丟），重新整理頁面就會看到最新內容。
// 掛在模組頂層只註冊一次，不會因為 renderBookList() 被重複呼叫而重複掛聽。
window.addEventListener('marginalia:cloud-cache-updated', (event) => {
  if (event.detail?.store !== 'books') return;
  showToast('雲端書籍資料已更新，重新整理即可看到最新內容');
});

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
        ${bookListToolbarHtml(books.length)}
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

  // 左側「閱讀統計」的年份選單／閱讀狀態方塊／「喜愛的作者」，跟右側書籍列表是
  // 同一份狀態，三種篩選各自獨立、可以同時套用（AND 組合）：年份只留「該年
  // 完成日期在該年份且已讀完」的書，狀態只留符合閱讀中／尚未閱讀／已讀完的書，
  // 作者只留符合該作者的書（見下面 applyAuthorFilter）。
  let yearFilter = null;
  let statusFilter = null;
  let authorFilter = readAndClearAuthorFilterFromHash();
  let viewMode = 'table';
  // 每次搜尋／篩選／排序／每頁顯示筆數改變都要把頁碼重設回第 1 頁，不然
  // 切換篩選後畫面還停在「原本第 N 頁」，可能反而看不到剛套用篩選後排在
  // 最前面的結果，甚至因為總頁數變少而超出範圍。
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
    base = filterBooksByAuthor(base, authorFilter);
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    // 分頁永遠是「搜尋＋篩選＋排序都套用完之後」的最後一步，總頁數依 sorted
    // （搜尋後的結果）而不是 books（全部書籍）去算；currentPage 在這裡夾一次
    // 範圍，是防呆保險——理論上每個會改變 sorted 內容的操作（搜尋、篩選、
    // 換排序、換每頁筆數）都已經在各自的事件監聽器裡把 currentPage 重設回
    // 1，這裡只是避免萬一漏掉某個角落。
    const isShowAll = pageSize === 'all';
    const effectivePageSize = isShowAll ? Math.max(sorted.length, 1) : pageSize;
    const totalPages = Math.max(1, Math.ceil(sorted.length / effectivePageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const pageItems = isShowAll ? sorted : sorted.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);

    if (sorted.length === 0) {
      if (query) {
        bodyEl.innerHTML = `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`;
      } else if (yearFilter || statusFilter || authorFilter) {
        bodyEl.innerHTML = '<p class="empty">沒有符合目前篩選條件的書籍。</p>';
      } else if (books.length === 0) {
        // 真正的「資料庫一本書都沒有」（不是篩選/搜尋篩到剩零筆），見
        // bookListEmptyState.js 的 emptyLibraryStateHtml() 完整說明。
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
    const viewModeLabel = viewMode === 'table' ? '切換為封面網格檢視' : '切換為表格檢視';
    viewModeBtn.setAttribute('data-tooltip', viewModeLabel);
    viewModeBtn.setAttribute('aria-label', viewModeLabel);
    viewModeBtn.classList.toggle('is-active', viewMode === 'gallery');
    renderList();
  });

  clearFiltersBtn.addEventListener('click', () => {
    yearFilter = null;
    statusFilter = null;
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
    onAuthorClick: applyAuthorFilter,
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

  // 完成日期欄位點下去跳出快速更新面板（見 bookStatusPopover.js 的
  // openStatusPopover() 說明）。
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
