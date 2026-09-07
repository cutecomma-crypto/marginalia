import { DB } from './db.js';
import { escapeHtml } from './utils.js';
import { buildRecordByBookMap } from './bookStats.js';

// 純函式，方便之後測試／重用：不碰 DOM，只吃資料算結果。
export function computeStats(books, records) {
  const bookById = new Map(books.map((b) => [b.id, b]));

  const libraryByCategory = {};
  for (const book of books) {
    const category = book.category || '未分類';
    libraryByCategory[category] = (libraryByCategory[category] || 0) + 1;
  }

  const completed = records.filter((r) => r.status === '已讀完' && r.endDate);

  const byYear = {};
  const byYearMonth = {};
  const byYearCategory = {}; // { year: { category: count } }，給「該年最常閱讀類型」用
  const byYearRatings = {}; // { year: [rating, ...] }，給「該年平均評分」用
  const completedByCategory = {};

  for (const record of completed) {
    const year = record.endDate.slice(0, 4);
    const month = record.endDate.slice(5, 7);
    byYear[year] = (byYear[year] || 0) + 1;
    byYearMonth[year] = byYearMonth[year] || {};
    byYearMonth[year][month] = (byYearMonth[year][month] || 0) + 1;

    const book = bookById.get(record.bookId);
    const category = (book && book.category) || '未分類';
    completedByCategory[category] = (completedByCategory[category] || 0) + 1;
    byYearCategory[year] = byYearCategory[year] || {};
    byYearCategory[year][category] = (byYearCategory[year][category] || 0) + 1;

    if (record.rating) {
      byYearRatings[year] = byYearRatings[year] || [];
      byYearRatings[year].push(record.rating);
    }
  }

  const ratings = records.filter((r) => r.rating).map((r) => r.rating);
  const averageRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const currentlyReading = records.filter((r) => r.status === '閱讀中').length;

  const mostReadEntry = Object.entries(completedByCategory).sort((a, b) => b[1] - a[1])[0];

  return {
    byYear,
    byYearMonth,
    byYearCategory,
    byYearRatings,
    availableYears: Object.keys(byYear).sort().reverse(),
    currentlyReading,
    libraryByCategory,
    averageRating,
    mostReadCategory: mostReadEntry ? mostReadEntry[0] : null,
  };
}

// 「全部年份」用整體 averageRating／mostReadCategory；選了特定年份，就只看那一年完成的書。
function statsForYear(stats, totalCompleted, year) {
  if (!year) {
    return { highlight: `全部已讀 ${totalCompleted} 本`, averageRating: stats.averageRating, mostReadCategory: stats.mostReadCategory };
  }
  const ratings = stats.byYearRatings[year] || [];
  const averageRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const categoryEntries = Object.entries(stats.byYearCategory[year] || {}).sort((a, b) => b[1] - a[1]);
  return {
    highlight: `${year} 年已讀 ${stats.byYear[year] || 0} 本`,
    averageRating,
    mostReadCategory: categoryEntries[0] ? categoryEntries[0][0] : null,
  };
}

// 首頁側邊欄用的精簡版：拿掉月份分佈，只留數字概覽，讓「所有書籍」有空間當主角。
// 年份仍可切換（下拉選單），因為使用者的完成日期常常橫跨好幾年，不能只鎖死顯示今年。
// options.onYearChange(year) / onStatusFilterChange(status)：兩個都是「選到的值
// 字串，取消篩選時是 null」，讓外層（書籍列表）可以同步篩選，兩種篩選各自獨立、
// 可以同時套用（AND 組合），不會互相搶狀態。
// 「各類型書籍數量」這張卡片使用者反映還是想換回「喜愛的作者」，已經整個移除
// （連同 categoryFilter 篩選機制、filterBooksByCategory、.category-progress-*
// 樣式，見 bookList.js／dashboardSidebar.js／bookStats.js），不是收起來；分類
// 篩選如果之後想要，可以在書籍表格的「書籍類型」欄位重新設計一個篩選入口，
// 不用回頭修這裡。
export async function renderSidebarStats(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const onStatusFilterChange = options.onStatusFilterChange || (() => {});
  const [books, records] = await Promise.all([DB.getAll('books'), DB.getAll('reading_records')]);
  const stats = computeStats(books, records);
  const currentYear = String(new Date().getFullYear());
  const yearOptions = stats.availableYears.length > 0 ? [...stats.availableYears] : [];
  if (!yearOptions.includes(currentYear)) yearOptions.unshift(currentYear);
  const defaultYear = yearOptions.includes(currentYear) ? currentYear : yearOptions[0];

  const recordByBook = buildRecordByBookMap(records);
  const wantToRead = books.filter((b) => ((recordByBook.get(b.id) || {}).status || '尚未閱讀') === '尚未閱讀').length;
  const completed = books.filter((b) => (recordByBook.get(b.id) || {}).status === '已讀完').length;

  const defaultYearStats = statsForYear(stats, completed, defaultYear);

  container.innerHTML = `
    <div class="sidebar-panel">
      <h4>我的藏書概況</h4>
      <div class="sidebar-stat-grid">
        <div class="sidebar-stat-cell" data-status="閱讀中" title="點擊只看閱讀中的書"><span class="v">${stats.currentlyReading}</span><span class="l">閱讀中</span></div>
        <div class="sidebar-stat-cell" data-status="尚未閱讀" title="點擊只看尚未閱讀的書"><span class="v">${wantToRead}</span><span class="l">尚未閱讀</span></div>
        <div class="sidebar-stat-cell" data-status="已讀完" title="點擊只看已讀完的書"><span class="v">${completed}</span><span class="l">已讀完</span></div>
      </div>
      <div class="sidebar-stat-heading-row sidebar-stat-heading-row--year">
        <span class="stat-section-label">年度閱讀成果</span>
        <select id="sidebar-stats-year-select" class="sidebar-year-select">
          <option value="">全部年份</option>
          ${yearOptions.map((y) => `<option value="${escapeHtml(y)}" ${y === defaultYear ? 'selected' : ''}>${escapeHtml(y)} 年</option>`).join('')}
        </select>
      </div>
      <div class="sidebar-stat-highlight" id="sidebar-stats-highlight">${escapeHtml(defaultYearStats.highlight)}</div>
    </div>
  `;

  container.querySelectorAll('.sidebar-stat-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const status = cell.dataset.status;
      const nowActive = !cell.classList.contains('is-active');
      container.querySelectorAll('.sidebar-stat-cell').forEach((c) => c.classList.remove('is-active'));
      if (nowActive) cell.classList.add('is-active');
      onStatusFilterChange(nowActive ? status : null);
    });
  });

  container.querySelector('#sidebar-stats-year-select').addEventListener('change', (event) => {
    const year = event.target.value || null;
    const yearStats = statsForYear(stats, completed, year);
    container.querySelector('#sidebar-stats-highlight').textContent = yearStats.highlight;
    onYearChange(year);
  });
}
