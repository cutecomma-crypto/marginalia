import { DB } from './db.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml } from './utils.js';
import { renderDashboardSidebar } from './dashboardSidebar.js';
import { loadRecordByBookMap, filterBooksCompletedInYear, filterBooksByStatus, filterBooksByCategory, filterBooksByRetentionStatus } from './bookStats.js';
import { LENT_OUT_RETENTION_STATUS, BORROWED_RETENTION_STATUS } from './bookForm.js';

// 借出中／借入中兩顆快捷篩選按鈕共用同一個 retentionFilter 狀態，這裡統一決定標題上要顯示哪個中文標籤。
function retentionFilterLabel(retention) {
  if (retention === LENT_OUT_RETENTION_STATUS) return '借出中';
  if (retention === BORROWED_RETENTION_STATUS) return '借入中';
  return retention;
}

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
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

function bookRow(book, favoriteAuthors, recordMap) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <tr>
      <td><a href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">${escapeHtml(book.title || '（未命名）')}</a></td>
      <td class="author-cell" title="${escapeHtml(book.author)}"><span class="author-star${isFavoriteAuthor ? '' : ' is-hidden'}" title="喜愛的作者">♥</span>${escapeHtml(book.author)}</td>
      <td>${escapeHtml(book.category)}</td>
      <td>${completedDateCell(record)}</td>
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
      </colgroup>
      <thead>
        <tr><th>書名</th><th>作者</th><th>書籍類型</th><th>完成日期</th></tr>
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
        <div class="book-gallery-author">${isFavoriteAuthor ? '<span class="author-star" title="喜愛的作者">♥</span> ' : ''}${escapeHtml(book.author)}</div>
        <div class="book-gallery-meta">
          <span>${escapeHtml(book.category)}</span>
          ${completedDateCell(record)}
        </div>
      </div>
    </a>
  `;
}

function bookGalleryHtml(list, favoriteAuthors, recordMap) {
  return `<div class="book-gallery">${list.map((book) => bookGalleryCard(book, favoriteAuthors, recordMap)).join('')}</div>`;
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
          <a class="btn btn-primary" href="#/books/new">＋ 新增書籍</a>
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
          <span class="book-list-count" id="book-list-count">共 ${books.length} 本</span>
        </div>
        <div id="book-list-body"></div>
      </div>
    </div>
  `;

  const titleEl = container.querySelector('#book-list-title');
  const activeFiltersRow = container.querySelector('#active-filters-row');
  const activeFilterBadgesEl = container.querySelector('#active-filter-badges');
  const clearFiltersBtn = container.querySelector('#clear-filters-btn');
  const viewModeBtn = container.querySelector('#view-mode-toggle-btn');
  const searchInput = container.querySelector('#book-search');
  const sortSelect = container.querySelector('#book-sort-select');
  const bodyEl = container.querySelector('#book-list-body');
  const countEl = container.querySelector('#book-list-count');

  // 左側「閱讀統計」的年份選單／閱讀狀態方塊／各類型書籍數量／借出中／熱門標籤，跟右側書籍列表是同一份狀態，
  // 五種篩選各自獨立、可以同時套用（AND 組合）：年份只留「該年完成日期在該年份且已讀完」的書，
  // 狀態只留符合閱讀中／尚未閱讀／已讀完的書，分類只留符合該分類的書，借出中／借入中只留符合的存留狀態，
  // activeTag 是熱門標籤點擊帶出來的搜尋字串（跟使用者自己打字搜尋分開追蹤，才能只有前者顯示成篩選膠囊）。
  let yearFilter = null;
  let statusFilter = null;
  let categoryFilter = null;
  let retentionFilter = null;
  let activeTag = null;
  let viewMode = 'table';

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
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    if (sorted.length === 0) {
      bodyEl.innerHTML = query
        ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
        : `<p class="empty">${(yearFilter || statusFilter || categoryFilter || retentionFilter) ? '沒有符合目前篩選條件的書籍。' : '還沒有任何書籍，點擊上方新增第一本。'}</p>`;
    } else {
      bodyEl.innerHTML = viewMode === 'gallery'
        ? bookGalleryHtml(sorted, favoriteAuthors, recordMap)
        : bookTableHtml(sorted, favoriteAuthors, recordMap);
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
      renderList();
    },
    onStatusFilterChange: (status) => {
      statusFilter = status;
      renderList();
    },
    onCategoryFilterChange: (category) => {
      categoryFilter = category;
      renderList();
    },
    onRetentionFilterChange: (retention) => {
      retentionFilter = retention;
      renderList();
    },
    onTagClick: (tag) => {
      activeTag = tag;
      searchInput.value = tag || '';
      renderList();
    },
  });

  searchInput.addEventListener('input', () => {
    activeTag = null;
    const activeTagChip = container.querySelector('.popular-tag-chip.is-active');
    if (activeTagChip) activeTagChip.classList.remove('is-active');
    renderList();
  });
  sortSelect.addEventListener('change', renderList);
  renderList();
}
