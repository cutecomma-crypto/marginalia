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

export async function renderFavoriteAuthorsPanel(container) {
  const [favoriteMap, books] = await Promise.all([getFavoriteAuthorMap(), DB.getAll('books')]);
  const names = Array.from(favoriteMap.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const countByAuthor = {};
  books.forEach((b) => {
    if (!b.author) return;
    countByAuthor[b.author] = (countByAuthor[b.author] || 0) + 1;
  });

  container.innerHTML = `
    <div class="sidebar-panel">
      <h4>喜愛的作者</h4>
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
