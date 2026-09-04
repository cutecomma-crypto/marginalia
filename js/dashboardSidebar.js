import { renderSidebarStats } from './stats.js';
import { renderFavoriteAuthorsPanel } from './authors.js';
import { renderRecentActivity } from './home.js';

// 左側側邊欄：閱讀統計／喜愛的作者／最近輸出。原本這裡還有一塊「熱門標籤」
// 面板（統計書籍/筆記/佳句/輸出裡出現過的所有 #hashtag，點了直接帶進搜尋框），
// 使用者覺得不必要、拿掉了——連同運算邏輯（tagCloud.js）整個刪除，不是只
// 藏起來；已加了 #標籤的搜尋提示到主搜尋框的 placeholder，同一件事（用
// #標籤篩選）還是做得到，只是不再需要側邊欄先幫忙列出「有哪些標籤可選」。
// 年份／閱讀狀態／分類／借出中四種篩選都是由各自面板發起（見 stats.js 的
// onYearChange／onStatusFilterChange／onCategoryFilterChange／onRetentionFilterChange），
// 年份變化時順手把「喜愛的作者」也用同一個年份重新渲染，兩者才會同步；每個
// callback 都再往外傳一層給 options，讓外層的書籍列表可以同步套用篩選狀態。
export async function renderDashboardSidebar(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const onStatusFilterChange = options.onStatusFilterChange || (() => {});
  const onCategoryFilterChange = options.onCategoryFilterChange || (() => {});
  const onRetentionFilterChange = options.onRetentionFilterChange || (() => {});
  const onAuthorClick = options.onAuthorClick || (() => {});

  container.innerHTML = `
    <div id="stats-panel-container"></div>
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
  await renderFavoriteAuthorsPanel(favoriteAuthorsContainer, null, { onAuthorClick });
  await renderRecentActivity(container.querySelector('#home-sections-container'));
}
