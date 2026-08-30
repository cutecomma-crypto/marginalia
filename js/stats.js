import { DB } from './db.js';
import { escapeHtml } from './utils.js';
import { buildRecordByBookMap, isCompletedInYear } from './bookStats.js';
import { LENT_OUT_RETENTION_STATUS, BORROWED_RETENTION_STATUS } from './bookForm.js';

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
// 每一項現在也是可點擊的篩選按鈕，activeCategory 用來重繪時知道要幫哪一項補回 is-active。
function categoryProgressListHtml(categoryEntries, activeCategory) {
  if (categoryEntries.length === 0) return '<p class="empty">還沒有書籍資料。</p>';

  const maxCount = Math.max(...categoryEntries.map(([, count]) => count));
  const rowHtml = ([cat, count]) => `
    <div class="category-progress-item${cat === activeCategory ? ' is-active' : ''}" data-category="${escapeHtml(cat)}" style="--bar-width: ${Math.round((count / maxCount) * 100)}%">
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
    if (year && !isCompletedInYear(recordByBook.get(book.id), year)) continue;
    const category = book.category || '未分類';
    counts[category] = (counts[category] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// 「借出中／借入中」快捷篩選按鈕：放在「各類型書籍數量」正上方，不受年份選擇影響
// （存留狀態是書籍當下的狀態，不是某一年才成立的事）。0 本時仍顯示，但不能點。
// 兩顆按鈕共用同一個 retentionFilter 狀態、互斥（跟閱讀狀態方塊同一套「單選＋再點一次取消」邏輯）。
function retentionButtonsHtml(lentOutCount, borrowedCount, activeRetention) {
  return `
    <div class="retention-filter-row">
      <button type="button" class="retention-filter-btn${activeRetention === LENT_OUT_RETENTION_STATUS ? ' is-active' : ''}" data-retention="${LENT_OUT_RETENTION_STATUS}" ${lentOutCount === 0 ? 'disabled' : ''}>
        📤 借出中（${lentOutCount} 本）
      </button>
      <button type="button" class="retention-filter-btn${activeRetention === BORROWED_RETENTION_STATUS ? ' is-active' : ''}" data-retention="${BORROWED_RETENTION_STATUS}" ${borrowedCount === 0 ? 'disabled' : ''}>
        📥 借入中（${borrowedCount} 本）
      </button>
    </div>
  `;
}

function categorySectionHtml(categoryEntries, year, activeCategory, lentOutCount, borrowedCount, activeRetention) {
  return `
    ${retentionButtonsHtml(lentOutCount, borrowedCount, activeRetention)}
    <h4>各類型書籍數量${year ? `<span class="sidebar-year-tag">${escapeHtml(year)} 年已讀完</span>` : ''}</h4>
    ${categoryProgressListHtml(categoryEntries, activeCategory)}
  `;
}

function wireRetentionButtons(container, onRetentionFilterChange, setActiveRetention) {
  container.querySelectorAll('.retention-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nowActive = !btn.classList.contains('is-active');
      container.querySelectorAll('.retention-filter-btn').forEach((b) => b.classList.remove('is-active'));
      if (nowActive) btn.classList.add('is-active');
      const retention = nowActive ? btn.dataset.retention : null;
      setActiveRetention(retention);
      onRetentionFilterChange(retention);
    });
  });
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

// 點分類項目本身直接切換 class（不重繪 innerHTML），這樣「展開更多」的開合狀態不會被打斷。
// 再點一次已經選中的項目＝取消篩選，跟閱讀狀態方塊、年份選單同一套「再點一次就清除」邏輯。
function wireCategoryItemClicks(container, onCategoryFilterChange, setActiveCategory) {
  container.querySelectorAll('.category-progress-item').forEach((item) => {
    item.addEventListener('click', () => {
      const cat = item.dataset.category;
      const nowActive = !item.classList.contains('is-active');
      container.querySelectorAll('.category-progress-item').forEach((i) => i.classList.remove('is-active'));
      if (nowActive) item.classList.add('is-active');
      setActiveCategory(nowActive ? cat : null);
      onCategoryFilterChange(nowActive ? cat : null);
    });
  });
}

// 首頁側邊欄用的精簡版：拿掉月份分佈，只留數字概覽，讓「所有書籍」有空間當主角。
// 年份仍可切換（下拉選單），因為使用者的完成日期常常橫跨好幾年，不能只鎖死顯示今年。
// options.onYearChange(year) / onStatusFilterChange(status) / onCategoryFilterChange(category)：
// 三個都是「選到的值字串，取消篩選時是 null」，讓外層（書籍列表、喜愛的作者）可以同步篩選，
// 三種篩選各自獨立、可以同時套用（AND 組合），不會互相搶狀態。
export async function renderSidebarStats(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const onStatusFilterChange = options.onStatusFilterChange || (() => {});
  const onCategoryFilterChange = options.onCategoryFilterChange || (() => {});
  const onRetentionFilterChange = options.onRetentionFilterChange || (() => {});
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
  const lentOutCount = books.filter((b) => b.retentionStatus === LENT_OUT_RETENTION_STATUS).length;
  const borrowedCount = books.filter((b) => b.retentionStatus === BORROWED_RETENTION_STATUS).length;
  let activeCategory = null;
  let activeRetention = null;

  // 第一層：全站書籍狀態統計（閱讀中／尚未閱讀／已讀完），不受年份選擇影響，
  // 是使用者一打開網站最想先看到的「我現在藏書整體長怎樣」；年份切換只影響
  // 下面第二層的年度成果數字，兩層資料來源不同，順序調整純粹是排版，不動邏輯。
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
      <div class="sidebar-stat-row"><span>平均評分</span><span id="sidebar-stats-rating">${defaultYearStats.averageRating !== null ? defaultYearStats.averageRating.toFixed(1) : '—'}</span></div>
      <div class="sidebar-stat-row"><span>最常閱讀類型</span><span id="sidebar-stats-category">${escapeHtml(defaultYearStats.mostReadCategory || '—')}</span></div>
    </div>
    <div class="sidebar-panel" id="sidebar-category-panel"></div>
  `;

  const categoryPanel = container.querySelector('#sidebar-category-panel');
  function renderCategoryPanel(year) {
    categoryPanel.innerHTML = categorySectionHtml(categoryEntriesForYear(books, recordByBook, year), year, activeCategory, lentOutCount, borrowedCount, activeRetention);
    wireCategoryToggle(categoryPanel);
    wireCategoryItemClicks(categoryPanel, onCategoryFilterChange, (cat) => { activeCategory = cat; });
    wireRetentionButtons(categoryPanel, onRetentionFilterChange, (retention) => { activeRetention = retention; });
  }
  renderCategoryPanel(null);

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
    container.querySelector('#sidebar-stats-rating').textContent = yearStats.averageRating !== null ? yearStats.averageRating.toFixed(1) : '—';
    container.querySelector('#sidebar-stats-category').textContent = yearStats.mostReadCategory || '—';

    renderCategoryPanel(year);

    onYearChange(year);
  });
}
