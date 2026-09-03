// 雲端（Supabase）版的資料存取層。方法名稱／參數／回傳形狀刻意跟 localDb.js 的
// LocalDB 完全對齊，兩者都由 db.js 的路由器依登入狀態擇一呼叫——除了這裡跟
// localDb.js，全站其他檔案都不知道、也不需要知道現在資料存在本機還是雲端。
//
// 每個方法都以「目前登入的使用者」為邊界：insert 時帶入 user_id，query／delete 時
// 額外用 .eq('user_id', ...) 篩一次。資料庫端的 Row Level Security（見
// supabase/schema.sql）已經會強制做這件事，這裡重複篩一次是「防禦性寫兩層」，
// 不是依賴單一防線——RLS policy 設錯的話，這裡的 .eq() 至少還能擋住同一個 client
// 意外撈到別人資料的情況（換一台裝置、換一個帳號都還是安全的）。
import { getSupabaseClient } from './services/supabaseClient.js';
import { getCurrentUser } from './services/authService.js';
import {
  isCacheable, readCacheIfPresent, writeCache, patchCacheRecord,
  removeCacheRecord, removeCacheRecordsWhere, clearCacheStore, ensureCacheOwnedByUser,
} from './services/cloudCache.js';

async function client() {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('尚未設定 Supabase，無法使用雲端資料。');
  return supabase;
}

function requireUserId() {
  const user = getCurrentUser();
  if (!user) throw new Error('尚未登入，無法使用雲端資料。');
  return user.id;
}

async function add(storeName, record) {
  const supabase = await client();
  const { id, ...rest } = record; // id 由 Postgres 的 identity 欄位指派，不接受呼叫端帶入本機 id
  const payload = { ...rest, user_id: requireUserId(), createdAt: record.createdAt || new Date().toISOString() };
  const { data, error } = await supabase.from(storeName).insert(payload).select().single();
  if (error) throw error;
  // 順手把這筆新記錄也寫進本機快取（見 cloudCache.js 開頭說明），下一次
  // 重新整理不用等背景刷新完成就能看到這筆剛新增的資料。
  await patchCacheRecord(storeName, data);
  return data.id;
}

async function getById(storeName, id) {
  const supabase = await client();
  const { data, error } = await supabase.from(storeName).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || undefined;
}

// 同一個 store 短時間內常常被好幾個地方呼叫 getAll()（例如書籍列表頁載入時，
// bookList.js／authors.js 的 getFavoriteAuthorMap／stats.js 的側邊欄統計，
// 都各自獨立呼叫一次 DB.getAll('books')）。這裡疊了兩層各自處理不同情境的
// 防重複機制，兩層都需要、缺一個都會在實測中重現重複的網路請求：
//
// 1. pendingGetAlls：dedupe「完全同時」發生的呼叫（例如某處用 Promise.all
//    並發呼叫）——把整個 getAll() 呼叫本身用一個 Promise 記住，完全同時的
//    呼叫全部搭上同一個 Promise，只會真的讀一次快取、觸發一次背景刷新。
//    這裡刻意「在任何 await 之前」就把 Promise 存進去：JS 的 async function
//    呼叫時，函式本體會同步執行到第一個 await 為止才真正讓出控制權，只要
//    set() 寫在任何 await 前面，Promise.all() 同時觸發的好幾個呼叫（陣列
//    元素是同步、依序建立的）就保證第一個呼叫的 set() 一定會在第二個呼叫的
//    has() 檢查「之前」完成，不會有競態。
// 2. inFlightBackgroundRefreshes：dedupe「這一次 getAll() 呼叫時，前一次
//    getAll() 觸發的背景刷新根本還沒做完」的情況——這種是循序（不是同時）
//    發生的呼叫，pendingGetAlls 那個 Promise 早就 resolve、被清掉了，
//    但背景那個網路請求可能還在飛。這一層在整個背景刷新「真正執行期間」
//    （從發出請求到寫完快取）都保持鎖住，不受個別 getAll() 呼叫的生命週期
//    影響，才能真正涵蓋「同一頁面渲染流程裡好幾個地方依序呼叫 getAll()」
//    這個最常見的情境——這兩層都是實測（同一頁重新整理發出 4 次一模一樣的
//    /books 請求）驗證過的真實情況，不是預防性猜測。
const pendingGetAlls = new Map();
const inFlightBackgroundRefreshes = new Set();

