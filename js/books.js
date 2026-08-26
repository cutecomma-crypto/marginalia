import { DB } from './db.js';
import { renderReadingSection, STATUS_OPTIONS } from './readingRecords.js';
import { renderMotivation, renderReflections, MOTIVATION_TAGS } from './outputs.js';
import { renderNotesSection } from './notes.js';
import { renderQuoteSummaryCard } from './quotes.js';
import { renderSidebarStats } from './stats.js';
import { renderRecentActivity } from './home.js';
import { getFavoriteAuthorMap, toggleFavoriteAuthor, renderFavoriteAuthorsPanel } from './authors.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 1 節。「書籍類型」是固定選項＋可自訂的單選分類。
const CATEGORY_GROUPS = [
  { label: '文學小說', options: ['中文文學', '歐美文學', '日本文學', '韓國文學', '科幻小說', '驚悚小說', '大眾文學', '旅行文學', '輕小說', '言情小說', '耽美'] },
  { label: '商業理財', options: ['職場工作術', '生產力/筆記術', '投資理財', '企業管理', '經濟趨勢'] },
  { label: '心理勵志', options: ['心理學理論', '自我提升', '人際關係', '心靈雞湯'] },
  { label: '人文社會', options: ['歷史', '哲學理論', '人物傳記', '社會科學'] },
  { label: '生活應用/工具', options: ['學習法/思考術', '電腦資訊', '語言學習', '生活風格'] },
  { label: '藝術設計', options: ['美術設計', '電影表演', '音樂建築'] },
];
const CUSTOM_CATEGORY_VALUE = '__custom__';
const CUSTOM_CATEGORY_STORAGE_KEY = 'marginalia:customCategories';

// 使用者自己新增的分類存在 localStorage（跟 graph.js 的狀態標籤預設清單同一套做法），
// 之後每次開表單都要記得，並且要合併進「已知分類」清單，不要被誤判成舊資料。
// 每筆記錄現在存 { name, group }，才能知道要插進哪個大類別；改版前存的純字串陣列
// 一樣要讀得出來（視為沒有所屬大類別，退回最底部的「自訂分類」區塊）。
function loadCustomCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_CATEGORY_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === 'string' ? { name: entry, group: '' } : entry))
      .filter((entry) => entry && entry.name);
  } catch {
    return [];
  }
}

function saveCustomCategories(list) {
  localStorage.setItem(CUSTOM_CATEGORY_STORAGE_KEY, JSON.stringify(list));
}

function addCustomCategory(name, group) {
  const list = loadCustomCategories();
  if (!list.some((c) => c.name === name)) {
    list.push({ name, group: group || '' });
    saveCustomCategories(list);
  }
  return list;
}

// 刪除自訂分類時，除了從個人分類清單移除，也要把已經套用這個分類的書籍改回「先不分類」，
// 不然書籍資料裡會留著一個選單上再也選不到、找不到來源的分類字串。
async function removeCustomCategoryEverywhere(name) {
  saveCustomCategories(loadCustomCategories().filter((c) => c.name !== name));
  const books = await DB.getAll('books');
  for (const book of books) {
    if (book.category === name) {
      await DB.update('books', { ...book, category: '' });
    }
  }
}

