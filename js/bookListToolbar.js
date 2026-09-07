// 「所有書籍」列表頁頂部工具列（標題列／作用中篩選標籤列／搜尋列＋排序／
// 每頁筆數／批量選取）的靜態樣板與工具列專用的圖示，是從 bookList.js 拆
// 出來降低單一檔案行數的一部分（見 js/bookListPagination.js 開頭的說明）。
// 這裡只負責產生 HTML 字串，工具列裡每個控制項的實際事件綁定仍然留在
// bookList.js 的 renderBookList()——那些綁定要讀寫列表本身的篩選／排序／
// 分頁狀態，硬要一起搬過來反而會變成雙向資料流，不值得。
import { escapeHtml } from './utils.js';
import { ICON_SPARKLES } from './icons.js';
import { SORT_OPTIONS, PAGE_SIZE_OPTIONS } from './bookListPagination.js';

// 「顯示全部書籍」按鈕用的細線 X，取代原本比較搶眼、線條較粗的「✕」文字符號。
export const CLOSE_ICON = '<svg class="reset-close-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

// 視角切換按鈕用的 Lucide 圖示（List／LayoutGrid），取代原本容易模糊、鋸齒的純文字符號（▦／☰）。
export const LIST_ICON = '<svg class="view-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h.01"></path><path d="M3 12h.01"></path><path d="M3 19h.01"></path><path d="M8 5h13"></path><path d="M8 12h13"></path><path d="M8 19h13"></path></svg>';
export const GRID_ICON = '<svg class="view-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect></svg>';

export function bookListToolbarHtml(bookCount) {
  return `
    <div class="toolbar">
      <div class="toolbar-title-row">
        <h2 id="book-list-title">所有書籍</h2>
        <button type="button" class="view-mode-toggle-btn" id="view-mode-toggle-btn" data-tooltip="切換為封面網格檢視" aria-label="切換為封面網格檢視">${GRID_ICON}</button>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="btn" id="open-wishlist-btn">${ICON_SPARKLES}願望清單</button>
        <a class="btn btn-primary" href="#/books/new">＋ 新增書籍</a>
      </div>
    </div>
    <div class="active-filters-row" id="active-filters-row" hidden>
      <div class="active-filter-badges" id="active-filter-badges"></div>
      <button type="button" class="clear-filters-btn" id="clear-filters-btn">${CLOSE_ICON}清除篩選</button>
    </div>
    <div class="search-row">
      <div class="search-input">
        <input type="search" id="book-search" class="search-input-field" placeholder="搜尋書名、作者、#標籤，或筆記／佳句內容…">
        <button type="button" class="search-clear-btn" aria-label="清空搜尋" hidden></button>
      </div>
      <div class="toolbar-controls">
        <label class="toolbar-control-field"><span class="toolbar-control-label-text">排序</span>
          <select id="book-sort-select" class="sort-select" aria-label="排序方式">
            ${SORT_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <label class="toolbar-control-field"><span class="toolbar-control-label-text">每頁：</span>
          <select id="book-page-size-select" class="sort-select" aria-label="每頁顯示本數">
            ${PAGE_SIZE_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </label>
        <label class="toolbar-control-toggle">
          <input type="checkbox" id="batch-mode-checkbox">
          批量選取
        </label>
      </div>
      <span class="book-list-count" id="book-list-count">共 ${bookCount} 本</span>
    </div>
  `;
}
