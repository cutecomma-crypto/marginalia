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

// 每張表裡「指向別的表」的外鍵欄位，跟它實際指向哪一張表——還原時要用
// 這份對照表，把備份檔裡的舊 id 換成這次重新寫入後拿到的新 id（見下面
// importAllData 的完整說明）。
const FOREIGN_KEY_FIELDS = {
  reading_records: { bookId: 'books' },
  outputs: { bookId: 'books' },
  notes: { bookId: 'books' },
  groups: { bookId: 'books' },
  nodes: { bookId: 'books', groupId: 'groups' },
  edges: { bookId: 'books', fromNodeId: 'nodes', toNodeId: 'nodes' },
  quotes: { bookId: 'books' },
};

// 這裡原本是 DB.clear() 全部清空之後，逐筆呼叫 DB.update(storeName, record)
// 把備份檔案裡的資料「原封不動」（含原本的 id）寫回去——這在本機模式（登出
// 狀態，DB 指向 LocalDB）沒有問題：LocalDB.update() 底層用 IndexedDB 的
// put()，put() 對「這個 id 目前不存在」的情況一樣會直接新增一筆，等同
// upsert。
//
// 但登入雲端帳號時（DB 指向 CloudDB），update() 對應的是 Postgres 的
// UPDATE ... WHERE id = X：如果 id 為 X 的那一列根本不存在（剛清空的資料庫
// 本來就没有任何一列），這條 UPDATE 會「成功執行、但完全沒有任何一列被
// 改到」——Supabase 不會回傳錯誤，因為語法上這確實是一次合法、只是碰巧
// 沒有東西可以更新的 UPDATE。程式碼原本沒有檢查「這次到底真的改到幾
// 列」，只要沒有 error 就當作成功，於是出現「畫面上顯示還原完成、資料
// 也在瀏覽器本機快取裡看得到（因為寫快取那一步是各自獨立執行、不看
// UPDATE 有沒有真的生效），但其實一筆都没有真正寫進 Supabase」的靜默
// 失敗——這正是使用者實測回報「還原後書籍一度看得到、但重新整理幾次
// 之後全部消失」的真正成因：背景快取刷新真正去問 Supabase 時，问到的
// 是「其實從頭到尾都是空的」，用這個真相蓋掉了本機快取裡那份從未真正
// 生效的內容。
//
// 修法是全面改用 DB.add()（永遠是真正的 INSERT，不會有「目標列不存在」
// 這種問題），但這樣一來，備份檔案裡記錄的舊 id（例如某筆閱讀紀錄的
// bookId: 42）就對不上重新 INSERT 後、資料庫／IndexedDB 重新指派的新 id
// 了——這跟 cloudMigration.js 的 migrateLocalToCloud() 处理「本機資料
// 搬去雲端」時面對的是同一個問題，這裡採用同一套解法：依照
// DB.STORE_NAMES 既有的順序（books 一定排在 reading_records／groups
// 等等引用它的表之前，groups 排在 nodes 之前，nodes 排在 edges 之前，
// 順序本身已經天生符合外鍵相依性，不用另外重新排序），一邊寫入一邊用
// idMap 記住「這張表裡，舊 id 對應到新 id 是多少」，輪到有外鍵欄位
// （見上面 FOREIGN_KEY_FIELDS）的表時，先把欄位值換成已經記錄好的新
// id，再寫入。
async function importAllData(data) {
  for (const storeName of DB.STORE_NAMES) {
    await DB.clear(storeName);
  }
  const idMap = {};
  for (const storeName of DB.STORE_NAMES) idMap[storeName] = new Map();

  for (const storeName of DB.STORE_NAMES) {
    const fkFields = FOREIGN_KEY_FIELDS[storeName];
    for (const record of data[storeName] || []) {
      const { id: oldId, ...rest } = record;
      if (fkFields) {
        for (const [field, targetStore] of Object.entries(fkFields)) {
          const oldValue = rest[field];
          if (oldValue != null && idMap[targetStore].has(oldValue)) {
            rest[field] = idMap[targetStore].get(oldValue);
          }
        }
      }
      const newId = await DB.add(storeName, rest);
      if (oldId != null) idMap[storeName].set(oldId, newId);
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
      // importAllData() 現在改成逐筆真正呼叫 DB.add()（見該函式的完整說明），
      // 登入雲端帳號時每一筆都是一次真正的網路請求，資料量大（例如這裡
      // 一次 300 多本書＋等量的閱讀紀錄）加起來可能要等上一兩分鐘，不是
      // 以前那種幾乎瞬間完成的本機寫入——先讓按鈕呈現「還原中」、鎖住不能
      // 再按第二次，使用者才不會誤以為卡住而重複點擊，實際上是正常在跑。
      importBtn.disabled = true;
      statusEl.textContent = '還原中，資料量較大時可能需要一兩分鐘，請耐心等候……';
      await importAllData(parsed.data);
      fileInput.value = '';
      // renderBackupPage 會整個重繪這個 container（含 statusEl 自己），要重繪完再設訊息，
      // 不然訊息會被自己的重繪立刻蓋掉，使用者只會看到空白。
      await renderBackupPage(container);
      container.querySelector('#import-status').textContent = '還原完成，資料已更新。';
    } catch (err) {
      // importAllData() 現在會真的丟出網路／資料庫層級的例外（不只是 JSON
      // 格式錯誤），錯誤訊息改成不預設是哪一種問題，直接印出實際的錯誤內容，
      // 使用者才看得出來到底是什麼原因、能不能重試。
      statusEl.textContent = `還原失敗：${err.message || String(err)}（部分資料可能已寫入，建議重新整理頁面確認目前狀態後再試一次）`;
      importBtn.disabled = false;
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
