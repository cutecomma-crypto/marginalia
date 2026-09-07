// 「所有書籍」列表的單列（表格模式）／單張卡片（封面網格模式）樣板，是從
// bookList.js 拆出來降低單一檔案行數的一部分（見 js/bookListPagination.js
// 開頭的說明）——對應使用者健檢要求裡「表格列拆成 BookTableRow」的部分。
import { escapeHtml } from './utils.js';
import { ICON_BOOK_OPEN } from './icons.js';

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
}

// 完成日期欄位：表格版改成可點擊的按鈕（Inline Status Switcher），點下去跳出一個
// 小面板直接改「狀態」跟「完成日期」，不用整個跳進書籍詳情頁的「閱讀進度設定」
// 表單——視覺上維持原本純文字、低調次要色的樣子（按鈕本身重置成跟 <span> 一樣
// 沒有邊框/底色），完成了顯示日期、還沒完成顯示「—」，只是現在多了「可以點」這件事。
function completedDateCell(book, record) {
  const text = record && record.endDate ? formatDateSlash(record.endDate) : '—';
  return `<button type="button" class="book-completed-date book-status-trigger" data-book-id="${book.id}" title="點擊快速更新閱讀狀態／完成日期">${escapeHtml(text)}</button>`;
}

// 封面網格版維持純文字、不可點擊——整張卡片本身已經是 <a>，<button> 巢狀在
// <a> 裡面是不合法的 HTML（互動元素不能巢狀互動元素），跟 authorNameHtmlInline
// 用 <span> 走 event delegation 是同一個考量，但這裡沒有到「一定要在網格檢視
// 也支援快速編輯」的必要性，維持原本簡單的純顯示即可。
function completedDateTextOnly(record) {
  const text = record && record.endDate ? formatDateSlash(record.endDate) : '—';
  return `<span class="book-completed-date">${escapeHtml(text)}</span>`;
}

// 作者名稱點擊即篩選：只有真的有作者名稱才輸出可點擊元素，避免空字串也生出一顆
// 沒東西可篩的按鈕。點擊事件用 event delegation 掛在 #book-list-body 上（見
// bookList.js 的 bodyEl.addEventListener），這裡只負責標記 class／data-author，
// 不在這裡個別綁定。
function authorNameHtml(book) {
  if (!book.author) return '';
  return `<button type="button" class="author-name-link" data-author="${escapeHtml(book.author)}" title="篩選出「${escapeHtml(book.author)}」的所有藏書">${escapeHtml(book.author)}</button>`;
}

// 封面網格模式整張卡片本身就是 <a>，裡面不能再塞一個 <button>（互動元素巢狀在
// HTML 語意上不合法），改用 <span> 靠 event delegation 處理，並在監聽器裡
// preventDefault／stopPropagation 擋掉外層 <a> 的導覽，做法跟 <button> 版一致，
// 只是換一個不會被瀏覽器特殊處理的容器標籤。
function authorNameHtmlInline(book) {
  if (!book.author) return '';
  return `<span class="author-name-link" data-author="${escapeHtml(book.author)}" title="篩選出「${escapeHtml(book.author)}」的所有藏書">${escapeHtml(book.author)}</span>`;
}

