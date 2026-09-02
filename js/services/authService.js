// 包住 Supabase Auth 的所有操作，是全站唯一知道「使用者現在有沒有登入」的地方。
// db.js 的路由器（決定 DB.* 要打本機還是雲端）跟 authUI.js（畫 header 徽章／
// Modal）都只透過這裡的函式跟認證狀態打交道，沒有其他檔案直接碰 Supabase Auth API。
import { getSupabaseClient } from './supabaseClient.js';

let currentUser = null;
let readyPromise = null;
const listeners = new Set();

function notifyListeners() {
  listeners.forEach((callback) => callback(currentUser));
}

// 頁面剛載入時，Supabase 要從 localStorage 還原上次登入的 session，這一步是非同步的；
// db.js 的每個路由方法在真正決定要打本機還是雲端之前，都會先 await 這個函式一次——
// 只有第一次呼叫真的要等（等 session 還原完成），之後 readyPromise 已經 resolve，
// 呼叫端幾乎感覺不到延遲。沒設定 Supabase（js/config.js 還是預留位置）的話，
// getSupabaseClient() 回傳 null，這裡直接維持 currentUser = null，永遠是本機模式。
function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    currentUser = data.session?.user || null;
    supabase.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      notifyListeners();
    });
  })();
  return readyPromise;
}

export function ensureAuthReady() {
  return ensureReady();
}

// 同步讀取——db.js 的路由器需要在同一個呼叫裡立刻決定要用 LocalDB 還是
// CloudDB，不能再等一次非同步查詢，所以認證狀態全程快取在這個模組層級變數，
// 由上面的 onAuthStateChange 訂閱維持最新。
export function getCurrentUser() {
  return currentUser;
}

// authUI.js 用來監聽登入/登出，即時更新 header 徽章文字跟觸發首次登入遷移提示。
export function onAuthStateChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function signUp(email, password) {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('尚未設定 Supabase，無法註冊。');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('尚未設定 Supabase，無法登入。');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = await getSupabaseClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function resetPasswordForEmail(email) {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('尚未設定 Supabase，無法寄送重設密碼信。');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}`,
  });
  if (error) throw error;
}

// 「忘記密碼」信裡的連結會帶著 recovery token 導回這個網站，Supabase 會自動把它
// 換成一個暫時的登入 session，讓使用者可以直接設定新密碼——這個函式只是包一層
// updateUser，authUI.js 偵測到網址帶有 recovery 參數時才會顯示「設定新密碼」表單。
export async function updatePassword(newPassword) {
  const supabase = await getSupabaseClient();
  if (!supabase) throw new Error('尚未設定 Supabase，無法更新密碼。');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
