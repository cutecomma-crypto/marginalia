// 雲端資料的「本機鏡像快取」，只為了解決一個具體問題：登入雲端帳號的使用者，
// 每次重新整理網頁都要等一趟 Supabase 網路請求（`books`／`wishlist` 表）才能
// 畫出第一畫面，網路稍慢或 Supabase 稍微延遲，畫面就會被「載入中…」卡住好幾秒。
//
// 做法是 Stale-While-Revalidate：cloudDb.js 的 getAll() 如果發現這個 store
// 有快取，就「立刻」把快取內容回傳給呼叫端先畫出畫面，不等網路；同一時間在
// 背景另外發一次真正的請求，把結果寫回快取，供「下一次」讀取秒開使用，如果
// 這次背景刷新發現資料真的變了，會發一個全站事件，畫面可以自己決定要不要
// 跳個 Toast 提示使用者「有新資料」。
//
// 快取只收「重新整理當下最需要秒開」的兩個 store：books（書籍列表首頁）、
// wishlist（願望清單抽屜）——其餘 store（quotes/outputs/notes……）都是先進到
// 書籍詳情頁才會用到，沒有「一開網頁就要等」的痛點，之後真的需要再照同樣的
// 模式把 store 名字加進 CACHED_STORES 就好，不用改動這個檔案的其他邏輯。
//
// 用獨立的 IndexedDB 資料庫（不是塞進 localDb.js 既有的 store），是刻意避免
// 「登出後的本機模式」跟「登入時的雲端鏡像」混在同一份資料裡——本機模式的
// books store 代表的是使用者自己刻意選擇的本機資料，絕對不能被雲端快取覆蓋
// 或混淆，兩者的生命週期、清除時機都完全不同，分開兩個資料庫最乾淨。
const CACHE_DB_NAME = 'MarginaliaCloudCache';
const CACHE_DB_VERSION = 1;
const CACHED_STORES = ['books', 'wishlist'];
const META_STORE = '_meta';

let dbPromise = null;

function openCacheDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const name of CACHED_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
  return dbPromise;
}

export function isCacheable(storeName) {
  return CACHED_STORES.includes(storeName);
}

async function getMeta(key) {
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readonly');
    const request = tx.objectStore(META_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

async function setMeta(key, value) {
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 快取「有沒有真正被寫過至少一次」跟「這個 store 目前有幾筆資料」是兩件不同的
// 事——一個剛登入、還沒抓過雲端資料的帳號，跟一個雲端帳號本來就是 0 本書，
// 兩者從 IndexedDB.getAll() 讀出來都是空陣列，不能用「陣列是不是空的」去判斷
// 「這算不算數過的快取」，一定要另外存一個明確的旗標。
async function hasCached(storeName) {
  return Boolean(await getMeta(`${storeName}:hasCached`));
}

export async function readCache(storeName) {
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 快取「有沒有可用內容」給呼叫端一次判斷完：真的存過（不是第一次讀取）才算數，
// 回傳 null 代表沒有快取可用，呼叫端要老老實實走一次真正的網路請求。
export async function readCacheIfPresent(storeName) {
  if (!isCacheable(storeName)) return null;
  if (!(await hasCached(storeName))) return null;
  return readCache(storeName);
}

export async function writeCache(storeName, records) {
  if (!isCacheable(storeName)) return;
  const db = await openCacheDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const record of records) store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await setMeta(`${storeName}:hasCached`, true);
}

// 新增／更新／刪除單筆記錄時，直接把同一筆變動「順手」套進快取，不用整個 store
// 重抓一次——這是為了讓使用者自己剛做的操作（加一本書、刪一筆願望清單）立刻
// 反映在快取裡，下一次重新整理不會出現「快取還沒更新、短暫看不到剛新增的東西」
// 這種落差。沒有快取過的 store 直接跳過（表示還沒發生過第一次真正的讀取，
// 沒有基礎可以「順手更新」，等下一次 getAll() 走正常流程建立快取即可）。
export async function patchCacheRecord(storeName, record) {
  if (!isCacheable(storeName) || !(await hasCached(storeName))) return;
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeCacheRecord(storeName, id) {
  if (!isCacheable(storeName) || !(await hasCached(storeName))) return;
  const db = await openCacheDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeCacheRecordsWhere(storeName, predicate) {
  if (!isCacheable(storeName) || !(await hasCached(storeName))) return;
  const all = await readCache(storeName);
  const remaining = all.filter((record) => !predicate(record));
  if (remaining.length !== all.length) await writeCache(storeName, remaining);
}

export async function clearCacheStore(storeName) {
  if (!isCacheable(storeName)) return;
  await writeCache(storeName, []);
}

// 帳號切換防呆：快取是跟著「上一次登入的帳號」存的。同一台裝置換帳號登入時，
// 舊帳號的快取內容屬於別人，一定要整批清掉，不能讓下一個帳號的第一畫面
// 「秒開」出上一個人的書。
export async function ensureCacheOwnedByUser(userId) {
  const cachedUserId = await getMeta('userId');
  if (cachedUserId && cachedUserId !== userId) {
    await clearAllCache();
  }
  await setMeta('userId', userId);
}

export async function clearAllCache() {
  const db = await openCacheDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([...CACHED_STORES, META_STORE], 'readwrite');
    for (const name of CACHED_STORES) tx.objectStore(name).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
