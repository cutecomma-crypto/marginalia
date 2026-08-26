import { DB } from './db.js';
import { escapeHtml } from './utils.js';

// 喜愛作者用「名字」比對，不是綁定某一本書，所以同一位作者的所有書都會一起標記。
export async function getFavoriteAuthorMap() {
  const list = await DB.getAll('favorite_authors');
  return new Map(list.map((f) => [f.name, f.id]));
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
export async function renderFavoriteAuthorsPanel(container, year = null) {
  const [favoriteMap, books, records] = await Promise.all([
    getFavoriteAuthorMap(),
    DB.getAll('books'),
    DB.getAll('reading_records'),
  ]);
  const recordByBook = new Map(records.map((r) => [r.bookId, r]));

  const countByAuthor = {};
  books.forEach((b) => {
    if (!b.author) return;
    if (year) {
      const record = recordByBook.get(b.id);
      const completedInYear = record && record.status === '已讀完' && record.endDate && record.endDate.startsWith(year);
      if (!completedInYear) return;
    }
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
                <button type="button" class="favorite-author-link" data-name="${escapeHtml(name)}">♥ ${escapeHtml(name)}</button>
                <span class="favorite-author-count">${countByAuthor[name] || 0} 本</span>
              </li>
            `).join('')}
          </ul>`}
    </div>
  `;

  container.querySelectorAll('.favorite-author-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const searchInput = document.querySelector('#book-search');
      if (!searchInput) return;
      searchInput.value = btn.dataset.name;
      searchInput.dispatchEvent(new Event('input'));
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}
