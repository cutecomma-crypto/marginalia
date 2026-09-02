// 全站資料存取的唯一入口，現在是一個路由器：依照「目前有沒有登入雲端帳號」，
// 把每個方法轉發給 localDb.js 的 LocalDB（IndexedDB，登出狀態）或 cloudDb.js 的
// CloudDB（Supabase，登入狀態）。兩邊方法名稱／參數／回傳形狀完全對齊，所以
// bookForm.js／quotes.js／notes.js／outputs.js／graph.js／readingRecords.js／
// authors.js／bookDetail.js／bookList.js……全站所有原本 import { DB } 的地方
// 一行都不用改，登入後自動變成讀寫雲端、登出後自動變回讀寫本機。
//
// 連 WebDAV 同步（webdavSyncService.js 的 gatherAllData/applyRemoteData，
// 遍歷 DB.STORE_NAMES 逐一 getAll/clear/update）也會「順便」變成「登入時備份/
// 還原雲端帳號資料、登出時備份/還原本機資料」，不用另外寫代碼——這是路由器設計
// 自然帶來的效果，不是刻意為 WebDAV 另外處理。
import { LocalDB } from './localDb.js';
import { CloudDB } from './cloudDb.js';
import { getCurrentUser, ensureAuthReady } from './services/authService.js';

function pick() {
  return getCurrentUser() ? CloudDB : LocalDB;
}

// 頁面剛載入時，Supabase 從 localStorage 還原上次登入 session 是非同步的；
// 每個方法真正決定要轉發給哪一邊之前，先 await ensureAuthReady() 一次——
// 只有第一次呼叫會等（等 session 還原完成），之後立刻 resolve，呼叫端感覺不到差異。
// 沒設定 Supabase 的話 ensureAuthReady() 幾乎立即 resolve，行為跟改版前完全一樣。
function route(methodName) {
  return async (...args) => {
    await ensureAuthReady();
    return pick()[methodName](...args);
  };
}

export const DB = {
  add: route('add'),
  getById: route('getById'),
  getAll: route('getAll'),
  getByIndex: route('getByIndex'),
  update: route('update'),
  remove: route('remove'),
  removeByIndex: route('removeByIndex'),
  clear: route('clear'),
  STORE_NAMES: LocalDB.STORE_NAMES,
};
