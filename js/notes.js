import { DB } from './db.js';
import { escapeHtml, renderTextWithHashtags, showToast, confirmModal } from './utils.js';
import { ICON_NOTEBOOK, ICON_LIGHTBULB, ICON_EDIT, ICON_DELETE } from './icons.js';

// 對照 PROJECT_SPEC.md 第 7 節：儲存當下不要求分類／標籤／關聯，之後才由系統協助辨識（P1 以後）。
async function getNotesForBook(bookId) {
  const notes = await DB.getByIndex('notes', 'bookId', bookId);
  notes.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return notes;
}

// isEditing：這張卡片是不是正在被編輯——是的話整個 <p> 內文換成一個帶原始
// 內容的 <textarea>，右上角的「編輯／刪除」也換成「儲存／取消」，跟原本
// 唯讀狀態共用同一個 .output-item 外殼／同一組按鈕定位規則，只是內容跟按鈕
// 文字不同，不需要另外寫一套完全獨立的卡片樣板。
function noteItem(note, isEditing) {
  if (isEditing) {
    return `
      <div class="output-item" data-id="${note.id}">
        <div class="output-item-actions">
          <button type="button" class="btn btn-primary output-save-edit" data-id="${note.id}">儲存</button>
          <button type="button" class="btn output-cancel-edit" data-id="${note.id}">取消</button>
        </div>
        <textarea class="output-edit-textarea" rows="3">${escapeHtml(note.text)}</textarea>
        <div class="output-date">${escapeHtml((note.createdAt || '').slice(0, 10))}</div>
      </div>
    `;
  }
  return `
    <div class="output-item" data-id="${note.id}">
      <div class="output-item-actions">
        <button type="button" class="btn output-edit" data-id="${note.id}" title="編輯">${ICON_EDIT}</button>
        <button type="button" class="btn btn-danger output-delete" data-id="${note.id}" title="刪除">${ICON_DELETE}</button>
      </div>
      <p>${renderTextWithHashtags(note.text)}</p>
      <div class="output-date">${escapeHtml((note.createdAt || '').slice(0, 10))}</div>
    </div>
  `;
}

// editingId：目前正在編輯中的那一條筆記 id（同一時間只開放編輯一條，符合
// 一般「行內編輯」的直覺——同時開兩條編輯欄容易搞不清楚哪個「儲存」對應
// 哪一條）。整個函式每次都會重新從資料庫抓一次最新的筆記列表（跟既有的
// 新增／刪除操作完全同一套模式），editingId 只是額外告訴 noteItem() 要把
// 哪一張卡片換成編輯狀態，取消編輯不需要另外寫回資料庫，直接重繪回唯讀
// 狀態即可。
export async function renderNotesSection(container, bookId, { editingId = null } = {}) {
  const notes = await getNotesForBook(bookId);

  container.innerHTML = `
    <div class="notes-section">
      <h4 class="section-heading icon-heading">${ICON_NOTEBOOK}快速筆記</h4>
      <form id="note-form" class="book-form">
        <label>想到什麼就先寫下來，之後再整理
          <textarea name="text" rows="2" placeholder="例如：這裡提到榮格，感覺跟之前看的那本書有關"></textarea>
        </label>
        <p class="hashtag-hint">${ICON_LIGHTBULB}提示：內文中輸入 #標籤名稱（例如 #心理學），系統將自動分類並串聯相關書籍內容。</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">儲存</button>
        </div>
      </form>
      <div class="output-list">
        ${notes.length === 0 ? '<p class="empty">還沒有任何筆記。</p>' : notes.map((note) => noteItem(note, note.id === editingId)).join('')}
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
      const confirmed = await confirmModal({
        title: '確定要刪除嗎？',
        message: '這則筆記刪除後無法復原。',
        confirmText: '確認刪除',
        cancelText: '取消',
        danger: true,
      });
      if (!confirmed) return;
      await DB.remove('notes', Number(btn.dataset.id));
      await renderNotesSection(container, bookId);
    });
  });

  container.querySelectorAll('.output-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderNotesSection(container, bookId, { editingId: Number(btn.dataset.id) });
    });
  });

  container.querySelectorAll('.output-cancel-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      renderNotesSection(container, bookId);
    });
  });

  container.querySelectorAll('.output-save-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const note = notes.find((n) => n.id === id);
      const editTextarea = container.querySelector(`.output-item[data-id="${id}"] .output-edit-textarea`);
      const newText = editTextarea.value.trim();
      if (!newText) {
        showToast('筆記內容不能是空的');
        return;
      }
      await DB.update('notes', { ...note, text: newText, updatedAt: new Date().toISOString() });
      showToast('筆記已更新');
      await renderNotesSection(container, bookId);
    });
  });

  // 編輯欄位快捷鍵跟上面「新增筆記」的主輸入框同一套習慣：Cmd/Ctrl+Enter
  // 直接送出儲存，額外加 Esc 取消編輯（純粹方便，不用另外去點小小的取消
  // 按鈕），只在編輯狀態的 textarea 上生效。
  const editTextareaEl = container.querySelector('.output-edit-textarea');
  if (editTextareaEl) {
    editTextareaEl.focus();
    editTextareaEl.setSelectionRange(editTextareaEl.value.length, editTextareaEl.value.length);
    editTextareaEl.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        container.querySelector('.output-save-edit').click();
      } else if (event.key === 'Escape') {
        container.querySelector('.output-cancel-edit').click();
      }
    });
  }
}