function refreshCacheInBackground(storeName, supabase, userId) {
  if (inFlightBackgroundRefreshes.has(storeName)) return;
  inFlightBackgroundRefreshes.add(storeName);
  (async () => {
    try {
      const { data, error } = await supabase.from(storeName).select('*').eq('user_id', userId);
      if (error) throw error;
      const fresh = data || [];
      const previousJson = JSON.stringify(await readCacheIfPresent(storeName));
      await writeCache(storeName, fresh);
      if (JSON.stringify(fresh) !== previousJson) {
        window.dispatchEvent(new CustomEvent('marginalia:cloud-cache-updated', { detail: { store: storeName } }));
      }
    } catch (error) {
      // 背景刷新失敗不影響使用者「當下」看到的畫面——反正手上還有快取內容可以看，
      // 這不是使用者主動觸發的操作，不用跳 Toast 打擾，Console 留紀錄方便除錯就好。
      console.error(`[Marginalia 雲端快取] 背景刷新 ${storeName} 失敗：`, error);
    } finally {
      inFlightBackgroundRefreshes.delete(storeName);
    }
  })();
}

// Stale-While-Revalidate：有快取就先回傳快取內容（不等網路），背景另外觸發一次
// 真正的請求刷新快取——這是解決「登入雲端帳號後，每次重新整理都要等一趟網路
// 才能畫出第一畫面」的核心機制，見 services/cloudCache.js 開頭的完整說明。
// 完全沒快取過（這台裝置/這個帳號第一次讀取）就沒有東西可以先顯示，只能照舊
// 老實等網路回應，同時把結果寫進快取，下一次就能秒開。
function getAll(storeName) {
  const userId = requireUserId();
  if (pendingGetAlls.has(storeName)) return pendingGetAlls.get(storeName);

  const promise = (async () => {
    await ensureCacheOwnedByUser(userId);
    const cached = await readCacheIfPresent(storeName);
    if (cached) {
      const supabase = await client();
      refreshCacheInBackground(storeName, supabase, userId); // 故意不 await：背景刷新，不阻塞這次回傳
      return cached;
    }

    const supabase = await client();
    const { data, error } = await supabase.from(storeName).select('*').eq('user_id', userId);
    if (error) throw error;
    const records = data || [];
    if (isCacheable(storeName)) await writeCache(storeName, records);
    return records;
  })();

  pendingGetAlls.set(storeName, promise);
  promise.finally(() => pendingGetAlls.delete(storeName));
  return promise;
}

async function getByIndex(storeName, indexName, value) {
  const supabase = await client();
  const { data, error } = await supabase.from(storeName).select('*').eq('user_id', requireUserId()).eq(indexName, value);
  if (error) throw error;
  return data || [];
}

// 對照現有呼叫端的實際用法（bookForm.js／readingRecords.js……都只在記錄已存在時
// 才呼叫 update()，新增一律走 add()），這裡不用做 upsert，單純更新既有那一列即可。
async function update(storeName, record) {
  const supabase = await client();
  const payload = { ...record, user_id: requireUserId() };
  const { error } = await supabase.from(storeName).update(payload).eq('id', record.id);
  if (error) throw error;
  await patchCacheRecord(storeName, payload);
}

async function remove(storeName, id) {
  const supabase = await client();
  const { error } = await supabase.from(storeName).delete().eq('id', id);
  if (error) throw error;
  await removeCacheRecord(storeName, id);
}

async function removeByIndex(storeName, indexName, value) {
  const supabase = await client();
  const { error } = await supabase.from(storeName).delete().eq('user_id', requireUserId()).eq(indexName, value);
  if (error) throw error;
  await removeCacheRecordsWhere(storeName, (record) => record[indexName] === value);
}

async function clear(storeName) {
  const supabase = await client();
  const { error } = await supabase.from(storeName).delete().eq('user_id', requireUserId());
  if (error) throw error;
  await clearCacheStore(storeName);
}

export const CloudDB = {
  add,
  getById,
  getAll,
  getByIndex,
  update,
  remove,
  removeByIndex,
  clear,
};
