import { initPasswordToggles } from '../utils.js';

// 獨立、可插拔模組：WebDAV 雲端同步。
//
// 設計上刻意用「依賴注入」而不是直接 import db.js——這個檔案完全不認識
// Marginalia 實際的資料表長什麼樣子，呼叫端（見檔案最後的整合說明）自己傳入
// gatherLocalData／applyRemoteData 這兩個函式，這個服務只負責「跟遠端比時間戳記、
// 决定要推送還是拉取」。這樣設計的好處：這個檔案可以整個刪掉、整個換掉實作，
// 都不會動到 db.js 或任何頁面元件一行程式碼。
//
// 同步策略是「整份快照＋時間戳記比大小」（不是逐筆欄位合併）：本地跟遠端的
// exportedAt 誰比較新，就用那一份的完整內容覆蓋另一份。這是刻意的取捨——真正的
// 逐筆合併需要幫每一筆資料額外記錄修改時間、處理刪除墓碑、處理欄位級衝突，
// 複雜度是完全不同量級的系統；對「單人使用、頂多兩三台裝置」的個人工具來說，
// 「整份比時間、新的贏」已經足夠實用，也不會讓資料在合併過程中用使用者猜不到的
// 方式被打散重組。

const CONFIG_STORAGE_KEY = 'marginalia_webdav_config';
const LAST_SYNC_STORAGE_KEY = 'marginalia_webdav_last_sync_at';
const LOCAL_DIRTY_AT_KEY = 'marginalia_local_dirty_at';
const REMOTE_FILE_NAME = 'marginalia-sync.json';

function toBasicAuthHeader(username, password) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function buildFileUrl(baseUrl) {
  const trimmed = (baseUrl || '').replace(/\/+$/, '');
  return `${trimmed}/${REMOTE_FILE_NAME}`;
}

export class WebDavSyncService {
  constructor() {
    this.config = this.loadConfig();
    this.autoSyncTimer = null;
  }

  loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveConfig(config) {
    this.config = config;
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }

  clearConfig() {
    this.config = null;
    localStorage.removeItem(CONFIG_STORAGE_KEY);
  }

  isConfigured() {
    return !!(this.config && this.config.url && this.config.username);
  }

  getLastSyncAt() {
    return localStorage.getItem(LAST_SYNC_STORAGE_KEY);
  }

  setLastSyncAt(iso) {
    localStorage.setItem(LAST_SYNC_STORAGE_KEY, iso);
  }

  // 本機資料「最後一次被改動」的時間戳記，由 trackLocalChanges() 掛在 DB 讀寫方法上
  // 自動維護，這裡單純負責讀。沒有掛過 trackLocalChanges 的話會一直是 null，
  // sync() 會把這種情況當成「本機沒有新變動」處理（見下面 sync() 的註解）。
  getLocalDirtyAt() {
    return localStorage.getItem(LOCAL_DIRTY_AT_KEY);
  }

  authHeaders() {
    if (!this.config) throw new Error('WebDAV 尚未設定');
    return { Authorization: toBasicAuthHeader(this.config.username, this.config.password || '') };
  }

  async testConnection() {
    if (!this.isConfigured()) return { ok: false, message: '尚未設定 WebDAV 連線資訊。' };
    try {
      const response = await fetch(buildFileUrl(this.config.url), {
        method: 'HEAD',
        headers: this.authHeaders(),
      });
      // 404 表示遠端還沒有同步過的檔案（正常情況，第一次同步前都會這樣），
      // 跟 2xx 一樣都算連線成功；401/403 才是帳密錯誤，其餘視為伺服器端錯誤。
      if (response.ok || response.status === 404) {
        return { ok: true, message: '連線成功。' };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: '帳號或密碼錯誤。' };
      }
      return { ok: false, message: `伺服器回應錯誤（HTTP ${response.status}）。` };
    } catch (err) {
      return { ok: false, message: `無法連線：${err.message}（可能是伺服器未開放跨網域存取 CORS）。` };
    }
  }

  async pullSnapshot() {
    const response = await fetch(buildFileUrl(this.config.url), {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`下載遠端備份失敗（HTTP ${response.status}）`);
    return response.json();
  }

  async pushSnapshot(payload) {
    const response = await fetch(buildFileUrl(this.config.url), {
      method: 'PUT',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`上傳備份失敗（HTTP ${response.status}）`);
  }

  // gatherLocalData()：呼叫端提供，回傳 { storeName: [...] } 這種形狀的完整本機資料。
  // applyRemoteData(data)：呼叫端提供，把同樣形狀的資料寫回本機（例如清空後逐筆匯入）。
  // localExportedAt：本機資料「目前」的代表時間戳記，呼叫端自己決定怎麼算
  // （最簡單的做法是直接傳 getLocalDirtyAt() 讀到的值，或呼叫當下的 now）。
  async sync({ gatherLocalData, applyRemoteData, localExportedAt }) {
    if (!this.isConfigured()) throw new Error('WebDAV 尚未設定');
    const remote = await this.pullSnapshot();
    const effectiveLocalAt = localExportedAt || this.getLocalDirtyAt() || new Date(0).toISOString();

    if (!remote) {
      const payload = { app: 'Marginalia', exportedAt: effectiveLocalAt, version: 1, data: await gatherLocalData() };
      await this.pushSnapshot(payload);
      this.setLastSyncAt(new Date().toISOString());
      return { direction: 'push', reason: '遠端尚無備份，已上傳目前資料。' };
    }

    const remoteTime = remote.exportedAt ? new Date(remote.exportedAt).getTime() : 0;
    const localTime = effectiveLocalAt ? new Date(effectiveLocalAt).getTime() : 0;

    if (remoteTime > localTime) {
      await applyRemoteData(remote.data);
      this.setLastSyncAt(new Date().toISOString());
      return { direction: 'pull', reason: '遠端資料較新，已套用到本機。' };
    }
    if (localTime > remoteTime) {
      const payload = { app: 'Marginalia', exportedAt: effectiveLocalAt, version: 1, data: await gatherLocalData() };
      await this.pushSnapshot(payload);
      this.setLastSyncAt(new Date().toISOString());
      return { direction: 'push', reason: '本機資料較新，已上傳到遠端。' };
    }
    this.setLastSyncAt(new Date().toISOString());
    return { direction: 'none', reason: '本機與遠端資料時間相同，不需要同步。' };
  }

  startAutoSync(syncFn, intervalMs = 5 * 60 * 1000) {
    this.stopAutoSync();
    this.autoSyncTimer = setInterval(() => {
      syncFn().catch((err) => console.warn('[WebDavSyncService] 背景自動同步失敗：', err.message));
    }, intervalMs);
  }

  stopAutoSync() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
  }
}

