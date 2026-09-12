// 雲端（Supabase）版的資料存取層。方法名稱／參數／回傳形狀刻意跟 localDb.js 的
// LocalDB 完全對齊，兩者都由 db.js 的路由器依登入狀態擇一呼叫——除了這裡跟
// localDb.js，全站其他檔案都不知道、也不需要知道現在資料存在本機還是雲端。
//
// 每個方法都以「目前登入的使用者」為邊界：insert 時帶入 user_id，query／update／
// delete 時額外用 .eq('user_id', ...) 篩一次。資料庫端的 Row Level Security（見
// supabase/schema.sql）已經會強制做這件事，這裡重複篩一次是「防禦性寫兩層」，
// 不是依賴單一防線——RLS policy 設錯的話，這裡的 .eq() 至少還能擋住同一個 client
// 意外讀到／改到／刪到別人資料的情況（換一台裝置、換一個帳號都還是安全的）。
// 「架構安全性強化」這次的重點：getById／update／remove 這三個先前只靠
// .eq('id', id) 定位、完全沒有 .eq('user_id', ...) 這一層的方法補上這道防線
// ——原本 getByIndex／removeByIndex／clear 已經有，這三個是這次稽核抓到的漏網之魚。
import { getSupabaseClient } from './services/supabaseClient.js';
import { getCurrentUser } from './services/authService.js';
import { showToast, isNetworkError } from './utils.js';
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

// 「架構安全性強化」的另一半：網路連線失敗時不要讓整頁跟著崩潰（呼叫端的
// await 一路往上炸，最後被 app.js 的 route() 接住、整頁換成一句原始錯誤訊息）。
// 這裡在每個方法外層加一層 try-catch，抓到「看起來像網路問題」的錯誤（判斷式
// 見 utils.js 的 isNetworkError，跟 app.js 的保底 catch 共用同一份規則）就先跳
// 一句淡雅的 Toast 提示，再照樣把錯誤往外丟——呼叫端原本各自的錯誤處理（例如
// wishlist.js／bookForm.js 自己 catch 了會顯示更精確的訊息）完全不受影響，
// 這裡只是「多加一層通用、使用者看得懂的提示」，不是取代掉原本的錯誤處理。

// 短時間內同一批畫面渲染常常會並發好幾個請求（見下面 getAll 的三層防重複說明），
// 網路真的斷線時這些請求幾乎會同時失敗——沒有這個節流，使用者會在同一瞬間
// 看到一整排疊起來的相同 Toast，這裡限制最短間隔，同一次斷線只提示一次。
let lastNetworkToastAt = 0;
function reportIfNetworkError(error) {
  if (!isNetworkError(error)) return;
  const now = Date.now();
  if (now - lastNetworkToastAt < 4000) return;
  lastNetworkToastAt = now;
  showToast('網路連線異常，請檢查您的網路連線後再試一次');
}

