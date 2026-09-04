import { DB } from './db.js';
import { escapeHtml, renderTextWithHashtags } from './utils.js';

// 頁碼欄位是自由文字（例如「45-47」），排序時只抓第一串數字當排序依據。
function parsePageNumber(page) {
  if (!page) return null;
  const match = String(page).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function sortByPage(quotes) {
  return [...quotes].sort((a, b) => {
    const pageA = parsePageNumber(a.page);
    const pageB = parsePageNumber(b.page);
    if (pageA != null && pageB != null && pageA !== pageB) return pageA - pageB;
    if (pageA != null && pageB == null) return -1;
    if (pageA == null && pageB != null) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });
}

function sortByNewest(quotes) {
  return [...quotes].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

async function getQuotesByBook(bookId) {
  return DB.getByIndex('quotes', 'bookId', bookId);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('複製失敗，請手動選取複製：', text);
    return false;
  }
}

// ---------- 佳句工作區（新增／搜尋／排序／列表）----------
// 獨立佳句頁面（/books/:id/quotes）跟書籍詳情頁的「佳句摘錄」Tab 共用同一份邏輯，
// 差別只在外層有沒有包一層「回列表」的 toolbar，所以拆成這個函式讓兩邊都能呼叫。

function quoteCardHtml(quote) {
  return `
    <div class="quote-card" data-id="${quote.id}">
      <div class="quote-card-top">
        <span class="quote-mark" aria-hidden="true">“</span>
        ${quote.page ? `<span class="quote-page-badge">P. ${escapeHtml(quote.page)}</span>` : ''}
      </div>
      <div class="quote-content-wrap">
        <p class="quote-content is-clamped">${renderTextWithHashtags(quote.content)}<span class="quote-mark-close" aria-hidden="true">”</span></p>
        <button type="button" class="quote-expand-btn" style="display:none;">展開全文</button>
      </div>
      <div class="quote-actions">
        <button type="button" class="quote-copy-btn" data-id="${quote.id}">複製內文</button>
        <button type="button" class="quote-edit-btn" data-id="${quote.id}">編輯</button>
        <button type="button" class="quote-delete-btn" data-id="${quote.id}">刪除</button>
      </div>
    </div>
  `;
}

function quoteEditFormHtml(quote) {
  return `
    <form class="quote-card quote-edit-form" data-id="${quote.id}">
      <textarea name="content" rows="4" required>${escapeHtml(quote.content)}</textarea>
      <input name="page" class="quote-page-edit-input" value="${escapeHtml(quote.page || '')}" placeholder="頁碼（選填），例如：45 或 45-47">
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">儲存</button>
        <button type="button" class="btn quote-cancel-btn">取消</button>
      </div>
    </form>
  `;
}

// options.onCountChange(total)：每次重繪清單都會回報目前總條數，
// 書籍詳情頁的「佳句摘錄」Tab 用這個把數字同步更新到分頁按鈕上的「(X 條)」。
// 不吃 book 這個參數——原本只有「匯出文字檔／Markdown」需要書名，兩個匯出
// 按鈕都拿掉之後，這個函式只需要 bookId 就能運作。
export async function renderQuotesWorkspace(container, bookId, options = {}) {
  const onCountChange = options.onCountChange || (() => {});
  let editingId = null;
  let searchQuery = '';
  let sortMode = 'page';

  container.innerHTML = `
    <div class="quotes-page-layout">
      <div class="quotes-page-form-col">
        <div class="graph-panel">
          <h4>新增佳句</h4>
          <form id="quote-form" class="book-form">
            <label>佳句內容
              <textarea name="content" rows="6" placeholder="輸入書中打動你的句子……" required></textarea>
            </label>
            <label class="quote-page-label">頁碼（選填）
              <input name="page" class="quote-page-input" placeholder="例如：45 或 45-47">
            </label>
            <div class="form-actions"><button type="submit" class="btn btn-primary">＋ 新增佳句</button></div>
          </form>
        </div>
      </div>
      <div class="quotes-page-list-col">
        <div class="quotes-toolbar">
          <input type="search" id="quote-search" class="search-input" placeholder="搜尋佳句內容…">
          <select id="quote-sort" class="quote-sort-select">
            <option value="page">依頁碼排序</option>
            <option value="newest">依新增時間排序</option>
          </select>
        </div>
        <p class="graph-hint" id="quote-count-hint"></p>
        <div class="quote-list" id="quote-list"></div>
      </div>
    </div>
  `;

  const form = container.querySelector('#quote-form');
  const listEl = container.querySelector('#quote-list');
  const countHint = container.querySelector('#quote-count-hint');
  const searchInput = container.querySelector('#quote-search');
  const sortSelect = container.querySelector('#quote-sort');

  async function redrawList() {
    let quotes = await getQuotesByBook(bookId);
    const total = quotes.length;
    onCountChange(total);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      quotes = quotes.filter((item) => item.content.toLowerCase().includes(q));
    }
    quotes = sortMode === 'newest' ? sortByNewest(quotes) : sortByPage(quotes);

    countHint.textContent = searchQuery
      ? `符合 ${quotes.length} 條（共 ${total} 條）`
      : `共 ${total} 條`;

    listEl.innerHTML = quotes.length === 0
      ? `<p class="empty">${total === 0 ? '還沒有摘錄任何佳句。' : '找不到符合的佳句。'}</p>`
      : quotes.map((q) => (q.id === editingId ? quoteEditFormHtml(q) : quoteCardHtml(q))).join('');

    wireListEvents();
  }

  function wireListEvents() {
    listEl.querySelectorAll('.quote-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const quote = await DB.getById('quotes', Number(btn.dataset.id));
        if (!quote) return;
        const ok = await copyText(quote.content);
        if (ok) {
          const original = btn.textContent;
          btn.textContent = '已複製';
          setTimeout(() => { btn.textContent = original; }, 1200);
        }
      });
    });

    listEl.querySelectorAll('.quote-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = Number(btn.dataset.id);
        redrawList();
      });
    });

    listEl.querySelectorAll('.quote-cancel-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingId = null;
        redrawList();
      });
    });

    listEl.querySelectorAll('.quote-edit-form').forEach((editForm) => {
      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const id = Number(editForm.dataset.id);
        const content = editForm.elements.content.value.trim();
        if (!content) return;
        const page = editForm.elements.page.value.trim();
        const existing = await DB.getById('quotes', id);
        await DB.update('quotes', { ...existing, content, page });
        editingId = null;
        await redrawList();
      });
    });

    listEl.querySelectorAll('.quote-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('確定要刪除這句佳句嗎？')) return;
        await DB.remove('quotes', Number(btn.dataset.id));
        await redrawList();
      });
    });

    listEl.querySelectorAll('.quote-expand-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wrap = btn.closest('.quote-content-wrap');
        const p = wrap.querySelector('.quote-content');
        const expanded = p.classList.toggle('is-expanded');
        p.classList.toggle('is-clamped', !expanded);
        btn.textContent = expanded ? '收合' : '展開全文';
      });
    });

    listEl.querySelectorAll('.quote-content.is-clamped').forEach((p) => {
      if (p.scrollHeight > p.clientHeight + 2) {
        const btn = p.closest('.quote-content-wrap').querySelector('.quote-expand-btn');
        if (btn) btn.style.display = '';
      }
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = form.elements.content.value.trim();
    if (!content) return;
    const page = form.elements.page.value.trim();
    await DB.add('quotes', { bookId, content, page });
    form.reset();
    await redrawList();
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    redrawList();
  });

  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value;
    redrawList();
  });

  await redrawList();
}

// ---------- 獨立佳句子頁面（/books/:id/quotes），外面多包一層「回列表」toolbar ----------

export async function renderQuotesPage(container, rawBookId) {
  const bookId = Number(rawBookId);
  const book = await DB.getById('books', bookId);
  if (!book) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }

  container.innerHTML = `
    <div class="toolbar">
      <a href="#/books/${bookId}">⬅ 回《${escapeHtml(book.title || '未命名')}》</a>
      <h2>佳句摘錄</h2>
    </div>
    <div id="quotes-workspace"></div>
  `;

  await renderQuotesWorkspace(container.querySelector('#quotes-workspace'), bookId);
}
