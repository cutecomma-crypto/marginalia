import { DB } from './db.js';
import { escapeHtml, showToast } from './utils.js';
import { buildRecordByBookMap, isCompletedInYear } from './bookStats.js';

// 喜愛作者用「名字」比對，不是綁定某一本書，所以同一位作者的所有書都會一起標記。
// 這裡同時做「動態聚合」＋「自動垃圾回收」：favorite_authors 這張表只負責記錄
// 「哪些名字被標記過喜愛」，實際「這個名字底下還有沒有書」永遠是即時對照 books 表算出來的，
// 不是另外存一份數字快取——書籍作者改名、書被刪掉之後，這裡下一次讀取就會反映最新狀態，
// 不會出現「作者(0本)」這種殘留在畫面上的死資料。
// 名下已經沒有任何書的收藏紀錄，順手直接從資料庫刪掉（垃圾回收），不是只在畫面上濾掉——
// 呼叫時機不用刻意綁在「刪除書籍」「編輯書籍」等特定操作上：只要書籍列表、書籍詳情、
// 側邊欄喜愛作者面板任何一個地方重新渲染時會呼叫到這裡，就會順便清乾淨，涵蓋所有可能讓
// 作者變孤兒的來源（手動編輯、刪除、Notion 匯入後的清理、未來新增的批次操作……）。
export async function getFavoriteAuthorMap() {
  const [list, books] = await Promise.all([DB.getAll('favorite_authors'), DB.getAll('books')]);
  const usedAuthors = new Set(books.map((b) => (b.author || '').trim()).filter(Boolean));
  const orphaned = list.filter((f) => !usedAuthors.has(f.name));
  if (orphaned.length > 0) {
    await Promise.all(orphaned.map((f) => DB.remove('favorite_authors', f.id)));
  }
  const survivors = list.filter((f) => usedAuthors.has(f.name));
  return new Map(survivors.map((f) => [f.name, f.id]));
}

export async function toggleFavoriteAuthor(name, favoriteMap) {
  const trimmed = (name || '').trim();
  if (!trimmed) return favoriteMap;
  if (favoriteMap.has(trimmed)) {
    await DB.remove('favorite_authors', favoriteMap.get(trimmed));
    favoriteMap.delete(trimmed);
  } else {
    const id = await DB.add('favorite_authors', { name: trimmed });
    favoriteMap.set(trimmed, id);
  }
  return favoriteMap;
}

// year 為 null 代表「全部年份」：本數＝作者全站累積書籍量，名單按字母排序；
// 指定年份時，本數只算「該年完成」的書，並改成依本數由多到少排序，讓當年讀最多的喜愛作者排在最上面。
export async function renderFavoriteAuthorsPanel(container, year = null, options = {}) {
  const onAuthorClick = options.onAuthorClick || (() => {});
  const [favoriteMap, books, records] = await Promise.all([
    getFavoriteAuthorMap(),
    DB.getAll('books'),
    DB.getAll('reading_records'),
  ]);
  const recordByBook = buildRecordByBookMap(records);

  const countByAuthor = {};
  books.forEach((b) => {
    if (!b.author) return;
    if (year && !isCompletedInYear(recordByBook.get(b.id), year)) return;
    countByAuthor[b.author] = (countByAuthor[b.author] || 0) + 1;
  });

  const names = year
    ? Array.from(favoriteMap.keys()).sort((a, b) => (countByAuthor[b] || 0) - (countByAuthor[a] || 0) || a.localeCompare(b, 'zh-Hant'))
    : Array.from(favoriteMap.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hant'));

  container.innerHTML = `
    <div class="sidebar-panel">
      <h4>喜愛的作者${year ? `<span class="sidebar-year-tag">${escapeHtml(year)} 年已讀完</span>` : ''}</h4>
      ${names.length === 0
        ? '<p class="empty">還沒有標記喜愛的作者，可以在書籍表單「作者」欄位旁點星號新增。</p>'
        : `<ul class="favorite-author-list">
            ${names.map((name) => `
              <li>
                <button type="button" class="favorite-author-link" data-name="${escapeHtml(name)}"><span class="favorite-heart">♥</span> ${escapeHtml(name)}</button>
                <span class="favorite-author-count">${countByAuthor[name] || 0} 本</span>
              </li>
            `).join('')}
          </ul>`}
    </div>
  `;

  container.querySelectorAll('.favorite-author-link').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      // 邊界防禦：上面的 getFavoriteAuthorMap 已經會把沒書的作者濾掉，正常情況下不會點到
      // 已無書籍的名字；這裡多一層點擊當下再查一次資料庫，是為了防住「另一個分頁／視窗
      // 改了資料，這個分頁的側邊欄還沒重繪」這種還沒來得及反映的極端情況——避免使用者點下去
      // 之後套用一個查無結果的作者篩選，卻不知道發生了什麼事。
      const liveBooks = await DB.getAll('books');
      const stillHasBooks = liveBooks.some((b) => (b.author || '').trim() === name);
      if (!stillHasBooks) {
        showToast('該作者名下已無書籍，已自動更新列表');
        await renderFavoriteAuthorsPanel(container, year, { onAuthorClick });
        return;
      }
      onAuthorClick(name);
    });
  });
}
