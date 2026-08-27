import { DB } from './db.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 2 節。頁數不重複存一份，直接沿用書籍資料的「頁數」欄位當分母。
export const STATUS_OPTIONS = ['尚未閱讀', '閱讀中', '已讀完', '暫停', '棄讀', '重讀'];

async function getRecordForBook(bookId) {
  const records = await DB.getByIndex('reading_records', 'bookId', bookId);
  if (records.length === 0) return null;
  records.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return records[0];
}

function starButtons(rating) {
  const value = rating || 0;
  return Array.from({ length: 5 }, (_, i) => i + 1)
    .map((n) => `<button type="button" class="star-btn${n <= value ? ' filled' : ''}" data-value="${n}" aria-label="${n} 星">★</button>`)
    .join('');
}

export async function renderReadingSection(container, bookId, book) {
  const record = await getRecordForBook(bookId);
  const totalPages = book.pages || null;
  const currentPage = record && record.currentPage != null ? record.currentPage : '';
  const percentage = totalPages && currentPage ? Math.round((currentPage / totalPages) * 100) : null;

  container.innerHTML = `
    <div class="reading-progress-module">
      <h4 class="progress-module-heading">📖 閱讀進度設定</h4>
      <form id="reading-form" class="book-form reading-progress-form">
        <div class="progress-form-grid">
          <label>狀態
            <select name="status">
              ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${record && record.status === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
            </select>
          </label>
          <label>開始日期<input type="date" name="startDate" value="${escapeHtml(record && record.startDate)}"></label>
          <label>完成日期<input type="date" name="endDate" value="${escapeHtml(record && record.endDate)}"></label>
          <div class="progress-pair-row">
            <label>閱讀進度
              <span class="page-progress">
                第 <input type="number" name="currentPage" min="0" value="${escapeHtml(currentPage)}" class="page-input"> /
                ${totalPages ? `${escapeHtml(totalPages)} 頁` : ''}
                <span id="progress-percentage">${percentage !== null ? `（${percentage}%）` : ''}</span>
              </span>
            </label>
            <label>閱讀次數<input type="number" name="readCount" min="0" value="${escapeHtml(record ? record.readCount || 0 : 0)}"></label>
          </div>
          <label>評分
            <span class="star-rating" id="star-rating">${starButtons(record && record.rating)}</span>
            <input type="hidden" name="rating" value="${record && record.rating ? record.rating : 0}">
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-sm">更新閱讀進度</button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector('#reading-form');
  const percentageEl = container.querySelector('#progress-percentage');
  const pageInput = form.elements.currentPage;

  pageInput.addEventListener('input', () => {
    const current = Number(pageInput.value);
    percentageEl.textContent = totalPages && current ? `（${Math.round((current / totalPages) * 100)}%）` : '';
  });

  container.querySelectorAll('.star-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = Number(btn.dataset.value);
      const hidden = form.elements.rating;
      const newValue = Number(hidden.value) === value ? 0 : value; // 再點一次同一顆星可清除評分
      hidden.value = newValue;
      container.querySelectorAll('.star-btn').forEach((b) => {
        b.classList.toggle('filled', Number(b.dataset.value) <= newValue);
      });
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const payload = {
      bookId,
      status: data.status,
      startDate: data.startDate || '',
      endDate: data.endDate || '',
      currentPage: data.currentPage ? Number(data.currentPage) : null,
      readCount: data.readCount ? Number(data.readCount) : 0,
      rating: data.rating ? Number(data.rating) : 0,
      updatedAt: new Date().toISOString(),
    };
    if (record) {
      await DB.update('reading_records', { ...record, ...payload, id: record.id });
    } else {
      await DB.add('reading_records', payload);
    }
    await renderReadingSection(container, bookId, book);
  });
}
