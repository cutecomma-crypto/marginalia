// Supabase 專案設定。Marginalia 是零建置的純靜態站（GitHub Pages 直接放檔案，
// 沒有打包工具能在部署時把 .env 的值注入程式碼），所以這裡直接寫死、跟著 git commit
// 一起進版本庫——這不是偷懶，是 Supabase 官方對純前端 App 的建議做法：
// anon public key 本來就設計成可以公開內嵌在前端，真正的資料安全防線是資料庫端的
// Row Level Security（見 supabase/schema.sql），不是把這把 key 藏起來。
// 對照的說明文件在根目錄的 .env.example。
//
// 還沒填真的值之前，下面兩個維持預留位置字串，isSupabaseConfigured() 會回傳 false，
// authService.js／authUI.js 據此不會真的嘗試連線，只會顯示「尚未設定雲端帳號」，
// 不影響本機（IndexedDB）模式下的任何既有功能。
export const SUPABASE_URL = 'https://your-project-ref.supabase.co';
export const SUPABASE_ANON_KEY = 'your-anon-public-key';

export function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL
    && SUPABASE_ANON_KEY
    && !SUPABASE_URL.includes('your-project-ref')
    && !SUPABASE_ANON_KEY.includes('your-anon-public-key'),
  );
}
