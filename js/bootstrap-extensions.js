// 新模組的「總開關」。這個檔案是唯一需要在 index.html 多加一行 <script> 才會生效的東西——
// 目的是讓 app.js（既有的路由主程式）完全不用被修改一行字，所有全域性質的新行為
// 都集中在這裡用一次性的方式安裝好。
//
// 頁面專屬的功能（Markdown 匯出按鈕、選取工具列、WebDAV 設定面板…）因為需要插進
// 特定頁面的 DOM 容器，沒辦法在這裡「全域」處理，那些請照 INTEGRATION.md
// （或本次回覆裡的整合指南）分別加進對應的頁面模組。

import { DB } from './db.js';
import { requestPersistentStorage, isStoragePersisted } from './services/storagePersistenceService.js';
import { installGlobalShortcuts } from './services/keyboardShortcutsService.js';
import { WebDavSyncService, trackLocalChanges } from './services/webdavSyncService.js';
import { startAutoLocalBackup } from './services/localBackupService.js';

async function gatherAllData() {
  const data = {};
  for (const storeName of DB.STORE_NAMES) {
    data[storeName] = await DB.getAll(storeName);
  }
  return data;
}

async function applyRemoteData(data) {
  for (const storeName of DB.STORE_NAMES) {
    await DB.clear(storeName);
  }
  for (const storeName of DB.STORE_NAMES) {
    for (const record of data[storeName] || []) {
      await DB.update(storeName, record);
    }
  }
}

async function init() {
  // 1. 持久化儲存：第一次造訪且瀏覽器支援時主動問一次；已經問過就不用每次重複跳出。
  const alreadyPersisted = await isStoragePersisted();
  if (!alreadyPersisted) {
    await requestPersistentStorage();
  }

  // 1b. 非侵入式追蹤本機資料變動時間，讓 WebDAV 同步知道「本機是不是比遠端新」。
  trackLocalChanges(DB);

  // 1c. 背景自動同步：只有使用者在「資料管理」頁面填過 WebDAV 設定才會真的動作，
  // 沒設定的話 sync() 會直接丟出例外，這裡接住、安靜跳過即可。
  const webdavService = new WebDavSyncService();
  if (webdavService.isConfigured()) {
    webdavService.startAutoSync(() => webdavService.sync({ gatherLocalData: gatherAllData, applyRemoteData }));
  }

  // 1d. 背景本機快照：不需要任何設定就會運作，每 30 分鐘存一次，最多保留 5 份。
  startAutoLocalBackup(gatherAllData);

  // 5. 全域鍵盤快捷鍵：Cmd/Ctrl+F 聚焦搜尋框、Esc 交給目前開著的 Modal／Drawer 處理。
  installGlobalShortcuts({ searchInputSelector: '#book-search, #quote-search' });
}

init();

// 匯出給頁面模組使用：這樣「佳句摘錄」「資料管理」頁想主動觸發一次同步／備份時，
// 不用自己重新 new 一個 WebDavSyncService、重新寫一次 gatherAllData。
export { gatherAllData, applyRemoteData };
