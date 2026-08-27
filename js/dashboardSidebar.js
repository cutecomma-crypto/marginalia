import { renderSidebarStats } from './stats.js';
import { renderFavoriteAuthorsPanel } from './authors.js';
import { renderRecentActivity } from './home.js';

// 左側側邊欄：閱讀統計／喜愛的作者／最近輸出／最近關聯。
// 年份／閱讀狀態／分類三種篩選都是由「閱讀統計」面板發起（見 stats.js 的
// onYearChange／onStatusFilterChange／onCategoryFilterChange），年份變化時
// 順手把「喜愛的作者」也用同一個年份重新渲染，兩者才會同步；三個 callback
// 都再往外傳一層給 options，讓外層的書籍列表可以同步套用同一組篩選狀態。
export async function renderDashboardSidebar(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const onStatusFilterChange = options.onStatusFilterChange || (() => {});
  const onCategoryFilterChange = options.onCategoryFilterChange || (() => {});

  container.innerHTML = `
    <div id="stats-panel-container"></div>
    <div id="favorite-authors-container"></div>
    <div id="home-sections-container"></div>
  `;

  const favoriteAuthorsContainer = container.querySelector('#favorite-authors-container');

  await renderSidebarStats(container.querySelector('#stats-panel-container'), {
    onYearChange: (year) => {
      renderFavoriteAuthorsPanel(favoriteAuthorsContainer, year);
      onYearChange(year);
    },
    onStatusFilterChange,
    onCategoryFilterChange,
  });
  await renderFavoriteAuthorsPanel(favoriteAuthorsContainer);
  await renderRecentActivity(container.querySelector('#home-sections-container'));
}
