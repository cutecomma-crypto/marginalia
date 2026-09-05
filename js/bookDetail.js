import { DB } from './db.js';
import { renderReadingSection } from './readingRecords.js';
import { renderMotivation, renderReflections } from './outputs.js';
import { renderNotesSection } from './notes.js';
import { renderQuotesWorkspace } from './quotes.js';
import { getFavoriteAuthorMap } from './authors.js';
import { escapeHtml, renderTagChip, showToast, confirmModal } from './utils.js';
import { DEFAULT_RETENTION_STATUS, LENT_OUT_RETENTION_STATUS, LIBRARY_SOURCE_FORMAT, QUICK_RETENTION_ACTIONS } from './bookForm.js';
import { ICON_GRAPH, ICON_EDIT, ICON_DELETE, ICON_LIGHTBULB, ICON_PEN_LINE, ICON_NOTEBOOK, ICON_QUOTE } from './icons.js';

// rawValue：少數需要在文字裡插入自己 HTML 片段（例如喜愛作者的 ♥ 圖示要單獨上色）
// 的欄位可以傳這個代替純文字 value，呼叫端要自己先 escapeHtml() 過使用者輸入的部分。
function detailRow(label, value, { rawValue } = {}) {
  if (value === undefined || value === null || value === '') return '';
  const valueHtml = rawValue !== undefined ? rawValue : escapeHtml(value);
  return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${valueHtml}</span></div>`;
}

// 圖書館借閱細節（借閱管道－圖書館名稱）跟著「來源」顯示，不管現在存留狀態是
// 借入未還還是已經歸還——這是書從哪裡來的歷史紀錄，不是「現在還沒還」才成立的事。
function formatDisplay(book) {
  const format = book.format || '';
  if (format === LIBRARY_SOURCE_FORMAT) {
    const detail = [book.libraryBorrowType, book.libraryName].filter(Boolean).join(' - ');
    return detail ? `${format}（${detail}）` : format;
  }
  return format;
}

// 存留狀態單純顯示狀態本身，借出狀態附上「（借給 XX）」。
function retentionStatusDisplay(book) {
  const status = book.retentionStatus || DEFAULT_RETENTION_STATUS;
  if (status === LENT_OUT_RETENTION_STATUS && book.lentTo) {
    return `${status}（借給 ${book.lentTo}）`;
  }
  return status;
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
  // 「借入未還」顯示「一鍵歸還」、「借出」顯示「已收回」，跟書籍列表操作欄共用
  // 同一份 QUICK_RETENTION_ACTIONS 設定（見 bookForm.js），按鈕文字／目標狀態／
  // Toast 文案兩邊不會各自維護一份、久了長出落差。
  const quickAction = QUICK_RETENTION_ACTIONS[book.retentionStatus];

  // 手機版詳情頁整套重構（封面置中放大、資訊改直式排列、進度卡單欄化……）
  // 只鎖定書籍詳情頁這一種頁面，其他頁面共用的 main／.toolbar 都不該被連帶
  // 影響——沿用跟 bookList.js 的「藏書統計」抽屜按鈕一樣的手法：掛一個
  // body class 當 CSS 的範圍限定旗標，app.js 的 route() 在每次換頁最前面
  // 會先移除掉，只有真的執行到這裡才會重新加回來，離開這頁就自動失效。
  document.body.classList.add('is-book-detail-page');

  container.innerHTML = `
    <div class="toolbar detail-toolbar">
      <a href="#/books" class="detail-back-link">← 回列表</a>
      <div class="toolbar-actions">
        ${quickAction ? `<button type="button" class="btn quick-action-btn" id="quick-action-btn">${escapeHtml(quickAction.label)}</button>` : ''}
        <a class="btn detail-action-btn" href="#/books/${bookId}/graph" title="關係圖譜">${ICON_GRAPH}<span class="btn-label">關係圖譜</span></a>
        <a class="btn detail-action-btn" href="#/books/${bookId}/edit" title="編輯">${ICON_EDIT}<span class="btn-label">編輯</span></a>
        <button type="button" class="btn btn-danger detail-action-btn" id="delete-book" title="刪除">${ICON_DELETE}<span class="btn-label">刪除</span></button>
      </div>
    </div>
    <div class="book-header-panel">
      <div class="book-header-top">
        ${book.coverImage ? `<img class="book-cover-image book-cover-image-sm" src="${book.coverImage}" alt="《${escapeHtml(book.title || '未命名')}》封面">` : ''}
        <div class="book-header-info">
          <h2>${escapeHtml(book.title || '（未命名）')}</h2>
          ${book.tags && book.tags.length ? `
          <div class="detail-tags">
            ${book.tags.map((t) => renderTagChip(t)).join('')}
          </div>
          ` : ''}
          <div class="detail-grid-compact">
            ${detailRow('作者', book.author, {
              rawValue: book.author
                ? `${isFavoriteAuthor ? '<span class="favorite-heart">♥</span> ' : ''}<button type="button" class="author-name-link" data-author="${escapeHtml(book.author)}" title="篩選出「${escapeHtml(book.author)}」的所有藏書">${escapeHtml(book.author)}</button>`
                : undefined,
            })}
            ${detailRow('出版社', book.publisher)}
            ${detailRow('書籍類型', book.category)}
            ${detailRow('出版日期', book.publishDate)}
            ${detailRow('書籍形式／來源', formatDisplay(book))}
            ${detailRow('存留狀態', retentionStatusDisplay(book))}
          </div>
        </div>
      </div>
      <div id="reading-section"></div>
    </div>

    <div class="main-tabs">
      <div class="main-tab-buttons">
        <button type="button" class="main-tab-btn is-active" data-tab="motivation">${ICON_LIGHTBULB}閱讀動機</button>
        <button type="button" class="main-tab-btn" data-tab="reflection">${ICON_PEN_LINE}閱讀後輸出</button>
        <button type="button" class="main-tab-btn" data-tab="notes">${ICON_NOTEBOOK}快速筆記</button>
        <button type="button" class="main-tab-btn" data-tab="quotes">${ICON_QUOTE}佳句摘錄（<span id="quotes-tab-count">0</span> 條）</button>
      </div>
      <div class="main-tab-panel" data-tab-panel="motivation">
        <div id="motivation-container"></div>
      </div>
      <div class="main-tab-panel" data-tab-panel="reflection" hidden>
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

  // 作者名稱可點擊：跳回「所有書籍」列表並套用該作者的篩選。篩選狀態活在 bookList.js
  // 的閉包裡，跨頁面沒辦法直接傳變數過去，借用 hash 帶一段 #/books?author=XXX
  // （不是真正的網址查詢字串，單純是 hash 片段裡的自訂文字）夾帶要套用的作者名稱，
  // 列表頁載入時會自己讀出來、套用後把網址清乾淨（見 bookList.js 的
  // readAndClearAuthorFilterFromHash）。
  const authorLinkBtn = container.querySelector('.author-name-link');
  if (authorLinkBtn) {
    authorLinkBtn.addEventListener('click', () => {
      window.location.hash = `#/books?author=${encodeURIComponent(authorLinkBtn.dataset.author)}`;
    });
  }

  // 「一鍵歸還」跟閱讀進度區塊觸發的「切換成已歸還」提示，改完存留狀態後都需要重新
  // 反映在頁面上；直接整頁重新呼叫 renderBookDetail 最保險（保證跟資料庫實際狀態一致，
  // 不用自己手動同步每一處用到 book 資料的地方），唯一要顧慮的是使用者手上分頁籤
  // （閱讀動機／閱讀後輸出／筆記／佳句）不要被重繪打斷跳回第一個分頁，所以重繪前後
  // 記錄＋還原目前選到的分頁籤。
  async function refreshDetail() {
    const activeTab = container.querySelector('.main-tab-btn.is-active')?.dataset.tab;
    await renderBookDetail(container, rawId);
    if (activeTab && activeTab !== 'motivation') {
      container.querySelector(`.main-tab-btn[data-tab="${activeTab}"]`)?.click();
    }
  }

  const quickActionBtn = container.querySelector('#quick-action-btn');
  if (quickActionBtn) {
    quickActionBtn.addEventListener('click', async () => {
      await DB.update('books', { ...book, retentionStatus: quickAction.targetStatus });
      showToast(quickAction.toast);
      await refreshDetail();
    });
  }

  container.querySelector('#delete-book').addEventListener('click', async () => {
    const confirmed = await confirmModal({
      title: '確定要刪除這本書嗎？',
      message: `《${book.title || '（未命名）'}》此動作無法復原，連同它的閱讀紀錄、輸出、筆記、圖譜一起刪除。`,
      confirmText: '刪除',
      cancelText: '取消',
      danger: true,
    });
    if (!confirmed) return;
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

  // 「閱讀後輸出」選取文字存成佳句摘錄（見 outputs.js 的 attachSelectionToolbar
  // onHighlight）之後，需要一個管道把「佳句摘錄」分頁的數量／列表也一起更新，
  // 不然那個分頁的內容是頁面一開始載入時就渲染好、之後不會再自己重繪的——使用者
  // 存了一句新佳句，畫面上完全沒反應，要重新整理整頁才看得到，這是實測抓到的
  // 真實問題。抽成獨立函式讓 renderReflections() 存完佳句後可以直接呼叫，只重繪
  // 佳句摘錄那個分頁本身（不是整個 renderBookDetail()／refreshDetail()），不會
  // 連帶打斷使用者在閱讀後輸出編輯區裡還沒存檔的草稿或游標位置。
  async function refreshQuotesTab() {
    await renderQuotesWorkspace(container.querySelector('#quotes-container'), bookId, {
      onCountChange: (count) => {
        container.querySelector('#quotes-tab-count').textContent = count;
      },
    });
  }

  await renderReadingSection(container.querySelector('#reading-section'), bookId, book, { onReturnedSuggestionAccepted: refreshDetail });
  await renderMotivation(container.querySelector('#motivation-container'), bookId);
  await renderReflections(container.querySelector('#reflection-container'), bookId, { onQuoteAdded: refreshQuotesTab });
  await renderNotesSection(container.querySelector('#notes-section'), bookId);
  await refreshQuotesTab();
}
