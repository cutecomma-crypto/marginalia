import { DB } from './db.js';
import { renderReadingSection, STATUS_OPTIONS } from './readingRecords.js';
import { renderMotivation, renderReflections, MOTIVATION_TAGS } from './outputs.js';
import { renderNotesSection } from './notes.js';
import { renderQuoteSummaryCard } from './quotes.js';
import { renderSidebarStats } from './stats.js';
import { renderRecentActivity } from './home.js';
import { getFavoriteAuthorMap, toggleFavoriteAuthor, renderFavoriteAuthorsPanel } from './authors.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 1 節。「書籍類型」是固定選項的單選分類；
// 「主題／標籤」是可自由新增的多值標籤，兩者刻意分開，不混成同一欄位。
// 大分類參考誠品的八大類架構，細項直接採用使用者 Notion「類型」欄位裡實際在用的詞彙，
// 太冷門、沒對照到的維持「其他」，不硬塞進某一類。
const CATEGORY_GROUPS = [
  { label: '文學', options: ['中文文學', '歐美文學', '日本文學', '韓國文學', '科幻小說', '驚悚小說', '大眾文學', '旅行文學'] },
  { label: '商業財經', options: ['投資理財', '企業管理', '經濟趨勢'] },
  { label: '心理勵志', options: ['心理學理論', '自我提升', '心靈雞湯', '人際關係'] },
  { label: '人文思辨', options: ['哲學理論', '歷史', '人物傳記', '社會科學'] },
  { label: '美學生活', options: ['美術設計', '電影表演', '生活風格'] },
  { label: '科普教育', options: ['科普教育', '醫學保健', '語言學習'] },
  { label: '其他', options: ['工具書／參考', '童書／青少年', '其他'] },
];
// 標籤故意不放跟分類重疊的類型詞（心理學／歷史／哲學…已經是分類選項），
// 改放「跨類型的具體議題」或「閱讀情境」，讓一本書能同時貼上分類之外的多個面向。
const TAG_SUGGESTIONS = ['原生家庭', '溝通表達', '職場', '自我覺察', '想寫心得', '適合重讀', '朋友推薦', '書單挑戰'];
const FORMAT_OPTIONS = ['紙本', '電子書', '有聲書', '其他'];

function datalistOptions(list) {
  return list.map((v) => `<option value="${escapeHtml(v)}"></option>`).join('');
}

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

function bookRow(book, favoriteAuthors) {
  const tags = (book.tags || []).join('、');
  const isFavoriteAuthor = book.author && favoriteAuthors.has(book.author);
  return `
    <tr>
      <td><a href="#/books/${book.id}">${escapeHtml(book.title || '（未命名）')}</a></td>
      <td class="author-cell"><span class="author-star${isFavoriteAuthor ? '' : ' is-hidden'}" title="喜愛的作者">♥</span>${escapeHtml(book.author)}</td>
      <td>${escapeHtml(book.category)}</td>
      <td>${escapeHtml(tags)}</td>
    </tr>
  `;
}

