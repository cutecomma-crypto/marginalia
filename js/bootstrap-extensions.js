// 新模組的「總開關」。這個檔案是唯一需要在 index.html 多加一行 <script> 才會生效的東西——
// 目的是讓 app.js（既有的路由主程式）完全不用被修改一行字，所有全域性質的新行為
// 都集中在這裡用一次性的方式安裝好。
//
// 每個功能都拆成獨立、可個別開關的 init 函式，故意不在檔案載入時全部一起執行——
// 逐一驗證每個模組時，只啟用「這次要測的那一個」，其餘維持關閉，才不會一次引入
// 好幾個新行為，測試時分不清楚是哪一個造成的。目前只有 initKeyboardShortcuts()
// 被實際呼叫；其餘等對應模組個別驗證完，再把呼叫加回最下面的啟用清單。
//
// 頁面專屬的功能（Markdown 匯出按鈕、選取工具列、WebDAV 設定面板…）因為需要插進
// 特定頁面的 DOM 容器，沒辦法在這裡「全域」處理，那些照整合指南分別加進對應頁面模組。

import { DB } from './db.js';
import { requestPersistentStorage, isStoragePersisted } from './services/storagePersistenceService.js';
import { installGlobalShortcuts } from './services/keyboardShortcutsService.js';
import { WebDavSyncService, trackLocalChanges } from './services/webdavSyncService.js';
import { startAutoLocalBackup } from './services/localBackupService.js';

export async function gatherAllData() {
  const data = {};
  for (const storeName of DB.STORE_NAMES) {
    data[storeName] = await DB.getAll(storeName);
  }
  return data;
}

export async function applyRemoteData(data) {
  for (const storeName of DB.STORE_NAMES) {
    await DB.clear(storeName);
  }
  for (const storeName of DB.STORE_NAMES) {
    for (const record of data[storeName] || []) {
      await DB.update(storeName, record);
    }
  }
}

// §5：全域鍵盤快捷鍵。Cmd/Ctrl+F 聚焦搜尋框；Esc 交給目前開著的 Modal／Drawer
// （用 pushEscapeHandler 註冊過的那些）處理，沒有任何東西註冊過的話就什麼也不做，
// 不影響瀏覽器原生的 Esc 行為（例如退出全螢幕）。
export function initKeyboardShortcuts() {
  installGlobalShortcuts({ searchInputSelector: '#book-search, #quote-search' });
}

// §1a：持久化儲存。第一次造訪且瀏覽器支援時主動問一次；已經問過就不會每次重複跳出。
export async function initStoragePersistence() {
  const alreadyPersisted = await isStoragePersisted();
  if (!alreadyPersisted) {
    await requestPersistentStorage();
  }
}

// §1b/§1c：非侵入式追蹤本機資料變動時間 + 背景自動同步到 WebDAV（沒設定就不會做任何事）。
export function initWebDavAutoSync() {
  trackLocalChanges(DB);
  const webdavService = new WebDavSyncService();
  if (webdavService.isConfigured()) {
    webdavService.startAutoSync(() => webdavService.sync({ gatherLocalData: gatherAllData, applyRemoteData }));
  }
  return webdavService;
}

// §1：背景本機快照。不需要任何設定就會運作，每 30 分鐘存一次，最多保留 5 份。
export function initLocalBackup() {
  startAutoLocalBackup(gatherAllData);
}

// ---- 目前實際啟用的模組（逐一測試通過才加進這裡）----
initKeyboardShortcuts();
