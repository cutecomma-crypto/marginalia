import { DB } from './db.js';
import { escapeHtml } from './utils.js';
import { wireNotionImportButton } from './notionImport.js';
import { renderPersistenceStatusWidget } from './services/storagePersistenceService.js';
import { WebDavSyncService, renderWebDavSettingsPanel } from './services/webdavSyncService.js';

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
  wishlist: '願望清單',
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
      <h4>持久化儲存</h4>
      <p class="graph-hint">請求瀏覽器不要在裝置儲存空間吃緊時清掉這個網站的資料，降低跨裝置／長期使用下資料被瀏覽器自動清除的風險。</p>
      <div id="persistence-widget-container"></div>
    </div>

    <div class="graph-panel">
      <h4>WebDAV 雲端同步</h4>
      <p class="graph-hint">填入你自己的 WebDAV 伺服器資訊（例如 Nextcloud），把整份資料同步到雲端，多台裝置間互相比對時間戳記、新的一份會覆蓋舊的一份。同步內容不會經過任何第三方伺服器，只在你的裝置與你自己的 WebDAV 之間傳輸。</p>
      <div id="webdav-settings-container"></div>
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

    <div class="graph-panel">
      <h4>匯入 Notion 資料</h4>
      <p class="graph-hint">從 Notion 匯出閱讀紀錄的 CSV 檔案，對照欄位後可以直接併入現有書庫。書名跟現有書籍重複的資料列會自動略過，不會產生重複書籍。</p>
      <button type="button" class="btn btn-primary" id="notion-import-btn">匯入 Notion 資料 (CSV)</button>
      <p id="notion-import-status" class="graph-hint"></p>
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
      fileInput.value = '';
      // renderBackupPage 會整個重繪這個 container（含 statusEl 自己），要重繪完再設訊息，
      // 不然訊息會被自己的重繪立刻蓋掉，使用者只會看到空白。
      await renderBackupPage(container);
      container.querySelector('#import-status').textContent = '匯入完成，資料已還原。';
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

  await renderPersistenceStatusWidget(container.querySelector('#persistence-widget-container'));
  renderWebDavSettingsPanel(
    container.querySelector('#webdav-settings-container'),
    new WebDavSyncService(),
    { gatherLocalData: gatherAllData, applyRemoteData: importAllData },
  );
}
