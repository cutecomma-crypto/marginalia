// Supabase SDK 用 ESM CDN 動態載入，不透過 npm/打包工具——跟這個專案「零建置、
// 純靜態檔案直接部署到 GitHub Pages」的既有慣例一致，不需要多引入一套建置流程。
//
// 只有真的設定過 Supabase（js/config.js 填了真的 URL／anon key）才會發出這個
// 網路請求；沒設定時 getSupabaseClient() 回傳 null，不連網、不载入這包 SDK，
// 本機（IndexedDB）模式因此完全不受這個新功能影響。
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from '../config.js';

let clientPromise = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('https://esm.sh/@supabase/supabase-js@2')
      .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY));
  }
  return clientPromise;
}
