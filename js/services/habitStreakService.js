// 獨立、可插拔模組：每日閱讀打卡與連續天數（🔥 Day Streak）。
//
// 「打卡」的定義刻意收緊成「真的跟某本書互動」的動作，不是「今天有沒有打開這個網站」：
// 新增佳句摘錄／快速筆記／閱讀後輸出，或更新閱讀進度，才算今天有打卡。只是切換頁面、
// 瀏覽書籍列表不算——不然這個統計會失去意義，隨便點開網站就能「維持連續」。
//
// 用非侵入式的「包一層」手法掛在既有 DB 物件的 add／update 方法上（跟 webdavSyncService.js
// 的 trackLocalChanges 同一個模式，用不同的標記屬性名稱，兩者可以同時掛、互不干擾），
// 不需要在 notes.js／quotes.js／outputs.js／readingRecords.js 裡各自加一行呼叫。

const STREAK_LOG_KEY = 'marginalia_streak_log';
const TRACKED_ADD_STORES = new Set(['quotes', 'notes', 'outputs']);
const TRACKED_UPDATE_STORES = new Set(['reading_records']);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function loadLog() {
  try {
    const raw = localStorage.getItem(STREAK_LOG_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLog(days) {
  localStorage.setItem(STREAK_LOG_KEY, JSON.stringify(days));
}

export function recordActivityToday() {
  const today = todayIso();
  const days = loadLog();
  if (!days.includes(today)) {
    days.push(today);
    days.sort();
    saveLog(days);
  }
}

export function getStreakLog() {
  return loadLog();
}

export function hasCheckedInToday(days = loadLog()) {
  return days.includes(todayIso());
}

// 從「今天」往回數連續天數；如果今天還沒打卡，改從「昨天」往回數（不會一過午夜、
// 使用者今天還沒開始讀，就先看到 0——讓他知道「還保有 N 天的連續紀錄，今天記得打卡」）。
export function computeCurrentStreak(days = loadLog()) {
  if (days.length === 0) return 0;
  const daySet = new Set(days);
  const cursor = new Date();
  if (!daySet.has(todayIso())) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  // 上限抓一年份，純粹是避免資料萬一異常（例如手動改壞 localStorage）造成無窮迴圈。
  for (let i = 0; i < 366; i += 1) {
    const iso = cursor.toISOString().slice(0, 10);
    if (!daySet.has(iso)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function getLongestStreak(days = loadLog()) {
  if (days.length === 0) return 0;
  const sorted = [...days].sort();
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = new Date(sorted[i - 1]);
    const curr = new Date(sorted[i]);
    const diffDays = Math.round((curr - prev) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

// 非侵入式追蹤：包一層 DB.add／DB.update，不改 db.js 原始碼。跟 webdavSyncService.js 的
// trackLocalChanges 用不同的標記屬性（__marginaliaStreakTracked），兩者可以疊加使用。
export function trackReadingActivity(DB) {
  if (!DB.add.__marginaliaStreakTracked) {
    const originalAdd = DB.add;
    const wrappedAdd = async (storeName, record) => {
      const result = await originalAdd(storeName, record);
      if (TRACKED_ADD_STORES.has(storeName)) recordActivityToday();
      return result;
    };
    wrappedAdd.__marginaliaStreakTracked = true;
    DB.add = wrappedAdd;
  }
  if (!DB.update.__marginaliaStreakTracked) {
    const originalUpdate = DB.update;
    const wrappedUpdate = async (storeName, record) => {
      const result = await originalUpdate(storeName, record);
      if (TRACKED_UPDATE_STORES.has(storeName)) recordActivityToday();
      return result;
    };
    wrappedUpdate.__marginaliaStreakTracked = true;
    DB.update = wrappedUpdate;
  }
}

// 可直接掛進側邊欄的小型打卡狀態卡片。
export function renderStreakWidget(container) {
  const days = getStreakLog();
  const streak = computeCurrentStreak(days);
  const checkedInToday = hasCheckedInToday(days);
  const longest = getLongestStreak(days);

  container.innerHTML = `
    <div class="sidebar-panel streak-widget">
      <div class="streak-main">
        <span class="streak-flame">🔥</span>
        <span class="streak-count">${streak}</span>
        <span class="streak-unit">天連續閱讀</span>
      </div>
      <p class="streak-sub">
        ${checkedInToday ? '✅ 今天已經打卡' : '尚未打卡，寫點筆記或摘錄一句佳句吧'}
        ${longest > streak ? `・最長紀錄 ${longest} 天` : ''}
      </p>
    </div>
  `;
}
