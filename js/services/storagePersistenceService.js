// 獨立、可插拔模組：向瀏覽器要求「持久化儲存」，降低瀏覽器在裝置儲存空間吃緊時
// 主動清掉 IndexedDB 資料的機率。純附加功能：不讀寫應用程式自己的任何資料表，
// 不 import db.js，不會跟現有程式碼的任何邏輯衝突，刪掉這個檔案也不影響其他功能。
// 「資料管理」頁面精簡：使用者反映的「持久化儲存」狀態提示小工具
// （renderPersistenceStatusWidget，連同只服務它的 getStorageEstimate／
// formatBytes）已經拿掉，這裡只留 bootstrap-extensions.js 的
// initStoragePersistence() 還在用的兩個函式——啟動時自動請求持久化儲存
// 這件事本身不受影響，只是拿掉了這個頁面上「目前是否已持久化」的狀態顯示。

export async function isStoragePersisted() {
  if (!navigator.storage || !navigator.storage.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) {
    return { supported: false, persisted: false };
  }
  try {
    const persisted = await navigator.storage.persist();
    return { supported: true, persisted };
  } catch {
    return { supported: true, persisted: false };
  }
}
