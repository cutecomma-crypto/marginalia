import { DB } from './db.js';
import { renderReadingSection, STATUS_OPTIONS } from './readingRecords.js';
import { renderMotivation, renderReflections, MOTIVATION_TAGS } from './outputs.js';
import { renderNotesSection } from './notes.js';
import { renderQuoteSummaryCard } from './quotes.js';
import { renderSidebarStats } from './stats.js';
import { renderRecentActivity } from './home.js';
import { getFavoriteAuthorMap, toggleFavoriteAuthor, renderFavoriteAuthorsPanel } from './authors.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 1 節。「書籍類型」是固定選項的單選分類。
// 大分類參考誠品的八大類架構，細項直接採用使用者 Notion「類型」欄位裡實際在用的詞彙，
// 太冷門、沒對照到的維持「其他」，不硬塞進某一類。
const CATEGORY_GROUPS = [
  { label: '文學', options: ['中文文學', '歐美文學', '日本文學', '韓國文學', '科幻小說', '驚悚小說', '大眾文學', '旅行文學', '輕小說', 'BL', '言情小說'] },
  { label: '商業財經', options: ['投資理財', '企業管理', '經濟趨勢'] },
  { label: '心理勵志', options: ['心理學理論', '自我提升', '心靈雞湯', '人際關係'] },
  { label: '人文思辨', options: ['哲學理論', '歷史', '人物傳記', '社會科學'] },
  { label: '美學生活', options: ['美術設計', '電影表演', '生活風格'] },
  { label: '科普教育', options: ['科普教育', '醫學保健', '語言學習'] },
  { label: '其他', options: ['工具書／參考', '童書／青少年', '其他'] },
];
const FORMAT_OPTIONS = ['紙本', '電子書', '有聲書', '其他'];
const RETENTION_STATUS_OPTIONS = ['保存', '待售', '借閱', '售出', '轉贈'];
const DEFAULT_RETENTION_STATUS = '保存';

// 上傳的封面圖直接壓縮成 base64 存進 IndexedDB（純本機，不用連網、不用外部圖床）。
// 縮到最長邊 500px、JPEG 品質 0.82，避免原圖太大把資料庫和備份檔案撐爆。
function resizeImageToDataUrl(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('無法讀取圖片'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('無法讀取檔案'));
    reader.readAsDataURL(file);
  });
}

function wireCoverUpload(form) {
  const fileInput = form.querySelector('#cover-file-input');
  const preview = form.querySelector('#cover-preview');
  const valueInput = form.querySelector('#cover-image-value');
  const removeBtn = form.querySelector('#cover-remove-btn');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 500, 0.82);
      valueInput.value = dataUrl;
      preview.innerHTML = `<img src="${dataUrl}" alt="封面預覽">`;
      removeBtn.style.display = '';
    } catch {
      window.alert('封面圖片讀取失敗，換一張試試看。');
    }
  });

  removeBtn.addEventListener('click', () => {
    valueInput.value = '';
    fileInput.value = '';
    preview.innerHTML = '<span class="cover-preview-empty">尚未上傳封面</span>';
    removeBtn.style.display = 'none';
  });
}

// 舊資料若存了不在新清單裡的分類（例如改版前的「小說／文學」），
// 不能讓它悄悄消失或被換掉，先當作暫時選項顯示，使用者自己決定要不要換成新分類。
function categoryOptionsHtml(selected) {
  const known = CATEGORY_GROUPS.flatMap((g) => g.options);
  const legacyOption = selected && !known.includes(selected)
    ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（舊分類）</option>`
    : '';
  const groups = CATEGORY_GROUPS.map((g) => `
    <optgroup label="${escapeHtml(g.label)}">
      ${g.options.map((o) => `<option value="${escapeHtml(o)}" ${selected === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </optgroup>
  `).join('');
  return legacyOption + groups;
}

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
}

// 完成日期欄位：完成了就用綠色小標籤標出日期（視覺上一眼能認出「這本讀完了」），
// 還沒完成就顯示「—」，不再重複列一整欄閱讀狀態，把空間留給書名。
function completedDateCell(record) {
  if (record && record.endDate) {
    return `<span class="book-status-badge is-completed">🏁 ${escapeHtml(formatDateSlash(record.endDate))}</span>`;
  }
  return '<span class="book-status-empty">—</span>';
}

