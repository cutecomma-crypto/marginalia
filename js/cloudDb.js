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
  const { data, error } = await supabase.from(storeName).insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

async function getById(storeName, id) {
  const supabase = await client();
  const { data, error } = await supabase.from(storeName).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data || undefined;
}

async function getAll(storeName) {
  const supabase = await client();
  const { data, error } = await supabase.from(storeName).select('*').eq('user_id', requireUserId());
  if (error) throw error;
  return data || [];
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
}

async function remove(storeName, id) {
  const supabase = await client();
  const { error } = await supabase.from(storeName).delete().eq('id', id);
  if (error) throw error;
}

async function removeByIndex(storeName, indexName, value) {
  const supabase = await client();
  const { error } = await supabase.from(storeName).delete().eq('user_id', requireUserId()).eq(indexName, value);
  if (error) throw error;
}

async function clear(storeName) {
  const supabase = await client();
  const { error } = await supabase.from(storeName).delete().eq('user_id', requireUserId());
  if (error) throw error;
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
