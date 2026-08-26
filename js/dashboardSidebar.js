import { renderSidebarStats } from './stats.js';
import { renderFavoriteAuthorsPanel } from './authors.js';
import { renderRecentActivity } from './home.js';

// 左側側邊欄：閱讀統計／喜愛的作者／最近輸出／最近關聯。
// 年份篩選的狀態是由「閱讀統計」裡的年份選單發起（見 stats.js 的 onYearChange），
// 這裡收到年份變化時，順手把「喜愛的作者」也用同一個年份重新渲染，兩者才會同步；
// options.onYearChange 則是再往外傳一層，讓外層的書籍列表也能跟著篩選。
export async function renderDashboardSidebar(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});

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
  });
  await renderFavoriteAuthorsPanel(favoriteAuthorsContainer);
  await renderRecentActivity(container.querySelector('#home-sections-container'));
}
