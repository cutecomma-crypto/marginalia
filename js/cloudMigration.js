// 首次登入的「把本機藏書搬到雲端帳號」提示與遷移邏輯。
//
// 觸發時機：每次登入成功後（見 authUI.js 的 onAuthStateChange），檢查「雲端帳號
// 目前是空的」且「本機 IndexedDB 有書」且「這個帳號沒被標記已經遷移過」——
// 三個條件同時成立才顯示提示條，避免同一個帳號每次登入都被問一次，也避免
// 已經有雲端資料的帳號（例如換一台裝置登入）被本機這台裝置的舊資料嚇到。
//
// 遷移完成後不刪除本機資料（留著當備份，使用者可以之後自己用「資料管理」頁清除），
// 只跳 Toast 告知完成，DB 路由器接下來自然全部改讀寫雲端。
import { LocalDB } from './localDb.js';
import { CloudDB } from './cloudDb.js';
import { getCurrentUser } from './services/authService.js';
import { showToast } from './utils.js';

function migratedFlagKey(userId) {
  return `marginalia_cloud_migrated_${userId}`;
}

function bannerEl() {
  let el = document.getElementById('cloud-migration-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cloud-migration-banner';
    el.className = 'cloud-migration-banner';
    document.body.appendChild(el);
  }
  return el;
}

function removeBanner() {
  document.getElementById('cloud-migration-banner')?.remove();
}

// Postgres 會替每一筆新資料指派全新的 id，跟本機自動遞增的 id 不一樣，
// 所有外鍵（bookId／groupId／fromNodeId／toNodeId）都要照「books → groups →
// nodes → edges」這個依賴順序，邊搬邊用 Map 記住「本機舊 id → 雲端新 id」，
// 下一層才查得到要填什麼。reading_records／outputs／notes／quotes 只依賴
// bookId，順序上什麼時候搬都可以，這裡跟在 books 後面一起處理。
async function migrateLocalToCloud() {
  const books = await LocalDB.getAll('books');
  const bookIdMap = new Map();
  for (const book of books) {
    const { id: oldId, ...rest } = book;
    const newId = await CloudDB.add('books', rest);
    bookIdMap.set(oldId, newId);
  }

  const groupIdMap = new Map();
  for (const group of await LocalDB.getAll('groups')) {
    const { id: oldId, bookId, ...rest } = group;
    const newId = await CloudDB.add('groups', { ...rest, bookId: bookIdMap.get(bookId) });
    groupIdMap.set(oldId, newId);
  }

  const nodeIdMap = new Map();
  for (const node of await LocalDB.getAll('nodes')) {
    const { id: oldId, bookId, groupId, ...rest } = node;
    const newId = await CloudDB.add('nodes', {
      ...rest,
      bookId: bookIdMap.get(bookId),
      groupId: groupId ? groupIdMap.get(groupId) : null,
    });
    nodeIdMap.set(oldId, newId);
  }

  for (const edge of await LocalDB.getAll('edges')) {
    const { id, bookId, fromNodeId, toNodeId, ...rest } = edge;
    await CloudDB.add('edges', {
      ...rest,
      bookId: bookIdMap.get(bookId),
      fromNodeId: nodeIdMap.get(fromNodeId),
      toNodeId: nodeIdMap.get(toNodeId),
    });
  }

  for (const storeName of ['reading_records', 'outputs', 'notes', 'quotes']) {
    for (const record of await LocalDB.getAll(storeName)) {
      const { id, bookId, ...rest } = record;
      await CloudDB.add(storeName, { ...rest, bookId: bookIdMap.get(bookId) });
    }
  }

  for (const favorite of await LocalDB.getAll('favorite_authors')) {
    const { id, ...rest } = favorite; // 沒有外鍵（只認作者名字字串），直接搬
    await CloudDB.add('favorite_authors', rest);
  }
}

export async function maybeOfferCloudMigration() {
  const user = getCurrentUser();
  if (!user) return;
  if (localStorage.getItem(migratedFlagKey(user.id))) return;

  const [localBooks, cloudBooks] = await Promise.all([LocalDB.getAll('books'), CloudDB.getAll('books')]);
  if (localBooks.length === 0 || cloudBooks.length > 0) return;

  const el = bannerEl();
  el.innerHTML = `
    <span>偵測到本機有 ${localBooks.length} 本書，要同步到雲端帳號嗎？</span>
    <button type="button" class="btn btn-primary btn-sm" id="cloud-migration-confirm">立即同步</button>
    <button type="button" class="btn btn-sm" id="cloud-migration-dismiss">暫不同步</button>
  `;
  el.querySelector('#cloud-migration-dismiss').addEventListener('click', removeBanner);
  el.querySelector('#cloud-migration-confirm').addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    btn.disabled = true;
    btn.textContent = '同步中…';
    try {
      await migrateLocalToCloud();
      localStorage.setItem(migratedFlagKey(user.id), 'true');
      showToast('本機藏書已同步到雲端帳號');
      removeBanner();
      // hash 沒變，瀏覽器不會自己觸發 hashchange（跟 app.js 裡 Logo 點擊重置用的
      // 同一個處理方式），手動補發一次讓目前頁面重新抓一次資料，畫出剛同步好的雲端內容。
      window.dispatchEvent(new Event('hashchange'));
    } catch (err) {
      showToast('同步失敗，請稍後再試一次');
      console.error(err);
      btn.disabled = false;
      btn.textContent = '立即同步';
    }
  });
}
