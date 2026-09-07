import { renderSidebarStats } from './stats.js';

// 左側側邊欄：閱讀統計。原本這裡還有「熱門標籤」面板（統計書籍/筆記/佳句/
// 輸出裡出現過的所有 #hashtag，點了直接帶進搜尋框），使用者覺得不必要、
// 拿掉了——連同運算邏輯（tagCloud.js）整個刪除，不是只藏起來；已加了
// #標籤的搜尋提示到主搜尋框的 placeholder，同一件事（用 #標籤篩選）還是
// 做得到，只是不再需要側邊欄先幫忙列出「有哪些標籤可選」。
// 「功能簡化」精簡：「喜愛的作者」跟「最近輸出」這兩張次要數據卡片也整個
// 移除（不是收起來）——連同它們各自的渲染函式一起刪除，不是留著沒呼叫的
// 殘骸：authors.js 的 renderFavoriteAuthorsPanel() 已經拿掉（getFavoriteAuthorMap／
// toggleFavoriteAuthor 這兩個書籍表單／列表「♥ 喜愛作者」星號功能仍在使用的
// 函式維持不變，只刪渲染這張卡片的部分），home.js 這個檔案的唯一用途就是
// 「最近輸出」，整個檔案一起刪除。
// 年份／閱讀狀態／分類三種篩選都是由各自面板發起（見 stats.js 的
// onYearChange／onStatusFilterChange／onCategoryFilterChange），每個
// callback 都再往外傳一層給 options，讓外層的書籍列表可以同步套用篩選狀態。
export async function renderDashboardSidebar(container, options = {}) {
  const onYearChange = options.onYearChange || (() => {});
  const onStatusFilterChange = options.onStatusFilterChange || (() => {});
  const onCategoryFilterChange = options.onCategoryFilterChange || (() => {});

  container.innerHTML = `
    <div id="stats-panel-container"></div>
  `;

  await renderSidebarStats(container.querySelector('#stats-panel-container'), {
    onYearChange,
    onStatusFilterChange,
    onCategoryFilterChange,
  });
}