function bookRow(book, favoriteAuthors, recordMap) {
  const record = recordMap.get(book.id);
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <tr>
      <td><a href="#/books/${book.id}" title="${escapeHtml(book.title || '（未命名）')}">${escapeHtml(book.title || '（未命名）')}</a></td>
      <td class="author-cell" title="${escapeHtml(book.author)}"><span class="author-star${isFavoriteAuthor ? '' : ' is-hidden'}" title="喜愛的作者">♥</span>${escapeHtml(book.author)}</td>
      <td>${escapeHtml(book.category)}</td>
      <td>${completedDateCell(record)}</td>
    </tr>
  `;
}

function groupTextByBookId(items, field) {
  const map = {};
  for (const item of items) {
    if (!map[item.bookId]) map[item.bookId] = [];
    map[item.bookId].push(item[field]);
  }
  return map;
}

// 跨書名／作者／筆記／佳句／閱讀後輸出內容搜尋（含 #hashtag，因為標籤本來就是內文的一部分，
// 子字串比對天生就會吃到）：把每本書的可搜尋文字先組好，輸入時直接子字串比對。
async function buildSearchIndex(books) {
  const [allNotes, allQuotes, allOutputs] = await Promise.all([
    DB.getAll('notes'),
    DB.getAll('quotes'),
    DB.getAll('outputs'),
  ]);
  const notesByBook = groupTextByBookId(allNotes, 'text');
  const quotesByBook = groupTextByBookId(allQuotes, 'content');
  const reflectionsByBook = groupTextByBookId(allOutputs.filter((o) => o.kind === 'reflection'), 'text');

  return books.map((book) => ({
    book,
    searchText: [
      book.title, book.author, ...(book.tags || []),
      ...(notesByBook[book.id] || []), ...(quotesByBook[book.id] || []), ...(reflectionsByBook[book.id] || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }));
}

function bookTableHtml(list, favoriteAuthors, recordMap) {
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
        ${list.map((book) => bookRow(book, favoriteAuthors, recordMap)).join('')}
      </tbody>
    </table>
  `;
}

const SORT_OPTIONS = [
  { value: 'created-desc', label: '建立時間：新到舊' },
  { value: 'created-asc', label: '建立時間：舊到新' },
  { value: 'completed-desc', label: '完成時間：已完成優先' },
];

