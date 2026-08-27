import { DB } from './db.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml } from './utils.js';
import { renderDashboardSidebar } from './dashboardSidebar.js';
import { loadRecordByBookMap, filterBooksCompletedInYear, filterBooksByStatus, filterBooksByCategory } from './bookStats.js';

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
}

// 「顯示全部書籍」按鈕用的細線 X，取代原本比較搶眼、線條較粗的「✕」文字符號。
const CLOSE_ICON = '<svg class="reset-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

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
            <button type="button" class="btn year-filter-reset-btn" id="year-filter-reset-btn" hidden>${CLOSE_ICON}顯示全部書籍</button>
          </div>
          <a class="btn btn-primary" href="#/books/new">＋ 新增書籍</a>
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
  const yearResetBtn = container.querySelector('#year-filter-reset-btn');
  const searchInput = container.querySelector('#book-search');
  const sortSelect = container.querySelector('#book-sort-select');
  const bodyEl = container.querySelector('#book-list-body');
  const countEl = container.querySelector('#book-list-count');

  // 左側「閱讀統計」的年份選單／閱讀狀態方塊／各類型書籍數量，跟右側書籍列表是同一份狀態，
  // 三種篩選各自獨立、可以同時套用（AND 組合）：年份只留「該年完成日期在該年份且已讀完」的書，
  // 狀態只留符合閱讀中／尚未閱讀／已讀完的書，分類只留符合該分類的書。
  let yearFilter = null;
  let statusFilter = null;
  let categoryFilter = null;

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    const searched = query
      ? index.filter((entry) => entry.searchText.includes(query)).map((entry) => entry.book)
      : books;
    let base = filterBooksCompletedInYear(searched, recordMap, yearFilter);
    base = filterBooksByStatus(base, recordMap, statusFilter);
    base = filterBooksByCategory(base, categoryFilter);
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    if (sorted.length === 0) {
      bodyEl.innerHTML = query
        ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
        : `<p class="empty">${(yearFilter || statusFilter || categoryFilter) ? '沒有符合目前篩選條件的書籍。' : '還沒有任何書籍，點擊上方新增第一本。'}</p>`;
    } else {
      bodyEl.innerHTML = bookTableHtml(sorted, favoriteAuthors, recordMap);
    }
    countEl.textContent = sorted.length === books.length ? `共 ${books.length} 本` : `符合 ${sorted.length} 本（共 ${books.length} 本）`;

    const filterLabels = [];
    if (yearFilter) filterLabels.push(`${yearFilter} 年已讀完`);
    if (statusFilter) filterLabels.push(statusFilter);
    if (categoryFilter) filterLabels.push(categoryFilter);

    if (filterLabels.length > 0) {
      titleEl.textContent = `所有書籍（${filterLabels.join('、')}）`;
      yearResetBtn.hidden = false;
    } else {
      titleEl.textContent = '所有書籍';
      yearResetBtn.hidden = true;
    }
  }

  yearResetBtn.addEventListener('click', () => {
    yearFilter = null;
    statusFilter = null;
    categoryFilter = null;
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
  });

  searchInput.addEventListener('input', renderList);
  sortSelect.addEventListener('change', renderList);
  renderList();
}