// 非侵入式追蹤本機變動時間：從外部「包一層」DB 物件的 add/update/remove/removeByIndex，
// 不需要改 db.js 原始碼一行字。呼叫端只要在啟動時呼叫一次 trackLocalChanges(DB)
// （DB 就是 import { DB } from '../db.js' 那個物件），之後任何地方呼叫 DB.add(...) 等等，
// 都會順便更新 localStorage 裡的「本機最後變動時間」，供 sync() 判斷新舊用。
export function trackLocalChanges(DB) {
  const methodsToTrack = ['add', 'update', 'remove', 'removeByIndex', 'clear'];
  const touch = () => localStorage.setItem(LOCAL_DIRTY_AT_KEY, new Date().toISOString());
  methodsToTrack.forEach((methodName) => {
    const original = DB[methodName];
    if (typeof original !== 'function' || original.__marginaliaTracked) return;
    const wrapped = async (...args) => {
      const result = await original.apply(DB, args);
      touch();
      return result;
    };
    wrapped.__marginaliaTracked = true;
    DB[methodName] = wrapped;
  });
}

// 可直接掛進「資料管理」頁面的設定＋操作面板。跟 WebDavSyncService 的核心邏輯分開，
// 純粹是選用的 UI 層——不想用這個現成介面的話，直接呼叫上面的 class 方法自己刻畫面即可。
export function renderWebDavSettingsPanel(container, service, { gatherLocalData, applyRemoteData }) {
  const config = service.config || { url: '', username: '', password: '' };
  const lastSync = service.getLastSyncAt();

  container.innerHTML = `
    <div class="webdav-settings">
      <label>WebDAV 網址
        <input type="url" id="webdav-url" value="${config.url || ''}" placeholder="https://example.com/remote.php/dav/files/USERNAME/">
      </label>
      <label>帳號
        <input type="text" id="webdav-username" value="${config.username || ''}" autocomplete="username">
      </label>
      <label>密碼
        <div class="password-field">
          <input type="password" id="webdav-password" value="${config.password || ''}" autocomplete="current-password">
          <button type="button" class="password-toggle-btn" data-target="webdav-password" aria-label="顯示密碼">👁️</button>
        </div>
      </label>
      <div class="form-actions">
        <button type="button" id="webdav-save-btn" class="btn btn-primary">儲存設定</button>
        <button type="button" id="webdav-test-btn" class="btn">測試連線</button>
        <button type="button" id="webdav-sync-btn" class="btn">立即同步</button>
      </div>
      <p class="graph-hint">${lastSync ? `上次同步：${new Date(lastSync).toLocaleString('zh-TW')}` : '尚未同步過。'}</p>
      <p id="webdav-status" class="graph-hint"></p>
    </div>
  `;

  initPasswordToggles(container);

  const statusEl = container.querySelector('#webdav-status');

  container.querySelector('#webdav-save-btn').addEventListener('click', () => {
    service.saveConfig({
      url: container.querySelector('#webdav-url').value.trim(),
      username: container.querySelector('#webdav-username').value.trim(),
      password: container.querySelector('#webdav-password').value,
    });
    statusEl.textContent = '設定已儲存。';
  });

  container.querySelector('#webdav-test-btn').addEventListener('click', async () => {
    statusEl.textContent = '測試連線中…';
    const result = await service.testConnection();
    statusEl.textContent = result.message;
  });

  container.querySelector('#webdav-sync-btn').addEventListener('click', async () => {
    statusEl.textContent = '同步中…';
    try {
      const result = await service.sync({ gatherLocalData, applyRemoteData });
      statusEl.textContent = result.reason;
      await renderWebDavSettingsPanel(container, service, { gatherLocalData, applyRemoteData });
      container.querySelector('#webdav-status').textContent = result.reason;
    } catch (err) {
      statusEl.textContent = `同步失敗：${err.message}`;
    }
  });
}
