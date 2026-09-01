import { renderSidebarStats } from './stats.js';
import { renderFavoriteAuthorsPanel } from './authors.js';
import { renderRecentActivity } from './home.js';
import { renderPopularTagsPanel } from './tagCloud.js';

// 左側側邊欄：閱讀統計／熱門標籤／喜愛的作者／最近輸出。
// 年份／閱讀狀態／分類／借出中／標籤五種篩選都是由各自面板發起（見 stats.js 的
// onYearChange／onStatusFilterChange／onCategoryFilterChange／onRetentionFilterChange，
// 以及 tagCloud.js 的 onTagClick），年份變化時順手把「喜愛的作者」也用同一個年份重新渲染，
// 兩者才會同步；每個 callback 都再往外傳一層給 options，讓外層的書籍列表可以同步套用篩選狀態。
export async function renderDashboardSidebar(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const onStatusFilterChange = options.onStatusFilterChange || (() => {});
  const onCategoryFilterChange = options.onCategoryFilterChange || (() => {});
  const onRetentionFilterChange = options.onRetentionFilterChange || (() => {});
  const onTagClick = options.onTagClick || (() => {});
  const onAuthorClick = options.onAuthorClick || (() => {});

  container.innerHTML = `
    <div id="stats-panel-container"></div>
    <div id="popular-tags-container"></div>
    <div id="favorite-authors-container"></div>
    <div id="home-sections-container"></div>
  `;

  const favoriteAuthorsContainer = container.querySelector('#favorite-authors-container');

  await renderSidebarStats(container.querySelector('#stats-panel-container'), {
    onYearChange: (year) => {
      renderFavoriteAuthorsPanel(favoriteAuthorsContainer, year, { onAuthorClick });
      onYearChange(year);
    },
    onStatusFilterChange,
    onCategoryFilterChange,
    onRetentionFilterChange,
  });
  await renderPopularTagsPanel(container.querySelector('#popular-tags-container'), { onTagClick });
  await renderFavoriteAuthorsPanel(favoriteAuthorsContainer, null, { onAuthorClick });
  await renderRecentActivity(container.querySelector('#home-sections-container'));
}
