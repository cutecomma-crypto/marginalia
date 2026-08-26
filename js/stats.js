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

const CATEGORY_LIST_LIMIT = 5;

// 側邊欄「各類型書籍數量」改成垂直清單：名稱靠左、本數靠右，底下一條依比例填色的細線當進度感。
// 預設只顯示前 5 個熱門分類，避免分類一多整張卡片被撐得太長，其餘的收在「展開更多」裡。
function categoryProgressListHtml(categoryEntries) {
  if (categoryEntries.length === 0) return '<p class="empty">還沒有書籍資料。</p>';

  const maxCount = Math.max(...categoryEntries.map(([, count]) => count));
  const rowHtml = ([cat, count]) => `
    <div class="category-progress-item" style="--bar-width: ${Math.round((count / maxCount) * 100)}%">
      <span class="category-progress-name">${escapeHtml(cat)}</span>
      <span class="category-progress-count">${count} 本</span>
    </div>
  `;

  const visible = categoryEntries.slice(0, CATEGORY_LIST_LIMIT);
  const rest = categoryEntries.slice(CATEGORY_LIST_LIMIT);

  return `
    <div class="category-progress-list">
      ${visible.map(rowHtml).join('')}
      ${rest.length > 0 ? `<div class="category-progress-extra" id="category-progress-extra" hidden>${rest.map(rowHtml).join('')}</div>` : ''}
    </div>
    ${rest.length > 0 ? `<button type="button" class="category-progress-toggle" id="category-progress-toggle">展開更多（還有 ${rest.length} 項）</button>` : ''}
  `;
}

// 「全部年份」看全站累積的分類分佈；選了年份，只算「那一年完成」的書籍落在哪些分類。
function categoryEntriesForYear(books, recordByBook, year) {
  const counts = {};
  for (const book of books) {
    if (year) {
      const record = recordByBook.get(book.id);
      const completedInYear = record && record.status === '已讀完' && record.endDate && record.endDate.startsWith(year);
      if (!completedInYear) continue;
    }
    const category = book.category || '未分類';
    counts[category] = (counts[category] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function categorySectionHtml(categoryEntries, year) {
  return `
    <h4>各類型書籍數量${year ? `<span class="sidebar-year-tag">${escapeHtml(year)} 年已讀完</span>` : ''}</h4>
    ${categoryProgressListHtml(categoryEntries)}
  `;
}

function wireCategoryToggle(container) {
  const toggleBtn = container.querySelector('#category-progress-toggle');
  if (!toggleBtn) return;
  toggleBtn.addEventListener('click', () => {
    const extra = container.querySelector('#category-progress-extra');
    const nowHidden = !extra.hidden;
    extra.hidden = nowHidden;
    toggleBtn.textContent = nowHidden ? toggleBtn.dataset.collapsedLabel : '收起';
  });
  toggleBtn.dataset.collapsedLabel = toggleBtn.textContent;
}

// 首頁側邊欄用的精簡版：拿掉月份分佈，只留數字概覽，讓「所有書籍」有空間當主角。
// 年份仍可切換（下拉選單），因為使用者的完成日期常常橫跨好幾年，不能只鎖死顯示今年。
// options.onYearChange(year)：year 是選到的年份字串，選「全部年份」時是 null——
// 讓外層（書籍列表、喜愛的作者）可以拿這個狀態去同步篩選，全部維持同一份「目前選的年份」。
export async function renderSidebarStats(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const [books, records] = await Promise.all([DB.getAll('books'), DB.getAll('reading_records')]);
  const stats = computeStats(books, records);
  const currentYear = String(new Date().getFullYear());
  const yearOptions = stats.availableYears.length > 0 ? [...stats.availableYears] : [];
  if (!yearOptions.includes(currentYear)) yearOptions.unshift(currentYear);
  const defaultYear = yearOptions.includes(currentYear) ? currentYear : yearOptions[0];

  const recordByBook = new Map(records.map((r) => [r.bookId, r]));
  const wantToRead = books.filter((b) => ((recordByBook.get(b.id) || {}).status || '尚未閱讀') === '尚未閱讀').length;
  const completed = books.filter((b) => (recordByBook.get(b.id) || {}).status === '已讀完').length;

  const defaultYearStats = statsForYear(stats, completed, defaultYear);

  container.innerHTML = `
    <div class="sidebar-panel">
      <div class="sidebar-stat-heading-row">
        <h4>閱讀統計</h4>
        <select id="sidebar-stats-year-select" class="sidebar-year-select">
          <option value="">全部年份</option>
          ${yearOptions.map((y) => `<option value="${escapeHtml(y)}" ${y === defaultYear ? 'selected' : ''}>${escapeHtml(y)} 年</option>`).join('')}
        </select>
      </div>
      <div class="sidebar-stat-highlight" id="sidebar-stats-highlight">${escapeHtml(defaultYearStats.highlight)}</div>
      <div class="sidebar-stat-grid">
        <div class="sidebar-stat-cell"><span class="v">${stats.currentlyReading}</span><span class="l">閱讀中</span></div>
        <div class="sidebar-stat-cell"><span class="v">${wantToRead}</span><span class="l">尚未閱讀</span></div>
        <div class="sidebar-stat-cell"><span class="v">${completed}</span><span class="l">已讀完</span></div>
      </div>
      <div class="sidebar-stat-row"><span>平均評分</span><span id="sidebar-stats-rating">${defaultYearStats.averageRating !== null ? defaultYearStats.averageRating.toFixed(1) : '—'}</span></div>
      <div class="sidebar-stat-row"><span>最常閱讀類型</span><span id="sidebar-stats-category">${escapeHtml(defaultYearStats.mostReadCategory || '—')}</span></div>
    </div>
    <div class="sidebar-panel" id="sidebar-category-panel"></div>
  `;

  const categoryPanel = container.querySelector('#sidebar-category-panel');
  categoryPanel.innerHTML = categorySectionHtml(categoryEntriesForYear(books, recordByBook, null), null);
  wireCategoryToggle(categoryPanel);

  container.querySelector('#sidebar-stats-year-select').addEventListener('change', (event) => {
    const year = event.target.value || null;
    const yearStats = statsForYear(stats, completed, year);
    container.querySelector('#sidebar-stats-highlight').textContent = yearStats.highlight;
    container.querySelector('#sidebar-stats-rating').textContent = yearStats.averageRating !== null ? yearStats.averageRating.toFixed(1) : '—';
    container.querySelector('#sidebar-stats-category').textContent = yearStats.mostReadCategory || '—';

    categoryPanel.innerHTML = categorySectionHtml(categoryEntriesForYear(books, recordByBook, year), year);
    wireCategoryToggle(categoryPanel);

    onYearChange(year);
  });
}