// 改名／改所屬大類別：清單裡的記錄直接覆寫；如果名稱真的變了，已經套用舊名稱的書籍也要一起改過去，
// 不然書籍資料會停留在一個已經不存在的舊分類名稱上。
async function renameCustomCategoryEverywhere(oldName, newName, newGroup) {
  saveCustomCategories(loadCustomCategories().map((c) => (c.name === oldName ? { name: newName, group: newGroup || '' } : c)));
  if (newName === oldName) return;
  const books = await DB.getAll('books');
  for (const book of books) {
    if (book.category === oldName) {
      await DB.update('books', { ...book, category: newName });
    }
  }
}
const FORMAT_OPTIONS = ['紙本', '電子書', '有聲書', '其他'];
const RETENTION_STATUS_OPTIONS = ['保存', '待售', '借閱', '售出', '轉贈'];
const DEFAULT_RETENTION_STATUS = '保存';
const BORROWED_RETENTION_STATUS = '借閱';
const LIBRARY_BORROW_TYPE_OPTIONS = ['實體圖書館', '線上圖書館 / 電子書'];

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

  // 部分手機瀏覽器在關閉「分類」這種選項很多的原生下拉選單時，偶爾會把關閉當下的觸控事件
  // 誤判成點在下面緊鄰的檔案輸入框上，憑空跳出選擇檔案視窗。這裡不管實際成因是什麼，
  // 只要是「分類」欄位剛互動完的一小段時間內，一律擋掉檔案輸入框的點擊，從根本阻止誤觸。
  fileInput.addEventListener('click', (event) => {
    const suppressUntil = Number(fileInput.dataset.suppressClickUntil || 0);
    if (Date.now() < suppressUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

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
// 使用者自訂的分類會依照建立時選的大類別，插進對應 optgroup 的最後面；
// 沒有選大類別的舊資料（改版前存的純字串）才會退回最底部的「自訂分類」區塊。
function categoryOptionsHtml(selected) {
  const customCategories = loadCustomCategories();
  const known = [...CATEGORY_GROUPS.flatMap((g) => g.options), ...customCategories.map((c) => c.name)];
  const legacyOption = selected && !known.includes(selected)
    ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}（舊分類）</option>`
    : '';
  const groups = CATEGORY_GROUPS.map((g) => {
    const extra = customCategories.filter((c) => c.group === g.label).map((c) => c.name);
    const options = [...g.options, ...extra];
    return `
    <optgroup label="${escapeHtml(g.label)}">
      ${options.map((o) => `<option value="${escapeHtml(o)}" ${selected === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </optgroup>
  `;
  }).join('');
  const knownGroupLabels = CATEGORY_GROUPS.map((g) => g.label);
  const orphanCustom = customCategories.filter((c) => !knownGroupLabels.includes(c.group)).map((c) => c.name);
  const customGroup = orphanCustom.length > 0 ? `
    <optgroup label="自訂分類">
      ${orphanCustom.map((o) => `<option value="${escapeHtml(o)}" ${selected === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
    </optgroup>
  ` : '';
  return `${legacyOption}${groups}${customGroup}<option value="${CUSTOM_CATEGORY_VALUE}">＋ 自訂分類...</option>`;
}

// 自訂分類管理彈窗：上半是新增／編輯表單，下半是目前所有自訂分類的清單（可編輯、可刪除）。
// 系統預設的經典分類不會出現在這個清單裡，本來就無從刪改，天生受保護。
// 回傳 Promise，resolve 成 { name } 表示「請把選單選到這個分類」，resolve(null) 表示維持原本選擇；
// 不論哪種情況，呼叫端都要重新產生選單內容，因為分類清單在彈窗開著的期間可能被改過。
function openCustomCategoryModal() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal-card category-manager-card" role="dialog" aria-modal="true" aria-labelledby="custom-category-modal-title">
        <h3 id="custom-category-modal-title">自訂分類管理</h3>
        <label for="custom-category-name-input" id="custom-category-name-label">新分類名稱
          <input type="text" id="custom-category-name-input" placeholder="例如：卡片盒筆記術">
        </label>
        <label for="custom-category-group-select">所屬大類別
          <select id="custom-category-group-select">
            ${CATEGORY_GROUPS.map((g) => `<option value="${escapeHtml(g.label)}">${escapeHtml(g.label)}</option>`).join('')}
          </select>
        </label>
        <p class="category-manager-error" id="custom-category-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn" id="custom-category-cancel-edit-btn" hidden>取消編輯</button>
          <button type="button" class="btn btn-primary" id="custom-category-submit-btn">新增</button>
        </div>
        <div class="category-manager-divider"></div>
        <h4>已建立的自訂分類</h4>
        <ul class="category-manager-list" id="custom-category-list"></ul>
        <div class="modal-actions">
          <button type="button" class="btn" id="custom-category-close-btn">關閉</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const nameLabel = backdrop.querySelector('#custom-category-name-label');
    const nameInput = backdrop.querySelector('#custom-category-name-input');
    const groupSelect = backdrop.querySelector('#custom-category-group-select');
    const errorEl = backdrop.querySelector('#custom-category-error');
    const submitBtn = backdrop.querySelector('#custom-category-submit-btn');
    const cancelEditBtn = backdrop.querySelector('#custom-category-cancel-edit-btn');
    const listEl = backdrop.querySelector('#custom-category-list');
    nameInput.focus();

    let editingName = null; // 目前正在編輯的原始名稱；null 代表現在是新增模式
    let lastAppliedName = null; // 最近一次新增／編輯成功的名稱，關閉彈窗時要讓選單選到它

    function showError(message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    function clearError() {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }

    function enterAddMode() {
      editingName = null;
      nameLabel.firstChild.textContent = '新分類名稱';
      submitBtn.textContent = '新增';
      cancelEditBtn.hidden = true;
      nameInput.value = '';
      groupSelect.value = CATEGORY_GROUPS[0].label;
      clearError();
    }

    function enterEditMode(category) {
      editingName = category.name;
      nameLabel.firstChild.textContent = '編輯分類名稱';
      submitBtn.textContent = '更新';
      cancelEditBtn.hidden = false;
      nameInput.value = category.name;
      groupSelect.value = CATEGORY_GROUPS.some((g) => g.label === category.group) ? category.group : CATEGORY_GROUPS[0].label;
      clearError();
      nameInput.focus();
    }

    function renderList() {
      const categories = loadCustomCategories();
      listEl.innerHTML = categories.length === 0
        ? '<li class="empty">還沒有自訂分類。</li>'
        : categories.map((c) => `
          <li data-name="${escapeHtml(c.name)}">
            <span class="cm-item-name">${escapeHtml(c.name)}</span>
            <span class="cm-item-group">${escapeHtml(c.group || '未分組')}</span>
            <button type="button" class="cm-icon-btn cm-edit-btn" title="編輯「${escapeHtml(c.name)}」">✏️</button>
            <button type="button" class="cm-icon-btn cm-delete-btn" title="刪除「${escapeHtml(c.name)}」">🗑️</button>
          </li>
        `).join('');

      listEl.querySelectorAll('.cm-edit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.closest('li').dataset.name;
          const category = categories.find((c) => c.name === name);
          if (category) enterEditMode(category);
        });
      });
      listEl.querySelectorAll('.cm-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.closest('li').dataset.name;
          if (!window.confirm(`確定要刪除「${name}」分類嗎？已經套用這個分類的書籍會改回「先不分類」。`)) return;
          await removeCustomCategoryEverywhere(name);
          if (editingName === name) enterAddMode();
          if (lastAppliedName === name) lastAppliedName = null;
          renderList();
        });
      });
    }

    async function submit() {
      const name = nameInput.value.trim();
      if (!name) {
        showError('請輸入分類名稱。');
        nameInput.focus();
        return;
      }
      const group = groupSelect.value;
      const allNames = [...CATEGORY_GROUPS.flatMap((g) => g.options), ...loadCustomCategories().map((c) => c.name)];
      const isDuplicate = allNames.some((n) => n === name && n !== editingName);
      if (isDuplicate) {
        showError('這個分類名稱已經存在了。');
        return;
      }
      if (editingName) {
        await renameCustomCategoryEverywhere(editingName, name, group);
      } else {
        addCustomCategory(name, group);
      }
      lastAppliedName = name;
      enterAddMode();
      renderList();
    }

    function close() {
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      resolve(lastAppliedName ? { name: lastAppliedName } : null);
    }
    function onKeydown(event) {
      if (event.key === 'Escape') close();
      else if (event.key === 'Enter' && document.activeElement === nameInput) submit();
    }

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });
    cancelEditBtn.addEventListener('click', enterAddMode);
    submitBtn.addEventListener('click', submit);
    backdrop.querySelector('#custom-category-close-btn').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);

    renderList();
  });
}

// 選到「＋ 自訂分類...」就跳出彈窗問名稱和所屬大類別，存進個人分類清單，然後直接選中它；
// 取消或沒輸入就退回選之前的值，不會讓選單卡在這個不是真分類的選項上。
function wireCategorySelect(selectEl) {
  selectEl.dataset.prevValue = selectEl.value;
  const fileInput = selectEl.form ? selectEl.form.querySelector('#cover-file-input') : null;
  const suppressCoverFileClick = () => {
    if (fileInput) fileInput.dataset.suppressClickUntil = String(Date.now() + 600);
  };
  selectEl.addEventListener('change', async () => {
    if (selectEl.value === CUSTOM_CATEGORY_VALUE) {
      const valueBeforeModal = selectEl.dataset.prevValue;
      selectEl.value = valueBeforeModal;
      suppressCoverFileClick();
      const result = await openCustomCategoryModal();
      // 管理彈窗開著的期間，分類清單可能被新增／改名／刪除過，選單一律重新整套產生；
      // 原本選的值如果剛好是被刪掉的分類，就自動退回「先不分類」，不留一個選不到的殘影選項。
      const known = new Set([...CATEGORY_GROUPS.flatMap((g) => g.options), ...loadCustomCategories().map((c) => c.name)]);
      const nextValue = result ? result.name : (known.has(valueBeforeModal) ? valueBeforeModal : '');
      selectEl.innerHTML = `<option value="">（先不分類）</option>${categoryOptionsHtml(nextValue)}`;
      selectEl.value = nextValue;
      selectEl.dataset.prevValue = selectEl.value;
      return;
    }
    selectEl.dataset.prevValue = selectEl.value;
    suppressCoverFileClick();
  });
  selectEl.addEventListener('blur', suppressCoverFileClick);
}

// 存留狀態選「借閱」才展開圖書館借閱細節，其他狀態下藏起來，避免表單看起來欄位一堆用不到。
function wireRetentionStatusToggle(form) {
  const select = form.elements.retentionStatus;
  const fields = form.querySelector('#library-borrow-fields');
  select.addEventListener('change', () => {
    fields.hidden = select.value !== BORROWED_RETENTION_STATUS;
  });
}

function formatDateSlash(dateStr) {
  return dateStr ? dateStr.replaceAll('-', '/') : '';
}

// 細線條日曆 icon（Lucide 風格），取代原本太搶戲的格子旗 emoji，顏色跟 opacity 故意調淡，
// 讓它只是個安靜的小提示，不會比日期文字本身還顯眼。
const CALENDAR_ICON = '<svg class="badge-calendar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';

// 完成日期欄位：完成了就用綠色小標籤標出日期（視覺上一眼能認出「這本讀完了」），
// 還沒完成就顯示「—」，不再重複列一整欄閱讀狀態，把空間留給書名。
function completedDateCell(record) {
  if (record && record.endDate) {
    return `<span class="book-status-badge is-completed">${CALENDAR_ICON} ${escapeHtml(formatDateSlash(record.endDate))}</span>`;
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
  { value: 'completed-desc', label: '完成時間：新到舊' },
  { value: 'completed-asc', label: '完成時間：舊到新' },
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
  } else if (sortMode === 'completed-asc') {
    list.sort((a, b) => {
      const endA = recordMap.get(a.id)?.endDate || '';
      const endB = recordMap.get(b.id)?.endDate || '';
      if (endA && endB) return endA.localeCompare(endB);
      if (endA && !endB) return -1;
      if (!endA && endB) return 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
  } else {
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')); // created-desc（預設）
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
          <div class="toolbar-title-row">
            <h2 id="book-list-title">所有書籍</h2>
            <button type="button" class="btn year-filter-reset-btn" id="year-filter-reset-btn" hidden>✕ 顯示全部書籍</button>
          </div>
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

  const titleEl = container.querySelector('#book-list-title');
  const yearResetBtn = container.querySelector('#year-filter-reset-btn');
  const searchInput = container.querySelector('#book-search');
  const sortSelect = container.querySelector('#book-sort-select');
  const bodyEl = container.querySelector('#book-list-body');
  const countEl = container.querySelector('#book-list-count');

  // 左側「閱讀統計」的年份選單跟右側書籍列表是同一份狀態：選了年份，這裡的清單只留
  // 「該年完成日期在該年份、且狀態已讀完」的書；選回「全部年份」就整個清空篩選。
  let yearFilter = null;

  function renderList() {
    const query = searchInput.value.trim().toLowerCase();
    let base = query
      ? index.filter((entry) => entry.searchText.includes(query)).map((entry) => entry.book)
      : books;
    if (yearFilter) {
      base = base.filter((book) => {
        const record = recordMap.get(book.id);
        return record && record.status === '已讀完' && record.endDate && record.endDate.startsWith(yearFilter);
      });
    }
    const sorted = sortBooks(base, recordMap, sortSelect.value);

    if (sorted.length === 0) {
      bodyEl.innerHTML = query
        ? `<p class="empty">找不到符合「${escapeHtml(searchInput.value.trim())}」的書籍。</p>`
        : `<p class="empty">${yearFilter ? `${escapeHtml(yearFilter)} 年沒有已讀完的書籍。` : '還沒有任何書籍，點擊上方新增第一本。'}</p>`;
    } else {
      bodyEl.innerHTML = bookTableHtml(sorted, favoriteAuthors, recordMap);
    }
    countEl.textContent = sorted.length === books.length ? `共 ${books.length} 本` : `符合 ${sorted.length} 本（共 ${books.length} 本）`;

    if (yearFilter) {
      titleEl.textContent = `${yearFilter} 年已讀完書籍（共 ${sorted.length} 本）`;
      yearResetBtn.hidden = false;
    } else {
      titleEl.textContent = '所有書籍';
      yearResetBtn.hidden = true;
    }
  }

  yearResetBtn.addEventListener('click', () => {
    yearFilter = null;
    container.querySelector('#sidebar-stats-year-select').value = '';
    container.querySelector('#sidebar-stats-year-select').dispatchEvent(new Event('change'));
  });

  const favoriteAuthorsContainer = container.querySelector('#favorite-authors-container');
  await renderSidebarStats(container.querySelector('#stats-panel-container'), {
    onYearChange: (year) => {
      yearFilter = year;
      renderList();
      renderFavoriteAuthorsPanel(favoriteAuthorsContainer, year);
    },
  });
  await renderFavoriteAuthorsPanel(favoriteAuthorsContainer);
  await renderRecentActivity(container.querySelector('#home-sections-container'));

  searchInput.addEventListener('input', renderList);
  sortSelect.addEventListener('change', renderList);
  renderList();
}

function formTemplate(book, isNew, isFavoriteAuthor) {
  return `
    <form id="book-form" class="book-form" novalidate>
      <fieldset class="form-section">
        <legend>📖 書籍基本資料</legend>
        <label class="field-required field-wide" for="field-title">書名 *<input id="field-title" name="title" required value="${escapeHtml(book.title)}" placeholder="這本書叫什麼名字？"></label>
        <label for="field-author">作者
          <span class="author-input-row">
            <input id="field-author" name="author" value="${escapeHtml(book.author)}">
            <button type="button" id="author-favorite-btn" class="star-btn${isFavoriteAuthor ? ' filled' : ''}" title="標記為喜愛的作者">♥</button>
          </span>
        </label>
        <label for="field-publisher">出版社<input id="field-publisher" name="publisher" value="${escapeHtml(book.publisher)}"></label>
        <label for="field-publish-date">出版日期<input id="field-publish-date" type="date" name="publishDate" value="${escapeHtml(book.publishDate)}"></label>
        <label for="field-category">分類
          <select id="field-category" name="category">
            <option value="">（先不分類）</option>
            ${categoryOptionsHtml(book.category)}
          </select>
        </label>
        <label class="field-wide" for="cover-file-input">封面圖片（選填）
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
        <label for="field-purchase-date">購買日期<input id="field-purchase-date" type="date" name="purchaseDate" value="${escapeHtml(book.purchaseDate)}"></label>
        <label for="field-purchase-source">購買來源<input id="field-purchase-source" name="purchaseSource" value="${escapeHtml(book.purchaseSource)}"></label>
        <label for="field-purchase-price">購買價格<input id="field-purchase-price" type="number" name="purchasePrice" min="0" value="${escapeHtml(book.purchasePrice)}"></label>
        <label for="field-format">書籍形式
          <select id="field-format" name="format">
            ${FORMAT_OPTIONS.map((f) => `<option value="${escapeHtml(f)}" ${book.format === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('')}
          </select>
        </label>
        <label for="retention-status-select">存留狀態
          <select name="retentionStatus" id="retention-status-select">
            ${RETENTION_STATUS_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
          </select>
        </label>
        <div class="field-wide library-borrow-fields" id="library-borrow-fields" ${(book.retentionStatus || DEFAULT_RETENTION_STATUS) === BORROWED_RETENTION_STATUS ? '' : 'hidden'}>
          <label for="field-library-borrow-type">借閱管道
            <select id="field-library-borrow-type" name="libraryBorrowType">
              ${LIBRARY_BORROW_TYPE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}" ${book.libraryBorrowType === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </label>
          <label for="field-library-name">圖書館名稱
            <input id="field-library-name" name="libraryName" value="${escapeHtml(book.libraryName)}" placeholder="例如：市立圖書館、HyRead 電子書平台">
          </label>
        </div>
      </fieldset>

      ${isNew ? `
      <fieldset class="form-section">
        <legend>📚 我的閱讀</legend>
        <label for="field-status">閱讀狀態
          <select id="field-status" name="status">
            ${STATUS_OPTIONS.map((s) => `<option value="${escapeHtml(s)}" ${s === '尚未閱讀' ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </label>
        <label class="field-wide">閱讀動機（可複選，選填）
          <span class="tag-checkboxes motivation-tags">${MOTIVATION_TAGS.map((m) => `<label><input type="checkbox" name="motivationTags" value="${escapeHtml(m)}"> ${escapeHtml(m)}</label>`).join('')}</span>
        </label>
        <label class="field-wide" for="field-motivation-text">我現在為什麼想讀它？
          <textarea id="field-motivation-text" name="motivationText" rows="2" placeholder="低壓力，想到什麼寫什麼，不寫也沒關係"></textarea>
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
  wireCategorySelect(form.elements.category);
  wireRetentionStatusToggle(form);

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
      libraryBorrowType: data.libraryBorrowType || '',
      libraryName: (data.libraryName || '').trim(),
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
        status: data.status || '尚未閱讀',
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

// 借閱狀態才附上「（借閱管道 - 圖書館名稱）」補充說明，其他存留狀態單純顯示狀態本身。
function retentionStatusDisplay(book) {
  const status = book.retentionStatus || DEFAULT_RETENTION_STATUS;
  if (status !== BORROWED_RETENTION_STATUS) return status;
  const detail = [book.libraryBorrowType, book.libraryName].filter(Boolean).join(' - ');
  return detail ? `${status}（${detail}）` : status;
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
            ${detailRow('存留狀態', retentionStatusDisplay(book))}
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
