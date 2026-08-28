// 獨立於 WebDAV 之外的最後一道保險：定期把整份資料庫快照存進 localStorage，
// 就算使用者從沒設定過雲端同步，也有「最近幾份」快照可以救回意外刪除／清除的資料。
// 用依賴注入接收 gatherAllData（呼叫端傳進來，通常就是包一層 DB.getAll），
// 這個模組完全不需要認識 db.js 裡實際有哪些資料表。

const STORAGE_KEY_PREFIX = 'marginalia_local_backup_';
const MAX_SNAPSHOTS = 5;

function snapshotKey(isoTimestamp) {
  return `${STORAGE_KEY_PREFIX}${isoTimestamp}`;
}

export function listLocalBackups() {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(STORAGE_KEY_PREFIX))
    .map((key) => key.slice(STORAGE_KEY_PREFIX.length))
    .sort()
    .reverse();
}

export async function createLocalBackup(gatherAllData) {
  const timestamp = new Date().toISOString();
  const payload = { app: 'Marginalia', exportedAt: timestamp, version: 1, data: await gatherAllData() };
  try {
    localStorage.setItem(snapshotKey(timestamp), JSON.stringify(payload));
  } catch (err) {
    // localStorage 空間有限（通常 5-10MB），資料量大到存不下時不該讓整個備份機制炸掉，
    // 只記警告，讓呼叫端知道這次背景備份沒有成功即可。
    console.warn('[localBackupService] 本機備份寫入失敗（可能超過 localStorage 容量）：', err.message);
    return null;
  }
  pruneOldBackups();
  return timestamp;
}

function pruneOldBackups() {
  listLocalBackups().slice(MAX_SNAPSHOTS).forEach((ts) => localStorage.removeItem(snapshotKey(ts)));
}

export function getLocalBackup(isoTimestamp) {
  const raw = localStorage.getItem(snapshotKey(isoTimestamp));
  return raw ? JSON.parse(raw) : null;
}

export function deleteLocalBackup(isoTimestamp) {
  localStorage.removeItem(snapshotKey(isoTimestamp));
}

let autoBackupTimer = null;

export function startAutoLocalBackup(gatherAllData, intervalMs = 30 * 60 * 1000) {
  stopAutoLocalBackup();
  autoBackupTimer = setInterval(() => {
    createLocalBackup(gatherAllData).catch((err) => console.warn('[localBackupService] 自動備份失敗：', err.message));
  }, intervalMs);
  // 開始計時後立刻先做一次，不用等第一個 interval 過去才有第一份備份。
  createLocalBackup(gatherAllData).catch(() => {});
}

export function stopAutoLocalBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

// 可直接掛進「資料管理」頁面的清單＋還原面板。
export function renderLocalBackupPanel(container, { applyRemoteData }) {
  const timestamps = listLocalBackups();
  container.innerHTML = `
    <div class="local-backup-panel">
      ${timestamps.length === 0
        ? '<p class="graph-hint">目前沒有任何背景快照，開始使用一段時間後才會累積。</p>'
        : `<ul class="stat-category-list">
            ${timestamps.map((ts) => `
              <li>
                <span>${new Date(ts).toLocaleString('zh-TW')}</span>
                <button type="button" class="btn btn-sm local-backup-restore-btn" data-ts="${ts}">還原</button>
              </li>
            `).join('')}
          </ul>`}
    </div>
  `;

  container.querySelectorAll('.local-backup-restore-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ts = btn.dataset.ts;
      const snapshot = getLocalBackup(ts);
      if (!snapshot) return;
      const confirmed = window.confirm(`確定要還原到 ${new Date(ts).toLocaleString('zh-TW')} 的快照嗎？這會覆蓋目前所有資料。`);
      if (!confirmed) return;
      await applyRemoteData(snapshot.data);
      window.alert('已還原，畫面即將重新整理。');
      window.location.reload();
    });
  });
}
