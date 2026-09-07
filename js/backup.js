import { DB } from './db.js';
import { escapeHtml } from './utils.js';
import { wireNotionImportButton } from './notionImport.js';

// 對照 PROJECT_SPEC.md 第 9 節：本地儲存為主，必須支援匯出／匯入／備份，避免資料遺失。
const STORE_LABELS = {
  books: '書籍',
  reading_records: '閱讀紀錄',
  outputs: '閱讀輸出',
  notes: '快速筆記',
  groups: '圖譜群組',
  nodes: '圖譜節點',
  edges: '圖譜關係',
  favorite_authors: '喜愛作者',
  quotes: '佳句摘錄',
  wishlist: '願望清單',
};

// 「資料管理」頁面精簡：使用者反映 WebDAV 雲端同步設定、雲端同步手動檢查、
// 持久化儲存狀態提示、跟「全站匯出」重複的「個人數據備份」四塊太複雜、
// 彼此功能重疊，要求整頁砍成三個區塊——目前數據總覽／全站 JSON 備份與
// 還原／外部匯入（Notion CSV）。WebDAV 背景自動同步（bootstrap-extensions.js
// 的 initWebDavAutoSync()）跟持久化儲存自動請求（initStoragePersistence()）
// 本身不受影響，繼續在背景運作，只是這個頁面不再顯示設定介面／狀態小工具——
// renderWebDavSettingsPanel()／renderPersistenceStatusWidget() 這兩個只給
// 這個頁面用的 UI 函式，連同只服務它們的輔助函式，已經從各自的服務檔案裡
// 一併刪除，不留死碼；WebDavSyncService／trackLocalChanges／
// isStoragePersisted／requestPersistentStorage 這些背景服務仍在使用，
// 沒有被動到。
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
    <div class="backup-page">
      <div class="toolbar">
        <a href="#/books">← 回書籍列表</a>
        <h2>資料管理</h2>
      </div>

      <div class="graph-panel">
        <h4>目前數據總覽</h4>
        <ul class="stat-category-list">
          ${DB.STORE_NAMES.map((name) => `<li><span>${escapeHtml(STORE_LABELS[name] || name)}</span><span>${counts[name]} 筆</span></li>`).join('')}
        </ul>
      </div>

      <div class="graph-panel">
        <h4>全站 JSON 備份與還原</h4>
        <p class="graph-hint">匯出包含全站資料（書籍、閱讀紀錄、筆記、佳句、圖譜等）的單一 JSON 檔案，建議定期備份；還原時選擇之前匯出的檔案即可。<strong>還原會覆蓋目前所有資料</strong>，建議先匯出一份備份再還原。</p>
        <button type="button" class="btn btn-primary" id="export-btn">匯出 JSON 備份檔</button>
        <div class="backup-restore-row">
          <input type="file" id="import-file" accept="application/json">
          <button type="button" class="btn" id="import-btn">上傳並還原</button>
        </div>
        <p id="import-status" class="graph-hint"></p>
      </div>

      <div class="graph-panel">
        <h4>外部匯入</h4>
        <p class="graph-hint">從 Notion 匯出閱讀紀錄的 CSV 檔案，對照欄位後可以直接併入現有書庫。書名跟現有書籍重複的資料列會自動略過，不會產生重複書籍。</p>
        <button type="button" class="btn btn-primary" id="notion-import-btn">匯入 Notion 資料 (CSV)</button>
        <p id="notion-import-status" class="graph-hint"></p>
      </div>
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
  const importBtn = container.querySelector('#import-btn');
  const statusEl = container.querySelector('#import-status');

  importBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) {
      statusEl.textContent = '請先選擇要還原的 JSON 檔案。';
      return;
    }
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
      const confirmed = window.confirm(`確定要還原嗎？這會覆蓋目前所有資料。\n\n匯入檔案內容：${importSummary}`);
      if (!confirmed) {
        statusEl.textContent = '已取消還原，沒有變更任何資料。';
        fileInput.value = '';
        return;
      }
      await importAllData(parsed.data);
      fileInput.value = '';
      // renderBackupPage 會整個重繪這個 container（含 statusEl 自己），要重繪完再設訊息，
      // 不然訊息會被自己的重繪立刻蓋掉，使用者只會看到空白。
      await renderBackupPage(container);
      container.querySelector('#import-status').textContent = '還原完成，資料已更新。';
    } catch (err) {
      statusEl.textContent = `匯入失敗，沒有變更任何資料：檔案不是有效的 JSON（${err.message}）`;
      fileInput.value = '';
    }
  });

  wireNotionImportButton(
    container.querySelector('#notion-import-btn'),
    container.querySelector('#notion-import-status'),
    async (message) => {
      await renderBackupPage(container);
      container.querySelector('#notion-import-status').textContent = message;
    },
  );
}
