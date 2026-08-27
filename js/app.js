import { renderBookList } from './bookList.js';
import { renderBookForm } from './bookForm.js';
import { renderBookDetail } from './bookDetail.js';
import { renderGraphPage } from './graph.js';
import { renderQuotesPage } from './quotes.js';
import { renderBackupPage } from './backup.js';
import { renderTagPage } from './tags.js';

const app = document.getElementById('app');

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'books';
  return hash.split('/').filter(Boolean);
}

async function route() {
  // 每次換頁（含 Logo 重置）都把捲動位置歸零，不要沿用上一頁滾到一半的位置。
  window.scrollTo(0, 0);
  const parts = parseHash();
  app.className = '';
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
