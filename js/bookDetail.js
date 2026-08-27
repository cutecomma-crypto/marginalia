import { DB } from './db.js';
import { renderReadingSection } from './readingRecords.js';
import { renderMotivation, renderReflections } from './outputs.js';
import { renderNotesSection } from './notes.js';
import { renderQuotesWorkspace } from './quotes.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml } from './utils.js';
import { DEFAULT_RETENTION_STATUS, BORROWED_RETENTION_STATUS } from './bookForm.js';

function detailRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`;
}

// 借閱狀態才附上「（借閱管道 - 圖書館名稱）」補充說明，其他存留狀態單純顯示狀態本身。
function retentionStatusDisplay(book) {
  const status = book.retentionStatus || DEFAULT_RETENTION_STATUS;
  if (status !== BORROWED_RETENTION_STATUS) return status;
  const detail = [book.libraryBorrowType, book.libraryName].filter(Boolean).join(' - ');
  return detail ? `${status}（${detail}）` : status;
}

export async function renderBookDetail(container, rawId) {
  const bookId = Number(rawId);
  const book = await DB.getById('books', bookId);
  if (!book) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }
  const favoriteAuthors = await getFavoriteAuthorMap();
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);

  container.innerHTML = `
    <div class="toolbar">
      <a href="#/books">← 回列表</a>
      <div class="toolbar-actions">
        <a class="btn" href="#/books/${bookId}/graph">🕸️ 關係圖譜</a>
        <a class="btn" href="#/books/${bookId}/edit">編輯</a>
        <button type="button" class="btn btn-danger" id="delete-book">刪除</button>
      </div>
    </div>
    <div class="book-header-panel">
      ${book.coverImage ? `<img class="book-cover-image book-cover-image-sm" src="${book.coverImage}" alt="《${escapeHtml(book.title || '未命名')}》封面">` : ''}
      <div class="book-header-info">
        <h2>${escapeHtml(book.title || '（未命名）')}</h2>
        ${book.tags && book.tags.length ? `
        <div class="detail-tags">
          ${book.tags.map((t) => `<span class="output-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
        ` : ''}
        <div class="detail-grid-compact">
          ${detailRow('作者', book.author ? `${isFavoriteAuthor ? '♥ ' : ''}${book.author}` : book.author)}
          ${detailRow('出版社', book.publisher)}
          ${detailRow('出版日期', book.publishDate)}
          ${detailRow('書籍形式', book.format)}
          ${detailRow('存留狀態', retentionStatusDisplay(book))}
          ${detailRow('書籍類型', book.category)}
        </div>
      </div>
    </div>

    <div class="main-tabs">
      <div class="main-tab-buttons">
        <button type="button" class="main-tab-btn is-active" data-tab="motivation">💡 閱讀動機</button>
        <button type="button" class="main-tab-btn" data-tab="reflection">✍️ 閱讀後輸出</button>
        <button type="button" class="main-tab-btn" data-tab="notes">📝 快速筆記</button>
        <button type="button" class="main-tab-btn" data-tab="quotes">💬 佳句摘錄（<span id="quotes-tab-count">0</span> 條）</button>
      </div>
      <div class="main-tab-panel" data-tab-panel="motivation">
        <div id="motivation-container"></div>
      </div>
      <div class="main-tab-panel" data-tab-panel="reflection" hidden>
        <div id="reading-section"></div>
        <div id="reflection-container"></div>
      </div>
      <div class="main-tab-panel" data-tab-panel="notes" hidden>
        <div id="notes-section"></div>
      </div>
      <div class="main-tab-panel" data-tab-panel="quotes" hidden>
        <div id="quotes-container"></div>
      </div>
    </div>
  `;

  container.querySelector('#delete-book').addEventListener('click', async () => {
    if (!window.confirm(`確定要刪除《${book.title || '（未命名）'}》嗎？此動作無法復原，連同它的閱讀紀錄、輸出、筆記、圖譜一起刪除。`)) return;
    await DB.removeByIndex('reading_records', 'bookId', bookId);
    await DB.removeByIndex('outputs', 'bookId', bookId);
    await DB.removeByIndex('quotes', 'bookId', bookId);
    await DB.removeByIndex('notes', 'bookId', bookId);
    await DB.removeByIndex('edges', 'bookId', bookId);
    await DB.removeByIndex('nodes', 'bookId', bookId);
    await DB.remove('books', bookId);
    window.location.hash = '#/books';
  });

  const mainTabButtons = container.querySelectorAll('.main-tab-btn');
  const mainTabPanels = container.querySelectorAll('.main-tab-panel');
  mainTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      mainTabButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      mainTabPanels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== btn.dataset.tab; });
    });
  });

  await renderReadingSection(container.querySelector('#reading-section'), bookId, book);
  await renderMotivation(container.querySelector('#motivation-container'), bookId);
  await renderReflections(container.querySelector('#reflection-container'), bookId);
  await renderNotesSection(container.querySelector('#notes-section'), bookId);
  await renderQuotesWorkspace(container.querySelector('#quotes-container'), bookId, book, {
    onCountChange: (count) => {
      container.querySelector('#quotes-tab-count').textContent = count;
    },
  });
}
