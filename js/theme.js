// 深夜莫蘭迪配色方案（Dark Morandi Mode）：頂部導覽列的太陽/月亮開關，點一下
// 在淺色／深色主題之間切換，選擇存進 localStorage 記住下次造訪。
//
// 實際的深色配色本身（背景 #1F1D1B、卡片 #2A2725、文字 #E8E4DC……）定義在
// css/styles.css 的 :root[data-theme="dark"]，只覆寫既有的 design token
// 變數，這裡的 JS 純粹負責「切換 <html> 的 data-theme 屬性＋存 localStorage
// ＋換按鈕圖示」，不直接碰任何顏色。
//
// 避免「畫面先閃一下淺色才跳成深色」（Flash of Wrong Theme）的關鍵在
// index.html <head> 最前面那段同步、非 type="module" 的 <script>——那段
// 在瀏覽器畫出第一張畫面之前就先讀好 localStorage、補上 data-theme 屬性，
// 這裡只需要接手「使用者主動按開關」之後的行為，初始狀態已經是對的。
import { ICON_SUN, ICON_MOON } from './icons.js';

const THEME_STORAGE_KEY = 'marginalia:theme';

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 私密瀏覽模式／localStorage 被封鎖：切換當下還是會生效，只是不會被記住，
    // 下次造訪會退回預設的淺色——這是可以接受的降級行為，不用另外跳錯誤訊息。
  }
}

function applyButtonIcon(btn, isDark) {
  // 按鈕本身顯示「按下去會變成的那個模式」的圖示（跟大部分 App 的日夜切換
  // 慣例一致：現在是淺色，按鈕顯示月亮，暗示「點了會變暗」；反之亦然），
  // 不是顯示「目前所在的模式」。
  btn.innerHTML = isDark ? ICON_SUN : ICON_MOON;
  const label = isDark ? '切換為日間模式' : '切換為夜間模式';
  // 用 data-tooltip 取代原生 title——原生提示要等 1-2 秒才跳出來，這顆
  // 按鈕又是純圖示沒有文字，切換当下最需要「立刻」看得懂圖示的意思。
  // 樣式定義見 css/styles.css 開頭的 [data-tooltip] 全站共用規則。
  btn.setAttribute('data-tooltip', label);
  btn.setAttribute('aria-label', label);
}

export function initThemeToggle() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyButtonIcon(btn, isDark);

  btn.addEventListener('click', () => {
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const nextDark = !nowDark;
    if (nextDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    setStoredTheme(nextDark ? 'dark' : 'light');
    applyButtonIcon(btn, nextDark);
  });
}
