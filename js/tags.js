import { DB } from './db.js';
import { escapeHtml, extractHashtags, renderTextWithHashtags } from './utils.js';
import { ICON_QUOTE, ICON_NOTEBOOK } from './icons.js';

// 「閱讀動機」「閱讀後輸出」跟「快速筆記」已經合併成書籍詳情頁的單一個
// 「閱讀心得」分頁（見 notes.js 的 renderPersonalNotes），這裡的標籤
// 只是給標籤搜尋結果分類用，三種來源資料（motivation／reflection／note）
// 不再需要分開的中文標籤跟圖示，統一顯示成「閱讀心得」，不然使用者
// 會在搜尋結果裡看到畫面上已經不存在的分頁名稱。
const KIND_LABEL = {
  quote: `${ICON_QUOTE}佳句摘錄`,
  reflection: `${ICON_NOTEBOOK}閱讀心得`,
  note: `${ICON_NOTEBOOK}閱讀心得`,
  motivation: `${ICON_NOTEBOOK}閱讀心得`,
};

function resultItemHtml(kind, text, bookId, extraHtml) {
  const href = kind === 'quote' ? `#/books/${bookId}/quotes` : `#/books/${bookId}`;
  return `
    <div class="tag-result-item">
      <div class="tag-result-item-head">
        <span class="tag-result-kind">${KIND_LABEL[kind]}</span>
        ${extraHtml || ''}
        <a class="tag-result-jump" href="${href}">前往 →</a>
      </div>
      <p class="tag-result-text">${renderTextWithHashtags(text)}</p>
    </div>
  `;
}

// 標籤總覽／搜尋結果頁：把「佳句摘錄」跟「閱讀心得」（notes 表＋outputs
// 表的 reflection／motivation 兩種 kind）裡含有這個 #標籤的內容，依照出處
// 書籍分組列出，達成跨書籍的概念串聯。
export async function renderTagPage(container, rawTag) {
  const tag = decodeURIComponent(rawTag || '').trim();
  if (!tag) {
    container.innerHTML = '<p class="empty">沒有指定標籤。</p>';
    return;
  }

  const [books, quotes, outputs, notes] = await Promise.all([
    DB.getAll('books'),
    DB.getAll('quotes'),
    DB.getAll('outputs'),
    DB.getAll('notes'),
  ]);
  const bookById = new Map(books.map((b) => [b.id, b]));
  const hasTag = (text) => extractHashtags(text).includes(tag);

  const matchedQuotes = quotes.filter((q) => hasTag(q.content));
  const matchedReflections = outputs.filter((o) => o.kind === 'reflection' && hasTag(o.text));
  const matchedMotivations = outputs.filter((o) => o.kind === 'motivation' && hasTag(o.text));
  const matchedNotes = notes.filter((n) => hasTag(n.text));

  const bookIds = [...new Set([
    ...matchedQuotes.map((q) => q.bookId),
    ...matchedReflections.map((o) => o.bookId),
    ...matchedMotivations.map((o) => o.bookId),
    ...matchedNotes.map((n) => n.bookId),
  ])];
  // 依書名排序，讓結果穩定好找，而不是照資料庫內部順序跳來跳去。
  bookIds.sort((a, b) => (bookById.get(a)?.title || '').localeCompare(bookById.get(b)?.title || ''));

  const totalCount = matchedQuotes.length + matchedReflections.length + matchedMotivations.length + matchedNotes.length;

  const groupsHtml = bookIds.map((bookId) => {
    const book = bookById.get(bookId);
    const items = [
      ...matchedQuotes.filter((q) => q.bookId === bookId).map((q) => resultItemHtml('quote', q.content, bookId, q.page ? `<span class="quote-page-badge">P. ${escapeHtml(q.page)}</span>` : '')),
      ...matchedReflections.filter((o) => o.bookId === bookId).map((o) => resultItemHtml('reflection', o.text, bookId)),
      ...matchedMotivations.filter((o) => o.bookId === bookId).map((o) => resultItemHtml('motivation', o.text, bookId)),
      ...matchedNotes.filter((n) => n.bookId === bookId).map((n) => resultItemHtml('note', n.text, bookId)),
    ];
    return `
      <div class="tag-result-book">
        <h3>${book ? `<a href="#/books/${book.id}">${escapeHtml(book.title || '（未命名）')}</a>` : '（找不到書籍）'}</h3>
        <div class="tag-result-items">${items.join('')}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="toolbar">
      <a href="#/books">← 回書籍列表</a>
      <h2>#${escapeHtml(tag)}</h2>
    </div>
    <p class="graph-hint">共找到 ${totalCount} 筆內容，來自 ${bookIds.length} 本書。</p>
    ${bookIds.length === 0 ? '<p class="empty">沒有找到任何包含這個標籤的內容。</p>' : groupsHtml}
  `;
}
