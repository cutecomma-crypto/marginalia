import { DB } from './db.js';
import { escapeHtml, renderTextWithHashtags } from './utils.js';

// 對照 PROJECT_SPEC.md 第 7 節：儲存當下不要求分類／標籤／關聯，之後才由系統協助辨識（P1 以後）。
async function getNotesForBook(bookId) {
  const notes = await DB.getByIndex('notes', 'bookId', bookId);
  notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return notes;
}

function noteItem(note) {
  return `
    <div class="output-item" data-id="${note.id}">
      <button type="button" class="btn btn-danger output-delete" data-id="${note.id}">刪除</button>
      <p>${renderTextWithHashtags(note.text)}</p>
      <div class="output-date">${escapeHtml((note.createdAt || '').slice(0, 10))}</div>
    </div>
  `;
}

export async function renderNotesSection(container, bookId) {
  const notes = await getNotesForBook(bookId);

  container.innerHTML = `
    <div class="notes-section">
      <h4 class="section-heading">📝 快速筆記</h4>
      <form id="note-form" class="book-form">
        <label>想到什麼就先寫下來，之後再整理
          <textarea name="text" rows="2" placeholder="例如：這裡提到榮格，感覺跟之前看的那本書有關"></textarea>
        </label>
        <p class="hashtag-hint">💡 提示：內文中輸入 #標籤名稱（例如 #心理學），系統將自動分類並串聯相關書籍內容。</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">儲存</button>
        </div>
      </form>
      <div class="output-list">
        ${notes.length === 0 ? '<p class="empty">還沒有任何筆記。</p>' : notes.map(noteItem).join('')}
      </div>
    </div>
  `;

  const form = container.querySelector('#note-form');
  const textarea = form.elements.text;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    await DB.add('notes', { bookId, text });
    await renderNotesSection(container, bookId);
  });

  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      form.requestSubmit();
    }
  });

  container.querySelectorAll('.output-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await DB.remove('notes', Number(btn.dataset.id));
      await renderNotesSection(container, bookId);
    });
  });
}
