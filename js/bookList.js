import { DB } from './db.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml } from './utils.js';
import { renderDashboardSidebar } from './dashboardSidebar.js';
import { loadRecordByBookMap, filterBooksCompletedInYear } from './bookStats.js';

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
}

// 細線條日曆 icon（Lucide 風格），取代原本太搶戲的格子旗 emoji，顏色跟 opacity 故意調淡，
// 讓它只是個安靜的小提示，不會比日期文字本身還顯眼。
const CALENDAR_ICON = '<svg class="badge-calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';

// 完成日期欄位：完成了就用綠色小標籤標出日期（視覺上一眼能認出「這本讀完了」），
// 還沒完成就顯示「—」，不再重複列一整欄閱讀狀態，把空間留給書名。
function completedDateCell(record) {
  if (record && record.endDate) {
    return `<span class="book-status-badge is-completed">${CALENDAR_ICON} ${escapeHtml(formatDateSlash(record.endDate))}</span>`;
  }
  return '<span class="book-status-empty">—</span>';
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
            <button type="button" class="btn year-filter-reset-btn" id="year-filter-reset-btn" hidden>✕ 顯示全部書籍</button>
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

  // 左側「閱讀統計」的年份選單跟右側書籍列表是同一份狀態：選了年份，這裡的清單只留
  // 「該年完成日期在該年份、且狀態已讀完」的書；選回「全部年份」就整個清空篩選。
  let yearFilter = null;

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    const searched = query
      ? index.filter((entry) => entry.searchText.includes(query)).map((entry) => entry.book)
      : books;
    const base = filterBooksCompletedInYear(searched, recordMap, yearFilter);
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    if (sorted.length === 0) {
      bodyEl.innerHTML = query
        ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
        : `<p class="empty">${yearFilter ? `${escapeHtml(yearFilter)} 年沒有已讀完的書籍。` : '還沒有任何書籍，點擊上方新增第一本。'}</p>`;
    } else {
      bodyEl.innerHTML = bookTableHtml(sorted, favoriteAuthors, recordMap);
    }
    countEl.textContent = sorted.length === books.length ? `共 ${books.length} 本` : `符合 ${sorted.length} 本（共 ${books.length} 本）`;

    if (yearFilter) {
      titleEl.textContent = `${yearFilter} 年已讀完書籍（共 ${sorted.length} 本）`;
      yearResetBtn.hidden = false;
    } else {
      titleEl.textContent = '所有書籍';
      yearResetBtn.hidden = true;
    }
  }

  yearResetBtn.addEventListener('click', () => {
    yearFilter = null;
    container.querySelector('#sidebar-stats-year-select').value = '';
    container.querySelector('#sidebar-stats-year-select').dispatchEvent(new Event('change'));
  });

  await renderDashboardSidebar(container.querySelector('#dashboard-sidebar'), {
    onYearChange: (year) => {
      yearFilter = year;
      renderList();
    },
  });

  searchInput.addEventListener('input', renderList);
  sortSelect.addEventListener('change', renderList);
  renderList();
}