// 跨書名／作者／標籤／筆記內容搜尋：把每本書的可搜尋文字先組好，輸入時直接子字串比對。
async function buildSearchIndex(books) {
  const allNotes = await DB.getAll('notes');
  const notesByBook = {};
  for (const note of allNotes) {
    if (!notesByBook[note.bookId]) notesByBook[note.bookId] = [];
    notesByBook[note.bookId].push(note.text);
  }
  return books.map((book) => ({
    book,
    searchText: [book.title, book.author, ...(book.tags || []), ...(notesByBook[book.id] || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  }));
}

function bookTableHtml(list, favoriteAuthors) {
  return `
    <table class="book-table">
      <thead>
        <tr><th>書名</th><th>作者</th><th>書籍類型</th><th>主題／標籤</th></tr>
      </thead>
      <tbody>
        ${list.map((book) => bookRow(book, favoriteAuthors)).join('')}
      </tbody>
    </table>
  `;
}

export async function renderBookList(container) {
  const books = await DB.getAll('books');
  books.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const index = await buildSearchIndex(books);
  const favoriteAuthors = await getFavoriteAuthorMap();

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
          <input type="search" id="book-search" class="search-input" placeholder="搜尋書名、作者，或筆記內容…">
          <span class="book-list-count" id="book-list-count">共 ${books.length} 本</span>
        </div>
        <div id="book-list-body">
          ${books.length === 0 ? '<p class="empty">還沒有任何書籍，點擊上方新增第一本。</p>' : bookTableHtml(books, favoriteAuthors)}
        </div>
      </div>
    </div>
  `;

  await renderSidebarStats(container.querySelector('#stats-panel-container'));
  await renderFavoriteAuthorsPanel(container.querySelector('#favorite-authors-container'));
  await renderRecentActivity(container.querySelector('#home-sections-container'));

  const searchInput = container.querySelector('#book-search');
  const bodyEl = container.querySelector('#book-list-body');
  const countEl = container.querySelector('#book-list-count');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      bodyEl.innerHTML = books.length === 0 ? '<p class="empty">還沒有任何書籍，點擊上方新增第一本。</p>' : bookTableHtml(books, favoriteAuthors);
      countEl.textContent = `共 ${books.length} 本`;
      return;
    }
    const matched = index.filter((entry) => entry.searchText.includes(query)).map((entry) => entry.book);
    bodyEl.innerHTML = matched.length === 0
      ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
      : bookTableHtml(matched, favoriteAuthors);
    countEl.textContent = matched.length === books.length ? `共 ${books.length} 本` : `符合 ${matched.length} 本（共 ${books.length} 本）`;
  });
}

function tagChipHtml(tag) {
  return `<span class="tag-chip">${escapeHtml(tag)}<button type="button" class="tag-chip-remove" data-tag="${escapeHtml(tag)}" aria-label="移除">×</button></span>`;
}

// 主題／標籤的自由新增小元件：打字按 Enter（或逗號）變成一個 chip，跟表單其他欄位不同，
// 不是原生 input，所以送出時要另外呼叫 getTags() 取值，不能靠 FormData。
function setupTagInput(root, initialTags) {
  let tags = [...initialTags];
  const chipList = root.querySelector('.tag-chip-list');
  const textInput = root.querySelector('.tag-text-input');

  function render() {
    chipList.innerHTML = tags.map(tagChipHtml).join('');
    chipList.querySelectorAll('.tag-chip-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        tags = tags.filter((t) => t !== btn.dataset.tag);
        render();
      });
    });
  }
  render();

  function addFromInput() {
    const value = textInput.value.trim();
    if (value && !tags.includes(value)) {
      tags.push(value);
      render();
    }
    textInput.value = '';
  }

  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addFromInput();
    }
  });
  textInput.addEventListener('blur', () => {
    if (textInput.value.trim()) addFromInput();
  });

  return { getTags: () => tags };
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

      <fieldset class="form-section">
        <legend>🏷️ 分類</legend>
        <label>書籍類型
          <select name="category">
            <option value="">（先不分類）</option>
            ${categoryOptionsHtml(book.category)}
          </select>
        </label>
        <label>主題／標籤
          <div class="tag-input" id="tags-input">
            <div class="tag-chip-list"></div>
            <input type="text" class="tag-text-input" placeholder="輸入後按 Enter 新增，例如：職場">
            <datalist id="tag-suggestions">${datalistOptions(TAG_SUGGESTIONS)}</datalist>
          </div>
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
        <label class="checkbox field-wide"><input type="checkbox" name="owned" ${book.owned ? 'checked' : ''}> 是否擁有</label>
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
          <span class="tag-checkboxes">${MOTIVATION_TAGS.map((m) => `<label><input type="checkbox" name="motivationTags" value="${escapeHtml(m)}"> ${escapeHtml(m)}</label>`).join('')}</span>
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
  const tagApi = setupTagInput(container.querySelector('#tags-input'), book.tags || []);
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
      owned: form.elements.owned.checked,
      category: data.category || '',
      tags: tagApi.getTags(),
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
            ${detailRow('是否擁有', book.owned ? '是' : '否')}
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
