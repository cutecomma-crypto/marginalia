import { DB } from './db.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 3 節與 B 原則 6：全部自動計算，不可手動輸入。
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

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
  }

  const ratings = records.filter((r) => r.rating).map((r) => r.rating);
  const averageRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const currentlyReading = records.filter((r) => r.status === '閱讀中').length;

  const mostReadEntry = Object.entries(completedByCategory).sort((a, b) => b[1] - a[1])[0];

  return {
    byYear,
    byYearMonth,
    availableYears: Object.keys(byYear).sort().reverse(),
    currentlyReading,
    libraryByCategory,
    averageRating,
    mostReadCategory: mostReadEntry ? mostReadEntry[0] : null,
  };
}

function renderYearBody(stats, year) {
  const yearCount = stats.byYear[year] || 0;
  const monthData = stats.byYearMonth[year] || {};
  const monthRow = MONTH_LABELS.map((label, i) => {
    const key = String(i + 1).padStart(2, '0');
    const count = monthData[key] || 0;
    return `<div class="stat-month"><span class="stat-month-label">${label}</span><span class="stat-month-count">${count}</span></div>`;
  }).join('');

  return `
    <div class="stat-headline">${escapeHtml(year)} 年已讀 ${yearCount} 本</div>
    <div class="stat-month-grid">${monthRow}</div>
  `;
}

export async function renderStatsPanel(container) {
  const [books, records] = await Promise.all([DB.getAll('books'), DB.getAll('reading_records')]);
  const stats = computeStats(books, records);

  const currentYear = String(new Date().getFullYear());
  const yearOptions = stats.availableYears.length > 0 ? [...stats.availableYears] : [];
  if (!yearOptions.includes(currentYear)) yearOptions.unshift(currentYear);
  const defaultYear = yearOptions.includes(currentYear) ? currentYear : yearOptions[0];

  const categoryEntries = Object.entries(stats.libraryByCategory).sort((a, b) => b[1] - a[1]);

  container.innerHTML = `
    <div class="stats-panel">
      <div class="stats-year-row">
        <select id="stats-year-select">
          ${yearOptions.map((y) => `<option value="${escapeHtml(y)}" ${y === defaultYear ? 'selected' : ''}>${escapeHtml(y)} 年</option>`).join('')}
        </select>
      </div>
      <div id="stats-year-body">${renderYearBody(stats, defaultYear)}</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card-label">閱讀中</div>
          <div class="stat-card-value">${stats.currentlyReading} 本</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">平均評分</div>
          <div class="stat-card-value">${stats.averageRating !== null ? stats.averageRating.toFixed(1) : '—'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">最常閱讀的類型</div>
          <div class="stat-card-value">${escapeHtml(stats.mostReadCategory || '—')}</div>
        </div>
      </div>
      <div class="stats-category">
        <h4>各類型書籍數量</h4>
        <ul class="stat-category-list">
          ${categoryEntries.length === 0
            ? '<li class="empty">還沒有書籍資料。</li>'
            : categoryEntries.map(([cat, count]) => `<li><span>${escapeHtml(cat)}</span><span>${count} 本</span></li>`).join('')}
        </ul>
      </div>
    </div>
  `;

  container.querySelector('#stats-year-select').addEventListener('change', (event) => {
    container.querySelector('#stats-year-body').innerHTML = renderYearBody(stats, event.target.value);
  });
}

// 首頁側邊欄用的精簡版：拿掉月份分佈，只留數字概覽，讓「所有書籍」有空間當主角。
// 年份仍可切換（下拉選單），因為使用者的完成日期常常橫跨好幾年，不能只鎖死顯示今年。
export async function renderSidebarStats(container) {
  const [books, records] = await Promise.all([DB.getAll('books'), DB.getAll('reading_records')]);
  const stats = computeStats(books, records);
  const currentYear = String(new Date().getFullYear());
  const yearOptions = stats.availableYears.length > 0 ? [...stats.availableYears] : [];
  if (!yearOptions.includes(currentYear)) yearOptions.unshift(currentYear);
  const defaultYear = yearOptions.includes(currentYear) ? currentYear : yearOptions[0];

  const recordByBook = new Map(records.map((r) => [r.bookId, r]));
  const wantToRead = books.filter((b) => ((recordByBook.get(b.id) || {}).status || '想讀') === '想讀').length;
  const completed = books.filter((b) => (recordByBook.get(b.id) || {}).status === '已讀完').length;

  const categoryEntries = Object.entries(stats.libraryByCategory).sort((a, b) => b[1] - a[1]);

  container.innerHTML = `
    <div class="sidebar-panel">
      <div class="sidebar-stat-heading-row">
        <h4>閱讀統計</h4>
        <select id="sidebar-stats-year-select" class="sidebar-year-select">
          ${yearOptions.map((y) => `<option value="${escapeHtml(y)}" ${y === defaultYear ? 'selected' : ''}>${escapeHtml(y)} 年</option>`).join('')}
        </select>
      </div>
      <div class="sidebar-stat-highlight" id="sidebar-stats-highlight">${escapeHtml(defaultYear)} 年已讀 ${stats.byYear[defaultYear] || 0} 本</div>
      <div class="sidebar-stat-grid">
        <div class="sidebar-stat-cell"><span class="v">${stats.currentlyReading}</span><span class="l">閱讀中</span></div>
        <div class="sidebar-stat-cell"><span class="v">${wantToRead}</span><span class="l">想讀</span></div>
        <div class="sidebar-stat-cell"><span class="v">${completed}</span><span class="l">已讀完</span></div>
      </div>
      <div class="sidebar-stat-row"><span>平均評分</span><span>${stats.averageRating !== null ? stats.averageRating.toFixed(1) : '—'}</span></div>
      <div class="sidebar-stat-row"><span>最常閱讀類型</span><span>${escapeHtml(stats.mostReadCategory || '—')}</span></div>
    </div>
    <div class="sidebar-panel">
      <h4>各類型書籍數量</h4>
      <ul class="stat-category-list">
        ${categoryEntries.length === 0
          ? '<li class="empty">還沒有書籍資料。</li>'
          : categoryEntries.map(([cat, count]) => `<li><span>${escapeHtml(cat)}</span><span>${count} 本</span></li>`).join('')}
      </ul>
    </div>
  `;

  container.querySelector('#sidebar-stats-year-select').addEventListener('change', (event) => {
    const year = event.target.value;
    container.querySelector('#sidebar-stats-highlight').textContent = `${year} 年已讀 ${stats.byYear[year] || 0} 本`;
  });
}