// data-label：手機版把表格轉成一張張卡片時（見 styles.css 的 @media (max-width: 640px)
// .book-table 區塊），每個 <td> 用 CSS ::before 讀這個屬性當左側欄位名稱標籤，
// 不用另外為手機版寫一套完全不同的卡片 HTML 樣板。
// .book-table-category-badge：平常（桌機／手機卡片）預設 display:none，只有平板
// 直向（見 styles.css 的 @media (min-width:641px) and (max-width:1024px) 區塊）
// 才會顯示——那個寬度書籍類型改成貼在書名下方的小標籤，不再獨立佔一整欄，
// 直接把內容寫進書名 <td> 裡（跟獨立的「書籍類型」<td> 並存），比起用純 CSS
// 去「借」另一個 <td> 的文字內容（辦不到）簡單可靠得多。
// 批量操作勾選框直接塞進書名 <td> 最前面，不另外加一欄——colgroup／nth-child
// 一堆響應式規則都是照現有欄位數算的，多一欄會牽動一整片 CSS，見批量操作列
// 那次規劃時的考量。
function bookRow(book, favoriteAuthors, recordMap, selectedIds) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <tr>
      <td data-label="書名"><input type="checkbox" class="row-select-checkbox book-select-checkbox" data-select-id="${book.id}" aria-label="選取《${escapeHtml(book.title || '未命名')}》" ${selectedIds.has(book.id) ? 'checked' : ''}><a href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">${escapeHtml(book.title || '（未命名）')}</a>${book.category ? `<span class="book-table-category-badge">${escapeHtml(book.category)}</span>` : ''}</td>
      <td class="author-cell" data-label="作者"><span class="author-cell-value"><span class="author-star${isFavoriteAuthor ? '' : ' is-hidden'}" data-tooltip="喜愛的作者" aria-label="喜愛的作者">♥</span>${authorNameHtml(book)}</span></td>
      <td data-label="書籍類型">${escapeHtml(book.category)}</td>
      <td data-label="完成日期">${completedDateCell(book, record)}</td>
    </tr>
  `;
}

export function bookTableHtml(list, favoriteAuthors, recordMap, selectedIds) {
  return `
    <table class="book-table">
      <colgroup>
        <col class="col-title">
        <col class="col-author">
        <col class="col-category">
        <col class="col-completed">
      </colgroup>
      <thead>
        <tr><th>書名</th><th>作者</th><th>書籍類型</th><th>完成日期</th></tr>
      </thead>
      <tbody>
        ${list.map((book) => bookRow(book, favoriteAuthors, recordMap, selectedIds)).join('')}
      </tbody>
    </table>
  `;
}

// 封面網格檢視：跟表格模式吃同一份 list／favoriteAuthors／recordMap，只是換一種排版，
// 沒有封面的書用書本 emoji 佔位，不留空白方塊。
// 批量操作勾選框沒有直接塞進 <a class="book-gallery-card"> 裡面——<input> 屬於
// 「互動內容」，HTML 規範不允許塞進另一個互動元素（<a href>）裡面，跟這個檔案
// 別處用 <span> 取代 <button> 是同一種考量（見 authorNameHtmlInline 等函式的
// 開頭註解）。這裡改成多包一層 .book-gallery-card-wrap，讓 <input> 跟 <a> 變成
// 平輩，勾選框改用 CSS 疊在卡片左上角（見 styles.css 的 .book-gallery-checkbox），
// 點下去不會誤觸 <a> 的導覽，也不需要額外寫 preventDefault／手動轉發 change
// 事件那種繞路的 hack。
function bookGalleryCard(book, favoriteAuthors, recordMap, selectedIds) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <div class="book-gallery-card-wrap">
      <input type="checkbox" class="book-gallery-checkbox book-select-checkbox" data-select-id="${book.id}" aria-label="選取《${escapeHtml(book.title || '未命名')}》" ${selectedIds.has(book.id) ? 'checked' : ''}>
      <a class="book-gallery-card" href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">
        <div class="book-gallery-cover">
          ${book.coverImage ? `<img src="${book.coverImage}" alt="《${escapeHtml(book.title || '未命名')}》封面">` : `<span class="book-gallery-cover-placeholder">${ICON_BOOK_OPEN}</span>`}
        </div>
        <div class="book-gallery-info">
          <div class="book-gallery-title">${escapeHtml(book.title || '（未命名）')}</div>
          <div class="book-gallery-author">${isFavoriteAuthor ? '<span class="author-star" data-tooltip="喜愛的作者" aria-label="喜愛的作者">♥</span> ' : ''}${authorNameHtmlInline(book)}</div>
          <div class="book-gallery-meta">
            ${book.category ? `<span class="book-gallery-category">${escapeHtml(book.category)}</span>` : ''}
            ${completedDateTextOnly(record)}
          </div>
        </div>
      </a>
    </div>
  `;
}

export function bookGalleryHtml(list, favoriteAuthors, recordMap, selectedIds) {
  return `<div class="book-gallery">${list.map((book) => bookGalleryCard(book, favoriteAuthors, recordMap, selectedIds)).join('')}</div>`;
}
