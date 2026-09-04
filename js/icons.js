// 全站共用的極簡線條 Icon（取代原本散落各處的原生系統 Emoji）。
// 每一顆都是 stroke="currentColor"（不是寫死某個色碼）——顏色完全交給外層
// CSS 的 color 屬性決定，同一顆 Icon 放進不同顏色語境（一般按鈕的玫瑰棕、
// 危險按鈕的灰紅、作用中頁籤的深棕……）自動吃到對的顏色，不需要每個用途
// 各自維護一份「同一個圖案、不同顏色」的重複 SVG。統一套用 .ui-icon 這個
// class（見 css/styles.css），集中控制大小／對齊，呼叫端不用每次都設定
// width/height/vertical-align。
//
// 這份清單刻意只涵蓋「全站按鈕／頁籤／狀態提示」這類使用者常態會看到的
// UI 元素，不含匯出到 Markdown 檔案裡的標題符號（那些會變成使用者存到
// Obsidian 的實際檔案內容，不是這次「介面」重構的範圍）。

function icon(paths, extra = '') {
  return `<svg class="ui-icon${extra ? ` ${extra}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const ICON_EDIT = icon('<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path>');

export const ICON_DELETE = icon('<path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line>');

// 關係圖譜：用「相連的節點」代表人物／概念之間的關係，比蜘蛛網圖案更直接對應功能本身。
export const ICON_GRAPH = icon('<circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>');

export const ICON_SPARKLES = icon('<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"></path>');

export const ICON_LIGHTBULB = icon('<path d="M15 14c.2-1 .7-1.7 1.5-2.5a5.5 5.5 0 1 0-9 0c.8.8 1.3 1.5 1.5 2.5"></path><path d="M9 18h6"></path><path d="M10 22h4"></path>');

export const ICON_PEN_LINE = icon('<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>');

export const ICON_NOTEBOOK = icon('<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.4 2.6a2.03 2.03 0 1 1 2.9 2.9L12 14l-4 1 1-4Z"></path>');

export const ICON_QUOTE = icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>');

export const ICON_EYE = icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>');

export const ICON_EYE_OFF = icon('<path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 11s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><path d="M2 2l20 20"></path><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path>');

export const ICON_ALERT = icon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>');

export const ICON_CHECK_CIRCLE = icon('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>');

export const ICON_IMAGE = icon('<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"></path>');

export const ICON_CART = icon('<circle cx="8" cy="21" r="1"></circle><circle cx="19" cy="21" r="1"></circle><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"></path>');

export const ICON_BOOK_OPEN = icon('<path d="M12 7v14"></path><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"></path>');

export const ICON_BOOK = icon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>');

export const ICON_LINK = icon('<path d="M9 17H7A5 5 0 0 1 7 7h2"></path><path d="M15 7h2a5 5 0 1 1 0 10h-2"></path><line x1="8" y1="12" x2="16" y2="12"></line>');

export const ICON_UPLOAD = icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>');

export const ICON_DOWNLOAD = icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>');

export const ICON_VOLUME = icon('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>');

export const ICON_GLOBE = icon('<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>');

export const ICON_CLIPBOARD = icon('<rect x="8" y="2" width="8" height="4" rx="1"></rect><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>');

export const ICON_HIGHLIGHTER = icon('<path d="m9 11-6 6v3h3l6-6"></path><path d="m14 3 7 7-4 4-7-7z"></path>');

export const ICON_USER = icon('<path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="9" r="5"></circle>');
