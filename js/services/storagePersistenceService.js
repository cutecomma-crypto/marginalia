// 獨立、可插拔模組：向瀏覽器要求「持久化儲存」，降低瀏覽器在裝置儲存空間吃緊時
// 主動清掉 IndexedDB 資料的機率。純附加功能：不讀寫應用程式自己的任何資料表，
// 不 import db.js，不會跟現有程式碼的任何邏輯衝突，刪掉這個檔案也不影響其他功能。

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

export async function getStorageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 掛在畫面上的小提示條：目前是否已持久化、用了多少空間，並提供一鍵請求持久化的按鈕。
// container 由呼叫端決定要插進哪個既有 DOM 節點，這裡完全不碰應用程式既有的畫面結構。
export async function renderPersistenceStatusWidget(container) {
  const persisted = await isStoragePersisted();
  const estimate = await getStorageEstimate();
  const usageText = estimate
    ? `已使用 ${formatBytes(estimate.usage)}／${formatBytes(estimate.quota)}`
    : '此瀏覽器不支援查詢儲存空間用量';

  container.innerHTML = `
    <div class="persistence-widget">
      <span class="persistence-status ${persisted ? 'is-persisted' : 'is-not-persisted'}">
        ${persisted ? '✅ 已啟用持久化儲存' : '⚠️ 尚未啟用持久化儲存'}
      </span>
      <span class="persistence-usage">${usageText}</span>
      ${!persisted ? '<button type="button" class="btn btn-primary" id="request-persist-btn">請求持久化儲存</button>' : ''}
    </div>
  `;

  const btn = container.querySelector('#request-persist-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = '請求中…';
    const result = await requestPersistentStorage();
    if (!result.supported) {
      await renderPersistenceStatusWidget(container);
      container.querySelector('.persistence-widget').insertAdjacentHTML(
        'beforeend',
        '<p class="graph-hint">此瀏覽器不支援持久化儲存 API。</p>',
      );
      return;
    }
    await renderPersistenceStatusWidget(container);
  });
}
