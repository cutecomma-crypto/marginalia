import { DB } from './db.js';
import { escapeHtml } from './utils.js';
import { ICON_EDIT, ICON_DELETE } from './icons.js';
import { getCurrentUser } from './services/authService.js';
import { getSupabaseClient } from './services/supabaseClient.js';

// 對照 PROJECT_SPEC.md 第 1 節。「書籍類型」是固定選項＋可自訂的單選分類。
//
// 每個大類別內部的子選項依「字數長度」由少到多排序，同字數維持原本寫在陣列裡的
// 相對順序（stable sort）——短名稱先出現，掃選單時比較好找。「文學小說」裡的
// 「耽美」是唯一例外：不管字數多短，一律強制排在該大類別最下面，這條規則跟字數
// 排序無關，所以獨立用 pinnedToEnd 表示，不是塞進字數排序的比較函式裡搞特殊判斷。
//
// 下面 RAW_CATEGORY_GROUPS 維持人類好讀的原始寫法（不用自己手動算字數排序），
// 實際匯出給選單使用的 CATEGORY_GROUPS 是排序過的版本，兩者靠 sortCategoryOptions()
// 這個純函式連起來——以後新增分類只要照原本順序加進 RAW 清單，排序自動算好，
// 不用每次手動重新排一次陣列、也不會漏算或算錯字數。
function sortCategoryOptions(options, pinnedToEnd = []) {
  const pinnedSet = new Set(pinnedToEnd);
  const sorted = options
    .filter((name) => !pinnedSet.has(name))
    .map((name, index) => ({ name, index }))
    .sort((a, b) => a.name.length - b.name.length || a.index - b.index)
    .map((entry) => entry.name);
  return [...sorted, ...pinnedToEnd.filter((name) => options.includes(name))];
}

// 使用者提供的既有藏書分類清單（用來一次補齊系統預設選單，見這個常數旁的
// 呼叫端說明）——只新增選單選項，完全不動 DB.STORE_NAMES 或任何書籍記錄，
// 跟 LEGACY_CATEGORY_RENAMES（那個才是真的會改寫既有書籍資料）是兩件事。
const RAW_CATEGORY_GROUPS = [
  { label: '文學小說', options: ['中文文學', '歐美文學', '日本文學', '韓國文學', '科幻小說', '懸疑推理小說', '大眾文學', '輕小說', '言情小說', '耽美'], pinnedToEnd: ['耽美'] },
  { label: '商業理財', options: ['職場工作術', '生產力/筆記術', '投資理財', '企業管理', '經濟趨勢', '時間管理'] },
  { label: '心理勵志', options: ['心理學理論', '自我提升', '人際關係', '心靈雞湯', '生涯規劃', '情緒管理', '心理輔導與諮商', '家庭親子關係'] },
  { label: '人文社會', options: ['歷史', '哲學理論', '人物傳記', '社會科學', '自然科普', '旅行文學'] },
  { label: '生活應用/工具', options: ['學習法/思考術', '電腦資訊', '語言學習', '生活風格'] },
  { label: '藝術設計', options: ['美術設計', '電影表演', '音樂建築', '藝術介紹'] },
  { label: '醫療保健', options: ['醫療保健', '生死醫病'] },
  { label: '宗教命理', options: ['宗教命理'] },
];

export const CATEGORY_GROUPS = RAW_CATEGORY_GROUPS.map((g) => ({
  label: g.label,
  options: sortCategoryOptions(g.options, g.pinnedToEnd || []),
}));

// 系統預設分類改名時，既有書籍資料庫裡存的還是舊名稱字串，不會自動跟著變——
// 這裡列出「舊名稱 → 新名稱」對照表，每次程式啟動時（見 bootstrap-extensions.js
// 的 initCategoryMigration()）掃一次全部書籍，把還停留在舊名稱的資料悄悄更新成
// 新名稱。之後如果還有其他分類要改名，在這個表多加一行就好，不用再寫一次遷移邏輯。
const LEGACY_CATEGORY_RENAMES = {
  驚悚小說: '懸疑推理小說',
};

