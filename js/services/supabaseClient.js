// Supabase SDK 用 ESM CDN 動態載入，不透過 npm/打包工具——跟這個專案「零建置、
// 純靜態檔案直接部署到 GitHub Pages」的既有慣例一致，不需要多引入一套建置流程。
//
// 只有真的設定過 Supabase（js/config.js 填了真的 URL／anon key）才會發出這個
// 網路請求；沒設定時 getSupabaseClient() 回傳 null，不連網、不载入這包 SDK，
// 本機（IndexedDB）模式因此完全不受這個新功能影響。
//
// 版本號故意釘死成確認可用的 2.116.0，不是浮動的 "@2"（讓 esm.sh 自動解析成
// 當下最新版）——這是實測抓到的真實全站中斷事故：Supabase 剛發布 2.117.0時，
// esm.sh 的 CDN 建置還沒跟上，這個最新版本自己依賴的兩個子套件
// （@supabase/auth-js、@supabase/storage-js 的 2.117.0 build）在 esm.sh 上
// 回傳 404，导致全站所有登入雲端帳號的使用者当下完全連不上（IndexedDB
// 本機模式不受影響，但這正是產品定位裡「公開多使用者」最在乎的雲端功能）。
// 用浮動版本號等於把整個網站的可用性交給「Supabase 剛發布新版的當下，
// esm.sh 剛好也建置完成」這個賭注，之後要升級版本應該是刻意的決定
// （手動改這裡的版本號＋測過確實沒問題），不是自動被動地被推著升級。
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../config.js';

const SUPABASE_SDK_VERSION = '2.116.0';

let clientPromise = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import(`https://esm.sh/@supabase/supabase-js@${SUPABASE_SDK_VERSION}`)
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}
