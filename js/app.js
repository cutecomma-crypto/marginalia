import { renderBookList } from './bookList.js';
import { renderBookForm } from './bookForm.js';
import { renderBookDetail } from './bookDetail.js';
import { renderGraphPage } from './graph.js';
import { renderQuotesPage } from './quotes.js';
import { renderBackupPage } from './backup.js';
import { renderTagPage } from './tags.js';

const app = document.getElementById('app');

// 輕量骨架屏，取代原本會整頁卡住不動的「載入中…」文字——不知道目的地頁面
// 長什麼樣子沒關係，幾條會閃爍的灰色色塊本身就足夠傳達「畫面正在準備」，
// 比死氣沉沉的純文字有精神，也比整頁空白/舊內容卡著不動更清楚。這是每次
// 換頁「立刻」（在任何 await 之前）畫出來的東西，真正的頁面內容準備好之後
// 會直接整個覆蓋掉它，兩者之間沒有共用的 DOM 節點、不需要另外收尾清理。
function skeletonHtml() {
  return `
    <div class="page-skeleton" aria-hidden="true">
      <div class="skeleton-bar skeleton-bar-title"></div>
      <div class="skeleton-bar skeleton-bar-wide"></div>
      <div class="skeleton-bar skeleton-bar-wide"></div>
      <div class="skeleton-bar skeleton-bar-narrow"></div>
    </div>
  `;
}

function parseHash() {
  // 有些頁面會在 hash 後面夾帶一段自訂查詢字串（例如 bookList.js 的作者篩選
  // #/books?author=X，或願望清單「轉為藏書」帶出的 #/books/new?title=X&note=Y），
  // 這段查詢字串是各頁面自己讀 window.location.hash 解析的，不是真正的路徑片段，
  // 路由判斷前一定要先切掉，不然「new?title=X」永遠不會嚴格等於 'new'，比對會失敗。
  const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'books';
  return hash.split('/').filter(Boolean);
}

async function route() {
  // 每次換頁（含 Logo 重置）都把捲動位置歸零，不要沿用上一頁滾到一半的位置。
  window.scrollTo(0, 0);
  const parts = parseHash();
  app.className = '';
  // 側邊欄抽屜的觸發按鈕只在書籍列表頁有意義（見下面的委派點擊監聽器跟
  // bookList.js）——這個 class 掛在 body 上是給 Header 那顆按鈕的 CSS 用的
  // 顯示開關，每次換頁先重設掉，只有 renderBookList() 真的執行時才會重新
  // 加回來，離開書籍列表頁按鈕就會自動隱藏，不會留著一顆按下去沒反應的按鈕。
  document.body.classList.remove('has-sidebar-drawer');
  // 書籍詳情頁手機版重構專用的範圍限定旗標，見 bookDetail.js 開頭的說明——
  // 每次換頁先移除，只有真的渲染到書籍詳情頁才會重新加回來。
  document.body.classList.remove('is-book-detail-page');
  app.innerHTML = skeletonHtml();
  try {
    if (parts[0] === 'backup') {
      await renderBackupPage(app);
      return;
    }
    if (parts[0] === 'tags') {
      await renderTagPage(app, parts[1]);
      return;
    }
    if (parts[0] !== 'books' || parts.length === 1) {
      await renderBookList(app);
      return;
    }
    if (parts[1] === 'new') {
      await renderBookForm(app);
      return;
    }
    if (parts[2] === 'edit') {
      await renderBookForm(app, parts[1]);
      return;
    }
    if (parts[2] === 'graph') {
      await renderGraphPage(app, parts[1]);
      return;
    }
    if (parts[2] === 'quotes') {
      await renderQuotesPage(app, parts[1]);
      return;
    }
    await renderBookDetail(app, parts[1]);
  } catch (err) {
    app.innerHTML = `<p class="empty">發生錯誤：${err.message}</p>`;
    console.error(err);
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', route);

// Logo 點回「所有書籍」的重置 Bug：hash 沒變時瀏覽器不會觸發 hashchange，
// 已經在 #/books（且沒有任何 /books/:id 之類的子路徑）時單靠 <a href="#/books"> 點下去
// 完全不會有事情發生——所有搜尋／篩選狀態都活在 bookList.js 的 renderBookList 閉包裡，
// 沒有重新呼叫就不會被清空。這裡攔下這個特定情境，直接手動重跑一次 route()
// （等同重新整理出全新的預設列表），其餘情況維持原生 <a> 導航，讓 hashchange 走原本的路徑。
document.getElementById('brand-logo-link').addEventListener('click', (event) => {
  if (window.location.hash === '#/books') {
    event.preventDefault();
    route();
  }
});

// 側邊欄抽屜（手機／平板直立版）的觸發按鈕在 Header 裡，是 index.html 的靜態
// 內容、不會隨換頁被整個重繪；抽屜本體 #dashboard-sidebar 卻只有書籍列表頁
// 才存在（bookList.js 動態渲染的），兩者生命週期完全不一樣。如果改成在
// bookList.js 裡面幫這顆按鈕重新綁一次 click，每次重新整理書籍列表（例如
// 點 Logo 回到 #/books 觸發的重置）都會多疊一層監聽器，點一下按鈕實際觸發
// 好幾次開關，行為會越用越亂。改成在這裡（整個網頁生命週期只執行這一次）
// 掛一個監聽器，點擊當下才去抓「現在畫面上到底有沒有 #dashboard-sidebar」，
// 不管換頁幾次都只有這一個監聽器在運作，沒有累積的問題。
document.getElementById('sidebar-drawer-toggle-btn')?.addEventListener('click', () => {
  const sidebar = document.getElementById('dashboard-sidebar');
  const backdrop = document.getElementById('sidebar-drawer-backdrop');
  if (!sidebar) return; // 不在書籍列表頁，沒有抽屜可以開
  sidebar.classList.add('is-open');
  backdrop?.classList.add('is-open');
});
