import { DB } from './db.js';
import { escapeHtml, extractHashtags } from './utils.js';

const TAG_LIST_LIMIT = 10;

// 熱門標籤：統計書籍本身的 tags 欄位，加上筆記／佳句／閱讀後輸出內文中出現的 #hashtag，
// 兩種來源常常互補（書籍上直接貼的分類標籤 vs. 內文隨手打的主題標籤）。
async function computeTagCounts() {
  const [books, notes, quotes, outputs] = await Promise.all([
    DB.getAll('books'),
    DB.getAll('notes'),
    DB.getAll('quotes'),
    DB.getAll('outputs'),
  ]);
  const counts = new Map();
  const bump = (tag) => counts.set(tag, (counts.get(tag) || 0) + 1);

  books.forEach((book) => (book.tags || []).forEach(bump));
  notes.forEach((n) => extractHashtags(n.text).forEach(bump));
  quotes.forEach((q) => extractHashtags(q.content).forEach(bump));
  outputs.forEach((o) => extractHashtags(o.text).forEach(bump));

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// options.onTagClick(tag)：再點一次已經選中的標籤＝取消（傳 null），跟其他側邊欄篩選同一套邏輯。
// 篩選值刻意不含「#」前綴，交由呼叫端（bookList.js）自行決定怎麼套用到搜尋框，
// 這樣才能同時吃到書籍 tags 欄位（不含 #）跟內文 #hashtag（含 #）兩種來源。
export async function renderPopularTagsPanel(container, options = {}) {
  const onTagClick = options.onTagClick || (() => {});
  const entries = await computeTagCounts();

  if (entries.length === 0) {
    container.innerHTML = '';
    return;
  }

  const top = entries.slice(0, TAG_LIST_LIMIT);
  container.innerHTML = `
    <div class="sidebar-panel">
      <h4>熱門 #標籤</h4>
      <div class="popular-tag-cloud">
        ${top.map(([tag, count]) => `<button type="button" class="popular-tag-chip" data-tag="${escapeHtml(tag)}" title="${count} 筆內容含此標籤">#${escapeHtml(tag)}</button>`).join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('.popular-tag-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const nowActive = !chip.classList.contains('is-active');
      container.querySelectorAll('.popular-tag-chip').forEach((c) => c.classList.remove('is-active'));
      if (nowActive) chip.classList.add('is-active');
      onTagClick(nowActive ? chip.dataset.tag : null);
    });
  });
}