function sortBooks(books, recordMap, sortMode) {
  const list = [...books];
  if (sortMode === 'created-asc') {
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  } else if (sortMode === 'completed-desc') {
    list.sort((a, b) => {
      const endA = recordMap.get(a.id)?.endDate || '';
      const endB = recordMap.get(b.id)?.endDate || '';
      if (endA && endB) return endB.localeCompare(endA);
      if (endA && !endB) return -1;
      if (!endA && endB) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  } else {
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  return list;
}

async function buildLatestRecordMap(bookIds) {
  const allRecords = await DB.getAll('reading_records');
  const byBook = new Map();
  for (const record of allRecords) {
    const current = byBook.get(record.bookId);
    if (!current || (record.createdAt || '').localeCompare(current.createdAt || '') > 0) {
      byBook.set(record.bookId, record);
    }
  }
  const map = new Map();
  for (const id of bookIds) map.set(id, byBook.get(id) || null);
  return map;
}

export async function renderBookList(container) {
  const books = await DB.getAll('books');
  const index = await buildSearchIndex(books);
  const favoriteAuthors = await getFavoriteAuthorMap();
  const recordMap = await buildLatestRecordMap(books.map((b) => b.id));

  container.innerHTML = `
    <div class="dashboard-layout">
      <aside class="dashboard-sidebar">
        <div id="stats-panel-container"></div>
        <div id="favorite-authors-container"></div>
        <div id="home-sections-container"></div>
      </aside>
      <div class="dashboard-main">
        <div class="toolbar">
          <h2>所有書籍</h2>
          <a class="btn btn-primary" href="#/books/new">＋ 新增書籍</a>
        </div>
        <div class="search-row">
          <input type="search" id="book-search" class="search-input" placeholder="搜尋書名、作者、#標籤，或筆記／佳句內容…">
          <select id="book-sort-select" class="sort-select">
            ${SORT_OPTIONS.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
          <span class="book-list-count" id="book-list-count">共 ${books.length} 本</span>
        </div>
        <div id="book-list-body"></div>
      </div>
    </div>
  `;

  await renderSidebarStats(container.querySelector('#stats-panel-container'));
  await renderFavoriteAuthorsPanel(container.querySelector('#favorite-authors-container'));
  await renderRecentActivity(container.querySelector('#home-sections-container'));

  const searchInput = container.querySelector('#book-search');
  const sortSelect = container.querySelector('#book-sort-select');
  const bodyEl = container.querySelector('#book-list-body');
  const countEl = container.querySelector('#book-list-count');

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    const base = query
      ? index.filter((entry) => entry.searchText.includes(query)).map((entry) => entry.book)
      : books;
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    if (sorted.length === 0) {
      bodyEl.innerHTML = query
        ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
        : '<p class="empty">還沒有任何書籍，點擊上方新增第一本。</p>';
    } else {
      bodyEl.innerHTML = bookTableHtml(sorted, favoriteAuthors, recordMap);
    }
    countEl.textContent = sorted.length === books.length ? `共 ${books.length} 本` : `符合 ${sorted.length} 本（共 ${books.length} 本）`;
  }

  searchInput.addEventListener('input', renderList);
  sortSelect.addEventListener('change', renderList);
  renderList();
}

function formTemplate(book, isNew, isFavoriteAuthor) {
  return `
    <form id="book-form" class="book-form" novalidate>
      <fieldset class="form-section">
        <legend>📖 書籍基本資料</legend>
        <label class="field-required field-wide">書名 *<input name="title" required value="${escapeHtml(book.title)}" placeholder="這本書叫什麼名字？"></label>
        <label>作者
          <span class="author-input-row">
            <input name="author" value="${escapeHtml(book.author)}">
            <button type="button" id="author-favorite-btn" class="star-btn${isFavoriteAuthor ? ' filled' : ''}" title="標記為喜愛的作者">♥</button>
          </span>
        </label>
        <label>出版社<input name="publisher" value="${escapeHtml(book.publisher)}"></label>
        <label>出版日期<input type="date" name="publishDate" value="${escapeHtml(book.publishDate)}"></label>
        <label>分類
          <select name="category">
            <option value="">（先不分類）</option>
            ${categoryOptionsHtml(book.category)}
          </select>
        </label>
        <label class="field-wide">封面圖片（選填）
          <div class="cover-upload" id="cover-upload">
            <div class="cover-preview" id="cover-preview">
              ${book.coverImage ? `<img src="${book.coverImage}" alt="封面預覽">` : '<span class="cover-preview-empty">尚未上傳封面</span>'}
            </div>
            <div class="cover-upload-actions">
              <input type="file" accept="image/*" id="cover-file-input">
              <button type="button" id="cover-remove-btn" class="btn" style="${book.coverImage ? '' : 'display:none;'}">移除封面</button>
            </div>
          </div>
          <input type="hidden" name="coverImage" id="cover-image-value" value="${escapeHtml(book.coverImage || '')}">
        </label>
      </fieldset>

      <fieldset class="form-section form-section-quiet">
        <legend>🛒 擁有／購買資料</legend>
        <label>購買日期<input type="date" name="purchaseDate" value="${escapeHtml(book.purchaseDate)}"></label>
        <label>購買來源<input name="purchaseSource" value="${escapeHtml(book.purchaseSource)}"></label>
        <label>購買價格<input type="number" name="purchasePrice" min="0" value="${escapeHtml(book.purchasePrice)}"></label>
        <label>書籍形式
          <select name="format">
            ${FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${book.format === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
          </select>
        </label>
        <label>存留狀態
          <select name="retentionStatus">
            ${RETENTION_STATUS_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
          </select>
        </label>
      </fieldset>

      ${isNew ? `
      <fieldset class="form-section">
        <legend>📚 我的閱讀</legend>
        <label>閱讀狀態
          <select name="status">
            ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${s === '想讀' ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </label>
        <label class="field-wide">閱讀動機（可複選，選填）
          <span class="tag-checkboxes motivation-tags">${MOTIVATION_TAGS.map((m) => `<label><input type="checkbox" name="motivationTags" value="${escapeHtml(m)}"> ${escapeHtml(m)}</label>`).join('')}</span>
        </label>
        <label class="field-wide">我現在為什麼想讀它？
          <textarea name="motivationText" rows="2" placeholder="低壓力，想到什麼寫什麼，不寫也沒關係"></textarea>
        </label>
      </fieldset>
      ` : ''}

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isNew ? '加入我的書庫' : '儲存'}</button>
        <a class="btn" href="${book.id ? `#/books/${book.id}` : '#/books'}">取消</a>
      </div>
    </form>
  `;
}

export async function renderBookForm(container, rawId) {
  const bookId = rawId ? Number(rawId) : null;
  const existing = bookId ? await DB.getById('books', bookId) : null;
  if (bookId && !existing) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }
  const book = existing || {};
  const isNew = !bookId;
  let favoriteAuthors = await getFavoriteAuthorMap();

  container.innerHTML = `
    <div class="toolbar">
      <h2>${isNew ? '加入一本書' : '編輯書籍'}</h2>
    </div>
    ${formTemplate(book, isNew, book.author && favoriteAuthors.has(book.author))}
  `;

  const form = container.querySelector('#book-form');
  wireCoverUpload(form);

  const authorInput = form.elements.author;
  const favoriteBtn = container.querySelector('#author-favorite-btn');
  authorInput.addEventListener('input', () => {
    favoriteBtn.classList.toggle('filled', favoriteAuthors.has(authorInput.value.trim()));
  });
  favoriteBtn.addEventListener('click', async () => {
    favoriteAuthors = await toggleFavoriteAuthor(authorInput.value, favoriteAuthors);
    favoriteBtn.classList.toggle('filled', favoriteAuthors.has(authorInput.value.trim()));
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const title = (data.title || '').trim();
    if (!title) {
      form.elements.title.focus();
      return;
    }

    const payload = {
      title,
      author: (data.author || '').trim(),
      publisher: (data.publisher || '').trim(),
      publishDate: data.publishDate || '',
      purchaseDate: data.purchaseDate || '',
      purchaseSource: (data.purchaseSource || '').trim(),
      purchasePrice: data.purchasePrice ? Number(data.purchasePrice) : null,
      format: data.format || '其他',
      retentionStatus: data.retentionStatus || DEFAULT_RETENTION_STATUS,
      category: data.category || '',
      coverImage: data.coverImage || '',
    };

    let targetBookId = bookId;
    if (bookId) {
      await DB.update('books', { ...book, ...payload, id: bookId });
    } else {
      targetBookId = await DB.add('books', payload);
      const motivationTags = Array.from(form.querySelectorAll('input[name="motivationTags"]:checked')).map((el) => el.value);
      const motivationText = (data.motivationText || '').trim();
      await DB.add('reading_records', {
        bookId: targetBookId,
        status: data.status || '想讀',
        startDate: '',
        endDate: '',
        currentPage: null,
        readCount: 0,
        rating: 0,
      });
      if (motivationTags.length > 0 || motivationText) {
        await DB.add('outputs', { bookId: targetBookId, kind: 'motivation', tags: motivationTags, text: motivationText });
      }
    }
    window.location.hash = `#/books/${targetBookId}`;
  });
}

function detailRow(label, value) {
  if (value === undefined || value === null || value === '') return '';
  return `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}

export async function renderBookDetail(container, rawId) {
  const bookId = Number(rawId);
  const book = await DB.getById('books', bookId);
  if (!book) {
    container.innerHTML = '<p class="empty">找不到這本書。</p>';
    return;
  }
  const favoriteAuthors = await getFavoriteAuthorMap();
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);

  container.innerHTML = `
    <div class="toolbar">
      <a href="#/books">← 回列表</a>
      <div class="toolbar-actions">
        <a class="btn" href="#/books/${bookId}/graph">🕸️ 關係圖譜</a>
        <a class="btn" href="#/books/${bookId}/edit">編輯</a>
        <button type="button" class="btn btn-danger" id="delete-book">刪除</button>
      </div>
    </div>
    <div class="book-detail-layout">
      <div class="book-detail-main">
        <div class="book-detail-header">
          ${book.coverImage ? `<img class="book-cover-image" src="${book.coverImage}" alt="《${escapeHtml(book.title || '未命名')}》封面">` : ''}
          <div class="book-detail-header-text">
            <h2>${escapeHtml(book.title || '（未命名）')}</h2>
            ${book.tags && book.tags.length ? `
            <div class="detail-tags">
              ${book.tags.map((t) => `<span class="output-tag">${escapeHtml(t)}</span>`).join('')}
            </div>
            ` : ''}
          </div>
        </div>
        <div class="main-tabs">
          <div class="main-tab-buttons">
            <button type="button" class="main-tab-btn is-active" data-tab="motivation">💡 閱讀動機</button>
            <button type="button" class="main-tab-btn" data-tab="reflection">✍️ 閱讀後輸出</button>
            <button type="button" class="main-tab-btn" data-tab="notes">📝 快速筆記</button>
          </div>
          <div class="main-tab-panel" data-tab-panel="motivation">
            <div id="motivation-container"></div>
          </div>
          <div class="main-tab-panel" data-tab-panel="reflection" hidden>
            <div id="reflection-container"></div>
          </div>
          <div class="main-tab-panel" data-tab-panel="notes" hidden>
            <div id="notes-section"></div>
          </div>
        </div>
      </div>
      <aside class="book-detail-sidebar">
        <div class="sidebar-panel">
          <h4>書籍資料</h4>
          <div class="detail-grid-compact">
            ${detailRow('作者', book.author ? `${isFavoriteAuthor ? '♥ ' : ''}${book.author}` : book.author)}
            ${detailRow('出版社', book.publisher)}
            ${detailRow('出版日期', book.publishDate)}
            ${detailRow('購買日期', book.purchaseDate)}
            ${detailRow('購買來源', book.purchaseSource)}
            ${detailRow('購買價格', book.purchasePrice)}
            ${detailRow('書籍形式', book.format)}
            ${detailRow('存留狀態', book.retentionStatus || DEFAULT_RETENTION_STATUS)}
            ${detailRow('書籍類型', book.category)}
          </div>
        </div>
        <div id="quotes-summary"></div>
        <div id="reading-section"></div>
      </aside>
    </div>
  `;

  container.querySelector('#delete-book').addEventListener('click', async () => {
    if (!window.confirm(`確定要刪除《${book.title || '（未命名）'}》嗎？此動作無法復原，連同它的閱讀紀錄、輸出、筆記、圖譜一起刪除。`)) return;
    await DB.removeByIndex('reading_records', 'bookId', bookId);
    await DB.removeByIndex('outputs', 'bookId', bookId);
    await DB.removeByIndex('quotes', 'bookId', bookId);
    await DB.removeByIndex('notes', 'bookId', bookId);
    await DB.removeByIndex('edges', 'bookId', bookId);
    await DB.removeByIndex('nodes', 'bookId', bookId);
    await DB.remove('books', bookId);
    window.location.hash = '#/books';
  });

  const mainTabButtons = container.querySelectorAll('.main-tab-btn');
  const mainTabPanels = container.querySelectorAll('.main-tab-panel');
  mainTabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      mainTabButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
      mainTabPanels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== btn.dataset.tab; });
    });
  });

  await renderReadingSection(container.querySelector('#reading-section'), bookId, book);
  await renderMotivation(container.querySelector('#motivation-container'), bookId);
  await renderReflections(container.querySelector('#reflection-container'), bookId);
  await renderQuoteSummaryCard(container.querySelector('#quotes-summary'), bookId);
  await renderNotesSection(container.querySelector('#notes-section'), bookId);
}