export async function migrateLegacyCategoryNames() {
  if (Object.keys(LEGACY_CATEGORY_RENAMES).length === 0) return;
  const books = await DB.getAll('books');
  for (const book of books) {
    const newName = LEGACY_CATEGORY_RENAMES[book.category];
    if (newName) {
      await DB.update('books', { ...book, category: newName });
    }
  }
}
export const CUSTOM_CATEGORY_VALUE = '__custom__';
const CUSTOM_CATEGORY_STORAGE_KEY = 'marginalia:customCategories';

// 使用者自己新增的分類，登出狀態存 localStorage（跟 graph.js 的狀態標籤預設清單
// 同一套做法）；登入狀態則存 Supabase 的 categories 表，但 loadCustomCategories／
// saveCustomCategories 呼叫端到處都是同步呼叫（categoryOptionsHtml() 組表單 HTML
// 本身是同步的），沒辦法直接把這兩個函式改成 async——所以登入時改用「記憶體快取」：
// 登入成功當下由 authUI.js 呼叫 loadCloudCategoriesIntoCache() 把雲端資料整批抓
// 進 cloudCategoriesCache 一次，之後 loadCustomCategories() 都是同步讀這個快取；
// saveCustomCategories() 寫入時同步更新快取、非同步（fire-and-forget）把整份清單
// 覆寫回 Supabase，呼叫端完全不用等、不用改成 await。
let cloudCategoriesCache = null;

export async function loadCloudCategoriesIntoCache() {
  const supabase = await getSupabaseClient();
  const user = getCurrentUser();
  if (!supabase || !user) {
    cloudCategoriesCache = [];
    return;
  }
  const { data, error } = await supabase.from('categories').select('name, "group"').eq('user_id', user.id);
  cloudCategoriesCache = error ? [] : data.map((row) => ({ name: row.name, group: row.group || '' }));
}

export function clearCloudCategoriesCache() {
  cloudCategoriesCache = null;
}

// 整份覆寫（先清空使用者名下所有分類、再整批插入目前清單）比逐筆比對新增/刪除
// 簡單很多，自訂分類數量通常很少（十幾筆），不會是效能問題；先刪後插也不用
// 額外處理「改名」是刪除舊列還是更新舊列的判斷。
async function syncCloudCategories(list) {
  const supabase = await getSupabaseClient();
  const user = getCurrentUser();
  if (!supabase || !user) return;
  await supabase.from('categories').delete().eq('user_id', user.id);
  if (list.length > 0) {
    await supabase.from('categories').insert(list.map((c) => ({ user_id: user.id, name: c.name, group: c.group || '' })));
  }
}

// 每筆記錄現在存 { name, group }，才能知道要插進哪個大類別；改版前存的純字串陣列
// 一樣要讀得出來（視為沒有所屬大類別，退回最底部的「自訂分類」區塊）。
function loadCustomCategories() {
  if (getCurrentUser()) return cloudCategoriesCache || [];
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
  if (getCurrentUser()) {
    cloudCategoriesCache = list;
    syncCloudCategories(list);
    return;
  }
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

// 舊資料若存了不在新清單裡的分類（例如改版前的「小說／文學」），
// 不能讓它悄悄消失或被換掉，先當作暫時選項顯示，使用者自己決定要不要換成新分類。
// 使用者自訂的分類會依照建立時選的大類別，插進對應 optgroup 的最後面；
// 沒有選大類別的舊資料（改版前存的純字串）才會退回最底部的「自訂分類」區塊。
export function categoryOptionsHtml(selected) {
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
            <button type="button" class="cm-icon-btn cm-edit-btn" title="編輯「${escapeHtml(c.name)}」">${ICON_EDIT}</button>
            <button type="button" class="cm-icon-btn cm-delete-btn" title="刪除「${escapeHtml(c.name)}」">${ICON_DELETE}</button>
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
export function wireCategorySelect(selectEl) {
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
