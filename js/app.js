import { renderBookList, renderBookForm, renderBookDetail } from './books.js';
import { renderGraphPage } from './graph.js';
import { renderQuotesPage } from './quotes.js';
import { renderBackupPage } from './backup.js';

const app = document.getElementById('app');

function parseHash() {
  const hash = window.location.hash.replace(/^#\/?/, '') || 'books';
  return hash.split('/').filter(Boolean);
}

async function route() {
  const parts = parseHash();
  app.className = '';
  try {
    if (parts[0] === 'backup') {
      await renderBackupPage(app);
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