async function add(storeName, record) {
  try {
    const supabase = await client();
    const { id, ...rest } = record; // id 由 Postgres 的 identity 欄位指派，不接受呼叫端帶入本機 id
    const payload = { ...rest, user_id: requireUserId(), createdAt: record.createdAt || new Date().toISOString() };
    const { data, error } = await supabase.from(storeName).insert(payload).select().single();
    if (error) throw error;
    // 順手把這筆新記錄也寫進本機快取（見 cloudCache.js 開頭說明），下一次
    // 重新整理不用等背景刷新完成就能看到這筆剛新增的資料。
    await patchCacheRecord(storeName, data);
    return data.id;
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

async function getById(storeName, id) {
  try {
    const supabase = await client();
    const { data, error } = await supabase.from(storeName).select('*').eq('id', id).eq('user_id', requireUserId()).maybeSingle();
    if (error) throw error;
    return data || undefined;
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
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

// Supabase 專案曾經因為 exceed_egress_quota（流量超標）被限制服務——事後
// 稽核找到的最大宗流量元凶：書籍列表頁、書籍表單、分類管理、統計、標籤……
// 全站十幾個地方都各自呼叫過一次 DB.getAll('books')，每一次只要背後真的
// 打到網路，Supabase 就會把每一本書的 coverImage（見 bookForm.js 的
// resizeImageToDataUrl，壓縮過仍是幾十到上百 KB 的 base64 圖片字串）整包
// 傳一次——藏書上百本的帳號，光是「切換頁面時背景偷偷刷新一次快取」就是
// 好幾 MB 流量，一天正常瀏覽下來（列表↔詳情頁來回好幾趟、開分類管理、
// 開統計面板……）很容易就是幾十 MB，累積起來就是 exceed_egress_quota
// 的真正成因。
// 解法分兩層：
//   1. BOOKS_LIST_COLUMNS：books 表唯一的「大欄位」只有 coverImage，全站
//      目前只有書籍詳情頁／編輯表單／封面網格卡片真的需要顯示封面圖，其餘
//      全部呼叫端（作者統計、分類管理、統計面板、標籤、Notion 匯入判斷
//      重複標題……）都只讀書名/作者/分類這類小欄位——列表層級的查詢
//      （getAll、以及下面的背景刷新）改成明講欄位清單、排除 coverImage，
//      不影響任何一個現有呼叫端的行為，因為沒有人在讀 getAll() 撈回來的
//      coverImage。書籍詳情頁／編輯表單走的是 getById()（單筆），封面
//      網格卡片改用下面新增的 getBookCovers()（見該函式的說明）另外
//      單獨、範圍受限地補回封面，兩者都不受這裡影響。
//   2. BACKGROUND_REFRESH_COOLDOWN_MS：即使排除掉封面圖，同一個 store
//      被好幾個地方各自獨立呼叫 getAll() 時，光是「基本欄位」本身重複抓
//      一輪也是浪費——原本的 inFlightBackgroundRefreshes 只擋得住「完全
//      同時／前一次還沒做完」的重複請求，擋不住「切換頁面、隔了幾秒鐘
//      又呼叫一次 getAll()」這種循序但頻繁的情境。加一個以「上次刷新
//      完成時間」為準的冷卻時間，冷卻中的呼叫直接沿用當下的快取內容，
//      不再多打一次網路請求——對應使用者這次要求的「加入簡單的數據快取，
//      避免切換頁籤時重複向資料庫抓取相同書籍資料」。
const BOOKS_LIST_COLUMNS = 'id,title,author,publisher,category,format,retentionStatus,libraryBorrowType,libraryName,lentTo,publishDate,purchaseDate,purchasePrice,tags,createdAt';
const BACKGROUND_REFRESH_COOLDOWN_MS = 60 * 1000;
const lastBackgroundRefreshAt = new Map();

function listSelectColumns(storeName) {
  return storeName === 'books' ? BOOKS_LIST_COLUMNS : '*';
}

function refreshCacheInBackground(storeName, supabase, userId) {
  if (inFlightBackgroundRefreshes.has(storeName)) return;
  const lastAt = lastBackgroundRefreshAt.get(storeName) || 0;
  if (Date.now() - lastAt < BACKGROUND_REFRESH_COOLDOWN_MS) return;
  inFlightBackgroundRefreshes.add(storeName);
  (async () => {
    try {
      const { data, error } = await supabase.from(storeName).select(listSelectColumns(storeName)).eq('user_id', userId);
      if (error) throw error;
      const fresh = data || [];
      const previousJson = JSON.stringify(await readCacheIfPresent(storeName));
      await writeCache(storeName, fresh);
      lastBackgroundRefreshAt.set(storeName, Date.now());
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
    try {
      await ensureCacheOwnedByUser(userId);
      const cached = await readCacheIfPresent(storeName);
      if (cached) {
        const supabase = await client();
        refreshCacheInBackground(storeName, supabase, userId); // 故意不 await：背景刷新，不阻塞這次回傳
        return cached;
      }

      const supabase = await client();
      const { data, error } = await supabase.from(storeName).select(listSelectColumns(storeName)).eq('user_id', userId);
      if (error) throw error;
      const records = data || [];
      if (isCacheable(storeName)) {
        await writeCache(storeName, records);
        lastBackgroundRefreshAt.set(storeName, Date.now());
      }
      return records;
    } catch (error) {
      reportIfNetworkError(error);
      throw error;
    }
  })();

  pendingGetAlls.set(storeName, promise);
  promise.finally(() => pendingGetAlls.delete(storeName));
  return promise;
}

async function getByIndex(storeName, indexName, value) {
  try {
    const supabase = await client();
    const { data, error } = await supabase.from(storeName).select('*').eq('user_id', requireUserId()).eq(indexName, value);
    if (error) throw error;
    return data || [];
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

// 見上面 BOOKS_LIST_COLUMNS 的說明：getAll('books') 不再帶封面圖，封面
// 網格檢視（bookList.js 的 bookGalleryHtml）需要真的顯示封面時，改叫這個
// 函式單獨補回來——只帶「目前這一頁實際會畫出來的書」的 id（受分頁筆數
// 限制，最多 12/24/50 本，使用者主動選「全部」才會是整個書庫），不是
// 每次都撈全部藏書的封面，流量成本直接跟「畫面上看得到幾張封面」成正比，
// 不是跟「書庫總共有幾本書」成正比。
async function getBookCovers(ids) {
  if (!ids || ids.length === 0) return [];
  try {
    const supabase = await client();
    const { data, error } = await supabase.from('books').select('id,coverImage').eq('user_id', requireUserId()).in('id', ids);
    if (error) throw error;
    return data || [];
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

// 對照現有呼叫端的實際用法（bookForm.js／readingRecords.js……都只在記錄已存在時
// 才呼叫 update()，新增一律走 add()），這裡不用做 upsert，單純更新既有那一列即可。
//
// 這裡曾經真實發生過「所有 update() 全部失敗」的 bug：呼叫端傳進來的 record
// 物件本來就帶著自己的 id（例如 { id: person.id, label, ... }），過去這裡直接
// { ...record } 整包當作 UPDATE 的 SET 內容送出去，等於連 id 這個欄位本身也
// 一起被塞進 SET 子句。id 欄位在 schema.sql 裡是 `generated always as identity`
// （見 books/nodes/quotes……每一張表），PostgreSQL 對這種身分欄位有硬性規定：
// 只要 UPDATE 語句的 SET 子句裡出現這一欄，不管新值是不是跟舊值一樣，一律
// 直接報錯「column "id" can only be updated to DEFAULT」，整個 UPDATE 連同
// 其他欄位一起失敗——這代表任何一個功能只要透過 DB.update() 存檔（筆記編輯、
// 佳句編輯、書籍表單、閱讀紀錄、人物/群組/關係……全部都是），登入雲端帳號
// 之後其實全部都會存檔失敗，只是使用者剛好先在關係圖譜的「主角」欄位發現。
// 修法是把 id 從要送出去的 SET payload 裡拿掉（只留著給 .eq('id', id) 當
// WHERE 條件用），本機快取仍然需要完整的 id 才能用同一把 key 覆蓋寫回去
// （IndexedDB 的 put() 靠 id 這個 keyPath 找到要更新的是哪一列），所以快取
// 那份物件另外把 id 加回來，兩份用途不同、不能共用同一個 payload 變數。
async function update(storeName, record) {
  try {
    const supabase = await client();
    const { id, ...fields } = record;
    const userId = requireUserId();
    const payload = { ...fields, user_id: userId };
    const { error } = await supabase.from(storeName).update(payload).eq('id', id).eq('user_id', userId);
    if (error) throw error;
    await patchCacheRecord(storeName, { ...payload, id });
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

async function remove(storeName, id) {
  try {
    const supabase = await client();
    const { error } = await supabase.from(storeName).delete().eq('id', id).eq('user_id', requireUserId());
    if (error) throw error;
    await removeCacheRecord(storeName, id);
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

async function removeByIndex(storeName, indexName, value) {
  try {
    const supabase = await client();
    const { error } = await supabase.from(storeName).delete().eq('user_id', requireUserId()).eq(indexName, value);
    if (error) throw error;
    await removeCacheRecordsWhere(storeName, (record) => record[indexName] === value);
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

async function clear(storeName) {
  try {
    const supabase = await client();
    const { error } = await supabase.from(storeName).delete().eq('user_id', requireUserId());
    if (error) throw error;
    await clearCacheStore(storeName);
  } catch (error) {
    reportIfNetworkError(error);
    throw error;
  }
}

export const CloudDB = {
  add,
  getById,
  getAll,
  getByIndex,
  getBookCovers,
  update,
  remove,
  removeByIndex,
  clear,
};
