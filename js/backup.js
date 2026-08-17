import { DB } from './db.js';
import { escapeHtml } from './utils.js';

// 對照 PROJECT_SPEC.md 第 9 節：本地儲存為主，必須支援匯出／匯入／備份，避免資料遺失。
const STORE_LABELS = {
  books: '書籍',
  reading_records: '閱讀紀錄',
  outputs: '閱讀輸出',
  notes: '快速筆記',
  nodes: '圖譜節點',
  edges: '圖譜關係',
  favorite_authors: '喜愛作者',
  quotes: '佳句摘錄',
};

async function gatherAllData() {
  const data = {};
  for (const storeName of DB.STORE_NAMES) {
    data[storeName] = await DB.getAll(storeName);
  }
  return data;
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 匯入前先驗證檔案格式，失敗就直接中止，不動任何現有資料。
// 舊版備份檔可能沒有後來才新增的資料表（例如 quotes），缺少的欄位當作空陣列看待，
// 不能整個判定成格式錯誤，不然功能一直加新資料表，舊備份檔就會慢慢全部匯入不了。
function validateImportShape(parsed) {
  if (!parsed || typeof parsed !== 'object') return '檔案內容不是有效的 JSON 物件。';
  if (!parsed.data || typeof parsed.data !== 'object') return '找不到 data 欄位，這可能不是本工具匯出的備份檔。';
  for (const storeName of DB.STORE_NAMES) {
    const value = parsed.data[storeName];
    if (value !== undefined && !Array.isArray(value)) {
      return `data.${storeName} 不是陣列，檔案格式不正確。`;
    }
  }
  return null;
}

async function importAllData(data) {
  for (const storeName of DB.STORE_NAMES) {
    await DB.clear(storeName);
  }
  for (const storeName of DB.STORE_NAMES) {
    for (const record of data[storeName] || []) {
      await DB.update(storeName, record);
    }
  }
}

export async function renderBackupPage(container) {
  const counts = {};
  for (const storeName of DB.STORE_NAMES) {
    counts[storeName] = (await DB.getAll(storeName)).length;
  }

  container.innerHTML = `
    <div class="toolbar">
      <a href="#/books">← 回書籍列表</a>
      <h2>資料管理</h2>
    </div>

    <div class="graph-panel">
      <h4>目前資料</h4>
      <ul class="stat-category-list">
        ${DB.STORE_NAMES.map((name) => `<li><span>${escapeHtml(STORE_LABELS[name] || name)}</span><span>${counts[name]} 筆</span></li>`).join('')}
      </ul>
    </div>

    <div class="graph-panel">
      <h4>匯出資料</h4>
      <p class="graph-hint">把目前所有資料打包成一個 JSON 檔案，下載到你的電腦。建議定期備份。</p>
      <button type="button" class="btn btn-primary" id="export-btn">匯出成 JSON 檔案</button>
    </div>

    <div class="graph-panel">
      <h4>匯入資料</h4>
      <p class="graph-hint">選擇之前匯出的 JSON 檔案還原資料。<strong>匯入會覆蓋目前所有資料</strong>，建議先匯出備份再匯入。</p>
      <input type="file" id="import-file" accept="application/json">
      <p id="import-status" class="graph-hint"></p>
    </div>
  `;

  container.querySelector('#export-btn').addEventListener('click', async () => {
    const data = await gatherAllData();
    const payload = {
      app: 'Marginalia',
      exportedAt: new Date().toISOString(),
      version: 1,
      data,
    };
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(payload, `marginalia-backup-${date}.json`);
  });

  const fileInput = container.querySelector('#import-file');
  const statusEl = container.querySelector('#import-status');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    statusEl.textContent = '讀取中…';
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const error = validateImportShape(parsed);
      if (error) {
        statusEl.textContent = `匯入失敗，沒有變更任何資料：${error}`;
        fileInput.value = '';
        return;
      }
      const importSummary = DB.STORE_NAMES
        .map((name) => `${STORE_LABELS[name] || name} ${(parsed.data[name] || []).length} 筆`)
        .join('、');
      const confirmed = window.confirm(`確定要匯入嗎？這會覆蓋目前所有資料。\n\n匯入檔案內容：${importSummary}`);
      if (!confirmed) {
        statusEl.textContent = '已取消匯入，沒有變更任何資料。';
        fileInput.value = '';
        return;
      }
      await importAllData(parsed.data);
      statusEl.textContent = '匯入完成，資料已還原。';
      fileInput.value = '';
      await renderBackupPage(container);
    } catch (err) {
      statusEl.textContent = `匯入失敗，沒有變更任何資料：檔案不是有效的 JSON（${err.message}）`;
      fileInput.value = '';
    }
  });
}
